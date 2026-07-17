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
  v_org uuid;
  v_site uuid;
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_org := new.organization_id; v_site := new.site_id; v_event := 'created';
    insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, new_values)
    values (v_org, v_site, auth.uid(), tg_table_name, new.id::text, v_event, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    v_org := new.organization_id; v_site := new.site_id;
    v_event := case
      when old.archived_at is null and new.archived_at is not null then 'archived'
      when old.archived_at is not null and new.archived_at is null then 'restored'
      else 'updated'
    end;
    insert into public.audit_events (organization_id, site_id, actor_id, entity_type, entity_id, event_type, old_values, new_values)
    values (v_org, v_site, auth.uid(), tg_table_name, new.id::text, v_event, to_jsonb(old), to_jsonb(new));
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
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (organization_id, actor_id, entity_type, entity_id, event_type, new_values)
    values (coalesce(new.organization_id, (select organization_id from public.sites where id = new.site_id)),
            auth.uid(), tg_table_name, new.id::text, 'created', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_events (organization_id, actor_id, entity_type, entity_id, event_type, old_values, new_values)
    values (coalesce(new.organization_id, (select organization_id from public.sites where id = new.site_id)),
            auth.uid(), tg_table_name, new.id::text, 'updated', to_jsonb(old), to_jsonb(new));
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
