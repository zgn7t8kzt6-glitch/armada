# ADR-0003: Minimal-dependency toolchain — npm workspaces, tsc, node:test

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead, Security Lead

## Context

Blueprint §5 recommends a reference stack (Turborepo/Nx, Next.js, NestJS or
Fastify, Prisma, etc.) while §23 names dependency/supply-chain compromise as a
modeled threat, and leadership directed the rebuild to pull nothing in beyond
already-available access. A healthcare platform's dependency tree is attack
surface and audit burden; every package must earn its place.

## Decision

For Epic 1 we will use only capabilities built into Node 22 and the TypeScript
compiler:

- **Monorepo:** npm workspaces + TypeScript project references
  (`tsc --build`); no Turborepo/Nx until build times justify it.
- **Runtime dependencies:** zero. Apps use `node:http`, `node:test`,
  `crypto.randomUUID`, etc.
- **Dev dependencies:** exactly `typescript` and `@types/node`.
- **Formatting/linting/secret scanning:** dependency-free scripts in
  `scripts/` enforcing `.editorconfig` rules and high-confidence secret
  patterns, plus `npm audit` in CI.

Any new dependency (including Prettier, ESLint, Prisma, a web framework)
requires a superseding or extending ADR naming the package, why built-ins are
insufficient, and its supply-chain review. Known upcoming decision points:
Prisma/PostgreSQL client (Epic "Database"), OIDC library (Epic 2), frontend
framework (Epic 10).

## Consequences

- Easier: security review, license review, reproducible builds, `npm ci` in
  seconds, no framework churn.
- Harder: we forgo framework conveniences; hand-rolled checks are blunter
  than ESLint/Prettier. Accepted for the foundation; revisit at each epic
  that genuinely needs more.

## Security / privacy notes

Shrinks the supply-chain attack surface to two well-known dev-time packages.
CI fails on high/critical `npm audit` findings.
