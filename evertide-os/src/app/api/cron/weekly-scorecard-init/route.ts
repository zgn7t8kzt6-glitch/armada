import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeSites, authorizeCron, notifyOnce, recordCronRun, type NotificationRow } from "@/lib/cron";
import { weeklyPeriodStart } from "@/lib/logic/dates";

export const dynamic = "force-dynamic";

// Monday 7:00 AM (§9): the new weekly scorecard period begins — notify each
// KPI owner that entries are due. No placeholder values are created (§6.8).
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const results: Record<string, number> = {};

  for (const site of await activeSites(admin)) {
    const week = weeklyPeriodStart(site.timezone);
    const { data: kpis } = await admin
      .from("kpis").select("id,name,owner_id").eq("site_id", site.id)
      .eq("active", true).eq("frequency", "weekly").is("archived_at", null);

    const rows: NotificationRow[] = (kpis ?? []).map((k) => ({
      organization_id: site.organization_id,
      site_id: site.id,
      user_id: k.owner_id,
      type: "kpi_week_open",
      title: `New scorecard week (${week}): enter ${k.name}`,
      linked_type: "kpi",
      linked_id: k.id,
    }));
    results[site.slug] = await notifyOnce(admin, rows);
    await recordCronRun(admin, site.organization_id, "weekly-scorecard-init", { site: site.slug, week, notified: results[site.slug] });
  }

  return NextResponse.json({ ok: true, notified: results });
}
