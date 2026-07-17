"use client";

// Issue creation + editing (§7.7). Creation is optimized to be done in under
// a minute on a phone.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIssue, updateIssue, addIssueComment, reopenIssue, sendIssueToHuddle } from "@/app/actions/issues";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { Issue, Profile } from "@/lib/types";

export function NewIssueButton({ siteId, profiles, defaultOwnerId }: { siteId: string; profiles: Profile[]; defaultOwnerId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ Log issue</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Log an issue (defect)">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("siteId", siteId);
            startTransition(async () => {
              const res = await createIssue(fd);
              if (!res.ok) push(res.error, "error");
              else {
                push("Issue logged", "success");
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <label className="label" htmlFor="ni-title">What happened?</label>
          <input id="ni-title" name="title" required maxLength={500} className="input" placeholder="Describe the defect in one line" />
          <label className="label mt-3" htmlFor="ni-desc">Details</label>
          <textarea id="ni-desc" name="description" rows={3} className="input" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="ni-owner">Owner</label>
              <select id="ni-owner" name="ownerId" required className="input" defaultValue={defaultOwnerId}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ni-priority">Priority</label>
              <select id="ni-priority" name="priority" className="input" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High (auto-huddle)</option>
                <option value="critical">Critical (auto-huddle)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ni-cat">Category</label>
              <input id="ni-cat" name="category" className="input" placeholder="e.g. Facility, Payer, Clinical" />
            </div>
            <div>
              <label className="label" htmlFor="ni-due">Due date</label>
              <input id="ni-due" name="dueDate" type="date" className="input" />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Logging…" : "Log issue"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function IssueEditForm({ issue, profiles, canWrite }: { issue: Issue; profiles: Profile[]; canWrite: boolean }) {
  const [pending, startTransition] = useTransition();
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const { push } = useToast();
  const router = useRouter();
  const closed = issue.status === "resolved" || issue.status === "closed";

  if (!canWrite) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("issueId", issue.id);
    startTransition(async () => {
      const res = await updateIssue(fd);
      if (!res.ok) push(res.error, "error");
      else {
        push("Issue updated", "success");
        router.refresh();
      }
    });
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="ie-status">Status</label>
            <select id="ie-status" name="status" className="input" defaultValue={issue.status} disabled={closed}>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="action_planned">Action planned</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ie-owner">Owner</label>
            <select id="ie-owner" name="ownerId" className="input" defaultValue={issue.owner_id}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ie-priority">Priority</label>
            <select id="ie-priority" name="priority" className="input" defaultValue={issue.priority}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ie-due">Due date</label>
            <input id="ie-due" name="dueDate" type="date" className="input" defaultValue={issue.due_date ?? ""} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ie-root">Root cause</label>
          <textarea id="ie-root" name="rootCause" rows={2} className="input" defaultValue={issue.root_cause ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="ie-corrective">Corrective action</label>
          <textarea id="ie-corrective" name="correctiveAction" rows={2} className="input" defaultValue={issue.corrective_action ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="ie-resolution">Resolution summary (required to resolve)</label>
          <textarea id="ie-resolution" name="resolutionSummary" rows={2} className="input" defaultValue={issue.resolution_summary ?? ""} />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {!issue.huddle_required && !closed && (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await sendIssueToHuddle(issue.id);
                    if (!res.ok) push(res.error, "error");
                    else {
                      push("Will appear in the next huddle", "success");
                      router.refresh();
                    }
                  })
                }
              >
                Send to next huddle
              </button>
            )}
            {closed && (
              <button type="button" className="btn-secondary text-xs" onClick={() => setReopenOpen(true)}>
                Reopen…
              </button>
            )}
          </div>
          <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save issue"}</button>
        </div>
      </form>

      <Modal open={reopenOpen} onClose={() => setReopenOpen(false)} title="Reopen issue">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await reopenIssue(issue.id, reopenReason);
              if (!res.ok) push(res.error, "error");
              else {
                push("Issue reopened — prior resolution preserved", "success");
                setReopenOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <label className="label" htmlFor="reopen-reason">Why is this issue back? (required)</label>
          <input id="reopen-reason" required className="input" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setReopenOpen(false)}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={pending || !reopenReason.trim()}>Reopen</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function IssueCommentForm({ issueId }: { issueId: string }) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        const fd = new FormData();
        fd.set("issueId", issueId);
        fd.set("body", body.trim());
        startTransition(async () => {
          const res = await addIssueComment(fd);
          if (!res.ok) push(res.error, "error");
          else {
            setBody("");
            router.refresh();
          }
        });
      }}
    >
      <input aria-label="Add update" className="input flex-1" placeholder="Add an update…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
      <button type="submit" className="btn-teal" disabled={pending || !body.trim()}>Post</button>
    </form>
  );
}
