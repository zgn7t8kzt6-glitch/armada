import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchDashboard } from "@/lib/queries/dashboard";
import { daysToOpening } from "@/lib/data";
import { Card, CarryBadge, EmptyState, OwnerChip, PageHeader, Stat, StatusPill, DueDate } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { isOverdue } from "@/lib/logic/tasks";

export const dynamic = "force-dynamic";

// Home / Morning Brief (§7.1): exceptions and required actions first.
export default async function HomePage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const data = await fetchDashboard(supabase, ctx.site, ctx.userId);
  const days = daysToOpening(ctx.site);
  const s = data.summary;
  const w = data.waiting;
  const waitingCount =
    w.overdueTasks.length + w.blockedTasks.length + w.dueCommitments.length +
    w.missingKpis.length + w.risksDue.length + w.decisionsRequested.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Good morning, ${ctx.profile.name.split(" ")[0]}`}
        subtitle={`${ctx.site.name} · ${formatDate(new Date().toISOString().slice(0, 10))}`}
        action={
          days !== null ? (
            <div className={`rounded-lg px-4 py-2 text-center ${days < 30 ? "bg-red-50 ring-1 ring-red-200" : "bg-teal-50 ring-1 ring-teal-200"}`}>
              <p className={`text-2xl font-black tabular-nums ${days < 30 ? "text-red-700" : "text-teal-700"}`}>{Math.abs(days)}</p>
              <p className="text-2xs font-semibold uppercase tracking-wide text-slate-500">
                {days >= 0 ? "days until opening" : "days past target"}
              </p>
            </div>
          ) : undefined
        }
      />

      {/* Waiting on You — required actions first (§2.12) */}
      <Card title={`Waiting on You (${waitingCount})`} className={waitingCount > 0 ? "border-amber-300" : ""}>
        {waitingCount === 0 ? (
          <p className="text-sm text-slate-500">Nothing needs your attention right now. 🎉</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {w.overdueTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status="missed" label="Overdue task" />
                <Link href={`/projects/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{t.title}</Link>
                <DueDate date={t.due_date} overdue />
              </li>
            ))}
            {w.blockedTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status="blocked" label="Blocked task" />
                <Link href={`/projects/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{t.title}</Link>
              </li>
            ))}
            {w.dueCommitments.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status="at_risk" label="Commitment due" />
                <Link href="/huddles" className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{c.commitment}</Link>
                <CarryBadge count={c.carry_count} />
                <DueDate date={c.due_date} overdue={c.due_date < new Date().toISOString().slice(0, 10)} />
              </li>
            ))}
            {w.missingKpis.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status="missing" label="MISSING KPI" />
                <Link href="/scoreboard" className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{k.name}</Link>
                <span className="text-2xs text-slate-400">this week&apos;s value not entered</span>
              </li>
            ))}
            {w.risksDue.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status="at_risk" label="Risk review due" />
                <Link href={`/risks/${r.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{r.title}</Link>
                <DueDate date={r.review_date} overdue />
              </li>
            ))}
            {w.decisionsRequested.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <StatusPill status="proposed" label="Decision pending" />
                <Link href={`/decisions/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{d.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Scorecard summary (§7.1) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Roadmap complete" value={`${s.completePercent}%`} tone={s.completePercent >= 90 ? "green" : "default"} />
        <Stat label="Done / total" value={`${s.done}/${s.total}`} />
        <Stat label="In progress" value={s.inProgress} />
        <Stat label="Blocked" value={s.blocked} tone={s.blocked > 0 ? "red" : "green"} />
        <Stat label="Overdue" value={s.overdue} tone={s.overdue > 0 ? "red" : "green"} />
        <Stat label="Stale" value={s.stale} tone={s.stale > 0 ? "amber" : "green"} />
        <Stat label="High/critical issues" value={s.highIssues} tone={s.highIssues > 0 ? "red" : "green"} />
        <Stat label="High/severe risks" value={s.highRisks} tone={s.highRisks > 0 ? "amber" : "green"} />
        <Stat label="Missing KPIs" value={s.missingKpis} tone={s.missingKpis > 0 ? "red" : "green"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Critical-path pipeline (§7.1) */}
        <Card title="Critical path" action={<Link href="/projects?critical=1" className="text-2xs font-semibold text-teal-600 hover:underline">View all</Link>}>
          {data.criticalTasks.length === 0 ? (
            <p className="text-sm text-slate-500">No open critical-path tasks.</p>
          ) : (
            <ol className="space-y-2">
              {data.criticalTasks.map((t) => {
                const overdue = isOverdue(t, ctx.site.timezone);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span aria-hidden className={overdue || t.status === "blocked" ? "text-red-600" : "text-teal-600"}>⛳</span>
                    <Link href={`/projects/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{t.title}</Link>
                    <StatusPill status={t.status} />
                    <DueDate date={t.due_date} overdue={overdue} />
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        {/* Milestone timeline */}
        <Card title="Milestone timeline">
          <ol className="space-y-1.5">
            {data.milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    m.status === "met" ? "bg-green-500" : m.status === "missed" ? "bg-red-600" : m.status === "at_risk" ? "bg-amber-500" : "bg-slate-300"
                  }`}
                />
                <span className="w-20 shrink-0 text-xs tabular-nums text-slate-500">{formatDate(m.target_date)}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{m.title}</span>
                <StatusPill status={m.status} />
              </li>
            ))}
          </ol>
        </Card>

        {/* Open work by owner */}
        <Card title="Open work by owner">
          {data.workload.length === 0 ? (
            <EmptyState title="No open work" />
          ) : (
            <ul className="space-y-2">
              {data.workload.map((wl) => (
                <li key={wl.profile.id} className="flex items-center justify-between gap-2 text-sm">
                  <OwnerChip profile={wl.profile} size="md" />
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">{wl.open} open</span>
                    {wl.overdue > 0 && <span className="font-bold text-red-700">{wl.overdue} overdue</span>}
                    {wl.blocked > 0 && <span className="font-bold text-red-700">{wl.blocked} blocked</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent decisions and updates */}
        <Card title="Recent decisions & updates">
          <div className="space-y-3">
            {data.recentDecisions.length > 0 && (
              <ul className="space-y-1.5">
                {data.recentDecisions.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span aria-hidden>⚖️</span>
                    <Link href={`/decisions/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{d.title}</Link>
                    <StatusPill status={d.status} />
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-1.5 border-t border-slate-100 pt-2">
              {data.recentUpdates.map((u) => (
                <li key={u.id} className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{u.author_name ?? "System"}</span>{" "}
                  on <span className="italic">{u.task_title}</span>: {u.body?.slice(0, 100)}
                  <span className="ml-1 text-2xs text-slate-400">{formatDateTime(u.created_at, ctx.site.timezone)}</span>
                </li>
              ))}
              {data.recentUpdates.length === 0 && <li className="text-xs text-slate-400">No recent updates.</li>}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
