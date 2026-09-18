import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeOpeningRisk } from "@/lib/logic/opening";
import { isOverdue, isStale } from "@/lib/logic/tasks";
import { isHighRisk } from "@/lib/logic/risk";
import { daysUntil, isoAddDays } from "@/lib/logic/dates";
import type { Site } from "@/lib/types";

// Immutable report snapshots (§6.12): everything the rendered report needs is
// computed once and stored as JSON. Finalized reports never re-query.

export interface ReportSnapshot {
  site: { name: string; timezone: string; target_opening_date: string | null };
  period: { start: string; end: string; type: "weekly" | "monthly" };
  countdown_days: number | null;
  overall_rag: "green" | "amber" | "red";
  opening_risk: { atRisk: boolean; causes: string[] };
  scorecard: Array<{
    name: string; category: string; unit: string | null; value: number | null;
    target: number | null; status: string; narrative: string | null; owner: string;
    trend: Array<{ period: string; value: number | null }>;
  }>;
  missing_kpis: string[];
  completed_this_period: Array<{ title: string; owner: string }>;
  due_next_period: Array<{ title: string; owner: string; due_date: string }>;
  overdue: Array<{ title: string; owner: string; due_date: string | null }>;
  blocked: Array<{ title: string; owner: string; reason: string | null }>;
  stale: Array<{ title: string; owner: string }>;
  critical_path: Array<{ title: string; owner: string; status: string; due_date: string | null }>;
  new_issues: Array<{ title: string; priority: string; owner: string }>;
  resolved_issues: Array<{ title: string; resolution: string | null }>;
  top_risks: Array<{ title: string; score: number; status: string; mitigation: string | null; owner: string }>;
  decisions_made: Array<{ title: string; status: string; date: string }>;
  commitments: { done: number; open: number; carried: number; items: Array<{ text: string; owner: string; status: string; carry_count: number }> };
  milestones: Array<{ title: string; target_date: string; status: string }>;
  opening_date_commentary: string;
  // Monthly extras
  goals?: Array<{ title: string; status: string; progress: number }>;
  project_progress?: Array<{ name: string; status: string; percent: number }>;
  budget_runway?: { cash_runway_months: number | null; budget_variance_percent: number | null };
  recurring_defects?: Array<{ title: string; count: number }>;
  repeated_carryovers?: Array<{ text: string; carry_count: number }>;
  decision_outcomes_due?: Array<{ title: string; review_date: string | null }>;
  workstream_summaries?: Record<string, string>;
}

export async function buildReportSnapshot(
  supabase: SupabaseClient,
  site: Site,
  reportType: "weekly" | "monthly",
  periodStart: string,
  periodEnd: string
): Promise<ReportSnapshot> {
  const tz = site.timezone;
  const nextPeriodEnd = isoAddDays(periodEnd, reportType === "weekly" ? 7 : 30);

  const [tasksQ, kpisQ, entriesQ, issuesQ, risksQ, decisionsQ, commitmentsQ, milestonesQ, goalsQ, projectsQ] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("title,status,due_date,percent_done,critical,blocker_reason,last_meaningful_update_at,archived_at,updated_at, owner:profiles!tasks_owner_id_fkey(name)")
        .eq("site_id", site.id)
        .is("archived_at", null)
        .limit(2000),
      supabase
        .from("kpis")
        .select("id,name,category,unit,frequency,target_value,green_min,green_max,yellow_min,yellow_max,direction,active, owner:profiles!kpis_owner_id_fkey(name)")
        .eq("site_id", site.id)
        .eq("active", true)
        .is("archived_at", null)
        .order("sort_order"),
      supabase
        .from("kpi_entries")
        .select("kpi_id,period_start,value,status,narrative")
        .lte("period_start", periodStart)
        .gte("period_start", isoAddDays(periodStart, -12 * 7))
        .order("period_start"),
      supabase
        .from("issues")
        .select("title,priority,status,reported_at,resolved_at,resolution_summary,related_issue_id, owner:profiles!issues_owner_id_fkey(name)")
        .eq("site_id", site.id)
        .is("archived_at", null),
      supabase
        .from("risks")
        .select("title,score,status,mitigation_plan, owner:profiles!risks_owner_id_fkey(name)")
        .eq("site_id", site.id)
        .is("archived_at", null)
        .in("status", ["open", "monitoring", "mitigating"])
        .order("score", { ascending: false })
        .limit(10),
      supabase
        .from("decisions")
        .select("title,status,decision_date,review_date,outcome")
        .eq("organization_id", site.organization_id)
        .is("archived_at", null)
        .gte("decision_date", periodStart)
        .lte("decision_date", periodEnd),
      supabase
        .from("huddle_commitments")
        .select("commitment,status,carry_count,due_date, owner:profiles!huddle_commitments_owner_id_fkey(name)")
        .eq("site_id", site.id)
        .is("archived_at", null),
      supabase
        .from("milestones")
        .select("title,target_date,status")
        .eq("site_id", site.id)
        .is("archived_at", null)
        .order("target_date"),
      supabase
        .from("goals")
        .select("title,status,progress_percent")
        .eq("organization_id", site.organization_id)
        .is("archived_at", null),
      supabase
        .from("projects")
        .select("name,status,percent_done,workstream")
        .eq("site_id", site.id)
        .is("archived_at", null),
    ]);

  type Row = Record<string, unknown> & { owner?: { name?: string } | null };
  const ownerName = (r: Row) => r.owner?.name ?? "—";
  const tasks = (tasksQ.data ?? []) as unknown as Array<Row & {
    title: string; status: string; due_date: string | null; critical: boolean;
    blocker_reason: string | null; last_meaningful_update_at: string; archived_at: string | null; updated_at: string;
  }>;

  const overdue = tasks.filter((t) => isOverdue(t, tz));
  const blocked = tasks.filter((t) => t.status === "blocked");
  const stale = tasks.filter((t) => isStale(t));
  const critical = tasks.filter((t) => t.critical && t.status !== "done");
  const completed = tasks.filter(
    (t) => t.status === "done" && t.updated_at >= periodStart && t.updated_at <= `${periodEnd}T23:59:59Z`
  );
  const dueNext = tasks.filter(
    (t) => t.status !== "done" && t.due_date !== null && t.due_date > periodEnd && t.due_date <= nextPeriodEnd
  );

  const entries = (entriesQ.data ?? []) as Array<{ kpi_id: string; period_start: string; value: number | null; status: string; narrative: string | null }>;
  const kpis = (kpisQ.data ?? []) as unknown as Array<Row & {
    id: string; name: string; category: string; unit: string | null; target_value: number | null; frequency: string;
  }>;
  const scorecard = kpis.map((k) => {
    const series = entries.filter((e) => e.kpi_id === k.id);
    const current = series.find((e) => e.period_start === periodStart) ?? null;
    return {
      name: k.name,
      category: k.category,
      unit: k.unit,
      value: current?.value ?? null,
      target: k.target_value,
      status: current && current.value !== null ? current.status : "missing",
      narrative: current?.narrative ?? null,
      owner: ownerName(k),
      trend: series.slice(-8).map((e) => ({ period: e.period_start, value: e.value })),
    };
  });
  const missingKpis = scorecard.filter((k) => k.status === "missing").map((k) => k.name);

  const issues = (issuesQ.data ?? []) as unknown as Array<Row & {
    title: string; priority: string; status: string; reported_at: string; resolved_at: string | null;
    resolution_summary: string | null; related_issue_id: string | null;
  }>;
  const newIssues = issues.filter((i) => i.reported_at.slice(0, 10) >= periodStart && i.reported_at.slice(0, 10) <= periodEnd);
  const resolvedIssues = issues.filter(
    (i) => i.resolved_at && i.resolved_at.slice(0, 10) >= periodStart && i.resolved_at.slice(0, 10) <= periodEnd
  );

  const risks = (risksQ.data ?? []) as unknown as Array<Row & { title: string; score: number; status: string; mitigation_plan: string | null }>;
  const milestones = (milestonesQ.data ?? []) as Array<{ title: string; target_date: string; status: string }>;
  const commitments = (commitmentsQ.data ?? []) as unknown as Array<Row & { commitment: string; status: string; carry_count: number }>;

  const openingRisk = computeOpeningRisk({
    timezone: tz,
    criticalTasks: critical.map((t) => ({ ...t, title: t.title })),
    milestones,
    manualDeclared: site.opening_risk_declared,
    manualReason: site.opening_risk_reason,
  });

  const overallRag: "green" | "amber" | "red" = openingRisk.atRisk
    ? "red"
    : overdue.length + blocked.length > 0 || missingKpis.length > 0
      ? "amber"
      : "green";

  const commentary = openingRisk.atRisk
    ? `Opening date at risk: ${openingRisk.causes.join("; ")}`
    : `On track. ${critical.length} critical-path item(s) open, ${overdue.length} overdue, ${blocked.length} blocked.`;

  const snapshot: ReportSnapshot = {
    site: { name: site.name, timezone: tz, target_opening_date: site.target_opening_date },
    period: { start: periodStart, end: periodEnd, type: reportType },
    countdown_days: site.target_opening_date ? daysUntil(site.target_opening_date, tz) : null,
    overall_rag: overallRag,
    opening_risk: { atRisk: openingRisk.atRisk, causes: openingRisk.causes },
    scorecard,
    missing_kpis: missingKpis,
    completed_this_period: completed.map((t) => ({ title: t.title, owner: ownerName(t) })),
    due_next_period: dueNext.map((t) => ({ title: t.title, owner: ownerName(t), due_date: t.due_date! })),
    overdue: overdue.map((t) => ({ title: t.title, owner: ownerName(t), due_date: t.due_date })),
    blocked: blocked.map((t) => ({ title: t.title, owner: ownerName(t), reason: t.blocker_reason })),
    stale: stale.map((t) => ({ title: t.title, owner: ownerName(t) })),
    critical_path: critical.map((t) => ({ title: t.title, owner: ownerName(t), status: t.status, due_date: t.due_date })),
    new_issues: newIssues.map((i) => ({ title: i.title, priority: i.priority, owner: ownerName(i) })),
    resolved_issues: resolvedIssues.map((i) => ({ title: i.title, resolution: i.resolution_summary })),
    top_risks: risks.map((r) => ({ title: r.title, score: r.score, status: r.status, mitigation: r.mitigation_plan, owner: ownerName(r) })),
    decisions_made: ((decisionsQ.data ?? []) as Array<{ title: string; status: string; decision_date: string }>).map((d) => ({
      title: d.title, status: d.status, date: d.decision_date,
    })),
    commitments: {
      done: commitments.filter((c) => c.status === "done").length,
      open: commitments.filter((c) => c.status === "open").length,
      carried: commitments.filter((c) => c.status === "carried_over").length,
      items: commitments.slice(0, 50).map((c) => ({ text: c.commitment, owner: ownerName(c), status: c.status, carry_count: c.carry_count })),
    },
    milestones,
    opening_date_commentary: commentary,
  };

  if (reportType === "monthly") {
    const goals = (goalsQ.data ?? []) as Array<{ title: string; status: string; progress_percent: number }>;
    const projects = (projectsQ.data ?? []) as Array<{ name: string; status: string; percent_done: number; workstream: string | null }>;
    const cash = scorecard.find((k) => k.name === "Cash runway");
    const budget = scorecard.find((k) => k.name === "Opening budget variance");
    // Recurring defects: manual links (§7.7) — count chains by root issue.
    const recurring = new Map<string, number>();
    for (const i of issues) {
      if (i.related_issue_id) recurring.set(i.title, (recurring.get(i.title) ?? 0) + 1);
    }
    const decisionRows = (decisionsQ.data ?? []) as Array<{ title: string; review_date: string | null; outcome: string | null; status: string }>;

    const summaryFor = (names: string[]): string => {
      const ws = projects.filter((p) => p.workstream && names.some((n) => p.workstream!.toLowerCase().includes(n)));
      if (ws.length === 0) return "No active projects.";
      const pct = Math.round(ws.reduce((s, p) => s + p.percent_done, 0) / ws.length);
      return `${ws.length} project(s), average ${pct}% complete; ${ws.filter((p) => p.status === "blocked").length} blocked.`;
    };

    snapshot.goals = goals.map((g) => ({ title: g.title, status: g.status, progress: g.progress_percent }));
    snapshot.project_progress = projects.map((p) => ({ name: p.name, status: p.status, percent: p.percent_done }));
    snapshot.budget_runway = {
      cash_runway_months: cash?.value ?? null,
      budget_variance_percent: budget?.value ?? null,
    };
    snapshot.recurring_defects = [...recurring.entries()].map(([title, count]) => ({ title, count }));
    snapshot.repeated_carryovers = commitments
      .filter((c) => c.carry_count >= 2)
      .map((c) => ({ text: c.commitment, carry_count: c.carry_count }));
    snapshot.decision_outcomes_due = decisionRows
      .filter((d) => d.review_date && !d.outcome)
      .map((d) => ({ title: d.title, review_date: d.review_date }));
    snapshot.workstream_summaries = {
      Payers: summaryFor(["payer", "credential"]),
      Staffing: summaryFor(["staffing", "hr"]),
      Construction: summaryFor(["buildout", "facility"]),
      "Clinical readiness": summaryFor(["clinical"]),
      "Referral development": summaryFor(["referral"]),
    };
  }

  return snapshot;
}

export function highRiskCount(snapshot: ReportSnapshot): number {
  return snapshot.top_risks.filter((r) => isHighRisk(r.score)).length;
}
