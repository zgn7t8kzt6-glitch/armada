import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Health check (§15): app availability + a lightweight DB query. Exposes no
// configuration details.
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = { app: "ok", database: "fail" };
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await supabase.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
      // RLS returns zero rows for anon — that's still a healthy roundtrip.
      if (!error) checks.database = "ok";
    }
  } catch {
    // fall through with database: fail
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: healthy ? "healthy" : "degraded", checks }, { status: healthy ? 200 : 503 });
}
