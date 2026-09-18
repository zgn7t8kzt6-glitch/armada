import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseAnonKey, publicSupabaseUrl } from "@/lib/public-env";

export const dynamic = "force-dynamic";

// Health check (§15): app availability + a lightweight DB roundtrip. Reports
// the configured Supabase host and key shape (both public by design — URL and
// publishable key ship in the browser bundle anyway) plus the full PostgREST
// error and a raw REST status probe, so deployment misconfiguration is
// diagnosable from a browser. No secrets ever.
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = { app: "ok", database: "fail" };
  const url = publicSupabaseUrl();
  const key = publicSupabaseAnonKey();
  let databaseError: unknown = null;
  let restProbe: string | null = null;

  try {
    if (url && key) {
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await supabase.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
      // RLS returns zero rows for anon — that's still a healthy roundtrip.
      if (!error) checks.database = "ok";
      else databaseError = { message: error.message, code: error.code, details: error.details, hint: error.hint };

      // Raw probe distinguishes bad-key (401/403) from missing-table (404/406)
      // from network issues.
      try {
        const res = await fetch(`${url}/rest/v1/organizations?select=id&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          cache: "no-store",
        });
        restProbe = `HTTP ${res.status}${res.ok ? "" : `: ${(await res.text()).slice(0, 200)}`}`;
      } catch (e) {
        restProbe = `fetch error: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      databaseError = "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set";
    }
  } catch (e) {
    databaseError = e instanceof Error ? `${e.name}: ${e.message}` : "unreachable";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      checks,
      config: {
        supabase_host: url ? new URL(url).host : "(not set)",
        anon_key_prefix: key ? `${key.slice(0, 22)}…` : "(not set)",
        anon_key_length: key.length,
        service_role_key_set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        service_role_key_length: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim().length,
        cron_secret_set: Boolean(process.env.CRON_SECRET),
      },
      ...(databaseError ? { database_error: databaseError } : {}),
      ...(restProbe ? { rest_probe: restProbe } : {}),
    },
    { status: healthy ? 200 : 503 }
  );
}
