// Shared UI primitives (spec §10): status pill, owner chip, due-date
// indicator, exception banner, empty state, skeletons, cards.
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate, initials, statusLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  // Red strictly for overdue/blocked/critical/missing/failed (§10).
  blocked: "bg-red-100 text-red-800 ring-red-200",
  missed: "bg-red-100 text-red-800 ring-red-200",
  missing: "bg-red-100 text-red-800 ring-red-200",
  red: "bg-red-100 text-red-800 ring-red-200",
  critical: "bg-red-100 text-red-800 ring-red-200",
  occurred: "bg-red-100 text-red-800 ring-red-200",
  at_risk: "bg-amber-100 text-amber-900 ring-amber-200",
  yellow: "bg-amber-100 text-amber-900 ring-amber-200",
  high: "bg-amber-100 text-amber-900 ring-amber-200",
  done: "bg-green-100 text-green-800 ring-green-200",
  met: "bg-green-100 text-green-800 ring-green-200",
  green: "bg-green-100 text-green-800 ring-green-200",
  complete: "bg-green-100 text-green-800 ring-green-200",
  resolved: "bg-green-100 text-green-800 ring-green-200",
  active: "bg-teal-50 text-teal-700 ring-teal-200",
  approved: "bg-teal-50 text-teal-700 ring-teal-200",
  implemented: "bg-green-100 text-green-800 ring-green-200",
  in_progress: "bg-navy-50 text-navy-600 ring-navy-100",
  investigating: "bg-navy-50 text-navy-600 ring-navy-100",
  action_planned: "bg-navy-50 text-navy-600 ring-navy-100",
  monitoring: "bg-navy-50 text-navy-600 ring-navy-100",
  mitigating: "bg-navy-50 text-navy-600 ring-navy-100",
  open: "bg-navy-50 text-navy-600 ring-navy-100",
  proposed: "bg-navy-50 text-navy-600 ring-navy-100",
  pending: "bg-slate-100 text-slate-600 ring-slate-200",
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  not_started: "bg-slate-100 text-slate-600 ring-slate-200",
  superseded: "bg-slate-100 text-slate-500 ring-slate-200",
  closed: "bg-slate-100 text-slate-600 ring-slate-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
  carried_over: "bg-amber-100 text-amber-900 ring-amber-200",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset whitespace-nowrap ${cls}`}>
      {label ?? statusLabel(status)}
    </span>
  );
}

export function OwnerChip({ profile, size = "sm" }: { profile?: Pick<Profile, "name" | "avatar_color"> | null; size?: "sm" | "md" }) {
  if (!profile) return <span className="text-2xs text-slate-400">Unassigned</span>;
  const dim = size === "sm" ? "h-6 w-6 text-2xs" : "h-8 w-8 text-xs";
  return (
    <span className="inline-flex items-center gap-1.5" title={profile.name}>
      <span
        aria-hidden
        className={`${dim} inline-flex items-center justify-center rounded-full font-bold text-white shrink-0`}
        style={{ backgroundColor: profile.avatar_color || "#1F3864" }}
      >
        {initials(profile.name)}
      </span>
      <span className="text-xs text-slate-700 truncate max-w-[9rem]">{profile.name}</span>
    </span>
  );
}

export function DueDate({
  date, overdue, className = "",
}: { date: string | null; overdue?: boolean; className?: string }) {
  if (!date) return <span className={`text-xs text-slate-400 ${className}`}>No due date</span>;
  return (
    <span className={`text-xs whitespace-nowrap ${overdue ? "font-semibold text-red-700" : "text-slate-600"} ${className}`}>
      {overdue ? "Overdue · " : ""}
      {formatDate(date)}
    </span>
  );
}

export function ExceptionBanner({
  tone, title, children, href,
}: { tone: "red" | "amber"; title: string; children?: ReactNode; href?: string }) {
  const cls = tone === "red" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900";
  const body = (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`} role="alert">
      <p className="font-bold">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-navy-700">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden />;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-navy-700">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "red" | "amber" | "green" }) {
  const toneCls =
    tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-green-700" : "text-navy-700";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-2xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}

export function CarryBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-bold text-amber-900 ring-1 ring-inset ring-amber-200">
      Carried {count}x
    </span>
  );
}
