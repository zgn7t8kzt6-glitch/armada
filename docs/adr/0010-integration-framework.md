# ADR-0010: Integration framework (Epic 5)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Security Lead, Data Governance Council

## Context

Epic 5 requires the connector SDK, canonical envelope, ingestion pipeline,
mapping registry, dead-letter queue, reconciliation, and mock connectors
(blueprint §27), under the §12 contract and the standing rules: no invented
vendor behavior (CLAUDE.md #1–2), read-only by default (#3), provenance on
every imported record (#8), and no PHI payloads in logs (#5).

## Decision

1. **SDK** (`@armada/integrations-core`): the §12 `SourceConnector`
   interface and canonical envelope, verbatim. Envelope checksums are
   SHA-256 over a deterministic payload serialization. A contract-test kit
   (`assertConnectorContract`) asserts read-only capabilities, absent write
   methods, envelope validity, unique event IDs, and duplicate-free cursor
   resume — mocks and future real adapters pass the same assertions.
2. **Pipeline semantics:**
   - *Quarantine* — schema-invalid envelopes and unregistered
     schema/mapping versions are quarantined, never retried; audit records
     carry identifiers and reasons only, never payloads.
   - *Dead-letter* — processing failures retry with exponential backoff
     (3 attempts) then dead-letter; a redrive API reprocesses after the
     fault is fixed.
   - *Idempotency* — duplicate deliveries are recognized by content hash
     and counted, not re-applied; source deletions become tombstones so
     provenance is never destroyed.
   - *Cursors* — checkpoints persist per connector and never advance on a
     failed run.
   - *Reconciliation* — every run records read/created/updated/duplicate/
     deleted/quarantined/dead-lettered counts; volume swings beyond 1.5×
     against the previous run raise an audited anomaly that becomes an
     owned work item (system administrator, high priority).
3. **Provenance:** ingested records carry the §8 fields (source system,
   record ID, source timestamps, connector/mapping versions, content hash,
   last-reconciled time). Vendor IDs are never platform primary keys.
4. **Mock connectors** live in the blueprint's per-vendor packages
   (`connector-kipu`, `connector-salesforce`, `connector-collaboratemd`),
   built on a shared `MockConnector` factory: deterministic synthetic
   payloads flagged `synthetic: true`, operational summaries only (no
   clinical notes, no full claim payloads), PHI classification exercised on
   the entity types that will carry it. `write` does not exist on any
   connector and `supportsWrite` is false — enforced by the contract kit.
   Each package header forbids real adapter code until its signed
   discovery document lands.
5. **Runtime:** in development the API boots the three mocks, runs
   ingestion at start and every 5 minutes, and serves
   `GET /api/v1/integrations/health` (admin-gated) with capabilities,
   health, last-run reconciliation counts, DLQ/quarantine depth, and
   cursors. Production configures no connectors and says so. Ingestion
   moves to `apps/worker` with the database epic.

## Consequences

- Epics 6–8 (real read connectors) become: implement `SourceConnector`
  against verified vendor docs, register mappings, pass the same contract
  tests. No pipeline changes.
- In-memory stores reset on restart, like every service since Epic 2 —
  swapped behind unchanged contracts in the database epic.
- The anomaly threshold (1.5×) is global for now; per-source freshness
  targets (§25) arrive with the metrics epic.

## Security / privacy notes

No vendor endpoints, auth methods, or schemas were assumed. Payloads never
reach logs or audit events (tested). Quarantine/DLQ entries retain envelopes
in memory for forensic review by the future admin console — access to that
console is admin-gated. Write paths fail closed via `WriteDisabledError`
and the absence of any write implementation.
