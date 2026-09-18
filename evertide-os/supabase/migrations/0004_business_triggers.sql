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
