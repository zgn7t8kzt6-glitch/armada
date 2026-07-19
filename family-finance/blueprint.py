#!/usr/bin/env python3
"""Generates BLUEPRINT.pdf — the master plan for the Family Money HQ app.
Edit the CONTENT below, run `python3 blueprint.py`, and the PDF regenerates.
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, HRFlowable,
)

GOLD = HexColor("#B07D1E")
INK = HexColor("#1D2429")
DIM = HexColor("#5D6B74")
CREAM = HexColor("#F5F2EC")
LINE = HexColor("#D9D2C2")
PANEL = HexColor("#FAF7F0")
GREEN = HexColor("#1E8E5A")
RED = HexColor("#B0383F")

W, H = letter
OUT = "BLUEPRINT.pdf"

# ---------------------------------------------------------------- styles
def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    "cover_kicker": st("ck", fontName="Helvetica-Bold", fontSize=11, textColor=GOLD,
                        alignment=TA_CENTER, tracking=2),
    "cover_title": st("ct", fontName="Helvetica-Bold", fontSize=30, leading=36,
                       alignment=TA_CENTER, textColor=INK),
    "cover_sub": st("cs", fontSize=13, leading=19, alignment=TA_CENTER, textColor=DIM),
    "h1": st("h1", fontName="Helvetica-Bold", fontSize=17, leading=21,
              textColor=INK, spaceBefore=10, spaceAfter=2),
    "h1num": st("h1n", fontName="Helvetica-Bold", fontSize=11, textColor=GOLD,
                 spaceBefore=16),
    "h2": st("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16,
              textColor=INK, spaceBefore=12, spaceAfter=3),
    "body": st("b", spaceAfter=7),
    "lead": st("lead", fontSize=11.5, leading=17, textColor=DIM, spaceAfter=9),
    "bullet": st("bl", spaceAfter=4, leftIndent=14, bulletIndent=2),
    "small": st("sm", fontSize=9, leading=13, textColor=DIM),
    "quote": st("q", fontSize=12, leading=18, textColor=DIM, leftIndent=24,
                 rightIndent=24, spaceBefore=6, spaceAfter=10),
}

def bullet(text):
    return Paragraph(text, S["bullet"], bulletText="•")

def sec(num, title, lead=None):
    out = [Paragraph(f"SECTION {num}", S["h1num"]),
           Paragraph(title, S["h1"]),
           HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=8)]
    if lead:
        out.append(Paragraph(lead, S["lead"]))
    return out

def tbl(data, widths, header=True, fontsize=9.5):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), fontsize),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [None, PANEL]),
    ]
    if header:
        style += [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, 0), (-1, 0), GOLD),
            ("LINEBELOW", (0, 0), (-1, 0), 1, GOLD),
        ]
    t.setStyle(TableStyle(style))
    return t

def P(text, style="body"):
    return Paragraph(text, S[style])

# ---------------------------------------------------------------- pages
def on_page(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(DIM)
        canvas.drawString(0.9 * inch, 0.55 * inch, "Family Money HQ — App Blueprint  ·  v1.0  ·  Private")
        canvas.drawRightString(W - 0.9 * inch, 0.55 * inch, f"Page {doc.page}")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(0.9 * inch, 0.75 * inch, W - 0.9 * inch, 0.75 * inch)
    else:
        canvas.setFillColor(CREAM)
        canvas.rect(0, 0, W, H, stroke=0, fill=1)
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(2)
        canvas.rect(0.55 * inch, 0.55 * inch, W - 1.1 * inch, H - 1.1 * inch, stroke=1, fill=0)
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=letter,
                      leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                      topMargin=0.9 * inch, bottomMargin=0.95 * inch,
                      title="Family Money HQ — App Blueprint",
                      author="Shlomo & Rachel")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=on_page)])

story = []

# ================================================================ COVER
story += [
    Spacer(1, 2.1 * inch),
    Paragraph("PRIVATE &nbsp;·&nbsp; VERSION 1.0 &nbsp;·&nbsp; JULY 2026", S["cover_kicker"]),
    Spacer(1, 14),
    Paragraph("Family Money HQ", S["cover_title"]),
    Spacer(1, 10),
    Paragraph("The blueprint for Shlomo &amp; Rachel's money operating system:<br/>"
              "every account in one place, spending with guardrails,<br/>"
              "savings on autopilot, and a plan for real estate and the kids.",
              S["cover_sub"]),
    Spacer(1, 26),
    HRFlowable(width=2.2 * inch, thickness=1.5, color=GOLD, hAlign="CENTER"),
    Spacer(1, 26),
    Paragraph("“I want to take any money that I get and do it right.<br/>"
              "I want to spend right. I want it to keep me in check.”", S["quote"]),
    Spacer(1, 1.4 * inch),
    Paragraph("This document is the whole plan. We perfect this first —<br/>"
              "then we build it exactly as written.", S["cover_sub"]),
    PageBreak(),
]

# ================================================================ 1. VISION
story += sec(1, "Vision — what this app is",
    "One private website where Shlomo and Rachel each sign in and see the family's "
    "entire financial life — every bank account, every credit card, every property, "
    "every goal — with a system that makes the right thing automatic and the wrong "
    "thing hard.")
story += [
    P("The app has <b>three jobs</b>, in priority order:"),
    bullet("<b>Keep us in check.</b> Watch every transaction, compare it to our plan, and "
           "speak up — kindly but immediately — when spending drifts. Built for a person "
           "who knows he has a compulsive relationship with spending and wants structure, "
           "not shame."),
    bullet("<b>Make saving and investing automatic.</b> Money that arrives gets routed by "
           "rules we set in calm moments — to savings, investments, and real-estate fund — "
           "before it can be spent in impulsive ones."),
    bullet("<b>Teach us as we go.</b> The best books and thinkers, built into the app as a "
           "curriculum, plus an AI coach that answers questions using <i>our</i> real numbers "
           "and <i>our</i> rulebook."),
    P("What success looks like after 12 months: every account connected and reconciled "
      "weekly; zero months where fixed costs exceed 60% of take-home; a funded 6-month "
      "emergency reserve; automatic monthly investing that never got skipped; the estate/"
      "trust checklist finished; and at most one real-estate purchase — made calmly, on "
      "our numbers, inside our allocation cap."),
]

# ================================================================ 2. USERS
story += sec(2, "Who signs in, and what they see")
story.append(tbl([
    ["Person", "Role", "What they see & do"],
    ["Shlomo", "Owner",
     P("Everything. Sets rules with Rachel. Receives guardrail alerts about his own "
       "spending. Cannot silently raise his own limits — changes take effect after a "
       "72-hour delay and a note to Rachel (self-binding by design).", "small")],
    ["Rachel", "Owner",
     P("Everything, equal standing. Receives the weekly digest and any tripped "
       "guardrail alerts. Approves rule changes early (the two-key rule).", "small")],
    ["Kids (later)", "Viewer",
     P("Optional future: age-appropriate view of their own 529 growth and a savings "
       "match — money education, no account access.", "small")],
    ["Advisor / CPA\n(later)", "Guest",
     P("Read-only, time-limited link to reports for the annual review. No credentials, "
       "no transaction detail unless we share it.", "small")],
], [1.1 * inch, 0.9 * inch, 4.7 * inch]))
story += [
    Spacer(1, 6),
    P("<b>Sign-in:</b> email + password + two-factor (authenticator app or passkey). "
      "Sessions expire. Every sensitive action (rule change, transfer rule, export) is "
      "logged in an audit trail both of us can read — trust through transparency, the "
      "same principle as the Armada audit log."),
]

# ================================================================ 3. PILLARS
story += sec(3, "The eight pillars",
    "Everything the app does falls under one of these. If a feature idea doesn't fit "
    "a pillar, it doesn't go in v1.")
pillars = [
    ("1. Connected accounts",
     "Every bank account, credit card, loan, and investment account linked through a "
     "bank-data provider (Plaid — see Section 6). Balances and transactions sync "
     "automatically several times a day. Manual accounts (cash, a private loan, the "
     "business draw) can be added by hand. One screen = the whole picture."),
    ("2. The Spending Plan engine",
     "The four buckets from the current mini-app (fixed / investments / savings / "
     "guilt-free), now fed by real transactions. Every transaction is auto-categorized "
     "into a bucket; each week the app shows bucket-by-bucket actual vs. plan. "
     "Guilt-free money is truly guilt-free — the app celebrates it, not just tolerates it."),
    ("3. Guardrails — “keep me in check”",
     "The conscience of the app. Real-time rules that watch spending velocity and "
     "unusual activity and respond on a ladder: nudge › alert › cool-down › tell Rachel. "
     "Full design in Section 4."),
    ("4. Autopilot savings & transfers",
     "Rules like “1st of month: move $X to savings” or “any deposit over $Y: route 20% "
     "to the real-estate fund.” Starts as guided transfers (the app tells us, one tap to "
     "approve), graduates to true automatic transfers once trust is earned. Design and "
     "safety rails in Section 5."),
    ("5. Net worth & goals",
     "The monthly scoreboard: assets minus debts, trend over time, progress bars for "
     "each named goal (emergency fund, next property, simchas, the kids). This is the "
     "page we open at the monthly money meeting."),
    ("6. Real-estate desk",
     "Allocation cap (target % of net worth), a deal analyzer that forces day-one "
     "cash-flow math on every prospective property, and a pipeline board (watching › "
     "analyzed › offer › owned). Section 7."),
    ("7. The Library & curriculum",
     "The eight books and their authors as a guided reading plan with notes we keep, "
     "plus short in-app lessons distilled from each (the same course engine idea as "
     "Armada's Training). Includes a dedicated track on compulsive spending and money "
     "psychology."),
    ("8. The AI coach",
     "Ask anything in plain English — “can we afford the Pesach trip?”, “how did we do "
     "this month?”, “is this duplex a good deal?” — and Claude answers grounded in our "
     "live numbers, our rulebook, and the Library's principles. It coaches in a warm, "
     "direct voice; it never scolds."),
]
for t, d in pillars:
    story.append(KeepTogether([Paragraph(t, S["h2"]), P(d)]))

# ================================================================ 4. GUARDRAILS
story += sec(4, "The guardrail engine — designed for a compulsive spender",
    "This is the heart of the app and the reason it exists. It is built on how "
    "compulsive spending actually works: the urge is short, the regret is long, and "
    "willpower at the moment of purchase is the wrong tool. So the app adds time, "
    "friction, and witness — the three things that beat impulse.")
story.append(Paragraph("The alert ladder", S["h2"]))
story.append(tbl([
    ["Level", "Trigger (draft examples)", "What happens"],
    ["Nudge", P("A guilt-free bucket reaches 70% with a week left in the month.", "small"),
     P("Quiet in-app note. No shame, just information: “$430 left in fun money — "
       "9 days to go.”", "small")],
    ["Alert", P("Single purchase over the agreed threshold (e.g. $500), or a bucket "
                "goes over 100%.", "small"),
     P("Push notification to Shlomo within minutes of the transaction posting, with "
       "a one-line “here's what this does to the month.”", "small")],
    ["Cool-down", P("Three alerts in a week, or spending velocity 2× normal for "
                    "3 days running.", "small"),
     P("The app proposes the 24-hour rule: a want-to-buy list where items must sit "
       "24h (over $200) or 7 days (over $1,000) before purchase. Tracks how many "
       "listed items we still wanted after the wait — usually few.", "small")],
    ["Witness", P("Cool-down ignored, or a single transaction over the two-key "
                  "threshold (e.g. $2,500).", "small"),
     P("Rachel gets notified — automatically, as agreed in advance, so it's the "
       "system telling her, not Shlomo confessing. Big purchases simply require "
       "both of us. That's the two-key rule.", "small")],
], [0.85 * inch, 2.7 * inch, 3.15 * inch]))
story += [
    Spacer(1, 8),
    Paragraph("Design principles for the compulsive-spending features", S["h2"]),
    bullet("<b>Self-binding, set in calm moments.</b> All limits are set (and can only be "
           "loosened) with a 72-hour delay and Rachel's visibility. Tightening is instant. "
           "Ulysses tied himself to the mast <i>before</i> he heard the sirens."),
    bullet("<b>Friction for wants, none for needs.</b> Fixed costs and groceries flow "
           "untouched. Friction concentrates only where impulse lives."),
    bullet("<b>No shame mechanics.</b> No red screens of failure, no streak-breaking guilt. "
           "The tone is a good sponsor's tone: honest, warm, next-step focused. A blown week "
           "gets a reset button and one question: “what triggered it?”"),
    bullet("<b>An urge journal.</b> One tap logs “I wanted to buy ___ because ___.” Over "
           "months this becomes the trigger map — the same pulse-and-pattern idea as "
           "Armada's AMA early-warning system, pointed at spending."),
    bullet("<b>The replacement, not just the restraint.</b> Every blocked impulse shows the "
           "goal it feeds instead: “that $1,800 is 1.2% of the next property.” Compulsion "
           "responds better to a bigger yes than a louder no."),
    bullet("<b>Beyond the app — named honestly.</b> Compulsive spending can be a real "
           "behavioral addiction. The app links to Debtors Anonymous (spender-focused "
           "meetings), and to finding a therapist who works with money behaviors. Shlomo "
           "runs a recovery organization; this app treats his own recovery lane with the "
           "same respect. Software is a tool here, not the treatment."),
]

# ================================================================ 5. AUTOPILOT
story += sec(5, "Autopilot — how money actually moves",
    "Honest engineering truth: a website cannot and should not just reach into bank "
    "accounts and move money on day one. We earn our way to automation in three stages, "
    "each fully useful on its own.")
story.append(tbl([
    ["Stage", "How transfers work", "Trust required"],
    ["A. Guided", P("The app computes the routing the moment income lands — “move "
                    "$4,000: $2,500 savings, $1,500 brokerage” — and sends a push "
                    "notification. One tap opens the bank app; we mark it done. The app "
                    "verifies it actually happened via the transaction feed.", "small"),
     P("None — we execute, app verifies.", "small")],
    ["B. Bank-native rules", P("We set the recurring transfers up inside the banks "
                               "themselves (every bank supports scheduled transfers), and "
                               "the app becomes the auditor: it knows the rules and "
                               "confirms each one ran, alerting if one fails or gets "
                               "quietly cancelled.", "small"),
     P("Low — banks move the money; app watches.", "small")],
    ["C. App-initiated", P("The app moves money itself via Plaid Transfer / ACH. "
                           "Only between our own accounts, only under per-transfer and "
                           "monthly caps, only per rules approved by both of us, with "
                           "instant reversibility notices.", "small"),
     P("High — added in Phase 3 only if Stages A–B feel limiting.", "small")],
], [1.0 * inch, 3.9 * inch, 1.8 * inch]))
story += [
    Spacer(1, 8),
    Paragraph("Bank connections (read side)", S["h2"]),
    P("We use <b>Plaid</b> (or an equivalent aggregator like MX/Finicity) for account "
      "linking. What matters to know: we log into each bank through Plaid's own secure "
      "window — <b>our app never sees or stores bank passwords</b>. Plaid hands the app "
      "read-only tokens for balances and transactions. This is the same rails used by "
      "Venmo, Chime, and every budgeting app. Costs roughly $0.30–$1.50 per connected "
      "account per month at our scale — trivial."),
    P("<b>Income detection:</b> the app recognizes deposits (salary, distributions, rent) "
      "and fires the routing rules from Stage A/B/C the same day. That is the mechanical "
      "answer to “take any money I get and do it right”: the decision was made once, in "
      "advance, together."),
]

# ================================================================ 6. RULEBOOK
story += sec(6, "The Rulebook — the numbers the app enforces",
    "These are the “insane guidelines” — written once, enforced by software. Draft "
    "values below; we finalize them together before build. The app ships with these "
    "as defaults and every one is tunable (with the 72-hour loosening delay).")
story.append(tbl([
    ["#", "Rule", "Draft value"],
    ["R1", "Fixed costs ceiling (% of take-home)", "60% max"],
    ["R2", "Automatic investing floor (% of take-home, monthly)", "15% min"],
    ["R3", "Guilt-free spending — protected, not just capped", "20–30%"],
    ["R4", "Emergency reserve target (months of expenses, high-yield savings)", "6 months"],
    ["R5", "Real-estate allocation cap (% of net worth incl. home)", "40% max"],
    ["R6", "Single-purchase alert threshold", "$500"],
    ["R7", "24-hour rule threshold / 7-day rule threshold", "$200 / $1,000"],
    ["R8", "Two-key purchases (both must approve)", "$2,500+"],
    ["R9", "Any new debt besides a mortgage", "Two-key + 7 days"],
    ["R10", "Weekly money check-in (15 min) / monthly meeting (45 min)", "Sun / 1st of month"],
    ["R11", "Rental deals must cash-flow day one (after vacancy, mgmt, upkeep)", "DSCR 1.25+"],
    ["R12", "Tzedakah / giving — planned like a bucket, not an afterthought", "set together"],
], [0.45 * inch, 4.35 * inch, 1.9 * inch]))
story.append(Spacer(1, 6))
story.append(P("The rulebook lives on its own page in the app, signed by both of us, "
               "with a change history. Rules are the product; screens are just how we "
               "look at them.", "lead"))

# ================================================================ 7. REAL ESTATE
story += sec(7, "The real-estate desk",
    "Real estate is a lane, not the whole road. The desk keeps it disciplined.")
story += [
    bullet("<b>Allocation gauge.</b> Live view of real estate as % of net worth against the "
           "R5 cap — the same calculator as the mini-app, now fed by real balances. When "
           "we're at cap, the desk says so on every deal screen."),
    bullet("<b>Deal analyzer.</b> Enter address, price, expected rent › the app forces the "
           "boring math: vacancy 8%, management 8–10%, maintenance/capex 10–15%, taxes, "
           "insurance, real mortgage quote. Outputs cash-on-cash return, cap rate, DSCR, "
           "and a plain verdict. <i>No deal can be marked “buy” if it fails R11.</i>"),
    bullet("<b>Pipeline board.</b> Watching › Analyzed › Offer › Owned. Every property we "
           "even glance at gets a card, so urgency-sellers can be answered with data."),
    bullet("<b>Owned-property P&amp;L.</b> Each property's rent, expenses, equity, and true "
           "annual return — compared honestly against “what if this equity were in index "
           "funds instead.”"),
    bullet("<b>The funding path.</b> A named goal (“Property #1 fund”) that the autopilot "
           "feeds monthly. The desk shows time-to-down-payment at current pace."),
]

# ================================================================ 8. ARCHITECTURE
story += sec(8, "Architecture & stack",
    "Deliberately boring technology, matched to what already runs Armada — so one "
    "person can maintain it.")
story.append(tbl([
    ["Layer", "Choice", "Why"],
    ["Frontend", P("Server-rendered pages + light JS (same pattern as Armada), installable "
                   "as a phone app (PWA) for push notifications.", "small"),
     P("Fast to build, easy to change, works on both phones.", "small")],
    ["Backend", P("Node.js + Express", "small"),
     P("Same stack as Armada — shared skills, shared patterns.", "small")],
    ["Database", P("PostgreSQL (encrypted at rest)", "small"),
     P("Real relational data: accounts, transactions, rules, audit log.", "small")],
    ["Bank data", P("Plaid (Transactions + Auth; Transfer in Phase 3)", "small"),
     P("Industry standard; no credentials touch our server.", "small")],
    ["AI", P("Claude API (claude-sonnet-5 for the coach; Haiku for auto-categorization)",
             "small"),
     P("Coach answers grounded in our data + Rulebook; cheap fast model for the "
       "transaction stream.", "small")],
    ["Notifications", P("Web push + SMS fallback (Twilio) for Witness-level alerts.", "small"),
     P("Guardrails only work if they reach the phone in minutes.", "small")],
    ["Hosting", P("Render (same as Armada) — separate account/project from the business.",
                  "small"),
     P("One-click deploys; personal data stays fully out of the company's systems.", "small")],
], [0.95 * inch, 3.35 * inch, 2.4 * inch]))
story += [
    Spacer(1, 8),
    Paragraph("Running cost estimate", S["h2"]),
    P("Hosting + database ~ $25–40/mo · Plaid ~ $10–30/mo (10–20 accounts) · Claude API "
      "~ $5–20/mo at personal volume · Twilio ~ $5/mo. <b>Total ~ $50–100/month.</b> "
      "Cheaper than one impulse purchase it prevents."),
]

# ================================================================ 9. SECURITY
story += sec(9, "Security & privacy — non-negotiables")
story += [
    bullet("<b>This is not part of the Armada app.</b> Separate codebase, separate "
           "database, separate hosting account. No employee, ever, has access."),
    bullet("<b>No bank credentials on our server.</b> Bank logins happen inside Plaid's "
           "window; we store only revocable tokens."),
    bullet("<b>Two-factor for both users; passkeys preferred.</b> Password resets require "
           "the second factor."),
    bullet("<b>Encryption</b> in transit (TLS) and at rest (database + backups). Nightly "
           "encrypted backups with a tested restore."),
    bullet("<b>Full audit log</b> of every login, rule change, and export — readable by "
           "both of us, deletable by neither."),
    bullet("<b>Kill switch.</b> One button revokes all Plaid tokens and freezes transfers "
           "instantly, from either phone."),
    bullet("<b>The AI coach sees numbers, not credentials,</b> and its conversations stay "
           "in our database."),
]

# ================================================================ 10. HONESTY
story += sec(10, "What this app will not do",
    "Written down so the blueprint stays honest.")
story += [
    bullet("It will not <b>replace the professionals</b>: the estate attorney does the "
           "trust; a fee-only fiduciary reviews the big picture annually; a therapist or "
           "DA meeting addresses compulsion at the root. The app tracks that these "
           "happen — it doesn't pretend to be them."),
    bullet("It will not <b>move money it wasn't told to move</b>, ever, and app-initiated "
           "transfers arrive only in Phase 3, capped and two-key approved."),
    bullet("It will not <b>pick investments or time markets.</b> The investing rule is a "
           "boring automatic index-fund transfer; the app's job is to make sure it fires."),
    bullet("It will not <b>police Rachel</b>, or become a surveillance tool in either "
           "direction. Guardrails apply to the plan, alerts are symmetric, and every "
           "monitoring feature is one both partners agreed to in writing (this document)."),
    bullet("It will not <b>hold this data hostage</b> — full export (CSV/JSON) any time."),
]

# ================================================================ 11. PHASES
story += sec(11, "Build phases",
    "Each phase is a complete, useful product. We use each one for real before "
    "building the next — the app earns its next power by being right with the "
    "current one.")
story.append(tbl([
    ["Phase", "What ships", "We know it works when…"],
    ["1 — The Cockpit\n(~2–3 wks)",
     P("Logins for two + 2FA · manual accounts &amp; CSV import · four-bucket plan vs. "
       "actual · net worth &amp; goals · Rulebook page · Library · weekly digest email.",
       "small"),
     P("We run one full monthly money meeting entirely inside the app.", "small")],
    ["2 — Live Data\n(~3–4 wks)",
     P("Plaid linking for all accounts · auto-categorization (Claude) · real-time "
       "guardrail ladder with push alerts · urge journal &amp; want-to-buy list · "
       "income detection with guided routing (Stage A).", "small"),
     P("An over-threshold purchase pings Shlomo's phone within minutes; a month of "
       "transactions needs under 15 minutes of manual fixing.", "small")],
    ["3 — Autopilot\n(~3–4 wks)",
     P("Bank-rule auditor (Stage B) · then app-initiated transfers (Stage C) with caps "
       "+ two-key · AI coach over live data · cool-down &amp; witness automation.", "small"),
     P("Three consecutive months where saving/investing happened with zero manual "
       "steps and zero missed rules.", "small")],
    ["4 — The Desk\n(~2–3 wks)",
     P("Real-estate deal analyzer, pipeline, owned-property P&amp;L · annual report "
       "pack for the advisor/CPA · kids' view.", "small"),
     P("First property analyzed — or rightly rejected — inside the app.", "small")],
], [1.15 * inch, 3.2 * inch, 2.35 * inch]))

# ================================================================ 12. DECISIONS
story += sec(12, "Decisions to make before we build",
    "The blueprint is finished when every line below has an answer. This is the "
    "agenda for one sit-down between Shlomo and Rachel.")
story.append(tbl([
    ["#", "Decision", "Notes"],
    ["D1", "Final Rulebook numbers (R1–R12)", "Section 6 has drafts"],
    ["D2", "The list of accounts & cards to connect", "banks, cards, loans, brokerage"],
    ["D3", "Alert thresholds & quiet hours", "e.g. no pings on Shabbos — define the window"],
    ["D4", "Witness-level wording", "exactly what Rachel's alert says — dignity matters"],
    ["D5", "Money dials", "the 1–2 categories we spend lavishly on, guilt-free"],
    ["D6", "Auto-transfer amounts & dates", "and which stage (A/B/C) we start at"],
    ["D7", "Estate checklist owner & deadline", "who books the attorney, by when"],
    ["D8", "Outside support", "therapist / DA meeting cadence — named, scheduled"],
    ["D9", "App name & domain", "Family Money HQ is a placeholder"],
    ["D10", "What the kids see, and when", "Phase 4"],
], [0.5 * inch, 2.9 * inch, 3.3 * inch]))

story += [
    Spacer(1, 16),
    HRFlowable(width="100%", thickness=1.2, color=GOLD),
    Spacer(1, 10),
    P("<b>Next step:</b> read this together at the first weekly check-in. Mark up "
      "anything wrong or missing — especially Sections 4 and 6 — and the blueprint "
      "gets revised until it's exactly right. Then Phase 1 starts.", "lead"),
    Paragraph("Family Money HQ · Blueprint v1.0 · Prepared July 2026 · "
              "Education and planning document — not legal, tax, or investment advice.",
              S["small"]),
]

doc.build(story)
print(f"Wrote {OUT}")
