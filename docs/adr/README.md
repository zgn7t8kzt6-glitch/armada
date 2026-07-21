# Architecture Decision Records

Every material design choice gets an ADR (CLAUDE.md rule #12). ADRs are
immutable once accepted: to change course, write a new ADR that supersedes the
old one and link both directions.

## Process

1. Copy `0000-template.md` to the next number: `NNNN-short-kebab-title.md`.
2. Status starts as `Proposed`; it becomes `Accepted` when the accountable
   approver per blueprint §3.2 signs off, or `Superseded by ADR-XXXX` later.
3. Reference the ADR from the PR that implements it.
4. Decisions touching data disclosure, Part 2 consent behavior, security
   architecture, or source-of-truth assignment additionally require the named
   approver from the decision-rights table before acceptance.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-restart-as-monorepo-freeze-legacy.md) | Restart as a blueprint monorepo; freeze the legacy prototype | Accepted |
| [0003](0003-minimal-dependency-toolchain.md) | Minimal-dependency toolchain: npm workspaces, tsc, node:test | Accepted |
| [0004](0004-strict-typescript-configuration.md) | Single strict TypeScript configuration | Accepted |
| [0005](0005-foundation-guardrails.md) | Foundation guardrails: env validation, feature flags, PHI-safe logging | Accepted |
| [0006](0006-identity-access-architecture.md) | Identity and access architecture (Epic 2) | Accepted |
| [0007](0007-append-only-audit-log.md) | Append-only audit log with hash chaining | Accepted |
| [0008](0008-excellence-content-architecture.md) | Excellence content architecture (Epic 3) | Accepted |
| [0009](0009-work-management-architecture.md) | Work management architecture (Epic 4) | Accepted |
