"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGoal, updateGoal } from "@/app/actions/goals";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { Goal, Profile } from "@/lib/types";

export function NewGoalButton({ profiles, goals, defaultOwnerId }: { profiles: Profile[]; goals: Goal[]; defaultOwnerId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ New goal</button>
      <Modal open={open} onClose={() => setOpen(false)} title="New goal" wide>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await createGoal(fd);
              if (!res.ok) push(res.error, "error");
              else {
                push("Goal created", "success");
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ng-title">Goal</label>
            <input id="ng-title" name="title" required maxLength={500} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="ng-type">Type</label>
            <select id="ng-type" name="goalType" className="input" defaultValue="quarterly">
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="objective">Objective</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ng-parent">Parent goal</label>
            <select id="ng-parent" name="parentGoalId" className="input" defaultValue="">
              <option value="">None (top level)</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>{g.title.slice(0, 70)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ng-owner">Owner</label>
            <select id="ng-owner" name="ownerId" required className="input" defaultValue={defaultOwnerId}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="ng-start">Start</label>
              <input id="ng-start" name="startDate" type="date" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="ng-due">Due</label>
              <input id="ng-due" name="dueDate" type="date" className="input" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ng-criteria">Success criteria</label>
            <textarea id="ng-criteria" name="successCriteria" rows={2} className="input" />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Create goal"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function GoalProgressForm({ goal, canWrite }: { goal: Goal; canWrite: boolean }) {
  const [progress, setProgress] = useState(goal.progress_percent);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("goalId", goal.id);
        fd.set("progressPercent", String(progress));
        startTransition(async () => {
          const res = await updateGoal(fd);
          if (!res.ok) push(res.error, "error");
          else {
            push("Goal updated", "success");
            router.refresh();
          }
        });
      }}
    >
      <div className="min-w-48 flex-1">
        <label className="label" htmlFor={`gp-${goal.id}`}>Progress: {progress}%</label>
        <input
          id={`gp-${goal.id}`}
          type="range"
          min={0}
          max={100}
          step={5}
          value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
          className="w-full accent-teal-500"
        />
      </div>
      <div>
        <label className="label" htmlFor={`gs-${goal.id}`}>Status</label>
        <select id={`gs-${goal.id}`} name="status" className="input !w-auto" defaultValue={goal.status}>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="at_risk">At risk</option>
          <option value="complete">Complete</option>
        </select>
      </div>
      <button type="submit" className="btn-secondary" disabled={pending}>Save</button>
    </form>
  );
}
