# Armada Care Standards

A Ritz-Carlton–style client care system for Armada Recovery. Fill out a **Care
Card** once per client, and the app produces a live **Shift Playbook** telling
each staff member exactly what to do for each client on their shift — so every
client feels genuinely, individually cared for.

This is now a **multi-user web app** with logins, roles, shift assignment, task
check-off, handoff notes, and an audit log.

## The model

| Ritz-Carlton | Armada |
|---|---|
| Guest Preference Pad | **Client Care Card** — preferences, goals, triggers, personal touches |
| Daily Lineup | **Shift Playbook** — per-shift, per-role checklist, generated automatically |
| Anticipatory service | Safety watch-items + ★ personal touches surface on every shift |
| Service recovery / accountability | Live check-off, handoff notes, full audit log |

## Features

- **Logins & roles.** Admins manage clients, staff, and assignments; staff run the playbook.
- **Care Cards.** One rich profile per client (preferences, goals, triggers, ⚠ safety, support, personal touch).
- **Shift Playbook.** Pick date + shift + role → every client with the tasks for that shift, sorted with priorities first.
- **Live check-off.** Tap a task done; state is shared across all staff in real time (on refresh).
- **Handoff notes.** Per-client notes passed to the next shift.
- **Assign staff** to specific shifts; assigned names show on the playbook header.
- **Audit log.** Every view/create/update/delete of client data is recorded (admin-only) — a core HIPAA requirement.
- **Print** a clean playbook for the shift huddle.

## Run it locally

```bash
npm install
ADMIN_PASS=changeme123 npm run seed   # creates admin + sample staff/client (first run only)
npm start                             # http://localhost:3000
```

Log in as `admin` / `changeme123` (change it after first login). Sample staff:
`maria` / `staff123`, `david` / `staff123`.

Tech: Node 22 (built-in `node:sqlite`), Express, bcrypt password hashing,
HttpOnly cookie sessions. No build step.

## Architecture

```
server.js        Express API (auth, clients, playbook, completions, handoffs, assignments, users, audit)
src/db.js        node:sqlite schema + audit() helper
src/auth.js      bcrypt + DB-backed session cookies, requireAuth / requireAdmin
src/seed.js      first admin + sample data
public/          index.html · styles.css · app.js  (front-end)
data/armada.db   SQLite database (gitignored)
render.yaml      Render deployment blueprint
```

## Deploy a live pilot on Render (fake data)

This gets you a real `https://…onrender.com` URL your team can log into. **Use
made-up / de-identified clients only** until the HIPAA steps below are done.

The app auto-creates the admin account on first boot from environment variables,
so no shell access is needed.

**One-time, click-by-click:**

1. Push this branch to GitHub (already done if you're reading this in the repo).
2. Go to <https://render.com>, sign up, and click **New + → Blueprint**.
3. Connect your GitHub and select the **`armada`** repository. Render reads
   `render.yaml` automatically.
4. When prompted, enter a value for **`ADMIN_PASS`** — this becomes the admin
   login password. Pick something strong.
5. Click **Apply**. Render builds and deploys (~2–3 minutes).
6. Open the service URL. Log in as **`admin`** with the password you set.
   - The pilot comes pre-loaded with sample staff (`maria` / `staff123`,
     `david` / `staff123`) and one demo client, because `SEED_SAMPLE=true`.
   - To start empty instead, set `SEED_SAMPLE` to `false` in the Render dashboard.

**Notes**
- The blueprint uses Render's **Starter** plan ($7/mo) so a 1 GB persistent disk
  keeps your data across restarts. For a throwaway demo, change `plan` to `free`
  and remove the `disk:` block in `render.yaml` (data resets on each restart).
- `render.yaml` deploys the `claude/quirky-mendel-efkvao` branch. Change `branch:`
  if you merge to `main` later.
- Turn off the public pilot before entering any real client data.

## Going to production with real client data (PHI)

The code is **HIPAA-aware**, but compliance is organizational. Before using real
client data:

1. **Host with a signed BAA.** Use AWS / GCP / Azure (with a BAA) or a HIPAA PaaS
   like Aptible or Healthie-style infra. The host must sign a Business Associate
   Agreement.
2. **Encryption.** Serve only over HTTPS/TLS (set `NODE_ENV=production` so the
   session cookie is `Secure`). Enable encryption at rest on the database/volume.
3. **Managed Postgres.** Swap the SQLite file for managed Postgres (encrypted,
   backed up, access-controlled). The route layer is written to make this a small change.
4. **Strong auth.** Enforce strong passwords + add MFA; rotate the seed admin
   credentials immediately.
5. **Audit retention & monitoring.** The audit log is in place; ship it to durable,
   tamper-resistant storage and review access.
6. **Least privilege & training.** Keep admin accounts few; train staff on PHI handling.

Tell us which hosting path you want (AWS vs. a HIPAA PaaS) and we'll wire up the
deploy + Postgres migration next.
