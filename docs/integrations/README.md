# Integrations

**Standing rule (CLAUDE.md #1–3):** no vendor endpoint, schema, auth method,
or capability may be invented. Until authoritative, signed vendor
documentation is placed in this directory (`docs/integrations/<vendor>/`),
only connector interfaces, mocks, configuration validation, and contract-test
scaffolding may exist in code — and every connector defaults to read-only.

## Connector contract (blueprint §12)

Every connector implements:

```ts
interface SourceConnector {
  name: string;
  capabilities(): Promise<ConnectorCapabilities>;
  healthCheck(): Promise<HealthStatus>;
  pull(cursor?: SyncCursor): AsyncIterable<CanonicalEnvelope>;
  acknowledge?(receipt: IngestionReceipt): Promise<void>;
  write?(command: ApprovedWriteCommand): Promise<WriteResult>; // flag-gated off
}
```

Ingestion requirements: idempotent processing, cursors/checkpoints,
dead-letter queue, retries with backoff, quarantine of malformed records,
schema validation, mapping versioning, reconciliation counts, volume-anomaly
alerts, and **no raw PHI in logs**. The SDK implementing this lands in Epic 5
(`packages/integrations-core`).

## Status

| Vendor | System of record for | Signed discovery | Code today |
|---|---|---|---|
| Kipu | Clinical | ❌ not received | `packages/connector-kipu` (mock only) |
| Salesforce | Growth/relationships | ❌ not received | `packages/connector-salesforce` (mock only) |
| CollaborateMD | Revenue cycle | ❌ not received | `packages/connector-collaboratemd` (mock only) |

The SDK, canonical envelope, ingestion pipeline (quarantine, dead-letter,
cursors, reconciliation, anomaly alerts), and contract-test kit live in
`packages/integrations-core` (ADR-0010). A real adapter must pass the same
`assertConnectorContract` assertions the mocks pass.

Discovery templates to be completed with vendors are in
[`../vendor-discovery/`](../vendor-discovery/). Phase 0 gate: **no production
integration build before written vendor findings** (blueprint §4).
