import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { ArchiveToggleButton, FolderForm } from "@/components/admin/admin-forms";
import { FolderIcon } from "@/components/icons";
import type { DocumentFolder } from "@/lib/types";

export const metadata = { title: "Document folders" };
export const dynamic = "force-dynamic";

export default async function AdminFoldersPage() {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("document_folders")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .order("sort_order");
  const folders = (data ?? []) as unknown as DocumentFolder[];
  const active = folders.filter((f) => !f.archived_at);

  return (
    <div className="space-y-4">
      <PageHeader title="Admin — Document folders" subtitle="The folder taxonomy for the knowledge base." />
      <Card title="Add folder">
        <FolderForm parents={active.filter((f) => !f.parent_folder_id).map((f) => ({ id: f.id, name: f.name }))} />
      </Card>
      <Card title={`Folders (${folders.length})`}>
        <ul className="divide-y divide-slate-100">
          {folders.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className={`flex min-w-0 flex-1 items-center gap-2 text-sm ${f.archived_at ? "text-slate-400 line-through" : "text-slate-800"} ${f.parent_folder_id ? "pl-6" : "font-medium"}`}>
                <FolderIcon className="h-4 w-4 shrink-0 opacity-70" /> {f.name}
              </span>
              <ArchiveToggleButton entity="document_folders" id={f.id} archived={!!f.archived_at} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
