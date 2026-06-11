# Armada Care Standards

A Ritz-Carlton–style client care system for Armada Recovery. Fill out a **Care
Card** once per client, and the app produces a live **Shift Playbook** telling
each staff member exactly what to do for each client on their shift — so every
client feels genuinely, individually cared for.

It is a **multi-user web app** with logins and roles, a Claude-powered AMA
(against-medical-advice) early-warning system, a retention dashboard, the full
Ritz service model (arrival, daily lineup, wow stories, fond farewell), and a
weekly leadership report.

## ► Deploy it live (one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/zgn7t8kzt6-glitch/armada)

Click the button → sign in to Render → authorize the repo → enter an
**`ADMIN_PASS`** when prompted → **Apply**. In ~3 minutes you'll have a live
`https://…onrender.com` URL. Log in as **`admin`** with that password.
(Pilot only — use fake/de-identified clients. See the HIPAA notes below before
real client data.)

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
- **✦ Draft tasks with Claude.** Claude reads a Care Card and drafts per-shift, per-role tasks for staff to review/edit. Safety items are flagged High and routed to nursing; no medical orders are invented. Requires `ANTHROPIC_API_KEY`.
- **AMA early-warning system.** A 30-second **Daily Pulse** per client (warning signs, engagement, statements). Claude turns the Care Card + pulses + handoffs into a **Ritz recap & action plan**: the underlying emotional reason, the best play to keep them, personalized "feel cared for" gestures, per-shift tasks, and how to talk with them. Auto-generates on a High-concern pulse; one click applies it to the Care Card or prints it.
- **Retention dashboard.** Every client by risk, who still needs a pulse today, and trending warning signs.
- **The Ritz bookends.** Care Cards carry a **Welcome / first-72-hours plan** (arrival) and an **Aftercare plan** (farewell); discharging a client auto-schedules **24h / 48h / 30-day aftercare calls**.
- **Lateral ownership + delight log.** Raise a concern (you own it until resolved) and log "whatever it takes" caring gestures, right from the playbook.
- **Daily Lineup.** Service Value of the day, Wow Stories, and a staff wellbeing pulse.
- **Client voice.** A "how cared for do you feel?" check-in from the client's side.
- **Outcomes dashboard.** AMA rate, completion rate, felt-care average, open concerns, delights, and upcoming sobriety milestones.
- **Weekly leadership report.** A branded summary (outcomes, wow stories, delights, concerns, aftercare) — viewable in-app, printable, and auto-emailed weekly. Requires `RESEND_API_KEY` + `REPORT_TO`.
- **Surveys.** Ritz-grade Client Experience, Meal & Food, and Discharge surveys with a results dashboard; auto-offered (Experience weekly, Discharge on discharge); scores feed Outcomes and the report.
- **Concierge & Departments.** Every client wish/need logged and routed to the right department (Front Desk, Clinical, Nursing, Kitchen, Housekeeping, Maintenance, Transport, Activities, Family, Spiritual Care), tracked to completion.
- **Program & Schedule.** The day's groups, activities, meals, outings, and appointments — facility-wide or per client.
- **Client 360 Journey.** One screen per client pulling together preferences, safety, health, goals, schedule, risk, requests, concerns, delights, pulses, and family — with an AI Care Brief for today.
- **Treatment goals** with progress, plus **health** (allergies, medications) on the Care Card.
- **AI Shift Briefing.** Claude reads the whole house and writes the shift huddle: who needs extra care, what to close out, delights to deliver, and a line for the team.
- **Print** a clean playbook, plan, report, or schedule.

## Configuration (environment variables)

All are optional except `ADMIN_PASS` in production.

| Variable | Purpose |
|---|---|
| `ADMIN_USER` / `ADMIN_PASS` | First admin account, created on boot. |
| `ANTHROPIC_API_KEY` | Enables all Claude features (task drafting + AMA action plans). [console.anthropic.com](https://console.anthropic.com) |
| `RESEND_API_KEY` | Enables emailing the weekly report. [resend.com](https://resend.com) |
| `REPORT_TO` | Comma-separated recipient emails for the weekly report. |
| `REPORT_FROM` | Optional sender (default `onboarding@resend.dev`; use a verified domain in production). |
| `REPORT_DAY` / `REPORT_HOUR` | When the weekly auto-send fires (UTC; default Monday 13:00). |
| `SEED_SAMPLE` | `true` loads a demo client/staff on first boot. |
| `ARMADA_DB` | Path to the SQLite file (default `./data/armada.db`). |

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
