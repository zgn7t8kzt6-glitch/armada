import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { RealtimeStatus } from "@/components/admin/realtime-status";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Diagnostics" };
export const dynamic = "force-dynamic";

const CRON_JOBS = [
  "daily-reminders", "weekly-scorecard-init", "pre-huddle-kpi-check",
  "post-huddle-check", "weekly-report", "monthly-report",
];

// Admin diagnostics (§15): environment/config readiness, Realtime status,
// cron last-run timestamps, seed version. Never exposes secret values.
export default async function DiagnosticsPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const envChecks: Array<{ name: string; ok: boolean }> = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    { name: "SUPABASE_SERVICE_ROLE_KEY", ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY },
    { name: "CRON_SECRET", ok: !!process.env.CRON_SECRET },
    { name: "NEXT_PUBLIC_APP_URL", ok: !!process.env.NEXT_PUBLIC_APP_URL },
  ];

  const [cronRunsQ, seedCountsQ] = await Promise.all([
    supabase
      .from("audit_events")
      .select("entity_id, occurred_at, metadata")
      .eq("organization_id", ctx.organization.id)
      .eq("entity_type", "cron")
      .order("occurred_at", { ascending: false })
      .limit(60),
    Promise.all([
      supabase.from("tasks").select("id", { head: true, count: "exact" }).eq("site_id", ctx.site.id).not("legacy_id", "is", null),
      supabase.from("milestones").select("id", { head: true, count: "exact" }).eq("site_id", ctx.site.id),
      supabase.from("kpis").select("id", { head: true, count: "exact" }).eq("site_id", ctx.site.id),
    ]),
  ]);

  const lastRun = new Map<string, string>();
  for (const run of cronRunsQ.data ?? []) {
    if (!lastRun.has(run.entity_id)) lastRun.set(run.entity_id, run.occurred_at);
  }
  const [tasksCount, milestonesCount, kpisCount] = seedCountsQ.map((q) => q.count ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Admin — Diagnostics" subtitle="Environment readiness, Realtime, cron runs, seed state." />

      <Card title="Environment configuration">
        <ul className="space-y-1.5">
          {envChecks.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
              <code className="text-slate-600">{c.name}</code>
              <StatusPill status={c.ok ? "done" : "missing"} label={c.ok ? "configured" : "MISSING"} />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-2xs text-slate-400">Presence only — values are never displayed.</p>
      </Card>

      <Card title="Realtime">
        <RealtimeStatus />
      </Card>

      <Card title="Cron last runs">
        <ul className="space-y-1.5">
          {CRON_JOBS.map((job) => (
            <li key={job} className="flex items-center justify-between gap-2 text-xs">
              <code className="text-slate-600">{job}</code>
              {lastRun.has(job) ? (
                <span className="text-slate-500">{formatDateTime(lastRun.get(job)!, ctx.site.timezone)}</span>
              ) : (
                <StatusPill status="pending" label="never run" />
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Seed state">
        <ul className="space-y-1.5 text-xs text-slate-600">
          <li>Seeded roadmap tasks: <strong>{tasksCount}</strong> / 60 expected</li>
          <li>Milestones: <strong>{milestonesCount}</strong> / 12 expected</li>
          <li>KPIs: <strong>{kpisCount}</strong> / 11 expected</li>
        </ul>
        <p className="mt-2 text-2xs text-slate-400">Run `npm run db:verify` for the full relationship check.</p>
      </Card>
    </div>
  );
}
