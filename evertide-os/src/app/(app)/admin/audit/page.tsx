import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { SimpleFilters } from "@/components/simple-filters";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const ENTITY_OPTIONS = [
  "tasks", "projects", "goals", "milestones", "issues", "risks", "decisions", "kpis",
  "kpi_entries", "huddles", "huddle_commitments", "documents", "people", "vendors",
  "reports", "sites", "organization_memberships", "site_memberships", "cron",
];

// Audit event viewer (§7.14) — admins only (enforced by RLS too). Paginated.
export default async function AdminAuditPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const s = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  const pageSize = 50;

  let query = supabase
    .from("audit_events")
    .select("id, entity_type, entity_id, event_type, occurred_at, actor_id, old_values, new_values, metadata", { count: "exact" })
    .eq("organization_id", ctx.organization.id)
    .order("occurred_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (s("entity")) query = query.eq("entity_type", s("entity")!);
  if (s("event")) query = query.eq("event_type", s("event")!);

  const { data, count } = await query;
  const { data: profiles } = await supabase.from("profiles").select("id,name");
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.name]));
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader title="Admin — Audit log" subtitle={`${count ?? 0} events · append-only, immutable`} />
      <SimpleFilters
        selects={[
          { key: "entity", label: "Any entity", options: ENTITY_OPTIONS.map((e) => ({ value: e, label: e })) },
          {
            key: "event", label: "Any event",
            options: ["created", "updated", "archived", "restored", "status_override", "admin_correction", "run"].map((e) => ({ value: e, label: e })),
          },
        ]}
      />
      <Card>
        <ul className="divide-y divide-slate-100">
          {(data ?? []).map((e) => (
            <li key={e.id} className="py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-navy-700">{e.entity_type}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-semibold text-slate-600">{e.event_type}</span>
                <span className="text-slate-400">{e.actor_id ? nameOf.get(e.actor_id) ?? "unknown user" : "system"}</span>
                <span className="ml-auto text-2xs text-slate-400">{formatDateTime(e.occurred_at, ctx.site.timezone)}</span>
              </div>
              {(e.old_values || e.new_values || e.metadata) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-2xs text-teal-600">details</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-2xs text-slate-600">
                    {JSON.stringify({ old: e.old_values, new: e.new_values, metadata: e.metadata }, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
          {(data ?? []).length === 0 && <li className="py-4 text-sm text-slate-500">No events match.</li>}
        </ul>
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
            {page > 1 ? (
              <a className="btn-secondary !min-h-9 !px-3 !py-1" href={`/admin/audit?page=${page - 1}${s("entity") ? `&entity=${s("entity")}` : ""}`}>← Newer</a>
            ) : <span />}
            <span className="text-slate-400">Page {page} of {totalPages}</span>
            {page < totalPages ? (
              <a className="btn-secondary !min-h-9 !px-3 !py-1" href={`/admin/audit?page=${page + 1}${s("entity") ? `&entity=${s("entity")}` : ""}`}>Older →</a>
            ) : <span />}
          </div>
        )}
      </Card>
    </div>
  );
}
