import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { IssueCommentForm, IssueEditForm } from "@/components/issues/issue-forms";
import { formatDate, formatDateTime } from "@/lib/format";
import { todayInTz, daysBetween } from "@/lib/logic/dates";
import type { Issue, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function IssueDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const today = todayInTz(ctx.site.timezone);

  const { data } = await supabase
    .from("issues")
    .select("*, owner:profiles!issues_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) notFound();
  const issue = data as unknown as Issue;

  const [updatesQ, profilesQ, relatedQ, taskQ] = await Promise.all([
    supabase
      .from("issue_updates")
      .select("*, author:profiles!issue_updates_author_id_fkey(id,name,avatar_color)")
      .eq("issue_id", issue.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
    issue.related_issue_id
      ? supabase.from("issues").select("id,title,status").eq("id", issue.related_issue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    (data as { task_id: string | null }).task_id
      ? supabase.from("tasks").select("id,title").eq("id", (data as { task_id: string }).task_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const open = issue.status !== "resolved" && issue.status !== "closed";
  const age = daysBetween(issue.reported_at.slice(0, 10), today);

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="no-print mb-2 text-xs text-slate-400">
        <Link href="/issues" className="hover:underline">Issues</Link> / Detail
      </nav>
      <PageHeader
        title={issue.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={issue.priority} />
            <StatusPill status={issue.status} />
            {issue.huddle_required && open && <StatusPill status="at_risk" label="📣 Next huddle" />}
            <span className="text-xs text-slate-500">
              reported {formatDate(issue.reported_at.slice(0, 10))} · age {age}d
              {open && issue.due_date && issue.due_date < today && (
                <strong className="text-red-700"> · {daysBetween(issue.due_date, today)}d past due</strong>
              )}
            </span>
          </span>
        }
      />

      <div className="space-y-4">
        {issue.description && (
          <Card title="Description">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{issue.description}</p>
          </Card>
        )}

        <Card title="Ownership & resolution">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">Owner: <OwnerChip profile={issue.owner} /></span>
            {relatedQ.data && (
              <span>
                Recurring of:{" "}
                <Link href={`/issues/${(relatedQ.data as { id: string }).id}`} className="text-navy-600 hover:underline">
                  {(relatedQ.data as { title: string }).title}
                </Link>
              </span>
            )}
            {taskQ.data && (
              <span>
                Task:{" "}
                <Link href={`/projects/tasks/${(taskQ.data as { id: string }).id}`} className="text-navy-600 hover:underline">
                  {(taskQ.data as { title: string }).title}
                </Link>
              </span>
            )}
            {issue.resolved_at && <span>resolved {formatDateTime(issue.resolved_at, ctx.site.timezone)}</span>}
          </div>
          <IssueEditForm issue={issue} profiles={profilesQ.data as Profile[]} canWrite={ctx.canWrite} />
        </Card>

        <Card title={`Updates (${(updatesQ.data ?? []).length})`}>
          {ctx.canWrite && (
            <div className="mb-4">
              <IssueCommentForm issueId={issue.id} />
            </div>
          )}
          <ol className="space-y-3">
            {(updatesQ.data ?? []).map((u) => {
              const author = u.author as unknown as Profile | null;
              return (
                <li key={u.id} className="flex gap-2.5 border-b border-slate-50 pb-3 last:border-0">
                  <OwnerChip profile={author ?? { name: "System", avatar_color: "#94a3b8" }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-800">{u.body}</p>
                    <p className="mt-0.5 text-2xs text-slate-400">{formatDateTime(u.created_at, ctx.site.timezone)}</p>
                  </div>
                </li>
              );
            })}
            {(updatesQ.data ?? []).length === 0 && <p className="text-xs text-slate-400">No updates yet.</p>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
