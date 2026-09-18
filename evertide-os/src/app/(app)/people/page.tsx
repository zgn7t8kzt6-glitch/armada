import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { PersonModalButton, VendorModalButton } from "@/components/people/people-forms";
import { DownloadIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";
import { todayInTz, isoAddDays } from "@/lib/logic/dates";
import { statusLabel } from "@/lib/format";
import type { Person, Profile, Vendor } from "@/lib/types";

export const metadata = { title: "People & Vendors" };
export const dynamic = "force-dynamic";

// People & Vendors (§7.11): tabs, contact details, renewal alerts, CSV.
export default async function PeoplePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const tab = searchParams.tab === "vendors" ? "vendors" : "people";
  const today = todayInTz(ctx.site.timezone);
  const soon = isoAddDays(today, 60);

  const [peopleQ, vendorsQ, profilesQ] = await Promise.all([
    supabase
      .from("people")
      .select("*, owner:profiles!people_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("last_name")
      .order("first_name")
      .limit(500),
    supabase
      .from("vendors")
      .select("*, owner:profiles!vendors_owner_id_fkey(id,name,email,title,avatar_color)")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("name")
      .limit(500),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
  ]);
  const people = (peopleQ.data ?? []) as unknown as Array<Person & { owner?: Profile }>;
  const vendors = (vendorsQ.data ?? []) as unknown as Array<Vendor & { owner?: Profile }>;
  const profiles = (profilesQ.data ?? []) as Profile[];

  const renewalAlerts = vendors.filter(
    (v) =>
      (v.status === "active" || v.status === "evaluating") &&
      ((v.renewal_notice_date && v.renewal_notice_date <= soon) || (v.contract_end && v.contract_end <= soon))
  );

  return (
    <div>
      <PageHeader
        title="People & Vendors"
        subtitle="Every relationship has one owner."
        action={
          ctx.canWrite ? (
            tab === "people" ? (
              <PersonModalButton profiles={profiles} defaultOwnerId={ctx.userId} />
            ) : (
              <VendorModalButton profiles={profiles} people={people} defaultOwnerId={ctx.userId} />
            )
          ) : undefined
        }
      />

      <div className="no-print mb-4 flex items-center gap-1.5">
        <Link
          href="/people?tab=people"
          className={`inline-flex min-h-touch items-center rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === "people" ? "bg-navy-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"}`}
          aria-current={tab === "people" ? "page" : undefined}
        >
          People ({people.length})
        </Link>
        <Link
          href="/people?tab=vendors"
          className={`inline-flex min-h-touch items-center rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === "vendors" ? "bg-navy-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"}`}
          aria-current={tab === "vendors" ? "page" : undefined}
        >
          Vendors ({vendors.length})
        </Link>
        <a href={`/people/export?tab=${tab}`} className="btn-secondary !min-h-touch text-xs" download><DownloadIcon className="h-4 w-4" /> CSV</a>
      </div>

      {renewalAlerts.length > 0 && (
        <Card title={`Vendor renewals & expirations (next 60 days: ${renewalAlerts.length})`} className="mb-4 border-amber-300">
          <ul className="space-y-1.5">
            {renewalAlerts.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 font-medium text-slate-800">{v.name}</span>
                {v.renewal_notice_date && <span className="text-xs text-amber-800">renewal notice {formatDate(v.renewal_notice_date)}</span>}
                {v.contract_end && <span className="text-xs text-amber-800">contract ends {formatDate(v.contract_end)}</span>}
                <OwnerChip profile={v.owner} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === "people" ? (
        <Card>
          {people.length === 0 ? (
            <p className="text-sm text-slate-500">No people yet — add physicians, referral partners, and contacts.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 basis-56 text-sm">
                    <span className="font-medium text-slate-800">{p.first_name} {p.last_name}</span>
                    <span className="ml-2 text-2xs text-slate-400">
                      {statusLabel(p.person_type)}
                      {p.organization_name && ` · ${p.organization_name}`}
                      {p.title && ` · ${p.title}`}
                    </span>
                    <span className="block text-2xs text-slate-400">
                      {p.email && <a className="hover:underline" href={`mailto:${p.email}`}>{p.email}</a>}
                      {p.email && p.phone && " · "}
                      {p.phone}
                    </span>
                  </span>
                  <StatusPill status={p.status} />
                  <OwnerChip profile={p.owner} />
                  {ctx.canWrite && <PersonModalButton profiles={profiles} defaultOwnerId={ctx.userId} person={p} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          {vendors.length === 0 ? (
            <p className="text-sm text-slate-500">No vendors yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {vendors.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 basis-56 text-sm">
                    <span className="font-medium text-slate-800">{v.name}</span>
                    <span className="ml-2 text-2xs text-slate-400">
                      {v.category}
                      {v.contract_end && ` · contract ends ${formatDate(v.contract_end)}`}
                    </span>
                  </span>
                  <StatusPill status={v.status} />
                  <OwnerChip profile={v.owner} />
                  {ctx.canWrite && <VendorModalButton profiles={profiles} people={people} defaultOwnerId={ctx.userId} vendor={v} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
