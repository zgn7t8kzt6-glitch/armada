import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOverdue, isStale } from "@/lib/logic/tasks";
import { isHighRisk } from "@/lib/logic/risk";
import { todayInTz, weeklyPeriodStart } from "@/lib/logic/dates";
import type { Commitment, Decision, Kpi, Milestone, Profile, Risk, Site, Task } from "@/lib/types";

export interface ScorecardSummary {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  overdue: number;
  stale: number;
  completePercent: number;
  highIssues: number;
  highRisks: number;
  missingKpis: number;
}

export interface OwnerWorkload {
  profile: Profile;
  open: number;
  overdue: number;
  blocked: number;
}

export interface WaitingOnYou {
  overdueTasks: Task[];
  blockedTasks: Task[];
  dueCommitments: Commitment[];
  missingKpis: Kpi[];
  risksDue: Risk[];
  decisionsRequested: Decision[];
}

export interface DashboardData {
  summary: ScorecardSummary;
  waiting: WaitingOnYou;
  criticalTasks: Task[];
  milestones: Milestone[];
  workload: OwnerWorkload[];
  recentDecisions: Decision[];
  recentUpdates: Array<{ id: string; body: string | null; update_type: string; created_at: string; task_title: string; author_name: string | null }>;
}

export async function fetchDashboard(supabase: SupabaseClient, site: Site, userId: string): Promise<DashboardData> {
  const tz = site.timezone;
  const today = todayInTz(tz);
  const week = weeklyPeriodStart(tz);

  const [tasksQ, issuesQ, risksQ, kpisQ, entriesQ, milestonesQ, commitmentsQ, decisionsQ, updatesQ] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, owner:profiles!tasks_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", site.id)
      .is("archived_at", null)
      .limit(2000),
    supabase
      .from("issues")
      .select("id,priority,status")
      .eq("site_id", site.id)
      .is("archived_at", null)
      .in("status", ["open", "investigating", "action_planned"]),
    supabase
      .from("risks")
      .select("*, owner:profiles!risks_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", site.id)
      .is("archived_at", null)
      .in("status", ["open", "monitoring", "mitigating"]),
    supabase
      .from("kpis")
      .select("*, owner:profiles!kpis_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", site.id)
      .eq("active", true)
      .eq("frequency", "weekly")
      .is("archived_at", null),
    supabase.from("kpi_entries").select("kpi_id,value,status,period_start").eq("period_start", week),
    supabase
      .from("milestones")
      .select("*, owner:profiles!milestones_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", site.id)
      .is("archived_at", null)
      .order("target_date"),
    supabase
      .from("huddle_commitments")
      .select("*, owner:profiles!huddle_commitments_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", site.id)
      .eq("status", "open")
      .is("archived_at", null)
      .order("due_date"),
    supabase
      .from("decisions")
      .select("*, owner:profiles!decisions_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("organization_id", site.organization_id)
      .is("archived_at", null)
      .order("decision_date", { ascending: false })
      .limit(30),
    supabase
      .from("task_updates")
      .select("id,body,update_type,created_at, task:tasks!task_updates_task_id_fkey(title), author:profiles!task_updates_author_id_fkey(name)")
      .eq("site_id", site.id)
      .neq("update_type", "system")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const tasks = (tasksQ.data ?? []) as unknown as Task[];
  const risks = (risksQ.data ?? []) as unknown as Risk[];
  const kpis = (kpisQ.data ?? []) as unknown as Kpi[];
  const milestones = (milestonesQ.data ?? []) as unknown as Milestone[];
  const commitments = (commitmentsQ.data ?? []) as unknown as Commitment[];
  const decisions = (decisionsQ.data ?? []) as unknown as Decision[];

  const enteredKpiIds = new Set((entriesQ.data ?? []).filter((e) => e.value !== null).map((e) => e.kpi_id));
  const missingKpis = kpis.filter((k) => !enteredKpiIds.has(k.id));

  const overdueTasks = tasks.filter((t) => isOverdue(t, tz));
  const staleTasks = tasks.filter((t) => isStale(t));
  const blockedTasks = tasks.filter((t) => t.status === "blocked");
  const done = tasks.filter((t) => t.status === "done").length;
  const highIssues = (issuesQ.data ?? []).filter((i) => i.priority === "high" || i.priority === "critical").length;
  const highRisks = risks.filter((r) => isHighRisk(r.score)).length;

  const summary: ScorecardSummary = {
    total: tasks.length,
    done,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    blocked: blockedTasks.length,
    overdue: overdueTasks.length,
    stale: staleTasks.length,
    completePercent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    highIssues,
    highRisks,
    missingKpis: missingKpis.length,
  };

  const waiting: WaitingOnYou = {
    overdueTasks: overdueTasks.filter((t) => t.owner_id === userId),
    blockedTasks: blockedTasks.filter((t) => t.owner_id === userId),
    dueCommitments: commitments.filter((c) => c.owner_id === userId && c.due_date <= today),
    missingKpis: missingKpis.filter((k) => k.owner_id === userId),
    risksDue: risks.filter((r) => r.owner_id === userId && r.review_date !== null && r.review_date <= today),
    decisionsRequested: decisions.filter((d) => d.status === "proposed" && d.owner_id === userId),
  };

  // Open work by owner with overdue counts.
  const byOwner = new Map<string, OwnerWorkload>();
  for (const t of tasks) {
    if (t.status === "done" || !t.owner) continue;
    const w = byOwner.get(t.owner_id) ?? { profile: t.owner, open: 0, overdue: 0, blocked: 0 };
    w.open += 1;
    if (isOverdue(t, tz)) w.overdue += 1;
    if (t.status === "blocked") w.blocked += 1;
    byOwner.set(t.owner_id, w);
  }

  return {
    summary,
    waiting,
    criticalTasks: tasks
      .filter((t) => t.critical && t.status !== "done")
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")),
    milestones,
    workload: [...byOwner.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    recentDecisions: decisions.slice(0, 5),
    recentUpdates: (updatesQ.data ?? []).map((u) => ({
      id: u.id as string,
      body: u.body as string | null,
      update_type: u.update_type as string,
      created_at: u.created_at as string,
      task_title: (u.task as unknown as { title: string } | null)?.title ?? "",
      author_name: (u.author as unknown as { name: string } | null)?.name ?? null,
    })),
  };
}
