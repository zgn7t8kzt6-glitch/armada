# ARMADA BHOS — PLATFORM ARCHITECTURE (v2, canonical)
*The Behavioral Health Operating System blueprint. Supersedes the flat 31-domain map by organizing those same domains into five platform layers, adding Master Data Management, splitting "right now" from "why", and restating every module as a business capability. This is the document all future build decisions reference.*

**What Armada is:** a Behavioral Health Operating System (BHOS) — one platform that happens to contain three products that grew together:
1. A behavioral health EHR/operations platform (census, rounds, discharge, UR, housing).
2. A corporate operating system (entities, insurance, leases, procurement, vendors, finance).
3. A culture & performance operating system (The Standard, recognition, growth, HR/People OS).

The architecture below keeps them one platform while letting each layer evolve at its own speed.

---

# THE FIVE LAYERS

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5 — INTELLIGENCE                                         │
│  Executive AI · Clinical AI · Document AI · Ops AI · Copilots   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 4 — CLINICAL OPERATIONS  (per facility TYPE)             │
│  Detox/Residential kit · Housing kit · PHP/IOP kit              │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — FACILITY OPERATIONS  (per facility, any type)        │
│  Ops Center · beds · staffing · inventory · maintenance ·       │
│  incidents · concierge · meals · transport                      │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — ENTERPRISE OPERATIONS  (corporate, cross-facility)   │
│  Corporate Hub · HR/People OS · Finance/Procurement ·           │
│  Compliance/Risk · Enterprise Analytics                         │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1 — PLATFORM FOUNDATION                                  │
│  Identity & access · Master Data · permissions · audit ·        │
│  files · email · integrations (Kipu/QBO/DocuSign) · events      │
└─────────────────────────────────────────────────────────────────┘
```

**The rule that makes this work:** higher layers depend on lower layers, never sideways at the same layer and never downward-into-specifics. Clinical modules (L4) call facility services (L3), which read enterprise config (L2), which stands on foundation objects (L1). Intelligence (L5) reads everything and writes nothing except insights.

---

## LAYER 1 — PLATFORM FOUNDATION

*What every other layer assumes exists. Most of it already does.*

| Capability | Today | Gap |
|---|---|---|
| Identity & authentication | users, sessions, MFA/TOTP, login throttle | SSO later; password policy per role |
| Facility & org registry | **org_facilities** (9 rows: 6 facilities + 3 holdings), org_departments, regions | region rollup views |
| Access model | user_facility_access + role_permissions (seeded from the live walls) | **enforcement** — Phase 2, module by module, clinical last |
| Master Data Management | *(new domain — see below)* | canonical payor/provider/referral-source tables |
| Files & documents | corp_files (BLOBs), facility_docs, hr_documents | one file service with retention classes |
| Email service | census email, reminders, landlord + confirmation replies | one outbox table w/ retry + log (today: fire-and-log) |
| Integration gateway | Kipu (HMAC, per-location), M365 inbound webhook | QuickBooks (approved), DocuSign (approved), Spark Kipu (credentials pending) |
| Audit & telemetry | audit log on auth/admin actions | extend to clinical writes when permissions land |
| Event backbone | implicit (workflows call each other) | *(see Capability & Event Model — make events explicit as a table before any queue tech)* |

### NEW — Master Data Management (domain #32)
The one domain the 31-domain map missed. Every layer keeps re-inventing "who/what is this?" — MDM makes each of these an owned, canonical object with one table, one editor, one ID that everything else references:

| Master object | Where it lives today | MDM disposition |
|---|---|---|
| Organization / holdings | org_facilities (type='holding') | ✓ done |
| Facility | org_facilities + entity_aliases | ✓ done — the pattern to copy |
| Department | org_departments | ✓ done |
| Program (Detox, RES, PHP, IOP, OP, ORH) | strings scattered in Kipu fields + housing levels | new `org_programs` table, per-facility |
| Employee | hr_employees (canonical since roster import) | ✓ — link users.employee_id (today matched by email/name) |
| Patient | clients (detox) + Kipu casefiles + residents (housing) | keep per-system, add cross-ref table (same human across detox→housing) |
| Referral source | `facilities` table (misnamed!) + referral strings | rename→referral_partners (careful: Salesforce sync) |
| Insurance company / payor | payer strings in outpatient + insurance_policies.carrier | new `payors` table; map strings→IDs |
| Vendor | vendors ✓ | add QBO vendor ID column when QBO lands |
| Provider / physician | strings in Kipu data | new table only when UR/auth module needs it |
| Contact / landlord | leases.landlord_email etc. | promote to `contacts` when a second consumer appears |
| Location/address | free text on entities/leases | leave as text — no consumer needs structure yet |

**Build order:** payors → programs → referral_partners rename → patient cross-ref. Each one only when its consuming feature ships (no speculative tables).

---

## LAYER 2 — ENTERPRISE OPERATIONS

*Runs the company across all facilities. All of this exists; the layer assignment just makes ownership explicit.*

- **Corporate Hub** (Chava's world): procurement queue + email-in ordering, projects, vendors, payment methods, business insurance (matrix + renewal engine), leases (AI Q&A + landlord routing), entity vault, corporate documents.
- **HR / People OS (HCOS)**: roster w/ comp, onboarding→reviews→coaching→relations→leave→offboarding, certifications w/ expiry engine, policies & acks, requisitions, pulse, self-service (backend live, UI pending).
- **Finance**: procurement today; QuickBooks in-app (approved) brings P&L, payroll sync, invoice/AP.
- **Compliance & Risk**: business insurance, cert compliance, doc-gap discharge flags; grows into licensure/audit binder.
- **Enterprise Analytics** — *(split, below)*.

### The split: Executive Command Center vs Enterprise Analytics
Two different questions, two different products, previously blurred:

| | **Executive Command Center** | **Enterprise Analytics** |
|---|---|---|
| Question | "What's happening **right now**?" | "**Why** did it happen? What's the trend?" |
| Time horizon | this minute → this week | weeks → years |
| Data | live counts from operational tables | daily_metrics, revenue_days, HR analytics, outcomes history |
| Consumers | owner + leadership, many times a day | owner + leadership, weekly/monthly cadence |
| Failure mode if wrong | someone misses a fire | someone draws a bad conclusion |
| Today's screens | **Operations Center (shipped)**, Corporate Command Center, census email | outcomes, scorecard, HR analytics, retention insights |

Rule of thumb for every future tile/report: if it changes within the day, it belongs to Command; if it needs history to mean anything, it belongs to Analytics. Never mix them on one screen.

---

## LAYER 3 — FACILITY OPERATIONS

*The layer every facility gets regardless of what kind of care it delivers.* Beds & rooms, staffing & scheduling, inventory & ordering (feeding the L2 procurement queue), maintenance, incidents, concierge/requests, meals, transport, arrival logistics.

**Homepage of this layer = the Operations Center (SHIPPED this build):**
- `GET /api/opscenter` — a tile feed, one tile per live queue, three groups:
  - **Right now:** census, beds available, admissions today, expected arrivals, pending discharges, open incidents
  - **Work queues:** orders to place, maintenance open, concierge open, HR tasks due, projects in motion, doc-gap discharges (7d)
  - **People & compliance:** reviews overdue, certs ≤30d, leave requests, open HR cases, hiring pipeline, insurance renewing ≤60d
- Every tile is `{count, drill target}` — tapping lands on the exact page **and tab** that holds the work. No hunting through menus.
- Tiles compute independently and skip themselves on error — one bad query never blanks the board.
- Access: admin, ED, DoO, Clinical Director, HR, Executive Assistant (Chava's flat menu includes it).
- **Next iterations:** facility filter (the spine exists — org_facilities + facility_id columns), per-role tile sets (a nurse's ops center ≠ the owner's), staffing-gap tile (needs shift-vs-standard math), auth-renewal tile (needs the UR register).

---

## LAYER 4 — CLINICAL OPERATIONS (per facility type)

*Facility TYPE determines which kit is active — this is configuration, not code forks. org_facilities.type already carries it.*

| Facility type | Kit (modules that light up) | Today |
|---|---|---|
| **Detox / Residential** (Armada Detox Akron) | rounds & vitals watch, care cards, arrival checklist, dignity, discharge & AMA-risk, retention/debriefs, family, case mgmt, compliance docs | ✓ live — the most mature kit |
| **Recovery Housing** (Akron House, Wheatfield) | houses/beds, resident intake & screens, house life, rent run & ledger, ORH compliance, employment, movement | ✓ live (Hilltop suite) |
| **PHP/IOP Outpatient** (Akron OP; Dayton, Spark to clone) | census by program level, group attendance, PHP completion, UR/auth watch, discharge debriefs | ✓ live for Akron via Kipu; clones = config + credentials, not new code |
| **Spark facilities** | same kits, Spark Kipu instance | blocked on credentials (owner action) |

The clone rule: standing up Dayton outpatient must be *"add a row to org_facilities + point at the Kipu location"* — anything more means the kit leaked facility-specific assumptions and we fix the kit, not fork it.

---

## LAYER 5 — INTELLIGENCE

*Reads everything, writes only insights. Every AI feature is an overlay on a lower layer, never a load-bearing wall.*

| Copilot | Serves layer | Today |
|---|---|---|
| Document AI | L1/L2 — insurance, lease, order-email extraction | ✓ live (upload→extract→review→save; email→line items) |
| Lease counsel | L2 — "is this the landlord's responsibility?" | ✓ live (file-first Q&A) |
| HR copilot | L2 — Ask AI over the people data | ✓ live |
| Clinical AI | L4 — discharge debriefs (all-notes read, evidence-grounded), AMA triggers, care briefs, shift briefings | ✓ live |
| Executive AI | L2/L5 — "ask the business anything" over metrics + analytics | partial (askAssistant); grows with Analytics |
| Ops AI | L3 — anomaly flags on the Ops Center (census swings, queue pileups) | future — needs a few months of tile history |

PHI rule stands: scrub before any model call; Kipu remains the EMR of record; AI output is always labeled as draft/insight, never silently written into a record.

---

# THE CAPABILITY & EVENT MODEL

*Stop thinking in pages; think in capabilities. Each capability declares an owner (accountable human), users, the data it owns (only IT writes those tables), and the events it publishes/consumes. New feature requests get slotted into a capability first — if none fits, that's the signal a new capability (not a new page) is being born.*

Format: **Capability — owner / users / owns / publishes → / consumes ←**

**L1 Identity & Access** — owner: you / users: all / owns: users, sessions, role_permissions, user_facility_access / publishes → `user.created`, `role.changed` / consumes ← `employee.hired`, `employee.terminated` (auto-provision & deactivate — the #1 payoff of wiring events).

**L1 Master Data** — owner: you (delegating to Chava for vendors/entities) / users: all modules / owns: org_facilities, org_departments, org_programs*, payors*, referral_partners* / publishes → `facility.updated` / consumes ← nothing (it's the root).

**L2 Procurement** — owner: Chava / users: office managers (email-in), leadership / owns: order_requests, order_intake_routes, vendors, payment_methods / publishes → `order.requested`, `order.placed`, `order.received` / consumes ← `inventory.par_breached` (auto-reorder), `email.order_received` (AI parse), `lease.responsibility_matched` (landlord email).

**L2 Insurance & Leases** — owner: Chava / owns: insurance_policies, insurance_brokers, leases, lease_questions / publishes → `policy.expiring(90/60/30/14/7/1)`, `lease.term_ending` / consumes ← `entity.created`.

**L2 Entity Vault** — owner: you + Chava (two-person access wall) / owns: entity_records, entity_bank_accounts, entity_cards, portals / publishes → `entity.created` / consumes ← xlsx upload. *Standing rule: this data never touches the repo; import flows straight to DB.*

**L2 People OS** — owner: HR (you today) / owns: hr_employees + 12 hr_* tables / publishes → `employee.hired`, `employee.terminated`, `cert.expiring`, `review.due`, `case.opened` / consumes ← `candidate.hired` (auto-start onboarding — approved, pending build).

**L3 Facility Ops** — owner: DoO per facility / owns: beds, shifts, inventory_items, maintenance, requests, incidents, expected_arrivals / publishes → `bed.freed`, `incident.reported`, `inventory.par_breached`, `arrival.expected` / consumes ← `discharge.recorded` (room flip), `admission.created` (bed assign).

**L4 Clinical kits** — owner: Clinical Director per facility / owns: clients, care cards, rounds, discharge records (detox); residents/ledger (housing); Kipu-derived views (outpatient) / publishes → `admission.created`, `discharge.recorded`, `ama.risk_flagged`, `auth.expiring`* / consumes ← `arrival.expected`.

**L5 Intelligence** — owner: you / owns: insights & debrief text only / consumes ← everything / publishes → `insight.flagged`.

*\* = table/event doesn't exist yet; listed because a consumer is already planned.*

**Event catalog v1 (all already happen implicitly — this names them):** `admission.created`, `discharge.recorded`, `bed.freed`, `arrival.expected`, `incident.reported`, `inventory.par_breached`, `order.requested/placed/received`, `email.order_received`, `policy.expiring`, `lease.term_ending`, `cert.expiring`, `review.due`, `employee.hired/terminated`, `candidate.hired`, `case.opened`, `ama.risk_flagged`.

**Implementation stance:** no message queue, no microservices. One `org_events` table (id, event, entity, facility_id, payload JSON, at) written at the moments above. That alone buys: the Ops Center gets a live activity feed, the auto-provision/deactivate wiring, and an audit trail — at SQLite cost. Queue tech only if a real consumer ever needs push.

---

# WHAT THIS CHANGES ABOUT THE BUILD PLAN

The 5-phase plan from the Master App Map survives intact; this blueprint re-labels and re-orders *within* it:

1. **Done this build:** Operations Center v1 (L3 homepage, shipped).
2. **Next (Phase 2, unchanged):** permission enforcement from role_permissions — corporate modules first, clinical last.
3. **Then, in capability order:** `org_events` table + auto-provision wiring → payors table (unblocks payer analytics) → HCOS P2-4 UI (backend already deployed) → QuickBooks gateway (L1 integration, approved) → UR/Auth register (unblocks the auth-renewal tile + billing readiness) → Ops Center facility filter + per-role tiles → DocuSign → Dayton/Spark clones when credentials arrive.
4. **Standing rules (unchanged):** Kipu is the EMR of record · no PHI in the repo · vault data never in git · no renames/deletes without the collision checklist (the `facilities`→referral_partners rename is the live example).
