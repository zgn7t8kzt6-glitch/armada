import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CarryBadge, DueDate, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { NewHuddleButton } from "@/components/huddles/new-huddle";
import { PlayIcon, TrophyIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";
import { todayInTz } from "@/lib/logic/dates";
import type { Commitment, Huddle, Profile } from "@/lib/types";

export const metadata = { title: "Huddles" };
export const dynamic = "force-dynamic";

// Huddles (§7.6): upcoming/past huddles and the open commitment board.
export default async function HuddlesPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const today = todayInTz(ctx.site.timezone);

  const [huddlesQ, commitmentsQ, profilesQ] = await Promise.all([
    supabase
      .from("huddles")
      .select("*")
      .eq("site_id", ctx.site.id)
      .is("archived_at", null)
      .order("huddle_date", { ascending: false })
      .limit(30),
    supabase
      .from("huddle_commitments")
      .select("*, owner:profiles!huddle_commitments_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", ctx.site.id)
      .eq("status", "open")
      .is("archived_at", null)
      .order("due_date"),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
  ]);

  const huddles = (huddlesQ.data ?? []) as unknown as Huddle[];
  const commitments = (commitmentsQ.data ?? []) as unknown as Commitment[];
  const profiles = (profilesQ.data ?? []) as unknown as Profile[];
  const active = huddles.find((h) => h.status === "in_progress");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Huddles"
        subtitle="The weekly leadership huddle: scorecard, exceptions, commitments. Every Tuesday."
        action={ctx.canWrite ? <NewHuddleButton siteId={ctx.site.id} profiles={profiles} defaultDate={today} /> : undefined}
      />

      {active && (
        <Link href={`/huddles/${active.id}`} className="flex items-center gap-2 rounded-lg border-2 border-teal-400 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-800 hover:bg-teal-100">
          <PlayIcon className="h-4 w-4" /> A huddle is in progress ({formatDate(active.huddle_date)}) — tap to join Huddle Mode
        </Link>
      )}

      <Card title={`Open commitments (${commitments.length})`}>
        {commitments.length === 0 ? (
          <p className="text-sm text-slate-500">No open commitments. Make them in the next huddle.</p>
        ) : (
          <ul className="space-y-2">
            {commitments.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 font-medium text-slate-800">{c.commitment}</span>
                <CarryBadge count={c.carry_count} />
                <OwnerChip profile={c.owner} />
                <DueDate date={c.due_date} overdue={c.due_date < today} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Huddle history">
        {huddles.length === 0 ? (
          <p className="text-sm text-slate-500">No huddles yet. Create the first one for Tuesday.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {huddles.map((h) => (
              <li key={h.id}>
                <Link href={`/huddles/${h.id}`} className="flex min-h-touch flex-wrap items-center gap-2 py-2.5 hover:bg-slate-50">
                  <span className="w-28 text-sm font-semibold tabular-nums text-navy-700">{formatDate(h.huddle_date)}</span>
                  <StatusPill status={h.status} />
                  {h.wins && <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-slate-500"><TrophyIcon className="h-3.5 w-3.5 shrink-0" /> {h.wins}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
