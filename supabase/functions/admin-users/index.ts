import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  // Runs as the caller (RLS-scoped) purely to verify who they are and that they hold
  // users.manage — every privileged mutation below happens through `admin`, never this client.
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) return jsonResponse({ error: "Invalid session" }, 401);

  const { data: allowed, error: permError } = await callerClient.rpc("has_permission", { permission_key: "users.manage" });
  if (permError || !allowed) return jsonResponse({ error: "Not authorized to manage users" }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const action = body.action;

  try {
    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.fullName ?? "").trim();
      const phone = body.phone ? String(body.phone) : null;
      const roleId = String(body.roleId ?? "");
      if (!email || !fullName || !roleId) {
        return jsonResponse({ error: "email, fullName and roleId are required" }, 400);
      }

      const redirectTo = Deno.env.get("APP_URL") || undefined;
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo,
      });
      if (inviteError || !invited?.user) {
        return jsonResponse({ error: inviteError?.message ?? "Unable to send invitation" }, 400);
      }

      const userId = invited.user.id;
      await admin.from("profiles").upsert(
        { id: userId, full_name: fullName, phone, status: "INVITED", invited_by: caller.id, invited_at: new Date().toISOString() },
        { onConflict: "id" },
      );
      await admin.from("user_roles").upsert({ user_id: userId, role_id: roleId }, { onConflict: "user_id,role_id" });
      await admin.from("audit_logs").insert({
        actor_id: caller.id,
        action: "USER_INVITED",
        entity: "profiles",
        entity_id: userId,
        after_state: { email, full_name: fullName, role_id: roleId },
      });

      return jsonResponse({ success: true, userId });
    }

    if (action === "suspend" || action === "reactivate" || action === "disable") {
      const userId = String(body.userId ?? "");
      if (!userId) return jsonResponse({ error: "userId is required" }, 400);

      const nextStatus = action === "reactivate" ? "ACTIVE" : action === "suspend" ? "SUSPENDED" : "DISABLED";
      const banDuration = action === "reactivate" ? "none" : "876000h";

      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: banDuration });
      if (banError) return jsonResponse({ error: banError.message }, 400);

      await admin.from("profiles").update({ status: nextStatus }).eq("id", userId);
      await admin.from("audit_logs").insert({
        actor_id: caller.id,
        action: `USER_${nextStatus === "ACTIVE" ? "REACTIVATED" : nextStatus}`,
        entity: "profiles",
        entity_id: userId,
      });

      return jsonResponse({ success: true });
    }

    if (action === "changeRole") {
      const userId = String(body.userId ?? "");
      const roleId = String(body.roleId ?? "");
      if (!userId || !roleId) return jsonResponse({ error: "userId and roleId are required" }, 400);

      await admin.from("user_roles").delete().eq("user_id", userId);
      await admin.from("user_roles").insert({ user_id: userId, role_id: roleId });
      await admin.from("audit_logs").insert({
        actor_id: caller.id,
        action: "USER_ROLE_CHANGED",
        entity: "profiles",
        entity_id: userId,
        after_state: { role_id: roleId },
      });

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
