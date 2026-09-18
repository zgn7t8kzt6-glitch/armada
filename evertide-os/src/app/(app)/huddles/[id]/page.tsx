import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { daysToOpening } from "@/lib/data";
import { HuddleMode } from "@/components/huddles/huddle-mode";
import { PrintButton } from "@/components/print-button";
import { TrophyIcon } from "@/components/icons";
import { StatusPill } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { todayInTz, weeklyPeriodStart } from "@/lib/logic/dates";
import type { AgendaItemSnapshot, Commitment, Huddle, HuddleAgendaItem, Kpi, KpiEntry, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HuddleDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data: huddleData } = await supabase.from("huddles").select("*").eq("id", params.id).maybeSingle();
  if (!huddleData) notFound();
  const huddle = huddleData as unknown as Huddle;
  const week = weeklyPeriodStart(ctx.site.timezone);

  const [agendaQ, priorQ, mineQ, kpisQ, entriesQ, profilesQ] = await Promise.all([
    supabase.from("huddle_agenda_items").select("*").eq("huddle_id", huddle.id).order("sort_order"),
    supabase
      .from("huddle_commitments")
      .select("*, owner:profiles!huddle_commitments_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", ctx.site.id)
      .neq("huddle_id", huddle.id)
      .in("status", ["open"])
      .is("archived_at", null)
      .order("due_date"),
    supabase
      .from("huddle_commitments")
      .select("*, owner:profiles!huddle_commitments_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("huddle_id", huddle.id)
      .is("archived_at", null)
      .order("created_at"),
    supabase
      .from("kpis")
      .select("*")
      .eq("site_id", ctx.site.id)
      .eq("active", true)
      .is("archived_at", null)
      .order("sort_order"),
    supabase.from("kpi_entries").select("*").eq("period_start", week),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
  ]);

  // Completed huddles render the frozen snapshot, not live queries (§6.9).
  if (huddle.status === "completed") {
    const snapshot = (huddle.agenda_snapshot ?? []) as AgendaItemSnapshot[];
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="print-page rounded-xl bg-navy-600 px-5 py-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-black">Huddle — {formatDate(huddle.huddle_date)}</h1>
            <div className="flex items-center gap-2">
              <StatusPill status="completed" />
              <PrintButton />
            </div>
          </div>
          <p className="mt-1 text-xs text-navy-100">Frozen record. This agenda snapshot never changes.</p>
        </div>
        {huddle.wins && (
          <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-navy-700"><TrophyIcon className="h-4 w-4 text-teal-500" /> Wins</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{huddle.wins}</p>
          </section>
        )}
        <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-700">Agenda (as reviewed)</h2>
          <ol className="mt-2 space-y-1.5">
            {snapshot.map((item, i) => (
              <li key={i} className="text-sm text-slate-700">
                <span className="mr-1.5 text-2xs font-bold uppercase tracking-wide text-slate-400">{item.item_type.replace(/_/g, " ")}</span>
                {item.title}
                {item.disposition && <p className="ml-4 text-xs italic text-slate-500">→ {item.disposition}</p>}
              </li>
            ))}
            {snapshot.length === 0 && <li className="text-sm text-slate-400">No agenda items were captured.</li>}
          </ol>
        </section>
        <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-700">Commitments made</h2>
          <ul className="mt-2 space-y-1.5">
            {((mineQ.data ?? []) as unknown as Commitment[]).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span className="min-w-0 flex-1">{c.commitment}</span>
                <span className="text-xs text-slate-500">{c.owner?.name} · due {formatDate(c.due_date)}</span>
                <StatusPill status={c.status} />
              </li>
            ))}
            {(mineQ.data ?? []).length === 0 && <li className="text-sm text-slate-400">None recorded.</li>}
          </ul>
        </section>
        {huddle.notes && (
          <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-navy-700">Notes</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{huddle.notes}</p>
          </section>
        )}
      </div>
    );
  }

  return (
    <HuddleMode
      huddle={huddle}
      agenda={(agendaQ.data ?? []) as unknown as HuddleAgendaItem[]}
      priorCommitments={(priorQ.data ?? []) as unknown as Commitment[]}
      thisHuddleCommitments={(mineQ.data ?? []) as unknown as Commitment[]}
      kpis={(kpisQ.data ?? []) as unknown as Kpi[]}
      entries={(entriesQ.data ?? []) as unknown as KpiEntry[]}
      week={week}
      profiles={(profilesQ.data ?? []) as unknown as Profile[]}
      canWrite={ctx.canWrite}
      daysToOpen={daysToOpening(ctx.site)}
      today={todayInTz(ctx.site.timezone)}
    />
  );
}
