-- EverTide OS — complete database setup.
-- Paste into the Supabase SQL Editor and Run. Apply ONCE on a fresh project.
-- (Generated from supabase/migrations by scripts/generate-sql.ts — do not edit.)

-- ═══ 0001_extensions_and_enums.sql ═══
-- EverTide OS — 0001: extensions, private helper schema, and enums.

create extension if not exists pgcrypto;

-- Private schema for helper/authorization functions. Not exposed over the
-- API (only schemas listed in the API config are), but RLS policies invoke
-- these functions as the requesting role, so API roles need schema USAGE.
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.membership_role as enum ('org_admin', 'site_admin', 'member', 'viewer');

create type public.goal_type as enum ('annual', 'quarterly', 'objective');
create type public.goal_status as enum ('draft', 'active', 'at_risk', 'complete', 'archived');

create type public.project_status as enum ('not_started', 'in_progress', 'blocked', 'at_risk', 'done');
create type public.task_status as enum ('not_started', 'in_progress', 'blocked', 'done');
create type public.priority_level as enum ('low', 'normal', 'high', 'critical');
create type public.dependency_type as enum ('finish_to_start', 'start_to_start', 'finish_to_finish');
create type public.task_update_type as enum (
  'comment', 'status_change', 'percent_change', 'owner_change',
  'due_date_change', 'blocker_change', 'system'
);

create type public.milestone_status as enum ('pending', 'at_risk', 'met', 'missed');

create type public.issue_status as enum ('open', 'investigating', 'action_planned', 'resolved', 'closed');

create type public.risk_probability as enum ('low', 'medium', 'high');
create type public.risk_impact as enum ('low', 'medium', 'high', 'severe');
create type public.risk_status as enum ('open', 'monitoring', 'mitigating', 'closed', 'occurred');
create type public.risk_disposition as enum ('avoided', 'mitigated', 'accepted', 'transferred', 'occurred');

create type public.decision_status as enum ('proposed', 'approved', 'implemented', 'superseded');

create type public.kpi_category as enum ('Financial', 'Operations', 'Clinical', 'Growth');
create type public.kpi_frequency as enum ('weekly', 'monthly');
create type public.kpi_direction as enum ('higher_is_better', 'lower_is_better', 'target_range');
create type public.kpi_entry_status as enum ('green', 'yellow', 'red', 'missing');

create type public.huddle_status as enum ('draft', 'in_progress', 'completed');
create type public.attendance_status as enum ('present', 'absent', 'excused');
create type public.agenda_item_type as enum (
  'missing_kpi', 'critical_path', 'overdue_task', 'blocked_task', 'stale_task',
  'issue', 'risk', 'prior_commitment', 'custom'
);
create type public.commitment_status as enum ('open', 'done', 'carried_over', 'cancelled');

create type public.document_status as enum ('draft', 'active', 'under_review', 'superseded', 'archived');
create type public.confidentiality_level as enum ('internal', 'restricted');

create type public.person_type as enum ('employee', 'partner', 'physician', 'referral_partner', 'external_contact');
create type public.person_status as enum ('active', 'inactive', 'prospect');
create type public.vendor_status as enum ('evaluating', 'active', 'inactive', 'terminated');

create type public.report_type as enum ('weekly', 'monthly');
create type public.report_status as enum ('generated', 'final');

create type public.site_status as enum ('planning', 'open', 'closed');

-- ═══ 0002_tenancy_identity_audit.sql ═══
-- EverTide OS — 0002: organizations, sites, profiles, memberships,
-- audit_events, and the authorization helper functions every RLS policy uses.

-- ── Identity and tenancy ────────────────────────────────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  slug text not null,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  timezone text not null default 'America/New_York',
  target_opening_date date,
  status public.site_status not null default 'planning',
  opening_risk_declared boolean not null default false,
  opening_risk_reason text,
  max_upload_mb integer not null default 25 check (max_upload_mb between 1 and 100),
  no_phi_warning text not null default 'Do not upload patient-identifiable information.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, slug)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  title text,
  avatar_color text not null default '#1F3864',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  role public.membership_role not null default 'member',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.site_memberships (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  user_id uuid not null references public.profiles(id),
  role_override public.membership_role,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);

-- ── Audit log (append-only) ────────────────────────────────────────────────
create table public.audit_events (
  id bigserial primary key,
  organization_id uuid not null,
  site_id uuid,
  actor_id uuid,
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_events_org_idx on public.audit_events (organization_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at desc);

-- ── Authorization helpers ───────────────────────────────────────────────────
-- SECURITY DEFINER so they can read membership tables regardless of RLS.
-- All of them are STABLE and rely on auth.uid() from the request JWT.

create or replace function app.org_role(p_org uuid)
returns public.membership_role
language sql stable security definer set search_path = public as $$
  select m.role from public.organization_memberships m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.active
  limit 1;
$$;

create or replace function app.is_org_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select app.org_role(p_org) is not null;
$$;

create or replace function app.is_org_admin(p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select app.org_role(p_org) = 'org_admin';
$$;

-- Effective role for a site: org_admins act as org_admin everywhere in their
-- org; everyone else needs an active site membership whose effective role is
-- coalesce(role_override, organization role). Never trusts profiles alone.
create or replace function app.site_role(p_site uuid)
returns public.membership_role
language sql stable security definer set search_path = public as $$
  select case
    when app.is_org_admin(s.organization_id) then 'org_admin'::public.membership_role
    else (
      select coalesce(sm.role_override, om.role)
      from public.site_memberships sm
      join public.organization_memberships om
        on om.organization_id = s.organization_id
       and om.user_id = sm.user_id
       and om.active
      where sm.site_id = p_site and sm.user_id = auth.uid() and sm.active
      limit 1
    )
  end
  from public.sites s where s.id = p_site;
$$;

create or replace function app.has_site_access(p_site uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select app.site_role(p_site) is not null;
$$;

create or replace function app.is_site_admin(p_site uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select app.site_role(p_site) in ('org_admin', 'site_admin');
$$;

-- Writer = org_admin / site_admin / member. Viewers are read-only.
create or replace function app.can_write_site(p_site uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select app.site_role(p_site) in ('org_admin', 'site_admin', 'member');
$$;

-- Access check for records that may be org-level (site_id null): org-level
-- records are visible to any active org member, writable by org_admins.
create or replace function app.can_read_scoped(p_org uuid, p_site uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_site is null then app.is_org_member(p_org)
              else app.has_site_access(p_site) end;
$$;

create or replace function app.can_write_scoped(p_org uuid, p_site uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_site is null then app.is_org_admin(p_org)
              else app.can_write_site(p_site) end;
$$;

create or replace function app.is_admin_scoped(p_org uuid, p_site uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_site is null then app.is_org_admin(p_org)
              else app.is_site_admin(p_site) end;
$$;

-- ── Common trigger functions ───────────────────────────────────────────────
create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Generic audit trigger. Records full row images for INSERT/UPDATE and an
-- archive marker instead of DELETE (business records are never hard-deleted).
-- Sensitive columns are not present in these tables, so full images are safe.
create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_org uuid := (v_new->>'organization_id')::uuid;
  -- Tables without their own site_id (e.g. sites) fall back sensibly.
  v_site uuid := coalesce((v_new->>'site_id')::uuid,
                          case when tg_table_name = 'sites' then (v_new->>'id')::uuid end);
  v_event text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, new_values)
    values (v_org, v_site, auth.uid(), tg_table_name, new.id::text, 'created', v_new);
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_event := case
      when v_old->>'archived_at' is null and v_new->>'archived_at' is not null then 'archived'
      when v_old->>'archived_at' is not null and v_new->>'archived_at' is null then 'restored'
      else 'updated'
    end;
    insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, old_values, new_values)
    values (v_org, v_site, auth.uid(), tg_table_name, new.id::text, v_event, v_old, v_new);
    return new;
  end if;
  return null;
end;
$$;

-- Variant for tables without organization_id/site_id/archived_at of their own
-- (child tables). Caller passes the parent lookup via trigger arguments —
-- kept simple: those tables get explicit audit triggers where needed instead.

comment on function app.audit_row() is
  'Generic row-audit trigger: writes created/updated/archived/restored events with old/new row images into audit_events.';

-- updated_at triggers for tenancy tables
create trigger organizations_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();
create trigger sites_updated_at before update on public.sites
  for each row execute function app.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

-- Audit membership and site changes (ownership of config matters).
create or replace function app.audit_membership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := to_jsonb(new);
  -- org memberships carry organization_id; site memberships only site_id.
  v_org uuid := coalesce(
    (v_new->>'organization_id')::uuid,
    (select organization_id from public.sites where id = (v_new->>'site_id')::uuid)
  );
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, actor_id, entity_type, entity_id, event_type, new_values)
    values (v_org, auth.uid(), tg_table_name, new.id::text, 'created', v_new);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_events (organization_id, actor_id, entity_type, entity_id, event_type, old_values, new_values)
    values (v_org, auth.uid(), tg_table_name, new.id::text, 'updated', to_jsonb(old), v_new);
    return new;
  end if;
  return null;
end;
$$;

create trigger organization_memberships_audit
  after insert or update on public.organization_memberships
  for each row execute function app.audit_membership();
create trigger site_memberships_audit
  after insert or update on public.site_memberships
  for each row execute function app.audit_membership();
create trigger sites_audit
  after insert or update on public.sites
  for each row execute function app.audit_row();

-- Bootstrap a profile row whenever an auth user is created, so magic-link
-- signups always have a profile. Name defaults to the email local part.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ═══ 0003_core_tables.sql ═══
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

-- ═══ 0004_business_triggers.sql ═══
-- EverTide OS — 0004: business-rule triggers (spec §2, §6).

-- updated_at maintenance for every mutable business table.
do $$
declare t text;
begin
  foreach t in array array[
    'goals','projects','tasks','milestones','issues','risks','decisions',
    'kpis','kpi_entries','huddles','huddle_commitments','document_folders',
    'documents','people','vendors','reports'
  ] loop
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function app.set_updated_at()',
      t, t);
  end loop;
end $$;

-- Generic audit for the main business tables (task-specific auditing below
-- adds the task_updates feed as well).
do $$
declare t text;
begin
  foreach t in array array[
    'goals','projects','milestones','issues','risks','decisions','kpis',
    'huddles','huddle_commitments','documents','people','vendors','reports'
  ] loop
    execute format(
      'create trigger %I_audit after insert or update on public.%I for each row execute function app.audit_row()',
      t, t);
  end loop;
end $$;

-- ── Tasks: transition guards (§6.3) ────────────────────────────────────────
-- Rules enforced here (beyond table CHECKs):
--  * done → any other status only by site admins (audited like everything).
--  * owner_id / due_date changes only by site admins.
--  * done tasks snap percent_done to 100.
--  * last_meaningful_update_at moves on human-meaningful changes only.
create or replace function app.task_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean;
begin
  if tg_op = 'UPDATE' then
    v_admin := app.is_site_admin(new.site_id) or auth.uid() is null; -- null uid = service role (seeds/cron)

    if old.status = 'done' and new.status <> 'done' and not v_admin then
      raise exception 'Only admins can move a done task back to another status';
    end if;
    if (new.owner_id is distinct from old.owner_id or new.due_date is distinct from old.due_date)
       and not v_admin then
      raise exception 'Only admins can change task owner or due date';
    end if;
    if (new.archived_at is distinct from old.archived_at) and not v_admin then
      raise exception 'Only admins can archive or restore tasks';
    end if;

    if new.status = 'done' then
      new.percent_done := 100;
    end if;
    if new.status <> 'blocked' then
      new.blocker_reason := null;
    end if;

    if new.status is distinct from old.status
       or new.percent_done is distinct from old.percent_done
       or new.blocker_reason is distinct from old.blocker_reason
       or new.due_date is distinct from old.due_date
       or new.notes is distinct from old.notes then
      new.last_meaningful_update_at := now();
    end if;
  elsif tg_op = 'INSERT' then
    if new.status = 'done' then
      new.percent_done := 100;
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_guard before insert or update on public.tasks
  for each row execute function app.task_guard();

-- After-update: write the append-only task_updates feed and audit_events for
-- every material change (§2.15). Comments are inserted directly by the app.
create or replace function app.task_log_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, new_values)
    values (new.organization_id, new.site_id, v_actor, 'tasks', new.id::text, 'created', to_jsonb(new));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_updates (organization_id, site_id, task_id, author_id, update_type, body, metadata)
    values (new.organization_id, new.site_id, new.id, v_actor, 'status_change',
            format('Status: %s → %s', old.status, new.status),
            jsonb_build_object('old', old.status, 'new', new.status));
  end if;
  if new.percent_done is distinct from old.percent_done then
    insert into public.task_updates (organization_id, site_id, task_id, author_id, update_type, body, metadata)
    values (new.organization_id, new.site_id, new.id, v_actor, 'percent_change',
            format('Progress: %s%% → %s%%', old.percent_done, new.percent_done),
            jsonb_build_object('old', old.percent_done, 'new', new.percent_done));
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into public.task_updates (organization_id, site_id, task_id, author_id, update_type, body, metadata)
    values (new.organization_id, new.site_id, new.id, v_actor, 'owner_change', 'Owner changed',
            jsonb_build_object('old', old.owner_id, 'new', new.owner_id));
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_updates (organization_id, site_id, task_id, author_id, update_type, body, metadata)
    values (new.organization_id, new.site_id, new.id, v_actor, 'due_date_change',
            format('Due date: %s → %s', coalesce(old.due_date::text, '—'), coalesce(new.due_date::text, '—')),
            jsonb_build_object('old', old.due_date, 'new', new.due_date));
  end if;
  if new.blocker_reason is distinct from old.blocker_reason then
    insert into public.task_updates (organization_id, site_id, task_id, author_id, update_type, body, metadata)
    values (new.organization_id, new.site_id, new.id, v_actor, 'blocker_change',
            coalesce('Blocked: ' || new.blocker_reason, 'Blocker cleared'),
            jsonb_build_object('old', old.blocker_reason, 'new', new.blocker_reason));
  end if;
  if new.archived_at is distinct from old.archived_at then
    insert into public.task_updates (organization_id, site_id, task_id, author_id, update_type, body, metadata)
    values (new.organization_id, new.site_id, new.id, v_actor, 'system',
            case when new.archived_at is null then 'Task restored' else 'Task archived' end,
            jsonb_build_object('old', old.archived_at, 'new', new.archived_at));
  end if;

  insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, old_values, new_values)
  values (new.organization_id, new.site_id, v_actor, 'tasks', new.id::text,
          case
            when old.archived_at is null and new.archived_at is not null then 'archived'
            when old.archived_at is not null and new.archived_at is null then 'restored'
            else 'updated'
          end,
          to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

create trigger tasks_log_changes after insert or update on public.tasks
  for each row execute function app.task_log_changes();

-- Human comments refresh task staleness.
create or replace function app.task_update_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.update_type = 'comment' then
    update public.tasks
      set last_meaningful_update_at = now()
      where id = new.task_id;
  end if;
  return new;
end;
$$;

create trigger task_updates_touch after insert on public.task_updates
  for each row execute function app.task_update_touch();

-- ── Issues (§6.5): huddle flag + resolution stamping ───────────────────────
create or replace function app.issue_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- High/critical open issues always surface in the next huddle.
  if new.status in ('open', 'investigating', 'action_planned') and new.priority in ('high', 'critical') then
    new.huddle_required := true;
  end if;
  if tg_op = 'UPDATE' then
    if new.status = 'resolved' and old.status <> 'resolved' then
      new.resolved_at := coalesce(new.resolved_at, now());
    end if;
    -- Reopening preserves prior resolution history in the update feed; clear
    -- the live resolution stamp so age math restarts.
    if old.status in ('resolved', 'closed') and new.status in ('open', 'investigating', 'action_planned') then
      insert into public.issue_updates (issue_id, author_id, body, metadata)
      values (new.id, auth.uid(), 'Issue reopened. Prior resolution: ' || coalesce(old.resolution_summary, '—'),
              jsonb_build_object('event', 'reopened', 'prior_resolution', old.resolution_summary,
                                 'prior_resolved_at', old.resolved_at));
      new.resolved_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger issues_guard before insert or update on public.issues
  for each row execute function app.issue_guard();

-- ── Risks (§6.6): deterministic score = probability × impact ───────────────
create or replace function app.risk_score(p public.risk_probability, i public.risk_impact)
returns integer language sql immutable as $$
  select (case p when 'low' then 1 when 'medium' then 2 when 'high' then 3 end)
       * (case i when 'low' then 1 when 'medium' then 2 when 'high' then 3 when 'severe' then 4 end);
$$;

comment on function app.risk_score is 'Deterministic risk score: probability (1-3) × impact (1-4), range 1-12.';

create or replace function app.risk_guard()
returns trigger language plpgsql as $$
begin
  new.score := app.risk_score(new.probability, new.impact);
  return new;
end;
$$;

create trigger risks_guard before insert or update on public.risks
  for each row execute function app.risk_guard();

-- ── Decisions (§6.7): immutability after approval ──────────────────────────
-- Once approved, the substance of a decision is frozen. Only implementation
-- status, effective/review dates, outcome fields, and supersession may change.
-- Admin corrections go through app.admin_correct_decision (0007) which logs a
-- reasoned audit event and is the single sanctioned bypass.
create or replace function app.decision_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status in ('approved', 'implemented', 'superseded') then
    if current_setting('app.decision_correction', true) = 'on' then
      return new; -- sanctioned admin correction path (audited by the RPC)
    end if;
    if new.title is distinct from old.title
       or new.context is distinct from old.context
       or new.decision_text is distinct from old.decision_text
       or new.rationale is distinct from old.rationale
       or new.alternatives_considered is distinct from old.alternatives_considered
       or new.decision_date is distinct from old.decision_date
       or new.owner_id is distinct from old.owner_id
       or new.approved_by_id is distinct from old.approved_by_id then
      raise exception 'Approved decisions are immutable; supersede them or use an admin correction';
    end if;
    if new.status = 'proposed' then
      raise exception 'An approved decision cannot return to proposed';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.outcome is distinct from old.outcome and new.outcome is not null then
    new.outcome_recorded_at := now();
  end if;
  return new;
end;
$$;

create trigger decisions_guard before update on public.decisions
  for each row execute function app.decision_guard();

-- ── KPI entries: audit (incl. status overrides, §6.8) ──────────────────────
create or replace function app.kpi_entry_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_site uuid;
begin
  select organization_id, site_id into v_org, v_site from public.kpis where id = new.kpi_id;
  if tg_op = 'UPDATE' and new.status_override_note is distinct from old.status_override_note
     and new.status_override_note is not null then
    insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, old_values, new_values, metadata)
    values (v_org, v_site, auth.uid(), 'kpi_entries', new.id::text, 'status_override',
            to_jsonb(old), to_jsonb(new), jsonb_build_object('note', new.status_override_note));
  else
    insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, old_values, new_values)
    values (v_org, v_site, auth.uid(), 'kpi_entries', new.id::text,
            case tg_op when 'INSERT' then 'created' else 'updated' end,
            case tg_op when 'INSERT' then null else to_jsonb(old) end, to_jsonb(new));
  end if;
  return new;
end;
$$;

create trigger kpi_entries_audit after insert or update on public.kpi_entries
  for each row execute function app.kpi_entry_audit();

-- ── Reports: immutable once final (§6.12) ──────────────────────────────────
create or replace function app.report_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'final' then
    raise exception 'Finalized reports are immutable';
  end if;
  return new;
end;
$$;

create trigger reports_guard before update on public.reports
  for each row execute function app.report_guard();

-- ── Huddles: frozen once completed except archive (§6.9) ───────────────────
create or replace function app.huddle_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status = 'completed' then
    if new.agenda_snapshot is distinct from old.agenda_snapshot
       or new.huddle_date is distinct from old.huddle_date
       or new.status is distinct from old.status then
      raise exception 'Completed huddles are frozen';
    end if;
  end if;
  return new;
end;
$$;

create trigger huddles_guard before update on public.huddles
  for each row execute function app.huddle_guard();

-- ── Document versions are immutable ────────────────────────────────────────
create or replace function app.forbid_change()
returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end;
$$;

create trigger document_versions_immutable before update or delete on public.document_versions
  for each row execute function app.forbid_change();
create trigger task_updates_immutable before update or delete on public.task_updates
  for each row execute function app.forbid_change();
create trigger issue_updates_immutable before update or delete on public.issue_updates
  for each row execute function app.forbid_change();
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function app.forbid_change();

-- ═══ 0005_rls_policies.sql ═══
-- EverTide OS — 0005: Row Level Security on every exposed table (spec §11.1).
-- Server actions re-check authorization; RLS is the final enforcement layer.

-- Archive/restore of business records is admin-only (§5 member limits).
create or replace function app.archive_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is distinct from old.archived_at
     and auth.uid() is not null
     and not app.is_admin_scoped(new.organization_id, new.site_id) then
    raise exception 'Only admins can archive or restore records';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'goals','projects','milestones','issues','risks','decisions','kpis',
    'huddles','huddle_commitments','document_folders','documents','people','vendors'
  ] loop
    execute format(
      'create trigger %I_archive_guard before update on public.%I for each row execute function app.archive_guard()',
      t, t);
  end loop;
end $$;

-- Profiles are visible to anyone sharing an organization (owner pickers, etc.).
create or replace function app.shares_org_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id and theirs.active
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = p_user
  );
$$;

-- Access helpers for child rows.
create or replace function app.can_read_document(p_doc uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_doc
      and app.can_read_scoped(d.organization_id, d.site_id)
      and (
        d.confidentiality = 'internal'
        or app.is_admin_scoped(d.organization_id, d.site_id)
        or d.owner_id = auth.uid()
        or exists (select 1 from public.document_access_grants g
                   where g.document_id = d.id and g.user_id = auth.uid())
      )
  );
$$;

-- ── Enable RLS everywhere ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','sites','profiles','organization_memberships','site_memberships',
    'audit_events','goals','goal_links','projects','tasks','task_helpers','task_updates',
    'task_dependencies','milestones','issues','issue_updates','risks','decisions',
    'decision_links','kpis','kpi_entries','huddles','huddle_attendees',
    'huddle_agenda_items','huddle_commitments','document_folders','documents',
    'document_versions','document_links','document_access_grants','people','vendors',
    'vendor_links','reports','notifications','raci_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── Tenancy ────────────────────────────────────────────────────────────────
create policy organizations_select on public.organizations
  for select using (app.is_org_member(id));
create policy organizations_update on public.organizations
  for update using (app.is_org_admin(id)) with check (app.is_org_admin(id));

create policy sites_select on public.sites
  for select using (app.has_site_access(id));
create policy sites_update on public.sites
  for update using (app.is_site_admin(id)) with check (app.is_site_admin(id));
create policy sites_insert on public.sites
  for insert with check (app.is_org_admin(organization_id));

create policy profiles_select on public.profiles
  for select using (id = auth.uid() or app.shares_org_with(id));
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy org_memberships_select on public.organization_memberships
  for select using (user_id = auth.uid() or app.is_org_member(organization_id));
create policy org_memberships_write on public.organization_memberships
  for all using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy site_memberships_select on public.site_memberships
  for select using (user_id = auth.uid() or app.has_site_access(site_id));
create policy site_memberships_write on public.site_memberships
  for all using (app.is_org_admin((select organization_id from public.sites s where s.id = site_id)))
  with check (app.is_org_admin((select organization_id from public.sites s where s.id = site_id)));

-- ── Audit: admins only; no insert/update/delete from clients (§11.13) ──────
create policy audit_events_select on public.audit_events
  for select using (app.is_admin_scoped(organization_id, site_id));

-- ── Strategy ───────────────────────────────────────────────────────────────
create policy goals_select on public.goals
  for select using (app.can_read_scoped(organization_id, site_id));
create policy goals_insert on public.goals
  for insert with check (app.can_write_scoped(organization_id, site_id) and created_by = auth.uid());
create policy goals_update on public.goals
  for update using (app.can_write_scoped(organization_id, site_id))
  with check (app.can_write_scoped(organization_id, site_id));

create policy goal_links_select on public.goal_links
  for select using (exists (select 1 from public.goals g where g.id = goal_id
                            and app.can_read_scoped(g.organization_id, g.site_id)));
create policy goal_links_write on public.goal_links
  for all using (exists (select 1 from public.goals g where g.id = goal_id
                         and app.can_write_scoped(g.organization_id, g.site_id)))
  with check (exists (select 1 from public.goals g where g.id = goal_id
                      and app.can_write_scoped(g.organization_id, g.site_id)));

-- ── Projects & tasks ───────────────────────────────────────────────────────
create policy projects_select on public.projects
  for select using (app.has_site_access(site_id));
create policy projects_insert on public.projects
  for insert with check (app.can_write_site(site_id));
create policy projects_update on public.projects
  for update using (app.can_write_site(site_id)) with check (app.can_write_site(site_id));

create policy tasks_select on public.tasks
  for select using (app.has_site_access(site_id));
create policy tasks_insert on public.tasks
  for insert with check (app.can_write_site(site_id));
create policy tasks_update on public.tasks
  for update using (app.can_write_site(site_id)) with check (app.can_write_site(site_id));

create policy task_helpers_select on public.task_helpers
  for select using (exists (select 1 from public.tasks t where t.id = task_id and app.has_site_access(t.site_id)));
create policy task_helpers_write on public.task_helpers
  for all using (exists (select 1 from public.tasks t where t.id = task_id and app.can_write_site(t.site_id)))
  with check (exists (select 1 from public.tasks t where t.id = task_id and app.can_write_site(t.site_id)));

create policy task_updates_select on public.task_updates
  for select using (app.has_site_access(site_id));
-- Clients may only add comments; system rows come from triggers (definer).
create policy task_updates_insert on public.task_updates
  for insert with check (
    app.can_write_site(site_id) and author_id = auth.uid() and update_type = 'comment'
  );

create policy task_dependencies_select on public.task_dependencies
  for select using (exists (select 1 from public.tasks t where t.id = predecessor_task_id and app.has_site_access(t.site_id)));
create policy task_dependencies_write on public.task_dependencies
  for all using (exists (select 1 from public.tasks t where t.id = predecessor_task_id and app.can_write_site(t.site_id)))
  with check (exists (select 1 from public.tasks t where t.id = predecessor_task_id and app.can_write_site(t.site_id)));

-- ── Milestones ─────────────────────────────────────────────────────────────
create policy milestones_select on public.milestones
  for select using (app.has_site_access(site_id));
create policy milestones_insert on public.milestones
  for insert with check (app.can_write_site(site_id));
create policy milestones_update on public.milestones
  for update using (app.can_write_site(site_id)) with check (app.can_write_site(site_id));

-- ── Issues ─────────────────────────────────────────────────────────────────
create policy issues_select on public.issues
  for select using (app.has_site_access(site_id));
create policy issues_insert on public.issues
  for insert with check (app.can_write_site(site_id));
create policy issues_update on public.issues
  for update using (app.can_write_site(site_id)) with check (app.can_write_site(site_id));

create policy issue_updates_select on public.issue_updates
  for select using (exists (select 1 from public.issues i where i.id = issue_id and app.has_site_access(i.site_id)));
create policy issue_updates_insert on public.issue_updates
  for insert with check (
    author_id = auth.uid()
    and exists (select 1 from public.issues i where i.id = issue_id and app.can_write_site(i.site_id))
  );

-- ── Risks ──────────────────────────────────────────────────────────────────
create policy risks_select on public.risks
  for select using (app.has_site_access(site_id));
create policy risks_insert on public.risks
  for insert with check (app.can_write_site(site_id));
create policy risks_update on public.risks
  for update using (app.can_write_site(site_id)) with check (app.can_write_site(site_id));

-- ── Decisions ──────────────────────────────────────────────────────────────
create policy decisions_select on public.decisions
  for select using (app.can_read_scoped(organization_id, site_id));
create policy decisions_insert on public.decisions
  for insert with check (app.can_write_scoped(organization_id, site_id) and created_by = auth.uid());
create policy decisions_update on public.decisions
  for update using (app.can_write_scoped(organization_id, site_id))
  with check (app.can_write_scoped(organization_id, site_id));

create policy decision_links_select on public.decision_links
  for select using (exists (select 1 from public.decisions d where d.id = decision_id
                            and app.can_read_scoped(d.organization_id, d.site_id)));
create policy decision_links_write on public.decision_links
  for all using (exists (select 1 from public.decisions d where d.id = decision_id
                         and app.can_write_scoped(d.organization_id, d.site_id)))
  with check (exists (select 1 from public.decisions d where d.id = decision_id
                      and app.can_write_scoped(d.organization_id, d.site_id)));

-- ── KPIs ───────────────────────────────────────────────────────────────────
-- Definitions are admin configuration; entries are written by the KPI owner
-- or an admin (§5: members update "their KPI entries").
create policy kpis_select on public.kpis
  for select using (app.has_site_access(site_id));
create policy kpis_write on public.kpis
  for all using (app.is_site_admin(site_id)) with check (app.is_site_admin(site_id));

create policy kpi_entries_select on public.kpi_entries
  for select using (exists (select 1 from public.kpis k where k.id = kpi_id and app.has_site_access(k.site_id)));
create policy kpi_entries_insert on public.kpi_entries
  for insert with check (exists (
    select 1 from public.kpis k where k.id = kpi_id
    and (k.owner_id = auth.uid() or app.is_site_admin(k.site_id))
  ));
create policy kpi_entries_update on public.kpi_entries
  for update using (exists (
    select 1 from public.kpis k where k.id = kpi_id
    and (k.owner_id = auth.uid() or app.is_site_admin(k.site_id))
  ))
  with check (exists (
    select 1 from public.kpis k where k.id = kpi_id
    and (k.owner_id = auth.uid() or app.is_site_admin(k.site_id))
  ));

-- ── Huddles ────────────────────────────────────────────────────────────────
create policy huddles_select on public.huddles
  for select using (app.has_site_access(site_id));
create policy huddles_insert on public.huddles
  for insert with check (app.can_write_site(site_id));
create policy huddles_update on public.huddles
  for update using (app.can_write_site(site_id)) with check (app.can_write_site(site_id));

create policy huddle_attendees_select on public.huddle_attendees
  for select using (exists (select 1 from public.huddles h where h.id = huddle_id and app.has_site_access(h.site_id)));
create policy huddle_attendees_write on public.huddle_attendees
  for all using (exists (select 1 from public.huddles h where h.id = huddle_id and app.can_write_site(h.site_id)))
  with check (exists (select 1 from public.huddles h where h.id = huddle_id and app.can_write_site(h.site_id)));

create policy huddle_agenda_select on public.huddle_agenda_items
  for select using (exists (select 1 from public.huddles h where h.id = huddle_id and app.has_site_access(h.site_id)));
create policy huddle_agenda_write on public.huddle_agenda_items
  for all using (exists (select 1 from public.huddles h where h.id = huddle_id and app.can_write_site(h.site_id)))
  with check (exists (select 1 from public.huddles h where h.id = huddle_id and app.can_write_site(h.site_id)));

create policy commitments_select on public.huddle_commitments
  for select using (app.has_site_access(site_id));
create policy commitments_insert on public.huddle_commitments
  for insert with check (app.can_write_site(site_id));
create policy commitments_update on public.huddle_commitments
  for update using (app.can_write_site(site_id)) with check (app.can_write_site(site_id));

-- ── Documents ──────────────────────────────────────────────────────────────
create policy document_folders_select on public.document_folders
  for select using (app.can_read_scoped(organization_id, site_id));
create policy document_folders_write on public.document_folders
  for all using (app.is_admin_scoped(organization_id, site_id))
  with check (app.is_admin_scoped(organization_id, site_id));

create policy documents_select on public.documents
  for select using (app.can_read_document(id));
create policy documents_insert on public.documents
  for insert with check (app.can_write_scoped(organization_id, site_id) and created_by = auth.uid());
create policy documents_update on public.documents
  for update using (app.can_read_document(id) and app.can_write_scoped(organization_id, site_id))
  with check (app.can_write_scoped(organization_id, site_id));

create policy document_versions_select on public.document_versions
  for select using (app.can_read_document(document_id));
create policy document_versions_insert on public.document_versions
  for insert with check (
    app.can_read_document(document_id)
    and exists (select 1 from public.documents d where d.id = document_id
                and app.can_write_scoped(d.organization_id, d.site_id))
  );

create policy document_links_select on public.document_links
  for select using (app.can_read_document(document_id));
create policy document_links_write on public.document_links
  for all using (app.can_read_document(document_id))
  with check (app.can_read_document(document_id));

create policy document_grants_select on public.document_access_grants
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.documents d where d.id = document_id
               and app.is_admin_scoped(d.organization_id, d.site_id))
  );
create policy document_grants_write on public.document_access_grants
  for all using (exists (select 1 from public.documents d where d.id = document_id
                         and app.is_admin_scoped(d.organization_id, d.site_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id
                      and app.is_admin_scoped(d.organization_id, d.site_id)));

-- ── People & vendors ───────────────────────────────────────────────────────
create policy people_select on public.people
  for select using (app.can_read_scoped(organization_id, site_id));
create policy people_insert on public.people
  for insert with check (app.can_write_scoped(organization_id, site_id));
create policy people_update on public.people
  for update using (app.can_write_scoped(organization_id, site_id))
  with check (app.can_write_scoped(organization_id, site_id));

create policy vendors_select on public.vendors
  for select using (app.can_read_scoped(organization_id, site_id));
create policy vendors_insert on public.vendors
  for insert with check (app.can_write_scoped(organization_id, site_id));
create policy vendors_update on public.vendors
  for update using (app.can_write_scoped(organization_id, site_id))
  with check (app.can_write_scoped(organization_id, site_id));

create policy vendor_links_select on public.vendor_links
  for select using (exists (select 1 from public.vendors v where v.id = vendor_id
                            and app.can_read_scoped(v.organization_id, v.site_id)));
create policy vendor_links_write on public.vendor_links
  for all using (exists (select 1 from public.vendors v where v.id = vendor_id
                         and app.can_write_scoped(v.organization_id, v.site_id)))
  with check (exists (select 1 from public.vendors v where v.id = vendor_id
                      and app.can_write_scoped(v.organization_id, v.site_id)));

-- ── Reports ────────────────────────────────────────────────────────────────
create policy reports_select on public.reports
  for select using (app.has_site_access(site_id));
create policy reports_insert on public.reports
  for insert with check (app.is_site_admin(site_id));
create policy reports_update on public.reports
  for update using (app.is_site_admin(site_id)) with check (app.is_site_admin(site_id));

-- ── Notifications: strictly personal; hard delete allowed (§2.7) ──────────
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications
  for delete using (user_id = auth.uid());

-- ── RACI reference ─────────────────────────────────────────────────────────
create policy raci_select on public.raci_entries
  for select using (app.can_read_scoped(organization_id, site_id));
create policy raci_write on public.raci_entries
  for all using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

-- ═══ 0006_storage_realtime.sql ═══
-- EverTide OS — 0006: private storage bucket and Realtime publication.

-- Private bucket for all document versions. Paths follow
--   {organization_id}/{site_id|org}/{document_id}/{version_id}-{filename}
insert into storage.buckets (id, name, public, file_size_limit)
values ('evertide-documents', 'evertide-documents', false, 26214400) -- 25 MB default
on conflict (id) do nothing;

-- All uploads and downloads flow through server routes that validate
-- membership, size, and type, then use the service role (which bypasses RLS)
-- and hand out short-lived signed URLs. Browser clients get no direct access,
-- so the only storage.objects policies are deny-by-default (RLS enabled, no
-- permissive policies for this bucket). This is the tightest possible stance:
-- cross-tenant access via storage keys is impossible for client tokens.

-- Realtime (§8): broadcast changes for the collaborative tables.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table
  public.tasks,
  public.task_updates,
  public.issues,
  public.issue_updates,
  public.kpi_entries,
  public.huddles,
  public.huddle_commitments,
  public.decisions,
  public.notifications;

-- Full row images so realtime payloads carry old values for updates.
alter table public.tasks replica identity full;
alter table public.issues replica identity full;
alter table public.kpi_entries replica identity full;
alter table public.huddles replica identity full;
alter table public.huddle_commitments replica identity full;
alter table public.decisions replica identity full;

-- ═══ 0007_rpcs.sql ═══
-- EverTide OS — 0007: transactional RPCs for multi-step state changes (§8).
-- All run as SECURITY INVOKER so RLS still applies; admin-only actions also
-- re-check roles explicitly. Each raises on violation, so callers get atomic
-- all-or-nothing behavior.

-- Current weekly scorecard period start (Monday) in the site's timezone (§6.8).
create or replace function public.weekly_period_start(p_site uuid, p_at timestamptz default now())
returns date
language sql stable security definer set search_path = public as $$
  select date_trunc('week', (p_at at time zone s.timezone))::date
  from public.sites s where s.id = p_site;
$$;

comment on function public.weekly_period_start is
  'Monday of the current week in the site''s local timezone; weekly KPI periods key off this.';

-- ── Huddles ────────────────────────────────────────────────────────────────
-- Starting a huddle snapshots the auto-generated agenda (§6.9): missing KPIs
-- first, then critical path, overdue, blocked, stale, issues, risks, and
-- prior open commitments.
create or replace function public.start_huddle(p_huddle uuid)
returns uuid
language plpgsql volatile as $$
declare
  h public.huddles%rowtype;
  v_week date;
  v_sort integer := 0;
  r record;
begin
  select * into h from public.huddles where id = p_huddle for update;
  if not found then raise exception 'Huddle not found'; end if;
  if h.status <> 'draft' then raise exception 'Huddle already started'; end if;

  v_week := public.weekly_period_start(h.site_id);

  -- 1. Missing weekly KPIs come first (§2.10).
  for r in
    select k.id, k.name from public.kpis k
    where k.site_id = h.site_id and k.active and k.archived_at is null and k.frequency = 'weekly'
      and not exists (select 1 from public.kpi_entries e
                      where e.kpi_id = k.id and e.period_start = v_week and e.value is not null)
    order by k.sort_order
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'missing_kpi', r.id, 'MISSING KPI: ' || r.name, v_sort);
  end loop;

  -- 2. Critical-path tasks not done.
  for r in
    select t.id, t.title from public.tasks t
    where t.site_id = h.site_id and t.archived_at is null and t.critical and t.status <> 'done'
    order by t.due_date nulls last
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'critical_path', r.id, 'Critical path: ' || r.title, v_sort);
  end loop;

  -- 3. Overdue tasks.
  for r in
    select t.id, t.title from public.tasks t
    where t.site_id = h.site_id and t.archived_at is null and t.status <> 'done'
      and t.due_date is not null and t.due_date < (now() at time zone (select timezone from public.sites where id = h.site_id))::date
    order by t.due_date
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'overdue_task', r.id, 'Overdue: ' || r.title, v_sort);
  end loop;

  -- 4. Blocked tasks.
  for r in
    select t.id, t.title, t.blocker_reason from public.tasks t
    where t.site_id = h.site_id and t.archived_at is null and t.status = 'blocked'
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'blocked_task', r.id, 'Blocked: ' || r.title || ' — ' || coalesce(r.blocker_reason, ''), v_sort);
  end loop;

  -- 5. Stale tasks: in progress, no meaningful update for 7+ days.
  for r in
    select t.id, t.title from public.tasks t
    where t.site_id = h.site_id and t.archived_at is null and t.status = 'in_progress'
      and t.last_meaningful_update_at < now() - interval '7 days'
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'stale_task', r.id, 'Stale: ' || r.title, v_sort);
  end loop;

  -- 6. High/critical open issues (§6.5) and anything flagged huddle_required.
  for r in
    select i.id, i.title, i.priority from public.issues i
    where i.site_id = h.site_id and i.archived_at is null
      and i.status in ('open', 'investigating', 'action_planned')
      and (i.priority in ('high', 'critical') or i.huddle_required)
    order by i.priority desc
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'issue', r.id, 'Issue [' || r.priority || ']: ' || r.title, v_sort);
  end loop;

  -- 7. High/severe risks (score ≥ 6).
  for r in
    select k.id, k.title, k.score from public.risks k
    where k.site_id = h.site_id and k.archived_at is null
      and k.status in ('open', 'monitoring', 'mitigating') and k.score >= 6
    order by k.score desc
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'risk', r.id, 'Risk (score ' || r.score || '): ' || r.title, v_sort);
  end loop;

  -- 8. Prior open commitments.
  for r in
    select c.id, c.commitment, c.carry_count from public.huddle_commitments c
    where c.site_id = h.site_id and c.archived_at is null and c.status = 'open' and c.huddle_id <> p_huddle
    order by c.due_date
  loop
    v_sort := v_sort + 1;
    insert into public.huddle_agenda_items (huddle_id, item_type, linked_id, title, sort_order)
    values (p_huddle, 'prior_commitment', r.id,
            'Commitment: ' || r.commitment || case when r.carry_count > 0 then ' (Carried ' || r.carry_count || 'x)' else '' end,
            v_sort);
  end loop;

  update public.huddles
    set status = 'in_progress', started_at = now()
    where id = p_huddle;

  return p_huddle;
end;
$$;

-- Ending a huddle requires every open prior commitment to be resolved (§6.9)
-- and freezes the agenda snapshot so history never changes.
create or replace function public.end_huddle(p_huddle uuid)
returns uuid
language plpgsql volatile as $$
declare
  h public.huddles%rowtype;
  v_open integer;
  v_snapshot jsonb;
begin
  select * into h from public.huddles where id = p_huddle for update;
  if not found then raise exception 'Huddle not found'; end if;
  if h.status <> 'in_progress' then raise exception 'Huddle is not in progress'; end if;

  select count(*) into v_open
  from public.huddle_commitments c
  where c.site_id = h.site_id and c.archived_at is null
    and c.status = 'open' and c.huddle_id <> p_huddle;
  if v_open > 0 then
    raise exception 'Cannot end huddle: % prior commitment(s) still open — mark each done, carried over, or cancelled', v_open;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_type', a.item_type, 'linked_id', a.linked_id, 'title', a.title,
           'sort_order', a.sort_order, 'disposition', a.disposition)
         order by a.sort_order), '[]'::jsonb)
    into v_snapshot
  from public.huddle_agenda_items a where a.huddle_id = p_huddle;

  update public.huddles
    set status = 'completed', ended_at = now(), agenda_snapshot = v_snapshot
    where id = p_huddle;

  return p_huddle;
end;
$$;

-- Carrying a commitment forward: new linked commitment on the new huddle with
-- carry_count+1; the original is marked carried_over (§6.9).
create or replace function public.carry_commitment(p_commitment uuid, p_new_huddle uuid, p_due date)
returns uuid
language plpgsql volatile as $$
declare
  c public.huddle_commitments%rowtype;
  v_new uuid;
begin
  select * into c from public.huddle_commitments where id = p_commitment for update;
  if not found then raise exception 'Commitment not found'; end if;
  if c.status <> 'open' then raise exception 'Only open commitments can be carried over'; end if;

  insert into public.huddle_commitments
    (organization_id, site_id, huddle_id, source_commitment_id, commitment, owner_id, due_date, status, carry_count)
  values
    (c.organization_id, c.site_id, p_new_huddle, c.id, c.commitment, c.owner_id, p_due, 'open', c.carry_count + 1)
  returning id into v_new;

  update public.huddle_commitments
    set status = 'carried_over'
    where id = p_commitment;

  return v_new;
end;
$$;

-- ── Decisions ──────────────────────────────────────────────────────────────
create or replace function public.approve_decision(p_decision uuid, p_effective date default null)
returns uuid
language plpgsql volatile as $$
declare
  d public.decisions%rowtype;
begin
  select * into d from public.decisions where id = p_decision for update;
  if not found then raise exception 'Decision not found'; end if;
  if d.status <> 'proposed' then raise exception 'Only proposed decisions can be approved'; end if;
  if not app.is_admin_scoped(d.organization_id, d.site_id) then
    raise exception 'Only admins can approve decisions';
  end if;

  update public.decisions
    set status = 'approved', approved_by_id = auth.uid(),
        effective_date = coalesce(p_effective, effective_date, current_date)
    where id = p_decision;
  return p_decision;
end;
$$;

-- Supersede an approved decision with a new proposed/approved one.
create or replace function public.supersede_decision(p_old uuid, p_new uuid)
returns uuid
language plpgsql volatile as $$
declare
  d_old public.decisions%rowtype;
begin
  select * into d_old from public.decisions where id = p_old for update;
  if not found then raise exception 'Decision not found'; end if;
  if d_old.status not in ('approved', 'implemented') then
    raise exception 'Only approved or implemented decisions can be superseded';
  end if;
  if not app.is_admin_scoped(d_old.organization_id, d_old.site_id) then
    raise exception 'Only admins can supersede decisions';
  end if;

  update public.decisions set supersedes_decision_id = p_old where id = p_new;
  update public.decisions set status = 'superseded' where id = p_old;
  return p_new;
end;
$$;

-- Admin correction of an approved decision: the one sanctioned bypass of
-- immutability. Requires a reason and writes an explicit audit event (§6.7).
-- SECURITY DEFINER because clients may not insert audit events directly;
-- the explicit is_admin_scoped check below is the authorization gate.
create or replace function public.admin_correct_decision(
  p_decision uuid, p_reason text, p_fields jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  d public.decisions%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A correction reason is required';
  end if;
  select * into d from public.decisions where id = p_decision for update;
  if not found then raise exception 'Decision not found'; end if;
  if not app.is_admin_scoped(d.organization_id, d.site_id) then
    raise exception 'Only admins can correct decisions';
  end if;

  perform set_config('app.decision_correction', 'on', true);
  update public.decisions set
    title = coalesce(p_fields->>'title', title),
    context = coalesce(p_fields->>'context', context),
    decision_text = coalesce(p_fields->>'decision_text', decision_text),
    rationale = coalesce(p_fields->>'rationale', rationale),
    alternatives_considered = coalesce(p_fields->>'alternatives_considered', alternatives_considered)
    where id = p_decision;
  perform set_config('app.decision_correction', 'off', true);

  insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, metadata)
  select d.organization_id, d.site_id, auth.uid(), 'decisions', d.id::text, 'admin_correction',
         jsonb_build_object('reason', p_reason, 'fields', p_fields);
  return p_decision;
end;
$$;

-- ── Documents ──────────────────────────────────────────────────────────────
-- Register an uploaded file as the next immutable version and point the
-- document at it (§6.10). Storage upload happens server-side first.
create or replace function public.add_document_version(
  p_document uuid, p_storage_path text, p_original_filename text,
  p_mime_type text, p_size_bytes bigint, p_checksum text, p_change_summary text
)
returns uuid
language plpgsql volatile as $$
declare
  v_next integer;
  v_id uuid;
begin
  select coalesce(max(version_number), 0) + 1 into v_next
  from public.document_versions where document_id = p_document;

  insert into public.document_versions
    (document_id, version_number, storage_path, original_filename, mime_type, size_bytes, checksum, change_summary, uploaded_by)
  values
    (p_document, v_next, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, p_checksum, p_change_summary, auth.uid())
  returning id into v_id;

  update public.documents
    set current_version_id = v_id, updated_by = auth.uid(),
        status = case when status = 'draft' then 'active' else status end
    where id = p_document;

  return v_id;
end;
$$;

-- ── Risks ──────────────────────────────────────────────────────────────────
-- Convert an occurred risk into a linked issue while retaining the risk (§7.8).
create or replace function public.convert_risk_to_issue(p_risk uuid)
returns uuid
language plpgsql volatile as $$
declare
  k public.risks%rowtype;
  v_issue uuid;
begin
  select * into k from public.risks where id = p_risk for update;
  if not found then raise exception 'Risk not found'; end if;
  if k.converted_issue_id is not null then return k.converted_issue_id; end if;

  insert into public.issues
    (organization_id, site_id, project_id, task_id, title, description, category,
     priority, status, owner_id, reported_by)
  values
    (k.organization_id, k.site_id, k.project_id, k.task_id,
     'Occurred risk: ' || k.title,
     coalesce(k.description, '') || case when k.mitigation_plan is not null
       then E'\n\nMitigation plan at time of occurrence:\n' || k.mitigation_plan else '' end,
     coalesce(k.category, 'risk'),
     case when k.impact = 'severe' then 'critical'::public.priority_level else 'high'::public.priority_level end,
     'open', k.owner_id, auth.uid())
  returning id into v_issue;

  update public.risks
    set status = 'occurred', disposition = 'occurred', converted_issue_id = v_issue
    where id = p_risk;

  return v_issue;
end;
$$;

-- ── Opening-risk declaration (§7.14) ───────────────────────────────────────
create or replace function public.declare_opening_risk(p_site uuid, p_declared boolean, p_reason text)
returns void
language plpgsql volatile as $$
begin
  if not app.is_site_admin(p_site) then
    raise exception 'Only admins can declare opening risk';
  end if;
  if p_declared and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'A reason is required to declare opening risk';
  end if;
  update public.sites
    set opening_risk_declared = p_declared,
        opening_risk_reason = case when p_declared then p_reason else null end
    where id = p_site;
end;
$$;

grant usage on schema public to authenticated;
grant execute on function
  public.weekly_period_start, public.start_huddle, public.end_huddle,
  public.carry_commitment, public.approve_decision, public.supersede_decision,
  public.admin_correct_decision, public.add_document_version,
  public.convert_risk_to_issue, public.declare_opening_risk
to authenticated;
