import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchProjects, fetchSiteProfiles, fetchTasks, parseTaskFilters } from "@/lib/queries/tasks";
import { PageHeader, EmptyState, StatusPill, OwnerChip } from "@/components/ui";
import { TaskFilterBar } from "@/components/tasks/filters";
import { TaskRow } from "@/components/tasks/task-row";
import { KanbanBoard } from "@/components/tasks/kanban";
import { RoadmapTable } from "@/components/tasks/roadmap";
import { NewTaskButton } from "@/components/tasks/new-task";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

// Three coordinated views (§7.4): portfolio list grouped by phase/workstream,
// Kanban board, and the roadmap table mirroring the original spreadsheet.
export default async function ProjectsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const filters = parseTaskFilters(searchParams);
  const view = typeof searchParams.view === "string" ? searchParams.view : "list";

  const [tasks, projects, profiles] = await Promise.all([
    fetchTasks(supabase, ctx.site.id, ctx.site.timezone, filters, ctx.userId),
    fetchProjects(supabase, ctx.site.id),
    fetchSiteProfiles(supabase),
  ]);

  const phases = [...new Set(tasks.map((t) => t.phase).filter((p): p is string => !!p))].sort();
  const workstreams = [...new Set(tasks.map((t) => t.workstream).filter((w): w is string => !!w))].sort();
  const allPhases = [...new Set(projects.map((p) => p.phase).filter((p): p is string => !!p))].sort();

  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string" && v) exportParams.set(k, v);
  }

  const viewTab = (v: string, label: string) => {
    const next = new URLSearchParams(exportParams);
    next.set("view", v);
    return (
      <Link
        key={v}
        href={`/projects?${next.toString()}`}
        className={`inline-flex min-h-touch items-center rounded-lg px-3 py-1.5 text-xs font-semibold ${
          view === v ? "bg-navy-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
        }`}
        aria-current={view === v ? "page" : undefined}
      >
        {label}
      </Link>
    );
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${tasks.length} task${tasks.length === 1 ? "" : "s"} in view · ${projects.length} projects`}
        action={
          <div className="flex items-center gap-2">
            <a href={`/projects/export?${exportParams.toString()}`} className="btn-secondary text-xs" download>
              ⬇ CSV
            </a>
            {ctx.canWrite && (
              <NewTaskButton siteId={ctx.site.id} profiles={profiles} projects={projects} defaultOwnerId={ctx.userId} />
            )}
          </div>
        }
      />

      <div className="no-print mb-3 flex gap-1.5">{[viewTab("list", "Portfolio"), viewTab("board", "Board"), viewTab("roadmap", "Roadmap")]}</div>

      <TaskFilterBar
        profiles={profiles}
        projects={projects}
        phases={phases.length ? phases : allPhases}
        workstreams={workstreams}
      />

      {tasks.length === 0 ? (
        <EmptyState title="No tasks match these filters" hint="Try clearing a filter, or create the first task." />
      ) : view === "board" ? (
        <KanbanBoard tasks={tasks} timezone={ctx.site.timezone} canWrite={ctx.canWrite} />
      ) : view === "roadmap" ? (
        <RoadmapTable tasks={tasks} timezone={ctx.site.timezone} />
      ) : (
        <PortfolioList
          tasks={tasks}
          projects={projects}
          timezone={ctx.site.timezone}
          canWrite={ctx.canWrite}
        />
      )}
    </div>
  );
}

function PortfolioList({
  tasks, projects, timezone, canWrite,
}: {
  tasks: Awaited<ReturnType<typeof fetchTasks>>;
  projects: Awaited<ReturnType<typeof fetchProjects>>;
  timezone: string;
  canWrite: boolean;
}) {
  // Group by phase, then by project/workstream within it.
  const byPhase = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = t.phase ?? "No phase";
    byPhase.set(key, [...(byPhase.get(key) ?? []), t]);
  }
  const phaseKeys = [...byPhase.keys()].sort();

  return (
    <div className="space-y-5">
      {phaseKeys.map((phase) => {
        const phaseTasks = byPhase.get(phase)!;
        const byWorkstream = new Map<string, typeof tasks>();
        for (const t of phaseTasks) {
          const key = t.workstream ?? "General";
          byWorkstream.set(key, [...(byWorkstream.get(key) ?? []), t]);
        }
        return (
          <section key={phase}>
            <h2 className="mb-2 text-sm font-bold text-navy-700">{phase}</h2>
            <div className="space-y-3">
              {[...byWorkstream.entries()].map(([ws, wsTasks]) => {
                const project = projects.find((p) => p.phase === phase && p.workstream === ws);
                const done = wsTasks.filter((t) => t.status === "done").length;
                return (
                  <div key={ws} className="rounded-lg border border-slate-200 bg-white">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-slate-700">{ws}</p>
                        {project && <StatusPill status={project.status} />}
                      </div>
                      <div className="flex items-center gap-3">
                        {project?.owner && <OwnerChip profile={project.owner} />}
                        <span className="text-2xs text-slate-400">{done}/{wsTasks.length} done</span>
                      </div>
                    </header>
                    <ul>
                      {wsTasks.map((t) => (
                        <TaskRow key={t.id} task={t} timezone={timezone} canWrite={canWrite} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
