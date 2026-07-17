-- EverTide OS — seed data (§12). Idempotent: safe to run more than once.
-- Paste into the Supabase SQL Editor and Run AFTER setup.sql.
-- (Generated from scripts/seed-data.ts by scripts/generate-sql.ts — do not edit.)

do $seed$
declare
  v_org uuid;
  v_site uuid;
  v_project uuid;
  v_task uuid;
  v_user uuid;
begin

  -- user: Shlomo
  select id into v_user from auth.users where email = 'shlomo@evertide.example';
  if v_user is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', 'shlomo@evertide.example', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', 'Shlomo'), now(), now())
    returning id into v_user;
  end if;
  insert into public.profiles (id, name, email, title, avatar_color)
  values (v_user, 'Shlomo', 'shlomo@evertide.example', 'CEO', '#1F3864')
  on conflict (id) do update set name = excluded.name, title = excluded.title, avatar_color = excluded.avatar_color;

  -- user: Jared Friedman
  select id into v_user from auth.users where email = 'jared@evertide.example';
  if v_user is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', 'jared@evertide.example', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', 'Jared Friedman'), now(), now())
    returning id into v_user;
  end if;
  insert into public.profiles (id, name, email, title, avatar_color)
  values (v_user, 'Jared Friedman', 'jared@evertide.example', 'Chief Development Officer', '#2E7D6B')
  on conflict (id) do update set name = excluded.name, title = excluded.title, avatar_color = excluded.avatar_color;

  -- user: Dr. Zev Neurwith
  select id into v_user from auth.users where email = 'zev@evertide.example';
  if v_user is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', 'zev@evertide.example', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', 'Dr. Zev Neurwith'), now(), now())
    returning id into v_user;
  end if;
  insert into public.profiles (id, name, email, title, avatar_color)
  values (v_user, 'Dr. Zev Neurwith', 'zev@evertide.example', 'Chief Medical Officer', '#7C3AED')
  on conflict (id) do update set name = excluded.name, title = excluded.title, avatar_color = excluded.avatar_color;

  -- user: Mordechai Neurwith
  select id into v_user from auth.users where email = 'mordechai@evertide.example';
  if v_user is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', 'mordechai@evertide.example', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', 'Mordechai Neurwith'), now(), now())
    returning id into v_user;
  end if;
  insert into public.profiles (id, name, email, title, avatar_color)
  values (v_user, 'Mordechai Neurwith', 'mordechai@evertide.example', 'Operations', '#B45309')
  on conflict (id) do update set name = excluded.name, title = excluded.title, avatar_color = excluded.avatar_color;

  -- user: Aaron Jacobs
  select id into v_user from auth.users where email = 'aaron@evertide.example';
  if v_user is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', 'aaron@evertide.example', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', 'Aaron Jacobs'), now(), now())
    returning id into v_user;
  end if;
  insert into public.profiles (id, name, email, title, avatar_color)
  values (v_user, 'Aaron Jacobs', 'aaron@evertide.example', 'RCM / Billing & Authorizations', '#0E7490')
  on conflict (id) do update set name = excluded.name, title = excluded.title, avatar_color = excluded.avatar_color;

  -- user: Richard Hunt
  select id into v_user from auth.users where email = 'richard@evertide.example';
  if v_user is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', 'richard@evertide.example', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', 'Richard Hunt'), now(), now())
    returning id into v_user;
  end if;
  insert into public.profiles (id, name, email, title, avatar_color)
  values (v_user, 'Richard Hunt', 'richard@evertide.example', 'Support, part-time', '#4D7C0F')
  on conflict (id) do update set name = excluded.name, title = excluded.title, avatar_color = excluded.avatar_color;

  -- organization + site
  insert into public.organizations (name, slug) values ('EverTide Infusion', 'evertide-infusion')
  on conflict (slug) do nothing;
  select id into v_org from public.organizations where slug = 'evertide-infusion';

  select id into v_site from public.sites where organization_id = v_org and slug = 'jacksonville-1';
  if v_site is null then
    insert into public.sites (organization_id, name, slug, address_line_1, city, state, timezone, target_opening_date)
    values (v_org, 'Jacksonville Site 1', 'jacksonville-1', '7880 Gate Parkway, Suite 201', 'Jacksonville', 'FL', 'America/New_York', '2027-01-04')
    returning id into v_site;
  end if;

  select id into v_user from auth.users where email = 'shlomo@evertide.example';
  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, v_user, 'org_admin', true)
  on conflict (organization_id, user_id) do nothing;
  insert into public.site_memberships (site_id, user_id, active)
  values (v_site, v_user, true)
  on conflict (site_id, user_id) do nothing;

  select id into v_user from auth.users where email = 'jared@evertide.example';
  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, v_user, 'org_admin', true)
  on conflict (organization_id, user_id) do nothing;
  insert into public.site_memberships (site_id, user_id, active)
  values (v_site, v_user, true)
  on conflict (site_id, user_id) do nothing;

  select id into v_user from auth.users where email = 'zev@evertide.example';
  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, v_user, 'member', true)
  on conflict (organization_id, user_id) do nothing;
  insert into public.site_memberships (site_id, user_id, active)
  values (v_site, v_user, true)
  on conflict (site_id, user_id) do nothing;

  select id into v_user from auth.users where email = 'mordechai@evertide.example';
  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, v_user, 'member', true)
  on conflict (organization_id, user_id) do nothing;
  insert into public.site_memberships (site_id, user_id, active)
  values (v_site, v_user, true)
  on conflict (site_id, user_id) do nothing;

  select id into v_user from auth.users where email = 'aaron@evertide.example';
  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, v_user, 'member', true)
  on conflict (organization_id, user_id) do nothing;
  insert into public.site_memberships (site_id, user_id, active)
  values (v_site, v_user, true)
  on conflict (site_id, user_id) do nothing;

  select id into v_user from auth.users where email = 'richard@evertide.example';
  insert into public.organization_memberships (organization_id, user_id, role, active)
  values (v_org, v_user, 'member', true)
  on conflict (organization_id, user_id) do nothing;
  insert into public.site_memberships (site_id, user_id, active)
  values (v_site, v_user, true)
  on conflict (site_id, user_id) do nothing;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Legal & Corporate — 0 – Lease & Legal Foundation', '0 – Lease & Legal Foundation', 'Legal & Corporate',
            (select id from public.profiles where email = 'shlomo@evertide.example'), '2026-07-17', '2026-09-04', true);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Licensure & Regulatory — 1 – Licensure, Enrollment & Credentialing (Long-Lead)', '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory',
            (select id from public.profiles where email = 'aaron@evertide.example'), '2026-07-20', '2026-12-04', true);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Buildout & Facility — 2 – Buildout & Facility', '2 – Buildout & Facility', 'Buildout & Facility',
            (select id from public.profiles where email = 'mordechai@evertide.example'), '2026-07-27', '2026-12-18', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Payer Contracting' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Payer Contracting — 3 – Payers, Pharmacy & RCM', '3 – Payers, Pharmacy & RCM', 'Payer Contracting',
            (select id from public.profiles where email = 'aaron@evertide.example'), '2026-07-27', '2026-12-31', true);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Pharmacy & Drug Supply' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Pharmacy & Drug Supply — 3 – Payers, Pharmacy & RCM', '3 – Payers, Pharmacy & RCM', 'Pharmacy & Drug Supply',
            (select id from public.profiles where email = 'aaron@evertide.example'), '2026-09-07', '2026-12-04', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'RCM & Billing' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'RCM & Billing — 3 – Payers, Pharmacy & RCM', '3 – Payers, Pharmacy & RCM', 'RCM & Billing',
            (select id from public.profiles where email = 'aaron@evertide.example'), '2026-08-24', '2026-12-04', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Clinical Operations' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Clinical Operations — 4 – Clinical, Staffing & Systems', '4 – Clinical, Staffing & Systems', 'Clinical Operations',
            (select id from public.profiles where email = 'zev@evertide.example'), '2026-09-07', '2026-12-11', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Staffing & HR' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Staffing & HR — 4 – Clinical, Staffing & Systems', '4 – Clinical, Staffing & Systems', 'Staffing & HR',
            (select id from public.profiles where email = 'shlomo@evertide.example'), '2026-09-07', '2026-12-18', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Systems & Technology' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Systems & Technology — 4 – Clinical, Staffing & Systems', '4 – Clinical, Staffing & Systems', 'Systems & Technology',
            (select id from public.profiles where email = 'mordechai@evertide.example'), '2026-08-24', '2026-12-11', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '5 – Referral Development & Marketing' and workstream = 'Referral Development' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Referral Development — 5 – Referral Development & Marketing', '5 – Referral Development & Marketing', 'Referral Development',
            (select id from public.profiles where email = 'jared@evertide.example'), '2026-08-10', '2027-01-01', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Finance' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Finance — 0 – Lease & Legal Foundation', '0 – Lease & Legal Foundation', 'Finance',
            (select id from public.profiles where email = 'aaron@evertide.example'), '2026-07-27', '2026-08-14', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Finance' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Finance — 3 – Payers, Pharmacy & RCM', '3 – Payers, Pharmacy & RCM', 'Finance',
            (select id from public.profiles where email = 'shlomo@evertide.example'), '2026-09-14', '2026-10-16', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Finance' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Finance — 4 – Clinical, Staffing & Systems', '4 – Clinical, Staffing & Systems', 'Finance',
            (select id from public.profiles where email = 'aaron@evertide.example'), '2026-11-02', '2026-12-11', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Accountability System' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Accountability System — 6 – Pre-Opening Countdown', '6 – Pre-Opening Countdown', 'Accountability System',
            (select id from public.profiles where email = 'shlomo@evertide.example'), '2026-07-28', '2026-10-30', false);
  end if;

  if not exists (select 1 from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Pre-Opening' and archived_at is null) then
    insert into public.projects (organization_id, site_id, name, phase, workstream, owner_id, start_date, due_date, critical_path)
    values (v_org, v_site, 'Pre-Opening — 6 – Pre-Opening Countdown', '6 – Pre-Opening Countdown', 'Pre-Opening',
            (select id from public.profiles where email = 'shlomo@evertide.example'), '2026-12-21', '2027-01-04', true);
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 1) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 1, '0 – Lease & Legal Foundation', 'Legal & Corporate', 'Receive final lease redline from counsel; complete final review vs. negotiated terms (TI allowance, commencement, exclusivity)',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-17', '2026-07-23', 'in_progress', 50,
            'normal', false, 'Example update: redline received from BMD 7/17; final read scheduled 7/21. — Shlomo', 1)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 2) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 2, '0 – Lease & Legal Foundation', 'Legal & Corporate', 'Execute lease for 7880 Gate Parkway, Suite 201; confirm commencement date & TI delivery conditions in writing',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-24', '2026-07-28', 'not_started', 0,
            'normal', false, null, 2)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 3) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 3, '0 – Lease & Legal Foundation', 'Legal & Corporate', 'Finalize HoldCo/SiteCo structure and operating agreements with BMD (Jeana); confirm equity grants (Jared 4%, Zev 5%, Aaron 5%) are papered',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-17', '2026-08-14', 'not_started', 0,
            'normal', false, null, 3)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 4) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 4, '0 – Lease & Legal Foundation', 'Legal & Corporate', 'Confirm ownership structure supports chosen licensure pathway (physician ownership % drives AHCA clinic license vs. exemption)',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-20', '2026-07-31', 'not_started', 0,
            'critical', true, 'Gate item — do before AHCA filings', 4)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 5) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 5, '0 – Lease & Legal Foundation', 'Legal & Corporate', 'Bind insurance: general liability, property, workers'' comp, medical malpractice (entity + Zev), cyber',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-08-03', '2026-09-04', 'not_started', 0,
            'normal', false, null, 5)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'shlomo@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 6) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 6, '0 – Lease & Legal Foundation', 'Legal & Corporate', 'Register SiteCo with FL Dept. of Revenue; Duval County local business tax receipt; city registrations',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-08-03', '2026-08-21', 'not_started', 0,
            'normal', false, null, 6)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 7) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Legal & Corporate' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 7, '0 – Lease & Legal Foundation', 'Legal & Corporate', 'Medical Director Agreement for Dr. Neurwith (scope, supervision, stipend) executed',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-08-03', '2026-08-28', 'not_started', 0,
            'normal', false, null, 7)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 8) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 8, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'Confirm FL licensure pathway with health care counsel (AHCA Health Care Clinic license vs. exemption certificate) and file application',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-20', '2026-08-21', 'not_started', 0,
            'critical', true, 'CRITICAL PATH — AHCA processing can run 60–90+ days', 8)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 9) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 9, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'Obtain Type 2 NPI for SiteCo; confirm taxonomy codes',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-07-27', '2026-08-07', 'not_started', 0,
            'normal', false, null, 9)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 10) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 10, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'DEA registration for Jacksonville location (if controlled substances stocked); FL dispensing/office-use compliance review',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-08-10', '2026-09-18', 'not_started', 0,
            'normal', false, null, 10)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 11) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 11, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'CLIA Certificate of Waiver (point-of-care labs) application',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-08-17', '2026-09-25', 'not_started', 0,
            'normal', false, null, 11)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 12) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 12, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'Medicare enrollment decision + PECOS 855B filing if pursuing Part B buy-and-bill',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-08-03', '2026-09-11', 'not_started', 0,
            'normal', false, 'Decide before payer contracting sequencing', 12)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 13) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 13, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'Verify Zev''s FL license, board status, malpractice history docs packaged for all credentialing files',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-07-27', '2026-08-07', 'not_started', 0,
            'normal', false, null, 13)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 14) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 14, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'OSHA/bloodborne pathogen, biohazard waste hauler contract, sharps program',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-10-05', '2026-11-13', 'not_started', 0,
            'normal', false, null, 14)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 15) then
    select id into v_project from public.projects where site_id = v_site and phase = '1 – Licensure, Enrollment & Credentialing (Long-Lead)' and workstream = 'Licensure & Regulatory' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 15, '1 – Licensure, Enrollment & Credentialing (Long-Lead)', 'Licensure & Regulatory', 'Fire marshal inspection & certificate of occupancy coordination with GC',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-11-02', '2026-12-04', 'not_started', 0,
            'normal', false, null, 15)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'shlomo@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 16) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 16, '2 – Buildout & Facility', 'Buildout & Facility', 'Finalize space plan & TI construction drawings (infusion bays, med room, waiting, ADA)',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-27', '2026-08-21', 'not_started', 0,
            'normal', false, null, 16)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 17) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 17, '2 – Buildout & Facility', 'Buildout & Facility', 'Select GC, execute construction contract, pull permits',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-08-17', '2026-09-11', 'not_started', 0,
            'normal', false, null, 17)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 18) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 18, '2 – Buildout & Facility', 'Buildout & Facility', 'TI construction — demo through final punch list',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-09-14', '2026-11-20', 'not_started', 0,
            'normal', false, 'Weekly GC check-in; photos to huddle', 18)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'shlomo@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 19) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 19, '2 – Buildout & Facility', 'Buildout & Facility', 'Order long-lead FF&E: infusion chairs, recliners, IV poles, med refrigerator w/ continuous temp monitoring, emergency cart',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-08-24', '2026-10-16', 'not_started', 0,
            'normal', false, null, 19)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 20) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 20, '2 – Buildout & Facility', 'Buildout & Facility', 'IT infrastructure: internet, network, phones, fax, security cameras, access control',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-10-05', '2026-11-13', 'not_started', 0,
            'normal', false, null, 20)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'richard@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 21) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 21, '2 – Buildout & Facility', 'Buildout & Facility', 'Interior branding & exterior signage (landlord + city approval)',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-09-07', '2026-11-06', 'not_started', 0,
            'normal', false, null, 21)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 22) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 22, '2 – Buildout & Facility', 'Buildout & Facility', 'Furniture, TVs, wifi for patients, coffee/snack station — patient experience walkthrough (Schulze standards)',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-11-09', '2026-12-04', 'not_started', 0,
            'normal', false, null, 22)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 23) then
    select id into v_project from public.projects where site_id = v_site and phase = '2 – Buildout & Facility' and workstream = 'Buildout & Facility' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 23, '2 – Buildout & Facility', 'Buildout & Facility', 'Final deep clean, life-safety checks, mock patient walk-through of full visit journey',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-12-07', '2026-12-18', 'not_started', 0,
            'normal', false, null, 23)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 24) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Payer Contracting' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 24, '3 – Payers, Pharmacy & RCM', 'Payer Contracting', 'Finalize target payer list & contracting strategy (FL Blue, UHC, Aetna, Cigna, Medicare; Medicaid decision)',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-07-27', '2026-08-14', 'not_started', 0,
            'normal', false, 'Gating condition from go/no-go', 24)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 25) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Payer Contracting' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 25, '3 – Payers, Pharmacy & RCM', 'Payer Contracting', 'Submit credentialing applications for Dr. Neurwith + facility to all target payers',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-08-17', '2026-09-04', 'not_started', 0,
            'critical', true, 'CRITICAL PATH — 90–150 day cycles; submit everything same week', 25)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 26) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Payer Contracting' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 26, '3 – Payers, Pharmacy & RCM', 'Payer Contracting', 'Weekly credentialing status tracker & payer follow-up call cadence',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-09-07', '2026-12-31', 'not_started', 0,
            'normal', false, 'Standing agenda item at weekly huddle', 26)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'richard@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 27) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Payer Contracting' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 27, '3 – Payers, Pharmacy & RCM', 'Payer Contracting', 'Negotiate fee schedules; model reimbursement vs. drug acquisition cost per top 15 J-codes',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-10-05', '2026-12-11', 'not_started', 0,
            'normal', false, null, 27)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 28) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Pharmacy & Drug Supply' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 28, '3 – Payers, Pharmacy & RCM', 'Pharmacy & Drug Supply', 'Open wholesaler/specialty distributor accounts (Cencora, McKesson); credit terms & drug float sized',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-09-07', '2026-10-23', 'not_started', 0,
            'normal', false, null, 28)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'shlomo@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 29) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Pharmacy & Drug Supply' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 29, '3 – Payers, Pharmacy & RCM', 'Pharmacy & Drug Supply', 'Formulary v1: target therapies (biologics for rheum/GI/neuro/derm), NDC list, par levels, cold-chain SOP',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-09-21', '2026-11-06', 'not_started', 0,
            'normal', false, null, 29)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 30) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Pharmacy & Drug Supply' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 30, '3 – Payers, Pharmacy & RCM', 'Pharmacy & Drug Supply', 'Inventory management workflow in infusion platform; receiving, lot/expiry tracking, waste documentation',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-11-02', '2026-12-04', 'not_started', 0,
            'normal', false, null, 30)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 31) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'RCM & Billing' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 31, '3 – Payers, Pharmacy & RCM', 'RCM & Billing', 'Design end-to-end RCM workflow: referral intake → benefits investigation → prior auth → scheduling → charge capture → claim → AR follow-up',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-08-24', '2026-10-02', 'not_started', 0,
            'normal', false, null, 31)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 32) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'RCM & Billing' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 32, '3 – Payers, Pharmacy & RCM', 'RCM & Billing', 'Clearinghouse, billing platform, charge master (J-codes, admin codes 96365–96417), payer-specific edits',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-10-05', '2026-11-13', 'not_started', 0,
            'normal', false, null, 32)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'richard@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 33) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'RCM & Billing' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 33, '3 – Payers, Pharmacy & RCM', 'RCM & Billing', 'Copay assistance / manufacturer program enrollment playbook (per-drug foundations, hub services)',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-10-19', '2026-11-20', 'not_started', 0,
            'normal', false, null, 33)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 34) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'RCM & Billing' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 34, '3 – Payers, Pharmacy & RCM', 'RCM & Billing', 'Financial policy, patient cost estimate script, and financial counseling SOP',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-11-09', '2026-12-04', 'not_started', 0,
            'normal', false, null, 34)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 35) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Clinical Operations' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 35, '4 – Clinical, Staffing & Systems', 'Clinical Operations', 'Clinical protocol library: standing orders per therapy, infusion rates, pre-meds, monitoring parameters',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-09-07', '2026-11-06', 'not_started', 0,
            'normal', false, null, 35)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 36) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Clinical Operations' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 36, '4 – Clinical, Staffing & Systems', 'Clinical Operations', 'Emergency protocols: anaphylaxis, infusion reactions, code response, EMS activation; crash kit contents & checks',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-10-05', '2026-11-20', 'not_started', 0,
            'normal', false, null, 36)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 37) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Clinical Operations' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 37, '4 – Clinical, Staffing & Systems', 'Clinical Operations', 'Consent forms, patient education materials, adverse event reporting workflow',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-10-19', '2026-11-27', 'not_started', 0,
            'normal', false, null, 37)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 38) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Clinical Operations' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 38, '4 – Clinical, Staffing & Systems', 'Clinical Operations', 'Nursing competency checklists & skills validation program (IV access, ports, reaction management)',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-11-02', '2026-12-11', 'not_started', 0,
            'normal', false, null, 38)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 39) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Staffing & HR' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 39, '4 – Clinical, Staffing & Systems', 'Staffing & HR', 'Org chart + job descriptions: lead infusion RN, infusion RN(s), intake/benefits coordinator, MA/front desk',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-09-07', '2026-09-25', 'not_started', 0,
            'normal', false, null, 39)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 40) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Staffing & HR' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 40, '4 – Clinical, Staffing & Systems', 'Staffing & HR', 'Recruit & hire lead infusion RN (target start ~4 wks pre-open)',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-09-28', '2026-11-13', 'not_started', 0,
            'normal', false, null, 40)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 41) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Staffing & HR' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 41, '4 – Clinical, Staffing & Systems', 'Staffing & HR', 'Recruit & hire remaining team; background checks, license verification, payroll/benefits setup',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-10-12', '2026-12-04', 'not_started', 0,
            'normal', false, null, 41)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'shlomo@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 42) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Staffing & HR' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 42, '4 – Clinical, Staffing & Systems', 'Staffing & HR', 'EverTide orientation: culture-first onboarding (Schulze Day 1), standards handbook, service scripts, 90-day competency gate',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-12-07', '2026-12-18', 'not_started', 0,
            'normal', false, null, 42)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 43) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Systems & Technology' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 43, '4 – Clinical, Staffing & Systems', 'Systems & Technology', 'Select & contract infusion EMR/workflow platform (e.g., WeInfuse-type); implementation kickoff',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-08-24', '2026-09-18', 'not_started', 0,
            'normal', false, null, 43)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 44) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Systems & Technology' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 44, '4 – Clinical, Staffing & Systems', 'Systems & Technology', 'Platform build: templates, order sets, scheduling rules, inventory, billing integration; staff training',
            (select id from public.profiles where email = 'mordechai@evertide.example'),
            '2026-09-21', '2026-12-11', 'not_started', 0,
            'normal', false, null, 44)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 45) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Systems & Technology' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 45, '4 – Clinical, Staffing & Systems', 'Systems & Technology', 'E-fax/referral intake channel, phone tree, website scheduling request form live',
            (select id from public.profiles where email = 'richard@evertide.example'),
            '2026-10-19', '2026-11-27', 'not_started', 0,
            'normal', false, null, 45)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 46) then
    select id into v_project from public.projects where site_id = v_site and phase = '5 – Referral Development & Marketing' and workstream = 'Referral Development' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 46, '5 – Referral Development & Marketing', 'Referral Development', 'Referral market map: top 50 target prescribers (rheum, GI, neuro, derm) in Jacksonville metro w/ current infusion destination',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-08-10', '2026-09-11', 'not_started', 0,
            'normal', false, null, 46)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'richard@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 47) then
    select id into v_project from public.projects where site_id = v_site and phase = '5 – Referral Development & Marketing' and workstream = 'Referral Development' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 47, '5 – Referral Development & Marketing', 'Referral Development', 'Collateral & referral kit: one-pager, referral form, insurance grid, service pledge',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-09-14', '2026-10-09', 'not_started', 0,
            'normal', false, null, 47)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'richard@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 48) then
    select id into v_project from public.projects where site_id = v_site and phase = '5 – Referral Development & Marketing' and workstream = 'Referral Development' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 48, '5 – Referral Development & Marketing', 'Referral Development', 'Prescriber outreach wave 1 (Zev peer-to-peer + Jared): 25 offices before opening',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-10-12', '2026-12-18', 'not_started', 0,
            'normal', false, 'Track visits & committed referrals weekly', 48)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 49) then
    select id into v_project from public.projects where site_id = v_site and phase = '5 – Referral Development & Marketing' and workstream = 'Referral Development' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 49, '5 – Referral Development & Marketing', 'Referral Development', 'Website, Google Business Profile, local SEO live; phone & referral fax tested end-to-end',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-10-19', '2026-11-20', 'not_started', 0,
            'normal', false, null, 49)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'richard@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 50) then
    select id into v_project from public.projects where site_id = v_site and phase = '5 – Referral Development & Marketing' and workstream = 'Referral Development' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 50, '5 – Referral Development & Marketing', 'Referral Development', 'Open house / launch event for referring offices (week before opening)',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-12-14', '2026-12-29', 'not_started', 0,
            'normal', false, null, 50)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 51) then
    select id into v_project from public.projects where site_id = v_site and phase = '5 – Referral Development & Marketing' and workstream = 'Referral Development' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 51, '5 – Referral Development & Marketing', 'Referral Development', 'Secure 10+ committed patient referrals pre-opening; first-week schedule built',
            (select id from public.profiles where email = 'jared@evertide.example'),
            '2026-11-30', '2027-01-01', 'not_started', 0,
            'normal', false, null, 51)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 52) then
    select id into v_project from public.projects where site_id = v_site and phase = '0 – Lease & Legal Foundation' and workstream = 'Finance' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 52, '0 – Lease & Legal Foundation', 'Finance', 'Open SiteCo bank accounts; QuickBooks entity setup; chart of accounts',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-07-27', '2026-08-14', 'not_started', 0,
            'normal', false, null, 52)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'shlomo@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 53) then
    select id into v_project from public.projects where site_id = v_site and phase = '3 – Payers, Pharmacy & RCM' and workstream = 'Finance' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 53, '3 – Payers, Pharmacy & RCM', 'Finance', 'Working capital plan: drug float sizing, LOC if needed, 6-month cash runway model',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-09-14', '2026-10-16', 'not_started', 0,
            'normal', false, null, 53)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 54) then
    select id into v_project from public.projects where site_id = v_site and phase = '4 – Clinical, Staffing & Systems' and workstream = 'Finance' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 54, '4 – Clinical, Staffing & Systems', 'Finance', 'Opening budget vs. actual tracker; monthly close cadence; KPI scorecard (chair utilization, referral-to-infusion conversion, days to auth, AR days)',
            (select id from public.profiles where email = 'aaron@evertide.example'),
            '2026-11-02', '2026-12-11', 'not_started', 0,
            'normal', false, null, 54)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'shlomo@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 55) then
    select id into v_project from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Accountability System' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 55, '6 – Pre-Opening Countdown', 'Accountability System', 'Launch weekly EverTide leadership huddle (Studer): scorecard review, wins, blockers, owner commitments — every Tuesday',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-28', '2026-07-28', 'not_started', 0,
            'normal', false, 'Recurs weekly through opening', 55)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 56) then
    select id into v_project from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Accountability System' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 56, '6 – Pre-Opening Countdown', 'Accountability System', '30/60/90-day leader plans for Jared, Zev, Mordechai, Aaron tied to this roadmap',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-08-03', '2026-08-14', 'not_started', 0,
            'normal', false, null, 56)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 57) then
    select id into v_project from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Accountability System' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 57, '6 – Pre-Opening Countdown', 'Accountability System', 'Adapt Armada Excellence Standards Handbook for EverTide (service values, scripts, defect review)',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-09-07', '2026-10-30', 'not_started', 0,
            'normal', false, null, 57)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 58) then
    select id into v_project from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Pre-Opening' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 58, '6 – Pre-Opening Countdown', 'Pre-Opening', 'Dry-run days: 2 full mock infusion days with staff (check-in → chair → discharge → billing), defect log & fixes',
            (select id from public.profiles where email = 'zev@evertide.example'),
            '2026-12-21', '2026-12-31', 'not_started', 0,
            'normal', false, null, 58)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 59) then
    select id into v_project from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Pre-Opening' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 59, '6 – Pre-Opening Countdown', 'Pre-Opening', 'Opening readiness checklist sign-off: licensure, at least 2 payer contracts effective, staff credentialed, drugs on shelf, EMR live',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-12-28', '2027-01-01', 'not_started', 0,
            'critical', true, 'Go/no-go gate', 59)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.tasks where site_id = v_site and legacy_id = 60) then
    select id into v_project from public.projects where site_id = v_site and phase = '6 – Pre-Opening Countdown' and workstream = 'Pre-Opening' and archived_at is null;
    insert into public.tasks (organization_id, site_id, project_id, legacy_id, phase, workstream, title, owner_id,
                              start_date, due_date, status, percent_done, priority, critical, notes, sort_order)
    values (v_org, v_site, v_project, 60, '6 – Pre-Opening Countdown', 'Pre-Opening', 'OPENING DAY — first patient infused',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2027-01-04', '2027-01-04', 'not_started', 0,
            'normal', false, 'Target date; slips if AHCA or payer effective dates slip', 60)
    returning id into v_task;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'jared@evertide.example')) on conflict do nothing;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'zev@evertide.example')) on conflict do nothing;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'mordechai@evertide.example')) on conflict do nothing;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'aaron@evertide.example')) on conflict do nothing;
    insert into public.task_helpers (task_id, user_id) values (v_task, (select id from public.profiles where email = 'richard@evertide.example')) on conflict do nothing;
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'Lease executed') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'Lease executed', '2026-07-28', 'Signed lease; TI delivery date confirmed in writing',
            (select id from public.profiles where email = 'shlomo@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'AHCA licensure application filed') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'AHCA licensure application filed', '2026-08-21', 'Pathway confirmed by counsel; complete application submitted',
            (select id from public.profiles where email = 'shlomo@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'All payer credentialing submitted') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'All payer credentialing submitted', '2026-09-04', 'Every target payer application in, same week, tracked weekly',
            (select id from public.profiles where email = 'aaron@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'Construction start') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'Construction start', '2026-09-14', 'Permits pulled; GC contract executed',
            (select id from public.profiles where email = 'mordechai@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'EMR platform contracted') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'EMR platform contracted', '2026-09-18', 'Vendor signed; implementation plan with dates',
            (select id from public.profiles where email = 'mordechai@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'Lead RN hired') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'Lead RN hired', '2026-11-13', 'Offer accepted; start date ≥4 weeks pre-open',
            (select id from public.profiles where email = 'shlomo@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'Construction substantially complete') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'Construction substantially complete', '2026-11-20', 'Punch list only; CO path clear',
            (select id from public.profiles where email = 'mordechai@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'First payer contract effective') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'First payer contract effective', '2026-12-11', 'At least one major commercial payer live; 2+ preferred',
            (select id from public.profiles where email = 'aaron@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'Drugs on shelf') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'Drugs on shelf', '2026-12-18', 'Wholesaler accounts live; formulary v1 stocked; cold chain verified',
            (select id from public.profiles where email = 'aaron@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'Mock infusion days complete') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'Mock infusion days complete', '2026-12-31', '2 dry runs done; defect log closed',
            (select id from public.profiles where email = 'zev@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'Go/no-go readiness sign-off') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'Go/no-go readiness sign-off', '2027-01-01', 'Licensure + payers + staff + drugs + EMR all green',
            (select id from public.profiles where email = 'shlomo@evertide.example'), 'pending');
  end if;

  if not exists (select 1 from public.milestones where site_id = v_site and title = 'OPENING DAY') then
    insert into public.milestones (organization_id, site_id, title, target_date, gate_criteria, owner_id, status)
    values (v_org, v_site, 'OPENING DAY', '2027-01-04', 'First patient infused',
            (select id from public.profiles where email = 'shlomo@evertide.example'), 'pending');
  end if;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Financial', 'Cash runway', 'Unrestricted cash divided by current forecast monthly cash burn.', 'months', 'weekly',
          (select id from public.profiles where email = 'shlomo@evertide.example'), 'higher_is_better', 6,
          6, null, 4, null, true, 1)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Financial', 'Opening budget variance', 'Actual plus committed opening spend versus approved opening budget. Zero or below is green.', 'percent', 'weekly',
          (select id from public.profiles where email = 'aaron@evertide.example'), 'lower_is_better', 0,
          null, 0, null, 5, true, 2)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Operations', 'Roadmap completion', 'Weighted percent complete across all opening tasks. Dashboard also compares actual to planned completion by date.', 'percent', 'weekly',
          (select id from public.profiles where email = 'mordechai@evertide.example'), 'higher_is_better', 100,
          95, null, 85, null, true, 3)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Operations', 'Construction completion', 'GC-reported percent complete, supported by weekly photo/update.', 'percent', 'weekly',
          (select id from public.profiles where email = 'mordechai@evertide.example'), 'higher_is_better', 100,
          95, null, 85, null, true, 4)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Operations', 'Open blockers', 'Number of unresolved blocked tasks and high-priority issues.', 'count', 'weekly',
          (select id from public.profiles where email = 'shlomo@evertide.example'), 'lower_is_better', 0,
          null, 0, null, 2, true, 5)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Operations', 'Stale in-progress tasks', 'In-progress tasks with no attributed update for seven or more days.', 'count', 'weekly',
          (select id from public.profiles where email = 'shlomo@evertide.example'), 'lower_is_better', 0,
          null, 0, null, 3, true, 6)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Clinical', 'Clinical readiness checklist', 'Completion of protocols, emergency readiness, consents, competencies, and mock-day prerequisites.', 'percent', 'weekly',
          (select id from public.profiles where email = 'zev@evertide.example'), 'higher_is_better', 100,
          100, null, 80, null, true, 7)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Clinical', 'Staffing readiness', 'Required opening roles accepted, cleared, onboarded, and competency-ready.', 'percent', 'weekly',
          (select id from public.profiles where email = 'shlomo@evertide.example'), 'higher_is_better', 100,
          100, null, 80, null, true, 8)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Growth', 'Effective payer contracts', 'Payer contracts with an effective date on or before opening and operationally loaded.', 'count', 'weekly',
          (select id from public.profiles where email = 'aaron@evertide.example'), 'higher_is_better', 2,
          2, null, 1, null, true, 9)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Growth', 'Referral offices engaged', 'Distinct target practices with a documented substantive outreach interaction.', 'count', 'weekly',
          (select id from public.profiles where email = 'jared@evertide.example'), 'higher_is_better', 25,
          25, null, 15, null, true, 10)
  on conflict (site_id, name) do nothing;

  insert into public.kpis (organization_id, site_id, category, name, description, unit, frequency, owner_id,
                          direction, target_value, green_min, green_max, yellow_min, yellow_max, active, sort_order)
  values (v_org, v_site, 'Growth', 'Committed patient referrals', 'Documented pre-opening patient referrals expected to schedule in opening week.', 'count', 'weekly',
          (select id from public.profiles where email = 'jared@evertide.example'), 'higher_is_better', 10,
          10, null, 5, null, true, 11)
  on conflict (site_id, name) do nothing;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Legal & Corporate') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Legal & Corporate', 1);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Lease & Real Estate') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Lease & Real Estate', 2);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Licensure & Regulatory') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Licensure & Regulatory', 3);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Payers & Credentialing') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Payers & Credentialing', 4);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Pharmacy & Drug Supply') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Pharmacy & Drug Supply', 5);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Clinical & Quality') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Clinical & Quality', 6);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Staffing & HR') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Staffing & HR', 7);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Systems & Technology') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Systems & Technology', 8);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Finance') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Finance', 9);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Referral Development & Marketing') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Referral Development & Marketing', 10);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'Meetings & Decisions') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'Meetings & Decisions', 11);
  end if;

  if not exists (select 1 from public.document_folders where organization_id = v_org and site_id is null and parent_folder_id is null and name = 'SOPs & Policies') then
    insert into public.document_folders (organization_id, name, sort_order) values (v_org, 'SOPs & Policies', 12);
  end if;

  if not exists (select 1 from public.goals where site_id = v_site and title = 'Open Jacksonville Site 1 safely and successfully by January 4, 2027') then
    insert into public.goals (organization_id, site_id, title, goal_type, owner_id, start_date, due_date, status, success_criteria)
    values (v_org, v_site, 'Open Jacksonville Site 1 safely and successfully by January 4, 2027', 'annual',
            (select id from public.profiles where email = 'shlomo@evertide.example'),
            '2026-07-17', '2027-01-04', 'active', 'Licensure in hand, at least 2 payer contracts effective, staff credentialed, drugs on shelf, EMR live, first patient infused on January 4, 2027.');
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Lease, Legal & Corporate') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Lease, Legal & Corporate', '{"Shlomo":"A","Jared Friedman":"C","Dr. Zev Neurwith":"I","Mordechai Neurwith":"R","Aaron Jacobs":"C","Richard Hunt":"I"}'::jsonb, 1);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Licensure & Regulatory') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Licensure & Regulatory', '{"Shlomo":"A","Jared Friedman":"I","Dr. Zev Neurwith":"R","Mordechai Neurwith":"R","Aaron Jacobs":"C","Richard Hunt":"I"}'::jsonb, 2);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Buildout & Facility') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Buildout & Facility', '{"Shlomo":"A","Jared Friedman":"C","Dr. Zev Neurwith":"C","Mordechai Neurwith":"R","Aaron Jacobs":"I","Richard Hunt":"C"}'::jsonb, 3);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Payer Contracting & Credentialing') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Payer Contracting & Credentialing', '{"Shlomo":"I","Jared Friedman":"A","Dr. Zev Neurwith":"C","Mordechai Neurwith":"I","Aaron Jacobs":"R","Richard Hunt":"C"}'::jsonb, 4);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Pharmacy & Drug Supply') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Pharmacy & Drug Supply', '{"Shlomo":"I","Jared Friedman":"C","Dr. Zev Neurwith":"A","Mordechai Neurwith":"R","Aaron Jacobs":"R","Richard Hunt":"I"}'::jsonb, 5);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Clinical Protocols & Quality') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Clinical Protocols & Quality', '{"Shlomo":"I","Jared Friedman":"C","Dr. Zev Neurwith":"A","Mordechai Neurwith":"R","Aaron Jacobs":"I","Richard Hunt":"I"}'::jsonb, 6);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Staffing, HR & Onboarding') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Staffing, HR & Onboarding', '{"Shlomo":"A","Jared Friedman":"C","Dr. Zev Neurwith":"C","Mordechai Neurwith":"R","Aaron Jacobs":"I","Richard Hunt":"I"}'::jsonb, 7);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Systems & Technology (EMR/RCM stack)') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Systems & Technology (EMR/RCM stack)', '{"Shlomo":"I","Jared Friedman":"I","Dr. Zev Neurwith":"C","Mordechai Neurwith":"A","Aaron Jacobs":"R","Richard Hunt":"R"}'::jsonb, 8);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'RCM, Billing & Prior Auth') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'RCM, Billing & Prior Auth', '{"Shlomo":"I","Jared Friedman":"C","Dr. Zev Neurwith":"C","Mordechai Neurwith":"C","Aaron Jacobs":"A","Richard Hunt":"R"}'::jsonb, 9);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Referral Development & Marketing') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Referral Development & Marketing', '{"Shlomo":"I","Jared Friedman":"A","Dr. Zev Neurwith":"R","Mordechai Neurwith":"C","Aaron Jacobs":"C","Richard Hunt":"R"}'::jsonb, 10);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Finance, Budget & Scorecard') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Finance, Budget & Scorecard', '{"Shlomo":"A","Jared Friedman":"I","Dr. Zev Neurwith":"I","Mordechai Neurwith":"I","Aaron Jacobs":"R","Richard Hunt":"I"}'::jsonb, 11);
  end if;

  if not exists (select 1 from public.raci_entries where site_id = v_site and workstream = 'Culture, Standards & Huddle System') then
    insert into public.raci_entries (organization_id, site_id, workstream, assignments, sort_order)
    values (v_org, v_site, 'Culture, Standards & Huddle System', '{"Shlomo":"A","Jared Friedman":"R","Dr. Zev Neurwith":"C","Mordechai Neurwith":"R","Aaron Jacobs":"I","Richard Hunt":"I"}'::jsonb, 12);
  end if;

end
$seed$;

-- Result check — the numbers on the right should read 60 / 12 / 11 / 15 / 12 / 12 / 6:
select 'tasks' as what, count(*) from public.tasks where legacy_id is not null
union all select 'milestones', count(*) from public.milestones
union all select 'kpis', count(*) from public.kpis
union all select 'projects', count(*) from public.projects
union all select 'folders', count(*) from public.document_folders
union all select 'raci rows', count(*) from public.raci_entries
union all select 'team profiles', count(*) from public.profiles;
