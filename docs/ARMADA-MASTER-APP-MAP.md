# ARMADA BEHAVIORAL HEALTH OPERATING SYSTEM
## Master App Map — Reorganization Plan (no code changes yet)

*Combines the system audit with the target 18-module structure. Every existing view, table, workflow, and automation is assigned. Dispositions: **KEEP** (as-is) · **EXPAND** (make facility-aware/multi-facility) · **RENAME** · **MERGE** · **ARCHIVE-candidate** · **REBUILD** (net-new or redesign). Risk: LOW / MED / HIGH.*

---

## PART A — GOVERNING DECISIONS

**A1. Hierarchy.** Company (Armada Recovery LLC) → Brands (Armada / Spark / Hilltop / Reverie) → **Facilities** (the 8 operating entities already in `hr_employees.entity` + Ownership) → Departments → Users. New canonical table `org_facilities`; the string entities used by hr/corp modules map onto it via the normalizer (already written client-side; moves server-side).

**A2. `facility_id` principle.** Added **nullable, backfilled to Armada Detox of Akron**, additive-only, module by module, behind per-module scoping flags. Existing single-facility queries keep working until each module's scoping is switched on and verified. Corporate-level records (insurance, leases, entities vault, HR corp records) key on facility/entity where relevant but live at company scope.

**A3. Naming collision (critical).** Existing table `facilities` = **external referral-partner organizations** (Salesforce-linked). It will be **RENAMED in concept to "Referral Partners"** (UI first; table alias later). `org_facilities` is the new internal-facility table. No data merged between them, ever.

**A4. The Housing suite is the wall prototype.** Hilltop's module (50 tables, own roles, own nav) already behaves like a facility instance with hard access walls. The permission system is seeded to reproduce today's four walls exactly (housing / corporate-EA / outpatient-allowlist / HR) before anything becomes configurable.

**A5. Tasks strategy — adapters, not table merges.** Seven task-like tables exist (`tasks, assigned_tasks, shift_tasks, case_tasks, corp_tasks, hr_onboard_tasks, followups`). Merging them is the highest-risk move available and buys little. Instead: a new **`org_tasks` engine** (assigned user, facility, department, priority, due, status, escalation, related record) for all NEW cross-department automation, plus a **unified Task Inbox view** that reads the existing tables through adapters. Nothing existing moves.

**A6. Build vs integrate.** UR/Authorizations: build in-app (Kipu exposes the data; probes already work). Billing/RCM: integrate/report first (Kipu is the biller of record; QuickBooks for finance) — do not attempt in-app claims processing in v1. Payroll: stays QuickBooks.

---

## PART B — THE 18 MODULES: WHAT MAPS WHERE

### 1. Corporate Command Center
| Current | Where | Disposition | Risk | Next step |
|---|---|---|---|---|
| Ownership dashboard | view `ownership` | **EXPAND** → Executive Overview + Facility Comparison spine | MED (Kipu pulls) | Add per-facility drill-down + comparison grid |
| Corporate Hub dashboard | `corphub` dashboard tab | KEEP → Corporate Services pulse | LOW | none |
| HCOS dashboard | `hcos` dashboard | KEEP → HR Overview tile source | LOW | surface into exec overview |
| HR roster + payroll totals | `ownership→ownHr` | KEEP → HR/Finance overview | LOW | none |
| Weekly care report email | `src/report.js` | EXPAND per-facility + rollup | MED | after facility_id |
| Exec Dashboard shell (all-module tiles) | — | **REBUILD (net-new)** | — | Phase 1 deliverable |
| Facility Comparison | — | **REBUILD** on Ownership's data fns | — | Phase 4 |
| Revenue/Billing/Auth overviews | — | REBUILD (depends on modules 8–9) | — | Phase 4+ |

### 2. Facility Operations (per-facility environment)
| Current | Where | Disposition | Risk | Next step |
|---|---|---|---|---|
| Command Center | `command` | **RENAME** → "Facility Dashboard (Detox Akron)" | LOW | facility switcher slot |
| My Shift/today, operations, ops_routines, command_checklist, environment_checks | views+tables | KEEP → facility-scoped | LOW | facility_id |
| Inventory + reorders | `inventory`, 3 tables | KEEP/EXPAND (order stream already multi-facility) | LOW | per-facility par lists later |
| Maintenance | `maintenance` (+facility col ✓) | KEEP | LOW | scope UI by facility |
| Meals/laundry/dignity/engagement/program/property(belongings)/concierge | views+tables | KEEP → facility patient-services | LOW | facility_id via client |
| **Hilltop Housing suite (entire)** | `src/housing.js`, 50 tables | **KEEP AS-IS** = Facility instances (type: sober living) | HIGH if touched | do not modify; register as facilities |
| Staff sign-ins | `staffsignins` | KEEP → Admin/Facility ops | LOW | none |

### 3. Admissions
| Current | Where | Disposition | Risk | Next step |
|---|---|---|---|---|
| Arrivals board (SF+Kipu fed) | `arrivals`, `expected_arrivals` | KEEP/EXPAND → multi-facility queue w/ facility assign | MED (SF sync) | facility on arrival rows |
| Arrival checklist | `arrivalcheck` | KEEP | LOW | per-facility checklist templates |
| Admissions pipeline | `admissions` view/table | KEEP/EXPAND | LOW–MED (verify overlap w/ expected_arrivals first — flagged) | inventory then merge decision |
| Admit/Discharge check | `admitcheck` | KEEP (diagnostics) | LOW | none |
| Insurance verification, pre-admission screening, financial approval | — | **REBUILD (net-new)** | — | Phase 4 |
| Referral source tracking | `inbound_referrals` | KEEP (shared w/ BD) | LOW | none |

### 4. Census / Bed Management
Bed board/bed map/beds/bed_turnovers (**KEEP**, facility_id LOW); live census + census email (**KEEP/EXPAND** per facility, MED — counting logic is hardened, copy don't rewrite); outpatient census (**KEEP** = template for Dayton/Spark clone, MED); housing beds (**KEEP** as-is); pending admissions/discharges, transfers (**EXPAND** from flow_events + anticipated_dc, LOW); AMA risk feed (from Retention, cross-listed); occupancy forecast (**REBUILD**, needs beds-per-facility from `org_facilities`).

### 5. Clinical Operations
| Current | Where | Disposition | Risk |
|---|---|---|---|
| Client care cards + editor + Client 360 | `clients/editor/journey`, `clients` table | KEEP → Patient Chart | **HIGH** (heart of app) — facility_id backfill only, no query changes until verified |
| Kipu chart/records/evaluations | `records`, kipu.js | KEEP | HIGH (don't touch sync) |
| Rounds + QR scan-proof | `rounds/roundscan` | KEEP → per-facility scan points | MED |
| Vitals, withdrawal scores, med admin, comfort meds | tables | KEEP | LOW |
| Retention/AMA (AI reads, saves, debriefs) | `retention` | KEEP → Clinical Quality | MED (AI pipelines) |
| Incidents | `incidents` | KEEP (shared w/ Compliance) | LOW |
| Medical sendouts | table | KEEP | LOW |
| Discharge planning/page + debrief learnings | `dischargepage` | KEEP | MED |
| Assessments/treatment plans/group notes AUTHORING | — | **NOT REBUILT** — Kipu remains the EMR of record; Armada reads via API | — |

### 6. Case Management
casemgmt + case_tasks (**KEEP**); family contacts/updates (**KEEP**); continuum/aftercare + AI aftercare plan (**KEEP**); alumni (**KEEP**, shared w/ BD & Peer); employment/housing coordination (housing suite, **KEEP**); ROI/releases + document tracking (**REBUILD** under Documents); transportation (**EXPAND** — housing has vehicle/coordination; detox has none formal). All LOW–MED.

### 7. Peer Support
Today: engagement/program/activities, recovery-coach features (housing), alumni check-ins, growth-style goal tools. Disposition: **EXPAND** — assemble a thin Peer Support module reusing engagement + alumni + a new peer-session note type; no dedicated build until staffing exists for it. Risk LOW. *(Owner decision: priority level.)*

### 8. Utilization Review / Authorizations
Exists: Kipu UR probe (auth periods w/ numbers/dates), outpatient program-history, PHP-completion analytics, `outpatient_clients` auth-adjacent data. Disposition: **REBUILD in-app on proven Kipu feeds** — authorization register per patient (auth #, LOC, start/end, next review), expiration alerts (reuse reminder engine), concurrent-review task generation into `org_tasks`, denial/appeal log (new tables), UR dashboard. Risk MED. First step: per-patient auth sync job from the UR probe endpoints.

### 9. Billing / RCM
Exists: `revenue_days` (light), doc-readiness signals (doc-gap flags, dischargeMissing checks — **these are billing-readiness checks already**). Disposition: **REBUILD as reporting/readiness layer**: documentation-readiness queue per claim-able stay, auth-linked-to-billing view (from module 8), revenue by facility (Kipu/QBO import), aging via QBO integration. **Not** in-app claims submission v1. Risk MED. Dependency: owner decision on QBO in-app connection.

### 10. HR
| Current | Disposition |
|---|---|
| HCOS Phase 1 (live) + Phase 2–4 backend (branch: offboarding, policies/acks, requisitions, self-service, pulse, analytics, comp history) | **KEEP + finish wiring** (first build task after reorg approval) |
| Hiring pipeline + scorecards (`hiring`, candidates) | KEEP → HR/Recruiting; `side`→facility_id |
| hr_employees(entity ✓) + certs/reviews/coaching/cases/leave/onboard/events | KEEP |
| Employees, Leadership Mirror, growth plans, My Stats | KEEP → HR/Development |
| Training/courses/library/standard + training_ack | KEEP → HR Training (+Compliance view) |
| 90-day Belonging plan + onboarding curriculum | KEEP — merge conceptually with HCOS onboarding checklist (MERGE, MED — do carefully; they serve different layers: culture vs logistics) |
| Staffing dashboard per facility | EXPAND from hr_employees.entity | 

### 11. Finance
`finance`, `expenses`, `revenue_days` views/tables (**KEEP — internals flagged for inventory before changes**); Corporate Hub: orders/spend (**KEEP** → Procurement), vendors (**KEEP**), payments/accounts (**KEEP**), entity vault banking (**KEEP**, wall intact); leases (**KEEP** → Finance/Corporate Services; docs cross-listed); purchase approvals (**EXPAND** — add approval step to order_requests); P&L/budget/cost-per-patient-day (**REBUILD** via QBO). Risk LOW–MED.

### 12. Business Development
`facilities` table (**RENAME → referral_partners**, HIGH-care rename: Salesforce sync + partners view depend on it — UI rename first, table alias later); inbound/outbound referrals (**KEEP**); partners view (**KEEP/RENAME**); referral insights AI (**KEEP**); Salesforce integration (**KEEP**); alumni relations (**KEEP**, shared); CRM/campaigns/tour tracking (**REBUILD** later). 

### 13. Compliance / Risk
Incidents (KEEP, cross-listed); doc compliance view (`compliance`) (KEEP/EXPAND); audit_log (KEEP → HIPAA/audit reporting); business insurance module + matrix + reminders (KEEP — moves here from Corp Hub conceptually); staff certifications watch (KEEP, HR-shared); policy acks (branch — finish); housing ORH/NARR (KEEP); grievances (housing has; detox via clientvoice — EXPAND); facility licensing register (**REBUILD** — reuse insurance/cert reminder engine on `org_facilities`); CAPs (**REBUILD**, light). Risk LOW.

### 14. Scheduling
schedule/coverage/weekgrid/assign/staffmodel/roster + shifts/templates/assignments/staffing_standard (**KEEP/EXPAND** — facility_id on shifts; per-facility coverage rules, MED risk: lineup + coverage alerts read these); housing staff shifts (KEEP as-is); open shifts/call-offs/OT & credential-requirements-on-shift (**REBUILD** additions); patient appointments + group schedule (module 8/5 dependency; outpatient group sessions already pulled from Kipu).

### 15. Documents
corp_files (uploads w/ AI extraction ✓), facility_docs, hr_documents+acks (branch), lease/insurance file links, training docs/doc_reads (**KEEP all**) → unified **Document Center** shell over them (REBUILD, LOW) with: folders by facility/module, expiration alerts (engine exists), versioning + e-sign (**REBUILD**, MED — e-sign = acknowledgement pattern extended; true signatures later/DocuSign decision).

### 16. Tasks / Notifications
Existing seven task tables + alerts + messages + followups (**KEEP ALL**, per A5); **REBUILD**: `org_tasks` engine + unified Task Inbox + notification router (email/SMS/in-app, per-facility routing). All new automations (auth expiring, treatment-plan due, credential missing, claim-doc missing, license expiring, PIP check-in) write to `org_tasks`. Risk LOW (additive).

### 17. Reports / Analytics
report/report-view + weekly email (KEEP); scorecard/outcomes/analytics views (KEEP — inventory internals, flagged); HCOS analytics (branch — finish); census emails (KEEP/EXPAND per facility); **REBUILD**: cross-facility Analytics Center (comparison, occupancy, turnover, time-to-hire, LOS, referral conversion) fed by org_facilities + facility_id data.

### 18. Admin Settings
settings, users, audit, integrations (Kipu/email/SMS/SF/AI), facility-mapping editor, intake routes (**KEEP**) + **REBUILD**: org_facilities manager, permission-matrix UI, role editor (role_profiles exists as seed), notification-routing config.

---

## PART C — DATABASE DISPOSITION (grouped)

| Group (tables) | Target level | facility_id action | Risk |
|---|---|---|---|
| clients + 40 clinical/patient tables | Patient@Facility | via `clients.facility_id` backfill=Detox; children inherit through client | **HIGH** — backfill only in Phase 1; scoping flag per module |
| outpatient_clients | Patient@Facility | add facility_id (has implicit location) | MED |
| housing_* (50) | Facility instances (Hilltop/Reverie) | register facilities; NO schema changes | HIGH if touched — don't |
| scheduling group (shifts, templates, assignments, staffing_standard…) | Facility | add facility_id, backfill Detox | MED |
| facility ops (inventory_*, maintenance_*, ops_*, environment, meals, laundry…) | Facility | add facility_id (maintenance ✓ has) | LOW |
| staff/culture (users, employee_profiles, kudos, growth_*, training, candidates, lineup…) | Company (person-level) | optional facility tag; users get facility_access | LOW |
| hr_* (13) | Company w/ entity | map entity→org_facilities FK | LOW |
| corporate (orders, vendors, insurance, leases, entity vault, corp_files, portals…) | Company | entity string → FK | LOW |
| BD (facilities→referral_partners, inbound/outbound_referrals, alumni_notes) | Company | rename plan (A3) | MED |
| system (app_state, audit_log, sessions, messages, alerts, followups) | System | none (audit_log gains facility col for new events) | LOW — sessions/auth untouchable |
| NEW: org_facilities, org_departments, user_facility_access, role_permissions, org_tasks, notifications, authorizations, denials, licenses, caps | — | born facility-aware | — |

**Permission model (target, per your spec):** `role_permissions(role_id, module, action[view/create/edit/approve/delete/export], scope[corporate/regional/facility/department/assigned_only/self_only])` + `user_facility_access(user_id, facility_id, role_id)` — **seeded to reproduce today's walls exactly**, verified, then made configurable in Admin Settings.

---

## PART D — EXECUTION PHASES (mapped to yours)

**Phase 1 — Foundation (LOW risk, additive):** org_facilities (+seed 8), org_departments, user_facility_access, role_permissions (seeded from current hardcoded walls), facility_id columns + backfills (clients, shifts, inventory, incidents, arrivals), nav reorg into the 18 groups (views re-grouped, none removed), facility switcher (pattern exists), Corporate Command Center shell wrapping Ownership. *Everything behind flags; app behaves identically until flipped.*

**Phase 2 — Access control:** switch guards to permission tables module-by-module (order: corporate modules → HR → facility ops → scheduling → clinical LAST); audit-log coverage widened; notification routing.

**Phase 3 — Feature migration:** the dispositions in Part B (renames: command→Facility Dashboard, facilities→Referral Partners UI; merges: belonging-plan×HCOS-onboarding decision; archive-candidates: none yet — `projects`, `raffle_entries`, `time_entries`, `revenue_days`, `warehouse.js` to be inventoried first, per audit flags).

**Phase 4 — Operating modules (build order):** 1) finish HCOS P2–4 wiring (backend done) → 2) UR/Auth register + alerts → 3) Admissions multi-facility queue + insurance-verification step → 4) Census per facility + comparison → 5) Billing-readiness/RCM reporting (+QBO decision) → 6) Compliance center (licensing register) → 7) Document Center → 8) Analytics Center → 9) Peer Support thin module → 10) Finance P&L (QBO).

**Phase 5 — Automation:** org_tasks engine + escalations; port the 18 existing timers to facility-aware; new checks (auth expiry, plan-update due, credential missing, claim-doc missing, license expiry, PIP check-ins) — all reusing the proven threshold+`reminded` reminder engine.

**HIGH-RISK register (change only with tests):** src/kipu.js sync; realDischargeCount/census helpers; auth/sessions; canSeeView/GROUP_OF; housing.js (freeze); sw.js cache discipline; `facilities` rename (SF dependency).

**OWNER DECISIONS NEEDED:** ① Canonical facility list & brands (confirm the 8 + which count as "facilities" vs corp entities: CGSS/SZS/Propco). ② QuickBooks in-app for Finance/Billing? ③ E-sign: acknowledgement-level or true DocuSign? ④ Peer Support priority. ⑤ Regional layer needed now or later (permission scope reserves it either way).
