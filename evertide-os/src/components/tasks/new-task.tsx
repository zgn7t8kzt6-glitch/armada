"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask } from "@/app/actions/tasks";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { Profile, Project } from "@/lib/types";

export function NewTaskButton({
  siteId, profiles, projects, defaultOwnerId,
}: { siteId: string; profiles: Profile[]; projects: Project[]; defaultOwnerId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("siteId", siteId);
    startTransition(async () => {
      const res = await createTask(fd);
      if (!res.ok) push(res.error, "error");
      else {
        push("Task created", "success");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ New task</button>
      <Modal open={open} onClose={() => setOpen(false)} title="New task" wide>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nt-title">Title</label>
            <input id="nt-title" name="title" required className="input" maxLength={500} />
          </div>
          <div>
            <label className="label" htmlFor="nt-owner">Owner (single DRI)</label>
            <select id="nt-owner" name="ownerId" required className="input" defaultValue={defaultOwnerId}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-project">Project</label>
            <select id="nt-project" name="projectId" className="input" defaultValue="">
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-start">Start date</label>
            <input id="nt-start" name="startDate" type="date" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="nt-due">Due date</label>
            <input id="nt-due" name="dueDate" type="date" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="nt-priority">Priority</label>
            <select id="nt-priority" name="priority" className="input" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="inline-flex min-h-touch items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" name="critical" value="true" className="h-4 w-4 rounded border-slate-300" />
              Critical path
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nt-desc">Description</label>
            <textarea id="nt-desc" name="description" rows={3} className="input" />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Creating…" : "Create task"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
