import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { testAuthEnabled } from "@/lib/env";
import { publicSupabaseAnonKey, publicSupabaseUrl } from "@/lib/public-env";

// Password-less test sign-in for Playwright (spec §14). Enabled ONLY when
// NODE_ENV=test or ALLOW_TEST_AUTH=1, and NEVER in production builds — both
// checks live in testAuthEnabled(). It generates a magic link server-side and
// immediately verifies it, setting the session cookies on the response.
export async function POST(request: NextRequest) {
  if (!testAuthEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) {
    return NextResponse.json({ error: error?.message ?? "failed" }, { status: 400 });
  }

  const cookieStore = cookies();
  const response = NextResponse.json({ ok: true });
  const supabase = createServerClient(
    publicSupabaseUrl(),
    publicSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) return NextResponse.json({ error: verifyError.message }, { status: 400 });
  return response;
}
