import { NextRequest, NextResponse } from "next/server";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchTasks, parseTaskFilters } from "@/lib/queries/tasks";
import { toCsv } from "@/lib/logic/csv";

// CSV export of the filtered task list (§7.4). Same filters as the page.
export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const sp: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((v, k) => (sp[k] = v));
  const tasks = await fetchTasks(supabase, ctx.site.id, ctx.site.timezone, parseTaskFilters(sp), ctx.userId);

  const csv = toCsv(
    ["Legacy ID", "Phase", "Workstream", "Title", "Owner", "Start", "Due", "Status", "% Done", "Priority", "Critical", "Blocker Reason", "Notes"],
    tasks.map((t) => [
      t.legacy_id, t.phase, t.workstream, t.title, t.owner?.name ?? "", t.start_date, t.due_date,
      t.status, t.percent_done, t.priority, t.critical ? "yes" : "no", t.blocker_reason, t.notes,
    ])
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="evertide-tasks-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
