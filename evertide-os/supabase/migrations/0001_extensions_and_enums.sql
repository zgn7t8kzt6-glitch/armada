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
