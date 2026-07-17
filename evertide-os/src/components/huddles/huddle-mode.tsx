"use client";

// Huddle Mode (§7.6): full-screen meeting flow. Sections render in the
// prescribed order; prior commitments must be resolved before End Huddle.
// Realtime changes from other users refresh the view live.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addCommitment, endHuddle, resolveCommitment, saveHuddleNotes, setAgendaDisposition, startHuddle,
} from "@/app/actions/huddles";
import { useToast } from "@/components/toast";
import { Modal } from "@/components/modal";
import { CarryBadge, OwnerChip, StatusPill } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import { isoAddDays } from "@/lib/logic/dates";
import type { Commitment, Huddle, HuddleAgendaItem, Kpi, KpiEntry, Profile } from "@/lib/types";

interface HuddleModeProps {
  huddle: Huddle;
  agenda: HuddleAgendaItem[];
  priorCommitments: Commitment[];
  thisHuddleCommitments: Commitment[];
  kpis: Kpi[];
  entries: KpiEntry[];
  week: string;
  profiles: Profile[];
  canWrite: boolean;
  daysToOpen: number | null;
  today: string;
}

const SECTION_ORDER: Array<{ key: string; title: string; types: string[] }> = [
  { key: "scorecard", title: "Scorecard — missing & red first", types: ["missing_kpi"] },
  { key: "critical", title: "Critical path & milestones", types: ["critical_path"] },
  { key: "overdue", title: "Overdue tasks", types: ["overdue_task"] },
  { key: "blocked", title: "Blocked tasks", types: ["blocked_task"] },
  { key: "stale", title: "Stale tasks", types: ["stale_task"] },
  { key: "issues", title: "High & critical issues", types: ["issue"] },
  { key: "risks", title: "High & severe risks", types: ["risk"] },
  { key: "commitments", title: "Prior commitments", types: ["prior_commitment"] },
];

function linkFor(item: HuddleAgendaItem): string | null {
  switch (item.item_type) {
    case "missing_kpi": return "/scoreboard";
    case "critical_path":
    case "overdue_task":
    case "blocked_task":
    case "stale_task": return item.linked_id ? `/projects/tasks/${item.linked_id}` : "/projects";
    case "issue": return item.linked_id ? `/issues/${item.linked_id}` : "/issues";
    case "risk": return item.linked_id ? `/risks/${item.linked_id}` : "/risks";
    default: return null;
  }
}

export function HuddleMode(props: HuddleModeProps) {
  const { huddle, canWrite } = props;
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [wins, setWins] = useState(huddle.wins ?? "");
  const [notes, setNotes] = useState(huddle.notes ?? "");
  const [carryTarget, setCarryTarget] = useState<Commitment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Commitment | null>(null);

  // Realtime: any change to huddle tables refreshes the meeting view (§8).
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`huddle-${huddle.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "huddles" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "huddle_commitments" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "kpi_entries" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => router.refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [huddle.id, router]);

  const agendaByType = useMemo(() => {
    const m = new Map<string, HuddleAgendaItem[]>();
    for (const item of props.agenda) {
      m.set(item.item_type, [...(m.get(item.item_type) ?? []), item]);
    }
    return m;
  }, [props.agenda]);

  const openPrior = props.priorCommitments.filter((c) => c.status === "open");

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) push(res.error ?? "Failed", "error");
      else {
        if (success) push(success, "success");
        router.refresh();
      }
    });
  }

  const isDraft = huddle.status === "draft";
  const isLive = huddle.status === "in_progress";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 1. Countdown header */}
      <div className="rounded-xl bg-navy-600 px-5 py-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black">Leadership Huddle — {formatDate(huddle.huddle_date)}</h1>
            <p className="text-xs text-navy-100">
              {props.daysToOpen !== null &&
                (props.daysToOpen >= 0 ? `${props.daysToOpen} days until opening` : `${-props.daysToOpen} days past target`)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={huddle.status} />
            {isDraft && canWrite && (
              <button type="button" className="btn-teal" disabled={pending} onClick={() => act(() => startHuddle(huddle.id), "Huddle started — agenda frozen")}>
                ▶ Start huddle
              </button>
            )}
            {isLive && canWrite && (
              <button
                type="button"
                className="btn-danger"
                disabled={pending}
                onClick={() => {
                  if (openPrior.length > 0) {
                    push(`${openPrior.length} prior commitment(s) still open — mark each done, carried, or cancelled first.`, "error");
                    return;
                  }
                  act(() => endHuddle(huddle.id), "Huddle ended — snapshot saved");
                }}
              >
                ■ End huddle
              </button>
            )}
            {huddle.status === "completed" && (
              <button type="button" className="btn-secondary no-print" onClick={() => window.print()}>🖨 Print</button>
            )}
          </div>
        </div>
      </div>

      {isDraft && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          This huddle hasn&apos;t started. Starting it snapshots the auto-generated agenda — missing KPIs, critical path,
          overdue/blocked/stale work, issues, risks, and prior commitments — so history never changes later.
        </p>
      )}

      {/* 2. Wins */}
      <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-navy-700">🏆 Wins</h2>
        {isLive && canWrite ? (
          <div className="mt-2 flex gap-2">
            <textarea
              aria-label="Wins"
              rows={2}
              className="input flex-1"
              value={wins}
              onChange={(e) => setWins(e.target.value)}
              placeholder="What went right this week? Celebrate it."
            />
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(() => saveHuddleNotes(huddle.id, "wins", wins), "Wins saved")}>
              Save
            </button>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{huddle.wins || "—"}</p>
        )}
      </section>

      {/* 3+. Agenda sections in prescribed order */}
      {SECTION_ORDER.map((section, i) => {
        const items = section.types.flatMap((t) => agendaByType.get(t) ?? []);
        if (section.key === "scorecard") {
          return (
            <ScorecardSection
              key={section.key}
              index={i + 2}
              missingItems={items}
              kpis={props.kpis}
              entries={props.entries}
              week={props.week}
            />
          );
        }
        if (section.key === "commitments") {
          return (
            <section key={section.key} className="print-page rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold text-navy-700">{i + 2}. Prior commitments ({openPrior.length} open)</h2>
              <ul className="mt-2 space-y-2.5">
                {props.priorCommitments.length === 0 && <li className="text-sm text-slate-500">No prior commitments.</li>}
                {props.priorCommitments.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium text-slate-800">{c.commitment}</span>
                    <CarryBadge count={c.carry_count} />
                    <OwnerChip profile={c.owner} />
                    <span className="text-xs text-slate-500">due {formatDate(c.due_date)}</span>
                    <StatusPill status={c.status} />
                    {isLive && canWrite && c.status === "open" && (
                      <span className="flex gap-1.5">
                        <button
                          type="button"
                          className="rounded bg-green-600 px-2 py-1 text-2xs font-bold text-white hover:bg-green-500"
                          disabled={pending}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("commitmentId", c.id);
                            fd.set("action", "done");
                            act(async () => resolveCommitment(fd), "Marked done");
                          }}
                        >
                          Done
                        </button>
                        <button type="button" className="rounded bg-amber-500 px-2 py-1 text-2xs font-bold text-white hover:bg-amber-400" disabled={pending} onClick={() => setCarryTarget(c)}>
                          Carry
                        </button>
                        <button type="button" className="rounded bg-slate-400 px-2 py-1 text-2xs font-bold text-white hover:bg-slate-500" disabled={pending} onClick={() => setCancelTarget(c)}>
                          Cancel
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        }
        return (
          <section key={section.key} className="print-page rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-navy-700">{i + 2}. {section.title} ({items.length})</h2>
            {items.length === 0 ? (
              <p className="mt-1 text-sm text-green-700">Clear. ✓</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <AgendaRow key={item.id} item={item} editable={isLive && canWrite} pending={pending} onDisposition={(d) => act(() => setAgendaDisposition(item.id, d))} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {/* Decisions requiring capture */}
      <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-navy-700">10. New decisions requiring capture</h2>
        <p className="mt-1 text-sm text-slate-500">
          Made a call in this huddle? <Link href="/decisions?new=1" className="font-semibold text-teal-600 hover:underline">Log it in the Decision Log</Link> — context, rationale, alternatives, owner.
        </p>
      </section>

      {/* New commitments */}
      <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-navy-700">11. New commitments ({props.thisHuddleCommitments.length})</h2>
        <ul className="mt-2 space-y-2">
          {props.thisHuddleCommitments.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 font-medium text-slate-800">{c.commitment}</span>
              <CarryBadge count={c.carry_count} />
              <OwnerChip profile={c.owner} />
              <span className="text-xs text-slate-500">due {formatDate(c.due_date)}</span>
              <StatusPill status={c.status} />
            </li>
          ))}
        </ul>
        {isLive && canWrite && (
          <form
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              fd.set("huddleId", huddle.id);
              act(async () => addCommitment(fd), "Commitment captured");
              form.reset();
            }}
          >
            <input name="commitment" required maxLength={1000} className="input" placeholder="Who will do what by when…" aria-label="New commitment" />
            <select name="ownerId" required className="input !w-auto" aria-label="Commitment owner" defaultValue="">
              <option value="" disabled>Owner</option>
              {props.profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input name="dueDate" type="date" required className="input !w-auto" defaultValue={isoAddDays(props.today, 7)} aria-label="Due date" />
            <button type="submit" className="btn-teal" disabled={pending}>Add</button>
          </form>
        )}
      </section>

      {/* Notes */}
      <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-navy-700">Notes</h2>
        {isLive && canWrite ? (
          <div className="mt-2 flex gap-2">
            <textarea aria-label="Notes" rows={3} className="input flex-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(() => saveHuddleNotes(huddle.id, "notes", notes), "Notes saved")}>
              Save
            </button>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{huddle.notes || "—"}</p>
        )}
      </section>

      {/* Carry modal */}
      <Modal open={carryTarget !== null} onClose={() => setCarryTarget(null)} title="Carry commitment forward">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!carryTarget) return;
            const fd = new FormData(e.currentTarget);
            fd.set("commitmentId", carryTarget.id);
            fd.set("action", "carry");
            fd.set("newHuddleId", huddle.id);
            act(async () => resolveCommitment(fd), `Carried (now ${carryTarget.carry_count + 1}x)`);
            setCarryTarget(null);
          }}
        >
          <p className="mb-2 text-sm text-slate-600">{carryTarget?.commitment}</p>
          <p className="mb-3 text-xs text-amber-700">
            This will be its <strong>{(carryTarget?.carry_count ?? 0) + 1}</strong>
            {["st", "nd", "rd"][(carryTarget?.carry_count ?? 0)] ?? "th"} carry. Lineage is preserved.
          </p>
          <label className="label" htmlFor="carry-due">New due date</label>
          <input id="carry-due" name="newDueDate" type="date" required className="input" defaultValue={isoAddDays(props.today, 7)} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCarryTarget(null)}>Back</button>
            <button type="submit" className="btn-primary" disabled={pending}>Carry over</button>
          </div>
        </form>
      </Modal>

      {/* Cancel modal */}
      <Modal open={cancelTarget !== null} onClose={() => setCancelTarget(null)} title="Cancel commitment">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!cancelTarget) return;
            const fd = new FormData(e.currentTarget);
            fd.set("commitmentId", cancelTarget.id);
            fd.set("action", "cancelled");
            act(async () => resolveCommitment(fd), "Cancelled");
            setCancelTarget(null);
          }}
        >
          <p className="mb-2 text-sm text-slate-600">{cancelTarget?.commitment}</p>
          <label className="label" htmlFor="cancel-note">Reason (required)</label>
          <input id="cancel-note" name="note" required className="input" placeholder="Why is this commitment no longer needed?" />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCancelTarget(null)}>Back</button>
            <button type="submit" className="btn-danger" disabled={pending}>Cancel commitment</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function AgendaRow({
  item, editable, pending, onDisposition,
}: { item: HuddleAgendaItem; editable: boolean; pending: boolean; onDisposition: (d: string) => void }) {
  const [disposition, setDisposition] = useState(item.disposition ?? "");
  const href = linkFor(item);
  return (
    <li className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {href ? (
          <Link href={href} className="min-w-0 flex-1 font-medium text-slate-800 hover:underline">{item.title}</Link>
        ) : (
          <span className="min-w-0 flex-1 font-medium text-slate-800">{item.title}</span>
        )}
      </div>
      {editable ? (
        <div className="mt-1.5 flex gap-2">
          <input
            aria-label={`Disposition for ${item.title}`}
            className="input !min-h-9 flex-1 !py-1 text-xs"
            placeholder="Disposition / next step decided in huddle…"
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
            onBlur={() => disposition !== (item.disposition ?? "") && onDisposition(disposition)}
            disabled={pending}
          />
        </div>
      ) : (
        item.disposition && <p className="mt-1 text-xs italic text-slate-600">→ {item.disposition}</p>
      )}
    </li>
  );
}

function ScorecardSection({
  index, missingItems, kpis, entries, week,
}: { index: number; missingItems: HuddleAgendaItem[]; kpis: Kpi[]; entries: KpiEntry[]; week: string }) {
  const rows = kpis
    .filter((k) => k.frequency === "weekly")
    .map((k) => {
      const e = entries.find((x) => x.kpi_id === k.id && x.period_start === week) ?? null;
      const status = e && e.value !== null ? e.status : "missing";
      return { kpi: k, entry: e, status };
    })
    .sort((a, b) => {
      const sev = (s: string) => (s === "missing" ? 0 : s === "red" ? 1 : s === "yellow" ? 2 : 3);
      return sev(a.status) - sev(b.status);
    });

  return (
    <section className="print-page rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-navy-700">{index}. Scorecard — missing & red first</h2>
      {missingItems.length > 0 && (
        <p className="mt-1 text-xs font-bold text-red-700">{missingItems.length} metric(s) MISSING — enter them now, not after the meeting.</p>
      )}
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map(({ kpi, entry, status }) => (
          <li key={kpi.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <StatusPill status={status} label={status === "missing" ? "MISSING" : undefined} />
            <Link href="/scoreboard" className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">{kpi.name}</Link>
            <span className="tabular-nums text-slate-700">
              {entry?.value !== null && entry?.value !== undefined ? entry.value : "—"}
              <span className="text-2xs text-slate-400"> / {kpi.target_value ?? "—"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
