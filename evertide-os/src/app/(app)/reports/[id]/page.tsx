import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CarryBadge, PageHeader, StatusPill } from "@/components/ui";
import { FinalizeReportForm } from "@/components/reports/report-actions";
import { PrintButton } from "@/components/print-button";
import { formatDate } from "@/lib/format";
import type { ReportSnapshot } from "@/lib/reports";
import type { Report } from "@/lib/types";

export const dynamic = "force-dynamic";

// Rendered report (§7.12): print-optimized, immutable snapshot, prior-period
// comparison for the scorecard.
export default async function ReportDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase.from("reports").select("*").eq("id", params.id).maybeSingle();
  if (!data) notFound();
  const report = data as unknown as Report;
  const snap = report.snapshot as unknown as ReportSnapshot;

  // Prior period for comparison.
  const { data: prior } = await supabase
    .from("reports")
    .select("snapshot,period_start")
    .eq("site_id", ctx.site.id)
    .eq("report_type", report.report_type)
    .lt("period_start", report.period_start)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorSnap = prior?.snapshot as unknown as ReportSnapshot | undefined;

  const ragTone = snap.overall_rag === "red" ? "text-red-700" : snap.overall_rag === "amber" ? "text-amber-700" : "text-green-700";

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="no-print mb-2 text-xs text-slate-400">
        <Link href="/reports" className="hover:underline">Reports</Link> / {report.report_type} report
      </nav>
      <PageHeader
        title={`${report.report_type === "weekly" ? "Weekly" : "Monthly"} report — ${formatDate(report.period_start)} to ${formatDate(report.period_end)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={report.status === "final" ? "done" : "draft"} label={report.status} />
            <span className={`text-sm font-black uppercase ${ragTone}`}>{snap.overall_rag}</span>
            {snap.countdown_days !== null && <span className="text-xs text-slate-500">{snap.countdown_days} days to opening</span>}
          </span>
        }
        action={<PrintButton />}
      />

      <div className="space-y-4">
        {snap.opening_risk.atRisk && (
          <div className="print-page rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
            <p className="font-bold">OPENING DATE AT RISK</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {snap.opening_risk.causes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {report.narrative && (
          <Card title="Leadership narrative">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{report.narrative}</p>
          </Card>
        )}

        <Card title="Scorecard">
          {snap.missing_kpis.length > 0 && (
            <p className="mb-2 text-xs font-bold text-red-700">MISSING: {snap.missing_kpis.join(", ")}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-2xs uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-2 font-semibold">KPI</th>
                  <th className="py-1.5 pr-2 font-semibold">Value</th>
                  <th className="py-1.5 pr-2 font-semibold">Target</th>
                  <th className="py-1.5 pr-2 font-semibold">RAG</th>
                  <th className="py-1.5 pr-2 font-semibold">Prior period</th>
                  <th className="py-1.5 font-semibold">Owner</th>
                </tr>
              </thead>
              <tbody>
                {snap.scorecard.map((k) => {
                  const prev = priorSnap?.scorecard.find((p) => p.name === k.name);
                  return (
                    <tr key={k.name} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-2 font-medium text-slate-800">{k.name}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{k.value ?? <span className="font-bold text-red-700">MISSING</span>}</td>
                      <td className="py-1.5 pr-2 tabular-nums text-slate-500">{k.target ?? "—"}</td>
                      <td className="py-1.5 pr-2"><StatusPill status={k.status} label={k.status === "missing" ? "MISSING" : undefined} /></td>
                      <td className="py-1.5 pr-2 tabular-nums text-slate-500">{prev?.value ?? "—"}</td>
                      <td className="py-1.5 text-slate-500">{k.owner}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ListCard title={`Completed this period (${snap.completed_this_period.length})`} items={snap.completed_this_period.map((t) => `${t.title} — ${t.owner}`)} />
          <ListCard title={`Due next period (${snap.due_next_period.length})`} items={snap.due_next_period.map((t) => `${t.title} — ${t.owner} (${formatDate(t.due_date)})`)} />
          <ListCard tone="red" title={`Overdue (${snap.overdue.length})`} items={snap.overdue.map((t) => `${t.title} — ${t.owner}`)} />
          <ListCard tone="red" title={`Blocked (${snap.blocked.length})`} items={snap.blocked.map((t) => `${t.title} — ${t.reason ?? ""}`)} />
          <ListCard tone="amber" title={`Stale (${snap.stale.length})`} items={snap.stale.map((t) => `${t.title} — ${t.owner}`)} />
          <ListCard title={`Critical path (${snap.critical_path.length})`} items={snap.critical_path.map((t) => `${t.title} [${t.status}]`)} />
          <ListCard title={`New issues (${snap.new_issues.length})`} items={snap.new_issues.map((i) => `[${i.priority}] ${i.title}`)} />
          <ListCard title={`Resolved issues (${snap.resolved_issues.length})`} items={snap.resolved_issues.map((i) => `${i.title}${i.resolution ? ` — ${i.resolution}` : ""}`)} />
        </div>

        <Card title={`Top risks (${snap.top_risks.length})`}>
          <ul className="space-y-1.5 text-sm">
            {snap.top_risks.map((r) => (
              <li key={r.title} className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex h-6 w-8 items-center justify-center rounded text-xs font-black ${r.score >= 6 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{r.score}</span>
                <span className="min-w-0 flex-1">{r.title}</span>
                <span className="text-xs text-slate-500">{r.owner}</span>
              </li>
            ))}
            {snap.top_risks.length === 0 && <li className="text-sm text-slate-400">None open.</li>}
          </ul>
        </Card>

        <Card title={`Decisions made (${snap.decisions_made.length})`}>
          <ul className="space-y-1 text-sm">
            {snap.decisions_made.map((d) => (
              <li key={d.title} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">{d.title}</span>
                <StatusPill status={d.status} />
                <span className="text-xs text-slate-500">{formatDate(d.date)}</span>
              </li>
            ))}
            {snap.decisions_made.length === 0 && <li className="text-sm text-slate-400">None this period.</li>}
          </ul>
        </Card>

        <Card title={`Commitments — ${snap.commitments.done} done · ${snap.commitments.open} open · ${snap.commitments.carried} carried`}>
          <ul className="space-y-1 text-sm">
            {snap.commitments.items.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{c.text}</span>
                <CarryBadge count={c.carry_count} />
                <StatusPill status={c.status} />
                <span className="text-xs text-slate-500">{c.owner}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Milestones & opening date">
          <ul className="space-y-1 text-sm">
            {snap.milestones.map((m) => (
              <li key={m.title} className="flex items-center gap-2">
                <span className="w-24 text-xs tabular-nums text-slate-500">{formatDate(m.target_date)}</span>
                <span className="min-w-0 flex-1">{m.title}</span>
                <StatusPill status={m.status} />
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-slate-100 pt-2 text-sm text-slate-700">{snap.opening_date_commentary}</p>
        </Card>

        {snap.goals && (
          <Card title="Goal & project progress (monthly)">
            <ul className="space-y-1 text-sm">
              {snap.goals.map((g) => (
                <li key={g.title} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">{g.title}</span>
                  <StatusPill status={g.status} />
                  <span className="text-xs tabular-nums text-slate-500">{g.progress}%</span>
                </li>
              ))}
            </ul>
            {snap.budget_runway && (
              <p className="mt-3 border-t border-slate-100 pt-2 text-sm text-slate-700">
                Cash runway: <strong>{snap.budget_runway.cash_runway_months ?? "—"} months</strong> · Budget variance:{" "}
                <strong>{snap.budget_runway.budget_variance_percent ?? "—"}%</strong>
              </p>
            )}
            {snap.workstream_summaries && (
              <dl className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
                {Object.entries(snap.workstream_summaries).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-bold">{k}:</dt> <dd className="inline">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {snap.repeated_carryovers && snap.repeated_carryovers.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-2">
                <p className="text-xs font-bold text-amber-800">Repeated carryovers (2x+)</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {snap.repeated_carryovers.map((c, i) => (
                    <li key={i}>{c.text} — carried {c.carry_count}x</li>
                  ))}
                </ul>
              </div>
            )}
            {snap.decision_outcomes_due && snap.decision_outcomes_due.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-2">
                <p className="text-xs font-bold text-slate-600">Decision outcomes due for review</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {snap.decision_outcomes_due.map((d, i) => (
                    <li key={i}>{d.title} {d.review_date && `(review ${formatDate(d.review_date)})`}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {report.status !== "final" && ctx.isAdmin && (
          <Card title="Finalize">
            <FinalizeReportForm reportId={report.id} />
          </Card>
        )}
      </div>
    </div>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone?: "red" | "amber" }) {
  return (
    <Card title={title} className={tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : ""}>
      {items.length === 0 ? (
        <p className="text-sm text-green-700">None. ✓</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-700">
          {items.slice(0, 25).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
          {items.length > 25 && <li className="text-slate-400">…and {items.length - 25} more</li>}
        </ul>
      )}
    </Card>
  );
}
