# ADR-0002: Restart as a blueprint monorepo; freeze the legacy prototype

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Product Owner, Technical Lead

## Context

The repository previously contained a single-file Express prototype
("armada-care-standards": `server.js` ~1.1 MB, vendor SDKs, ad-hoc auth,
embedded content). The blueprint directs a from-scratch build with strict
boundaries (apps/packages separation, provenance, policy-based authorization,
PHI-safe logging) that the prototype's architecture cannot be retrofitted to
meet. Leadership directed: build new, from scratch, no carry-over.

## Decision

We will build the Armada Excellence OS as a fresh monorepo at the repository
root, per blueprint §6. The entire prototype (code, docs, deployment config)
moves unchanged to `legacy/` and is frozen: reference only, no new features,
no imports from `legacy/` into the new codebase. Its git history remains
intact.

## Consequences

- Anything that deploys the old app from the repo root (e.g. `render.yaml`,
  root `Dockerfile`) must repoint to `legacy/` paths if that deployment is to
  keep running from this branch. The old files are preserved verbatim at
  `legacy/render.yaml` and `legacy/Dockerfile`.
- Content worth keeping (Gold-Standard text, role definitions, handbook
  material) will be migrated deliberately in Epic 3 as versioned Excellence
  content with approvals — not copied wholesale.
- The new system reaches feature parity epic by epic; until then the legacy
  app remains the operational tool.

## Security / privacy notes

The legacy tree is excluded from the new format gate but included in the
secret scan. Any real credentials or data discovered in `legacy/` must be
rotated/removed rather than grandfathered.
