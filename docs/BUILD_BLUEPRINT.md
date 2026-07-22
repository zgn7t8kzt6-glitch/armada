# Armada Excellence Operating System
## A-to-Z Build Blueprint for Claude Code

**Version:** 1.0  
**Status:** Build specification, not production authorization  
**Primary deployment:** Ohio residential and withdrawal-management facilities  
**Clinical levels in scope:** ASAM 3.2-WM, 3.5, 3.7, and 3.7-WM  

---

# 0. Executive Directive

Build two coordinated products under one program, but never combine their delivery dependencies.

1. **Armada Excellence System (AES):** the culture, standards, role guidance, daily management, compliance-readiness, and continuous-improvement system.
2. **Armada Intelligence Platform (AIP):** the secure data orchestration, dashboard, task, exception-management, and integration platform.

AES must be deployable without AIP. AIP may improve AES through automated daily lineup intelligence, work queues, scorecards, and evidence collection, but software delays must never delay Gold Standards, role cards, huddles, leader rounding, service recovery, or department standard work.

## Non-negotiable objectives

The combined system must:

- Make the correct next action obvious to every position.
- Treat compliance as the floor and excellence as the operating target.
- Use Horst Schulze's service-excellence principles as the cultural constitution.
- Use Studer methods to hardwire execution and accountability.
- Use the Baldrige framework to manage leadership, strategy, customers, workforce, operations, measurement, and results.
- Support evidence-based, trauma-informed, recovery-oriented clinical care.
- Support ASAM levels 3.2-WM, 3.5, 3.7, and 3.7-WM without pretending software can independently make clinical placement decisions.
- Support OhioMHAS certification and oversight requirements.
- Support Joint Commission readiness and continuous compliance.
- Protect HIPAA and 42 CFR Part 2 information using minimum-necessary access and explicit consent controls.
- Keep Kipu as the clinical system of record, Salesforce as the growth/relationship system of record, and CollaborateMD as the revenue-cycle system of record unless signed vendor discovery findings require a different assignment.
- Begin with read-only integrations.
- Never auto-merge ambiguous patient identities.
- Never automate a billable charge, claim, level-of-care decision, medication action, or clinical order without separately approved controls and human accountability.

---

# 1. Product Boundaries

## 1.1 Armada Excellence System

AES contains:

- Mission, vision, purpose, values, credo, employee promise, patient promise.
- Gold Standards and service values.
- Daily lineup and shift huddle system.
- Leader rounding, employee rounding, and patient rounding.
- Service recovery.
- Role cards and position playbooks.
- Department standard work.
- Training academy and competencies.
- Recognition system.
- Compliance crosswalks and survey readiness.
- KPI definitions and operating review rhythms.
- Corrective action and continuous improvement.
- Policies, procedures, forms, checklists, scripts, and job aids.

AES content may be stored in the platform, but it must also export to printable and offline formats.

## 1.2 Armada Intelligence Platform

AIP contains:

- Secure single sign-on.
- Role-based homepages.
- Read-only data ingestion from Kipu, Salesforce, and CollaborateMD in phase one.
- Enterprise patient/person/episode crosswalk.
- Bed, census, admissions, authorization, claims, and operational dashboards.
- Role-based work queues.
- Exception management.
- Task ownership and escalation.
- Daily lineup generator.
- Policy, procedure, role-card, and training content delivery.
- Audit evidence and compliance readiness.
- Data-quality reconciliation.
- Integration monitoring.
- Metrics and scorecards.

AIP is not:

- A replacement EMR.
- A replacement CRM.
- A replacement billing platform.
- A clinical decision-maker.
- A medication administration record.
- A claims adjudication system.
- A general-purpose data lake containing unlimited copies of all source-system data.

---

# 2. Product Principles

1. **One front door, multiple systems of record.** Users enter through AIP and are deep-linked to the authoritative application when source-system action is required.
2. **Role relevance.** Users see only the tasks, metrics, people, and standards needed for their responsibilities.
3. **Minimum necessary.** Do not copy data merely because an API exposes it.
4. **Read-only first.** Prove identity, security, reconciliation, reliability, and value before enabling write-back.
5. **Human-in-the-loop.** Ambiguous, clinical, financial, legal, and safety-sensitive actions require accountable review.
6. **Explainability.** Every alert shows why it fired, its source, its timestamp, its owner, the applicable standard, and the resolution method.
7. **Source traceability.** Every displayed fact retains source system, source record ID, retrieved time, and transformation version.
8. **Graceful degradation.** The facility must continue operating safely during platform or vendor downtime.
9. **Configuration before customization.** Workflows, roles, thresholds, facilities, and metric definitions should be configurable.
10. **Evidence by design.** Operational work should naturally generate survey and audit evidence.
11. **No hidden compliance logic.** Compliance rules must be versioned, readable, testable, approved, and attributable.
12. **Beautiful and calm.** The interface should reduce cognitive load, not decorate complexity.

---

# 3. Governance and Ownership

## 3.1 Required named roles

- Executive Sponsor
- Internal Product Owner
- Fractional Technical Lead / Integration Architect
- Privacy Officer
- Compliance Officer
- Clinical Design Authority
- Nursing Design Authority
- Revenue Cycle Design Authority
- Admissions Design Authority
- Security Lead
- Data Steward for each source system
- Implementation Partner Lead
- Facility Super Users

## 3.2 Decision rights

| Decision | Accountable approver |
|---|---|
| Product priority | Product Owner + Executive Sponsor |
| Clinical workflow | Clinical Design Authority |
| Nursing workflow | Nursing Design Authority |
| Billing workflow | Revenue Cycle Design Authority |
| Data disclosure | Privacy Officer / Counsel |
| Part 2 consent behavior | Privacy Officer / Counsel |
| Security architecture | Security Lead |
| Source-of-truth assignment | Data Governance Council |
| Compliance interpretation | Compliance Officer + Counsel as needed |
| Production release | Product Owner, Security, Privacy, Technical Lead |

## 3.3 Standing councils

### Product Council — weekly
Reviews backlog, adoption, defects, workflow priorities, and release readiness.

### Data Governance Council — biweekly
Approves definitions, ownership, matching rules, reconciliation, and data quality.

### Clinical Safety Review — before clinical feature release
Evaluates clinical risk, failure modes, escalation, and human review.

### Privacy and Security Review — before every integration or data expansion
Evaluates minimum necessary, consent, role access, retention, logging, and vendor terms.

### Excellence Council — monthly
Reviews patient experience, workforce engagement, leader rounding, service recovery, recognition, and Gold Standard adherence.

---

# 4. Delivery Phases and Gates

## Phase A — Excellence System launch

Deliver without waiting for integrations:

- Cultural constitution.
- 10–12 Gold Standards.
- Daily lineup script and cadence.
- Leader rounding templates.
- Patient rounding templates.
- Service recovery model.
- Priority role cards.
- Weekend AMA prevention standard work.
- Recognition framework.
- Akron pilot scorecard.

## Phase 0 — Technical discovery

Required outputs:

- Signed Kipu capability matrix.
- Signed CollaborateMD capability matrix.
- Salesforce org assessment.
- Build-vs-buy assessment.
- Integration platform recommendation.
- Data inventory and classification.
- Part 2 data-flow and consent decision model.
- Security threat model.
- Phase-one fixed scope and acceptance criteria.
- Five-year total cost of ownership.
- Go/no-go decision.

**Gate:** No production integration build before written vendor findings.

## Phase 1 — Read-only operational intelligence

Features:

- Identity and access.
- Facility and role configuration.
- Read-only connectors.
- Census and bed dashboard.
- Admissions pipeline dashboard.
- UR authorization queue.
- Claims/denial status queue.
- Executive scorecard.
- Daily lineup generator.
- Data-quality/reconciliation console.
- Integration monitoring.
- Policy and role-card library.

**Gate:** 30 days of reliable production operation, approved security review, and reconciliation accuracy before phase two.

## Phase 2 — Controlled handoffs

Potential features, only where vendor APIs support them:

- Salesforce admission-ready packet.
- Human-reviewed Kipu patient or episode creation.
- Acknowledged status handoff.
- Structured task creation.
- Limited demographic write-back.

**Gate:** Signed workflow-specific risk assessment, rollback plan, source-vendor sandbox test, and audit-log validation.

## Phase 3 — Financial workflow automation

Potential features:

- Charge readiness validation.
- Documentation completeness checks.
- Authorization mismatch warnings.
- Suggested charge export.
- Human-approved claim-related handoffs.

**Prohibited initially:** autonomous claims submission or autonomous charge creation.

---

# 5. Recommended Technical Stack

This is a default reference stack. Claude Code must keep major infrastructure choices behind interfaces so Armada can substitute approved services.

## 5.1 Application

- Monorepo: Turborepo or Nx.
- Frontend: Next.js, TypeScript, React.
- UI: Tailwind CSS with accessible internal design system.
- Backend API: NestJS or Fastify with TypeScript.
- Workflow jobs: Temporal preferred; BullMQ acceptable for phase-one noncritical jobs.
- Database: PostgreSQL.
- ORM: Prisma.
- Cache and distributed locks: Redis.
- Object storage: S3-compatible encrypted storage.
- Search: PostgreSQL full-text initially; OpenSearch only if required.
- Analytics: separate read replica or warehouse after phase-one volume proves need.

## 5.2 Integration

Preferred enterprise iPaaS: Workato, Boomi, MuleSoft, or Azure Integration Services selected after discovery.

The application must expose a stable internal connector contract so vendor integration may be implemented by:

- iPaaS recipes/flows,
- secure scheduled files,
- REST/FHIR endpoints,
- webhooks,
- or connector microservices.

Do not hardwire application logic directly to vendor response shapes.

## 5.3 Cloud and operations

- Approved HIPAA-eligible cloud environment.
- Infrastructure as Code: Terraform.
- Containers: Docker.
- Runtime: managed container platform; avoid Kubernetes unless scale or enterprise standards justify it.
- CI/CD: GitHub Actions.
- Secrets: managed secrets vault.
- Logs: centralized structured logging.
- Metrics: OpenTelemetry plus managed monitoring.
- Error tracking: approved service with PHI scrubbing.
- SSO: Microsoft Entra ID or approved identity provider using OIDC/SAML.

## 5.4 Security defaults

- TLS 1.2+ in transit.
- Encryption at rest using managed keys.
- Separate development, test, staging, and production environments.
- No production PHI in development.
- Synthetic test data.
- MFA enforced through identity provider.
- Least privilege service accounts.
- Short-lived credentials where possible.
- Secrets never committed to code.
- Dependency scanning, SAST, secret scanning, container scanning.
- Immutable audit events.

---

# 6. Repository Structure

```text
armada-excellence-os/
├── apps/
│   ├── web/                    # Next.js role-based user experience
│   ├── api/                    # Core domain API
│   ├── worker/                 # ingestion, reconciliation, alerts, exports
│   └── admin/                  # restricted configuration and governance UI
├── packages/
│   ├── ui/                     # accessible design system
│   ├── auth/                   # authorization, policy checks, session helpers
│   ├── domain/                 # domain entities and business rules
│   ├── database/               # Prisma schema, migrations, repositories
│   ├── integrations-core/      # canonical connector interfaces
│   ├── connector-kipu/         # vendor adapter, disabled until configured
│   ├── connector-salesforce/   # vendor adapter
│   ├── connector-collaboratemd/# vendor adapter or file adapter
│   ├── consent/                # consent decision service interfaces
│   ├── audit/                  # immutable audit event library
│   ├── rules-engine/           # versioned alert and compliance rules
│   ├── observability/          # logs, metrics, tracing, PHI redaction
│   ├── config/                 # shared lint, tsconfig, formatting
│   └── test-fixtures/          # synthetic healthcare-safe fixtures
├── docs/
│   ├── architecture/
│   ├── adr/                    # architecture decision records
│   ├── data-dictionary/
│   ├── integrations/
│   ├── security/
│   ├── privacy/
│   ├── compliance/
│   ├── runbooks/
│   ├── user-guides/
│   └── vendor-discovery/
├── infrastructure/
│   ├── terraform/
│   ├── docker/
│   └── policies/
├── scripts/
├── .github/workflows/
├── CLAUDE.md
├── CONTRIBUTING.md
├── SECURITY.md
├── README.md
└── LICENSE
```

---

# 7. Canonical Domain Model

The platform must use its own canonical model and retain vendor identifiers in crosswalk tables.

## 7.1 Core organizational entities

- Organization
- Facility
- Building
- Unit
- Room
- Bed
- Program
- LevelOfCare
- Department
- Position
- User
- WorkforceAssignment
- Shift

## 7.2 Person and treatment entities

- Person
- PatientProfile
- PatientIdentifier
- TreatmentEpisode
- Admission
- Transfer
- Discharge
- CareTeamAssignment
- PayerCoverage
- Authorization
- AppointmentSummary
- ClinicalRiskSummary

Do not store full clinical notes in phase one.

## 7.3 Growth entities

- Lead
- Inquiry
- ReferralSource
- ReferralOrganization
- AdmissionOpportunity
- OutreachActivity
- Campaign
- LostOpportunityReason

## 7.4 Revenue-cycle entities

- FinancialAccount
- ClaimSummary
- ClaimStatusEvent
- DenialSummary
- PaymentSummary
- ChargeReadinessException
- PayerAgingBucket

Do not store full claim payloads unless required and approved.

## 7.5 Excellence and operations entities

- GoldStandard
- DailyLineup
- LineupItem
- RoundingTemplate
- RoundingEvent
- ServiceRecoveryCase
- RecognitionEvent
- RoleCard
- StandardWork
- Policy
- Procedure
- FormTemplate
- TrainingModule
- Competency
- UserCompetency
- MetricDefinition
- MetricObservation
- Scorecard
- WorkItem
- Escalation
- ImprovementIdea
- PDSACycle
- CorrectiveAction
- AuditEvidence

## 7.6 Integration and governance entities

- SourceSystem
- SourceConnection
- ExternalRecordReference
- PersonCrosswalk
- EpisodeCrosswalk
- IngestionRun
- IngestionRecord
- ReconciliationIssue
- DataQualityIssue
- ConsentDirective
- ConsentDecision
- AccessPolicy
- AuditEvent
- RuleDefinition
- RuleVersion
- RuleEvaluation
- Notification

---

# 8. Minimum Database Schema Requirements

Claude Code must create a Prisma schema with:

- UUID primary keys generated internally.
- `organization_id` and `facility_id` boundaries where applicable.
- UTC timestamps and explicit source timestamps.
- Soft deletion only where legally and operationally appropriate.
- Immutable audit tables.
- Version columns for optimistic locking.
- Provenance columns on imported records.
- Data classification tags.
- Retention policy identifiers.

Every imported entity must include:

```text
source_system
source_record_id
source_record_version (when available)
source_updated_at
retrieved_at
connector_version
mapping_version
content_hash
last_reconciled_at
```

No vendor ID may serve as the platform primary key.

---

# 9. Identity Resolution

## 9.1 Required behavior

Create a deterministic and probabilistic matching service, but allow only deterministic auto-linking under approved rules.

Potential match attributes:

- Facility medical record number.
- Exact vendor crosswalk already established.
- Legal name.
- Date of birth.
- Phone.
- Email.
- Address.
- Payer member ID.

## 9.2 Rules

- Existing exact crosswalk: auto-link.
- Exact facility MRN plus DOB: auto-link if unique.
- Exact legal name plus DOB plus one additional approved attribute: auto-link if unique.
- Conflicting MRN or DOB: never auto-link.
- Multiple candidates: human review.
- Low-confidence candidate: human review.
- Merge action: dual confirmation for high-risk records.
- Unmerge must be supported and fully audited.

## 9.3 Reconciliation console

Display:

- Candidate records side by side.
- Matching and conflicting fields.
- Source systems and timestamps.
- Confidence explanation.
- Link, create new, defer, and escalate actions.
- Complete audit history.

Never display more Part 2 data than the reviewer is authorized to see.

---

# 10. Consent and Disclosure Decision Service

This is a policy enforcement service, not a checkbox field.

## 10.1 Required inputs

- Subject/person.
- Treatment episode.
- Data category requested.
- Source system.
- Destination system or recipient.
- Purpose of use/disclosure.
- Requesting user or service account.
- Facility/program.
- Applicable consent directive.
- Consent effective and expiration dates.
- Revocation status and timestamp.
- Legal basis and approved policy version.

## 10.2 Required output

```json
{
  "decision": "ALLOW | DENY | REQUIRE_REVIEW",
  "reason_codes": [],
  "policy_version": "string",
  "consent_directive_id": "uuid|null",
  "evaluated_at": "timestamp",
  "minimum_necessary_fields": [],
  "obligations": []
}
```

## 10.3 Safety rules

- Default deny for unclassified or ambiguous Part 2 data flows.
- Revocation affects future exchanges according to approved legal policy; never silently delete historical audit evidence.
- Every decision is logged without exposing unnecessary payload data.
- Batch exports must receive per-record or approved cohort-level decisions.
- Service-account access is subject to the same policy checks as user access.
- No production implementation until legal/privacy approval of the decision matrix and test cases.

---

# 11. Authorization Model

Use policy-based access control combining:

- Organization.
- Facility.
- Department.
- Position.
- Care-team relationship.
- Assigned work item.
- Data classification.
- Treatment episode.
- Purpose of use.
- Consent decision.
- Emergency/break-glass status.

## Baseline roles

- System Administrator
- Privacy Administrator
- Compliance Administrator
- Executive
- Facility Administrator
- Medical Director
- Provider
- Nursing Director
- Nurse
- Clinical Director
- Therapist/Counselor
- Case Manager
- BHT/Recovery Support
- Admissions
- Utilization Review
- Revenue Cycle
- Quality/Risk
- HR/Learning
- Facilities/Environmental Services
- Read-only Auditor

A role is not sufficient alone. A nurse at Facility A must not automatically see Facility B records.

## Break-glass

- Explicit reason required.
- Time-limited elevated access.
- Immediate audit event.
- Privacy review queue.
- User notification that access is monitored.

---

# 12. Integration Contract

Every connector must implement:

```ts
interface SourceConnector {
  name: string;
  capabilities(): Promise<ConnectorCapabilities>;
  healthCheck(): Promise<HealthStatus>;
  pull(cursor?: SyncCursor): AsyncIterable<CanonicalEnvelope>;
  acknowledge?(receipt: IngestionReceipt): Promise<void>;
  write?(command: ApprovedWriteCommand): Promise<WriteResult>;
}
```

`write` must be disabled by default through feature flags and deployment policy.

## Canonical envelope

```json
{
  "eventId": "uuid",
  "sourceSystem": "KIPU | SALESFORCE | COLLABORATEMD",
  "entityType": "string",
  "sourceRecordId": "string",
  "operation": "UPSERT | DELETE | SNAPSHOT",
  "sourceUpdatedAt": "timestamp|null",
  "retrievedAt": "timestamp",
  "schemaVersion": "string",
  "mappingVersion": "string",
  "classification": ["PHI", "PART2"],
  "payload": {},
  "checksum": "sha256"
}
```

## Ingestion behavior

- Idempotent processing.
- Cursor/checkpoint support.
- Dead-letter queue.
- Retries with exponential backoff.
- Quarantine malformed records.
- Schema validation.
- Mapping versioning.
- Reconciliation counts.
- Alert on unexpected volume changes.
- Do not log raw PHI payloads.

---

# 13. Vendor Discovery Specifications

## 13.1 Kipu

Create `docs/vendor-discovery/kipu-capability-matrix.md` with fields for:

- Authentication.
- API version.
- Treatment Episode model.
- Patient read/create/update.
- Episode read/create/update.
- Admission/discharge/transfer.
- Census and occupancy.
- Insurance.
- Authorization/UR.
- Appointment.
- Consent metadata.
- User/staff.
- Webhooks/events.
- Rate limits.
- Sandbox.
- Data latency.
- Pagination.
- Deprecation policy.
- Support SLA.
- Cost.

No Kipu write workflow may be implemented from assumptions.

## 13.2 Salesforce

Assess:

- Edition and API entitlements.
- Current objects and fields.
- Health Cloud presence/need.
- Leads, contacts, accounts, opportunities, campaigns, tasks.
- Existing PHI.
- Duplicate management.
- Integration user.
- Connected app/OAuth.
- Platform events/change data capture.
- Sandboxes.
- Field-level security.

## 13.3 CollaborateMD

Assess:

- REST/SOAP API.
- Patient/account interface.
- Claims and status.
- Charge interface.
- Denials.
- ERA/payment.
- Authorization.
- X12 support.
- SFTP/flat files.
- Clearinghouse dependencies.
- Webhooks.
- Sandbox.
- BAA.
- Data latency.
- Support and cost.

Until verified, implement only a connector interface plus synthetic mock adapter.

---

# 14. Role-Based Workspaces

## 14.1 Executive workspace

- Occupancy and average daily census.
- Referral-to-admission conversion.
- Planned vs actual admissions.
- Length of stay.
- AMA rate, including weekend trend.
- Authorization risk.
- Clean claim and denial trends if reliable data is available.
- Patient experience.
- Workforce turnover and vacancy where integrated.
- Safety events.
- Compliance readiness.
- Strategic initiatives.

Every metric must show definition, numerator, denominator, source, latency, owner, and last refresh.

## 14.2 Admissions workspace

- New inquiries.
- Qualification status.
- Referral source.
- Bed availability.
- Benefits status.
- Clinical prescreen status.
- Admission barriers.
- Scheduled arrival.
- Transportation.
- Missing documentation.
- Lost-opportunity reason.

## 14.3 Nursing workspace

Phase one should use summarized operational data only:

- Current census.
- Arrivals and discharges.
- Level-of-care mix.
- Approved high-level acuity flags.
- Required assessments due, if safely available.
- Staffing coverage.
- Handoff issues.

Do not reproduce the MAR or full clinical chart.

## 14.4 Clinical workspace

- Caseload.
- Treatment plan due dates.
- ASAM review due dates.
- Individual/family service due dates.
- Discharge barriers.
- Continuing-care status.
- Documentation exceptions.

## 14.5 BHT workspace

- Shift assignment.
- Approved task list.
- Observation/check schedule.
- Transportation.
- Room readiness.
- Safety notices.
- Standard work and escalation instructions.

Any clinical documentation remains in Kipu unless an approved write workflow exists.

## 14.6 UR workspace

- Authorization days remaining.
- Review due date.
- Last covered day.
- Missing required clinical elements.
- Payer contact status.
- Peer-to-peer deadline.
- Appeal deadline.
- Assigned owner.
- Escalation status.

## 14.7 Revenue cycle workspace

- Claims not submitted.
- Rejections.
- Denials.
- Aging.
- Authorization mismatch.
- Documentation hold.
- Unposted payments.
- Timely filing risk.
- Owner and next action.

## 14.8 Quality and compliance workspace

- Open incidents.
- Corrective actions.
- Audit calendar.
- Evidence requests.
- Policy review dates.
- Training/competency exceptions.
- Tracer readiness.
- Repeat findings.
- Rule/regulation crosswalk.

---

# 15. Excellence System Content Architecture

## 15.1 Cultural constitution

Create editable content models for:

- Purpose.
- Mission.
- Vision.
- Credo.
- Patient Promise.
- Employee Promise.
- Leadership Promise.
- Gold Standards.
- Service Values.
- Non-negotiable behaviors.

## 15.2 Gold Standard model

Each standard contains:

- Title.
- Plain-language statement.
- Why it matters.
- Observable behaviors.
- Unacceptable behaviors.
- Role-specific examples.
- Patient-experience connection.
- Compliance connection.
- Huddle discussion prompt.
- Recognition examples.
- Training module.
- Version and approval history.

## 15.3 Daily lineup

Lineup may contain:

- Daily Gold Standard.
- Patient-experience story.
- Recognition.
- Safety focus.
- Census and arrivals.
- Discharges and room turns.
- Authorization risks.
- High-priority operational barriers.
- Staffing gaps.
- One improvement focus.

AIP-generated clinical information must be minimal and role-appropriate.

## 15.4 Role card

Each role card contains:

- Role purpose.
- Customer/patient promise.
- Top responsibilities.
- Shift-start standard work.
- During-shift standard work.
- Shift-end standard work.
- Moments of truth.
- Escalation triggers.
- Documentation responsibilities.
- KPIs.
- Competencies.
- Required policies.
- Gold Standard examples.
- Career/mastery path.

## 15.5 Service recovery

Workflow:

1. Recognize.
2. Own.
3. Stabilize immediate need.
4. Apologize appropriately without unsupported admissions.
5. Resolve within authority.
6. Escalate where required.
7. Confirm resolution.
8. Document.
9. Identify system improvement.
10. Recognize employee ownership where appropriate.

Service recovery must not replace incident reporting, grievance handling, mandatory reporting, or clinical escalation.

---

# 16. Compliance Knowledge Model

The platform must store compliance content as versioned requirements, not unstructured notes.

## Requirement fields

- Authority.
- Citation/reference.
- Effective date.
- Applicability.
- Requirement summary.
- Full licensed/source text location, where permitted.
- Responsible department.
- Responsible position.
- Policy mapping.
- Procedure mapping.
- Evidence examples.
- Audit method.
- Review frequency.
- Risk rating.
- Last legal/compliance review.

## Frameworks

- ASAM service-level requirements.
- OhioMHAS certification and service requirements.
- Joint Commission Behavioral Health Care and Human Services standards.
- HIPAA.
- 42 CFR Part 2.
- OSHA.
- DEA/controlled-substance requirements as applicable.
- CMS/Medicaid requirements as applicable.
- Ohio professional-board requirements.
- Emergency management, infection prevention, environment of care, life safety, and medication management.

Do not reproduce copyrighted standards beyond the organization's license. Store citations, interpretations, mappings, and links to licensed content.

---

# 17. Rules and Alert Engine

## Rule definition example

```yaml
id: ur.authorization.expires_72h
name: Authorization expires within 72 hours
version: 1
status: active
scope:
  entity: authorization
conditions:
  - field: status
    operator: equals
    value: active
  - field: end_at
    operator: within_hours
    value: 72
outcome:
  severity: high
  work_queue: utilization_review
  owner_strategy: assigned_ur_owner
  escalation_after_hours: 12
explanation: Active authorization is approaching its end date.
required_sources:
  - kipu
  - collaboratemd
approved_by:
  - compliance
  - revenue_cycle
```

## Rule requirements

- Versioned and immutable after activation.
- Effective dates.
- Test fixtures.
- Human-readable explanation.
- Source dependencies.
- Suppression and acknowledgment rules.
- Escalation.
- False-positive feedback.
- Approval history.
- Audit trail.

---

# 18. Work Item and Escalation System

Every work item includes:

- Type.
- Title.
- Explanation.
- Subject/entity.
- Facility.
- Priority.
- Due time.
- Owner.
- Backup owner.
- Source facts.
- Source deep links.
- Applicable standard/rule.
- Required action.
- Resolution code.
- Resolution note.
- Escalation history.
- Audit history.

## Escalation principles

- Escalate to role, not only a named person.
- Support coverage schedules.
- Do not send PHI in insecure notifications.
- Notification links require authentication.
- Critical safety issues must use existing emergency escalation channels, not rely solely on AIP.

---

# 19. Metrics and Scorecards

Every metric definition includes:

- Business question.
- Owner.
- Formula.
- Numerator.
- Denominator.
- Inclusion/exclusion criteria.
- Source systems.
- Refresh schedule.
- Data latency.
- Target.
- Warning threshold.
- Directionality.
- Segmentation.
- Version.
- Approval.

Priority metrics:

- Census and occupancy.
- Admissions conversion.
- Time from inquiry to disposition.
- AMA rate.
- Weekend AMA rate.
- Average length of stay.
- Authorization expiration without review.
- Denial rate.
- Days in AR.
- Documentation completion.
- Patient grievances and service recovery.
- Patient experience.
- Employee turnover.
- Training and competency compliance.
- Incident trends.
- Corrective action closure.

Never display a metric without a definition tooltip and provenance.

---

# 20. User Experience and Design System

## Design goals

- Calm, premium, clinical, and operationally clear.
- WCAG 2.2 AA target.
- Responsive desktop/tablet; limited mobile workflows where safe.
- Keyboard navigable.
- High contrast.
- Plain language.
- Consistent severity indicators not dependent on color alone.
- Progressive disclosure of sensitive information.
- Maximum two clicks from homepage to assigned work.

## Core page pattern

1. Page purpose.
2. Current status.
3. What needs attention.
4. Why it matters.
5. Next action.
6. Source and freshness.
7. Standard/policy reference.

## Navigation

- Home.
- My Work.
- Patients/Episodes, permission controlled.
- Admissions.
- Census/Beds.
- UR.
- Revenue Cycle.
- Quality/Compliance.
- Excellence Library.
- Learning.
- Reports.
- Administration.

---

# 21. API Surface

Create REST APIs with OpenAPI documentation. Use consistent pagination, filtering, errors, and request IDs.

Minimum endpoints:

```text
GET  /api/v1/me
GET  /api/v1/facilities
GET  /api/v1/dashboard
GET  /api/v1/work-items
POST /api/v1/work-items/:id/acknowledge
POST /api/v1/work-items/:id/resolve
GET  /api/v1/census
GET  /api/v1/beds
GET  /api/v1/admissions/pipeline
GET  /api/v1/authorizations/at-risk
GET  /api/v1/claims/exceptions
GET  /api/v1/scorecards/:id
GET  /api/v1/excellence/gold-standards
GET  /api/v1/excellence/role-cards/:role
GET  /api/v1/lineups/today
POST /api/v1/lineups/:id/publish
GET  /api/v1/reconciliation/issues
POST /api/v1/reconciliation/issues/:id/resolve
GET  /api/v1/integrations/health
GET  /api/v1/audit-events
```

Admin mutation endpoints require elevated permissions and reauthentication for sensitive actions.

---

# 22. Audit and Logging

Audit events must include:

- Actor user/service.
- Action.
- Subject type and internal ID.
- Facility.
- Purpose.
- Timestamp.
- Request/session ID.
- Policy decision.
- Before/after hash or safe change summary.
- Source IP/device context where approved.
- Break-glass reason.

Do not place raw PHI in application logs. Use stable internal references.

Audit event storage must be append-only with integrity controls and retention approved by legal/compliance.

---

# 23. Privacy and Security Threat Model

At minimum, model:

- Overbroad cross-facility access.
- Unauthorized redisclosure of Part 2 data.
- Compromised integration account.
- Vendor API returning unexpected sensitive fields.
- PHI in logs or error monitoring.
- Incorrect identity merge.
- Stale consent.
- Revoked user retaining session.
- Mass export.
- Insecure notifications.
- Test environment contamination.
- Dependency or supply-chain compromise.
- Ransomware and downtime.
- Insider misuse.
- Dashboard screenshot/shoulder surfing.
- Incorrect source data creating unsafe operational assumptions.

For each threat, document prevention, detection, response, owner, and test.

---

# 24. Testing Strategy

## Required test layers

- Unit tests for domain rules.
- Contract tests for connectors.
- Schema validation tests.
- Integration tests with synthetic data.
- End-to-end role workflows.
- Authorization tests for every endpoint and page.
- Consent-decision table tests.
- Identity matching edge cases.
- Reconciliation tests.
- Performance tests.
- Accessibility tests.
- Backup/restore tests.
- Disaster recovery exercises.
- Penetration test before production.
- User acceptance tests by actual role representatives.

## Critical negative tests

- User from Facility A requests Facility B patient.
- Revoked user token attempts access.
- No consent exists for Part 2 exchange.
- Consent expired one second earlier.
- Connector sends duplicate event.
- Connector reorders events.
- Source deletes or retracts record.
- Patient identity candidates conflict on DOB.
- Vendor response adds an unexpected field.
- Authorization source systems disagree.
- Claim status is stale.
- Integration is down during morning lineup.

---

# 25. Observability and Reliability

## Service-level targets for phase one

- Monthly availability target: 99.9%, excluding approved maintenance.
- Dashboard data freshness targets defined per source.
- Integration run success rate target: 99%+ with automated retries.
- Critical ingestion failure alert: within 5 minutes.
- Reconciliation variance alert: same business day.

## Operational dashboards

- Connector health.
- Last successful sync.
- Records read/accepted/quarantined.
- API latency and error rate.
- Dead-letter queue.
- Data freshness.
- Rule evaluation volume.
- Notification delivery.
- Login/access anomalies.

---

# 26. Downtime and Business Continuity

The system must provide:

- Read-only last-updated timestamps.
- Clear stale-data banners.
- Downloadable approved downtime reports.
- Printed/offline role cards and emergency procedures.
- Manual census and UR processes.
- Restoration and reconciliation runbooks.
- RTO and RPO approved by leadership.
- Vendor outage communication templates.

AIP must never be the sole repository for information required to safely operate a shift.

---

# 27. Implementation Backlog

## Epic 1 — Foundation

- Monorepo.
- CI/CD.
- Environments.
- Database.
- Secrets.
- Observability.
- Feature flags.
- ADR process.

## Epic 2 — Identity and access

- SSO.
- User provisioning.
- Facility assignments.
- Role and policy engine.
- Break-glass.
- Access review reports.

## Epic 3 — Excellence content

- Gold Standards CMS.
- Role cards.
- Policies/procedures.
- Search.
- Versioning/approval.
- Print/PDF export.

## Epic 4 — Work management

- Work queues.
- Ownership.
- Due dates.
- Escalation.
- Resolution codes.
- Notifications.

## Epic 5 — Integration framework

- Connector SDK.
- Canonical envelope.
- Ingestion pipeline.
- Mapping registry.
- Dead-letter queue.
- Reconciliation.
- Mock connectors.

## Epic 6 — Salesforce read connector

- OAuth connected app.
- Lead/inquiry/referral pipeline.
- Change data capture or polling.
- Mapping and reconciliation.

## Epic 7 — Kipu read connector

- Implement only after vendor documentation.
- Patient/episode/census/insurance/authorization mappings as licensed.
- Treatment Episode compatibility.

## Epic 8 — CollaborateMD read connector

- Implement API or secure-file adapter after discovery.
- Claim status, denial, payment, aging summaries.

## Epic 9 — Identity resolution

- Crosswalk.
- Matching rules.
- Human review queue.
- Merge/unmerge controls.

## Epic 10 — Role workspaces

- Executive.
- Admissions.
- Nursing.
- Clinical.
- BHT.
- UR.
- Revenue cycle.
- Quality/compliance.

## Epic 11 — Daily lineup

- Template.
- Automated operational facts.
- Manual editor.
- Approval/publish.
- Attendance/acknowledgment optional.
- Printable view.

## Epic 12 — Metrics

- Metric registry.
- Calculation service.
- Scorecards.
- Definitions/provenance.
- Export.

## Epic 13 — Privacy and consent

- Classification.
- Consent directive model.
- Decision service stub.
- Legal-approved rules.
- Tests.
- Access integration.

## Epic 14 — Compliance readiness

- Requirement registry.
- Crosswalk.
- Evidence collection.
- Audit calendar.
- Corrective actions.
- Survey tracer workspace.

---

# 28. Phase-One Acceptance Criteria

Phase one is accepted only when:

- SSO and MFA are operational.
- Access is facility and role constrained.
- No unauthorized cross-role access is found in test evidence.
- All three source integrations use verified contracts or approved file interfaces.
- Imported data shows provenance and freshness.
- Duplicate imports are idempotent.
- Data-quality exceptions are visible and owned.
- Ambiguous identity matches are never auto-merged.
- Executive, admissions, UR, revenue-cycle, and quality workspaces pass UAT.
- Daily lineup can operate when one source is unavailable.
- All alerts have explanations and source links.
- Raw PHI is absent from logs.
- Backup and restore are demonstrated.
- Penetration-test critical findings are closed.
- Privacy and security sign-off is documented.
- Downtime procedures are trained.
- Product adoption and operational-value measures are baselined.

---

# 29. Explicit Non-Goals for Initial Release

- Replacing Kipu clinical documentation.
- Replacing CollaborateMD billing.
- Replacing Salesforce CRM.
- Clinical diagnosis or ASAM placement automation.
- Medication ordering or administration.
- Automated claims submission.
- Automated charge creation.
- AI-generated clinical notes.
- AI-generated medical advice.
- Autonomous consent interpretation.
- Patient-facing portal.
- Mobile native apps.
- Full enterprise data warehouse.

---

# 30. AI Use Policy

Claude Code may generate software, tests, documentation, and synthetic fixtures. Production AI features are out of phase-one scope unless separately approved.

Any future AI feature must:

- Have a defined intended use.
- Avoid autonomous clinical or legal decisions.
- Provide source grounding.
- Be evaluated for bias, hallucination, privacy, and safety.
- Use approved models and contracts.
- Prevent vendor training on Armada data unless explicitly authorized.
- Maintain human review.
- Log model/version and user action.

---

# 31. CLAUDE.md — Required Coding Instructions

Create `CLAUDE.md` containing:

```markdown
# Claude Code Instructions

You are building the Armada Excellence Operating System, a healthcare operational platform handling potentially sensitive behavioral-health information.

## Mandatory rules

1. Never invent vendor API endpoints, schemas, authentication methods, or capabilities.
2. When vendor documentation is absent, create interfaces, mocks, TODOs, and discovery questions—not guessed production code.
3. Default all vendor connectors to read-only.
4. Do not implement autonomous clinical, medication, billing, claims, or consent decisions.
5. Do not log PHI or Part 2 payloads.
6. Use synthetic test data only.
7. Every endpoint requires explicit authorization policy tests.
8. Every imported record requires provenance.
9. Every alert requires an explanation, source timestamp, owner, and resolution method.
10. Ambiguous identity matches must go to human review.
11. Use feature flags for incomplete, write-back, or high-risk functionality.
12. Add an architecture decision record for material design choices.
13. Keep business logic out of UI components and vendor adapters.
14. Write tests before or with every domain rule.
15. Keep the application operable when integrations are unavailable.
16. Do not claim regulatory compliance; implement controls and produce evidence for qualified review.

## Development workflow

- Read `/docs` before changing architecture.
- Propose a small plan for each issue.
- Make incremental commits.
- Run formatting, linting, type checking, unit tests, authorization tests, and build.
- Update OpenAPI and relevant documentation.
- Add migration and rollback notes for database changes.
- Add threat-model notes for sensitive features.
- Stop and request authoritative documentation when implementation depends on unknown vendor behavior.
```

---

# 32. Master Prompt for Claude Code

Copy the following into Claude Code after placing this blueprint at `docs/BUILD_BLUEPRINT.md`.

```text
You are the principal engineer for the Armada Excellence Operating System.

Read these files first:
- docs/BUILD_BLUEPRINT.md
- CLAUDE.md
- SECURITY.md
- docs/architecture/*
- docs/privacy/*

Your task is to build the phase-one foundation as a production-quality, security-conscious monorepo, but you must not invent Kipu, Salesforce, or CollaborateMD API behavior.

Implement in this order:

1. Create the monorepo, formatting, linting, strict TypeScript, test runner, CI, Docker development environment, and environment validation.
2. Create the PostgreSQL/Prisma canonical domain schema for organizations, facilities, users, roles, source systems, provenance, work items, Gold Standards, role cards, metric definitions, ingestion runs, reconciliation issues, crosswalks, rules, and audit events.
3. Implement OIDC-compatible authentication abstractions and a local development identity provider/mock. Implement policy-based authorization with organization, facility, role, purpose, and classification context.
4. Implement immutable audit events and PHI-safe structured logging.
5. Implement the connector SDK, canonical envelope, mock Kipu/Salesforce/CollaborateMD connectors, idempotent ingestion, quarantine, dead-letter handling, and reconciliation summaries.
6. Implement the human identity reconciliation queue. Do not auto-merge ambiguous records.
7. Implement the work-item service, ownership, due dates, escalation, resolution, and notifications abstraction.
8. Implement the Excellence content service for Gold Standards, role cards, policies, versioning, approvals, search, and printable views.
9. Implement initial role-based pages: executive, admissions, UR, revenue cycle, quality/compliance, and administration.
10. Implement the daily lineup generator using synthetic operational data, manual editing, approval, publication, and print view.
11. Implement the metric registry and scorecard with definitions and provenance.
12. Add comprehensive tests, seed data, accessibility checks, authorization matrix tests, and developer documentation.

For vendor connectors:
- Implement only interfaces, mocks, configuration validation, and contract-test scaffolding until authoritative vendor documents are placed in docs/integrations/vendor-name.
- Mark all write methods unsupported and disabled.
- Create vendor capability matrix templates.

Security requirements:
- No secrets in code.
- No PHI in logs.
- Synthetic fixtures only.
- Explicit authorization checks at service and route layers.
- Default deny.
- Facility isolation tests.
- Rate limiting and secure headers.
- CSRF protection where applicable.
- Input validation for every external boundary.
- Audit all sensitive reads and all mutations.

UX requirements:
- Accessible, calm, premium, responsive design.
- Every dashboard fact displays source and freshness.
- Every alert explains why it exists and how to resolve it.
- Stale or unavailable integrations are prominently marked.
- Do not use color as the only status signal.

Do not attempt to finish the entire product in one uncontrolled change. Work epic by epic. At the start of each epic, create or update an ADR and an implementation checklist. At the end, run all quality checks and produce a concise completion report listing files changed, tests run, risks, and unresolved dependencies.

Begin with Epic 1: Foundation. Do not implement real vendor integrations yet.
```

---

# 33. First 12 Claude Code Issues

1. Bootstrap monorepo and CI.
2. Add local Docker development services.
3. Define canonical Prisma schema.
4. Implement authentication abstraction and development auth.
5. Implement policy authorization and matrix tests.
6. Implement audit library and PHI-safe logging.
7. Implement connector SDK and canonical envelope.
8. Implement mock connectors and ingestion pipeline.
9. Implement reconciliation and dead-letter console.
10. Implement Excellence content models and admin UI.
11. Implement work-item engine.
12. Implement daily lineup prototype.

Each issue must include acceptance criteria, tests, security considerations, and documentation updates.

---

# 34. Required Documentation Deliverables

Before production:

- System context diagram.
- Container/component diagrams.
- Data-flow diagrams.
- Data dictionary.
- Source-of-truth matrix.
- Vendor capability matrices.
- Consent decision matrix.
- Authorization matrix.
- Threat model.
- Incident response plan.
- Downtime plan.
- Backup/restore plan.
- Disaster recovery plan.
- Integration runbooks.
- Reconciliation runbooks.
- Data retention schedule.
- Access review procedure.
- Change management procedure.
- Release checklist.
- UAT evidence.
- Security testing evidence.
- Privacy approval.
- Production support model.

---

# 35. Production Readiness Gate

No production PHI may enter the platform until all of the following are true:

- Vendor contracts and BAAs are approved.
- Architecture and data-flow diagrams are accurate.
- Minimum-necessary fields are approved.
- Part 2 disclosure/consent handling is approved by qualified counsel/privacy leadership.
- Security assessment is complete.
- Penetration testing is complete.
- Access controls and facility isolation pass tests.
- Audit logging is validated.
- Backup and restore are demonstrated.
- Incident response and downtime procedures are trained.
- Support ownership and on-call escalation are named.
- Data reconciliation is operational.
- Executive sponsor signs production authorization.

---

# 36. Regulatory and Standards Reference Notes

The system must be validated against current authoritative sources at implementation time. As of this blueprint:

- Ohio Administrative Code Rule 5122-29-09 addresses residential and withdrawal-management substance-use-disorder services and references ASAM level 3 and level 3-WM service structures.
- Ohio Administrative Code Chapter 5122-25 addresses provider certification and recognizes approved behavioral-health accreditation pathways, including Joint Commission accreditation for relevant services.
- Joint Commission detailed standards are maintained in its licensed accreditation manuals; this project should store mappings and evidence, not unauthorized copies of copyrighted standards.
- Kipu and CollaborateMD capabilities must be confirmed directly in writing. Public or marketing descriptions are insufficient for production commitments.

Authoritative implementation references should be maintained in `docs/compliance/sources.md` with retrieval date, effective date, owner, and review date.

---

# 37. Final Direction

Build the simplest secure system that reliably gives each employee:

- the work they own,
- the reason it matters,
- the time it is due,
- the standard that applies,
- the authoritative source,
- the correct escalation path,
- and evidence that the work was completed.

Do not build a visually impressive data warehouse that staff cannot trust. Do not build a second EMR. Do not let software delay the cultural operating system. Do not automate high-risk workflows until read-only intelligence, identity resolution, privacy controls, reconciliation, adoption, and governance are proven.
