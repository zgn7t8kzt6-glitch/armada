# ADR-0004: Single strict TypeScript configuration

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Technical Lead

## Context

Domain correctness matters more here than developer convenience: identity
matching, consent decisions, and provenance rules will all be TypeScript.
Loose compiler settings let entire bug classes (implicit any, unchecked index
access, optional-property confusion) reach review.

## Decision

All workspaces extend one shared config,
`packages/config/tsconfig.base.json`, with `strict` plus the stricter
non-default flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
`noUnusedLocals/Parameters`, `noPropertyAccessFromIndexSignature`,
`verbatimModuleSyntax`, `isolatedModules`. Modules are ESM (`NodeNext`),
target ES2022, composite projects with declarations and source maps.

Per-workspace overrides may only add references and paths — never weaken
strictness. Tests compile under the same flags as production code.

## Consequences

More friction writing code, far less debugging it. `exactOptionalPropertyTypes`
and `noUncheckedIndexedAccess` occasionally require explicit handling that
feels verbose; that explicitness is the point in a clinical-adjacent codebase.

## Security / privacy notes

Stronger typing directly supports data-classification and consent-decision
correctness in later epics (e.g. exhaustive switch checks on decision enums).
