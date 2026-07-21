# Armada — HIPAA / 42 CFR Part 2 Go-Live Checklist

This app handles addiction-treatment information, which is protected by **both
HIPAA and 42 CFR Part 2** (Part 2 is stricter — it governs redisclosure and
requires patient consent). Do **not** put real client information in the app
until the steps below are complete. Until then: fake / de-identified data only.

"HIPAA compliant" is not a switch — it's a program (technical controls + signed
agreements + written policies + training). The app provides the technical
controls; your organization owns the agreements and policies.

---

## ✅ Already built into the app (technical safeguards)
- Encryption in transit (HTTPS), HSTS in production.
- Access control: per-user logins, admin vs. staff roles.
- **Two-factor authentication (2FA / TOTP)** — staff enable it from the 🔐 2FA button.
- **Automatic logoff** after 15 minutes of inactivity.
- **Audit log** of every view/create/update/delete of client data (admin-only).
- HttpOnly, Secure session cookies; bcrypt-hashed passwords; in-app password change.
- 42 CFR Part 2 **consent-on-file** flag per client (a starting point).

## ❗ Still required before real client data — your side

### 1. Choose a HIPAA-eligible host and sign a BAA  →  RECOMMENDED: Render
A **Business Associate Agreement (BAA)** is a contract where the vendor agrees to
protect PHI.

**Recommended for this app: Render's HIPAA workspace.** This app stores data in a
SQLite file on a persistent disk, so it needs a host with a **persistent encrypted
disk** — which Render provides (with daily encrypted snapshots), meaning **no code
rewrite**. Steps:
  1. Render dashboard → **Workspace Settings → Compliance** → start the BAA flow →
     upgrade to the **Scale** plan → sign the BAA (Render emails the link).
  2. Render enables the HIPAA workspace (auto after ~72h or on demand) and redeploys
     services to access-restricted, encrypted hosts.
  3. Confirm `NODE_ENV=production`, the persistent disk (in `render.yaml`), a strong
     `ADMIN_PASS`, a custom `KIOSK_CODE`, and leave `AI_DEIDENTIFY` on.

Alternatives: **AWS** (EC2/Lightsail + encrypted EBS; BAA free/self-serve; ~$30–100/mo,
you manage the box). **Aptible** is excellent for HIPAA but expects a managed Postgres
(ephemeral app disk) — it would require migrating this app off SQLite first.

### 2. Sign BAAs with every vendor that touches PHI
- **Claude (AI)** — required, because notes/Care Cards are sent to Claude. **Two ways:**
  - **RECOMMENDED — AWS Bedrock.** Run Claude through Bedrock (a HIPAA-eligible AWS service). The standard **AWS BAA** (free, self-serve in AWS Artifact) then covers the model — **no separate Anthropic BAA, no Anthropic sales call.** In the app: set `AI_PROVIDER=bedrock`, `AWS_REGION`, AWS credentials, and `BEDROCK_MODEL_ID` (confirm the exact Claude model id available in your region in the Bedrock console). Then run the **AI health check** in Settings to confirm structured outputs work on Bedrock before going live.
  - **Or — Anthropic direct.** Request a BAA via Anthropic sales / the Trust Center (paid). Keep `AI_PROVIDER=anthropic` and set `ANTHROPIC_API_KEY`.
  - With either BAA signed, set `AI_DEIDENTIFY=false` so Claude sees the real picture. **Until a BAA is signed, leave de-identification on (default) and keep AI on fake data only.**
- **Kipu** — a data-use agreement / BAA to pull records via their API.
- **Twilio / Resend** (if you use SMS/email alerts) — they will sign BAAs. **OR** keep alert messages PHI-free (see §5).

### 3. Protect the data at rest
- Run on an **encrypted volume with automated backups**. The app's database is a
  single SQLite file (`ARMADA_DB`) — fine for HIPAA on an encrypted, backed-up
  disk — or migrate to managed Postgres for scale (the app can be adapted).

### 4. Turn on the production safeguards
- Set `NODE_ENV=production` (enables Secure cookies + HSTS).
- Set a strong `ADMIN_PASS`; change it in-app after first login.
- Set a custom `KIOSK_CODE` (Settings → Kiosk & display code).
- **Require 2FA for all staff** (each enables it via 🔐 2FA).

### 5. Keep PHI out of side channels (Part 2 is strict here)
- Real-time SMS/email alerts currently include a client's preferred name. Before
  using real data, either (a) sign BAAs with Twilio/Resend, **or** (b) ask us to
  switch alerts to PHI-free ("High-risk alert — open Armada to view"). Recommended: PHI-free.
- Never put client info in Teams/texts/personal channels (this is also the Armada Standard).

### 6. Organizational program (with counsel / a compliance lead)
- HIPAA Security Risk Assessment.
- Written policies: access, passwords, breach notification, sanctions, retention.
- Workforce HIPAA + Part 2 training (the app's Training module can host this).
- Part 2 consent management and redisclosure controls.
- Designate a Privacy/Security Officer.

---

## Suggested order
1. Sign host BAA (Aptible/AWS) + Anthropic BAA.
2. Deploy to the BAA host with `NODE_ENV=production`, encrypted disk, backups.
3. Require 2FA; set strong admin password + kiosk code; switch alerts to PHI-free (or BAA Twilio/Resend).
4. Sign Kipu agreement; wire the Kipu connector; pilot with a few real records.
5. Complete the risk assessment + policies + training before full rollout.
