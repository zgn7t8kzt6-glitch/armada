# Armada Care Standards

A Ritz-Carlton–style client care tool for Armada Recovery. Fill out a **Care Card**
once per client, and the app generates a **Shift Playbook** that tells each staff
member exactly what to do for each client on their shift — so every client feels
genuinely, individually cared for.

## The model

| Ritz-Carlton | Armada |
|---|---|
| Guest Preference Pad | **Client Care Card** — preferences, goals, triggers, personal touches |
| Daily Lineup | **Shift Playbook** — per-shift, per-role checklist generated automatically |
| Anticipatory service | Safety watch-items and ★ personal touches surface on every shift |

## How to use it (today)

1. Open `index.html` in any browser (double-click the file).
2. **Clients → New Client Care Card** — fill it out, add shift tasks (each tagged
   with a shift + role).
3. **Shift Playbook** — pick the shift and role, click *Build Playbook*, then
   *Print* for the shift handoff. Try **About → Load sample client** to see it.

Data is stored locally in the browser. Use **About → Export** to back up or move
data between devices.

## Status & next steps

This is a working **prototype** for one device/browser. Before real client (PHI)
use, the likely next steps are:

- **Hosted, multi-user version** with logins so staff share one live source of data.
- **HIPAA-aware hosting** (BAA, encryption, audit log) — client data shouldn't live
  only in a browser long-term.
- Shift assignment by staff member, completion check-off, and end-of-shift handoff notes.
- Optional integration with the existing EHR/EMR so Care Cards aren't double-entered.

Tell us which direction matters most and we'll build it next.
