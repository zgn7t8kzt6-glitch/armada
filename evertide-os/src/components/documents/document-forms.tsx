"use client";

// Document creation + version upload (§7.10). Every upload screen shows the
// admin-configurable no-PHI warning (§2.13).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDocument, toggleDocumentGrant, updateDocumentMeta } from "@/app/actions/documents";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { OwnerChip } from "@/components/ui";
import type { DocumentFolder, DocumentRow, Profile } from "@/lib/types";

export function PhiWarning({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800" role="alert">
      ⚠️ {text}
    </p>
  );
}

async function uploadVersion(documentId: string, file: File, changeSummary: string): Promise<{ ok: boolean; error?: string }> {
  const fd = new FormData();
  fd.set("documentId", documentId);
  fd.set("file", file);
  if (changeSummary) fd.set("changeSummary", changeSummary);
  const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `Upload failed (${res.status})` };
  }
  return { ok: true };
}

export function NewDocumentButton({
  folders, profiles, siteId, defaultOwnerId, phiWarning,
}: { folders: DocumentFolder[]; profiles: Profile[]; siteId: string; defaultOwnerId: string; phiWarning: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    setBusy(true);
    try {
      const created = await createDocument(fd);
      if (!created.ok || !created.documentId) {
        push(!created.ok ? created.error : "Failed", "error");
        return;
      }
      if (file instanceof File && file.size > 0) {
        const up = await uploadVersion(created.documentId, file, "Initial version");
        if (!up.ok) {
          push(`Document created but upload failed: ${up.error}`, "error");
          router.push(`/documents/${created.documentId}`);
          return;
        }
      }
      push("Document created", "success");
      setOpen(false);
      router.push(`/documents/${created.documentId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ New document</button>
      <Modal open={open} onClose={() => setOpen(false)} title="New document" wide>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <PhiWarning text={phiWarning} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nd-title">Title</label>
            <input id="nd-title" name="title" required maxLength={300} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="nd-folder">Folder</label>
            <select id="nd-folder" name="folderId" required className="input">
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nd-owner">Owner</label>
            <select id="nd-owner" name="ownerId" required className="input" defaultValue={defaultOwnerId}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nd-type">Document type</label>
            <input id="nd-type" name="documentType" className="input" placeholder="e.g. Contract, SOP, License" />
          </div>
          <div>
            <label className="label" htmlFor="nd-conf">Confidentiality</label>
            <select id="nd-conf" name="confidentiality" className="input" defaultValue="internal">
              <option value="internal">Internal (all members)</option>
              <option value="restricted">Restricted (admins + grants)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nd-review">Review date</label>
            <input id="nd-review" name="reviewDate" type="date" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="nd-scope">Scope</label>
            <select id="nd-scope" name="siteId" className="input" defaultValue={siteId}>
              <option value={siteId}>This site</option>
              <option value="">Organization-wide</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nd-desc">Description</label>
            <textarea id="nd-desc" name="description" rows={2} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nd-file">File (first version, max shown at upload)</label>
            <input id="nd-file" name="file" type="file" className="input" />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create document"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function UploadVersionButton({ documentId, phiWarning }: { documentId: string; phiWarning: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const router = useRouter();

  return (
    <>
      <button type="button" className="btn-teal text-xs" onClick={() => setOpen(true)}>⬆ Upload new version</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload new version">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const file = fd.get("file");
            const summary = String(fd.get("changeSummary") ?? "");
            if (!(file instanceof File) || file.size === 0) return;
            setBusy(true);
            const res = await uploadVersion(documentId, file, summary);
            setBusy(false);
            if (!res.ok) push(res.error ?? "Upload failed", "error");
            else {
              push("New version uploaded", "success");
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <div className="mb-3">
            <PhiWarning text={phiWarning} />
          </div>
          <label className="label" htmlFor="uv-file">File</label>
          <input id="uv-file" name="file" type="file" required className="input" />
          <label className="label mt-3" htmlFor="uv-summary">What changed?</label>
          <input id="uv-summary" name="changeSummary" className="input" maxLength={1000} placeholder="Change summary" />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DocumentMetaForm({
  doc, folders, profiles, canWrite,
}: { doc: DocumentRow; folders: DocumentFolder[]; profiles: Profile[]; canWrite: boolean }) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  if (!canWrite) return null;

  return (
    <form
      className="grid grid-cols-2 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("documentId", doc.id);
        startTransition(async () => {
          const res = await updateDocumentMeta(fd);
          if (!res.ok) push(res.error, "error");
          else {
            push("Saved", "success");
            router.refresh();
          }
        });
      }}
    >
      <div className="col-span-2">
        <label className="label" htmlFor="dm-title">Title</label>
        <input id="dm-title" name="title" className="input" defaultValue={doc.title} />
      </div>
      <div>
        <label className="label" htmlFor="dm-folder">Folder</label>
        <select id="dm-folder" name="folderId" className="input" defaultValue={doc.folder_id}>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="dm-owner">Owner</label>
        <select id="dm-owner" name="ownerId" className="input" defaultValue={doc.owner_id}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="dm-status">Status</label>
        <select id="dm-status" name="status" className="input" defaultValue={doc.status}>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="under_review">Under review</option>
          <option value="superseded">Superseded</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="dm-review">Review date</label>
        <input id="dm-review" name="reviewDate" type="date" className="input" defaultValue={doc.review_date ?? ""} />
      </div>
      <div className="col-span-2 flex justify-end">
        <button type="submit" className="btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save metadata"}</button>
      </div>
    </form>
  );
}

export function GrantEditor({
  documentId, grants, profiles,
}: { documentId: string; grants: Array<{ user_id: string }>; profiles: Profile[] }) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function toggle(userId: string) {
    startTransition(async () => {
      const res = await toggleDocumentGrant(documentId, userId);
      if (!res.ok) push(res.error, "error");
      else router.refresh();
    });
  }

  return (
    <ul className="space-y-1.5">
      {profiles.map((p) => {
        const granted = grants.some((g) => g.user_id === p.id);
        return (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <OwnerChip profile={p} />
            <button
              type="button"
              className={granted ? "btn-danger !min-h-8 !px-2 !py-0.5 text-2xs" : "btn-secondary !min-h-8 !px-2 !py-0.5 text-2xs"}
              disabled={pending}
              onClick={() => toggle(p.id)}
            >
              {granted ? "Revoke" : "Grant"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
