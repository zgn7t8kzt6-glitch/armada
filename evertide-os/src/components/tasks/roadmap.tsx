// Roadmap table mirroring the original spreadsheet (§7.4): one row per task
// with legacy id, phase, workstream, owner, dates, status, %, critical, notes.
// Wide by design — horizontal scroll with a sticky first column (§10).
import Link from "next/link";
import { StatusPill, OwnerChip, DueDate } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { isOverdue } from "@/lib/logic/tasks";
import type { Task } from "@/lib/types";

export function RoadmapTable({ tasks, timezone }: { tasks: Task[]; timezone: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="table-sticky-col w-full min-w-[64rem] text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
            <th className="bg-slate-50 px-3 py-2 font-semibold">Task</th>
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Phase</th>
            <th className="px-3 py-2 font-semibold">Workstream</th>
            <th className="px-3 py-2 font-semibold">Owner</th>
            <th className="px-3 py-2 font-semibold">Start</th>
            <th className="px-3 py-2 font-semibold">Due</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">%</th>
            <th className="px-3 py-2 font-semibold">Critical</th>
            <th className="px-3 py-2 font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue = isOverdue(t, timezone);
            return (
              <tr key={t.id} className="border-b border-slate-100 bg-white last:border-0 hover:bg-slate-50">
                <td className="max-w-xs bg-inherit px-3 py-2">
                  <Link href={`/projects/tasks/${t.id}`} className="font-medium text-slate-800 hover:text-navy-600 hover:underline">
                    {t.title}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-400">{t.legacy_id ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{t.phase ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{t.workstream ?? "—"}</td>
                <td className="px-3 py-2"><OwnerChip profile={t.owner} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatDate(t.start_date)}</td>
                <td className="whitespace-nowrap px-3 py-2"><DueDate date={t.due_date} overdue={overdue} /></td>
                <td className="px-3 py-2"><StatusPill status={t.status} /></td>
                <td className="px-3 py-2 tabular-nums">{t.percent_done}%</td>
                <td className="px-3 py-2">{t.critical ? <span className="font-bold text-red-700">Yes</span> : "—"}</td>
                <td className="max-w-sm px-3 py-2 text-slate-500">
                  {t.status === "blocked" && t.blocker_reason ? (
                    <span className="text-red-700">BLOCKED: {t.blocker_reason}</span>
                  ) : (
                    t.notes ?? "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
