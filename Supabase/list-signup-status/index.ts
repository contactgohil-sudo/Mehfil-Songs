import { createClient } from "npm:@supabase/supabase-js@2";

const BUILD_ID = "list-signup-status-2026-04-29-v2";

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

function getEmailVerified(user: Record<string, unknown> | null) {
  if (!user) return false;

  return Boolean(
    user.email_confirmed_at ||
    user.confirmed_at ||
    user.phone_confirmed_at
  );
}

function getSignupStatus(user: Record<string, unknown> | null, profile: Record<string, unknown> | null) {
  if (user && !profile) return "profile_missing";
  if (!user && profile) return "profile_without_auth";

  const approved = profile?.approved === true;
  const emailVerified = getEmailVerified(user);

  if (approved && emailVerified) return "approved";
  if (approved && !emailVerified) return "approved_email_unverified";

  if (!approved && emailVerified) return "pending_admin";
  return "pending_admin_email_unverified";
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

    await assertAdmin(req, userClient, adminClient);

    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, email, name, approved, role, created_at")
      .order("created_at", { ascending: false });

    if (profilesError) {
      return json({
        build_id: BUILD_ID,
        error: "profiles_lookup_failed",
        message: profilesError.message
      }, 500);
    }

    const allAuthUsers: Record<string, unknown>[] = [];
    const perPage = 1000;

    for (let page = 1; page <= 10; page++) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage
      });

      if (error) {
        return json({
          build_id: BUILD_ID,
          error: "auth_users_lookup_failed",
          message: error.message
        }, 500);
      }

      const pageUsers = Array.isArray(data?.users) ? data.users : [];
      allAuthUsers.push(...pageUsers);

      if (pageUsers.length < perPage) break;
    }

    const profileMap = new Map(
      (profiles || []).map((profile: Record<string, unknown>) => [
        String(profile.id),
        profile
      ])
    );

    const authUserIdSet = new Set(
      allAuthUsers.map((authUser) => String(authUser.id || ""))
    );

    const rowsFromAuth = allAuthUsers.map((authUser) => {
      const authId = String(authUser.id || "");
      const profile = profileMap.get(authId) || null;
      const userMetadata = (authUser.user_metadata || {}) as Record<string, unknown>;

      const emailVerified = getEmailVerified(authUser);
      const approved = profile?.approved === true;
      const status = getSignupStatus(authUser, profile);

      return {
        user_id: authId,
        email: String(authUser.email || profile?.email || ""),
        name: String(profile?.name || userMetadata.name || ""),
        role: String(profile?.role || "user"),
        approved,
        email_verified: emailVerified,
        status,
        can_approve: Boolean(profile && !approved),
        can_resend_verification: Boolean(authUser.email && !emailVerified),
        can_create_profile: Boolean(authUser && !profile),
        created_at: String(authUser.created_at || profile?.created_at || ""),
        last_sign_in_at: String(authUser.last_sign_in_at || ""),
        has_profile: Boolean(profile),
        has_auth_user: true
      };
    });

    const rowsFromOrphanProfiles = (profiles || [])
      .filter((profile: Record<string, unknown>) => !authUserIdSet.has(String(profile.id)))
      .map((profile: Record<string, unknown>) => ({
        user_id: String(profile.id || ""),
        email: String(profile.email || ""),
        name: String(profile.name || ""),
        role: String(profile.role || "user"),
        approved: Boolean(profile.approved),
        email_verified: false,
        status: "profile_without_auth",
        can_approve: false,
        can_resend_verification: false,
        can_create_profile: false,
        created_at: String(profile.created_at || ""),
        last_sign_in_at: "",
        has_profile: true,
        has_auth_user: false
      }));

    const rows = [...rowsFromAuth, ...rowsFromOrphanProfiles]
      .sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return bTime - aTime;
      });

    const counts = rows.reduce((acc: Record<string, number>, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;

      if (!row.email_verified) {
        acc.email_unverified_total = (acc.email_unverified_total || 0) + 1;
      }

      return acc;
    }, {});

    return json({
      build_id: BUILD_ID,
      rows,
      counts,
      returned_count: rows.length
    });
  } catch (error) {
    console.error("list-signup-status crash", error);

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
