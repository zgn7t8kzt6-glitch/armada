# ADR-0005: Foundation guardrails — env validation, feature flags, PHI-safe logging

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Security Lead, Privacy Officer

## Context

Three cross-cutting rules must exist before any feature code: configuration
must fail fast (blueprint §5.4), high-risk functionality must default off
behind flags (CLAUDE.md #11), and logs must be structurally incapable of
carrying PHI (CLAUDE.md #5, §22). Retrofitting these is how platforms leak.

## Decision

- **`@armada/env`:** every app declares a typed schema and calls `loadEnv` at
  startup; invalid config aborts boot listing all problems, secrets redacted.
  Direct `process.env` reads in app code are prohibited.
- **`@armada/feature-flags`:** flags are declared with name, description,
  owner role, and risk tier; everything defaults **off**. Environment
  overrides (`ARMADA_FLAG_*`) work in non-production; a high-risk flag can
  never be enabled by environment override in production — enabling one
  requires a reviewed code/config release under §3.2 decision rights.
  Unknown flag reads throw.
- **`@armada/observability`:** JSON-line structured logging only. Field keys
  matching a broad sensitive-name deny list (patient identifiers, clinical
  terms, credentials, and any `payload`/`body` key) are redacted recursively;
  long values truncate; reserved envelope keys cannot be spoofed. `console.log`
  is prohibited in app code. The sink abstraction is the future OpenTelemetry
  attachment point.

## Consequences

Redaction is deny-list based and will occasionally redact innocent fields
(e.g. `roomNumber` if added to the extra list) — acceptable; the failure mode
we refuse is the opposite one. Later epics add allow-list schemas per log
call-site for higher precision, plus real metrics/tracing.

## Security / privacy notes

This is defense in depth, not permission to log freely: developers must still
log stable internal references (UUIDs, request IDs), never source-record
content. Test fixtures assert that known-sensitive keys never survive
sanitization.
