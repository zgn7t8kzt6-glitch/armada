# Security Policy

Armada Excellence OS handles operational data for behavioral-health facilities. Production use is gated by the Production Readiness Gate in `docs/BUILD_BLUEPRINT.md` §35. Until that gate is signed, **no production PHI may enter any environment of this system.**

## Reporting a vulnerability

Report suspected vulnerabilities privately to the Security Lead (see `docs/BUILD_BLUEPRINT.md` §3.1 for named roles). Do not open public issues containing exploit details, credentials, or any patient information.

## Standing rules

- No secrets in code, commits, or CI logs. Secrets come from the environment / a managed vault. CI runs a secret scan (`npm run secrets:check`).
- No PHI or 42 CFR Part 2 data in logs, error trackers, test fixtures, or development databases. Synthetic data only (`packages/test-fixtures` in a later epic).
- Separate development, test, staging, and production environments. No production data flows downward.
- TLS 1.2+ in transit; encryption at rest with managed keys.
- Default deny: authorization checks at service and route layers; facility isolation is tested, not assumed.
- Vendor connectors are read-only by default; write paths are feature-flagged off and require a signed risk assessment (blueprint §4, Phase 2 gate).
- Audit events are append-only (`packages/audit` in a later epic).
- Dependency policy is deliberately minimal (see ADR-0003); any new dependency requires review for supply-chain risk.

## Environment expectations

- MFA enforced through the identity provider (Epic 2).
- Least-privilege service accounts; short-lived credentials where possible.
- Dependency scanning, secret scanning, and container scanning run in CI.
