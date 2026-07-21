# Claude Code Instructions

You are building the Armada Excellence Operating System, a healthcare operational platform handling potentially sensitive behavioral-health information.

Read `docs/BUILD_BLUEPRINT.md` before making architectural changes. The legacy prototype lives untouched in `legacy/` and must not be extended; new work happens only in the monorepo (`apps/`, `packages/`, `docs/`, `infrastructure/`).

## Mandatory rules

1. Never invent vendor API endpoints, schemas, authentication methods, or capabilities.
2. When vendor documentation is absent, create interfaces, mocks, TODOs, and discovery questions—not guessed production code.
3. Default all vendor connectors to read-only.
4. Do not implement autonomous clinical, medication, billing, claims, or consent decisions.
5. Do not log PHI or Part 2 payloads.
6. Use synthetic test data only. No production PHI anywhere in this repository or its environments.
7. Every endpoint requires explicit authorization policy tests.
8. Every imported record requires provenance.
9. Every alert requires an explanation, source timestamp, owner, and resolution method.
10. Ambiguous identity matches must go to human review.
11. Use feature flags for incomplete, write-back, or high-risk functionality.
12. Add an architecture decision record for material design choices (`docs/adr/`).
13. Keep business logic out of UI components and vendor adapters.
14. Write tests before or with every domain rule.
15. Keep the application operable when integrations are unavailable.
16. Do not claim regulatory compliance; implement controls and produce evidence for qualified review.

## Development workflow

- Read `/docs` before changing architecture.
- Propose a small plan for each issue.
- Make incremental commits.
- Run formatting, linting, type checking, unit tests, authorization tests, and build: `npm run verify`.
- Update OpenAPI and relevant documentation.
- Add migration and rollback notes for database changes.
- Add threat-model notes for sensitive features.
- Stop and request authoritative documentation when implementation depends on unknown vendor behavior.

## Toolchain conventions (Epic 1)

- npm workspaces monorepo; TypeScript project references built with `tsc --build`.
- Strict TypeScript shared config: `packages/config/tsconfig.base.json`.
- Tests use Node's built-in `node:test` runner against compiled output.
- Dependency policy: zero runtime dependencies; dev toolchain limited to `typescript` and `@types/node` until an ADR approves more. See `docs/adr/0003-minimal-dependency-toolchain.md`.
- Environment variables are validated at process start via `@armada/env`; never read `process.env` directly in app code.
- All logging goes through `@armada/observability` (PHI-safe structured logs); never `console.log` in app code.
