# Authorization Model (Epic 2)

Policy-based access control per blueprint §11. Implementation:
`packages/auth` (`evaluateAccess`), policy version `aip-policy/0.2.0-epic2`.
Matrix tests: `packages/auth/src/policy.test.ts`; endpoint tests:
`apps/api/src/server.test.ts`.

## Decision pipeline (default deny)

```text
request {user, resource, action, purpose, breakGlass?}
  1. user.status == active            else DENY USER_INACTIVE
  2. org assignment exists            else DENY ORGANIZATION_MISMATCH
  3. classification != PART2          else DENY PART2_CONSENT_UNAVAILABLE  ← until Epic 13
  4. purpose break_glass ⇒ valid grant else DENY PURPOSE_INVALID
  5. facility coverage                else break-glass? → ALLOW+obligations
                                            else DENY FACILITY_NOT_ASSIGNED
  6. role capability ∧ classification ceiling
        → ALLOW ROLE_CAPABILITY_MATCH
        else break-glass? → ALLOW+obligations
        else DENY ROLE_LACKS_CAPABILITY | CLASSIFICATION_EXCEEDS_ROLE
```

Every decision carries reason codes, obligations, policy version, and
timestamp; API denials return the reason codes (explainability without data
leakage) and every sensitive check is audited either way.

## Scoping rules

- A role assignment = role + organization + facility scope (`all` or an
  explicit facility list). **A role alone grants nothing.**
- `all` scope is reserved for governance/executive roles and is flagged in
  the access-review report for scrutiny.
- Resources without a facility (org-wide, e.g. access review) require `all`
  scope — facility-scoped staff cannot see organization-wide data.

## Capability matrix (coarse, Epic 2)

Ceilings: `—` none, `OP` operational, `PHI` includes operational. PART2 is
never grantable via the matrix.

| Role | patient_summary | census_summary | work_item | audit_event | access_review | admin_config |
|---|---|---|---|---|---|---|
| system_administrator | — | — | — | read OP | — | read+write OP |
| privacy_administrator | — | — | — | read PHI | read PHI | — |
| compliance_administrator | — | — | — | read PHI | read PHI | — |
| executive | — | read OP | read OP | — | — | — |
| facility_administrator | — | read OP | read+write OP | — | — | — |
| clinical roles* | read PHI | read OP | read+write OP | — | — | — |
| bht_recovery_support | — | read OP | read+write OP | — | — | — |
| admissions / utilization_review | read PHI | read OP | read+write OP | — | — | — |
| revenue_cycle | read PHI | — | read+write OP | — | — | — |
| quality_risk | read PHI | — | read+write OP | read PHI | — | — |
| hr_learning / facilities_environmental_services | — | — | read+write OP | — | — | — |
| read_only_auditor | — | read OP | — | read PHI | read PHI | — |

\* medical_director, provider, nursing_director, nurse, clinical_director,
therapist_counselor, case_manager.

Notably: system administrators configure the platform but cannot read PHI
(minimum necessary, §2.3).

## Break-glass

Reason ≥10 chars, duration ≤60 min, active user only. Grants facility
coverage for PHI **reads** at one facility; never writes, never Part 2.
Activation and every use are audited (`break_glass.activated`,
`policyDecision: ALLOW:BREAK_GLASS_APPLIED` with the reason); grants appear
in the access-review report and the privacy review queue. ALLOW decisions
carry obligations `ACCESS_MONITORED_NOTICE` (user must be told) and
`PRIVACY_REVIEW_QUEUED`.

## Sessions and identity

- OIDC-shaped `IdentityProvider` interface; only a dev provider exists and it
  refuses to construct in production. Real SSO + MFA: future ADR (ADR-0006).
- Sessions: server-side records + HMAC-signed bearer tokens; revocation is
  immediate (logout, `revokeAllForUser` on deprovisioning); TTL 5–480 min
  (default 30); no refresh.

## Standing negative tests (§24)

Facility A → Facility B denial · revoked token · expired session · expired
break-glass · Part 2 always denied · write without write capability ·
classification above ceiling · org mismatch · dev login absent in production.
