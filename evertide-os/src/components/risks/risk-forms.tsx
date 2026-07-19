"use client";

// Risk creation/editing (§7.8) with live score preview and the occurred →
// linked issue conversion.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertRiskToIssue, createRisk, updateRisk } from "@/app/actions/risks";
import { Modal, ConfirmDialog } from "@/components/modal";
import { useToast } from "@/components/toast";
import { riskScore } from "@/lib/logic/risk";
import type { Profile, Risk, RiskImpact, RiskProbability } from "@/lib/types";

export function NewRiskButton({ siteId, profiles, defaultOwnerId }: { siteId: string; profiles: Profile[]; defaultOwnerId: string }) {
  const [open, setOpen] = useState(false);
  const [prob, setProb] = useState<RiskProbability>("medium");
  const [impact, setImpact] = useState<RiskImpact>("medium");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ New risk</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Register a risk" wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("siteId", siteId);
            startTransition(async () => {
              const res = await createRisk(fd);
              if (!res.ok) push(res.error, "error");
              else {
                push("Risk registered", "success");
                setOpen(false);
                router.refresh();
              }
            });
          }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nr-title">Risk</label>
            <input id="nr-title" name="title" required maxLength={500} className="input" placeholder="What could go wrong?" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nr-desc">Description</label>
            <textarea id="nr-desc" name="description" rows={2} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="nr-prob">Probability</label>
            <select id="nr-prob" name="probability" className="input" value={prob} onChange={(e) => setProb(e.target.value as RiskProbability)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nr-impact">Impact</label>
            <select id="nr-impact" name="impact" className="input" value={impact} onChange={(e) => setImpact(e.target.value as RiskImpact)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="severe">Severe</option>
            </select>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Calculated score: <strong className={riskScore(prob, impact) >= 6 ? "text-red-700" : "text-navy-700"}>{riskScore(prob, impact)}</strong> / 12
            {riskScore(prob, impact) >= 6 && " — will surface on the dashboard and huddle agenda"}
          </p>
          <div>
            <label className="label" htmlFor="nr-owner">Owner</label>
            <select id="nr-owner" name="ownerId" required className="input" defaultValue={defaultOwnerId}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nr-review">Review date</label>
            <input id="nr-review" name="reviewDate" type="date" className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nr-mitigation">Mitigation plan</label>
            <textarea id="nr-mitigation" name="mitigationPlan" rows={2} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nr-trigger">Trigger condition</label>
            <input id="nr-trigger" name="triggerCondition" className="input" placeholder="What tells us this risk is materializing?" />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Register risk"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function RiskEditForm({ risk, profiles, canWrite }: { risk: Risk; profiles: Profile[]; canWrite: boolean }) {
  const [pending, startTransition] = useTransition();
  const [convertOpen, setConvertOpen] = useState(false);
  const { push } = useToast();
  const router = useRouter();
  const closed = risk.status === "closed" || risk.status === "occurred";

  if (!canWrite) return null;

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("riskId", risk.id);
          startTransition(async () => {
            const res = await updateRisk(fd);
            if (!res.ok) push(res.error, "error");
            else {
              push("Risk updated", "success");
              router.refresh();
            }
          });
        }}
        className="grid grid-cols-2 gap-2"
      >
        <div>
          <label className="label" htmlFor="re-prob">Probability</label>
          <select id="re-prob" name="probability" className="input" defaultValue={risk.probability} disabled={closed}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="re-impact">Impact</label>
          <select id="re-impact" name="impact" className="input" defaultValue={risk.impact} disabled={closed}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="severe">Severe</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="re-status">Status</label>
          <select id="re-status" name="status" className="input" defaultValue={risk.status}>
            <option value="open">Open</option>
            <option value="monitoring">Monitoring</option>
            <option value="mitigating">Mitigating</option>
            <option value="closed">Closed (needs disposition)</option>
            <option value="occurred">Occurred (needs disposition)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="re-disposition">Disposition</label>
          <select id="re-disposition" name="disposition" className="input" defaultValue={risk.disposition ?? ""}>
            <option value="">—</option>
            <option value="avoided">Avoided</option>
            <option value="mitigated">Mitigated</option>
            <option value="accepted">Accepted</option>
            <option value="transferred">Transferred</option>
            <option value="occurred">Occurred</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="re-owner">Owner</label>
          <select id="re-owner" name="ownerId" className="input" defaultValue={risk.owner_id}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="re-review">Review date</label>
          <input id="re-review" name="reviewDate" type="date" className="input" defaultValue={risk.review_date ?? ""} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="re-mitigation">Mitigation plan</label>
          <textarea id="re-mitigation" name="mitigationPlan" rows={2} className="input" defaultValue={risk.mitigation_plan ?? ""} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="re-trigger">Trigger condition</label>
          <input id="re-trigger" name="triggerCondition" className="input" defaultValue={risk.trigger_condition ?? ""} />
        </div>
        <div className="col-span-2 flex flex-wrap justify-between gap-2">
          {!risk.converted_issue_id && (
            <button type="button" className="btn-danger text-xs" onClick={() => setConvertOpen(true)}>
              Risk occurred → create linked issue
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save risk"}</button>
        </div>
      </form>

      <ConfirmDialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title="Convert occurred risk to issue"
        message="This marks the risk as occurred (disposition: occurred), keeps the risk record, and opens a linked high-priority issue in the defect log. Continue?"
        confirmLabel="Convert"
        destructive
        onConfirm={() =>
          startTransition(async () => {
            const res = await convertRiskToIssue(risk.id);
            if (!res.ok) push(res.error, "error");
            else {
              push("Issue created from risk", "success");
              if (res.issueId) router.push(`/issues/${res.issueId}`);
              router.refresh();
            }
          })
        }
      />
    </>
  );
}
