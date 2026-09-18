import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { publicSupabaseAnonKey, publicSupabaseUrl } from "@/lib/public-env";

export const dynamic = "force-dynamic";

// Emergency/bootstrap sign-in that bypasses email delivery (magic-link email
// providers rate-limit hard before custom SMTP is configured). Server-side it
// generates a one-time link via the admin API and verifies it immediately,
// setting normal session cookies — no email is ever sent.
//
// Protection: requires the exact CRON_SECRET (a server secret) as a query
// parameter, and the target account must already exist AND hold an active
// org_admin membership. Every use is written to the audit log. Rotate
// CRON_SECRET to revoke any shared link.
export async function GET(request: NextRequest) {
  const env = serverEnv();
  const secret = request.nextUrl.searchParams.get("secret");
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  if (!env.CRON_SECRET || !secret || secret !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!email) {
    return NextResponse.json({ error: "email query parameter required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Only existing org admins may use the bootstrap door.
  const { data: adminRow } = await admin
    .from("organization_memberships")
    .select("user_id, profile:profiles!organization_memberships_user_id_fkey(email)")
    .eq("role", "org_admin")
    .eq("active", true);
  const match = (adminRow ?? []).find(
    (m) => (m.profile as unknown as { email?: string } | null)?.email?.toLowerCase() === email
  );
  if (!match) {
    return NextResponse.json({ error: "No active org_admin account with that email" }, { status: 403 });
  }

  // Set a one-time random password server-side and sign in with it — no
  // email, no OTP tokens, no expiry semantics. The password is never shown
  // to anyone and replaces nothing (accounts here are passwordless).
  const oneTimePassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { error: pwError } = await admin.auth.admin.updateUserById(match.user_id, {
    password: oneTimePassword,
  });
  if (pwError) {
    return NextResponse.json({ error: pwError.message }, { status: 500 });
  }

  const cookieStore = cookies();
  const response = NextResponse.redirect(new URL("/", request.url));
  const supabase = createServerClient(publicSupabaseUrl(), publicSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: oneTimePassword,
  });
  if (signInError) {
    return NextResponse.json({ error: signInError.message }, { status: 500 });
  }

  await admin.from("audit_events").insert({
    organization_id: (await admin.from("organizations").select("id").limit(1).single()).data?.id,
    actor_id: match.user_id,
    entity_type: "bootstrap_login",
    entity_id: email,
    event_type: "run",
    metadata: { via: "bootstrap-login route" },
  });

  return response;
}
