import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

  if (path.endsWith("/stk-push") && req.method === "POST") {
    try {
      const body = await req.json();
      const { invoiceId, phone, amount, accountRef } = body;

      if (!invoiceId || !phone || !amount) {
        return jsonResponse({ error: "Missing required fields: invoiceId, phone, amount" }, 400);
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
        AccountReference: accountRef || `INV-${invoiceId.slice(0, 8)}`,
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
      const body = await req.json();
      const callback = body?.Body?.stkCallback;
      if (!callback) return jsonResponse({ success: true });

      const checkoutRequestId = callback.CheckoutRequestID;
      const resultCode = callback.ResultCode;
      const resultDesc = callback.ResultDesc;

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: "Server misconfigured" }, 500);
      }

      const callbackMetadata = callback.CallbackMetadata?.Item;
      const amount = callbackMetadata?.find((i: { Name: string }) => i.Name === "Amount")?.Value;
      const mpesaReceipt = callbackMetadata?.find((i: { Name: string }) => i.Name === "MpesaReceiptNumber")?.Value;
      const transactionDate = callbackMetadata?.find((i: { Name: string }) => i.Name === "TransactionDate")?.Value;
      const phone = callbackMetadata?.find((i: { Name: string }) => i.Name === "PhoneNumber")?.Value;

      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const { data: existing } = await supabase
        .from("mpesa_transactions")
        .select("id")
        .eq("checkout_request_id", checkoutRequestId)
        .maybeSingle();

      if (existing) {
        return jsonResponse({ success: true, message: "Duplicate callback ignored" });
      }

      const { data: mpesaTx } = await supabase
        .from("mpesa_transactions")
        .insert({
          merchant_request_id: callback.MerchantRequestID,
          checkout_request_id: checkoutRequestId,
          result_code: resultCode,
          result_description: resultDesc,
          amount: amount ? Math.round(amount * 100) : null,
          receipt_number: mpesaReceipt || null,
          transaction_date: transactionDate ? new Date(Number(transactionDate)).toISOString() : null,
          phone: phone ? String(phone) : null,
          callback_payload: body,
        })
        .select()
        .single();

      if (resultCode === 0 && mpesaTx) {
        const { data: invLink } = await supabase
          .from("mpesa_transactions")
          .select("invoice_id")
          .eq("checkout_request_id", checkoutRequestId)
          .maybeSingle();

        const invoiceId = invLink?.invoice_id;

        if (invoiceId && amount) {
          const idempotencyKey = `mpesa-${mpesaReceipt || checkoutRequestId}`;
          await supabase.rpc("record_payment", {
            p_invoice_id: invoiceId,
            p_amount_minor: Math.round(amount * 100),
            p_method: "MPESA",
            p_reference: mpesaReceipt || checkoutRequestId,
            p_idempotency_key: idempotencyKey,
            p_notes: `M-Pesa STK push`,
          });
        }
      }

      return jsonResponse({ success: true });
    } catch {
      return jsonResponse({ error: "Callback processing failed" }, 500);
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
});
