import { getAppContext } from "@/lib/context";
import { Card, PageHeader } from "@/components/ui";
import { OpeningRiskControl, SiteSettingsForm } from "@/components/admin/admin-forms";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const ctx = await getAppContext();

  return (
    <div className="space-y-4">
      <PageHeader title="Admin — Settings" subtitle={`${ctx.organization.name} · ${ctx.site.name}`} />

      <Card title="Site settings">
        <SiteSettingsForm site={ctx.site} />
      </Card>

      <Card title="Opening-risk declaration">
        <p className="mb-3 text-xs text-slate-500">
          Manually declaring opening risk shows the red banner on every page for every user, regardless of automatic
          detection. A reason is required and the change is audited.
        </p>
        <OpeningRiskControl site={ctx.site} />
      </Card>

      <Card title="Notification rules">
        <p className="text-xs text-slate-500">In-app notifications are generated on this fixed schedule (site-local time):</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li><strong>Daily 7:00 AM</strong> — overdue tasks, due commitments, high risks due for review, vendor renewals, missing weekly KPIs.</li>
          <li><strong>Monday 7:00 AM</strong> — new scorecard week opens; KPI owners notified.</li>
          <li><strong>Tuesday 8:00 AM</strong> — still-missing KPIs escalated to owners and admins before the huddle.</li>
          <li><strong>Tuesday evening</strong> — admins alerted if no huddle was recorded.</li>
          <li><strong>Sunday night</strong> — weekly report drafted. <strong>1st of month</strong> — monthly report drafted.</li>
        </ul>
        <p className="mt-2 text-2xs text-slate-400">Notifications are in-app only; no external email/SMS provider is used.</p>
      </Card>
    </div>
  );
}
