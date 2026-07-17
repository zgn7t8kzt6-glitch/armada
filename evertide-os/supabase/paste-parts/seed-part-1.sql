-- EverTide OS seed — part 1 of 4: team, organization, site, memberships, projects.
-- Paste into the Supabase SQL Editor and Run. Run parts IN ORDER. Idempotent.

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

end
$seed$;
