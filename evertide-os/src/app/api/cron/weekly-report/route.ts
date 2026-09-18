import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeSites, authorizeCron, recordCronRun } from "@/lib/cron";
import { buildReportSnapshot } from "@/lib/reports";
import { priorWeekRange } from "@/lib/logic/dates";
import type { Site } from "@/lib/types";

export const dynamic = "force-dynamic";

// Sunday night (§9): draft weekly report for the prior Monday–Sunday period.
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const results: Record<string, string> = {};

  for (const site of await activeSites(admin)) {
    const { start, end } = priorWeekRange(site.timezone);
    const { data: existing } = await admin
      .from("reports").select("id,status").eq("site_id", site.id)
      .eq("report_type", "weekly").eq("period_start", start).maybeSingle();
    if (existing?.status === "final") {
      results[site.slug] = "already final";
      continue;
    }

    const snapshot = await buildReportSnapshot(admin, site as Site, "weekly", start, end);
    const row = {
      organization_id: site.organization_id,
      site_id: site.id,
      report_type: "weekly" as const,
      period_start: start,
      period_end: end,
      generated_at: new Date().toISOString(),
      snapshot: snapshot as unknown as Record<string, unknown>,
      status: "generated" as const,
    };
    if (existing) await admin.from("reports").update(row).eq("id", existing.id);
    else await admin.from("reports").insert(row);
    results[site.slug] = `drafted ${start}`;
    await recordCronRun(admin, site.organization_id, "weekly-report", { site: site.slug, period_start: start });
  }

  return NextResponse.json({ ok: true, results });
}
