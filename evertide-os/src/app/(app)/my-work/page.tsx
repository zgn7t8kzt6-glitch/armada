import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CarryBadge, DueDate, PageHeader, StatusPill } from "@/components/ui";
import { TaskRow } from "@/components/tasks/task-row";
import { todayInTz, isoAddDays, weeklyPeriodStart } from "@/lib/logic/dates";
import { isOverdue } from "@/lib/logic/tasks";
import type { Commitment, Decision, Issue, Kpi, Risk, Task } from "@/lib/types";

export const metadata = { title: "My Work" };
export const dynamic = "force-dynamic";

// My Work (§7.2): the signed-in user's exceptions first, then due dates.
export default async function MyWorkPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const tz = ctx.site.timezone;
  const today = todayInTz(tz);
  const weekEnd = isoAddDays(today, 7);
  const week = weeklyPeriodStart(tz);

  const [tasksQ, commitmentsQ, issuesQ, risksQ, kpisQ, entriesQ, decisionsQ] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, owner:profiles!tasks_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", ctx.site.id)
      .eq("owner_id", ctx.userId)
      .neq("status", "done")
      .is("archived_at", null)
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("huddle_commitments")
      .select("*")
      .eq("site_id", ctx.site.id)
      .eq("owner_id", ctx.userId)
      .eq("status", "open")
      .is("archived_at", null)
      .order("due_date"),
    supabase
      .from("issues")
      .select("*")
      .eq("site_id", ctx.site.id)
      .eq("owner_id", ctx.userId)
      .in("status", ["open", "investigating", "action_planned"])
      .is("archived_at", null)
      .order("priority", { ascending: false }),
    supabase
      .from("risks")
      .select("*")
      .eq("site_id", ctx.site.id)
      .eq("owner_id", ctx.userId)
      .in("status", ["open", "monitoring", "mitigating"])
      .is("archived_at", null)
      .lte("review_date", today),
    supabase
      .from("kpis")
      .select("*")
      .eq("site_id", ctx.site.id)
      .eq("owner_id", ctx.userId)
      .eq("active", true)
      .eq("frequency", "weekly")
      .is("archived_at", null),
    supabase.from("kpi_entries").select("kpi_id,value").eq("period_start", week),
    supabase
      .from("decisions")
      .select("*")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .or(`and(status.eq.proposed,owner_id.eq.${ctx.userId})` + (ctx.isAdmin ? ",status.eq.proposed" : "") + `,and(owner_id.eq.${ctx.userId},status.eq.approved,review_date.lte.${today})`),
  ]);

  const tasks = (tasksQ.data ?? []) as unknown as Task[];
  const overdue = tasks.filter((t) => isOverdue(t, tz));
  const blocked = tasks.filter((t) => t.status === "blocked" && !isOverdue(t, tz));
  const dueSoon = tasks.filter(
    (t) => !isOverdue(t, tz) && t.status !== "blocked" && t.due_date !== null && t.due_date <= weekEnd
  );
  const rest = tasks.filter((t) => !overdue.includes(t) && !blocked.includes(t) && !dueSoon.includes(t));

  const commitments = (commitmentsQ.data ?? []) as unknown as Commitment[];
  const issues = (issuesQ.data ?? []) as unknown as Issue[];
  const risks = (risksQ.data ?? []) as unknown as Risk[];
  const entered = new Set((entriesQ.data ?? []).filter((e) => e.value !== null).map((e) => e.kpi_id));
  const missingKpis = ((kpisQ.data ?? []) as unknown as Kpi[]).filter((k) => !entered.has(k.id));
  const decisions = ((decisionsQ.data ?? []) as unknown as Decision[]).filter(
    (d, i, arr) => arr.findIndex((x) => x.id === d.id) === i
  );

  const sections: Array<{ title: string; tone?: "red" | "amber"; items: Task[] }> = [
    { title: `Overdue (${overdue.length})`, tone: "red", items: overdue },
    { title: `Blocked (${blocked.length})`, tone: "red", items: blocked },
    { title: `Due today & this week (${dueSoon.length})`, tone: "amber", items: dueSoon },
    { title: `Later (${rest.length})`, items: rest },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="My Work" subtitle="Exceptions first, then what's due. Update fast, move on." />

      {sections.map((sec) =>
        sec.items.length === 0 ? null : (
          <Card key={sec.title} title={sec.title} className={sec.tone === "red" ? "border-red-200" : sec.tone === "amber" ? "border-amber-200" : ""}>
            <ul>
              {sec.items.map((t) => (
                <TaskRow key={t.id} task={t} timezone={tz} canWrite={ctx.canWrite} />
              ))}
            </ul>
          </Card>
        )
      )}
      {tasks.length === 0 && (
        <Card title="Tasks">
          <p className="text-sm text-slate-500">You own no open tasks. 🎉</p>
        </Card>
      )}

      {commitments.length > 0 && (
        <Card title={`Open commitments (${commitments.length})`}>
          <ul className="space-y-2">
            {commitments.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href="/huddles" className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{c.commitment}</Link>
                <CarryBadge count={c.carry_count} />
                <DueDate date={c.due_date} overdue={c.due_date < today} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {issues.length > 0 && (
        <Card title={`Owned issues (${issues.length})`}>
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/issues/${i.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{i.title}</Link>
                <StatusPill status={i.priority} />
                <StatusPill status={i.status} />
                {i.due_date && <DueDate date={i.due_date} overdue={i.due_date < today} />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {risks.length > 0 && (
        <Card title={`Risks due for review (${risks.length})`}>
          <ul className="space-y-2">
            {risks.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/risks/${r.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{r.title}</Link>
                <span className="text-xs text-slate-500">score {r.score}</span>
                <DueDate date={r.review_date} overdue />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {missingKpis.length > 0 && (
        <Card title={`Missing KPI entries (${missingKpis.length})`} className="border-red-200">
          <ul className="space-y-2">
            {missingKpis.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2 text-sm">
                <StatusPill status="missing" label="MISSING" />
                <Link href="/scoreboard" className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{k.name}</Link>
                <span className="text-2xs text-slate-400">enter this week&apos;s value</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {decisions.length > 0 && (
        <Card title={`Decisions awaiting you (${decisions.length})`}>
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/decisions/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{d.title}</Link>
                <StatusPill status={d.status} />
                {d.status === "approved" && <span className="text-2xs text-amber-700">outcome review due</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
