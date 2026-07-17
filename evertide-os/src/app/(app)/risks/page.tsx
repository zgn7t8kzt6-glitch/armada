import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, DueDate, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { SimpleFilters } from "@/components/simple-filters";
import { NewRiskButton } from "@/components/risks/risk-forms";
import { todayInTz } from "@/lib/logic/dates";
import { isHighRisk } from "@/lib/logic/risk";
import type { Profile, Risk, RiskImpact, RiskProbability } from "@/lib/types";

export const metadata = { title: "Risks" };
export const dynamic = "force-dynamic";

const PROBS: RiskProbability[] = ["high", "medium", "low"];
const IMPACTS: RiskImpact[] = ["low", "medium", "high", "severe"];

// Risk register + heat map (§7.8).
export default async function RisksPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const today = todayInTz(ctx.site.timezone);
  const s = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  let query = supabase
    .from("risks")
    .select("*, owner:profiles!risks_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("site_id", ctx.site.id)
    .order("score", { ascending: false })
    .limit(500);
  query = s("archived") === "1" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (s("owner")) query = query.eq("owner_id", s("owner")!);
  if (s("status")) query = query.eq("status", s("status")!);

  const { data } = await query;
  let risks = (data ?? []) as unknown as Risk[];
  if (s("filter") === "opening") {
    risks = risks.filter((r) => isHighRisk(r.score) && r.status !== "closed");
  }

  const { data: profilesData } = await supabase.from("profiles").select("id,name,email,title,avatar_color").order("name");
  const profiles = (profilesData ?? []) as Profile[];
  const openRisks = risks.filter((r) => r.status === "open" || r.status === "monitoring" || r.status === "mitigating");

  return (
    <div>
      <PageHeader
        title="Risks"
        subtitle={`${openRisks.length} open · ${openRisks.filter((r) => isHighRisk(r.score)).length} high/severe`}
        action={ctx.canWrite ? <NewRiskButton siteId={ctx.site.id} profiles={profiles} defaultOwnerId={ctx.userId} /> : undefined}
      />

      {/* Heat map */}
      <Card title="Heat map (open risks)" className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-center text-xs">
            <thead>
              <tr>
                <th className="w-24 text-left text-2xs font-semibold text-slate-400">Probability ↓ / Impact →</th>
                {IMPACTS.map((i) => (
                  <th key={i} className="text-2xs font-semibold capitalize text-slate-500">{i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PROBS.map((p) => (
                <tr key={p}>
                  <td className="text-left text-2xs font-semibold capitalize text-slate-500">{p}</td>
                  {IMPACTS.map((i) => {
                    const cell = openRisks.filter((r) => r.probability === p && r.impact === i);
                    const score = { low: 1, medium: 2, high: 3 }[p] * { low: 1, medium: 2, high: 3, severe: 4 }[i];
                    const bg = score >= 6 ? "bg-red-100 ring-red-200" : score >= 3 ? "bg-amber-100 ring-amber-200" : "bg-green-50 ring-green-100";
                    return (
                      <td key={i} className={`rounded-lg px-2 py-3 ring-1 ring-inset ${bg}`}>
                        {cell.length > 0 ? (
                          <span className="text-base font-black tabular-nums text-navy-700" title={cell.map((r) => r.title).join("\n")}>
                            {cell.length}
                          </span>
                        ) : (
                          <span className="text-slate-300">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <SimpleFilters
        selects={[
          { key: "owner", label: "All owners", options: profiles.map((p) => ({ value: p.id, label: p.name })) },
          {
            key: "status", label: "Any status",
            options: ["open", "monitoring", "mitigating", "closed", "occurred"].map((v) => ({ value: v, label: v })),
          },
          { key: "archived", label: "Active", options: [{ value: "1", label: "Archived" }] },
        ]}
      />

      <Card>
        {risks.length === 0 ? (
          <p className="text-sm text-slate-500">No risks registered. That itself is a risk — add the ones you&apos;re carrying.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {risks.map((r) => (
              <li key={r.id}>
                <Link href={`/risks/${r.id}`} className="flex min-h-touch flex-wrap items-center gap-2 py-2.5 hover:bg-slate-50">
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black tabular-nums ${
                      isHighRisk(r.score) ? "bg-red-100 text-red-800" : r.score >= 3 ? "bg-amber-100 text-amber-800" : "bg-green-50 text-green-800"
                    }`}
                    title={`Score ${r.score}/12`}
                  >
                    {r.score}
                  </span>
                  <span className="min-w-0 flex-1 basis-64 text-sm font-medium text-slate-800">
                    {r.title}
                    <span className="ml-2 text-2xs text-slate-400 capitalize">{r.probability} × {r.impact}</span>
                  </span>
                  <StatusPill status={r.status} />
                  {r.disposition && <StatusPill status={r.disposition === "occurred" ? "occurred" : "done"} label={r.disposition} />}
                  <OwnerChip profile={r.owner} />
                  {r.review_date && <DueDate date={r.review_date} overdue={r.review_date < today && r.status !== "closed"} />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
