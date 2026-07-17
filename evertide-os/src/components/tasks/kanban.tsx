"use client";

// Kanban board (§7.4) with dnd-kit drag-and-drop status updates, required
// blocked-reason modal, and realtime refresh from other users' changes.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { changeTaskStatus } from "@/app/actions/tasks";
import { useToast } from "@/components/toast";
import { Modal } from "@/components/modal";
import { OwnerChip, DueDate, StatusPill } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isOverdue } from "@/lib/logic/tasks";
import type { Task, TaskStatus } from "@/lib/types";

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: "not_started", title: "Not Started" },
  { status: "in_progress", title: "In Progress" },
  { status: "blocked", title: "Blocked" },
  { status: "done", title: "Done" },
];

function KanbanCard({ task, timezone, dragging = false }: { task: Task; timezone: string; dragging?: boolean }) {
  const overdue = isOverdue(task, timezone);
  return (
    <div
      className={`rounded-lg border bg-white p-2.5 shadow-sm ${dragging ? "rotate-2 opacity-90" : ""} ${
        overdue || task.status === "blocked" ? "border-red-300" : "border-slate-200"
      }`}
    >
      <Link href={`/projects/tasks/${task.id}`} className="block text-xs font-medium text-slate-800 hover:underline">
        {task.critical && <span className="mr-1 text-red-600" title="Critical path">⛳</span>}
        {task.title}
      </Link>
      {task.status === "blocked" && task.blocker_reason && (
        <p className="mt-1 text-2xs text-red-700">{task.blocker_reason}</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <OwnerChip profile={task.owner} />
        <DueDate date={task.due_date} overdue={overdue} />
      </div>
      {(task.priority === "high" || task.priority === "critical") && (
        <div className="mt-1.5"><StatusPill status={task.priority} /></div>
      )}
    </div>
  );
}

function DraggableCard({ task, timezone, canWrite }: { task: Task; timezone: string; canWrite: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canWrite });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? "opacity-30" : ""}>
      <KanbanCard task={task} timezone={timezone} />
    </div>
  );
}

function Column({ status, title, tasks, timezone, canWrite }: { status: TaskStatus; title: string; tasks: Task[]; timezone: string; canWrite: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[12rem] w-72 shrink-0 flex-col rounded-lg border p-2 ${
        isOver ? "border-navy-400 bg-navy-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <p className="mb-2 flex items-center justify-between px-1 text-xs font-bold text-navy-700">
        {title}
        <span className="rounded-full bg-white px-2 py-0.5 text-2xs text-slate-500 ring-1 ring-slate-200">{tasks.length}</span>
      </p>
      <div className="flex flex-1 flex-col gap-2">
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} timezone={timezone} canWrite={canWrite} />
        ))}
      </div>
    </div>
  );
}

export function KanbanBoard({ tasks, timezone, canWrite }: { tasks: Task[]; timezone: string; canWrite: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingBlock, setPendingBlock] = useState<Task | null>(null);
  const [reason, setReason] = useState("");
  // Optimistic status overrides — rolled back on failure (§8).
  const [overrides, setOverrides] = useState<Record<string, TaskStatus>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  // Realtime: refresh when any task in view changes elsewhere (§8).
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel("kanban-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => router.refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  const effective = useMemo(
    () => tasks.map((t) => (overrides[t.id] ? { ...t, status: overrides[t.id] } : t)),
    [tasks, overrides]
  );

  function commitStatus(task: Task, status: TaskStatus, blockerReason?: string) {
    setOverrides((o) => ({ ...o, [task.id]: status }));
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("status", status);
    if (blockerReason) fd.set("blockerReason", blockerReason);
    startTransition(async () => {
      const res = await changeTaskStatus(fd);
      if (!res.ok) {
        setOverrides((o) => {
          const rest = { ...o };
          delete rest[task.id];
          return rest;
        });
        push(res.error, "error");
      } else {
        router.refresh();
      }
    });
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over?.id;
    if (!over) return;
    const task = tasks.find((t) => t.id === e.active.id);
    if (!task) return;
    const next = over as TaskStatus;
    if (task.status === next) return;
    if (next === "blocked") {
      setPendingBlock(task);
      setReason("");
    } else {
      commitStatus(task, next);
    }
  }

  const activeTask = activeId ? effective.find((t) => t.id === activeId) : null;

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((c) => (
            <Column
              key={c.status}
              status={c.status}
              title={c.title}
              timezone={timezone}
              canWrite={canWrite}
              tasks={effective.filter((t) => t.status === c.status)}
            />
          ))}
        </div>
        <DragOverlay>{activeTask ? <KanbanCard task={activeTask} timezone={timezone} dragging /> : null}</DragOverlay>
      </DndContext>

      <Modal open={pendingBlock !== null} onClose={() => setPendingBlock(null)} title="Why is this task blocked?">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pendingBlock && reason.trim()) {
              commitStatus(pendingBlock, "blocked", reason.trim());
              setPendingBlock(null);
            }
          }}
        >
          <p className="mb-2 text-xs text-slate-500">{pendingBlock?.title}</p>
          <label htmlFor="kanban-blocker" className="label">Blocking reason (required)</label>
          <textarea
            id="kanban-blocker"
            required
            rows={3}
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What exactly is blocking progress, and who can unblock it?"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPendingBlock(null)}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={!reason.trim()}>Mark blocked</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
