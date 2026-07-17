import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { DecisionActions } from "@/components/decisions/decision-forms";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Decision, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DecisionDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("decisions")
    .select("*, owner:profiles!decisions_owner_id_fkey(id,name,email,title,avatar_color), approver:profiles!decisions_approved_by_id_fkey(id,name,avatar_color)")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) notFound();
  const decision = data as unknown as Decision & { approver: Profile | null };

  const [profilesQ, supersededByQ, supersedesQ, linksQ] = await Promise.all([
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
    supabase.from("decisions").select("id,title,status").eq("supersedes_decision_id", decision.id).maybeSingle(),
    decision.supersedes_decision_id
      ? supabase.from("decisions").select("id,title,status").eq("id", decision.supersedes_decision_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("decision_links").select("id,linked_type,linked_id").eq("decision_id", decision.id),
  ]);

  const fields: Array<{ label: string; value: string | null }> = [
    { label: "Context", value: decision.context },
    { label: "Decision", value: decision.decision_text },
    { label: "Rationale", value: decision.rationale },
    { label: "Alternatives considered", value: decision.alternatives_considered },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="no-print mb-2 text-xs text-slate-400">
        <Link href="/decisions" className="hover:underline">Decisions</Link> / Detail
      </nav>
      <PageHeader
        title={decision.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={decision.status} />
            <span className="text-xs text-slate-500">decided {formatDate(decision.decision_date)}</span>
            {decision.effective_date && <span className="text-xs text-slate-500">effective {formatDate(decision.effective_date)}</span>}
            <OwnerChip profile={decision.owner} />
            {decision.approver && <span className="text-xs text-slate-500">approved by {decision.approver.name}</span>}
          </span>
        }
      />

      {supersededByQ.data && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Superseded by{" "}
          <Link href={`/decisions/${(supersededByQ.data as { id: string }).id}`} className="font-bold hover:underline">
            {(supersededByQ.data as { title: string }).title}
          </Link>
        </div>
      )}
      {supersedesQ.data && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Supersedes{" "}
          <Link href={`/decisions/${(supersedesQ.data as { id: string }).id}`} className="font-bold hover:underline">
            {(supersedesQ.data as { title: string }).title}
          </Link>
        </div>
      )}

      <div className="space-y-4">
        <Card title="Record">
          <dl className="space-y-3">
            {fields.map((f) => (
              <div key={f.label}>
                <dt className="text-2xs font-bold uppercase tracking-wide text-slate-400">{f.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{f.value || "—"}</dd>
              </div>
            ))}
            {decision.outcome && (
              <div>
                <dt className="text-2xs font-bold uppercase tracking-wide text-slate-400">Outcome</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                  {decision.outcome}
                  {decision.outcome_recorded_at && (
                    <span className="ml-2 text-2xs text-slate-400">recorded {formatDateTime(decision.outcome_recorded_at, ctx.site.timezone)}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
          {(decision.status === "approved" || decision.status === "implemented") && (
            <p className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-2xs text-teal-800">
              🔒 Approved decision — substance is immutable. It can be superseded, or corrected by an admin with an audited reason.
            </p>
          )}
        </Card>

        {(linksQ.data ?? []).length > 0 && (
          <Card title="Linked objects">
            <ul className="space-y-1 text-xs text-slate-600">
              {(linksQ.data ?? []).map((l) => (
                <li key={l.id}>{l.linked_type}: {l.linked_id}</li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Actions">
          <DecisionActions decision={decision} profiles={profilesQ.data as Profile[]} isAdmin={ctx.isAdmin} canWrite={ctx.canWrite} />
        </Card>
      </div>
    </div>
  );
}
