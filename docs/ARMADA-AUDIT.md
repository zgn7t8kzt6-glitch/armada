# ARMADA APP — COMPLETE SYSTEM AUDIT
*Prepared before any multi-facility reorganization. Nothing has been changed, deleted, or renamed as part of this audit.*
*State: `main` branch = live app through "HCOS Phase 1". A work-in-progress commit (HCOS Phases 2–4 backend, no UI) sits on the feature branch only and is NOT live.*

---

## 1. CURRENT APP SUMMARY

**What it is:** "Armada Care Standards" — a staff-operations platform originally built for **Armada Detox of Akron** (a detox facility), run on Horst Schulze / Ritz-Carlton service principles. It has grown into four walled worlds in one codebase:

1. **Detox operations** (the core, ~70% of the app): clients/care cards, rounds with QR scan-proof, arrivals/admissions, retention & AMA prevention, meals, laundry, beds, property/belongings, incidents, concierge, discharge & continuum, family updates, compliance, referrals/BD, inventory & maintenance, staffing/scheduling, daily lineup, recognition, training, hiring, growth plans, leadership tools.
2. **Hilltop Recovery Housing suite** (separate module, `src/housing.js`): a complete parallel system for sober-living — houses/beds, residents, intake, drug screens, curfew, chores, rent ledger, vehicles, employment, ORH/NARR compliance, its own lineup/surveys/incidents/staff.
3. **Akron Outpatient** (owner-only): census/analytics for Akron House Recovery pulled live from Kipu (PHP/IOP, LOS, group attendance, PHP completion).
4. **Corporate/Ownership layer** (recent): Ownership dashboard (all 8 entities), Corporate Hub (Chava/EA: orders, projects, insurance, leases + AI lease Q&A, entity vault, vendors, payments, documents, email-in ordering), HR People OS (HCOS Phase 1).

**Scale:** ~603 API routes in `server.js` + 123 in `src/housing.js`; **~150 tables** in `src/db.js` + **50 `housing_*` tables**; 105 page sections; ~100 nav views. SQLite (`node:sqlite`), plain-JS SPA (no framework), PWA with service worker.

**Complete / partial / broken:**
- **Complete & battle-tested:** detox core (clients, rounds, lineup, arrivals, inventory, census emails), Kipu sync incl. dedupe/phantom cleanup, housing suite, hiring pipeline, recognition, insurance module, leases + AI, entity vault, email-in ordering.
- **Partial:** HCOS (Phase 1 live; Phase 2–4 backend written but not wired to UI, branch-only); outpatient group attendance (present/absent flag depends on Kipu data shape); Spark Kipu connection (scaffolded, pending credentials); OneDrive (discussed, not built); org chart/9-box (not built).
- **Known-fragile:** none currently broken that I'm aware of; historical trouble spots were Kipu census churn (fixed with claimedRows + safeguards) and discharge-count inflation (fixed via realDischargeCount).

---

## 2. EXISTING PAGES / VIEWS (SPA views, not URL routes)

Navigation is grouped (GROUP_OF) into: **today, arrival, stay, handoff, housing, team, facility, command**. Facility-specific vs global noted. Recommendation key: **K**eep / **E**xpand / **M**erge / **R**ename / **A**rchive-candidate.

### My Shift (today)
| View | Purpose | Scope | Roles | Rec |
|---|---|---|---|---|
| dashboard | Role-tailored shift home (tiles, tasks, my role) | Detox | all detox staff | K |
| today | Shift overview | Detox | all | K |

### Arrival
| View | Purpose | Scope | Roles | Rec |
|---|---|---|---|---|
| arrivals | Front-desk arrivals board (Salesforce+Kipu fed) | Detox | Front Desk, CM, Clin | K/E (per-facility later) |
| arrivalcheck | Arrival checklist w/ per-worker "Done" | Detox | Front Desk, BHT | K |
| admissions | Admissions pipeline | Detox | FD/CM/Clin | K/E |
| referrals / partners | Inbound/outbound referrals, BD partners (uses `facilities` table = external partners) | Detox | FD/CM/Clin | K — **rename `facilities` table concept to "partners" during migration to avoid collision** |

### Stay (care)
clients, editor, journey (Client 360), records, rounds, roundscan, bedboard, bedmap, laundry, meals, property (belongings w/ dual control), engagement, program, dignity, concierge, casemgmt, retention (AMA risk + debriefs), surveys, clientvoice, incidents, compliance, family — all **detox-scoped**, care roles. **All K**; these are the operational heart. `records`/`journey` pull Kipu chart data live.

### Handoff
dischargepage, continuum, alumni — detox; CM/Clinical. **K**.

### Housing (walled: Housing Director/House Manager/Recovery Coach + admin/ED only)
housing (dashboard), staffhub, hstaffdev, houses, fleet, residents, resident, intake, screens, houselife, housingstaff, shiftreports, hincidents, voice, hmaint, activities, hfarewell, movement, coordination, employment, rentrun, ledger, orh, housingoutcomes — a full parallel suite for Hilltop. **K as-is** — already effectively a second "facility module" and the best template for multi-facility walls.

### Team / culture (universal)
myrole, mystats, mygrowth (6mo/1/5/10-yr goals + monthly check-ins), employees, leadmirror (Leadership Mirror), mytasks, messages, team, workplace, lineup (Ritz daily lineup w/ auto shout-outs & client compliments), accountability, training, library, standard, hiring (candidate pipeline + structured interviews). **All K** — this is the culture layer the HCOS should keep plugging into, not replace.

### Facility (ops)
inventory (par levels, reorders, Pollak weekly order), maintenance (work orders + photos), operations, coverage, schedule, roster, weekgrid, assign, staffmodel, meals. Detox-scoped. **K/E** — inventory & maintenance now feed the corporate order stream; scheduling is detox-only today.

### Command (leadership/admin)
command (Command Center), guide, finance, expenses, plan (90-day Belonging plan), excellence, onboarding (belonging curriculum), playbook, leadership, staffsignins, admitcheck, dupes (Merge Duplicates), **ownership** (all-entities census/admits/discharges + HR roster w/ salaries), **corphub** (Corporate Hub, 10 tabs), **hcos** (HR People OS, 7 tabs), outpatient (Akron Outpatient), outcomes, analytics, scorecard, report-view, settings, users, audit, askai. **All K**; ownership/corphub/hcos are the seeds of the Corporate Command Center.

*(Uncertainty flag: `finance`, `expenses`, `outcomes`, `analytics`, `scorecard`, `operations`, `guide` exist and render, but I have not deeply reviewed their internals this session — inventory them before touching.)*

---

## 3. DATABASE (150 core + 50 housing tables)

Grouped inventory with migration notes. **Almost nothing has a `facility_id` today** — the app was born single-facility. Below, "Level" = where it should live in the target hierarchy.

### Clients & clinical (patient-level, detox facility)
`clients` (master care card; `program`/`loc` = ASAM level, NOT facility), `client_checkins, client_experience, client_sessions, vitals, withdrawal_scores, med_admin, meds, comfort_meds, obs_checks, rounds, round_scans, scan_points, notes, concerns, alerts, ama_reads, ama_defects, saves, ceo_rescues, behavior_contracts/_notes, behavior_checkins, incidents, medical_sendouts, case_tasks, family_contacts, family_updates, visits, delights, wows, requests (concierge), dignity_kits, property_items/_events/_meta, laundry_loads, meal_checks/menu/feedback, snack_checks, bed_turnovers, beds, admissions, expected_arrivals, arrival_checks/items, flow_events, client_merges, daily_metrics, survey_*`
→ **Facility-level (detox)**. Migration: add `facility_id` default = Armada Detox of Akron; low risk (single writer today). `clients.kipu_id` + `KIPU_LOCATION_ID` scoping already isolates the detox census.

### Outpatient (patient-level, Akron House)
`outpatient_clients` — own table, already per-location by design. → Generalize with `facility_id`/entity to serve Dayton + Spark later. **This is the pattern for additional Kipu facilities.**

### Housing (resident-level, Hilltop)
All 50 `housing_*` tables; `housing_houses`/`housing_beds` give intra-module location. → Already a walled facility module; add entity linkage only if Dayton/Indy homes join.

### Staff & culture (employee/user-level, mostly global)
`users` (auth; role/job_role/email/MFA/invites/last_login), `sessions`, `employee_profiles, employee_notes, kudos, extra_mile, staff_pulses, staff_voice, growth_plans, growth_checkins, goals, focus_logs, lineup_log, training_ack, courses/course_*, docs, doc_reads, onboardings, onboarding_progress, plan_progress, completions, role_profiles, candidates` (hiring), `shift_reports, handoffs, ops_handoffs, duty_logs, time_entries, manual_on_shift` → **Global today; fine to remain org-level with an optional facility tag.** `candidates.side` already splits detox/hilltop — a proto-facility field.

### Scheduling (facility-level, detox)
`shifts, shift_templates, shift_staffing, shift_tasks, shift_task_done, schedule_slots/items/assignments, assignments, assigned_tasks, tasks, task_comments, staffing_standard, coverage(-related)` → add `facility_id` in migration; medium risk (lineup + coverage alerts read these).

### Facility ops (facility-level, detox)
`inventory_items/counts, reorder_requests, maintenance_requests/photos, environment_checks, ops_routines/_log, command_checklist` → `maintenance_requests.facility` **already added**; `order_requests.facility` **already added** — the newest pattern to copy.

### Corporate layer (corporate-level — already multi-entity)
`hr_employees` (**has `entity`** = the de-facto facility field for people), `hr_certifications/reviews/coaching/cases/leave/onboard_tasks/events` (+ branch-only: `hr_documents/doc_acks/requisitions/pulse/comp_history`), `order_requests, order_intake_routes, corp_tasks, vendors, facility_docs, payment_methods, corp_files, insurance_policies/brokers, leases, lease_questions, entity_records, entity_bank_accounts, entity_cards, portals` → **Corporate-level; already keyed by entity/facility string.** Migration: standardize entity strings → a canonical `entities` reference table.
- ⚠️ **Highly sensitive:** `entity_cards` stores full card numbers + CVV, `portals` stores plaintext passwords (owner-directed). Any migration must not widen access.

### BD / referrals (corporate)
`facilities` (⚠️ **external referral-partner orgs**, has `salesforce_id` — NOT your own facilities; rename concept to `partners` in migration to free the name), `inbound_referrals, outbound_referrals, alumni_notes` → corporate/BD-level.

### Misc / system
`app_state` (key-value config incl. `facilities_config` JSON used by Ownership), `audit_log`, `messages/message_reads`, `followups`, `projects`, `raffle_entries`, `revenue_days` (finance; uncertain depth), `pulses, belonging_pulses` → system/org-level. `sessions` is auth-critical: **do not touch**.

---

## 4. EXISTING WORKFLOWS

| Workflow | Trigger | Steps / data | Preserve | Multi-facility upgrade |
|---|---|---|---|---|
| **Kipu census sync (detox)** | Manual + auto-interval | Pull census → match by kipu_id/name → upsert clients → discharge sweep w/ mass-deactivation safeguard → phantom/duplicate cleanup | YES — hardest-won logic in the app | Parameterize by location_id per facility (outpatient already does this) |
| **Admissions/arrivals** | Salesforce inbound + Kipu reconcile + manual | expected_arrivals → arrival checklist → admit → care card | YES | facility_id on arrivals |
| **Rounds/safety** | Shift cycles | QR scan points → round_scans → coverage alerts → escalation (SMS-capable) | YES | per-facility scan points |
| **Retention/AMA** | AI assess-all + debriefs | Kipu notes → risk reads → discharge debriefs (reads full chart, evidence-grounded) → learnings | YES | per-facility notes source |
| **Daily lineup** | Cron (ET hour) | Auto-composed: shout-outs, kudos, client compliments, plan content → email/ack | YES — signature culture feature | per-facility lineup variant |
| **Census email** | Midnight cutoff | buildCensusReport: census by level, intakes, discharges+LOS, referred-out w/ in-out, doc-gap nudge | YES | one per facility + corporate rollup |
| **Inventory→orders** | Par-level breach | reorder_requests → email corporate (CC Chava) → mirrors to corporate order_requests (non-food) → Chava queue → landlord auto-email if lease says landlord-responsible | YES | already multi-facility via order_requests.facility |
| **Email-in ordering** | Inbound webhook (M365 flow pending) | Parse email w/ AI → line items → route by sender/+tag → order queue → "Got it" reply | YES | already multi-facility |
| **Insurance renewals** | 12h timer | thresholds 90/60/30/14/7/1 + expired → email Chava+owner | YES | already entity-level |
| **Cert expirations (HCOS)** | 12h timer | 60/30/14/7/1 → email HR | YES | already entity-level |
| **Hiring** | Manual pipeline | candidates → stages → structured interview scorecards → hire → self-signup invite | YES | `side` → facility_id |
| **HCOS lifecycle (Phase 1)** | Start onboarding | 13-task checklist + auto 30/60/90/6mo/annual reviews; coaching; cases; leave; timeline | YES | entity already on hr_employees |
| **Housing workflows** | Various | intake→screens→curfew→chores→rent ledger→farewell; vehicles; ORH | YES — untouched | template for facility walls |
| **Weekly care report** | Hourly check → weekly send | buildWeeklyData → email | YES | per-facility + rollup |
| **Bed-turnover escalation, morale watch, recognition nudge, fastest-responder** | Timers | in-app alerts / wall posts | YES | facility-aware alerts |
| **Billing / UR / payroll** | — | **Do not exist in-app** (QuickBooks exists only as a chat-side connector; Kipu UR probe exists for outpatient auth data) | n/a | net-new |

---

## 5. KEY REUSABLE COMPONENTS (plain-JS patterns, not React)

| Component/pattern | Where | Reusable |
|---|---|---|
| `.mhub` mobile system (tables→cards, pill tabs, touch forms) | corphub, hcos | YES — apply to any new hub |
| `corp-tabs` pill navigation | corphub/hcos | YES |
| `ret-card` stat tiles; `card`/`toolbar`/`tbl`/`pc-note` | everywhere | YES |
| Upload→AI-extract (`corpPickFile` + extract endpoints) | insurance, leases | YES — pattern for any doc |
| AI Q&A panel (lease chat, HR copilot, askai) | 3 places | YES |
| Reminder engine pattern (thresholds+`reminded` JSON) | insurance, certs | YES |
| Kipu connector (`kipuGet`, mapLimit, localDateOf, admissions/census/program-history) | src/kipu.js | YES — parameterize location |
| xlsx reader (`src/xlsx.js`) | entity import | YES |
| Preview-as-role (`PREVIEW_ROLE`) | corporate | YES — extend per role |
| `canSeeView`/GROUP_OF/flatMenu role-menu system | app.js | YES — the hook for facility-scoped navs |

---

## 6. DASHBOARDS & REPORTS

| Dashboard | Metrics | Source | Facility-aware? | Change |
|---|---|---|---|---|
| Command Center | census, flow, discharges (realDischargeCount), engagement, care cards, doc compliance | clients/Kipu | Detox-only | Add facility switcher post-migration |
| Ownership | census/admits/discharges/occupancy per entity + org totals + brands + HR roster w/ payroll | Kipu admissions + local | **YES** (8 entities; Spark pending) | Grow into Corporate Command Center |
| Akron Outpatient | PHP/IOP census, LOS, movement, payers, quick movers, group attendance, PHP completion | Kipu (location-scoped) | Per-location | Clone for Dayton/Spark |
| Corporate Hub dashboard | orders by location + cycle times, maintenance, projects, to-order inbox | order_requests etc. | **YES** | K |
| HCOS dashboard | headcount, pipeline, onboarding, reviews overdue, certs, cases, leave | hr_* | **YES** (entity) | K/E |
| Retention, Outcomes, Analytics, Scorecard, Finance, Housing outcomes | various | local | Detox/Hilltop | Inventory internals before changes (flagged) |
| Emails: census, weekly report, lineup, insurance, certs, doc-gap | — | — | mixed | per-facility variants + rollup |

---

## 7. PERMISSIONS / ACCESS CONTROL

- **Roles:** `users.role` = admin|staff; `users.job_role` ∈ 16 job roles (incl. new Executive Assistant, HR). Housing roles walled from detox; detox staff walled from housing; **Corporate/EA walled to corp lane; outpatient/ownership = admin + explicit allowlist; HCOS = admin/HR/ED.**
- **Server-side guards:** requireAuth, requireAdmin, requireHR, requireCorp, requireOutpatient, canHire(side), leadership-only checks. **Client-side:** canSeeView + data-admin attributes (cosmetic only — server guards are the real wall; spot-checks look consistent but a full endpoint-by-endpoint authz audit has not been done: flag).
- **Security posture:** MFA support, invite flow w/ domain allowlist, kiosk code, rate-limit buckets, audit_log on sensitive actions, PHI de-identification (`scrub`) before AI calls, no PHI in repo.
- **Risks to address in migration:** (1) entity vault (full PANs/CVV, plaintext portal passwords) readable by corp-lane users — owner-accepted, but any new "corporate" role inherits it; (2) intake webhook is token-in-URL (regenerable — fine, but rotate if leaked); (3) permissions are code-defined, not configurable-per-role (target system wants configurable matrix); (4) no per-facility data scoping for staff yet — that's the core migration.

---

## 8. AUTOMATIONS / NOTIFICATIONS (timers & triggers)

1. Daily lineup auto-send (ET hour) 2. Midnight cutoff: finalize day, census email, dignity kits, flow automations, Salesforce arrivals sync 3. Kipu auto-sync (configurable hrs) 4. Outpatient daily refresh 5. Insurance renewal watch (12h) 6. Cert expiration watch (12h) 7. Weekly care report (hourly check) 8. Bed-turnover overdue alerts 9. Morale watch (low staff pulses → leadership) 10. Recognition-habit nudge 11. Weekly fastest-responder award 12. Salesforce arrivals refresher (daytime) 13. Housing movement timer 14. Reorder email on par breach (+Pollak critical alert, weekly Pollak order Mon) 15. Landlord auto-email on landlord-category orders 16. Email-intake confirmations 17. Rounds escalation (SMS-capable) 18. On-call alerts (email/SMS).
*All should gain a facility dimension where relevant; none need rewrites.*

---

## 9. INTEGRATIONS

| Integration | Depth | Notes |
|---|---|---|
| **Kipu EMR** | Deep | census, patient detail/chart/evaluations, admissions history, program history, group sessions, UR probe; per-location; APIAuth HMAC |
| **Anthropic Claude** | Deep | care briefs, AMA reads, debriefs, lineup content, lease Q&A, doc extraction (insurance/lease), order-email parsing, HR copilot, askai; direct API or Bedrock; PHI scrubbed |
| **Email** | Core | SMTP (M365-ready) or Resend; global CC-leadership w/ suppress; many senders |
| **Twilio SMS** | Light | on-call + rounds escalation |
| **Salesforce** | Medium | inbound referrals + expected arrivals sync/automap |
| **Inbound email webhook** | New | /api/inbound/order (provider-agnostic; M365 Power Automate planned) |
| **QuickBooks** | **Chat-side only** | MCP connector in this workspace — NOT integrated in-app; payroll/titles pull discussed |
| **OneDrive/Graph** | Not built | discussed for lease/policy file pull |
| **Auth** | Internal | session cookies, MFA, invites; no SSO |

---

## 10. PRESERVE LIST (do not lose)
- Kipu sync + dedupe/phantom/realDischargeCount logic (src/kipu.js + helpers) — highest-value, hardest-won.
- Discharge-debrief evidence-grounded pipeline + doc-gap flags.
- Daily lineup composer + recognition ecosystem (kudos, extra mile, raffle).
- Housing suite in entirety.
- Arrival checklist / belongings dual-control / rounds scan-proof — compliance-sensitive designs.
- Ritz/Schulze terminology: "warm welcome/fond farewell," Belonging plan, Standard, lineup, saves/CEO rescues, dignity kits.
- Corporate layer: order stream + email-intake + landlord routing; insurance matrix + reminders; lease AI; entity vault (with its access wall); xlsx importer.
- HCOS Phase 1 + branch-only Phase 2–4 backend (uncommitted-to-main work: offboarding, policies/acks, requisitions, self-service, pulse, analytics, comp history).
- All emails (census w/ LOS + referred-out; weekly report), 1–10 scale migration, growth plans, Leadership Mirror, hiring scorecards.
- `app_state` config keys and `audit_log` history; users/sessions/MFA.

---

## 11. GAP ANALYSIS vs TARGET MAP

| Target area | Status |
|---|---|
| Corporate Command Center | **Partially exists** (Ownership + Corp Hub + HCOS) — needs unification & drill-down |
| Facility Operations | **Exists for detox + Hilltop**; needs facility_id + per-facility instances |
| Admissions | **Exists (detox)**; multi-facility missing |
| Census / Bed Management | **Exists (detox beds, housing beds, outpatient census)**; unify per facility |
| Clinical Operations | **Exists (detox)** via app + Kipu; other facilities read-only via Kipu |
| Case Management | **Exists (detox)** |
| Peer Support | **Partially** (housing coaches, engagement); no dedicated peer-support module |
| UR / Authorizations | **Partially** — Kipu UR probe + outpatient auth data; no in-app UR workflow → needs build |
| Billing / Revenue Cycle | **Missing** (revenue_days is a light finance table; QBO is chat-side only) |
| HR | **Exists (HCOS P1 live; P2–4 backend on branch)** |
| Finance | **Partially** (finance/expenses views — depth unverified; flag) |
| Business Development | **Exists** (referrals/partners + Salesforce) |
| Compliance / Risk | **Partially** (doc compliance, incidents, ORH, audit log); no unified compliance center |
| Scheduling | **Exists (detox)**; per-facility missing |
| Documents | **Partially** (corp docs, policy acks on branch, client records); no unified doc center w/ versioning/e-sign |
| Tasks / Notifications | **Exists** (multiple task systems: tasks, corp_tasks, case_tasks, hr_onboard_tasks, followups) — consider a unified inbox later, carefully |
| Reports / Analytics | **Partially** — many dashboards; no cross-facility analytics center (HCOS analytics on branch) |
| Admin Settings | **Exists** |

---

## 12. RECOMMENDED MIGRATION PLAN (safe, additive)

**Principles:** additive-only; feature branch → main only after boot tests; no renames of live tables; `app_state`-gated one-time migrations (existing pattern); housing/corporate walls stay intact.

**Step 0 — freeze & snapshot:** DB backup; tag current main.
**Step 1 — canonical entities:** new `org_facilities` table (id, name, brand, kipu_location, type) seeded from `facilities_config` + hr_employees.entity strings; mapping table for name variants (the entity normalizer already exists client-side — move server-side). *Do NOT reuse the existing `facilities` table (it's referral partners); plan a later rename of that table/UI to "partners."*
**Step 2 — facility_id, nullable, default-detox:** add to clients + clinical children (via client), shifts/scheduling, inventory/maintenance (partially done), incidents, arrivals. Backfill = Armada Detox. Zero behavior change (all queries keep working; add scoping WHERE clauses per module behind a feature flag).
**Step 3 — permissions matrix:** `role_permissions` table (role × module × facility scope) seeded to replicate today's hardcoded walls exactly; switch guards to read it; UI for owner to configure.
**Step 4 — navigation reorg:** facility switcher at top level (pattern exists in Corp Hub); grouped nav per your target map; nothing deleted — old views mapped into new groups.
**Step 5 — clone per-facility instances:** outpatient module → Dayton/Spark (Kipu location param); census emails per facility + corporate rollup.
**Step 6 — net-new builds:** UR/auth workflow, billing/RCM integration (QBO in-app), unified compliance center, document center w/ versioning/e-sign, analytics center (ship the branch HCOS analytics as its start).

**High-risk files (touch with tests):** `src/kipu.js` (sync correctness), `server.js` census/discharge counting helpers, `src/db.js` migration blocks, `public/app.js` canSeeView/GROUP_OF, `src/housing.js` (don't touch), auth (`src/auth.js`, sessions), sw.js cache versioning discipline.
**Hidden/orphaned features flagged:** `projects`, `raffle_entries`, `revenue_days`, `time_entries`, `warehouse.js`, `standard.js`, `expenses/finance/outcomes/analytics/scorecard` views — exist and likely used, internals not fully reviewed this session; inventory before altering. `admissions` table vs `expected_arrivals` overlap — verify before consolidation.

