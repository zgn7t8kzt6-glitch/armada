-- EverTide OS — one-time team cleanup (run once in the SQL Editor).
-- 1) Merges the placeholder "Shlomo" seed account into the real login and
--    sets the email to shlomo@evertideinfusion.com.
-- 2) Renames the other placeholder accounts to first-initial + last name
--    @evertideinfusion.com.
-- 3) Removes Richard Hunt completely (his owned work moves to Mordechai,
--    who was already the helper on it).

do $fix$
declare
  v_real uuid;
  v_ph uuid;
  v_mord uuid;
  v_rich uuid;
begin
  select id into v_real from auth.users where email = 'shlomo@armadarecovery.com';
  select id into v_ph   from auth.users where email = 'shlomo@evertide.example';
  select id into v_rich from auth.users where email = 'richard@evertide.example';

  -- ── 1) Merge placeholder Shlomo → real Shlomo ────────────────────────────
  if v_ph is not null and v_real is not null then
    update public.tasks              set owner_id = v_real where owner_id = v_ph;
    update public.projects           set owner_id = v_real where owner_id = v_ph;
    update public.milestones         set owner_id = v_real where owner_id = v_ph;
    update public.kpis               set owner_id = v_real where owner_id = v_ph;
    update public.goals              set owner_id = v_real where owner_id = v_ph;
    update public.issues             set owner_id = v_real where owner_id = v_ph;
    update public.risks              set owner_id = v_real where owner_id = v_ph;
    update public.decisions          set owner_id = v_real where owner_id = v_ph;
    update public.huddle_commitments set owner_id = v_real where owner_id = v_ph;
    update public.documents          set owner_id = v_real where owner_id = v_ph;
    update public.people             set owner_id = v_real where owner_id = v_ph;
    update public.vendors            set owner_id = v_real where owner_id = v_ph;

    -- move helper rows, avoiding duplicates and owner-as-helper
    delete from public.task_helpers th
      where th.user_id = v_ph
        and exists (select 1 from public.task_helpers x
                    where x.task_id = th.task_id and x.user_id = v_real);
    update public.task_helpers set user_id = v_real where user_id = v_ph;
    delete from public.task_helpers th using public.tasks t
      where th.task_id = t.id and th.user_id = v_real and t.owner_id = v_real;

    delete from public.site_memberships where user_id = v_ph;
    delete from public.organization_memberships where user_id = v_ph;
    delete from auth.users where id = v_ph; -- cascades the placeholder profile

    update public.profiles set name = 'Shlomo', title = 'CEO',
      email = 'shlomo@evertideinfusion.com' where id = v_real;
    update auth.users set email = 'shlomo@evertideinfusion.com' where id = v_real;
  end if;

  -- ── 2) Real emails for the rest of the team ─────────────────────────────
  update auth.users       set email = 'jfriedman@evertideinfusion.com' where email = 'jared@evertide.example';
  update public.profiles  set email = 'jfriedman@evertideinfusion.com' where email = 'jared@evertide.example';
  update auth.users       set email = 'zneurwith@evertideinfusion.com' where email = 'zev@evertide.example';
  update public.profiles  set email = 'zneurwith@evertideinfusion.com' where email = 'zev@evertide.example';
  update auth.users       set email = 'mneurwith@evertideinfusion.com' where email = 'mordechai@evertide.example';
  update public.profiles  set email = 'mneurwith@evertideinfusion.com' where email = 'mordechai@evertide.example';
  update auth.users       set email = 'ajacobs@evertideinfusion.com'   where email = 'aaron@evertide.example';
  update public.profiles  set email = 'ajacobs@evertideinfusion.com'   where email = 'aaron@evertide.example';

  -- ── 3) Richard Hunt: out completely ─────────────────────────────────────
  select id into v_mord from auth.users where email = 'mneurwith@evertideinfusion.com';
  if v_rich is not null then
    if v_mord is not null then
      update public.tasks set owner_id = v_mord where owner_id = v_rich;
      -- new owner cannot stay listed as helper on the same task
      delete from public.task_helpers th using public.tasks t
        where th.task_id = t.id and th.user_id = v_mord and t.owner_id = v_mord;
    end if;
    delete from public.task_helpers where user_id = v_rich;
    delete from public.site_memberships where user_id = v_rich;
    delete from public.organization_memberships where user_id = v_rich;
    delete from auth.users where id = v_rich; -- cascades his profile
  end if;

  -- Remove Richard from the static RACI reference
  update public.raci_entries set assignments = assignments - 'Richard Hunt';
end
$fix$;

-- Confirm: 5 people, all @evertideinfusion.com, no Richard.
select name, email, title from public.profiles order by name;
