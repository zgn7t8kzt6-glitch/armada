"use client";

// Filter bar for the Projects views (§7.4): owner, phase, workstream,
// project, status, priority, critical, overdue, archived, My Tasks, search.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Profile, Project } from "@/lib/types";

export function TaskFilterBar({
  profiles, projects, phases, workstreams,
}: {
  profiles: Profile[];
  projects: Project[];
  phases: string[];
  workstreams: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) setParam("q", q || null);
    }, 350);
    return () => clearTimeout(t);
  }, [q, params, setParam]);

  const select = "input !min-h-0 !w-auto py-1.5 text-xs";
  const toggle = (key: string, label: string) => (
    <button
      type="button"
      onClick={() => setParam(key, params.get(key) === "1" ? null : "1")}
      className={`inline-flex min-h-touch items-center rounded-lg border px-3 py-1.5 text-xs font-semibold ${
        params.get(key) === "1"
          ? "border-navy-400 bg-navy-50 text-navy-700"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
      aria-pressed={params.get(key) === "1"}
    >
      {label}
    </button>
  );

  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search title or notes…"
        className="input !min-h-0 w-full py-1.5 text-xs sm:!w-52"
        aria-label="Search tasks"
      />
      <select aria-label="Owner" className={select} value={params.get("owner") ?? ""} onChange={(e) => setParam("owner", e.target.value || null)}>
        <option value="">All owners</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select aria-label="Phase" className={select} value={params.get("phase") ?? ""} onChange={(e) => setParam("phase", e.target.value || null)}>
        <option value="">All phases</option>
        {phases.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select aria-label="Workstream" className={select} value={params.get("workstream") ?? ""} onChange={(e) => setParam("workstream", e.target.value || null)}>
        <option value="">All workstreams</option>
        {workstreams.map((w) => (
          <option key={w} value={w}>{w}</option>
        ))}
      </select>
      <select aria-label="Project" className={select} value={params.get("project") ?? ""} onChange={(e) => setParam("project", e.target.value || null)}>
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select aria-label="Status" className={select} value={params.get("status") ?? ""} onChange={(e) => setParam("status", e.target.value || null)}>
        <option value="">Any status</option>
        <option value="not_started">Not started</option>
        <option value="in_progress">In progress</option>
        <option value="blocked">Blocked</option>
        <option value="done">Done</option>
      </select>
      <select aria-label="Priority" className={select} value={params.get("priority") ?? ""} onChange={(e) => setParam("priority", e.target.value || null)}>
        <option value="">Any priority</option>
        <option value="low">Low</option>
        <option value="normal">Normal</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      {toggle("mine", "My Tasks")}
      {toggle("critical", "Critical")}
      {toggle("overdue", "Overdue")}
      {toggle("archived", "Archived")}
    </div>
  );
}
