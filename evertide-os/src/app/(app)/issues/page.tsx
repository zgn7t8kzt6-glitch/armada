import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, DueDate, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { SimpleFilters } from "@/components/simple-filters";
import { NewIssueButton } from "@/components/issues/issue-forms";
import { todayInTz, daysBetween } from "@/lib/logic/dates";
import type { Issue, Profile } from "@/lib/types";

export const metadata = { title: "Issues" };
export const dynamic = "force-dynamic";

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 } as const;

// Defect log (§7.7): high/critical and overdue first, filters, age tracking.
export default async function IssuesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const today = todayInTz(ctx.site.timezone);
  const s = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  let query = supabase
    .from("issues")
    .select("*, owner:profiles!issues_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("site_id", ctx.site.id)
    .order("reported_at", { ascending: false })
    .limit(500);
  query = s("archived") === "1" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (s("owner")) query = query.eq("owner_id", s("owner")!);
  if (s("status")) query = query.eq("status", s("status")!);
  if (s("priority")) query = query.eq("priority", s("priority")!);
  if (s("category")) query = query.eq("category", s("category")!);
  if (s("q")) {
    const safe = s("q")!.replace(/[%_,()]/g, " ").trim();
    if (safe) query = query.ilike("title", `%${safe}%`);
  }

  const { data } = await query;
  const issues = ((data ?? []) as unknown as Issue[]).sort((a, b) => {
    const openA = a.status !== "resolved" && a.status !== "closed" ? 0 : 1;
    const openB = b.status !== "resolved" && b.status !== "closed" ? 0 : 1;
    if (openA !== openB) return openA - openB;
    const overdueA = a.due_date && a.due_date < today && openA === 0 ? 0 : 1;
    const overdueB = b.due_date && b.due_date < today && openB === 0 ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });

  const { data: profilesData } = await supabase.from("profiles").select("id,name,email,title,avatar_color").order("name");
  const profiles = (profilesData ?? []) as Profile[];
  const categories = [...new Set(issues.map((i) => i.category).filter((c): c is string => !!c))];
  const openCount = issues.filter((i) => i.status !== "resolved" && i.status !== "closed").length;

  return (
    <div>
      <PageHeader
        title="Issues"
        subtitle={`Defect log — surfaced, owned, corrected, reviewed. ${openCount} open.`}
        action={ctx.canWrite ? <NewIssueButton siteId={ctx.site.id} profiles={profiles} defaultOwnerId={ctx.userId} /> : undefined}
      />

      <SimpleFilters
        searchKey="q"
        selects={[
          { key: "owner", label: "All owners", options: profiles.map((p) => ({ value: p.id, label: p.name })) },
          {
            key: "status", label: "Any status",
            options: ["open", "investigating", "action_planned", "resolved", "closed"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
          },
          {
            key: "priority", label: "Any priority",
            options: ["critical", "high", "normal", "low"].map((v) => ({ value: v, label: v })),
          },
          { key: "category", label: "Any category", options: categories.map((c) => ({ value: c, label: c })) },
          { key: "archived", label: "Active", options: [{ value: "1", label: "Archived" }] },
        ]}
      />

      <Card>
        {issues.length === 0 ? (
          <p className="text-sm text-slate-500">No issues match. A quiet defect log is a good defect log — if it&apos;s honest.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {issues.map((i) => {
              const open = i.status !== "resolved" && i.status !== "closed";
              const age = daysBetween(i.reported_at.slice(0, 10), today);
              const overdue = open && !!i.due_date && i.due_date < today;
              return (
                <li key={i.id}>
                  <Link href={`/issues/${i.id}`} className="flex min-h-touch flex-wrap items-center gap-2 py-2.5 hover:bg-slate-50">
                    <span className="min-w-0 flex-1 basis-64 text-sm font-medium text-slate-800">
                      {i.title}
                      <span className="ml-2 text-2xs text-slate-400">
                        {i.category && `${i.category} · `}age {age}d
                        {overdue && i.due_date && ` · ${daysBetween(i.due_date, today)}d past due`}
                        {i.huddle_required && open && " · next huddle"}
                        {i.related_issue_id && " · recurring"}
                      </span>
                    </span>
                    <StatusPill status={i.priority} />
                    <StatusPill status={i.status} />
                    <OwnerChip profile={i.owner} />
                    {i.due_date && <DueDate date={i.due_date} overdue={overdue} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
