import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { GenerateReportButtons } from "@/components/reports/report-actions";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Report } from "@/lib/types";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

// Reports archive (§7.12).
export default async function ReportsPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("reports")
    .select("id,report_type,period_start,period_end,generated_at,status")
    .eq("site_id", ctx.site.id)
    .order("period_start", { ascending: false })
    .limit(100);
  const reports = (data ?? []) as unknown as Report[];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Weekly and monthly snapshots — immutable once finalized."
        action={ctx.isAdmin ? <GenerateReportButtons /> : undefined}
      />

      <Card>
        {reports.length === 0 ? (
          <p className="text-sm text-slate-500">
            No reports yet. The Sunday-night cron drafts the weekly report automatically{ctx.isAdmin ? ", or generate one now" : ""}.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="flex min-h-touch flex-wrap items-center gap-2 py-2.5 hover:bg-slate-50">
                  <span className="text-sm font-semibold capitalize text-navy-700">{r.report_type}</span>
                  <span className="min-w-0 flex-1 text-sm text-slate-600">
                    {formatDate(r.period_start)} → {formatDate(r.period_end)}
                  </span>
                  <span className="text-2xs text-slate-400">generated {formatDateTime(r.generated_at, ctx.site.timezone)}</span>
                  <StatusPill status={r.status === "final" ? "done" : "draft"} label={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
