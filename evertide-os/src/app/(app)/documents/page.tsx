import Link from "next/link";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import { SimpleFilters } from "@/components/simple-filters";
import { NewDocumentButton, PhiWarning } from "@/components/documents/document-forms";
import { formatDate } from "@/lib/format";
import type { DocumentFolder, DocumentRow, Profile } from "@/lib/types";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

// Documents (§7.10): folder tree, list, upload, search, no-PHI warning.
export default async function DocumentsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();
  const s = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const activeFolder = s("folder");

  const [foldersQ, profilesQ] = await Promise.all([
    supabase
      .from("document_folders")
      .select("*")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("sort_order"),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
  ]);
  const folders = (foldersQ.data ?? []) as unknown as DocumentFolder[];
  const profiles = (profilesQ.data ?? []) as Profile[];

  let query = supabase
    .from("documents")
    .select("*, owner:profiles!documents_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("organization_id", ctx.organization.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (activeFolder) query = query.eq("folder_id", activeFolder);
  if (s("status")) query = query.eq("status", s("status")!);
  if (s("type")) query = query.eq("document_type", s("type")!);
  if (s("q")) {
    const safe = s("q")!.replace(/[%_,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  const { data: docsData } = await query;
  const docs = (docsData ?? []) as unknown as DocumentRow[];
  const types = [...new Set(docs.map((d) => d.document_type).filter((t): t is string => !!t))];

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="One authoritative home for every document — versioned, access-controlled, linked."
        action={
          ctx.canWrite ? (
            <NewDocumentButton
              folders={folders}
              profiles={profiles}
              siteId={ctx.site.id}
              defaultOwnerId={ctx.userId}
              phiWarning={ctx.site.no_phi_warning}
            />
          ) : undefined
        }
      />

      <div className="mb-4">
        <PhiWarning text={ctx.site.no_phi_warning} />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Folder tree */}
        <nav className="no-print w-full shrink-0 lg:w-60" aria-label="Folders">
          <ul className="rounded-lg border border-slate-200 bg-white p-2">
            <li>
              <Link
                href="/documents"
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${!activeFolder ? "bg-navy-50 text-navy-700" : "text-slate-600 hover:bg-slate-50"}`}
              >
                📁 All documents
              </Link>
            </li>
            {folders
              .filter((f) => !f.parent_folder_id)
              .map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/documents?folder=${f.id}`}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium ${activeFolder === f.id ? "bg-navy-50 text-navy-700" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    📁 {f.name}
                  </Link>
                  {folders
                    .filter((c) => c.parent_folder_id === f.id)
                    .map((c) => (
                      <Link
                        key={c.id}
                        href={`/documents?folder=${c.id}`}
                        className={`ml-4 block rounded-lg px-3 py-1.5 text-xs font-medium ${activeFolder === c.id ? "bg-navy-50 text-navy-700" : "text-slate-500 hover:bg-slate-50"}`}
                      >
                        📂 {c.name}
                      </Link>
                    ))}
                </li>
              ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <SimpleFilters
            searchKey="q"
            selects={[
              {
                key: "status", label: "Any status",
                options: ["draft", "active", "under_review", "superseded", "archived"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
              },
              { key: "type", label: "Any type", options: types.map((t) => ({ value: t, label: t })) },
            ]}
          />
          <Card>
            {docs.length === 0 ? (
              <p className="text-sm text-slate-500">No documents here yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="flex min-h-touch flex-wrap items-center gap-2 py-2.5 hover:bg-slate-50">
                      <span aria-hidden>{d.confidentiality === "restricted" ? "🔒" : "📄"}</span>
                      <span className="min-w-0 flex-1 basis-64 text-sm font-medium text-slate-800">
                        {d.title}
                        {d.document_type && <span className="ml-2 text-2xs text-slate-400">{d.document_type}</span>}
                      </span>
                      <StatusPill status={d.status} />
                      <OwnerChip profile={d.owner} />
                      {d.review_date && <span className="text-2xs text-slate-400">review {formatDate(d.review_date)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
