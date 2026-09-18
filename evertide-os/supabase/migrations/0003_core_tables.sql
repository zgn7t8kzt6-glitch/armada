-- EverTide OS — 0003: all core business tables (spec §6), indexes included.
-- Business-rule triggers live in 0004, RLS in 0005.

-- ── Strategy (§6.2) ────────────────────────────────────────────────────────
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  parent_goal_id uuid references public.goals(id),
  title text not null check (length(trim(title)) > 0),
  description text,
  goal_type public.goal_type not null default 'objective',
  start_date date,
  due_date date,
  owner_id uuid not null references public.profiles(id),
  status public.goal_status not null default 'draft',
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  success_criteria text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (start_date is null or due_date is null or start_date <= due_date)
);
create index goals_scope_idx on public.goals (organization_id, site_id, status);
create index goals_owner_idx on public.goals (owner_id);

create table public.goal_links (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id),
  linked_type text not null check (linked_type in ('project', 'kpi', 'milestone')),
  linked_id uuid not null,
  created_at timestamptz not null default now(),
  unique (goal_id, linked_type, linked_id)
);

-- ── Projects and tasks (§6.3) ──────────────────────────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  goal_id uuid references public.goals(id),
  name text not null check (length(trim(name)) > 0),
  description text,
  phase text,
  workstream text,
  owner_id uuid not null references public.profiles(id),
  start_date date,
  due_date date,
  status public.project_status not null default 'not_started',
  percent_done integer not null default 0 check (percent_done between 0 and 100),
  priority public.priority_level not null default 'normal',
  critical_path boolean not null default false,
  blocker_reason text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (status <> 'blocked' or (blocker_reason is not null and length(trim(blocker_reason)) > 0))
);
create index projects_scope_idx on public.projects (organization_id, site_id, status, archived_at);
create unique index projects_phase_workstream_uniq
  on public.projects (site_id, phase, workstream) where archived_at is null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  project_id uuid references public.projects(id),
  milestone_id uuid,
  legacy_id integer,
  phase text,
  workstream text,
  title text not null check (length(trim(title)) > 0),
  description text,
  owner_id uuid not null references public.profiles(id),
  start_date date,
  due_date date,
  status public.task_status not null default 'not_started',
  percent_done integer not null default 0 check (percent_done between 0 and 100),
  priority public.priority_level not null default 'normal',
  critical boolean not null default false,
  blocker_reason text,
  sort_order integer not null default 0,
  notes text,
  last_meaningful_update_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (status <> 'blocked' or (blocker_reason is not null and length(trim(blocker_reason)) > 0)),
  check (status <> 'done' or percent_done = 100),
  check (start_date is null or due_date is null or start_date <= due_date)
);
create index tasks_scope_idx on public.tasks (organization_id, site_id, status, archived_at);
create index tasks_owner_idx on public.tasks (owner_id, status);
create index tasks_due_idx on public.tasks (site_id, due_date) where archived_at is null;
create index tasks_project_idx on public.tasks (project_id);
create unique index tasks_legacy_uniq on public.tasks (site_id, legacy_id) where legacy_id is not null;

create table public.task_helpers (
  task_id uuid not null references public.tasks(id),
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- Append-only activity feed for tasks.
create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  task_id uuid not null references public.tasks(id),
  author_id uuid references public.profiles(id),
  update_type public.task_update_type not null default 'comment',
  body text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index task_updates_task_idx on public.task_updates (task_id, created_at desc);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  predecessor_task_id uuid not null references public.tasks(id),
  successor_task_id uuid not null references public.tasks(id),
  dependency_type public.dependency_type not null default 'finish_to_start',
  lag_days integer not null default 0,
  created_at timestamptz not null default now(),
  check (predecessor_task_id <> successor_task_id),
  unique (predecessor_task_id, successor_task_id)
);

-- ── Milestones (§6.4) ──────────────────────────────────────────────────────
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  project_id uuid references public.projects(id),
  title text not null check (length(trim(title)) > 0),
  target_date date not null,
  gate_criteria text,
  owner_id uuid not null references public.profiles(id),
  status public.milestone_status not null default 'pending',
  met_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index milestones_site_idx on public.milestones (site_id, target_date);

alter table public.tasks
  add constraint tasks_milestone_fk foreign key (milestone_id) references public.milestones(id);

-- ── Issues (§6.5) ──────────────────────────────────────────────────────────
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  project_id uuid references public.projects(id),
  task_id uuid references public.tasks(id),
  related_issue_id uuid references public.issues(id), -- manual recurring link
  title text not null check (length(trim(title)) > 0),
  description text,
  category text,
  priority public.priority_level not null default 'normal',
  status public.issue_status not null default 'open',
  owner_id uuid not null references public.profiles(id),
  reported_by uuid references public.profiles(id),
  reported_at timestamptz not null default now(),
  due_date date,
  root_cause text,
  corrective_action text,
  resolution_summary text,
  resolved_at timestamptz,
  huddle_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (status not in ('resolved', 'closed') or (resolution_summary is not null and length(trim(resolution_summary)) > 0))
);
create index issues_scope_idx on public.issues (organization_id, site_id, status, priority);
create index issues_owner_idx on public.issues (owner_id, status);

create table public.issue_updates (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id),
  author_id uuid references public.profiles(id),
  body text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index issue_updates_issue_idx on public.issue_updates (issue_id, created_at desc);

-- ── Risks (§6.6) ───────────────────────────────────────────────────────────
create table public.risks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  project_id uuid references public.projects(id),
  task_id uuid references public.tasks(id),
  converted_issue_id uuid references public.issues(id),
  title text not null check (length(trim(title)) > 0),
  description text,
  category text,
  probability public.risk_probability not null default 'medium',
  impact public.risk_impact not null default 'medium',
  score integer not null default 4,
  owner_id uuid not null references public.profiles(id),
  mitigation_plan text,
  trigger_condition text,
  review_date date,
  status public.risk_status not null default 'open',
  disposition public.risk_disposition,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (status not in ('closed', 'occurred') or disposition is not null)
);
create index risks_scope_idx on public.risks (organization_id, site_id, status, score desc);

-- ── Decisions (§6.7) ───────────────────────────────────────────────────────
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  project_id uuid references public.projects(id),
  title text not null check (length(trim(title)) > 0),
  context text,
  decision_text text,
  rationale text,
  alternatives_considered text,
  decision_date date not null default current_date,
  owner_id uuid not null references public.profiles(id),
  approved_by_id uuid references public.profiles(id),
  status public.decision_status not null default 'proposed',
  effective_date date,
  review_date date,
  outcome text,
  outcome_recorded_at timestamptz,
  supersedes_decision_id uuid references public.decisions(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index decisions_scope_idx on public.decisions (organization_id, site_id, status, decision_date desc);

create table public.decision_links (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id),
  linked_type text not null check (linked_type in ('task', 'issue', 'risk', 'document', 'vendor', 'goal', 'milestone')),
  linked_id uuid not null,
  created_at timestamptz not null default now(),
  unique (decision_id, linked_type, linked_id)
);

-- ── KPIs (§6.8) ────────────────────────────────────────────────────────────
create table public.kpis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  category public.kpi_category not null,
  name text not null check (length(trim(name)) > 0),
  description text,
  unit text,
  frequency public.kpi_frequency not null default 'weekly',
  owner_id uuid not null references public.profiles(id),
  direction public.kpi_direction not null default 'higher_is_better',
  target_value numeric,
  green_min numeric,
  green_max numeric,
  yellow_min numeric,
  yellow_max numeric,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (site_id, name)
);
create index kpis_site_idx on public.kpis (site_id, category, sort_order);

create table public.kpi_entries (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.kpis(id),
  period_start date not null,
  period_end date not null,
  value numeric,
  status public.kpi_entry_status not null default 'missing',
  narrative text,
  status_override_note text,
  entered_by uuid references public.profiles(id),
  entered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kpi_id, period_start),
  check (period_start <= period_end)
);
create index kpi_entries_period_idx on public.kpi_entries (kpi_id, period_start desc);

-- ── Huddles (§6.9) ─────────────────────────────────────────────────────────
create table public.huddles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  huddle_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  facilitator_id uuid references public.profiles(id),
  status public.huddle_status not null default 'draft',
  attendees text,
  wins text,
  notes text,
  agenda_snapshot jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (site_id, huddle_date)
);

create table public.huddle_attendees (
  huddle_id uuid not null references public.huddles(id),
  user_id uuid not null references public.profiles(id),
  attendance_status public.attendance_status not null default 'present',
  created_at timestamptz not null default now(),
  primary key (huddle_id, user_id)
);

create table public.huddle_agenda_items (
  id uuid primary key default gen_random_uuid(),
  huddle_id uuid not null references public.huddles(id),
  item_type public.agenda_item_type not null,
  linked_id uuid,
  title text not null,
  sort_order integer not null default 0,
  disposition text,
  created_at timestamptz not null default now()
);
create index huddle_agenda_huddle_idx on public.huddle_agenda_items (huddle_id, sort_order);

create table public.huddle_commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  huddle_id uuid not null references public.huddles(id),
  source_commitment_id uuid references public.huddle_commitments(id),
  commitment text not null check (length(trim(commitment)) > 0),
  owner_id uuid not null references public.profiles(id),
  due_date date not null,
  status public.commitment_status not null default 'open',
  carry_count integer not null default 0,
  completed_at timestamptz,
  completion_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index commitments_site_idx on public.huddle_commitments (site_id, status, due_date);
create index commitments_owner_idx on public.huddle_commitments (owner_id, status);

-- ── Documents (§6.10) ──────────────────────────────────────────────────────
create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  parent_folder_id uuid references public.document_folders(id),
  name text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index document_folders_scope_idx on public.document_folders (organization_id, site_id, parent_folder_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  folder_id uuid not null references public.document_folders(id),
  title text not null check (length(trim(title)) > 0),
  description text,
  owner_id uuid not null references public.profiles(id),
  document_type text,
  status public.document_status not null default 'draft',
  current_version_id uuid,
  review_date date,
  confidentiality public.confidentiality_level not null default 'internal',
  source_of_truth boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index documents_scope_idx on public.documents (organization_id, site_id, folder_id, status);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  version_number integer not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum text,
  change_summary text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id);

create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  linked_type text not null check (linked_type in ('goal', 'project', 'task', 'issue', 'risk', 'decision', 'vendor', 'person', 'milestone')),
  linked_id uuid not null,
  created_at timestamptz not null default now(),
  unique (document_id, linked_type, linked_id)
);

create table public.document_access_grants (
  document_id uuid not null references public.documents(id),
  user_id uuid not null references public.profiles(id),
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

-- ── People and vendors (§6.11) ─────────────────────────────────────────────
create table public.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  person_type public.person_type not null default 'external_contact',
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null default '',
  organization_name text,
  title text,
  email text,
  phone text,
  owner_id uuid not null references public.profiles(id),
  status public.person_status not null default 'active',
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index people_scope_idx on public.people (organization_id, site_id, person_type, status);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  name text not null check (length(trim(name)) > 0),
  category text,
  primary_contact_person_id uuid references public.people(id),
  owner_id uuid not null references public.profiles(id),
  status public.vendor_status not null default 'evaluating',
  contract_start date,
  contract_end date,
  renewal_notice_date date,
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index vendors_scope_idx on public.vendors (organization_id, site_id, status);

create table public.vendor_links (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  linked_type text not null check (linked_type in ('document', 'task', 'issue', 'decision', 'project')),
  linked_id uuid not null,
  created_at timestamptz not null default now(),
  unique (vendor_id, linked_type, linked_id)
);

-- ── Reports and notifications (§6.12) ──────────────────────────────────────
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid not null references public.sites(id),
  report_type public.report_type not null,
  period_start date not null,
  period_end date not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id),
  snapshot jsonb not null default '{}'::jsonb,
  narrative text,
  status public.report_status not null default 'generated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, report_type, period_start),
  check (period_start <= period_end)
);

-- Ephemeral: the only table where hard delete is allowed (spec §2.7).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  user_id uuid not null references public.profiles(id),
  type text not null,
  title text not null,
  body text,
  linked_type text,
  linked_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id, type, linked_type, linked_id, created_at)
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

-- ── RACI reference (§7.13, static seeded reference) ────────────────────────
create table public.raci_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  site_id uuid references public.sites(id),
  workstream text not null,
  assignments jsonb not null default '{}'::jsonb, -- { "Person Name": "A|R|C|I" }
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
