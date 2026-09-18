import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { RiskEditForm } from "@/components/risks/risk-forms";
import { isHighRisk } from "@/lib/logic/risk";
import { formatDate } from "@/lib/format";
import type { Profile, Risk } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RiskDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("risks")
    .select("*, owner:profiles!risks_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) notFound();
  const risk = data as unknown as Risk;

  const [profilesQ, issueQ] = await Promise.all([
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
    risk.converted_issue_id
      ? supabase.from("issues").select("id,title,status").eq("id", risk.converted_issue_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="no-print mb-2 text-xs text-slate-400">
        <Link href="/risks" className="hover:underline">Risks</Link> / Detail
      </nav>
      <PageHeader
        title={risk.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-sm font-black tabular-nums ${isHighRisk(risk.score) ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
              {risk.score}/12
            </span>
            <StatusPill status={risk.status} />
            {risk.disposition && <StatusPill status={risk.disposition === "occurred" ? "occurred" : "done"} label={risk.disposition} />}
            <span className="text-xs capitalize text-slate-500">{risk.probability} probability × {risk.impact} impact</span>
          </span>
        }
      />

      <div className="space-y-4">
        {risk.description && (
          <Card title="Description">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{risk.description}</p>
          </Card>
        )}

        {issueQ.data && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
            This risk occurred and was converted:{" "}
            <Link href={`/issues/${(issueQ.data as { id: string }).id}`} className="font-bold text-red-800 hover:underline">
              {(issueQ.data as { title: string }).title}
            </Link>{" "}
            — the risk record is retained here for history.
          </div>
        )}

        <Card
          title="Assessment & mitigation"
          action={
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <OwnerChip profile={risk.owner} />
              {risk.review_date && <span>review {formatDate(risk.review_date)}</span>}
            </span>
          }
        >
          <RiskEditForm risk={risk} profiles={profilesQ.data as Profile[]} canWrite={ctx.canWrite} />
        </Card>
      </div>
    </div>
  );
}
