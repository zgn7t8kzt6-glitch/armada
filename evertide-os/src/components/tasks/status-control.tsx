"use client";

// Fast status changer with the required blocked-reason modal (§2.2, §7.4).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeTaskStatus } from "@/app/actions/tasks";
import { useToast } from "@/components/toast";
import { Modal } from "@/components/modal";
import { statusLabel } from "@/lib/format";
import type { TaskStatus } from "@/lib/types";

const STATUSES: TaskStatus[] = ["not_started", "in_progress", "blocked", "done"];

export function TaskStatusControl({
  taskId, status, disabled = false, compact = false,
}: { taskId: string; status: TaskStatus; disabled?: boolean; compact?: boolean }) {
  const [blockedModal, setBlockedModal] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function submit(next: TaskStatus, blockerReason?: string) {
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("status", next);
    if (blockerReason) fd.set("blockerReason", blockerReason);
    startTransition(async () => {
      const res = await changeTaskStatus(fd);
      if (!res.ok) push(res.error, "error");
      else {
        push(`Status → ${statusLabel(next)}`, "success");
        router.refresh();
      }
    });
  }

  return (
    <>
      <select
        aria-label="Change status"
        className={`input !w-auto ${compact ? "!min-h-0 py-1 text-2xs" : "text-xs"}`}
        value={status}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          if (next === status) return;
          if (next === "blocked") {
            setBlockedModal(true);
          } else {
            submit(next);
          }
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{statusLabel(s)}</option>
        ))}
      </select>

      <Modal open={blockedModal} onClose={() => setBlockedModal(false)} title="Why is this task blocked?">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            submit("blocked", reason.trim());
            setBlockedModal(false);
            setReason("");
          }}
        >
          <label htmlFor={`blocker-${taskId}`} className="label">Blocking reason (required)</label>
          <textarea
            id={`blocker-${taskId}`}
            required
            rows={3}
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What exactly is blocking progress, and who can unblock it?"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setBlockedModal(false)}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={!reason.trim()}>Mark blocked</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
