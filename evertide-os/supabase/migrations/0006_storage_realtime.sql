-- EverTide OS — 0006: private storage bucket and Realtime publication.

-- Private bucket for all document versions. Paths follow
--   {organization_id}/{site_id|org}/{document_id}/{version_id}-{filename}
insert into storage.buckets (id, name, public, file_size_limit)
values ('evertide-documents', 'evertide-documents', false, 26214400) -- 25 MB default
on conflict (id) do nothing;

-- All uploads and downloads flow through server routes that validate
-- membership, size, and type, then use the service role (which bypasses RLS)
-- and hand out short-lived signed URLs. Browser clients get no direct access,
-- so the only storage.objects policies are deny-by-default (RLS enabled, no
-- permissive policies for this bucket). This is the tightest possible stance:
-- cross-tenant access via storage keys is impossible for client tokens.

-- Realtime (§8): broadcast changes for the collaborative tables.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table
  public.tasks,
  public.task_updates,
  public.issues,
  public.issue_updates,
  public.kpi_entries,
  public.huddles,
  public.huddle_commitments,
  public.decisions,
  public.notifications;

-- Full row images so realtime payloads carry old values for updates.
alter table public.tasks replica identity full;
alter table public.issues replica identity full;
alter table public.kpi_entries replica identity full;
alter table public.huddles replica identity full;
alter table public.huddle_commitments replica identity full;
alter table public.decisions replica identity full;
