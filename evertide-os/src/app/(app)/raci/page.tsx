import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "RACI Reference" };
export const dynamic = "force-dynamic";

const LEGEND: Record<string, { label: string; cls: string }> = {
  A: { label: "Accountable", cls: "bg-navy-600 text-white" },
  R: { label: "Responsible", cls: "bg-teal-100 text-teal-800" },
  C: { label: "Consulted", cls: "bg-slate-100 text-slate-600" },
  I: { label: "Informed", cls: "bg-slate-50 text-slate-400" },
};

// Static, read-only RACI reference (§7.13).
export default async function RaciPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const { data } = await supabase
    .from("raci_entries")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .order("sort_order");
  const rows = (data ?? []) as Array<{ id: string; workstream: string; assignments: Record<string, string> }>;
  const people = rows.length > 0 ? Object.keys(rows[0].assignments) : [];

  return (
    <div>
      <PageHeader
        title="RACI Reference"
        subtitle="Reference only — daily accountability is managed through a single DRI on each object."
      />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2 text-2xs">
          {Object.entries(LEGEND).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded font-bold ${v.cls}`}>{k}</span>
              {v.label}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="table-sticky-col w-full min-w-[40rem] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
                <th className="bg-slate-50 px-3 py-2 font-semibold">Workstream</th>
                {people.map((p) => (
                  <th key={p} className="px-3 py-2 text-center font-semibold">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 bg-white last:border-0">
                  <td className="bg-inherit px-3 py-2 font-medium text-slate-800">{r.workstream}</td>
                  {people.map((p) => {
                    const v = r.assignments[p];
                    const legend = v ? LEGEND[v] : null;
                    return (
                      <td key={p} className="px-3 py-2 text-center">
                        {legend ? (
                          <span className={`inline-flex h-6 w-6 items-center justify-center rounded font-bold ${legend.cls}`} title={legend.label}>
                            {v}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
