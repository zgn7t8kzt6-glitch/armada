import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { ArchiveToggleButton } from "@/components/admin/admin-forms";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Archived records" };
export const dynamic = "force-dynamic";

const ENTITIES: Array<{ table: string; label: string; titleCol: string }> = [
  { table: "tasks", label: "Tasks", titleCol: "title" },
  { table: "projects", label: "Projects", titleCol: "name" },
  { table: "goals", label: "Goals", titleCol: "title" },
  { table: "milestones", label: "Milestones", titleCol: "title" },
  { table: "issues", label: "Issues", titleCol: "title" },
  { table: "risks", label: "Risks", titleCol: "title" },
  { table: "decisions", label: "Decisions", titleCol: "title" },
  { table: "documents", label: "Documents", titleCol: "title" },
  { table: "people", label: "People", titleCol: "first_name" },
  { table: "vendors", label: "Vendors", titleCol: "name" },
  { table: "huddle_commitments", label: "Commitments", titleCol: "commitment" },
  { table: "kpis", label: "KPIs", titleCol: "name" },
];

// Archived record browser + restore (§7.14). Nothing is ever hard-deleted.
export default async function AdminArchivePage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const results = await Promise.all(
    ENTITIES.map(async (e) => {
      const { data } = await supabase
        .from(e.table)
        .select(`id, archived_at, ${e.titleCol}`)
        .eq("organization_id", ctx.organization.id)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false })
        .limit(100);
      return { ...e, rows: (data ?? []) as unknown as Array<Record<string, string>> };
    })
  );
  const total = results.reduce((s, r) => s + r.rows.length, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admin — Archived records"
        subtitle={`${total} archived record(s). Business records are archived, never deleted.`}
      />
      {total === 0 && (
        <Card>
          <p className="text-sm text-slate-500">Nothing is archived.</p>
        </Card>
      )}
      {results
        .filter((r) => r.rows.length > 0)
        .map((r) => (
          <Card key={r.table} title={`${r.label} (${r.rows.length})`}>
            <ul className="divide-y divide-slate-100">
              {r.rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 text-slate-700">{row[r.titleCol]}</span>
                  <span className="text-2xs text-slate-400">archived {formatDateTime(row.archived_at, ctx.site.timezone)}</span>
                  <ArchiveToggleButton entity={r.table} id={row.id} archived />
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </div>
  );
}
