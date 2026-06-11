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

### 1. Choose a HIPAA-eligible host and sign a BAA
A **Business Associate Agreement (BAA)** is a contract where the vendor agrees to
protect PHI. Options (pick one):
- **Aptible** — purpose-built HIPAA PaaS, signs a BAA readily, easiest path. (~$300/mo)
- **AWS** (Elastic Beanstalk / ECS + RDS) — sign the AWS BAA in the console; most control.
- **Render** — HIPAA is available on their Organization/Enterprise tier with a BAA (confirm current eligibility with Render sales). The free/Starter pilot is **not** for PHI.

### 2. Sign BAAs with every vendor that touches PHI
- **Anthropic (Claude)** — required, because notes/Care Cards are sent to Claude. Request a BAA via Anthropic sales / the Trust Center. **Until signed, keep AI features on fake data only.**
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
