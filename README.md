# Armada Excellence Operating System

Two coordinated products under one program, never combined in their delivery dependencies:

- **Armada Excellence System (AES)** — the culture, standards, role guidance, daily management, compliance-readiness, and continuous-improvement system. Deployable on paper, without software.
- **Armada Intelligence Platform (AIP)** — the secure data orchestration, dashboard, task, exception-management, and integration platform that accelerates AES.

The full specification lives in [`docs/BUILD_BLUEPRINT.md`](docs/BUILD_BLUEPRINT.md). Coding rules for AI-assisted development live in [`CLAUDE.md`](CLAUDE.md). **Status: Epic 1 (Foundation). No vendor integrations, no production PHI.**

## Quick start

```bash
# Node >= 22.11 (see .node-version)
npm ci
npm run verify   # format check + secret scan + strict typecheck + tests
```

Run the placeholder API locally:

```bash
npm run build
node apps/api/dist/main.js   # GET http://localhost:3000/health
```

Local PostgreSQL/Redis for upcoming epics: `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d`, or use the [devcontainer](.devcontainer/devcontainer.json).

## Repository layout

| Path | Purpose |
|---|---|
| `apps/api` | Core domain API (placeholder HTTP service with health/readiness endpoints) |
| `apps/worker` | Ingestion / reconciliation / alerts worker (placeholder loop) |
| `apps/web`, `apps/admin` | Role-based UX and governance UI (stubs; framework decision deferred — see ADR-0003) |
| `packages/env` | Typed, fail-fast environment validation (no direct `process.env` access in apps) |
| `packages/feature-flags` | Feature flag registry — high-risk capabilities default **off** |
| `packages/observability` | PHI-safe structured logging (allow-listed fields, automatic redaction) |
| `packages/config` | Shared strict TypeScript configuration |
| `docs/` | Blueprint, ADRs, architecture, security, privacy, compliance, vendor discovery |
| `infrastructure/` | Docker dev services, Terraform (later), policies |
| `scripts/` | Dependency-free repo checks (format, secrets, env) used locally and in CI |
| `legacy/` | The frozen pre-monorepo prototype (reference only; do not extend) |

## Non-negotiables (summary)

- Read-only vendor integrations first; write paths feature-flagged off and separately gated.
- Never invent Kipu, Salesforce, or CollaborateMD API behavior — interfaces and mocks until signed vendor discovery.
- No PHI in logs, fixtures, or development environments; synthetic data only.
- Ambiguous patient identities are never auto-merged.
- No autonomous clinical, medication, billing, claims, or consent decisions.
- Compliance is the floor; excellence is the operating target.

## Documentation map

- [Build blueprint](docs/BUILD_BLUEPRINT.md) — the A-to-Z specification
- [Architecture](docs/architecture/overview.md) — system context and epic roadmap
- [ADRs](docs/adr/README.md) — architecture decision records and process
- [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)
- [Vendor discovery templates](docs/vendor-discovery/) — capability matrices to be completed with signed vendor findings
