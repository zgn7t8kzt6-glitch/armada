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
