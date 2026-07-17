import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchSiteProfiles } from "@/lib/queries/tasks";
import { Card, DueDate, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { TaskStatusControl } from "@/components/tasks/status-control";
import {
  AdminReassign, CommentForm, DependencyEditor, HelperEditor, ProgressAndNotes,
} from "@/components/tasks/detail-forms";
import { formatDate, formatDateTime, statusLabel } from "@/lib/format";
import { isOverdue, isStale } from "@/lib/logic/tasks";
import type { Profile, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

// Task detail (§7.4): metadata, percent slider, notes, helpers, dependencies,
// related objects, documents, and the append-only update feed.
export default async function TaskDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data: task } = await supabase
    .from("tasks")
    .select("*, owner:profiles!tasks_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("id", params.id)
    .maybeSingle();
  if (!task) notFound();
  const t = task as unknown as Task;

  const [updatesQ, helpersQ, depsPredQ, depsSuccQ, allTasksQ, profilesQ, issuesQ, docLinksQ, projectQ, milestoneQ] =
    await Promise.all([
      supabase
        .from("task_updates")
        .select("*, author:profiles!task_updates_author_id_fkey(id,name,avatar_color)")
        .eq("task_id", t.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("task_helpers").select("user_id, profile:profiles!task_helpers_user_id_fkey(id,name,email,title,avatar_color)").eq("task_id", t.id),
      supabase
        .from("task_dependencies")
        .select("id, dependency_type, predecessor:tasks!task_dependencies_predecessor_task_id_fkey(id,title,status)")
        .eq("successor_task_id", t.id),
      supabase
        .from("task_dependencies")
        .select("id, dependency_type, successor:tasks!task_dependencies_successor_task_id_fkey(id,title,status)")
        .eq("predecessor_task_id", t.id),
      supabase.from("tasks").select("id,title").eq("site_id", ctx.site.id).is("archived_at", null).order("sort_order").limit(500),
      fetchSiteProfiles(supabase, ctx.site.id),
      supabase.from("issues").select("id,title,status,priority").eq("task_id", t.id).limit(20),
      supabase
        .from("document_links")
        .select("document:documents!document_links_document_id_fkey(id,title,status)")
        .eq("linked_type", "task")
        .eq("linked_id", t.id),
      t.project_id ? supabase.from("projects").select("id,name").eq("id", t.project_id).maybeSingle() : Promise.resolve({ data: null }),
      t.milestone_id ? supabase.from("milestones").select("id,title,target_date").eq("id", t.milestone_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

  const updates = updatesQ.data ?? [];
  const helpers = (helpersQ.data ?? []).map((h) => h.profile as unknown as Profile).filter(Boolean);
  const dependencies = [
    ...(depsPredQ.data ?? []).map((d) => ({
      id: d.id as string,
      direction: "predecessor" as const,
      dependency_type: d.dependency_type as string,
      other: d.predecessor as unknown as { id: string; title: string; status: string },
    })),
    ...(depsSuccQ.data ?? []).map((d) => ({
      id: d.id as string,
      direction: "successor" as const,
      dependency_type: d.dependency_type as string,
      other: d.successor as unknown as { id: string; title: string; status: string },
    })),
  ].filter((d) => d.other);
  const overdue = isOverdue(t, ctx.site.timezone);
  const stale = isStale(t);

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="no-print mb-2 text-xs text-slate-400">
        <Link href="/projects" className="hover:underline">Projects</Link> / Task
        {t.legacy_id ? ` #${t.legacy_id}` : ""}
      </nav>
      <PageHeader
        title={t.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={t.status} />
            {overdue && <StatusPill status="missed" label="Overdue" />}
            {stale && <StatusPill status="at_risk" label="Stale" />}
            {t.critical && <StatusPill status="critical" label="Critical path" />}
            <StatusPill status={t.priority} label={`Priority: ${statusLabel(t.priority)}`} />
            {t.archived_at && <StatusPill status="cancelled" label="Archived" />}
          </span>
        }
        action={ctx.canWrite ? <TaskStatusControl taskId={t.id} status={t.status} /> : undefined}
      />

      {t.status === "blocked" && t.blocker_reason && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <span className="font-bold">Blocked:</span> {t.blocker_reason}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Progress">
            <ProgressAndNotes task={t} canWrite={ctx.canWrite} />
          </Card>

          <Card title={`Activity (${updates.length})`}>
            {ctx.canWrite && (
              <div className="mb-4">
                <CommentForm taskId={t.id} />
              </div>
            )}
            <ol className="space-y-3">
              {updates.length === 0 && <p className="text-xs text-slate-400">No activity yet.</p>}
              {updates.map((u) => {
                const author = u.author as unknown as Profile | null;
                return (
                  <li key={u.id} className="flex gap-2.5 border-b border-slate-50 pb-3 last:border-0 last:pb-0">
                    <div className="mt-0.5 shrink-0">
                      <OwnerChip profile={author ?? { name: "System", avatar_color: "#94a3b8" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs ${u.update_type === "comment" ? "text-slate-800" : "text-slate-500"}`}>{u.body}</p>
                      <p className="mt-0.5 text-2xs text-slate-400">
                        {statusLabel(u.update_type)} · {formatDateTime(u.created_at, ctx.site.timezone)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <dl className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="font-semibold text-slate-500">Owner</dt>
                <dd><OwnerChip profile={t.owner} /></dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-semibold text-slate-500">Start</dt>
                <dd>{formatDate(t.start_date)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-semibold text-slate-500">Due</dt>
                <dd><DueDate date={t.due_date} overdue={overdue} /></dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-semibold text-slate-500">Phase</dt>
                <dd className="text-right">{t.phase ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-semibold text-slate-500">Workstream</dt>
                <dd className="text-right">{t.workstream ?? "—"}</dd>
              </div>
              {projectQ.data && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-semibold text-slate-500">Project</dt>
                  <dd className="text-right">{(projectQ.data as { name: string }).name}</dd>
                </div>
              )}
              {milestoneQ.data && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-semibold text-slate-500">Milestone</dt>
                  <dd className="text-right">{(milestoneQ.data as { title: string }).title}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <dt className="font-semibold text-slate-500">Last meaningful update</dt>
                <dd>{formatDateTime(t.last_meaningful_update_at, ctx.site.timezone)}</dd>
              </div>
            </dl>
            {ctx.isAdmin && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <AdminReassign task={t} profiles={profilesQ} />
              </div>
            )}
          </Card>

          <Card title="Helpers">
            <HelperEditor task={t} helpers={helpers} profiles={profilesQ} canWrite={ctx.canWrite} />
          </Card>

          <Card title="Dependencies">
            <DependencyEditor
              task={t}
              dependencies={dependencies}
              allTasks={(allTasksQ.data ?? []) as Array<{ id: string; title: string }>}
              canWrite={ctx.canWrite}
            />
          </Card>

          <Card title="Related">
            <ul className="space-y-1.5 text-xs">
              {(issuesQ.data ?? []).map((i) => (
                <li key={i.id}>
                  <Link href={`/issues/${i.id}`} className="text-navy-600 hover:underline">
                    ⚠️ {i.title}
                  </Link>{" "}
                  <StatusPill status={i.status} />
                </li>
              ))}
              {(docLinksQ.data ?? []).map((l) => {
                const doc = l.document as unknown as { id: string; title: string } | null;
                return doc ? (
                  <li key={doc.id}>
                    <Link href={`/documents/${doc.id}`} className="text-navy-600 hover:underline">📄 {doc.title}</Link>
                  </li>
                ) : null;
              })}
              {(issuesQ.data ?? []).length === 0 && (docLinksQ.data ?? []).length === 0 && (
                <li className="text-slate-400">No linked objects.</li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
