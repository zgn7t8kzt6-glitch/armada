import Link from "next/link";
import { Suspense } from "react";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { SimpleFilters } from "@/components/simple-filters";
import { NewDecisionButton } from "@/components/decisions/decision-forms";
import { formatDate } from "@/lib/format";
import { todayInTz } from "@/lib/logic/dates";
import type { Decision, Profile } from "@/lib/types";

export const metadata = { title: "Decisions" };
export const dynamic = "force-dynamic";

// Decision log (§7.9): searchable, chronological, with due-for-review widget.
export default async function DecisionsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const today = todayInTz(ctx.site.timezone);
  const s = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  let query = supabase
    .from("decisions")
    .select("*, owner:profiles!decisions_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("organization_id", ctx.organization.id)
    .is("archived_at", null)
    .order("decision_date", { ascending: false })
    .limit(300);
  if (s("status")) query = query.eq("status", s("status")!);
  if (s("owner")) query = query.eq("owner_id", s("owner")!);
  if (s("q")) {
    const safe = s("q")!.replace(/[%_,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,decision_text.ilike.%${safe}%,rationale.ilike.%${safe}%`);
  }

  const { data } = await query;
  const decisions = (data ?? []) as unknown as Decision[];
  const dueForReview = decisions.filter(
    (d) => (d.status === "approved" || d.status === "implemented") && d.review_date && d.review_date <= today && !d.outcome
  );

  const { data: profilesData } = await supabase.from("profiles").select("id,name,email,title,avatar_color").order("name");
  const profiles = (profilesData ?? []) as Profile[];

  return (
    <div>
      <PageHeader
        title="Decisions"
        subtitle="What was decided, by whom, and why — permanently searchable."
        action={
          ctx.canWrite ? (
            <Suspense>
              <NewDecisionButton profiles={profiles} defaultOwnerId={ctx.userId} />
            </Suspense>
          ) : undefined
        }
      />

      {dueForReview.length > 0 && (
        <Card title={`Decisions due for review (${dueForReview.length})`} className="mb-4 border-amber-300">
          <ul className="space-y-1.5">
            {dueForReview.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/decisions/${d.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{d.title}</Link>
                <span className="text-xs text-amber-700">review was due {formatDate(d.review_date)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SimpleFilters
        searchKey="q"
        selects={[
          {
            key: "status", label: "Any status",
            options: ["proposed", "approved", "implemented", "superseded"].map((v) => ({ value: v, label: v })),
          },
          { key: "owner", label: "All owners", options: profiles.map((p) => ({ value: p.id, label: p.name })) },
        ]}
      />

      <Card>
        {decisions.length === 0 ? (
          <p className="text-sm text-slate-500">No decisions logged yet. If it was decided in a meeting and isn&apos;t here, it wasn&apos;t decided.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {decisions.map((d) => (
              <li key={d.id}>
                <Link href={`/decisions/${d.id}`} className="flex min-h-touch flex-wrap items-center gap-2 py-2.5 hover:bg-slate-50">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">{formatDate(d.decision_date)}</span>
                  <span className="min-w-0 flex-1 basis-64 text-sm font-medium text-slate-800">{d.title}</span>
                  <StatusPill status={d.status} />
                  <OwnerChip profile={d.owner} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
