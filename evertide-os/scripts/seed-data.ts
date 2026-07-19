// EverTide OS seed data — transcribed verbatim from the v2 specification (§12).

export const ORGANIZATION = { name: "EverTide Infusion", slug: "evertide-infusion" };

export const SITE = {
  name: "Jacksonville Site 1",
  slug: "jacksonville-1",
  address_line_1: "7880 Gate Parkway, Suite 201",
  city: "Jacksonville",
  state: "FL",
  timezone: "America/New_York",
  target_opening_date: "2027-01-04",
};

export type SeedUser = {
  name: string;
  email: string;
  role: "org_admin" | "member";
  title: string;
  avatar_color: string;
};

export const USERS: SeedUser[] = [
  { name: "Shlomo", email: "shlomo@evertide.example", role: "org_admin", title: "CEO", avatar_color: "#1F3864" },
  { name: "Jared Friedman", email: "jared@evertide.example", role: "org_admin", title: "Chief Development Officer", avatar_color: "#2E7D6B" },
  { name: "Dr. Zev Neurwith", email: "zev@evertide.example", role: "member", title: "Chief Medical Officer", avatar_color: "#7C3AED" },
  { name: "Mordechai Neurwith", email: "mordechai@evertide.example", role: "member", title: "Operations", avatar_color: "#B45309" },
  { name: "Aaron Jacobs", email: "aaron@evertide.example", role: "member", title: "RCM / Billing & Authorizations", avatar_color: "#0E7490" },
  { name: "Richard Hunt", email: "richard@evertide.example", role: "member", title: "Support, part-time", avatar_color: "#4D7C0F" },
];

export type SeedTask = {
  legacy_id: number;
  phase: string;
  workstream: string;
  title: string;
  owner: string;
  helpers: string;
  start_date: string;
  due_date: string;
  status: "not_started" | "in_progress" | "blocked" | "done";
  percent_done: number;
  critical: boolean;
  notes: string;
};

export const TASKS: SeedTask[] = [
  { legacy_id: 1, phase: "0 – Lease & Legal Foundation", workstream: "Legal & Corporate", title: "Receive final lease redline from counsel; complete final review vs. negotiated terms (TI allowance, commencement, exclusivity)", owner: "Shlomo", helpers: "Jared Friedman", start_date: "2026-07-17", due_date: "2026-07-23", status: "in_progress", percent_done: 50, critical: false, notes: "Example update: redline received from BMD 7/17; final read scheduled 7/21. — Shlomo" },
  { legacy_id: 2, phase: "0 – Lease & Legal Foundation", workstream: "Legal & Corporate", title: "Execute lease for 7880 Gate Parkway, Suite 201; confirm commencement date & TI delivery conditions in writing", owner: "Shlomo", helpers: "Jared Friedman", start_date: "2026-07-24", due_date: "2026-07-28", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 3, phase: "0 – Lease & Legal Foundation", workstream: "Legal & Corporate", title: "Finalize HoldCo/SiteCo structure and operating agreements with BMD (Jeana); confirm equity grants (Jared 4%, Zev 5%, Aaron 5%) are papered", owner: "Shlomo", helpers: "Aaron Jacobs", start_date: "2026-07-17", due_date: "2026-08-14", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 4, phase: "0 – Lease & Legal Foundation", workstream: "Legal & Corporate", title: "Confirm ownership structure supports chosen licensure pathway (physician ownership % drives AHCA clinic license vs. exemption)", owner: "Shlomo", helpers: "Dr. Zev Neurwith", start_date: "2026-07-20", due_date: "2026-07-31", status: "not_started", percent_done: 0, critical: true, notes: "Gate item — do before AHCA filings" },
  { legacy_id: 5, phase: "0 – Lease & Legal Foundation", workstream: "Legal & Corporate", title: "Bind insurance: general liability, property, workers' comp, medical malpractice (entity + Zev), cyber", owner: "Mordechai Neurwith", helpers: "Shlomo", start_date: "2026-08-03", due_date: "2026-09-04", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 6, phase: "0 – Lease & Legal Foundation", workstream: "Legal & Corporate", title: "Register SiteCo with FL Dept. of Revenue; Duval County local business tax receipt; city registrations", owner: "Mordechai Neurwith", helpers: "Aaron Jacobs", start_date: "2026-08-03", due_date: "2026-08-21", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 7, phase: "0 – Lease & Legal Foundation", workstream: "Legal & Corporate", title: "Medical Director Agreement for Dr. Neurwith (scope, supervision, stipend) executed", owner: "Shlomo", helpers: "Dr. Zev Neurwith", start_date: "2026-08-03", due_date: "2026-08-28", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 8, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "Confirm FL licensure pathway with health care counsel (AHCA Health Care Clinic license vs. exemption certificate) and file application", owner: "Shlomo", helpers: "Dr. Zev Neurwith", start_date: "2026-07-20", due_date: "2026-08-21", status: "not_started", percent_done: 0, critical: true, notes: "CRITICAL PATH — AHCA processing can run 60–90+ days" },
  { legacy_id: 9, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "Obtain Type 2 NPI for SiteCo; confirm taxonomy codes", owner: "Aaron Jacobs", helpers: "Mordechai Neurwith", start_date: "2026-07-27", due_date: "2026-08-07", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 10, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "DEA registration for Jacksonville location (if controlled substances stocked); FL dispensing/office-use compliance review", owner: "Dr. Zev Neurwith", helpers: "Mordechai Neurwith", start_date: "2026-08-10", due_date: "2026-09-18", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 11, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "CLIA Certificate of Waiver (point-of-care labs) application", owner: "Dr. Zev Neurwith", helpers: "Mordechai Neurwith", start_date: "2026-08-17", due_date: "2026-09-25", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 12, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "Medicare enrollment decision + PECOS 855B filing if pursuing Part B buy-and-bill", owner: "Aaron Jacobs", helpers: "Dr. Zev Neurwith", start_date: "2026-08-03", due_date: "2026-09-11", status: "not_started", percent_done: 0, critical: false, notes: "Decide before payer contracting sequencing" },
  { legacy_id: 13, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "Verify Zev's FL license, board status, malpractice history docs packaged for all credentialing files", owner: "Aaron Jacobs", helpers: "Dr. Zev Neurwith", start_date: "2026-07-27", due_date: "2026-08-07", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 14, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "OSHA/bloodborne pathogen, biohazard waste hauler contract, sharps program", owner: "Mordechai Neurwith", helpers: "Dr. Zev Neurwith", start_date: "2026-10-05", due_date: "2026-11-13", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 15, phase: "1 – Licensure, Enrollment & Credentialing (Long-Lead)", workstream: "Licensure & Regulatory", title: "Fire marshal inspection & certificate of occupancy coordination with GC", owner: "Mordechai Neurwith", helpers: "Shlomo", start_date: "2026-11-02", due_date: "2026-12-04", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 16, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "Finalize space plan & TI construction drawings (infusion bays, med room, waiting, ADA)", owner: "Shlomo", helpers: "Mordechai Neurwith", start_date: "2026-07-27", due_date: "2026-08-21", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 17, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "Select GC, execute construction contract, pull permits", owner: "Shlomo", helpers: "Mordechai Neurwith", start_date: "2026-08-17", due_date: "2026-09-11", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 18, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "TI construction — demo through final punch list", owner: "Mordechai Neurwith", helpers: "Shlomo", start_date: "2026-09-14", due_date: "2026-11-20", status: "not_started", percent_done: 0, critical: false, notes: "Weekly GC check-in; photos to huddle" },
  { legacy_id: 19, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "Order long-lead FF&E: infusion chairs, recliners, IV poles, med refrigerator w/ continuous temp monitoring, emergency cart", owner: "Mordechai Neurwith", helpers: "Dr. Zev Neurwith", start_date: "2026-08-24", due_date: "2026-10-16", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 20, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "IT infrastructure: internet, network, phones, fax, security cameras, access control", owner: "Mordechai Neurwith", helpers: "Richard Hunt", start_date: "2026-10-05", due_date: "2026-11-13", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 21, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "Interior branding & exterior signage (landlord + city approval)", owner: "Jared Friedman", helpers: "Mordechai Neurwith", start_date: "2026-09-07", due_date: "2026-11-06", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 22, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "Furniture, TVs, wifi for patients, coffee/snack station — patient experience walkthrough (Schulze standards)", owner: "Mordechai Neurwith", helpers: "Jared Friedman", start_date: "2026-11-09", due_date: "2026-12-04", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 23, phase: "2 – Buildout & Facility", workstream: "Buildout & Facility", title: "Final deep clean, life-safety checks, mock patient walk-through of full visit journey", owner: "Mordechai Neurwith", helpers: "Dr. Zev Neurwith", start_date: "2026-12-07", due_date: "2026-12-18", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 24, phase: "3 – Payers, Pharmacy & RCM", workstream: "Payer Contracting", title: "Finalize target payer list & contracting strategy (FL Blue, UHC, Aetna, Cigna, Medicare; Medicaid decision)", owner: "Jared Friedman", helpers: "Aaron Jacobs", start_date: "2026-07-27", due_date: "2026-08-14", status: "not_started", percent_done: 0, critical: false, notes: "Gating condition from go/no-go" },
  { legacy_id: 25, phase: "3 – Payers, Pharmacy & RCM", workstream: "Payer Contracting", title: "Submit credentialing applications for Dr. Neurwith + facility to all target payers", owner: "Aaron Jacobs", helpers: "Jared Friedman", start_date: "2026-08-17", due_date: "2026-09-04", status: "not_started", percent_done: 0, critical: true, notes: "CRITICAL PATH — 90–150 day cycles; submit everything same week" },
  { legacy_id: 26, phase: "3 – Payers, Pharmacy & RCM", workstream: "Payer Contracting", title: "Weekly credentialing status tracker & payer follow-up call cadence", owner: "Aaron Jacobs", helpers: "Richard Hunt", start_date: "2026-09-07", due_date: "2026-12-31", status: "not_started", percent_done: 0, critical: false, notes: "Standing agenda item at weekly huddle" },
  { legacy_id: 27, phase: "3 – Payers, Pharmacy & RCM", workstream: "Payer Contracting", title: "Negotiate fee schedules; model reimbursement vs. drug acquisition cost per top 15 J-codes", owner: "Aaron Jacobs", helpers: "Jared Friedman", start_date: "2026-10-05", due_date: "2026-12-11", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 28, phase: "3 – Payers, Pharmacy & RCM", workstream: "Pharmacy & Drug Supply", title: "Open wholesaler/specialty distributor accounts (Cencora, McKesson); credit terms & drug float sized", owner: "Aaron Jacobs", helpers: "Shlomo", start_date: "2026-09-07", due_date: "2026-10-23", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 29, phase: "3 – Payers, Pharmacy & RCM", workstream: "Pharmacy & Drug Supply", title: "Formulary v1: target therapies (biologics for rheum/GI/neuro/derm), NDC list, par levels, cold-chain SOP", owner: "Dr. Zev Neurwith", helpers: "Aaron Jacobs", start_date: "2026-09-21", due_date: "2026-11-06", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 30, phase: "3 – Payers, Pharmacy & RCM", workstream: "Pharmacy & Drug Supply", title: "Inventory management workflow in infusion platform; receiving, lot/expiry tracking, waste documentation", owner: "Mordechai Neurwith", helpers: "Aaron Jacobs", start_date: "2026-11-02", due_date: "2026-12-04", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 31, phase: "3 – Payers, Pharmacy & RCM", workstream: "RCM & Billing", title: "Design end-to-end RCM workflow: referral intake → benefits investigation → prior auth → scheduling → charge capture → claim → AR follow-up", owner: "Aaron Jacobs", helpers: "Mordechai Neurwith", start_date: "2026-08-24", due_date: "2026-10-02", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 32, phase: "3 – Payers, Pharmacy & RCM", workstream: "RCM & Billing", title: "Clearinghouse, billing platform, charge master (J-codes, admin codes 96365–96417), payer-specific edits", owner: "Aaron Jacobs", helpers: "Richard Hunt", start_date: "2026-10-05", due_date: "2026-11-13", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 33, phase: "3 – Payers, Pharmacy & RCM", workstream: "RCM & Billing", title: "Copay assistance / manufacturer program enrollment playbook (per-drug foundations, hub services)", owner: "Aaron Jacobs", helpers: "Jared Friedman", start_date: "2026-10-19", due_date: "2026-11-20", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 34, phase: "3 – Payers, Pharmacy & RCM", workstream: "RCM & Billing", title: "Financial policy, patient cost estimate script, and financial counseling SOP", owner: "Aaron Jacobs", helpers: "Mordechai Neurwith", start_date: "2026-11-09", due_date: "2026-12-04", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 35, phase: "4 – Clinical, Staffing & Systems", workstream: "Clinical Operations", title: "Clinical protocol library: standing orders per therapy, infusion rates, pre-meds, monitoring parameters", owner: "Dr. Zev Neurwith", helpers: "Jared Friedman", start_date: "2026-09-07", due_date: "2026-11-06", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 36, phase: "4 – Clinical, Staffing & Systems", workstream: "Clinical Operations", title: "Emergency protocols: anaphylaxis, infusion reactions, code response, EMS activation; crash kit contents & checks", owner: "Dr. Zev Neurwith", helpers: "Mordechai Neurwith", start_date: "2026-10-05", due_date: "2026-11-20", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 37, phase: "4 – Clinical, Staffing & Systems", workstream: "Clinical Operations", title: "Consent forms, patient education materials, adverse event reporting workflow", owner: "Dr. Zev Neurwith", helpers: "Mordechai Neurwith", start_date: "2026-10-19", due_date: "2026-11-27", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 38, phase: "4 – Clinical, Staffing & Systems", workstream: "Clinical Operations", title: "Nursing competency checklists & skills validation program (IV access, ports, reaction management)", owner: "Dr. Zev Neurwith", helpers: "Mordechai Neurwith", start_date: "2026-11-02", due_date: "2026-12-11", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 39, phase: "4 – Clinical, Staffing & Systems", workstream: "Staffing & HR", title: "Org chart + job descriptions: lead infusion RN, infusion RN(s), intake/benefits coordinator, MA/front desk", owner: "Shlomo", helpers: "Mordechai Neurwith", start_date: "2026-09-07", due_date: "2026-09-25", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 40, phase: "4 – Clinical, Staffing & Systems", workstream: "Staffing & HR", title: "Recruit & hire lead infusion RN (target start ~4 wks pre-open)", owner: "Shlomo", helpers: "Dr. Zev Neurwith", start_date: "2026-09-28", due_date: "2026-11-13", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 41, phase: "4 – Clinical, Staffing & Systems", workstream: "Staffing & HR", title: "Recruit & hire remaining team; background checks, license verification, payroll/benefits setup", owner: "Mordechai Neurwith", helpers: "Shlomo", start_date: "2026-10-12", due_date: "2026-12-04", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 42, phase: "4 – Clinical, Staffing & Systems", workstream: "Staffing & HR", title: "EverTide orientation: culture-first onboarding (Schulze Day 1), standards handbook, service scripts, 90-day competency gate", owner: "Shlomo", helpers: "Mordechai Neurwith", start_date: "2026-12-07", due_date: "2026-12-18", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 43, phase: "4 – Clinical, Staffing & Systems", workstream: "Systems & Technology", title: "Select & contract infusion EMR/workflow platform (e.g., WeInfuse-type); implementation kickoff", owner: "Mordechai Neurwith", helpers: "Aaron Jacobs", start_date: "2026-08-24", due_date: "2026-09-18", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 44, phase: "4 – Clinical, Staffing & Systems", workstream: "Systems & Technology", title: "Platform build: templates, order sets, scheduling rules, inventory, billing integration; staff training", owner: "Mordechai Neurwith", helpers: "Aaron Jacobs", start_date: "2026-09-21", due_date: "2026-12-11", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 45, phase: "4 – Clinical, Staffing & Systems", workstream: "Systems & Technology", title: "E-fax/referral intake channel, phone tree, website scheduling request form live", owner: "Richard Hunt", helpers: "Mordechai Neurwith", start_date: "2026-10-19", due_date: "2026-11-27", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 46, phase: "5 – Referral Development & Marketing", workstream: "Referral Development", title: "Referral market map: top 50 target prescribers (rheum, GI, neuro, derm) in Jacksonville metro w/ current infusion destination", owner: "Jared Friedman", helpers: "Richard Hunt", start_date: "2026-08-10", due_date: "2026-09-11", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 47, phase: "5 – Referral Development & Marketing", workstream: "Referral Development", title: "Collateral & referral kit: one-pager, referral form, insurance grid, service pledge", owner: "Jared Friedman", helpers: "Richard Hunt", start_date: "2026-09-14", due_date: "2026-10-09", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 48, phase: "5 – Referral Development & Marketing", workstream: "Referral Development", title: "Prescriber outreach wave 1 (Zev peer-to-peer + Jared): 25 offices before opening", owner: "Jared Friedman", helpers: "Dr. Zev Neurwith", start_date: "2026-10-12", due_date: "2026-12-18", status: "not_started", percent_done: 0, critical: false, notes: "Track visits & committed referrals weekly" },
  { legacy_id: 49, phase: "5 – Referral Development & Marketing", workstream: "Referral Development", title: "Website, Google Business Profile, local SEO live; phone & referral fax tested end-to-end", owner: "Jared Friedman", helpers: "Richard Hunt", start_date: "2026-10-19", due_date: "2026-11-20", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 50, phase: "5 – Referral Development & Marketing", workstream: "Referral Development", title: "Open house / launch event for referring offices (week before opening)", owner: "Jared Friedman", helpers: "Mordechai Neurwith", start_date: "2026-12-14", due_date: "2026-12-29", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 51, phase: "5 – Referral Development & Marketing", workstream: "Referral Development", title: "Secure 10+ committed patient referrals pre-opening; first-week schedule built", owner: "Jared Friedman", helpers: "Aaron Jacobs", start_date: "2026-11-30", due_date: "2027-01-01", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 52, phase: "0 – Lease & Legal Foundation", workstream: "Finance", title: "Open SiteCo bank accounts; QuickBooks entity setup; chart of accounts", owner: "Aaron Jacobs", helpers: "Shlomo", start_date: "2026-07-27", due_date: "2026-08-14", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 53, phase: "3 – Payers, Pharmacy & RCM", workstream: "Finance", title: "Working capital plan: drug float sizing, LOC if needed, 6-month cash runway model", owner: "Shlomo", helpers: "Aaron Jacobs", start_date: "2026-09-14", due_date: "2026-10-16", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 54, phase: "4 – Clinical, Staffing & Systems", workstream: "Finance", title: "Opening budget vs. actual tracker; monthly close cadence; KPI scorecard (chair utilization, referral-to-infusion conversion, days to auth, AR days)", owner: "Aaron Jacobs", helpers: "Shlomo", start_date: "2026-11-02", due_date: "2026-12-11", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 55, phase: "6 – Pre-Opening Countdown", workstream: "Accountability System", title: "Launch weekly EverTide leadership huddle (Studer): scorecard review, wins, blockers, owner commitments — every Tuesday", owner: "Shlomo", helpers: "Mordechai Neurwith", start_date: "2026-07-28", due_date: "2026-07-28", status: "not_started", percent_done: 0, critical: false, notes: "Recurs weekly through opening" },
  { legacy_id: 56, phase: "6 – Pre-Opening Countdown", workstream: "Accountability System", title: "30/60/90-day leader plans for Jared, Zev, Mordechai, Aaron tied to this roadmap", owner: "Shlomo", helpers: "Jared Friedman", start_date: "2026-08-03", due_date: "2026-08-14", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 57, phase: "6 – Pre-Opening Countdown", workstream: "Accountability System", title: "Adapt Armada Excellence Standards Handbook for EverTide (service values, scripts, defect review)", owner: "Shlomo", helpers: "Jared Friedman", start_date: "2026-09-07", due_date: "2026-10-30", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 58, phase: "6 – Pre-Opening Countdown", workstream: "Pre-Opening", title: "Dry-run days: 2 full mock infusion days with staff (check-in → chair → discharge → billing), defect log & fixes", owner: "Dr. Zev Neurwith", helpers: "Mordechai Neurwith", start_date: "2026-12-21", due_date: "2026-12-31", status: "not_started", percent_done: 0, critical: false, notes: "" },
  { legacy_id: 59, phase: "6 – Pre-Opening Countdown", workstream: "Pre-Opening", title: "Opening readiness checklist sign-off: licensure, at least 2 payer contracts effective, staff credentialed, drugs on shelf, EMR live", owner: "Shlomo", helpers: "Aaron Jacobs", start_date: "2026-12-28", due_date: "2027-01-01", status: "not_started", percent_done: 0, critical: true, notes: "Go/no-go gate" },
  { legacy_id: 60, phase: "6 – Pre-Opening Countdown", workstream: "Pre-Opening", title: "OPENING DAY — first patient infused", owner: "Shlomo", helpers: "All", start_date: "2027-01-04", due_date: "2027-01-04", status: "not_started", percent_done: 0, critical: false, notes: "Target date; slips if AHCA or payer effective dates slip" },
];

export type SeedMilestone = {
  title: string;
  target_date: string;
  gate_criteria: string;
  owner: string;
  status: "pending";
};

export const MILESTONES: SeedMilestone[] = [
  { title: "Lease executed", target_date: "2026-07-28", gate_criteria: "Signed lease; TI delivery date confirmed in writing", owner: "Shlomo", status: "pending" },
  { title: "AHCA licensure application filed", target_date: "2026-08-21", gate_criteria: "Pathway confirmed by counsel; complete application submitted", owner: "Shlomo", status: "pending" },
  { title: "All payer credentialing submitted", target_date: "2026-09-04", gate_criteria: "Every target payer application in, same week, tracked weekly", owner: "Aaron Jacobs", status: "pending" },
  { title: "Construction start", target_date: "2026-09-14", gate_criteria: "Permits pulled; GC contract executed", owner: "Mordechai Neurwith", status: "pending" },
  { title: "EMR platform contracted", target_date: "2026-09-18", gate_criteria: "Vendor signed; implementation plan with dates", owner: "Mordechai Neurwith", status: "pending" },
  { title: "Lead RN hired", target_date: "2026-11-13", gate_criteria: "Offer accepted; start date ≥4 weeks pre-open", owner: "Shlomo", status: "pending" },
  { title: "Construction substantially complete", target_date: "2026-11-20", gate_criteria: "Punch list only; CO path clear", owner: "Mordechai Neurwith", status: "pending" },
  { title: "First payer contract effective", target_date: "2026-12-11", gate_criteria: "At least one major commercial payer live; 2+ preferred", owner: "Aaron Jacobs", status: "pending" },
  { title: "Drugs on shelf", target_date: "2026-12-18", gate_criteria: "Wholesaler accounts live; formulary v1 stocked; cold chain verified", owner: "Aaron Jacobs", status: "pending" },
  { title: "Mock infusion days complete", target_date: "2026-12-31", gate_criteria: "2 dry runs done; defect log closed", owner: "Dr. Zev Neurwith", status: "pending" },
  { title: "Go/no-go readiness sign-off", target_date: "2027-01-01", gate_criteria: "Licensure + payers + staff + drugs + EMR all green", owner: "Shlomo", status: "pending" },
  { title: "OPENING DAY", target_date: "2027-01-04", gate_criteria: "First patient infused", owner: "Shlomo", status: "pending" },
];

export type SeedKpi = {
  category: "Financial" | "Operations" | "Clinical" | "Growth";
  name: string;
  unit: string;
  frequency: "weekly" | "monthly";
  direction: "higher_is_better" | "lower_is_better" | "target_range";
  target: number;
  owner: string;
  description: string;
  green_min?: number;
  green_max?: number;
  yellow_min?: number;
  yellow_max?: number;
};

// Yellow/green bands are an implementation decision (see README): they make
// the RAG deterministic without inventing fake values.
export const KPIS: SeedKpi[] = [
  { category: "Financial", name: "Cash runway", unit: "months", frequency: "weekly", direction: "higher_is_better", target: 6, owner: "Shlomo", description: "Unrestricted cash divided by current forecast monthly cash burn.", green_min: 6, yellow_min: 4 },
  { category: "Financial", name: "Opening budget variance", unit: "percent", frequency: "weekly", direction: "lower_is_better", target: 0, owner: "Aaron Jacobs", description: "Actual plus committed opening spend versus approved opening budget. Zero or below is green.", green_max: 0, yellow_max: 5 },
  { category: "Operations", name: "Roadmap completion", unit: "percent", frequency: "weekly", direction: "higher_is_better", target: 100, owner: "Mordechai Neurwith", description: "Weighted percent complete across all opening tasks. Dashboard also compares actual to planned completion by date.", green_min: 95, yellow_min: 85 },
  { category: "Operations", name: "Construction completion", unit: "percent", frequency: "weekly", direction: "higher_is_better", target: 100, owner: "Mordechai Neurwith", description: "GC-reported percent complete, supported by weekly photo/update.", green_min: 95, yellow_min: 85 },
  { category: "Operations", name: "Open blockers", unit: "count", frequency: "weekly", direction: "lower_is_better", target: 0, owner: "Shlomo", description: "Number of unresolved blocked tasks and high-priority issues.", green_max: 0, yellow_max: 2 },
  { category: "Operations", name: "Stale in-progress tasks", unit: "count", frequency: "weekly", direction: "lower_is_better", target: 0, owner: "Shlomo", description: "In-progress tasks with no attributed update for seven or more days.", green_max: 0, yellow_max: 3 },
  { category: "Clinical", name: "Clinical readiness checklist", unit: "percent", frequency: "weekly", direction: "higher_is_better", target: 100, owner: "Dr. Zev Neurwith", description: "Completion of protocols, emergency readiness, consents, competencies, and mock-day prerequisites.", green_min: 100, yellow_min: 80 },
  { category: "Clinical", name: "Staffing readiness", unit: "percent", frequency: "weekly", direction: "higher_is_better", target: 100, owner: "Shlomo", description: "Required opening roles accepted, cleared, onboarded, and competency-ready.", green_min: 100, yellow_min: 80 },
  { category: "Growth", name: "Effective payer contracts", unit: "count", frequency: "weekly", direction: "higher_is_better", target: 2, owner: "Aaron Jacobs", description: "Payer contracts with an effective date on or before opening and operationally loaded.", green_min: 2, yellow_min: 1 },
  { category: "Growth", name: "Referral offices engaged", unit: "count", frequency: "weekly", direction: "higher_is_better", target: 25, owner: "Jared Friedman", description: "Distinct target practices with a documented substantive outreach interaction.", green_min: 25, yellow_min: 15 },
  { category: "Growth", name: "Committed patient referrals", unit: "count", frequency: "weekly", direction: "higher_is_better", target: 10, owner: "Jared Friedman", description: "Documented pre-opening patient referrals expected to schedule in opening week.", green_min: 10, yellow_min: 5 },
];

export const FOLDERS: string[] = [
  "Legal & Corporate",
  "Lease & Real Estate",
  "Licensure & Regulatory",
  "Payers & Credentialing",
  "Pharmacy & Drug Supply",
  "Clinical & Quality",
  "Staffing & HR",
  "Systems & Technology",
  "Finance",
  "Referral Development & Marketing",
  "Meetings & Decisions",
  "SOPs & Policies",
];

export const ANNUAL_GOAL = {
  title: "Open Jacksonville Site 1 safely and successfully by January 4, 2027",
  goal_type: "annual" as const,
  owner: "Shlomo",
  start_date: "2026-07-17",
  due_date: "2027-01-04",
  status: "active" as const,
  success_criteria:
    "Licensure in hand, at least 2 payer contracts effective, staff credentialed, drugs on shelf, EMR live, first patient infused on January 4, 2027.",
};

export const RACI: Array<{ workstream: string; assignments: Record<string, string> }> = [
  { workstream: "Lease, Legal & Corporate", assignments: { "Shlomo": "A", "Jared Friedman": "C", "Dr. Zev Neurwith": "I", "Mordechai Neurwith": "R", "Aaron Jacobs": "C", "Richard Hunt": "I" } },
  { workstream: "Licensure & Regulatory", assignments: { "Shlomo": "A", "Jared Friedman": "I", "Dr. Zev Neurwith": "R", "Mordechai Neurwith": "R", "Aaron Jacobs": "C", "Richard Hunt": "I" } },
  { workstream: "Buildout & Facility", assignments: { "Shlomo": "A", "Jared Friedman": "C", "Dr. Zev Neurwith": "C", "Mordechai Neurwith": "R", "Aaron Jacobs": "I", "Richard Hunt": "C" } },
  { workstream: "Payer Contracting & Credentialing", assignments: { "Shlomo": "I", "Jared Friedman": "A", "Dr. Zev Neurwith": "C", "Mordechai Neurwith": "I", "Aaron Jacobs": "R", "Richard Hunt": "C" } },
  { workstream: "Pharmacy & Drug Supply", assignments: { "Shlomo": "I", "Jared Friedman": "C", "Dr. Zev Neurwith": "A", "Mordechai Neurwith": "R", "Aaron Jacobs": "R", "Richard Hunt": "I" } },
  { workstream: "Clinical Protocols & Quality", assignments: { "Shlomo": "I", "Jared Friedman": "C", "Dr. Zev Neurwith": "A", "Mordechai Neurwith": "R", "Aaron Jacobs": "I", "Richard Hunt": "I" } },
  { workstream: "Staffing, HR & Onboarding", assignments: { "Shlomo": "A", "Jared Friedman": "C", "Dr. Zev Neurwith": "C", "Mordechai Neurwith": "R", "Aaron Jacobs": "I", "Richard Hunt": "I" } },
  { workstream: "Systems & Technology (EMR/RCM stack)", assignments: { "Shlomo": "I", "Jared Friedman": "I", "Dr. Zev Neurwith": "C", "Mordechai Neurwith": "A", "Aaron Jacobs": "R", "Richard Hunt": "R" } },
  { workstream: "RCM, Billing & Prior Auth", assignments: { "Shlomo": "I", "Jared Friedman": "C", "Dr. Zev Neurwith": "C", "Mordechai Neurwith": "C", "Aaron Jacobs": "A", "Richard Hunt": "R" } },
  { workstream: "Referral Development & Marketing", assignments: { "Shlomo": "I", "Jared Friedman": "A", "Dr. Zev Neurwith": "R", "Mordechai Neurwith": "C", "Aaron Jacobs": "C", "Richard Hunt": "R" } },
  { workstream: "Finance, Budget & Scorecard", assignments: { "Shlomo": "A", "Jared Friedman": "I", "Dr. Zev Neurwith": "I", "Mordechai Neurwith": "I", "Aaron Jacobs": "R", "Richard Hunt": "I" } },
  { workstream: "Culture, Standards & Huddle System", assignments: { "Shlomo": "A", "Jared Friedman": "R", "Dr. Zev Neurwith": "C", "Mordechai Neurwith": "R", "Aaron Jacobs": "I", "Richard Hunt": "I" } },
];
