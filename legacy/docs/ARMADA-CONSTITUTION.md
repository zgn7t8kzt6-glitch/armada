# THE ARMADA OS CONSTITUTION
*Version 1.1 — amended per CTO review (Platform Contract, capability ownership, integration, measurability, memory-load, Operational Intelligence, and the Review).*

*The non-negotiable law of the platform. The audit says what exists; the domain and platform architectures say how it's organized; the design system says how it looks. This document says how Armada is **allowed to evolve**. Every feature, every PR, every "quick fix" answers to it. It describes no features — it constrains all of them.*

**How to use it:** each principle ends with **The Test** — the question asked in review. If the answer is no, the work doesn't ship until it is. Where a principle was learned the hard way in our own history, the receipt is cited, because a constitution grounded in scar tissue outlives one written in the abstract.

---

## Article I — The Platform

### Principle 1 · One Platform
There is only one Armada. Detox, Residential, Recovery Housing, PHP, IOP, OP, MAT, and every future service line are **configurations of the same platform** — never separate applications.

*In practice:* `org_facilities.type` already decides which clinical kit lights up. Standing up Dayton outpatient must be "add a row + point at the Kipu location." The day a clone requires copied code, the kit has leaked a facility-specific assumption — fix the kit, not the copy.

**The Test:** *Could a seventh facility of any existing type go live with configuration alone?*

### Principle 2 · Configure, Don't Fork
Never duplicate code because two facilities work differently. Differences come from exactly five levers: **facility type · program · feature flags · configuration · permissions.** A sixth lever doesn't exist.

*In practice:* the outpatient "right away" threshold is a configurable 3 days, not a hardcoded rule; landlord categories are per-lease data, not per-facility code; the census email recipients are settings. That is the pattern. The anti-pattern is a second `renderCorpOrdersDayton()`.

**The Test:** *If this diff copies a function and edits three lines, what config lever should have absorbed the difference?*

### Principle 3 · Every Record Has an Owner
Every object belongs to an **organization → region (optional) → facility → department → program → user** chain. Ownership is never ambiguous, because ambiguous ownership becomes ambiguous accountability, which in healthcare becomes a finding.

*In practice:* the `facility_id` spine exists and is backfilled; new tables get a facility_id (or an explicit reason they're corporate-scope) on day one, not in a migration later. Every task carries owner, due date, priority, status, and related record — a task missing any of these cannot be created.

**The Test:** *For every new table: who owns a row, and which facility does it belong to? If either answer is "it depends," stop.*

### Principle 4 · One Source of Truth
Exactly one canonical record exists for each master object — patient, employee, facility, program, payor, referral source, vendor, insurance policy, entity. Everything else holds a reference, never a copy. And every canonical record names its **system of record** — some live outside Armada, and that's fine as long as it's explicit: Kipu is the EMR of record; QuickBooks will be the ledger of record; Armada is the record of operations.

*In practice:* `org_facilities` with entity aliases is the model — one row, many names resolve to it. Payer strings, program strings, and the misnamed `facilities` table (really referral sources) are today's open violations; the MDM build order in the platform architecture retires them one consuming feature at a time.

**The Test:** *Does this feature store a name where it should store an ID? Is there now a second place this fact can be edited?*

---

## Article II — The Platform Contract
*How modules are allowed to talk to each other. Armada is deliberately one codebase on one database — the contract binds **ownership discipline**, not deployment topology. These rules cost nothing to follow in a monolith and are what make the monolith survivable at 100 facilities.*

**The four clauses:**
1. **Every module owns its own business logic.** Admission logic lives in Admissions and nowhere else. If a second module needs the rule, it calls the owner's function — it never re-implements the rule.
2. **Only the owning module writes its tables.** Other modules may read, but through the owner's named query/helper (`orgFacilities()`, `facilityForEntity()`, `policyStatus()` are the existing pattern) — never ad-hoc SQL against someone else's schema. When a service function exists, raw table access from outside is a violation.
3. **Shared data lives in Master Data Management.** If two modules both need it, neither owns it — MDM does (Article I, Principle 4).
4. **Events connect modules; direct calls couple them.** When module A must react to module B, B publishes an event and A subscribes — B never reaches into A to "help."

*The cascade that proves it:*
```
Admission Created
  → Clinical notified (care card opens)
  → Bed Board updated (bed assigned)
  → Billing notified (readiness clock starts)
  → Authorizations started (UR window opens)
  → HR unaffected (and that's the point)
  → Executive dashboard updated (Ops Center tile ticks)
```
Admissions doesn't know or care who listens. That ignorance is the feature — it's what lets a new subscriber (Peer Support, a state reporting feed) appear without touching admission code.

**The Test:** *Could this module's tables be moved behind an API next year without rewriting its callers? Does anything outside the owner write to its tables?*

### Principle 5 · Every Module Owns a Business Capability
A module is not a collection of pages — it is the sole owner of a capability. Before any module is built or extended, it declares four things, in writing, in the platform architecture's capability registry:

- **What capability does it own?**
- **What data does it own?** (tables only it writes)
- **What events does it publish?**
- **What events does it consume?**

*Worked example — Admissions:* owns lead, referral, admission. Publishes `admission.created`, `admission.cancelled`. Consumes `insurance.verified`, `bed.assigned`. **Nothing else may own admission logic.** A discharge-side feature that needs "was this a readmission?" asks Admissions; it doesn't grow its own opinion.

**The Test:** *Can this feature's PR description name its capability, in one sentence, matching the registry? If the registry has no row for it, is this actually a new capability being born (a product decision), or logic leaking into the wrong module?*

### Principle 6 · Everything Integrates
Every capability is designed assuming it will one day exchange data with another system — even if that integration doesn't exist yet. Retrofitting integrability is 10× the cost of designing it in. Concretely:

- **Stable IDs** — every record has an immutable internal ID; external systems get mapped to it (the Kipu composite-ID lesson: `intId:uuid`, because Kipu itself needed two).
- **Versioned interfaces** — when an API shape must change, add, don't mutate; retire on a schedule.
- **Idempotent operations** — replaying a webhook or retrying a sync must be safe (the inbound-order webhook and gated seeds like `org_foundation_v1` are the house pattern: run twice, apply once).
- **Audit logging** — every integration write says who/what/when.
- **Clear ownership** — every integration has one owning module and one named system of record for each field that syncs.

*In practice:* Kipu, M365 inbound mail, and the approved QuickBooks/DocuSign builds all pass through the integration gateway at Layer 1 — no module talks to the outside world privately.

**The Test:** *If a partner asked for this data tomorrow, is there a stable ID to key on and a safe way to replay a failed sync?*

---

## Article III — The Work

### Principle 7 · Work Comes to People
Users never browse menus looking for work. The platform surfaces **what needs attention, why it matters, when it's due, and what happens if it's ignored** — and brings it to the person who owns it.

*In practice:* the Operations Center is this principle as a homepage; the census email's doc-gap nudge is this principle as a notification; the insurance 90/60/30/14/7/1 ladder is this principle as a calendar. Every new module owes the Ops Center a tile and the Today inbox its items before it's "done."

**The Test:** *If a user never opened this module's page, would its urgent work still find them?*

### Principle 8 · Every Screen Answers Three Questions
**Where am I? What's happening? What should I do next?** A page that can't answer all three gets redesigned, not shipped.

*In practice:* facility chip, role badge, and date are ambient in the shell (design system §4.2); hierarchy is always critical → active → upcoming → historical; the primary action is singular and gold.

**The Test:** *Show the page to someone who's never seen it for ten seconds. Can they answer all three?*

### Principle 9 · Every Click Has Purpose
No read-only dead ends. Information arrives with its verbs attached — a count you can't tap is decoration; a record you can't act on is a report.

*In practice:* not "Authorization #44322" but "**Authorization expires in 2 days — [Renew] [Assign] [View patient]**." Every Ops Center tile drills to the exact page *and tab*. Every dashboard number is a doorway. Empty states name the next action ("No leases for Dayton yet — Upload the lease").

**The Test:** *From this screen, can the user finish the work it describes — or did we just tell them about it?*

### Principle 10 · Never Make Users Remember
Human memory is not a storage tier. Anything a user would have to remember — a due date, a threshold, a patient's risk level, which step comes next — the platform displays at the moment and place it's needed. Recognition over recall, always.

*In practice:* not "remember to renew the authorization Friday" but a card that reads **Renewal due Friday · patient · insurance · 2 days remaining · [Renew]**. The arrival checklist exists so no tech recites intake steps from memory; the coverage matrix exists so nobody remembers which entity lacks a policy; the shift-flow rhythm on My Shift exists so a new hire's first week doesn't run on notes taped to a monitor.

**The Test:** *Does completing this workflow require the user to have remembered anything from a previous screen, day, or training session? Whatever it is — put it on the screen.*

### Principle 11 · Timelines, Not Tabs
Major records are stories, not filing cabinets. Every canonical record — patient, employee, facility, entity — carries **one unified, chronological activity timeline**: admission, assessment, nursing note, group attendance, UR review, incident, discharge planning; hire, review, coaching, cert, leave. Tabs organize *tools*; the timeline tells *the truth about what happened*.

*In practice:* the employee master record and Client 360 both have proto-timelines — the design system extracts one `.timeline` component; the `org_events` table becomes its spine. No timeline, not a record — it's a row.

**The Test:** *Can a new clinician or manager read this record top-to-bottom and understand the story without opening six tabs?*

---

## Article IV — The Boundaries

### Principle 12 · Intelligence Is a Layer
AI never owns data. It **summarizes, recommends, drafts, predicts, and explains** — and a human approves anything that matters. AI output is labeled as AI output, grounded in evidence, and says *"not documented"* rather than inventing plausibility.

*In practice — the receipt:* the discharge-debrief rewrite. The model was weaving "motivation dip" narratives from intake facts; the fix was constitutional, not cosmetic — every claim now requires documented evidence, and "Not documented in the chart" beats a good guess. That standard now binds every AI feature: extraction goes to a review screen before it saves; the lease bot cites the lease; scrub runs before any model call.

**The Test:** *If the model is wrong, does a human catch it before it becomes a record? Can every AI claim point to its source?*

### Principle 13 · Guard the Vault
Some data never travels: **PHI never enters the repository, model prompts are scrubbed, and credentials (cards, CVVs, portal passwords, bank details) flow only upload → database — never through git, never into a doc, never into a log.** Access to the sensitive tier is named-person, not role-broad. Destructive and sensitive actions demand confirmation, permission, and an audit row.

*In practice:* the entity vault imports straight from the workbook to the DB; the wall is owner + Executive Assistant, by name; corporate-scope screens show patient initials, not names.

**The Test:** *If this repository leaked publicly today, is the blast radius still zero?*

### Principle 14 · Evolve Without Breaking
Armada ships daily, so it must change **additively**: migrations add, they don't destroy; renames wait for the collision checklist; nothing is deleted on an assumption of disuse; there is no big-bang rewrite — ever. Audit first, then map, then code.

*In practice — the receipts:* the audit-before-building directive ("do not rebuild, delete, rename... give me the audit first") is now standing law. The `facilities`→referral_partners rename waits on its Salesforce dependency. The fresh-database boot crash taught the corollary: every change must leave a **brand-new install** bootable, not just the live one — additive isn't safe if the additions are out of order.

**The Test:** *Does the app boot on an empty database AND on yesterday's database? Did anything get deleted or renamed without its dependency checklist?*

### Principle 15 · Every Feature Must Be Measurable
If you can't measure it, you can't improve it — and worse, you can't retire it. Every module must be able to answer: **how often is it used · how long does the workflow take · where do users abandon it · what business outcome does it improve?** A feature whose success can't be stated before it's built is a feature nobody will ever be able to defend or delete.

*In practice:* the platform already measures the *business* obsessively (avg flag→ordered days, time-to-resolve, PHP completion, turnover, eNPS). This principle extends the same discipline to the *product*: the `org_events` spine doubles as usage telemetry — every event row is both an audit fact and a metric sample. New-feature PRs name their success metric; the audit's "do not assume a feature is unused" rule gets teeth only when usage is actually counted.

**The Test:** *Six months from now, what number will tell us this feature worked? Where will that number come from?*

### Principle 16 · Operational Calm
The interface stays calm under pressure — that calm is a clinical feature, not an aesthetic one, because the people using this software are often having the hardest hour of their week. White space, clear typography, minimal color, **color only for meaning**, one primary action, consistent layouts, fast loads, no visual noise. This is also, not coincidentally, what makes software feel expensive.

*In practice:* the design system is this principle made enforceable — two shadows, five meaning-hues that never decorate, motion ≤200ms and only to confirm, skeletons instead of spinners, per-tile independence so one failure never blanks a board.

**The Test:** *Open the screen during a crisis. Does it lower the user's heart rate or raise it?*

---

## Article V — The Signature: Operational Intelligence
*The pattern that makes Armada recognizably Armada. Nearly every substantive screen renders three strata, in order:*

| Stratum | Answers | Voice |
|---|---|---|
| **Information** | What happened? | facts — fields, timeline, status |
| **Intelligence** | What does Armada think matters here? | the AI layer — grounded, cited, labeled (Principle 12) |
| **Action** | What should I do now? | verbs — the recommended actions, one primary |

*Worked example — an authorization page:*
```
Authorization · Approved days: 14 · Expires: Friday
──────────────── INFORMATION ────────────────
Insurance · Reviewer · Current status · Linked patient
──────────────── INTELLIGENCE ───────────────
Documentation is sufficient for renewal.
One nursing note is missing.
Patient meets continued-stay criteria.
──────────────── ACTION ─────────────────────
[Renew authorization]  [Request missing note]  [Notify case manager]
```

The same three strata already exist in embryo across the platform — the discharge debrief (facts → evidence-grounded insight → doc-gap nudge), the lease Q&A (document → AI reading → landlord email), the coverage matrix (policies → missing-line flags → renew). This article names the pattern so every future screen — HR, finance, admissions, clinical, compliance — reuses it instead of rediscovering it. The design system carries the component spec (`.oi-*`).

**The Test:** *Does this screen separate what happened from what Armada thinks from what to do — and is the intelligence stratum grounded per Principle 12?*

---

## Article VI — The Five Gates
*Every new feature passes all five before it ships. These are gates, not aspirations — a feature that fails one goes back.*

1. **Clarity** — can a new employee understand this page in 10 seconds?
2. **Speed** — can an experienced user complete the common task in under a minute, in ≤3 interactions from their homepage?
3. **Trust** — can the user always tell what is saved, pending, approved, or awaiting them? (No silent failures; report outcomes faithfully.)
4. **Consistency** — does every table, form, search, timeline, and empty state behave like every other one? (Recipe classes, not bespoke markup.)
5. **Scalability** — does the design still work at 100 facilities, 10,000 employees, 50,000 patients, multiple states, multiple organizations? *Scalability here means the data model and the information architecture — a screen that lists facilities must group by region; a query scoped by facility_id scales, a query that assumes "the facility" does not.*

---

## Article VII — Armada OS and Its Products

The platform's name is **Armada OS — the operating system for behavioral healthcare.** It is deliberately more than an EHR: enterprise management, facility operations, clinical workflows, and workforce management in one platform. Internally, modules are **products inside Armada OS**, and every future feature must name its product before it's built — a feature that fits no product is a new product decision, not a new top-level menu item.

| Product | What it owns | Already inside it today |
|---|---|---|
| **People OS** | the employee lifecycle & culture | HCOS (roster→onboarding→reviews→relations→leave→offboarding), certifications, hiring pipeline, training, The Standard, recognition, My Role/growth, pulse |
| **Clinical OS** | patient care & documentation | detox kit (rounds, care cards, arrival, dignity, records), housing kit (Hilltop suite), outpatient kit (census, groups, PHP completion), discharge & debriefs, retention, incidents, family, case management |
| **Operations OS** | the buildings & the day | **Operations Center**, admissions & arrivals, census & beds, staffing & scheduling, inventory & ordering, maintenance, concierge, meals, transport, Corporate Hub logistics (orders, projects, vendors) |
| **Revenue OS** | money in & money protected | UR/authorizations (to build), billing readiness (doc-gap today), QuickBooks in-app (approved), payments & entity finance, business insurance & leases |
| **Growth OS** | the front door & the network | referral management (after the referral_partners rename), business development, alumni & outreach, marketing procurement |
| **Executive OS** | judgment | Corporate Command Center, Enterprise Analytics, outcomes & scorecards, Ask-the-business AI, strategic planning |

Two placements are deliberate: the **Operations Center is the desktop of Armada OS** — the screen the products surface into, owned by Operations OS but fed by all six. And **Intelligence is not a product** — per Principle 12 it's a layer inside every product, so there is no "AI OS" to bolt features onto.

---

## Article VIII — The Review
*Before any feature is approved, ten questions. Any "no" means the feature isn't ready — not that it needs an exception.*

1. Does this support the Constitution? *(name the principles it leans on)*
2. Does it use existing design components? *(recipes, not bespoke markup)*
3. Is it facility-aware? *(facility_id or a written reason it's corporate-scope)*
4. Is it permission-aware? *(who may see, who may act — in the permission tables)*
5. Does it create tasks when work is required? *(owner · due · priority · status · related record)*
6. Does it publish the right events? *(capability registry row updated)*
7. Does it appear in the appropriate dashboard? *(its Ops Center tile / role homepage row)*
8. Is it searchable? *(its records reachable from global search)*
9. Is it in the audit log? *(every sensitive or destructive action writes a row)*
10. Could a first-time user understand it in under 10 seconds? *(Gate 1, asked one last time)*

The checklist is deliberately boring. Boring is what coherence feels like from the inside.

---

## Article IX — Amendment
This constitution changes the way constitutions should: **rarely, explicitly, and in writing.** A principle is amended when reality proves it wrong, not when a deadline finds it inconvenient. Any exception granted in a review is either (a) a bug to fix, with a date, or (b) the first line of a proposed amendment. Silence is not an amendment.

*Amendment log:*
- **v1.0** — ratified: twelve principles, five gates, product map.
- **v1.1** — CTO review: added Article II (The Platform Contract) with Principles 5 (capability ownership) and 6 (everything integrates); added Principle 10 (never make users remember) and Principle 15 (every feature must be measurable); added Article V (Operational Intelligence — the signature) and Article VIII (The Review). Principles renumbered accordingly.

*Ratified alongside: ARMADA-AUDIT.md · ARMADA-DOMAIN-ARCHITECTURE.md · ARMADA-PLATFORM-ARCHITECTURE.md · ARMADA-DESIGN-SYSTEM.md — together, the five governing documents of Armada OS.*
