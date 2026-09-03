import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

async function getMpesaToken(): Promise<string | null> {
  const consumerKey = Deno.env.get("MPESA_CONSUMER_KEY");
  const consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET");
  if (!consumerKey || !consumerSecret) return null;

  const auth = btoa(`${consumerKey}:${consumerSecret}`);
  const isProduction = Deno.env.get("MPESA_ENV") === "production";
  const baseUrl = isProduction
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  const resp = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (path.endsWith("/stk-push") && req.method === "POST") {
    try {
      if (!supabaseUrl || !serviceRoleKey || !anonKey) {
        return jsonResponse({ error: "Server misconfigured" }, 500);
      }

      // Only staff who hold payment.create may trigger a real charge attempt.
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

      const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
      if (callerError || !caller) return jsonResponse({ error: "Invalid session" }, 401);

      const { data: allowed, error: permError } = await callerClient.rpc("has_permission", { permission_key: "payment.create" });
      if (permError || !allowed) return jsonResponse({ error: "Not authorized to request M-Pesa payments" }, 403);

      const body = await req.json();
      const { invoiceId, phone, amount, accountRef } = body;

      if (!invoiceId || !phone || !amount) {
        return jsonResponse({ error: "Missing required fields: invoiceId, phone, amount" }, 400);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return jsonResponse({ error: "amount must be a positive number of minor units" }, 400);
      }

      // RLS-scoped lookup: confirms the invoice exists and the caller may see it,
      // and that it's still open for payment.
      const { data: invoice, error: invoiceError } = await callerClient
        .from("invoices")
        .select("id, status")
        .eq("id", invoiceId)
        .maybeSingle();
      if (invoiceError || !invoice) return jsonResponse({ error: "Invoice not found" }, 404);
      if (invoice.status === "VOID" || invoice.status === "PAID") {
        return jsonResponse({ error: `Invoice is already ${invoice.status.toLowerCase()}` }, 400);
      }

      const shortcode = Deno.env.get("MPESA_SHORTCODE");
      const passkey = Deno.env.get("MPESA_PASSKEY");
      const callbackUrl = Deno.env.get("MPESA_CALLBACK_URL");

      if (!shortcode || !passkey || !callbackUrl) {
        return jsonResponse({
          error: "M-Pesa credentials not configured. Set MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL.",
          sandbox: true,
        }, 503);
      }

      const token = await getMpesaToken();
      if (!token) {
        return jsonResponse({ error: "Unable to authenticate with M-Pesa." }, 503);
      }

      const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const password = btoa(`${shortcode}${passkey}${timestamp}`);
      const isProduction = Deno.env.get("MPESA_ENV") === "production";
      const baseUrl = isProduction
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

      const stkPayload = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.round(amount / 100),
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: accountRef || `INV-${String(invoiceId).slice(0, 8)}`,
        TransactionDesc: "Oakland Motor Care Ltd payment",
      };

      const stkResp = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stkPayload),
      });

      const stkData = await stkResp.json();

      if (stkData.ResponseCode === "0") {
        // Record the pending attempt now, keyed by checkout_request_id, so the
        // callback (which carries no invoice reference of its own) can find it.
        const admin = createClient(supabaseUrl, serviceRoleKey);
        await admin.from("mpesa_transactions").insert({
          merchant_request_id: stkData.MerchantRequestID,
          checkout_request_id: stkData.CheckoutRequestID,
          invoice_id: invoiceId,
          amount: Math.round(amount),
          phone: String(phone),
          status: "PENDING",
        });

        return jsonResponse({
          success: true,
          merchantRequestId: stkData.MerchantRequestID,
          checkoutRequestId: stkData.CheckoutRequestID,
          message: "STK push sent. Please approve on your phone.",
        });
      }

      return jsonResponse({
        success: false,
        error: stkData.ResponseDescription || "STK push failed.",
      }, 400);
    } catch {
      return jsonResponse({ error: "Unable to process M-Pesa request." }, 500);
    }
  }

  if (path.endsWith("/callback") && req.method === "POST") {
    try {
      // Daraja callbacks carry no Supabase session and cannot be signature-verified,
      // so a shared secret in the registered callback URL is the only thing standing
      // between this endpoint and anyone who finds it. Require it.
      const callbackSecret = Deno.env.get("MPESA_CALLBACK_SECRET");
      const providedSecret = url.searchParams.get("key") ?? "";
      if (!callbackSecret || !timingSafeEqual(providedSecret, callbackSecret)) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: "Server misconfigured" }, 500);
      }

      const body = await req.json();
      const callback = body?.Body?.stkCallback;
      if (!callback) return jsonResponse({ success: true });

      const checkoutRequestId = callback.CheckoutRequestID;
      const resultCode = callback.ResultCode;
      const resultDesc = callback.ResultDesc;

      const callbackMetadata = callback.CallbackMetadata?.Item;
      const amount = callbackMetadata?.find((i: { Name: string }) => i.Name === "Amount")?.Value;
      const mpesaReceipt = callbackMetadata?.find((i: { Name: string }) => i.Name === "MpesaReceiptNumber")?.Value;
      const transactionDate = callbackMetadata?.find((i: { Name: string }) => i.Name === "TransactionDate")?.Value;
      const phone = callbackMetadata?.find((i: { Name: string }) => i.Name === "PhoneNumber")?.Value;

      const admin = createClient(supabaseUrl, serviceRoleKey);

      // Only ever settle a transaction we ourselves initiated at STK-push time —
      // never create one from an inbound callback, which would let anyone who
      // guesses/replays a checkout_request_id fabricate a payment record.
      const { data: tx } = await admin
        .from("mpesa_transactions")
        .select("id, invoice_id, status")
        .eq("checkout_request_id", checkoutRequestId)
        .maybeSingle();

      if (!tx) {
        return jsonResponse({ success: true, message: "Unknown transaction ignored" });
      }
      if (tx.status !== "PENDING") {
        return jsonResponse({ success: true, message: "Duplicate callback ignored" });
      }

      const nextStatus = resultCode === 0 ? "COMPLETED" : "FAILED";
      await admin
        .from("mpesa_transactions")
        .update({
          result_code: resultCode,
          result_description: resultDesc,
          amount: amount ? Math.round(amount * 100) : null,
          receipt_number: mpesaReceipt || null,
          transaction_date: transactionDate ? new Date(Number(transactionDate)).toISOString() : null,
          phone: phone ? String(phone) : undefined,
          callback_payload: body,
          status: nextStatus,
        })
        .eq("id", tx.id);

      if (resultCode === 0 && tx.invoice_id && amount) {
        const idempotencyKey = `mpesa-${mpesaReceipt || checkoutRequestId}`;
        const { error: paymentError } = await admin.rpc("record_mpesa_payment", {
          p_invoice_id: tx.invoice_id,
          p_amount_minor: Math.round(amount * 100),
          p_reference: mpesaReceipt || checkoutRequestId,
          p_idempotency_key: idempotencyKey,
          p_notes: "M-Pesa STK push",
        });

        if (paymentError) {
          await admin
            .from("mpesa_transactions")
            .update({ status: "NEEDS_REVIEW", reconciliation_note: paymentError.message })
            .eq("id", tx.id);
        }
      }

      return jsonResponse({ success: true });
    } catch {
      return jsonResponse({ error: "Callback processing failed" }, 500);
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
});
