-- EverTide OS — one-time team cleanup (run in the SQL Editor; safe to re-run).
-- For each team member, finds every account matching any of their known
-- emails (seed placeholders, the real login, and strays auto-created by
-- magic-link attempts), merges them into one canonical account, and sets the
-- final @evertideinfusion.com address. Removes Richard Hunt completely (his
-- work moves to Mordechai). Reassignment is dynamic: every foreign key that
-- references profiles is discovered from the catalog, so no column is missed.

do $fix$
declare
  v_keep uuid;
  v_mord uuid;
  v_rich uuid;
  person record;
  dup record;
  r record;
  i integer;
begin
  -- Sanctioned bypass for the decision-immutability guard (audited path).
  perform set_config('app.decision_correction', 'on', true);

  -- Append-only history tables also carry author references; lift their
  -- immutability triggers for this transaction only (rolls back on error).
  alter table public.document_versions disable trigger document_versions_immutable;
  alter table public.task_updates      disable trigger task_updates_immutable;
  alter table public.issue_updates     disable trigger issue_updates_immutable;
  alter table public.reports           disable trigger reports_guard;

  for person in
    select * from (values
      ('shlomo@evertideinfusion.com'::text, 'Shlomo'::text,
       array['shlomo@armadarecovery.com','shlomo@evertideinfusion.com','shlomo@evertide.example']),
      ('jfriedman@evertideinfusion.com', 'Jared Friedman',
       array['jared@evertide.example','jfriedman@evertideinfusion.com']),
      ('zneurwith@evertideinfusion.com', 'Dr. Zev Neurwith',
       array['zev@evertide.example','zneurwith@evertideinfusion.com']),
      ('mneurwith@evertideinfusion.com', 'Mordechai Neurwith',
       array['mordechai@evertide.example','mneurwith@evertideinfusion.com']),
      ('ajacobs@evertideinfusion.com', 'Aaron Jacobs',
       array['aaron@evertide.example','ajacobs@evertideinfusion.com'])
    ) as t(target_email, display_name, emails)
  loop
    -- Keeper = first existing account in priority order (real login first for
    -- Shlomo, the seed account — which owns the work — for everyone else).
    v_keep := null;
    for i in 1 .. array_length(person.emails, 1) loop
      select id into v_keep from auth.users where email = person.emails[i];
      exit when v_keep is not null;
    end loop;
    continue when v_keep is null;

    -- Merge every other account matching this person into the keeper.
    for dup in
      select id from auth.users where email = any(person.emails) and id <> v_keep
    loop
      delete from public.site_memberships where user_id = dup.id;
      delete from public.organization_memberships where user_id = dup.id;

      -- Junction tables have (thing, user) uniqueness: drop the duplicate
      -- account's row wherever the keeper already has one.
      delete from public.task_helpers th
        where th.user_id = dup.id
          and exists (select 1 from public.task_helpers x
                      where x.task_id = th.task_id and x.user_id = v_keep);
      delete from public.huddle_attendees ha
        where ha.user_id = dup.id
          and exists (select 1 from public.huddle_attendees x
                      where x.huddle_id = ha.huddle_id and x.user_id = v_keep);
      delete from public.document_access_grants g
        where g.user_id = dup.id
          and exists (select 1 from public.document_access_grants x
                      where x.document_id = g.document_id and x.user_id = v_keep);

      -- Reassign every remaining reference, wherever it lives.
      for r in
        select con.conrelid::regclass as tbl, att.attname as col
          from pg_constraint con
          join pg_attribute att
            on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
         where con.contype = 'f'
           and con.confrelid = 'public.profiles'::regclass
      loop
        execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col)
          using v_keep, dup.id;
      end loop;

      -- An owner cannot also be listed as helper on the same task.
      delete from public.task_helpers th using public.tasks t
        where th.task_id = t.id and th.user_id = v_keep and t.owner_id = v_keep;

      delete from auth.users where id = dup.id; -- cascades the profile
    end loop;

    update auth.users set email = person.target_email where id = v_keep;
    update public.profiles set email = person.target_email, name = person.display_name
      where id = v_keep;
  end loop;

  -- ── Richard Hunt: out completely, his work goes to Mordechai ────────────
  select id into v_rich from auth.users where email = 'richard@evertide.example';
  select id into v_mord from auth.users where email = 'mneurwith@evertideinfusion.com';
  if v_rich is not null and v_mord is not null then
    delete from public.site_memberships where user_id = v_rich;
    delete from public.organization_memberships where user_id = v_rich;
    delete from public.task_helpers th
      where th.user_id = v_rich
        and exists (select 1 from public.task_helpers x
                    where x.task_id = th.task_id and x.user_id = v_mord);
    delete from public.huddle_attendees ha
      where ha.user_id = v_rich
        and exists (select 1 from public.huddle_attendees x
                    where x.huddle_id = ha.huddle_id and x.user_id = v_mord);
    delete from public.document_access_grants g
      where g.user_id = v_rich
        and exists (select 1 from public.document_access_grants x
                    where x.document_id = g.document_id and x.user_id = v_mord);
    for r in
      select con.conrelid::regclass as tbl, att.attname as col
        from pg_constraint con
        join pg_attribute att
          on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
       where con.contype = 'f'
         and con.confrelid = 'public.profiles'::regclass
    loop
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col)
        using v_mord, v_rich;
    end loop;
    delete from public.task_helpers th using public.tasks t
      where th.task_id = t.id and th.user_id = v_mord and t.owner_id = v_mord;
    delete from auth.users where id = v_rich;
  end if;

  -- Richard leaves the static RACI reference too.
  update public.raci_entries set assignments = assignments - 'Richard Hunt';

  -- Every remaining account must be able to sign in with a password:
  -- confirmed email, an email identity row, and identity emails in sync.
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now());
  insert into auth.identities (id, provider_id, user_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
    from auth.users u
   where not exists (select 1 from auth.identities i
                     where i.user_id = u.id and i.provider = 'email');
  update auth.identities i
     set identity_data = i.identity_data || jsonb_build_object('email', u.email)
    from auth.users u
   where i.user_id = u.id
     and i.provider = 'email'
     and i.identity_data->>'email' is distinct from u.email;

  alter table public.document_versions enable trigger document_versions_immutable;
  alter table public.task_updates      enable trigger task_updates_immutable;
  alter table public.issue_updates     enable trigger issue_updates_immutable;
  alter table public.reports           enable trigger reports_guard;
end
$fix$;

-- Confirm: 5 people, all @evertideinfusion.com, no Richard, no duplicates.
select name, email, title from public.profiles order by name;
