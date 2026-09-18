"use client";

// Weekly KPI entry — optimized for phone (§7.5): one tap from the scoreboard,
// numeric keypad, optional narrative, done in under a minute.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveKpiEntry, overrideKpiStatus } from "@/app/actions/kpis";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { StatusPill } from "@/components/ui";
import type { Kpi, KpiEntry } from "@/lib/types";

export function KpiEntryButton({
  kpi, entry, periodStart, canEnter, isAdmin,
}: { kpi: Kpi; entry: KpiEntry | null; periodStart: string; canEnter: boolean; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(entry?.value !== null && entry?.value !== undefined ? String(entry.value) : "");
  const [narrative, setNarrative] = useState(entry?.narrative ?? "");
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideTo, setOverrideTo] = useState<"" | "green" | "yellow" | "red">("");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  if (!canEnter) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("kpiId", kpi.id);
    fd.set("periodStart", periodStart);
    fd.set("value", value);
    if (narrative) fd.set("narrative", narrative);
    startTransition(async () => {
      const res = await saveKpiEntry(fd);
      if (!res.ok) push(res.error, "error");
      else {
        push("KPI saved", "success");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function submitOverride() {
    if (!entry || !overrideTo || !overrideNote.trim()) return;
    const fd = new FormData();
    fd.set("entryId", entry.id);
    fd.set("status", overrideTo);
    fd.set("note", overrideNote.trim());
    startTransition(async () => {
      const res = await overrideKpiStatus(fd);
      if (!res.ok) push(res.error, "error");
      else {
        push("Status overridden (audited)", "success");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button type="button" className="btn-teal !min-h-9 !px-3 !py-1 text-xs" onClick={() => setOpen(true)}>
        {entry?.value !== null && entry?.value !== undefined ? "Edit" : "Enter"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={kpi.name}>
        <form onSubmit={submit}>
          <p className="mb-3 text-xs text-slate-500">{kpi.description}</p>
          <label htmlFor={`kpi-value-${kpi.id}`} className="label">
            This week&apos;s value {kpi.unit ? `(${kpi.unit})` : ""} — target {kpi.target_value ?? "—"}
          </label>
          <input
            id={`kpi-value-${kpi.id}`}
            type="number"
            inputMode="decimal"
            step="any"
            required
            className="input text-lg font-bold tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <label htmlFor={`kpi-narr-${kpi.id}`} className="label mt-3">Narrative (optional)</label>
          <textarea
            id={`kpi-narr-${kpi.id}`}
            rows={2}
            className="input"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="Context, drivers, what changes next week…"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending || value === ""}>
              {pending ? "Saving…" : "Save value"}
            </button>
          </div>
        </form>

        {isAdmin && entry && entry.value !== null && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-bold text-slate-600">Admin: override calculated status</p>
            <div className="flex flex-wrap items-center gap-2">
              {(["green", "yellow", "red"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setOverrideTo(s)}
                  className={`rounded-full px-1 ${overrideTo === s ? "ring-2 ring-navy-500" : ""}`}
                  aria-pressed={overrideTo === s}
                >
                  <StatusPill status={s} />
                </button>
              ))}
            </div>
            <input
              aria-label="Override reason (required)"
              className="input mt-2 text-xs"
              placeholder="Required explanatory note (audited)"
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary mt-2 text-xs"
              disabled={pending || !overrideTo || !overrideNote.trim()}
              onClick={submitOverride}
            >
              Apply override
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
