# Kipu Capability Matrix

- **Status:** ⬜ AWAITING SIGNED VENDOR FINDINGS — do not build against this
  document until every row cites written Kipu documentation or a signed
  vendor response (date + document reference).
- **Data Steward:** _unassigned_
- **Last updated:** —

> No Kipu write workflow may be implemented from assumptions (blueprint §13.1).

| Capability | Vendor answer | Evidence (doc/date) | Notes |
|---|---|---|---|
| Authentication method | | | |
| API version / versioning policy | | | |
| Treatment Episode model | | | |
| Patient read | | | |
| Patient create/update | | | |
| Episode read | | | |
| Episode create/update | | | |
| Admission / discharge / transfer | | | |
| Census and occupancy | | | |
| Insurance | | | |
| Authorization / UR | | | |
| Appointments | | | |
| Consent metadata | | | |
| User/staff data | | | |
| Webhooks / events | | | |
| Rate limits | | | |
| Sandbox availability | | | |
| Data latency | | | |
| Pagination | | | |
| Deprecation policy | | | |
| Support SLA | | | |
| Cost | | | |

## Open discovery questions

1. Does the API expose a stable, immutable patient identifier suitable for
   crosswalk use (never as our primary key)?
2. What is the minimum-necessary field set available per endpoint (can we
   exclude clinical note bodies in Phase 1)?
3. How are record deletions/retractions communicated?
