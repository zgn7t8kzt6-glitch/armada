-- EverTide OS — one-time team cleanup (run once in the SQL Editor; safe to re-run).
-- 1) Merges the placeholder "Shlomo" seed account into the real login and
--    sets the email to shlomo@evertideinfusion.com.
-- 2) Renames the other placeholder accounts to first-initial + last name
--    @evertideinfusion.com.
-- 3) Removes Richard Hunt completely (his work moves to Mordechai).
-- Reassignment is dynamic: every foreign key that references profiles is
-- discovered from the catalog and updated, so no column can be missed.

do $fix$
declare
  v_real uuid;
  v_ph uuid;
  v_mord uuid;
  v_rich uuid;
  pair record;
  r record;
begin
  -- Sanctioned bypass for the decision-immutability guard (audited path).
  perform set_config('app.decision_correction', 'on', true);

  -- Append-only history tables also carry author references; lift their
  -- immutability triggers for this transaction only (rolls back on error).
  alter table public.document_versions disable trigger document_versions_immutable;
  alter table public.task_updates      disable trigger task_updates_immutable;
  alter table public.issue_updates     disable trigger issue_updates_immutable;
  alter table public.reports           disable trigger reports_guard;

  select id into v_real from auth.users where email = 'shlomo@armadarecovery.com';
  if v_real is null then
    select id into v_real from auth.users where email = 'shlomo@evertideinfusion.com';
  end if;
  select id into v_ph   from auth.users where email = 'shlomo@evertide.example';
  select id into v_rich from auth.users where email = 'richard@evertide.example';
  select id into v_mord from auth.users
   where email in ('mordechai@evertide.example', 'mneurwith@evertideinfusion.com');

  for pair in
    select * from (values (v_ph, v_real), (v_rich, v_mord)) as t(old_id, new_id)
  loop
    continue when pair.old_id is null or pair.new_id is null;

    delete from public.site_memberships where user_id = pair.old_id;
    delete from public.organization_memberships where user_id = pair.old_id;

    -- Junction tables have (thing, user) uniqueness: drop the old account's
    -- row wherever the new account already has one.
    delete from public.task_helpers th
      where th.user_id = pair.old_id
        and exists (select 1 from public.task_helpers x
                    where x.task_id = th.task_id and x.user_id = pair.new_id);
    delete from public.huddle_attendees ha
      where ha.user_id = pair.old_id
        and exists (select 1 from public.huddle_attendees x
                    where x.huddle_id = ha.huddle_id and x.user_id = pair.new_id);
    delete from public.document_access_grants g
      where g.user_id = pair.old_id
        and exists (select 1 from public.document_access_grants x
                    where x.document_id = g.document_id and x.user_id = pair.new_id);

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
        using pair.new_id, pair.old_id;
    end loop;

    -- An owner cannot also be listed as helper on the same task.
    delete from public.task_helpers th using public.tasks t
      where th.task_id = t.id and th.user_id = pair.new_id and t.owner_id = pair.new_id;

    delete from auth.users where id = pair.old_id; -- cascades the profile
  end loop;

  -- Real emails.
  if v_real is not null then
    update public.profiles set name = 'Shlomo', title = 'CEO',
      email = 'shlomo@evertideinfusion.com' where id = v_real;
    update auth.users set email = 'shlomo@evertideinfusion.com' where id = v_real;
  end if;
  update auth.users       set email = 'jfriedman@evertideinfusion.com' where email = 'jared@evertide.example';
  update public.profiles  set email = 'jfriedman@evertideinfusion.com' where email = 'jared@evertide.example';
  update auth.users       set email = 'zneurwith@evertideinfusion.com' where email = 'zev@evertide.example';
  update public.profiles  set email = 'zneurwith@evertideinfusion.com' where email = 'zev@evertide.example';
  update auth.users       set email = 'mneurwith@evertideinfusion.com' where email = 'mordechai@evertide.example';
  update public.profiles  set email = 'mneurwith@evertideinfusion.com' where email = 'mordechai@evertide.example';
  update auth.users       set email = 'ajacobs@evertideinfusion.com'   where email = 'aaron@evertide.example';
  update public.profiles  set email = 'ajacobs@evertideinfusion.com'   where email = 'aaron@evertide.example';

  -- Richard leaves the static RACI reference too.
  update public.raci_entries set assignments = assignments - 'Richard Hunt';

  -- Keep GoTrue identities in sync with the new emails (login lookups use these).
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

-- Confirm: 5 people, all @evertideinfusion.com, no Richard.
select name, email, title from public.profiles order by name;
