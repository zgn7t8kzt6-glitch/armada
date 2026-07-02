# ARMADA — DOMAIN ARCHITECTURE MAP
*The business architecture: every operating domain inside Armada, independent of how the code happens to be organized. Fields per domain: Purpose · Tables · Routes · Views/Components · Dependencies · Workflows · Corporate/Facility · Clinical/Administrative · Standalone-capable? · Parent module (in the 18-module BHOS map).*

**Legend:** C/F = Corporate or Facility level · CL/AD = Clinical or Administrative · SA = could stand alone as its own module/product

---

## TIER 1 — GOVERNANCE & MONEY

### 1. Executive
- **Purpose:** Owner's cross-facility view — census, movement, people, money; the decision cockpit.
- **Tables:** org_facilities, daily_metrics, revenue_days, app_state(facilities_config)
- **Routes:** /api/ownership, /api/org/facilities, /api/command/overview (facility-level feed)
- **Views:** ownership (Corporate Command Center), command, scorecard, outcomes
- **Depends on:** Detox, Outpatient, Housing, HR, Finance domains (it aggregates everything)
- **Workflows:** daily census email, weekly care report, admissions/discharge counting (realDischargeCount)
- **C/F:** Corporate · **CL/AD:** Administrative · **SA:** No — it's the aggregation layer by definition
- **Parent:** Corporate Command Center

### 2. Finance
- **Purpose:** Money out (procurement, vendors, payments) and money context (revenue days, expenses); P&L to come via QuickBooks.
- **Tables:** order_requests, order_intake_routes, reorder_requests, vendors, payment_methods, corp_tasks(spend-adjacent), revenue_days, entity_bank_accounts, hr_comp_history
- **Routes:** /api/corp/orders*, /api/corp/vendors*, /api/corp/payments*, /api/inbound/order, /api/corp/intake*, finance/expenses endpoints
- **Views:** corphub (Orders/Vendors/Accounts tabs), finance, expenses
- **Depends on:** Inventory (auto-reorders feed orders), Leases (landlord routing), Email, AI (order parsing), QuickBooks (approved, to build)
- **Workflows:** par-breach→reorder→corporate queue; email-in ordering→AI parse→queue→confirmation; landlord auto-email; Pollak weekly order
- **C/F:** Corporate (with per-facility tagging ✓) · **AD** · **SA:** Yes — procurement alone is product-shaped
- **Parent:** Finance (procurement, vendors, payments) + Billing/RCM (future revenue side)

### 3. Billing / Revenue Cycle
- **Purpose:** (Mostly future) claims-readiness, auth-linked billing, denials, aging. Today only readiness signals exist.
- **Tables:** revenue_days; discharge doc-gap flags on clients; (future: authorizations, claims, payments)
- **Routes:** none dedicated; doc-readiness surfaces in census email + compliance
- **Views:** none dedicated
- **Depends on:** UR/Authorizations, Kipu (biller of record), QuickBooks, Documents
- **Workflows:** doc-gap nudge in census email (a proto billing-readiness check)
- **C/F:** Corporate w/ facility drill · **AD** · **SA:** Yes (planned)
- **Parent:** Billing/RCM — Phase 4 build #5

### 4. Corporate Records (Entities, Insurance, Leases)
- **Purpose:** The legal/financial spine of the company: entity vault (EIN/NPI/bank/cards/logins), business insurance with coverage matrix + renewal watch, leases with AI Q&A + landlord responsibilities.
- **Tables:** entity_records, entity_bank_accounts, entity_cards, portals, insurance_policies, insurance_brokers, leases, lease_questions, facility_docs, corp_files
- **Routes:** /api/corp/entities*, /api/corp/insurance*, /api/corp/leases*, /api/corp/docs*, /api/corp/files/*
- **Views:** corphub (Entities/Insurance/Leases/Documents tabs)
- **Depends on:** AI (doc extraction, lease Q&A), Email (reminders), xlsx importer
- **Workflows:** insurance renewal thresholds; lease term-end flags; upload→AI-extract→review→save
- **C/F:** Corporate · **AD** · **SA:** Yes — insurance/lease management is a standalone product pattern
- **Parent:** Compliance/Risk (insurance) + Finance (leases) + Admin (vault)

---

## TIER 2 — PEOPLE

### 5. HR (Human Capital)
- **Purpose:** Full employee lifecycle: roster w/ comp, onboarding→reviews→coaching→discipline→leave→offboarding, certifications, policies, pulse, analytics, AI copilot.
- **Tables:** hr_employees + 12 hr_* tables, employee_profiles, employee_notes
- **Routes:** /api/hr/employees*, /api/hcos/*, /api/myhr*
- **Views:** hcos (7 tabs), ownership→Employees, myhr (self-service; UI pending)
- **Depends on:** Hiring (feeds it), Training, Email (cert watch), AI (copilot), QuickBooks (payroll sync approved)
- **Workflows:** start-onboarding→checklist+review cadence; cert expiry watch; progressive discipline; leave approvals
- **C/F:** Corporate w/ entity dimension ✓ · **AD** · **SA:** Yes — explicitly built as an HCOS
- **Parent:** HR

### 6. Hiring / Talent Acquisition
- **Purpose:** Candidate pipeline (Applied→Hired) with role profiles, structured interviews, scorecards, self-signup invites; requisitions (backend live, UI pending).
- **Tables:** candidates, role_profiles, hr_requisitions
- **Routes:** /api/hiring/*, /api/hcos/reqs*
- **Views:** hiring
- **Depends on:** HR (hired→employee), Email (invites), roles system
- **Workflows:** stage advancement; hire→invite; (planned: hire→auto-onboarding trigger)
- **C/F:** Corporate w/ side (detox/hilltop)→facility_id migration · **AD** · **SA:** Yes (ATS-shaped)
- **Parent:** HR → Recruiting

### 7. Training & Learning
- **Purpose:** Courses w/ questions/completions, library, the Standard (service playbook), policy docs w/ read-tracking, 90-day Belonging curriculum.
- **Tables:** courses, course_questions, course_completions, docs, doc_reads, training_ack, plan_progress, onboardings, onboarding_progress, completions
- **Routes:** training/library/standard/plan endpoints
- **Views:** training, library, standard, plan, excellence, onboarding
- **Depends on:** HR (who), Compliance (acknowledgements)
- **Workflows:** course→quiz→completion; belonging-plan day-based tasks; 21-day check-ins
- **C/F:** Corporate content, facility delivery · **AD** · **SA:** Yes (LMS-shaped)
- **Parent:** HR → Learning (+ Compliance for acks)

### 8. Culture & Recognition
- **Purpose:** The Schulze engine: daily lineup (auto shout-outs, client compliments), kudos, extra mile, raffle, saves/CEO rescues, staff pulses/voice, growth plans, Leadership Mirror, My Stats.
- **Tables:** kudos, extra_mile, raffle_entries, saves, ceo_rescues, lineup_log, staff_pulses, staff_voice, belonging_pulses, growth_plans, growth_checkins, goals, focus_logs, hr_pulse
- **Routes:** lineup/kudos/extramile/growth/leadmirror/mystats endpoints
- **Views:** lineup, team, workplace, accountability, mygrowth, mystats, leadmirror, myrole
- **Depends on:** AI (lineup composition, compliment extraction), Email, HR
- **Workflows:** auto-lineup at ET hour; recognition nudges; morale watch; weekly fastest-responder
- **C/F:** Facility rituals + corporate visibility · **AD** · **SA:** No — it's the connective tissue; keep woven in
- **Parent:** HR → Culture & Engagement (cross-cutting)

### 9. Scheduling & Workforce
- **Purpose:** Staff schedules, shift templates, coverage rules, assignments, week grid, staffing model, time entries, on-shift tracking.
- **Tables:** shifts(+facility_id ✓), shift_templates, shift_staffing, schedule_slots/items/assignments, assignments, staffing_standard, time_entries, manual_on_shift, duty_logs
- **Routes:** schedule/coverage/assign/roster endpoints
- **Views:** schedule, coverage, weekgrid, assign, staffmodel, roster
- **Depends on:** HR roster, Facility ops (coverage alerts), Lineup (staffing surfaces)
- **Workflows:** coverage-gap alerts; shift task lists per role
- **C/F:** Facility · **AD** · **SA:** Yes
- **Parent:** Scheduling

---

## TIER 3 — CARE DELIVERY (FACILITY, CLINICAL)

### 10. Detox / Residential Operations (flagship facility domain)
- **Purpose:** Everything running Armada Detox of Akron day-to-day around the patient.
- **Sub-domains below (11–17) all currently serve this facility;** facility_id now on clients ✓
- **C/F:** Facility · **CL** · **Parent:** Facility Operations + Clinical Operations

### 11. Admissions & Arrival (detox)
- **Tables:** expected_arrivals(+facility_id ✓), admissions(+facility_id ✓), arrival_checks, arrival_items, inbound_referrals
- **Routes:** /api/arrivals*, /api/admissions*, /api/arrivalcheck*
- **Views:** arrivals, arrivalcheck, admissions, admitcheck
- **Depends on:** Salesforce (expected arrivals), Kipu (reconcile), BD (referrals)
- **Workflows:** SF sync→arrival board→checklist→admit; no-show flagging at cutoff
- **C/F:** Facility · **AD/CL border** · **SA:** Yes · **Parent:** Admissions

### 12. Nursing & Medical
- **Tables:** vitals, withdrawal_scores, meds, med_admin, comfort_meds, medical_sendouts, obs_checks
- **Routes:** records/vitals/meds endpoints + Kipu chart reads
- **Views:** records, parts of journey/dashboard
- **Depends on:** Kipu (MAR/chart of record), AI (withdrawal signals in care briefs)
- **Workflows:** med administration logging; sendout tracking; CIWA/COWS via Kipu
- **C/F:** Facility · **CL** · **SA:** No — inseparable from EMR · **Parent:** Clinical Operations

### 13. BHT / Direct Care
- **Tables:** rounds, round_scans, scan_points, shift_tasks, shift_task_done, tasks, engagement-adjacent (delights, wows)
- **Routes:** /api/rounds*, /api/roundscan*, shift task endpoints
- **Views:** rounds, roundscan, dashboard (BHT flat menu), engagement, program
- **Depends on:** Scheduling, Culture (recognition), Alerts
- **Workflows:** QR scan-proof rounds→coverage alerts→escalation (SMS); hourly cycles
- **C/F:** Facility · **CL** · **SA:** No · **Parent:** Clinical Operations → Rounds/Safety

### 14. Case Management (patient)
- **Tables:** case_tasks, family_contacts, family_updates, visits, property_items/events (belongings, dual-control), followups
- **Routes:** /api/case-management*, family/property endpoints
- **Views:** casemgmt, family, property, continuum
- **Depends on:** Kipu notes (AI-extracted needs), Clinical, Discharge
- **Workflows:** AI case-needs extraction; family update cadence; belongings chain-of-custody
- **C/F:** Facility · **CL** · **SA:** Yes-ish · **Parent:** Case Management

### 15. Retention & Clinical Quality
- **Tables:** ama_reads, ama_defects, saves, ceo_rescues, client_experience, client_checkins, concerns, alerts, behavior_contracts/_notes/_checkins
- **Routes:** /api/assess-all*, /api/debrief-discharges*, retention endpoints
- **Views:** retention, clientvoice, surveys
- **Depends on:** AI (risk reads, debriefs — evidence-grounded), Kipu notes
- **Workflows:** assess-all risk sweep; AMA debrief→learnings; behavior contracts; surveys→alerts
- **C/F:** Facility w/ corporate quality rollup · **CL** · **SA:** Yes — this is a Clinical Quality product
- **Parent:** Clinical Operations → Quality (+ Corporate Clinical Quality Dashboard)

### 16. Discharge & Continuum
- **Tables:** clients discharge fields (+evidence/doc-gap), alumni_notes, outbound_referrals, flow_events
- **Routes:** dischargepage/continuum/alumni endpoints
- **Views:** dischargepage, continuum, alumni
- **Depends on:** AI (aftercare plans, debriefs), BD (outbound), Census
- **Workflows:** discharge checklist; LOS calc; referred-out classification; aftercare AI plan
- **C/F:** Facility · **CL** · **SA:** No · **Parent:** Clinical Operations + Case Management

### 17. Census & Beds (detox)
- **Tables:** beds, bed_turnovers, clients(active/loc), daily_metrics
- **Routes:** bedboard/bedmap endpoints, census email builder
- **Views:** bedboard, bedmap
- **Depends on:** Kipu sync (census truth), Housekeeping (turnovers)
- **Workflows:** turnover alerts >8h; census email; occupancy tiles
- **C/F:** Facility · **CL/AD border** · **SA:** Yes · **Parent:** Census/Bed Management

---

## TIER 4 — OTHER FACILITY TYPES

### 18. Housing (Hilltop/Reverie — sober living)
- **Purpose:** Complete recovery-residence operating system (the wall prototype).
- **Tables:** all 50 housing_* tables
- **Routes:** 123 routes in src/housing.js
- **Views:** 24 housing views
- **Depends on:** almost nothing outside itself (by design) + Email
- **Workflows:** intake→screens→curfew→chores→rent ledger→farewell; vehicles; ORH/NARR; own lineup/surveys
- **C/F:** Facility (×3 potential instances) · **CL/AD mixed** · **SA:** Already effectively standalone
- **Parent:** Facility Operations (instances) — DO NOT REFACTOR

### 19. Outpatient (PHP/IOP — Akron House, Dayton, Spark, Wheatfield)
- **Purpose:** Census/analytics for outpatient facilities from Kipu: levels, LOS, movement, payers, group attendance, PHP completion.
- **Tables:** outpatient_clients
- **Routes:** /api/outpatient/*
- **Views:** outpatient
- **Depends on:** Kipu (deep: census, program history, group sessions, UR probes)
- **Workflows:** daily auto-refresh; PHP→IOP detection; quick movers; completion analysis
- **C/F:** Facility (template to clone per outpatient facility) · **CL/AD border** · **SA:** Yes
- **Parent:** Facility Operations + Census + (feeds UR)

### 20. Utilization Review (emerging)
- **Purpose:** Authorization tracking (auth #, LOC, periods, next review) — data proven via Kipu probes; workflow to build.
- **Tables:** (future: authorizations, denials) — data currently read live from Kipu
- **Routes:** /api/outpatient/ur-probe, field-inspect
- **Depends on:** Kipu UR endpoints, reminder engine, org_tasks (future)
- **C/F:** Facility w/ corporate dashboard · **CL/AD border** · **SA:** Yes (planned)
- **Parent:** UR/Authorizations — Phase 4 build #2

---

## TIER 5 — SUPPORT & SHARED SERVICES

### 21. Inventory & Supply
- **Tables:** inventory_items(+facility_id ✓), inventory_counts, reorder_requests
- **Routes:** /api/inventory/*
- **Views:** inventory — **Depends:** Finance/orders, Email (Pollak) — **Workflows:** par→reorder→email→corporate queue; weekly Pollak order; critical-out alerts
- **C/F:** Facility → corporate procurement · **AD** · **SA:** Yes · **Parent:** Facility Ops → Finance/Procurement

### 22. Maintenance & Environment
- **Tables:** maintenance_requests(+facility ✓), maintenance_photos, environment_checks
- **Routes:** /api/maintenance/* — **Views:** maintenance — **Depends:** Vendors, Leases (landlord routing), Email
- **Workflows:** work order→vendor email; aging escalation; landlord-responsibility auto-email
- **C/F:** Facility · **AD** · **SA:** Yes · **Parent:** Facility Operations

### 23. Food Service
- **Tables:** meal_menu, meal_checks, meal_feedback, snack_checks — **Views:** meals — kitchen brief email, Pollak food flow (separate from corporate supplies by design ✓)
- **C/F:** Facility · **AD** · **SA:** No · **Parent:** Facility Operations

### 24. Patient Services (Concierge & Dignity)
- **Tables:** requests, dignity_kits, laundry_loads, activities — **Views:** concierge, dignity, laundry, activities
- **Workflows:** request routing by department; fastest-responder recognition
- **C/F:** Facility · **CL/AD border** · **SA:** No · **Parent:** Facility Operations

### 25. Incidents, Compliance & Risk
- **Tables:** incidents(+facility_id ✓), audit_log, survey_* (grievance-adjacent), housing_incidents/grievances, hr certifications (staff), insurance (corporate)
- **Views:** incidents, compliance, audit, hincidents
- **Workflows:** doc-compliance checks (chart completeness, dischargeMissing), audit trail, cert/insurance watches
- **C/F:** Both · **AD w/ CL inputs** · **SA:** Yes · **Parent:** Compliance/Risk (unified center = Phase 4 #6)

### 26. Business Development & Referrals
- **Tables:** facilities(=referral partners; rename planned), inbound_referrals, outbound_referrals, alumni_notes
- **Routes:** /api/referrals*, /api/salesforce/* — **Views:** referrals, partners
- **Depends on:** Salesforce, AI (referral insights) — **Workflows:** SF inbound sync; reciprocity analytics
- **C/F:** Corporate w/ facility attribution · **AD** · **SA:** Yes (CRM-shaped) · **Parent:** Business Development

### 27. Communication
- **Tables:** messages, message_reads, alerts, followups, handoffs, ops_handoffs, shift_reports
- **Views:** messages + embedded panels — **Depends:** Email/SMS/push(PWA)
- **Workflows:** shift handoffs; on-call alerts; announcement blasts (suppressCc pattern)
- **C/F:** Facility-scoped w/ corporate blasts · **AD** · **SA:** No · **Parent:** Tasks/Notifications + Communication Center

### 28. Documents & Files
- **Tables:** corp_files, facility_docs, hr_documents/acks, docs/doc_reads, maintenance_photos, leases/insurance doc links
- **Workflows:** upload→AI extraction; acknowledgements; renewal alerts — DocuSign approved (to build)
- **C/F:** Both · **AD** · **SA:** Yes · **Parent:** Documents (unified center = Phase 4 #7)

### 29. AI Services (cross-cutting)
- **Purpose:** One AI layer many domains call.
- **Surface:** care briefs, AMA reads, discharge debriefs, aftercare plans, lineup composer, kudos extraction, case-needs, referral insights, outcome insights, lease Q&A, insurance/lease doc extraction, order-email parsing, HR copilot, askai, issue digests, welcome plans
- **Code:** src/claude.js (Anthropic/Bedrock), PHI scrub, JSON-schema outputs
- **C/F:** Platform · **SA:** It IS the platform layer · **Parent:** cross-cutting service (governed under Admin)

### 30. Reports & Analytics
- **Tables:** daily_metrics, survey_*, plus every domain's data — **Views:** report/report-view, analytics, outcomes, scorecard, housingoutcomes — **Workflows:** weekly report, census emails, HCOS analytics (backend live)
- **C/F:** Both · **AD** · **SA:** Yes · **Parent:** Reports/Analytics (cross-facility center = Phase 4 #8)

### 31. Identity, Settings & Platform
- **Tables:** users, sessions, org_facilities/departments, user_facility_access, role_permissions, app_state, audit_log, order_intake_routes
- **Views:** settings, users, audit, staffsignins — **Workflows:** invites, MFA, kiosk, preview-as-role, cache/version discipline
- **C/F:** Platform · **AD** · **SA:** No · **Parent:** Admin Settings

---

## DOMAIN → PARENT MODULE ROLLUP (quick reference)
| BHOS Module | Domains it owns |
|---|---|
| Corporate Command Center | Executive |
| Facility Operations | Detox ops shell, Housing, Outpatient shells, Maintenance, Food, Patient Services, Inventory(front) |
| Admissions | Admissions & Arrival |
| Census/Beds | Census & Beds (+outpatient census) |
| Clinical Operations | Nursing/Medical, BHT/Rounds, Retention & Quality, Discharge |
| Case Management | Case Management |
| Peer Support | (thin; carved from Engagement + Housing coaching + Alumni) |
| UR/Auth | Utilization Review |
| Billing/RCM | Billing/Revenue Cycle |
| HR | HR, Hiring, Training, Culture(shared) |
| Finance | Finance/Procurement, Corporate Records(leases), QuickBooks |
| Business Development | BD & Referrals |
| Compliance/Risk | Incidents/Compliance/Risk, Insurance(corporate records) |
| Scheduling | Scheduling & Workforce |
| Documents | Documents & Files |
| Tasks/Notifications | Communication, org_tasks engine |
| Reports/Analytics | Reports & Analytics |
| Admin Settings | Identity/Settings/Platform, AI governance |
