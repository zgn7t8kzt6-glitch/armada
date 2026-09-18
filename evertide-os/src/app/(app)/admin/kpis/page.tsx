import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { KpiDefinitionModal } from "@/components/admin/admin-forms";
import type { Kpi, Profile } from "@/lib/types";

export const metadata = { title: "KPI definitions" };
export const dynamic = "force-dynamic";

export default async function AdminKpisPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const [kpisQ, profilesQ] = await Promise.all([
    supabase
      .from("kpis")
      .select("*, owner:profiles!kpis_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("site_id", ctx.site.id)
      .is("archived_at", null)
      .order("category")
      .order("sort_order"),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
  ]);
  const kpis = (kpisQ.data ?? []) as unknown as Kpi[];
  const profiles = (profilesQ.data ?? []) as Profile[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admin — KPI definitions"
        subtitle="Targets, bands, owners, and cadence for the scoreboard."
        action={<KpiDefinitionModal siteId={ctx.site.id} profiles={profiles} />}
      />
      <Card>
        <ul className="divide-y divide-slate-100">
          {kpis.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="w-24 text-2xs font-bold uppercase tracking-wide text-slate-400">{k.category}</span>
              <span className="min-w-0 flex-1 basis-52 text-sm font-medium text-slate-800">
                {k.name}
                <span className="ml-2 text-2xs text-slate-400">
                  {k.frequency} · target {k.target_value ?? "—"} {k.unit ?? ""} · {k.direction.replace(/_/g, " ")}
                </span>
              </span>
              {!k.active && <StatusPill status="cancelled" label="Inactive" />}
              <OwnerChip profile={k.owner} />
              <KpiDefinitionModal siteId={ctx.site.id} profiles={profiles} kpi={k} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
