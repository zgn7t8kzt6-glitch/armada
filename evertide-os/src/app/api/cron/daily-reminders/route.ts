import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeSites, authorizeCron, notifyOnce, recordCronRun, type NotificationRow } from "@/lib/cron";
import { todayInTz, isoAddDays, weeklyPeriodStart } from "@/lib/logic/dates";

export const dynamic = "force-dynamic";

// Daily 7:00 AM site-local (§9): overdue tasks, due commitments, high risks
// due for review, vendor renewals, and missing weekly KPI entries.
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const results: Record<string, number> = {};

  for (const site of await activeSites(admin)) {
    const today = todayInTz(site.timezone);
    const soon = isoAddDays(today, 30);
    const week = weeklyPeriodStart(site.timezone);
    const rows: NotificationRow[] = [];
    const base = { organization_id: site.organization_id, site_id: site.id };

    const [tasksQ, commitmentsQ, risksQ, vendorsQ, kpisQ, entriesQ] = await Promise.all([
      admin.from("tasks").select("id,title,owner_id,due_date").eq("site_id", site.id).is("archived_at", null)
        .neq("status", "done").not("due_date", "is", null).lt("due_date", today),
      admin.from("huddle_commitments").select("id,commitment,owner_id,due_date").eq("site_id", site.id)
        .eq("status", "open").is("archived_at", null).lte("due_date", today),
      admin.from("risks").select("id,title,owner_id,score,review_date").eq("site_id", site.id)
        .is("archived_at", null).in("status", ["open", "monitoring", "mitigating"])
        .gte("score", 6).lte("review_date", today),
      admin.from("vendors").select("id,name,owner_id,renewal_notice_date,contract_end").eq("site_id", site.id)
        .is("archived_at", null).in("status", ["active", "evaluating"]),
      admin.from("kpis").select("id,name,owner_id").eq("site_id", site.id).eq("active", true)
        .eq("frequency", "weekly").is("archived_at", null),
      admin.from("kpi_entries").select("kpi_id,value").eq("period_start", week),
    ]);

    for (const t of tasksQ.data ?? []) {
      rows.push({ ...base, user_id: t.owner_id, type: "task_overdue", title: `Overdue: ${t.title}`, body: `Due ${t.due_date}`, linked_type: "task", linked_id: t.id });
    }
    for (const c of commitmentsQ.data ?? []) {
      rows.push({ ...base, user_id: c.owner_id, type: "commitment_due", title: `Commitment due: ${c.commitment}`, body: `Due ${c.due_date}`, linked_type: "commitment", linked_id: c.id });
    }
    for (const r of risksQ.data ?? []) {
      rows.push({ ...base, user_id: r.owner_id, type: "risk_review", title: `Risk review due: ${r.title}`, body: `Score ${r.score}`, linked_type: "risk", linked_id: r.id });
    }
    for (const v of vendorsQ.data ?? []) {
      if ((v.renewal_notice_date && v.renewal_notice_date <= soon) || (v.contract_end && v.contract_end <= soon)) {
        rows.push({ ...base, user_id: v.owner_id, type: "vendor_renewal", title: `Vendor renewal approaching: ${v.name}`, linked_type: "vendor", linked_id: v.id });
      }
    }
    const entered = new Set((entriesQ.data ?? []).filter((e) => e.value !== null).map((e) => e.kpi_id));
    for (const k of kpisQ.data ?? []) {
      if (!entered.has(k.id)) {
        rows.push({ ...base, user_id: k.owner_id, type: "kpi_missing", title: `MISSING KPI: ${k.name}`, body: "Enter this week's value", linked_type: "kpi", linked_id: k.id });
      }
    }

    results[site.slug] = await notifyOnce(admin, rows);
    await recordCronRun(admin, site.organization_id, "daily-reminders", { site: site.slug, sent: results[site.slug] });
  }

  return NextResponse.json({ ok: true, sent: results });
}
