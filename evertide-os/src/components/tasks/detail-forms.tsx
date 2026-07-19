"use client";

// Interactive pieces of the task detail page: percent slider + notes,
// comments, helpers, admin reassignment, dependencies.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDependency, addTaskComment, reassignTask, removeDependency, toggleTaskHelper, updateTaskFields,
} from "@/app/actions/tasks";
import { useToast } from "@/components/toast";
import { OwnerChip } from "@/components/ui";
import type { Profile, Task } from "@/lib/types";

export function ProgressAndNotes({ task, canWrite }: { task: Task; canWrite: boolean }) {
  const [percent, setPercent] = useState(task.percent_done);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function save() {
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("percentDone", String(percent));
    fd.set("notes", notes);
    startTransition(async () => {
      const res = await updateTaskFields(fd);
      if (!res.ok) push(res.error, "error");
      else {
        push("Saved", "success");
        router.refresh();
      }
    });
  }

  const disabled = !canWrite || task.status === "done";
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="task-percent" className="label">Percent done: {percent}%</label>
        <input
          id="task-percent"
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          disabled={disabled}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="w-full accent-teal-500"
        />
      </div>
      <div>
        <label htmlFor="task-notes" className="label">Notes</label>
        <textarea
          id="task-notes"
          rows={3}
          className="input"
          value={notes}
          disabled={!canWrite}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {canWrite && (
        <button type="button" className="btn-primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save progress & notes"}
        </button>
      )}
    </div>
  );
}

export function CommentForm({ taskId }: { taskId: string }) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        const fd = new FormData();
        fd.set("taskId", taskId);
        fd.set("body", body.trim());
        startTransition(async () => {
          const res = await addTaskComment(fd);
          if (!res.ok) push(res.error, "error");
          else {
            setBody("");
            router.refresh();
          }
        });
      }}
      className="flex gap-2"
    >
      <input
        aria-label="Add a comment"
        className="input flex-1"
        placeholder="Add an update or comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
      />
      <button type="submit" className="btn-teal" disabled={pending || !body.trim()}>Post</button>
    </form>
  );
}

export function HelperEditor({
  task, helpers, profiles, canWrite,
}: { task: Task; helpers: Profile[]; profiles: Profile[]; canWrite: boolean }) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function toggle(userId: string) {
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("userId", userId);
    startTransition(async () => {
      const res = await toggleTaskHelper(fd);
      if (!res.ok) push(res.error, "error");
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {helpers.length === 0 && <p className="text-xs text-slate-400">No helpers yet.</p>}
        {helpers.map((h) => (
          <span key={h.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-1 pr-2">
            <OwnerChip profile={h} />
            {canWrite && (
              <button type="button" onClick={() => toggle(h.id)} disabled={pending} aria-label={`Remove helper ${h.name}`} className="text-slate-400 hover:text-red-600">
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {canWrite && (
        <select
          aria-label="Add helper"
          className="input mt-2 !w-auto text-xs"
          value=""
          onChange={(e) => e.target.value && toggle(e.target.value)}
        >
          <option value="">+ Add helper…</option>
          {profiles
            .filter((p) => p.id !== task.owner_id && !helpers.some((h) => h.id === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
      )}
      <p className="mt-1.5 text-2xs text-slate-400">Helpers assist; accountability stays with the single owner.</p>
    </div>
  );
}

export function AdminReassign({ task, profiles }: { task: Task; profiles: Profile[] }) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("taskId", task.id);
        startTransition(async () => {
          const res = await reassignTask(fd);
          if (!res.ok) push(res.error, "error");
          else {
            push("Owner / dates updated", "success");
            router.refresh();
          }
        });
      }}
      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
    >
      <div>
        <label className="label" htmlFor="ra-owner">Owner</label>
        <select id="ra-owner" name="ownerId" className="input text-xs" defaultValue={task.owner_id}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ra-start">Start date</label>
        <input id="ra-start" name="startDate" type="date" className="input text-xs" defaultValue={task.start_date ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="ra-due">Due date</label>
        <input id="ra-due" name="dueDate" type="date" className="input text-xs" defaultValue={task.due_date ?? ""} />
      </div>
      <div className="sm:col-span-3">
        <button type="submit" className="btn-secondary text-xs" disabled={pending}>
          {pending ? "Saving…" : "Update owner / dates (admin)"}
        </button>
      </div>
    </form>
  );
}

export function DependencyEditor({
  task, dependencies, allTasks, canWrite,
}: {
  task: Task;
  dependencies: Array<{ id: string; direction: "predecessor" | "successor"; other: { id: string; title: string; status: string }; dependency_type: string }>;
  allTasks: Array<{ id: string; title: string }>;
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <div className="space-y-2">
      {dependencies.length === 0 && <p className="text-xs text-slate-400">No dependencies.</p>}
      <ul className="space-y-1">
        {dependencies.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs">
            <span>
              <span className="font-semibold text-slate-500">{d.direction === "predecessor" ? "Waits on:" : "Feeds:"}</span>{" "}
              {d.other.title}
              <span className="ml-1 text-2xs text-slate-400">({d.dependency_type.replace(/_/g, " ")})</span>
            </span>
            {canWrite && (
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                aria-label="Remove dependency"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await removeDependency(d.id, task.id);
                    if (!res.ok) push(res.error, "error");
                    else router.refresh();
                  })
                }
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("successorId", task.id);
            startTransition(async () => {
              const res = await addDependency(fd);
              if (!res.ok) push(res.error, "error");
              else router.refresh();
            });
            e.currentTarget.reset();
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="dep-pred">This task waits on…</label>
            <select id="dep-pred" name="predecessorId" required className="input text-xs">
              <option value="">Select task</option>
              {allTasks
                .filter((t) => t.id !== task.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.title.slice(0, 80)}</option>
                ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary text-xs" disabled={pending}>Add</button>
        </form>
      )}
    </div>
  );
}
