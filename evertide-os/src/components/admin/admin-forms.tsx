"use client";

// Admin interactive pieces (§7.14).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  inviteUser, removeUser, saveFolder, setOpeningRisk, updateMembership, updateSiteSettings,
} from "@/app/actions/admin";
import { saveKpiDefinition } from "@/app/actions/kpis";
import { archiveRecord } from "@/app/actions/tasks";
import { ConfirmDialog, Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { Kpi, Profile, Site } from "@/lib/types";

function useAct() {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) push(res.error ?? "Failed", "error");
      else {
        push(success, "success");
        router.refresh();
      }
    });
  return { pending, act };
}

export function SiteSettingsForm({ site }: { site: Site }) {
  const { pending, act } = useAct();
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        act(() => updateSiteSettings(fd), "Settings saved");
      }}
    >
      <div>
        <label className="label" htmlFor="ss-name">Site name</label>
        <input id="ss-name" name="name" className="input" defaultValue={site.name} />
      </div>
      <div>
        <label className="label" htmlFor="ss-tz">Timezone (IANA)</label>
        <input id="ss-tz" name="timezone" className="input" defaultValue={site.timezone} />
      </div>
      <div>
        <label className="label" htmlFor="ss-open">Target opening date</label>
        <input id="ss-open" name="targetOpeningDate" type="date" className="input" defaultValue={site.target_opening_date ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="ss-upload">Max upload size (MB)</label>
        <input id="ss-upload" name="maxUploadMb" type="number" min={1} max={100} className="input" defaultValue={site.max_upload_mb} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="ss-phi">No-PHI warning text</label>
        <input id="ss-phi" name="noPhiWarning" className="input" defaultValue={site.no_phi_warning} />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
      </div>
    </form>
  );
}

export function OpeningRiskControl({ site }: { site: Site }) {
  const { pending, act } = useAct();
  const [reason, setReason] = useState(site.opening_risk_reason ?? "");

  return site.opening_risk_declared ? (
    <div className="space-y-2">
      <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
        Opening risk is <strong>declared</strong>: {site.opening_risk_reason}
      </p>
      <button type="button" className="btn-secondary" disabled={pending} onClick={() => act(() => setOpeningRisk(false, ""), "Opening-risk declaration cleared")}>
        Clear declaration
      </button>
    </div>
  ) : (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        act(() => setOpeningRisk(true, reason.trim()), "Opening risk declared — banner active");
      }}
    >
      <div className="min-w-64 flex-1">
        <label className="label" htmlFor="or-reason">Reason (required)</label>
        <input id="or-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the opening date at risk?" />
      </div>
      <button type="submit" className="btn-danger" disabled={pending || !reason.trim()}>Declare opening risk</button>
    </form>
  );
}

export function InviteUserForm() {
  const { pending, act } = useAct();
  return (
    <form
      className="grid grid-cols-1 gap-2 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        act(() => inviteUser(fd), "Invite sent");
        form.reset();
      }}
    >
      <input name="name" required placeholder="Full name" aria-label="Full name" className="input" />
      <input name="email" required type="email" placeholder="email@company.com" aria-label="Email" className="input" />
      <select name="role" aria-label="Role" className="input" defaultValue="member">
        <option value="org_admin">Org admin</option>
        <option value="site_admin">Site admin</option>
        <option value="member">Member</option>
        <option value="viewer">Viewer</option>
      </select>
      <button type="submit" className="btn-primary" disabled={pending}>Invite</button>
    </form>
  );
}

export function MembershipRow({
  profile, role, active, isSelf,
}: { profile: Profile; role: string; active: boolean; isSelf: boolean }) {
  const { pending, act } = useAct();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { push } = useToast();
  const router = useRouter();
  const [removing, startRemove] = useTransition();

  const doRemove = () =>
    startRemove(async () => {
      const fd = new FormData();
      fd.set("userId", profile.id);
      const res = await removeUser(fd);
      if (!res.ok) push(res.error, "error");
      else {
        push(res.message, "success");
        router.refresh();
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("userId", profile.id);
          act(() => updateMembership(fd), "Membership updated");
        }}
      >
        <select name="role" aria-label={`Role for ${profile.name}`} className="input !min-h-9 !w-auto !py-1 text-xs" defaultValue={role} disabled={isSelf}>
          <option value="org_admin">Org admin</option>
          <option value="site_admin">Site admin</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>
        <select name="active" aria-label={`Status for ${profile.name}`} className="input !min-h-9 !w-auto !py-1 text-xs" defaultValue={active ? "true" : "false"} disabled={isSelf}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        {!isSelf && (
          <button type="submit" className="btn-secondary !min-h-9 !px-3 !py-1 text-xs" disabled={pending}>Save</button>
        )}
      </form>
      {!isSelf && (
        <>
          <button
            type="button"
            className="btn-danger !min-h-9 !px-3 !py-1 text-xs"
            disabled={removing}
            onClick={() => setConfirmOpen(true)}
          >
            {removing ? "Removing…" : "Remove"}
          </button>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={doRemove}
            title={`Remove ${profile.name}?`}
            message={`This removes ${profile.name} from the organization. If they still own tasks or other records, the account is deactivated until that work is reassigned; otherwise it is deleted permanently.`}
            confirmLabel="Remove user"
            destructive
          />
        </>
      )}
    </div>
  );
}

export function KpiDefinitionModal({ siteId, profiles, kpi }: { siteId: string; profiles: Profile[]; kpi?: Kpi }) {
  const [open, setOpen] = useState(false);
  const { pending, act } = useAct();

  return (
    <>
      <button type="button" className={kpi ? "btn-secondary !min-h-9 !px-3 !py-1 text-xs" : "btn-primary"} onClick={() => setOpen(true)}>
        {kpi ? "Edit" : "+ New KPI"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={kpi ? `Edit ${kpi.name}` : "New KPI"} wide>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("siteId", siteId);
            if (kpi) fd.set("kpiId", kpi.id);
            act(() => saveKpiDefinition(fd), "KPI saved");
            setOpen(false);
          }}
        >
          <div className="col-span-2">
            <label className="label" htmlFor="kd-name">Name</label>
            <input id="kd-name" name="name" required className="input" defaultValue={kpi?.name ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kd-cat">Category</label>
            <select id="kd-cat" name="category" className="input" defaultValue={kpi?.category ?? "Operations"}>
              <option>Financial</option>
              <option>Operations</option>
              <option>Clinical</option>
              <option>Growth</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="kd-owner">Owner</label>
            <select id="kd-owner" name="ownerId" required className="input" defaultValue={kpi?.owner_id ?? profiles[0]?.id}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="kd-unit">Unit</label>
            <input id="kd-unit" name="unit" className="input" defaultValue={kpi?.unit ?? ""} placeholder="percent / count / months" />
          </div>
          <div>
            <label className="label" htmlFor="kd-freq">Frequency</label>
            <select id="kd-freq" name="frequency" className="input" defaultValue={kpi?.frequency ?? "weekly"}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="kd-dir">Direction</label>
            <select id="kd-dir" name="direction" className="input" defaultValue={kpi?.direction ?? "higher_is_better"}>
              <option value="higher_is_better">Higher is better</option>
              <option value="lower_is_better">Lower is better</option>
              <option value="target_range">Target range</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="kd-target">Target</label>
            <input id="kd-target" name="targetValue" type="number" step="any" className="input" defaultValue={kpi?.target_value ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kd-gmin">Green min</label>
            <input id="kd-gmin" name="greenMin" type="number" step="any" className="input" defaultValue={kpi?.green_min ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kd-gmax">Green max</label>
            <input id="kd-gmax" name="greenMax" type="number" step="any" className="input" defaultValue={kpi?.green_max ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kd-ymin">Yellow min</label>
            <input id="kd-ymin" name="yellowMin" type="number" step="any" className="input" defaultValue={kpi?.yellow_min ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="kd-ymax">Yellow max</label>
            <input id="kd-ymax" name="yellowMax" type="number" step="any" className="input" defaultValue={kpi?.yellow_max ?? ""} />
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="kd-desc">Description</label>
            <textarea id="kd-desc" name="description" rows={2} className="input" defaultValue={kpi?.description ?? ""} />
          </div>
          <div className="col-span-2 flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" name="active" value="true" defaultChecked={kpi?.active ?? true} className="h-4 w-4 rounded border-slate-300" />
              Active
            </label>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save KPI"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function FolderForm({ parents }: { parents: Array<{ id: string; name: string }> }) {
  const { pending, act } = useAct();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        act(() => saveFolder(fd), "Folder created");
        form.reset();
      }}
    >
      <div className="min-w-52 flex-1">
        <label className="label" htmlFor="ff-name">New folder name</label>
        <input id="ff-name" name="name" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="ff-parent">Parent</label>
        <select id="ff-parent" name="parentFolderId" className="input !w-auto" defaultValue="">
          <option value="">Top level</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>Add folder</button>
    </form>
  );
}

export function ArchiveToggleButton({ entity, id, archived }: { entity: string; id: string; archived: boolean }) {
  const { pending, act } = useAct();
  return (
    <button
      type="button"
      className={archived ? "btn-teal !min-h-9 !px-3 !py-1 text-xs" : "btn-danger !min-h-9 !px-3 !py-1 text-xs"}
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("entity", entity);
        fd.set("id", id);
        fd.set("restore", archived ? "true" : "");
        act(() => archiveRecord(fd), archived ? "Restored" : "Archived");
      }}
    >
      {archived ? "Restore" : "Archive"}
    </button>
  );
}
