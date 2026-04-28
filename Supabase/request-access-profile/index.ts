import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));

    const userId = String(body.user_id || body.userId || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();

    if (!userId || !email) {
      return json({
        error: "missing_fields",
        message: "user_id and email are required."
      }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({
        error: "missing_env",
        message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
      }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { data: authUserData, error: authUserError } = await admin.auth.admin.getUserById(userId);

    if (authUserError || !authUserData?.user) {
      return json({
        error: "auth_user_not_found",
        message: authUserError?.message || "Auth user not found."
      }, 404);
    }

    const authUser = authUserData.user;
    const authEmail = String(authUser.email || "").trim().toLowerCase();

    if (!authEmail || authEmail !== email) {
      return json({
        error: "email_mismatch",
        message: "Provided email does not match the Auth user email."
      }, 400);
    }

    const { data: existingProfile, error: existingError } = await admin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (existingError) {
      return json({
        error: "profile_check_failed",
        message: existingError.message
      }, 500);
    }

    if (existingProfile) {
      return json({
        ok: true,
        created: false,
        profile: existingProfile
      });
    }

    const profilePayload = {
      id: userId,
      email: authEmail,
      name: name || String(authUser.user_metadata?.name || "").trim() || authEmail,
      approved: false,
      role: "user"
    };

    const { data: profile, error: insertError } = await admin
      .from("profiles")
      .insert([profilePayload])
      .select()
      .single();

    if (insertError) {
      return json({
        error: "profile_insert_failed",
        message: insertError.message
      }, 500);
    }

    return json({
      ok: true,
      created: true,
      profile
    });
  } catch (error) {
    console.error("request-access-profile crash", error);

    return json({
      error: "request_access_profile_failed",
      message: String((error as Error)?.message || error || "Unknown error")
    }, 500);
  }
});
