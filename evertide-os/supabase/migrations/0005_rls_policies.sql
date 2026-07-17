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
