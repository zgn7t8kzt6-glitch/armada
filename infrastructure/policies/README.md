# Deployment and Organization Policies

Placeholder for machine-enforceable policies (e.g. OPA/Conftest rules,
branch-protection manifests, org security baselines).

Policies the blueprint already mandates and which must be encoded here as the
platform grows:

- Connector `write` capabilities disabled by default in every environment
  (blueprint §12); enabling requires the Phase 2 gate evidence.
- No production PHI outside production (§5.4).
- Audit event stores are append-only (§22).
- Production releases require Product Owner, Security, Privacy, and Technical
  Lead approval (§3.2).
