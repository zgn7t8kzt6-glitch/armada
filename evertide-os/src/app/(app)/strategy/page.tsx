import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { NewGoalButton } from "@/components/strategy/goal-forms";
import { formatDate } from "@/lib/format";
import type { Goal, Profile } from "@/lib/types";

export const metadata = { title: "Strategy" };
export const dynamic = "force-dynamic";

// Strategy (§7.3): annual/quarterly goal hierarchy with progress and RAG.
export default async function StrategyPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const [goalsQ, profilesQ] = await Promise.all([
    supabase
      .from("goals")
      .select("*, owner:profiles!goals_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("goal_type")
      .order("due_date"),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
  ]);
  const goals = (goalsQ.data ?? []) as unknown as Goal[];
  const profiles = (profilesQ.data ?? []) as Profile[];
  const topLevel = goals.filter((g) => !g.parent_goal_id);
  const childrenOf = (id: string) => goals.filter((g) => g.parent_goal_id === id);

  return (
    <div>
      <PageHeader
        title="Strategy"
        subtitle="Annual and quarterly goals — every one owned, measured, and linked to execution."
        action={ctx.canWrite ? <NewGoalButton profiles={profiles} goals={goals} defaultOwnerId={ctx.userId} /> : undefined}
      />

      {topLevel.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No goals yet.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {topLevel.map((goal) => (
            <Card key={goal.id}>
              <GoalRow goal={goal} depth={0} />
              {childrenOf(goal.id).map((child) => (
                <div key={child.id} className="mt-2 border-l-2 border-slate-100 pl-4">
                  <GoalRow goal={child} depth={1} />
                  {childrenOf(child.id).map((gc) => (
                    <div key={gc.id} className="mt-2 border-l-2 border-slate-100 pl-4">
                      <GoalRow goal={gc} depth={2} />
                    </div>
                  ))}
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function GoalRow({ goal, depth }: { goal: Goal; depth: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-2xs font-bold uppercase tracking-wide text-slate-400">{goal.goal_type}</span>
      <Link
        href={`/strategy/${goal.id}`}
        className={`min-w-0 flex-1 basis-64 font-medium text-slate-800 hover:underline ${depth === 0 ? "text-base" : "text-sm"}`}
      >
        {goal.title}
      </Link>
      <StatusPill status={goal.status} />
      <div className="flex w-32 items-center gap-1.5" title={`${goal.progress_percent}%`}>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${goal.status === "at_risk" ? "bg-amber-500" : "bg-teal-500"}`}
            style={{ width: `${goal.progress_percent}%` }}
          />
        </div>
        <span className="text-2xs tabular-nums text-slate-500">{goal.progress_percent}%</span>
      </div>
      <OwnerChip profile={goal.owner} />
      {goal.due_date && <span className="text-xs text-slate-500">{formatDate(goal.due_date)}</span>}
    </div>
  );
}
