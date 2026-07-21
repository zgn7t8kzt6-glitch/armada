# Data Handling Principles

The platform will process HIPAA PHI and 42 CFR Part 2 substance-use-disorder
records once in production. These principles bind all development now, before
any real data exists:

1. **No production PHI anywhere in this repository or its non-production
   environments.** Fixtures are synthetic (`packages/test-fixtures`, future)
   and reviewed as such.
2. **Minimum necessary.** We do not copy data because an API exposes it
   (blueprint §2.3). Every imported field must be justified by an approved
   workspace need.
3. **Part 2 default deny.** Unclassified or ambiguous Part 2 flows are
   denied until the consent decision service (Epic 13) and its
   legally-approved decision matrix exist. No consent behavior ships without
   Privacy Officer / Counsel approval (§3.2).
4. **Provenance everywhere.** Every imported record carries source system,
   record ID, timestamps, connector and mapping versions, and content hash
   (§8).
5. **Identity is never guessed.** Ambiguous person matches go to human
   review; conflicting MRN/DOB never auto-link (§9).
6. **Logs and errors are PHI-free** by structural redaction
   (`@armada/observability`), not by developer discipline alone.
7. **Access will be policy-based** (organization, facility, role, purpose,
   classification, consent) with break-glass auditing — Epic 2/13.
8. **Audit evidence is append-only** and retained per legal-approved
   schedules (§22).

Questions of interpretation go to the Privacy Officer; this document is an
engineering restatement, not legal advice, and claims no regulatory
compliance by itself (CLAUDE.md #16).
