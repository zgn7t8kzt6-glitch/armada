import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseAnonKey, publicSupabaseUrl } from "@/lib/public-env";

export const dynamic = "force-dynamic";

// Health check (§15): app availability + a lightweight DB roundtrip. Reports
// the configured Supabase host and key prefix (both public by design — the
// URL and publishable key ship in the browser bundle anyway) so deployment
// misconfiguration is diagnosable from a browser. No secrets ever.
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = { app: "ok", database: "fail" };
  const url = publicSupabaseUrl();
  const key = publicSupabaseAnonKey();
  let databaseError: string | null = null;

  try {
    if (url && key) {
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await supabase.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
      // RLS returns zero rows for anon — that's still a healthy roundtrip.
      if (!error) checks.database = "ok";
      else databaseError = error.message;
    } else {
      databaseError = "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set";
    }
  } catch (e) {
    databaseError = e instanceof Error ? e.message : "unreachable";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      checks,
      config: {
        supabase_host: url ? new URL(url).host : "(not set)",
        anon_key_prefix: key ? `${key.slice(0, 15)}…` : "(not set)",
        service_role_key_set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        cron_secret_set: Boolean(process.env.CRON_SECRET),
      },
      ...(databaseError ? { database_error: databaseError } : {}),
    },
    { status: healthy ? 200 : 503 }
  );
}
