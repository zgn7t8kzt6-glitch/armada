"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeReport, generateReport } from "@/app/actions/reports";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/modal";

export function GenerateReportButtons() {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function generate(type: "weekly" | "monthly", period: "current" | "prior") {
    startTransition(async () => {
      const res = await generateReport(type, period);
      if (!res.ok) push(res.error, "error");
      else {
        push("Report generated (draft)", "success");
        if (res.reportId) router.push(`/reports/${res.reportId}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-primary text-xs" disabled={pending} onClick={() => generate("weekly", "current")}>
        Generate weekly (this week)
      </button>
      <button type="button" className="btn-secondary text-xs" disabled={pending} onClick={() => generate("weekly", "prior")}>
        Weekly (last week)
      </button>
      <button type="button" className="btn-secondary text-xs" disabled={pending} onClick={() => generate("monthly", "prior")}>
        Monthly (last month)
      </button>
    </div>
  );
}

export function FinalizeReportForm({ reportId }: { reportId: string }) {
  const [narrative, setNarrative] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <div className="no-print">
      <label className="label" htmlFor="rep-narrative">Leadership narrative (optional, saved on finalize)</label>
      <textarea
        id="rep-narrative"
        rows={3}
        className="input"
        value={narrative}
        onChange={(e) => setNarrative(e.target.value)}
        placeholder="What leadership should take away from this period…"
      />
      <button type="button" className="btn-primary mt-2" disabled={pending} onClick={() => setConfirmOpen(true)}>
        Finalize report
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Finalize report"
        message="Finalized reports are immutable snapshots — they can never be regenerated or edited. Continue?"
        confirmLabel="Finalize"
        onConfirm={() =>
          startTransition(async () => {
            const res = await finalizeReport(reportId, narrative);
            if (!res.ok) push(res.error, "error");
            else {
              push("Report finalized", "success");
              router.refresh();
            }
          })
        }
      />
    </div>
  );
}
