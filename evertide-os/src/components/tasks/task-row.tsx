// Server-renderable task row shared by the list view and My Work.
import Link from "next/link";
import { StatusPill, OwnerChip, DueDate } from "@/components/ui";
import { TaskStatusControl } from "@/components/tasks/status-control";
import { isOverdue, isStale } from "@/lib/logic/tasks";
import type { Task } from "@/lib/types";

export function TaskRow({ task, timezone, canWrite }: { task: Task; timezone: string; canWrite: boolean }) {
  const overdue = isOverdue(task, timezone);
  const stale = isStale(task);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-100 px-3 py-2.5 last:border-0 hover:bg-slate-50">
      <div className="min-w-0 flex-1 basis-64">
        <Link href={`/projects/tasks/${task.id}`} className="block text-sm font-medium text-slate-800 hover:text-navy-600 hover:underline">
          {task.critical && <span className="mr-1 text-red-600" title="Critical path">⛳</span>}
          {task.title}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-slate-400">
          {task.phase && <span>{task.phase}</span>}
          {task.workstream && <span>· {task.workstream}</span>}
          {task.percent_done > 0 && task.status !== "done" && <span>· {task.percent_done}%</span>}
          {stale && <StatusPill status="at_risk" label="Stale" />}
          {task.status === "blocked" && task.blocker_reason && (
            <span className="text-red-700">· {task.blocker_reason}</span>
          )}
        </p>
      </div>
      <StatusPill status={task.status} />
      {(task.priority === "high" || task.priority === "critical") && <StatusPill status={task.priority} />}
      <OwnerChip profile={task.owner} />
      <DueDate date={task.due_date} overdue={overdue} />
      {canWrite && <TaskStatusControl taskId={task.id} status={task.status} compact />}
    </li>
  );
}
