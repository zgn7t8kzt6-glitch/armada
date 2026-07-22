# Contributing

## Ground rules

1. Read `CLAUDE.md` and `docs/BUILD_BLUEPRINT.md` first. The blueprint is the specification; CLAUDE.md is the enforcement summary.
2. Work epic by epic (blueprint §27). Material design choices get an ADR in `docs/adr/`.
3. Synthetic data only. Never commit anything resembling real patient, employee, or payer data.
4. No new dependencies without an ADR (see ADR-0003).
5. The legacy prototype in `legacy/` is frozen: bug reference only, no new features.

## Local setup

```bash
# Requires Node >= 22.11 (see .node-version)
npm ci
npm run verify        # format check + secret scan + typecheck + tests
```

Optional local services (PostgreSQL, Redis) for later epics:

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
cp .env.example .env  # then edit values; .env is gitignored
npm run env:check     # validates your environment against the schema
```

Or open the repo in a devcontainer-capable editor — `.devcontainer/` provisions Node plus the compose services automatically.

## Workflow

1. Branch from `main`.
2. Make incremental commits with descriptive messages.
3. Run `npm run verify` before pushing. CI runs the same checks plus `npm audit`.
4. Update docs (and OpenAPI, once it exists) alongside code.
5. Database changes (later epics) require migration and rollback notes.

## Repository layout

```
apps/         web, api, worker, admin (deployable units)
packages/     shared libraries (config, env, feature-flags, observability, ...)
docs/         blueprint, ADRs, architecture, security, privacy, vendor discovery
infrastructure/  docker (dev), terraform (later), policies
scripts/      dependency-free repo checks used locally and in CI
legacy/       the frozen pre-monorepo prototype
```
