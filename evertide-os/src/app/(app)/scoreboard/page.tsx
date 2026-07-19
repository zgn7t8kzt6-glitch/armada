import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { KpiEntryButton } from "@/components/scoreboard/entry-modal";
import { KpiHistoryChart } from "@/components/scoreboard/kpi-chart";
import { weeklyPeriodStart, isoAddDays } from "@/lib/logic/dates";
import { formatDate, formatNumber } from "@/lib/format";
import type { Kpi, KpiCategory, KpiEntry } from "@/lib/types";

export const metadata = { title: "Scoreboard" };
export const dynamic = "force-dynamic";

const CATEGORIES: KpiCategory[] = ["Financial", "Operations", "Clinical", "Growth"];

// Scoreboard (§7.5): category tabs, current value vs target, RAG, owner,
// trend, narrative; MISSING never hidden; per-KPI history chart.
export default async function ScoreboardPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const category = (typeof searchParams.category === "string" ? searchParams.category : "Financial") as KpiCategory;
  const activeCategory = CATEGORIES.includes(category) ? category : "Financial";
  const week = weeklyPeriodStart(ctx.site.timezone);

  const { data: kpisData } = await supabase
    .from("kpis")
    .select("*, owner:profiles!kpis_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("site_id", ctx.site.id)
    .eq("active", true)
    .is("archived_at", null)
    .order("sort_order");
  const kpis = (kpisData ?? []) as unknown as Kpi[];

  const { data: entriesData } = await supabase
    .from("kpi_entries")
    .select("*")
    .in("kpi_id", kpis.length ? kpis.map((k) => k.id) : ["00000000-0000-0000-0000-000000000000"])
    .order("period_start", { ascending: false })
    .limit(kpis.length * 13 || 13);
  const entries = (entriesData ?? []) as unknown as KpiEntry[];

  const entryFor = (kpiId: string, period: string) =>
    entries.find((e) => e.kpi_id === kpiId && e.period_start === period) ?? null;
  const missingCount = kpis.filter((k) => {
    if (k.frequency !== "weekly") return false;
    const e = entryFor(k.id, week);
    return !e || e.value === null;
  }).length;

  const visible = kpis.filter((k) => k.category === activeCategory);

  return (
    <div>
      <PageHeader
        title="Scoreboard"
        subtitle={`Week of ${formatDate(week)} · ${missingCount > 0 ? `${missingCount} MISSING` : "all entered"}`}
        action={ctx.isAdmin ? <Link href="/admin/kpis" className="btn-secondary text-xs">Edit KPI definitions</Link> : undefined}
      />

      <div className="no-print mb-4 flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => {
          const catMissing = kpis.filter((k) => k.category === c && k.frequency === "weekly" && (entryFor(k.id, week)?.value ?? null) === null).length;
          return (
            <Link
              key={c}
              href={`/scoreboard?category=${c}`}
              className={`inline-flex min-h-touch items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                activeCategory === c ? "bg-navy-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
              }`}
              aria-current={activeCategory === c ? "page" : undefined}
            >
              {c}
              {catMissing > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-2xs font-bold text-white">
                  {catMissing}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="space-y-4">
        {visible.length === 0 && (
          <Card title={activeCategory}>
            <p className="text-sm text-slate-500">No KPIs defined in this category.</p>
          </Card>
        )}
        {visible.map((kpi) => {
          const current = entryFor(kpi.id, week);
          const prior = entryFor(kpi.id, isoAddDays(week, -7));
          const status = current && current.value !== null ? current.status : "missing";
          const history = entries
            .filter((e) => e.kpi_id === kpi.id)
            .sort((a, b) => a.period_start.localeCompare(b.period_start))
            .slice(-12)
            .map((e) => ({ period: e.period_start, value: e.value }));
          const delta =
            current?.value !== null && current?.value !== undefined && prior?.value !== null && prior?.value !== undefined
              ? current.value - prior.value
              : null;

          return (
            <Card key={kpi.id} className={status === "missing" || status === "red" ? "border-red-200" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-navy-700">{kpi.name}</h2>
                    <StatusPill status={status} label={status === "missing" ? "MISSING" : undefined} />
                    {current?.status_override_note && (
                      <span className="text-2xs text-amber-700" title={current.status_override_note}>overridden</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{kpi.description}</p>
                  {current?.narrative && <p className="mt-1.5 text-xs italic text-slate-600">&ldquo;{current.narrative}&rdquo;</p>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className={`text-2xl font-black tabular-nums ${status === "missing" ? "text-red-700" : "text-navy-700"}`}>
                      {current?.value !== null && current?.value !== undefined ? formatNumber(current.value, kpi.unit) : "MISSING"}
                    </p>
                    <p className="text-2xs text-slate-400">
                      target {formatNumber(kpi.target_value, kpi.unit)}
                      {delta !== null && (
                        <span className={`ml-1 font-bold ${delta === 0 ? "text-slate-400" : (delta > 0) === (kpi.direction !== "lower_is_better") ? "text-green-700" : "text-red-700"}`}>
                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "＝"} {Math.abs(delta)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <OwnerChip profile={kpi.owner} />
                    <KpiEntryButton
                      kpi={kpi}
                      entry={current}
                      periodStart={week}
                      canEnter={ctx.isAdmin || kpi.owner_id === ctx.userId}
                      isAdmin={ctx.isAdmin}
                    />
                  </div>
                </div>
              </div>
              {history.some((h) => h.value !== null) && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <KpiHistoryChart points={history} target={kpi.target_value} unit={kpi.unit} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
