import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task, Project, Profile } from "@/lib/types";
import { isOverdue } from "@/lib/logic/tasks";

export interface TaskFilters {
  owner?: string;
  phase?: string;
  workstream?: string;
  project?: string;
  status?: string;
  priority?: string;
  critical?: boolean;
  overdue?: boolean;
  archived?: boolean;
  mine?: boolean;
  q?: string;
}

export function parseTaskFilters(searchParams: Record<string, string | string[] | undefined>): TaskFilters {
  const s = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  return {
    owner: s("owner"),
    phase: s("phase"),
    workstream: s("workstream"),
    project: s("project"),
    status: s("status"),
    priority: s("priority"),
    critical: s("critical") === "1",
    overdue: s("overdue") === "1",
    archived: s("archived") === "1",
    mine: s("mine") === "1",
    q: s("q"),
  };
}

export async function fetchTasks(
  supabase: SupabaseClient,
  siteId: string,
  timezone: string,
  filters: TaskFilters,
  userId: string
): Promise<Task[]> {
  let query = supabase
    .from("tasks")
    .select("*, owner:profiles!tasks_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("site_id", siteId)
    .order("sort_order")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(1000);

  if (filters.archived) query = query.not("archived_at", "is", null);
  else query = query.is("archived_at", null);
  if (filters.owner) query = query.eq("owner_id", filters.owner);
  if (filters.mine) query = query.eq("owner_id", userId);
  if (filters.phase) query = query.eq("phase", filters.phase);
  if (filters.workstream) query = query.eq("workstream", filters.workstream);
  if (filters.project) query = query.eq("project_id", filters.project);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.critical) query = query.eq("critical", true);
  if (filters.q) {
    const safe = filters.q.replace(/[%_,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,notes.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let tasks = (data ?? []) as unknown as Task[];
  if (filters.overdue) tasks = tasks.filter((t) => isOverdue(t, timezone));
  return tasks;
}

export async function fetchProjects(supabase: SupabaseClient, siteId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*, owner:profiles!projects_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("site_id", siteId)
    .is("archived_at", null)
    .order("phase")
    .order("workstream");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Project[];
}

export async function fetchSiteProfiles(supabase: SupabaseClient): Promise<Profile[]> {
  // Profiles visible via RLS are exactly the org's members.
  const { data, error } = await supabase.from("profiles").select("id,name,email,title,avatar_color").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}
