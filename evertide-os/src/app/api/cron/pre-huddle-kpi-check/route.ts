import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeSites, authorizeCron, notifyOnce, recordCronRun, type NotificationRow } from "@/lib/cron";
import { weeklyPeriodStart } from "@/lib/logic/dates";

export const dynamic = "force-dynamic";

// Tuesday 8:00 AM (§9): before the leadership huddle, notify owners AND
// admins of any still-missing weekly KPIs.
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const results: Record<string, number> = {};

  for (const site of await activeSites(admin)) {
    const week = weeklyPeriodStart(site.timezone);
    const [kpisQ, entriesQ, adminsQ] = await Promise.all([
      admin.from("kpis").select("id,name,owner_id").eq("site_id", site.id)
        .eq("active", true).eq("frequency", "weekly").is("archived_at", null),
      admin.from("kpi_entries").select("kpi_id,value").eq("period_start", week),
      admin.from("organization_memberships").select("user_id").eq("organization_id", site.organization_id)
        .eq("role", "org_admin").eq("active", true),
    ]);

    const entered = new Set((entriesQ.data ?? []).filter((e) => e.value !== null).map((e) => e.kpi_id));
    const missing = (kpisQ.data ?? []).filter((k) => !entered.has(k.id));
    const rows: NotificationRow[] = [];
    const base = { organization_id: site.organization_id, site_id: site.id };

    for (const k of missing) {
      rows.push({ ...base, user_id: k.owner_id, type: "kpi_missing_prehuddle", title: `Huddle today — ${k.name} is still MISSING`, linked_type: "kpi", linked_id: k.id });
      for (const a of adminsQ.data ?? []) {
        if (a.user_id !== k.owner_id) {
          rows.push({ ...base, user_id: a.user_id, type: "kpi_missing_prehuddle", title: `MISSING before huddle: ${k.name}`, linked_type: "kpi", linked_id: k.id });
        }
      }
    }
    results[site.slug] = await notifyOnce(admin, rows);
    await recordCronRun(admin, site.organization_id, "pre-huddle-kpi-check", { site: site.slug, missing: missing.length });
  }

  return NextResponse.json({ ok: true, notified: results });
}
