"use client";

// Decision log forms (§7.9): create, approve, record outcome, supersede,
// admin correction.
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  adminCorrectDecision, approveDecision, createDecision, editDecision, supersedeDecision,
} from "@/app/actions/decisions";
import { Modal, ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { Decision, Profile } from "@/lib/types";

function DecisionFields({ profiles, defaults, defaultOwnerId }: { profiles: Profile[]; defaults?: Partial<Decision>; defaultOwnerId: string }) {
  return (
    <>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="dc-title">Decision title</label>
        <input id="dc-title" name="title" required maxLength={500} className="input" defaultValue={defaults?.title ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="dc-context">Context — what question were we answering?</label>
        <textarea id="dc-context" name="context" rows={2} className="input" defaultValue={defaults?.context ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="dc-text">The decision</label>
        <textarea id="dc-text" name="decisionText" rows={2} className="input" defaultValue={defaults?.decision_text ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="dc-rationale">Rationale — why this way?</label>
        <textarea id="dc-rationale" name="rationale" rows={2} className="input" defaultValue={defaults?.rationale ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="dc-alts">Alternatives considered</label>
        <textarea id="dc-alts" name="alternativesConsidered" rows={2} className="input" defaultValue={defaults?.alternatives_considered ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="dc-owner">Owner</label>
        <select id="dc-owner" name="ownerId" required className="input" defaultValue={defaults?.owner_id ?? defaultOwnerId}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="dc-date">Decision date</label>
        <input id="dc-date" name="decisionDate" type="date" required className="input" defaultValue={defaults?.decision_date ?? new Date().toISOString().slice(0, 10)} />
      </div>
      <div>
        <label className="label" htmlFor="dc-review">Review date (optional)</label>
        <input id="dc-review" name="reviewDate" type="date" className="input" defaultValue={defaults?.review_date ?? ""} />
      </div>
    </>
  );
}

export function NewDecisionButton({ profiles, defaultOwnerId }: { profiles: Profile[]; defaultOwnerId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const params = useSearchParams();

  // Deep link from Huddle Mode: /decisions?new=1
  useEffect(() => {
    if (params.get("new") === "1") setOpen(true);
  }, [params]);

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ Log decision</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Log a decision" wide>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await createDecision(fd);
              if (!res.ok) push(res.error, "error");
              else {
                push("Decision logged (proposed)", "success");
                setOpen(false);
                if (res.decisionId) router.push(`/decisions/${res.decisionId}`);
                router.refresh();
              }
            });
          }}
        >
          <DecisionFields profiles={profiles} defaultOwnerId={defaultOwnerId} />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Log decision"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DecisionActions({
  decision, profiles, isAdmin, canWrite,
}: { decision: Decision; profiles: Profile[]; isAdmin: boolean; canWrite: boolean }) {
  const [pending, startTransition] = useTransition();
  const [approveOpen, setApproveOpen] = useState(false);
  const [supersedeOpen, setSupersedeOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const { push } = useToast();
  const router = useRouter();

  const proposed = decision.status === "proposed";
  const approved = decision.status === "approved" || decision.status === "implemented";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) push(res.error ?? "Failed", "error");
      else {
        push(success, "success");
        router.refresh();
      }
    });
  }

  if (!canWrite) return null;

  return (
    <div className="space-y-4">
      {proposed && (
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("decisionId", decision.id);
            run(async () => editDecision(fd), "Decision updated");
          }}
        >
          <div className="sm:col-span-2">
            <label className="label" htmlFor="de-title">Title</label>
            <input id="de-title" name="title" className="input" defaultValue={decision.title} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="de-context">Context</label>
            <textarea id="de-context" name="context" rows={2} className="input" defaultValue={decision.context ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="de-text">Decision</label>
            <textarea id="de-text" name="decisionText" rows={2} className="input" defaultValue={decision.decision_text ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="de-rationale">Rationale</label>
            <textarea id="de-rationale" name="rationale" rows={2} className="input" defaultValue={decision.rationale ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="de-alts">Alternatives considered</label>
            <textarea id="de-alts" name="alternativesConsidered" rows={2} className="input" defaultValue={decision.alternatives_considered ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="de-review">Review date</label>
            <input id="de-review" name="reviewDate" type="date" className="input" defaultValue={decision.review_date ?? ""} />
          </div>
          <div className="flex items-end justify-end gap-2">
            <button type="submit" className="btn-secondary" disabled={pending}>Save draft</button>
            {isAdmin && (
              <button type="button" className="btn-primary" disabled={pending} onClick={() => setApproveOpen(true)}>
                Approve…
              </button>
            )}
          </div>
        </form>
      )}

      {approved && (
        <div className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("decisionId", decision.id);
              run(async () => editDecision(fd), "Saved");
            }}
          >
            <div>
              <label className="label" htmlFor="de-status">Implementation status</label>
              <select id="de-status" name="status" className="input !w-auto" defaultValue={decision.status}>
                <option value="approved">Approved</option>
                <option value="implemented">Implemented</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="de-review2">Review date</label>
              <input id="de-review2" name="reviewDate" type="date" className="input !w-auto" defaultValue={decision.review_date ?? ""} />
            </div>
            <div className="min-w-56 flex-1">
              <label className="label" htmlFor="de-outcome">Outcome (recorded when reviewed)</label>
              <input id="de-outcome" name="outcome" className="input" defaultValue={decision.outcome ?? ""} placeholder="Did it work? What did we learn?" />
            </div>
            <button type="submit" className="btn-secondary" disabled={pending}>Save</button>
          </form>
          {isAdmin && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <button type="button" className="btn-secondary text-xs" onClick={() => setSupersedeOpen(true)}>
                Supersede with a new decision…
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setCorrectOpen(true)}>
                Admin correction…
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        onConfirm={() => run(() => approveDecision(decision.id), "Decision approved — now immutable")}
        title="Approve decision"
        message="Approving freezes the decision's substance (title, context, decision, rationale, alternatives). Only implementation status, review date, outcome, and supersession remain editable. Continue?"
        confirmLabel="Approve"
      />

      <Modal open={supersedeOpen} onClose={() => setSupersedeOpen(false)} title="Supersede decision" wide>
        <p className="mb-3 text-xs text-slate-500">
          The current decision stays in the log marked <strong>superseded</strong>; the new one links back to it.
        </p>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const res = await supersedeDecision(decision.id, fd);
              if (!res.ok) push(res.error ?? "Failed", "error");
              else {
                push("Superseded", "success");
                setSupersedeOpen(false);
                if (res.decisionId) router.push(`/decisions/${res.decisionId}`);
                router.refresh();
              }
            });
          }}
        >
          <DecisionFields profiles={profiles} defaults={{ ...decision, title: `${decision.title} (v2)` }} defaultOwnerId={decision.owner_id} />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setSupersedeOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>Create superseding decision</button>
          </div>
        </form>
      </Modal>

      <Modal open={correctOpen} onClose={() => setCorrectOpen(false)} title="Admin correction (audited)" wide>
        <form
          className="grid grid-cols-1 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const reason = String(fd.get("reason") ?? "");
            const fields: Record<string, string> = {};
            for (const k of ["title", "context", "decision_text", "rationale", "alternatives_considered"]) {
              const v = fd.get(k);
              if (typeof v === "string" && v.trim()) fields[k] = v;
            }
            startTransition(async () => {
              const res = await adminCorrectDecision(decision.id, reason, fields);
              if (!res.ok) push(res.error ?? "Failed", "error");
              else {
                push("Correction applied and audited", "success");
                setCorrectOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <p className="text-xs text-amber-700">
            Corrections bypass immutability for typos/factual errors only. The reason and changes are written to the audit log.
          </p>
          <div>
            <label className="label" htmlFor="ac-reason">Reason (required)</label>
            <input id="ac-reason" name="reason" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="ac-title">Title (leave blank to keep)</label>
            <input id="ac-title" name="title" className="input" placeholder={decision.title} />
          </div>
          <div>
            <label className="label" htmlFor="ac-text">Decision text (leave blank to keep)</label>
            <textarea id="ac-text" name="decision_text" rows={2} className="input" placeholder={decision.decision_text ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="ac-rationale">Rationale (leave blank to keep)</label>
            <textarea id="ac-rationale" name="rationale" rows={2} className="input" placeholder={decision.rationale ?? ""} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCorrectOpen(false)}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={pending}>Apply correction</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
