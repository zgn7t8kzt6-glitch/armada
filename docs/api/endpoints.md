# API Endpoint Reference

All routes are served by `apps/api`. Every non-public route requires a
Bearer session token and passes an explicit policy check; denials return
reason codes. Formal OpenAPI generation is a pre-production deliverable —
this reference tracks the live surface until then.

| Method & path | Purpose | Access (capability) |
|---|---|---|
| GET /health, /ready | Liveness/readiness | public |
| POST /auth/dev/login | Dev sign-in (absent in production) | public (non-prod only) |
| POST /auth/logout | Revoke session | session |
| GET /api/v1/me | Identity, roles, session, break-glass | session |
| GET /api/v1/facilities | Facilities the user covers | session |
| GET /api/v1/patients/summary?facilityId= | Synthetic census summary | patient_summary read (PHI), facility-scoped |
| GET /api/v1/audit-events[?facilityId=] | Audit log + integrity | audit_event read |
| POST /api/v1/break-glass | Emergency access grant | session (usage still policy-checked) |
| GET /api/v1/access-review | Access review report | access_review read |
| GET/POST /api/v1/work-items | Queues / create | work_item read/write, facility-scoped |
| POST /api/v1/work-items/:id/acknowledge · /resolve · /escalate | Lifecycle | work_item write |
| GET /api/v1/notifications | PHI-free notifications | session |
| GET /api/v1/excellence/gold-standards · /policies · /constitution · /search · /content/:id[/print] | Excellence library | excellence_content read |
| POST /api/v1/excellence/content[…/edit · /submit · /approve · /publish] | Authoring workflow | excellence_content write (+approver role) |
| GET /api/v1/reconciliation/issues | Identity review queue | identity_reconciliation read (audited) |
| POST /api/v1/reconciliation/issues/:id/resolve | Link/create/defer/escalate | identity_reconciliation write |
| GET/POST /api/v1/identity/merges · /:id/confirm · /:id/unmerge | Dual-confirmed merge lifecycle | identity_reconciliation write |
| GET /api/v1/metrics | Metric definitions + scorecards | census_summary read |
| GET /api/v1/scorecards/:id[?facilityId=][&format=csv] | Computed scorecard / export | census_summary read, facility-scoped |
| GET /api/v1/lineups/today?facilityId= | Today's lineup (generates draft) | daily_lineup read, facility-scoped |
| POST /api/v1/lineups/:id/items · /approve · /publish | Lineup workflow | daily_lineup write (+approver role) |
| GET /api/v1/lineups/:id/print | Printable lineup | daily_lineup read |
| GET /api/v1/compliance/requirements · /readiness | Registry + tracer rollup | compliance_registry read |
| POST /api/v1/compliance/evidence · /corrective-actions[/:id/close] | Evidence + CAP lifecycle | compliance_registry write |
| GET /api/v1/integrations/health | Connector monitoring | admin_config read |

The web app (`apps/web`, port 3100) renders role-based pages from this API:
`/login`, `/` (home), `/work`, `/scorecard`, `/lineup[/print]`,
`/library[/print]`, `/reconciliation`, `/compliance`, `/admin`.
