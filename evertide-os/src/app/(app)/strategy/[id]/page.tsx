import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { GoalProgressForm } from "@/components/strategy/goal-forms";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Goal } from "@/lib/types";

export const dynamic = "force-dynamic";

// Goal detail (§7.3): linked projects/KPIs/milestones + activity history.
export default async function GoalDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("goals")
    .select("*, owner:profiles!goals_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) notFound();
  const goal = data as unknown as Goal;

  const [linksQ, childrenQ, auditQ] = await Promise.all([
    supabase.from("goal_links").select("id,linked_type,linked_id").eq("goal_id", goal.id),
    supabase.from("goals").select("id,title,status,progress_percent").eq("parent_goal_id", goal.id).is("archived_at", null),
    ctx.isAdmin
      ? supabase
          .from("audit_events")
          .select("id,event_type,occurred_at,actor_id")
          .eq("entity_type", "goals")
          .eq("entity_id", goal.id)
          .order("occurred_at", { ascending: false })
          .limit(25)
      : Promise.resolve({ data: [] }),
  ]);

  const links = linksQ.data ?? [];
  const projectIds = links.filter((l) => l.linked_type === "project").map((l) => l.linked_id);
  const kpiIds = links.filter((l) => l.linked_type === "kpi").map((l) => l.linked_id);
  const milestoneIds = links.filter((l) => l.linked_type === "milestone").map((l) => l.linked_id);

  const [projectsQ, kpisQ, milestonesQ, sameSiteProjectsQ] = await Promise.all([
    projectIds.length ? supabase.from("projects").select("id,name,status,percent_done").in("id", projectIds) : Promise.resolve({ data: [] }),
    kpiIds.length ? supabase.from("kpis").select("id,name,category").in("id", kpiIds) : Promise.resolve({ data: [] }),
    milestoneIds.length ? supabase.from("milestones").select("id,title,status,target_date").in("id", milestoneIds) : Promise.resolve({ data: [] }),
    supabase.from("projects").select("id,name,status,percent_done").eq("goal_id", goal.id).is("archived_at", null),
  ]);

  const projects = [...(projectsQ.data ?? []), ...(sameSiteProjectsQ.data ?? [])].filter(
    (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i
  );

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="no-print mb-2 text-xs text-slate-400">
        <Link href="/strategy" className="hover:underline">Strategy</Link> / Goal
      </nav>
      <PageHeader
        title={goal.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-2xs font-bold uppercase tracking-wide text-slate-400">{goal.goal_type}</span>
            <StatusPill status={goal.status} />
            <OwnerChip profile={goal.owner} />
            {goal.due_date && <span className="text-xs text-slate-500">due {formatDate(goal.due_date)}</span>}
          </span>
        }
      />

      <div className="space-y-4">
        {(goal.description || goal.success_criteria) && (
          <Card title="Definition">
            {goal.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{goal.description}</p>}
            {goal.success_criteria && (
              <div className="mt-2">
                <p className="text-2xs font-bold uppercase tracking-wide text-slate-400">Success criteria</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{goal.success_criteria}</p>
              </div>
            )}
          </Card>
        )}

        <Card title="Progress">
          <GoalProgressForm goal={goal} canWrite={ctx.canWrite} />
        </Card>

        {(childrenQ.data ?? []).length > 0 && (
          <Card title="Child goals">
            <ul className="space-y-1.5">
              {(childrenQ.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <Link href={`/strategy/${c.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{c.title}</Link>
                  <StatusPill status={c.status} />
                  <span className="text-xs tabular-nums text-slate-500">{c.progress_percent}%</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Linked execution">
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wide text-slate-400">Projects</p>
              {projects.length === 0 ? (
                <p className="mt-0.5 text-xs text-slate-400">None linked.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {projects.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <Link href={`/projects?project=${p.id}`} className="min-w-0 flex-1 truncate hover:underline">{p.name}</Link>
                      <StatusPill status={p.status} />
                      <span className="text-xs tabular-nums text-slate-500">{p.percent_done}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-2xs font-bold uppercase tracking-wide text-slate-400">KPIs</p>
              {(kpisQ.data ?? []).length === 0 ? (
                <p className="mt-0.5 text-xs text-slate-400">None linked.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {(kpisQ.data ?? []).map((k) => (
                    <li key={k.id}>
                      <Link href="/scoreboard" className="hover:underline">{k.name}</Link>
                      <span className="ml-1 text-2xs text-slate-400">({k.category})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-2xs font-bold uppercase tracking-wide text-slate-400">Milestones</p>
              {(milestonesQ.data ?? []).length === 0 ? (
                <p className="mt-0.5 text-xs text-slate-400">None linked.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {(milestonesQ.data ?? []).map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      <StatusPill status={m.status} />
                      <span className="text-xs text-slate-500">{formatDate(m.target_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        {ctx.isAdmin && (auditQ.data ?? []).length > 0 && (
          <Card title="Activity history">
            <ul className="space-y-1 text-xs text-slate-500">
              {(auditQ.data ?? []).map((a) => (
                <li key={a.id}>
                  {a.event_type} · {formatDateTime(a.occurred_at, ctx.site.timezone)}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
