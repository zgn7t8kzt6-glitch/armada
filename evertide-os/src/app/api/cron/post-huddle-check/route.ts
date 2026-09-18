import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeSites, authorizeCron, notifyOnce, recordCronRun, type NotificationRow } from "@/lib/cron";
import { todayInTz } from "@/lib/logic/dates";

export const dynamic = "force-dynamic";

// Tuesday after huddle time (§9): never auto-complete or fabricate anything —
// only notify admins if no huddle was recorded today.
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const results: Record<string, string> = {};

  for (const site of await activeSites(admin)) {
    const today = todayInTz(site.timezone);
    const { data: huddle } = await admin
      .from("huddles").select("id,status").eq("site_id", site.id).eq("huddle_date", today).maybeSingle();

    if (huddle) {
      results[site.slug] = `huddle ${huddle.status}`;
    } else {
      const { data: admins } = await admin
        .from("organization_memberships").select("user_id").eq("organization_id", site.organization_id)
        .eq("role", "org_admin").eq("active", true);
      const rows: NotificationRow[] = (admins ?? []).map((a) => ({
        organization_id: site.organization_id,
        site_id: site.id,
        user_id: a.user_id,
        type: "huddle_not_recorded",
        title: `No huddle was recorded today (${today})`,
        body: "The weekly leadership huddle has no record for today. If it happened, capture it; if not, reschedule it.",
      }));
      await notifyOnce(admin, rows);
      results[site.slug] = "no huddle — admins notified";
    }
    await recordCronRun(admin, site.organization_id, "post-huddle-check", { site: site.slug, result: results[site.slug] });
  }

  return NextResponse.json({ ok: true, results });
}
