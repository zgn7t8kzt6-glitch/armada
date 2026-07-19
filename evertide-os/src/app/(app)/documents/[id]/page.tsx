import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, OwnerChip, PageHeader, StatusPill } from "@/components/ui";
import {
  DocumentMetaForm, GrantEditor, PhiWarning, UploadVersionButton,
} from "@/components/documents/document-forms";
import { formatDateTime } from "@/lib/format";
import { DownloadIcon } from "@/components/icons";
import type { DocumentFolder, DocumentRow, DocumentVersion, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Document detail (§7.10): metadata, immutable version history, signed
// downloads, restricted-access grants, related links.
export default async function DocumentDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getAppContext();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("documents")
    .select("*, owner:profiles!documents_owner_id_fkey(id,name,email,title,avatar_color)")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) notFound();
  const doc = data as unknown as DocumentRow;

  const [versionsQ, foldersQ, profilesQ, grantsQ, linksQ] = await Promise.all([
    supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", doc.id)
      .order("version_number", { ascending: false }),
    supabase.from("document_folders").select("*").eq("organization_id", ctx.organization.id).is("archived_at", null).order("sort_order"),
    supabase.from("profiles").select("id,name,email,title,avatar_color").order("name"),
    ctx.isAdmin ? supabase.from("document_access_grants").select("user_id").eq("document_id", doc.id) : Promise.resolve({ data: [] }),
    supabase.from("document_links").select("id,linked_type,linked_id").eq("document_id", doc.id),
  ]);
  const versions = (versionsQ.data ?? []) as unknown as DocumentVersion[];

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="no-print mb-2 text-xs text-slate-400">
        <Link href="/documents" className="hover:underline">Documents</Link> / Detail
      </nav>
      <PageHeader
        title={doc.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={doc.status} />
            {doc.confidentiality === "restricted" && <StatusPill status="at_risk" label="Restricted" />}
            {doc.source_of_truth && <StatusPill status="active" label="Source of truth" />}
            <OwnerChip profile={doc.owner} />
          </span>
        }
        action={ctx.canWrite ? <UploadVersionButton documentId={doc.id} phiWarning={ctx.site.no_phi_warning} /> : undefined}
      />

      <div className="space-y-4">
        {doc.description && (
          <Card title="Description">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{doc.description}</p>
          </Card>
        )}

        <Card title={`Version history (${versions.length})`}>
          <div className="mb-3">
            <PhiWarning text={ctx.site.no_phi_warning} />
          </div>
          {versions.length === 0 ? (
            <p className="text-sm text-slate-500">No file uploaded yet. Upload the first version.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className={`inline-flex h-7 w-9 items-center justify-center rounded-lg text-xs font-black ${v.id === doc.current_version_id ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-500"}`}>
                    v{v.version_number}
                  </span>
                  <span className="min-w-0 flex-1 basis-52">
                    <span className="block truncate font-medium text-slate-800">{v.original_filename}</span>
                    <span className="block text-2xs text-slate-400">
                      {humanSize(v.size_bytes)} · {formatDateTime(v.created_at, ctx.site.timezone)}
                      {v.change_summary && ` · ${v.change_summary}`}
                    </span>
                  </span>
                  <a href={`/api/documents/download/${v.id}`} className="btn-secondary !min-h-9 !px-3 !py-1 text-xs">
                    <DownloadIcon className="h-3.5 w-3.5" /> Download
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-2xs text-slate-400">
            Versions are immutable — files are never overwritten. Downloads use short-lived signed URLs.
          </p>
        </Card>

        <Card title="Metadata">
          <DocumentMetaForm
            doc={doc}
            folders={(foldersQ.data ?? []) as unknown as DocumentFolder[]}
            profiles={profilesQ.data as Profile[]}
            canWrite={ctx.canWrite}
          />
        </Card>

        {ctx.isAdmin && doc.confidentiality === "restricted" && (
          <Card title="Access grants (restricted document)">
            <p className="mb-3 text-xs text-slate-500">
              Restricted documents are visible only to admins, the owner, and explicitly granted members.
            </p>
            <GrantEditor documentId={doc.id} grants={(grantsQ.data ?? []) as Array<{ user_id: string }>} profiles={profilesQ.data as Profile[]} />
          </Card>
        )}

        {(linksQ.data ?? []).length > 0 && (
          <Card title="Related objects">
            <ul className="space-y-1 text-xs text-slate-600">
              {(linksQ.data ?? []).map((l) => (
                <li key={l.id}>{l.linked_type}: {l.linked_id}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
