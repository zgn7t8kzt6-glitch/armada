"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePerson, saveVendor } from "@/app/actions/people";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { Person, Profile, Vendor } from "@/lib/types";

export function PersonModalButton({
  profiles, defaultOwnerId, person, label,
}: { profiles: Profile[]; defaultOwnerId: string; person?: Person; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <>
      <button type="button" className={person ? "btn-secondary !min-h-9 !px-3 !py-1 text-xs" : "btn-primary"} onClick={() => setOpen(true)}>
        {label ?? (person ? "Edit" : "+ New person")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={person ? "Edit person" : "New person"} wide>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (person) fd.set("personId", person.id);
            startTransition(async () => {
              const res = await savePerson(fd);
              if (!res.ok) push(res.error, "error");
              else {
                push("Saved", "success");
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div>
            <label className="label" htmlFor="pp-first">First name</label>
            <input id="pp-first" name="firstName" required className="input" defaultValue={person?.first_name ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="pp-last">Last name</label>
            <input id="pp-last" name="lastName" className="input" defaultValue={person?.last_name ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="pp-type">Type</label>
            <select id="pp-type" name="personType" className="input" defaultValue={person?.person_type ?? "external_contact"}>
              <option value="employee">Employee</option>
              <option value="partner">Partner</option>
              <option value="physician">Physician</option>
              <option value="referral_partner">Referral partner</option>
              <option value="external_contact">External contact</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pp-org">Organization</label>
            <input id="pp-org" name="organizationName" className="input" defaultValue={person?.organization_name ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="pp-title">Title</label>
            <input id="pp-title" name="title" className="input" defaultValue={person?.title ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="pp-status">Status</label>
            <select id="pp-status" name="status" className="input" defaultValue={person?.status ?? "active"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="prospect">Prospect</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pp-email">Email</label>
            <input id="pp-email" name="email" type="email" className="input" defaultValue={person?.email ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="pp-phone">Phone</label>
            <input id="pp-phone" name="phone" className="input" defaultValue={person?.phone ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="pp-owner">Relationship owner</label>
            <select id="pp-owner" name="ownerId" required className="input" defaultValue={person?.owner_id ?? defaultOwnerId}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="pp-notes">Notes</label>
            <textarea id="pp-notes" name="notes" rows={2} className="input" defaultValue={person?.notes ?? ""} />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function VendorModalButton({
  profiles, people, defaultOwnerId, vendor, label,
}: { profiles: Profile[]; people: Person[]; defaultOwnerId: string; vendor?: Vendor; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  return (
    <>
      <button type="button" className={vendor ? "btn-secondary !min-h-9 !px-3 !py-1 text-xs" : "btn-primary"} onClick={() => setOpen(true)}>
        {label ?? (vendor ? "Edit" : "+ New vendor")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={vendor ? "Edit vendor" : "New vendor"} wide>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (vendor) fd.set("vendorId", vendor.id);
            startTransition(async () => {
              const res = await saveVendor(fd);
              if (!res.ok) push(res.error, "error");
              else {
                push("Saved", "success");
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <div className="sm:col-span-2">
            <label className="label" htmlFor="vv-name">Vendor name</label>
            <input id="vv-name" name="name" required className="input" defaultValue={vendor?.name ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="vv-cat">Category</label>
            <input id="vv-cat" name="category" className="input" defaultValue={vendor?.category ?? ""} placeholder="e.g. Wholesaler, IT, GC" />
          </div>
          <div>
            <label className="label" htmlFor="vv-status">Status</label>
            <select id="vv-status" name="status" className="input" defaultValue={vendor?.status ?? "evaluating"}>
              <option value="evaluating">Evaluating</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="vv-contact">Primary contact</label>
            <select id="vv-contact" name="primaryContactPersonId" className="input" defaultValue={vendor?.primary_contact_person_id ?? ""}>
              <option value="">—</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="vv-owner">Relationship owner</label>
            <select id="vv-owner" name="ownerId" required className="input" defaultValue={vendor?.owner_id ?? defaultOwnerId}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="vv-cs">Contract start</label>
            <input id="vv-cs" name="contractStart" type="date" className="input" defaultValue={vendor?.contract_start ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="vv-ce">Contract end</label>
            <input id="vv-ce" name="contractEnd" type="date" className="input" defaultValue={vendor?.contract_end ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="vv-rn">Renewal notice date</label>
            <input id="vv-rn" name="renewalNoticeDate" type="date" className="input" defaultValue={vendor?.renewal_notice_date ?? ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="vv-notes">Notes</label>
            <textarea id="vv-notes" name="notes" rows={2} className="input" defaultValue={vendor?.notes ?? ""} />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
