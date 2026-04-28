import { createClient } from "npm:@supabase/supabase-js@2";

const BUILD_ID = "manage-signup-user-2026-04-29-v1";

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

async function assertAdmin(req: Request, userClient: any, adminClient: any) {
  const authHeader = req.headers.get("Authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("missing_authorization");
  }

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    throw new Error("not_authenticated");
  }

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from("profiles")
    .select("id, email, name, approved, role")
    .eq("id", user.id)
    .maybeSingle();

  if (callerProfileError) {
    throw new Error(callerProfileError.message);
  }

  if (!callerProfile?.approved || callerProfile?.role !== "admin") {
    throw new Error("forbidden");
  }

  return user;
}

async function safeDeleteRows(adminClient: any, table: string, column: string, value: string) {
  const { error } = await adminClient
    .from(table)
    .delete()
    .eq(column, value);

  if (error && error.code !== "42P01") {
    throw new Error(`${table}_delete_failed: ${error.message}`);
  }
}

async function getTargetProfile(adminClient: any, userId: string) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, email, name, approved, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

async function guardDangerousUserAction(adminClient: any, callerId: string, targetUserId: string) {
  if (!targetUserId) {
    throw new Error("missing_user_id");
  }

  if (callerId === targetUserId) {
    throw new Error("cannot_modify_your_own_admin_account_here");
  }

  const targetProfile = await getTargetProfile(adminClient, targetUserId);

  if (targetProfile?.role === "admin" && targetProfile?.approved === true) {
    const { data: admins, error } = await adminClient
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .eq("approved", true);

    if (error) {
      throw new Error(error.message);
    }

    if ((admins || []).length <= 1) {
      throw new Error("cannot_remove_last_admin");
    }
  }

  return targetProfile;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({
        build_id: BUILD_ID,
        error: "missing_environment_variables",
        message: "SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY is missing."
      }, 500);
    }

    const body = await req.json().catch(() => ({}));

    const action = String(body.action || "").trim();
    const userId = String(body.user_id || "").trim();
    const email = String(body.email || "").trim();
    const redirectTo = String(body.redirectTo || "https://contactgohil-sudo.github.io/Mehfil-Songs/").trim();

    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      },
      auth: {
        persistSession: false
      }
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false
      }
    });

    const publicClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false
      }
    });

    const caller = await assertAdmin(req, userClient, adminClient);

    if (action === "approve") {
      if (!userId) {
        return json({
          build_id: BUILD_ID,
          error: "missing_user_id"
        }, 400);
      }

      const { error } = await adminClient
        .from("profiles")
        .update({ approved: true })
        .eq("id", userId);

      if (error) {
        return json({
          build_id: BUILD_ID,
          error: "approve_failed",
          message: error.message
        }, 500);
      }

      return json({
        build_id: BUILD_ID,
        ok: true,
        action
      });
    }

    if (action === "resend_verification") {
  const safeEmail = String(body.email || "").trim().toLowerCase();

  if (!safeEmail) {
    return json({
      build_id: BUILD_ID,
      error: "missing_email"
    }, 400);
  }

  const publicAuthClient = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const { data, error } = await publicAuthClient.auth.resend({
    type: "signup",
    email: safeEmail,
    options: {
      emailRedirectTo: redirectTo
    }
  });

  if (error) {
    console.error("RESEND VERIFICATION ERROR:", {
      message: error.message,
      status: error.status,
      name: error.name,
      email: safeEmail
    });

    return json({
      build_id: BUILD_ID,
      error: "resend_verification_failed",
      message: error.message,
      status: error.status || null
    }, 500);
  }

  return json({
    build_id: BUILD_ID,
    ok: true,
    action: "resend_verification",
    email: safeEmail,
    data
  });
}

        if (action === "create_missing_profile") {
      if (!userId) {
        return json({
          build_id: BUILD_ID,
          error: "missing_user_id"
        }, 400);
      }

      const { data: userResult, error: userError } = await adminClient.auth.admin.getUserById(userId);

      if (userError || !userResult?.user) {
        return json({
          build_id: BUILD_ID,
          error: "auth_user_lookup_failed",
          message: userError?.message || "Auth user not found."
        }, 500);
      }

      const authUser = userResult.user;
      const userMetadata = authUser.user_metadata || {};

      const payload = {
        id: authUser.id,
        email: authUser.email || "",
        name: userMetadata.name || "",
        approved: false,
        role: "user"
      };

      const { error } = await adminClient
        .from("profiles")
        .upsert([payload], { onConflict: "id" });

      if (error) {
        return json({
          build_id: BUILD_ID,
          error: "profile_repair_failed",
          message: error.message
        }, 500);
      }

      return json({
        build_id: BUILD_ID,
        ok: true,
        action,
        profile: payload
      });
    }

    if (action === "remove_access") {
      if (!userId) {
        return json({
          build_id: BUILD_ID,
          error: "missing_user_id"
        }, 400);
      }

      await guardDangerousUserAction(adminClient, caller.id, userId);

      const { error } = await adminClient
        .from("profiles")
        .update({
          approved: false,
          role: "user"
        })
        .eq("id", userId);

      if (error) {
        return json({
          build_id: BUILD_ID,
          error: "remove_access_failed",
          message: error.message
        }, 500);
      }

      return json({
        build_id: BUILD_ID,
        ok: true,
        action
      });
    }

    if (action === "delete_account_data") {
      if (!userId) {
        return json({
          build_id: BUILD_ID,
          error: "missing_user_id"
        }, 400);
      }

      await guardDangerousUserAction(adminClient, caller.id, userId);

      await safeDeleteRows(adminClient, "bookmarks", "user_id", userId);
      await safeDeleteRows(adminClient, "live_song_events", "shared_by", userId);

      const { error: profileDeleteError } = await adminClient
        .from("profiles")
        .delete()
        .eq("id", userId);

      if (profileDeleteError && profileDeleteError.code !== "PGRST116") {
        return json({
          build_id: BUILD_ID,
          error: "profile_delete_failed",
          message: profileDeleteError.message
        }, 500);
      }

      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId);

      if (authDeleteError) {
        return json({
          build_id: BUILD_ID,
          error: "auth_user_delete_failed",
          message: authDeleteError.message
        }, 500);
      }

      return json({
        build_id: BUILD_ID,
        ok: true,
        action
      });
    }

    return json({
      build_id: BUILD_ID,
      error: "unknown_action",
      message: `Unknown action: ${action}`
    }, 400);
  } catch (error) {
    console.error("manage-signup-user crash", error);

    const message = String((error as Error)?.message || error || "Unknown error");

    const status =
      message === "missing_authorization" ? 401 :
      message === "not_authenticated" ? 401 :
      message === "forbidden" ? 403 :
      500;

    return json({
      build_id: BUILD_ID,
      error: message,
      message
    }, status);
  }
});
