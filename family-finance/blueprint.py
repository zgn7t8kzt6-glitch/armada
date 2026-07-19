#!/usr/bin/env python3
"""Generates BLUEPRINT.pdf — the master plan for the Family Money HQ app.
Edit the CONTENT below, run `python3 blueprint.py`, and the PDF regenerates.

v2.0 — revised after Shlomo's review: the app optimizes the family's future,
not money. Legacy is the destination; money is the operating system under it.

NOTE: only WinAnsi-safe characters (base Helvetica). No arrows or math glyphs —
use ›, "max/min", "~".
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
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

W, H = letter
OUT = "BLUEPRINT.pdf"

# ---------------------------------------------------------------- styles
def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=10.5, leading=15, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    "cover_kicker": st("ck", fontName="Helvetica-Bold", fontSize=11, textColor=GOLD,
                        alignment=TA_CENTER),
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
        canvas.drawString(0.9 * inch, 0.55 * inch,
                          "Family Money HQ — A Family Operating System  ·  Blueprint v2.0  ·  Private")
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
                      title="Family Money HQ — Blueprint v2.0",
                      author="Shlomo & Rachel")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=on_page)])

story = []

# ================================================================ COVER
story += [
    Spacer(1, 1.9 * inch),
    Paragraph("PRIVATE &nbsp;·&nbsp; VERSION 2.0 &nbsp;·&nbsp; JULY 2026", S["cover_kicker"]),
    Spacer(1, 14),
    Paragraph("Family Money HQ", S["cover_title"]),
    Spacer(1, 8),
    Paragraph("A Family Operating System", S["cover_sub"]),
    Spacer(1, 16),
    Paragraph("The app does not optimize money. It optimizes our family's future.<br/>"
              "Money is the operating system that funds it.", S["cover_sub"]),
    Spacer(1, 24),
    HRFlowable(width=2.2 * inch, thickness=1.5, color=GOLD, hAlign="CENTER"),
    Spacer(1, 24),
    Paragraph("“It doesn't just answer: where did our money go?<br/>"
              "It answers: are we building the life we said we wanted?”", S["quote"]),
    Spacer(1, 1.1 * inch),
    Paragraph("v2.0 — revised after Shlomo's review of v1.0.<br/>"
              "Legacy is now the destination. Every dollar gets a name on it.<br/>"
              "We perfect this document first — then we build exactly what it says.",
              S["cover_sub"]),
    PageBreak(),
]

# ================================================================ 1. VISION
story += sec(1, "Vision — the six-step progression",
    "One private app where Shlomo and Rachel sign in and run the family — every "
    "account, every child, every goal, every document — with a system that makes "
    "the right thing automatic and the wrong thing hard. The end state is not a "
    "number. It is a family whose future is funded and whose values transfer with "
    "the assets.")
story.append(tbl([
    ["Step", "Stage", "What it means"],
    ["1", "Control spending", P("Guardrails, the alert ladder, self-binding rules — Section 5.", "small")],
    ["2", "Automate saving", P("The income waterfall: every dollar assigned the day it arrives — Section 6.", "small")],
    ["3", "Build wealth", P("Boring automatic investing plus the disciplined real-estate desk — Section 9.", "small")],
    ["4", "Protect wealth", P("Insurance, estate documents, the Legacy Vault, kill switches — Sections 10-11.", "small")],
    ["5", "Fund the children's future", P("A full financial life per child, tracked to 100% funded — Section 4.", "small")],
    ["6", "Transfer values, not just assets", P("The Family Constitution, annual letters, the Summit — Section 10.", "small")],
], [0.5 * inch, 2.2 * inch, 4.0 * inch]))
story += [
    Spacer(1, 6),
    P("Each step rests on the one before it. The app always shows where we are on "
      "this ladder — and the ladder, not the account balance, is the real scoreboard."),
]

# ================================================================ 2. USERS
story += sec(2, "The family — who signs in, and what they see")
story.append(tbl([
    ["Person", "Role", "What they see & do"],
    ["Shlomo", "Owner",
     P("Everything. Sets rules with Rachel. Receives guardrail alerts about his own "
       "spending. Cannot silently raise his own limits — loosening takes effect after "
       "a 72-hour delay and a note to Rachel (self-binding by design).", "small")],
    ["Rachel", "Owner",
     P("Everything, equal standing. Receives the weekly digest and any tripped "
       "guardrail alerts. Approves rule changes early (the two-key rule).", "small")],
    ["Judah", "Profile now,\nviewer later",
     P("A full financial life from day one (Section 4). When old enough: an "
       "age-appropriate view of his own goals and a savings match — money education, "
       "no account access.", "small")],
    ["Baby #2 & any\nfuture children", "Profile",
     P("A profile exists before the birth certificate does: adding a child opens the "
       "pre-arrival checklist (insurance update, new 529, estate amendment).", "small")],
    ["Advisor / CPA\n(later)", "Guest",
     P("Read-only, time-limited link to the annual report pack. No credentials, no "
       "transaction detail unless we share it.", "small")],
], [1.25 * inch, 1.0 * inch, 4.45 * inch]))
story += [
    Spacer(1, 6),
    P("<b>Sign-in:</b> email + password + two-factor (authenticator app or passkey). "
      "Every sensitive action (rule change, transfer rule, vault access, export) is "
      "logged in an audit trail both owners can read — trust through transparency."),
]

# ================================================================ 3. PILLARS
story += sec(3, "The nine pillars",
    "Everything the app does falls under one of these. If a feature idea doesn't "
    "fit a pillar, it doesn't go in. Pillar 9 is the destination the other eight "
    "exist to serve.")
pillars = [
    ("1. Connected accounts",
     "Every bank account, credit card, loan, and investment account linked through "
     "Plaid (Section 6). Balances and transactions sync several times a day; manual "
     "accounts (cash, private loans, the business draw) added by hand. One screen = "
     "the whole picture."),
    ("2. Missions — every dollar gets a job",
     "The four buckets of v1.0 grow into named Missions: money assigned to a person "
     "and a purpose (“Judah — Education”, “Emergency Fund”, “Property #1”). Income "
     "flows through the waterfall (Section 6) until nothing floats unassigned."),
    ("3. Guardrails — “keep me in check”",
     "The conscience of the app: real-time rules that watch spending and respond on "
     "a ladder — nudge › alert › cool-down › witness. Built for a compulsive "
     "spender, with dignity. Section 5."),
    ("4. Autopilot",
     "Transfers earn trust in stages: guided (we tap), bank-native rules (the app "
     "audits), app-initiated (capped + two-key). Section 6."),
    ("5. Net worth & goals",
     "The monthly scoreboard: assets minus debts, trend over time, and funding "
     "progress on every Mission. The page we open at the monthly money meeting."),
    ("6. The real-estate desk",
     "Allocation cap, a deal analyzer that forces day-one cash-flow math, and a "
     "pipeline board. Real estate is a lane, not the whole road. Section 9."),
    ("7. The Library & curriculum",
     "The books and thinkers as a guided reading plan — now including the "
     "behavioral-finance bench (Section 12) — plus a dedicated track on compulsive "
     "spending and money psychology."),
    ("8. The AI Chief Financial Officer",
     "Claude stops waiting for questions and takes on scheduled jobs: daily pulse, "
     "weekly digest, monthly close, quarterly opportunities, annual review. "
     "Section 8."),
    ("9. Family Legacy",
     "The destination. Every family member with a timeline, goals, accounts, "
     "letters, and memories; the Family Constitution; the Annual Summit; the Legacy "
     "Vault; the Family Strength Score. Net worth becomes life worth. Sections 4 "
     "and 10-11."),
]
for t, d in pillars:
    story.append(KeepTogether([Paragraph(t, S["h2"]), P(d)]))

# ================================================================ 4. LEGACY / KIDS
story += sec(4, "Pillar 9 in detail — Family Legacy",
    "Money is no longer anonymous. Every dollar has someone's name on it, and every "
    "person in the family has a financial life the app is quietly building.")
story.append(Paragraph("The family dashboard", S["h2"]))
story.append(P(
    "One screen, four panels: <b>Family</b> (a card per person — Rachel, Shlomo, "
    "Judah, Baby #2, future children), <b>Timeline</b> (what's coming, below), "
    "<b>Constitution</b> (Section 10), and <b>Vault</b> (Section 11). Each person's "
    "card holds their age and life timeline, goals, accounts, insurance coverage, "
    "estate status, education plan, investment accounts, memories, and the annual "
    "letter written to them."))
story.append(Paragraph("A full financial life per child — not one “kids fund”", S["h2"]))
story.append(P(
    "Each child gets a menu of Missions, opened over time. Every Mission carries a "
    "goal amount, current balance, projected value at the target date, funding "
    "percentage, years remaining, and one AI recommendation."))
story.append(tbl([
    ["Life stage", "Missions (per child)"],
    ["Growing up", P("Education (529 · school · camp · college · seminary/yeshiva) · "
                     "birthday fund · travel fund", "small")],
    ["Launching", P("First car · wedding · first home · business fund · "
                    "opportunity fund", "small")],
    ["Protected", P("Emergency fund · medical reserve · life insurance · "
                    "inheritance (via the trust)", "small")],
    ["Formed", P("Investment account (they watch it grow) · giving fund (they choose "
                 "where) — the two Missions that teach, not just fund", "small")],
], [1.2 * inch, 5.5 * inch]))
story.append(Spacer(1, 8))
story.append(KeepTogether([
    Paragraph("Opening a child's profile (illustrative numbers)", S["h2"]),
    tbl([
        ["Judah — Mission", "Funded", "AI recommendation"],
        ["Education", "72%", P("On pace. 529 auto-deposit continues.", "small")],
        ["First home", "41%", P("Ahead of schedule for his age — no change.", "small")],
        ["Wedding", "18%", P("Slightly behind the glide path.", "small")],
        ["Business fund", "0%", P("Not yet opened — decision D11.", "small")],
        ["All missions", "—", P("“Increase monthly deposits by ~$110 and Judah "
                                "reaches every goal by age 25.”", "small")],
    ], [1.7 * inch, 0.8 * inch, 4.2 * inch]),
]))
story.append(Spacer(1, 8))
story.append(Paragraph("The Family Timeline", S["h2"]))
story.append(P(
    "One timeline for the whole family, decades long. Every known life event is on "
    "it, and the app prepares for each one <i>before</i> it arrives — the app knows "
    "what's coming before we feel it. Rows below are the pattern; real dates get "
    "filled in at decision D12."))
story.append(tbl([
    ["When", "Event", "The app opens, months ahead"],
    ["Next year", "Baby #2 arrives",
     P("Pre-arrival checklist: hospital costs, life-insurance update, new 529, "
       "estate/trust amendment, guardianship review.", "small")],
    ["Early years", "Preschool · camp",
     P("Tuition Missions activate; monthly funding suggested from the waterfall.", "small")],
    ["Age 13", "Bar mitzvah",
     P("Celebration fund with a per-month glide path — funded years out, never "
       "financed.", "small")],
    ["Age 18+", "College / seminary",
     P("529 drawdown plan; the AI CFO re-projects every year.", "small")],
    ["Adulthood", "Wedding · first home",
     P("The long Missions everyone forgets until they're urgent. Here they're 20 "
       "years of small deposits instead.", "small")],
], [0.95 * inch, 1.75 * inch, 4.0 * inch]))

# ================================================================ 5. GUARDRAILS
story += sec(5, "The guardrail engine — designed for a compulsive spender",
    "The heart of step 1, and the reason the app exists. Built on how compulsive "
    "spending actually works: the urge is short, the regret is long, and willpower "
    "at the moment of purchase is the wrong tool. The app adds time, friction, and "
    "witness — the three things that beat impulse.")
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
    ["Cool-down", P("Three alerts in a week, or spending velocity 2x normal for "
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
    Paragraph("Design principles", S["h2"]),
    bullet("<b>Self-binding, set in calm moments.</b> Limits loosen only after a "
           "72-hour delay with Rachel's visibility; tightening is instant. Ulysses "
           "tied himself to the mast <i>before</i> he heard the sirens."),
    bullet("<b>Friction for wants, none for needs.</b> Fixed costs and groceries flow "
           "untouched. Friction concentrates only where impulse lives."),
    bullet("<b>No shame mechanics.</b> The tone is a good sponsor's tone: honest, warm, "
           "next-step focused. A blown week gets a reset button and one question: "
           "“what triggered it?” Consistency is celebrated over perfection."),
    bullet("<b>An urge journal.</b> One tap logs “I wanted to buy ___ because ___.” "
           "Over months this becomes the trigger map."),
    bullet("<b>The bigger yes.</b> Every blocked impulse shows the Mission it feeds "
           "instead — “that $1,800 is a month of Judah's education fund.” Tradeoffs "
           "are framed as future gains, never as current losses."),
    bullet("<b>Beyond the app — named honestly.</b> Compulsive spending can be a real "
           "behavioral addiction. The app links to Debtors Anonymous and to finding a "
           "therapist who works with money behaviors. Software is a tool here, not "
           "the treatment."),
]

# ================================================================ 6. WATERFALL
story += sec(6, "Every dollar gets a job — the income waterfall",
    "Income arrives; the app routes it the same day, top to bottom, until nothing "
    "floats unassigned. The order is the priority. The dashboard's proudest line "
    "is: “Every dollar has been assigned.”")
story.append(tbl([
    ["Order", "Mission", "Rule"],
    ["1", "Fixed expenses", P("Funded first, capped by R1.", "small")],
    ["2", "Emergency fund", P("Until 6 months of expenses (R4); then skipped.", "small")],
    ["3", "Retirement", P("Automatic index investing (R2).", "small")],
    ["4", "Brokerage", P("The flexible wealth engine.", "small")],
    ["5", "Real estate fund", P("Feeds the Desk, inside the R5 cap.", "small")],
    ["6", "Kids — education", P("Each child's 529 and school Missions.", "small")],
    ["7", "Kids — life funds", P("Wedding, first home, launch Missions.", "small")],
    ["8", "Vacation / simchas", P("Named, dated, guilt-free when spent.", "small")],
    ["9", "Giving / tzedakah", P("Planned like a Mission, not an afterthought (R12).", "small")],
    ["10", "Fun money", P("Protected, not just permitted (R3).", "small")],
    ["11", "Opportunity fund", P("Whatever is left. Dry powder for the deal, the "
                                 "moment, the mitzvah we didn't see coming.", "small")],
], [0.6 * inch, 1.9 * inch, 4.2 * inch]))
story += [
    Spacer(1, 8),
    Paragraph("How money actually moves — trust in three stages", S["h2"]),
    P("Honest engineering truth: an app can't and shouldn't just reach into bank "
      "accounts on day one. We earn automation in stages, each useful on its own:"),
    bullet("<b>Stage A — Guided.</b> The app computes the routing the moment income "
           "lands and sends one push notification; we tap, the bank app opens, the "
           "app verifies it happened via the transaction feed."),
    bullet("<b>Stage B — Bank-native rules.</b> Recurring transfers live inside the "
           "banks; the app is the auditor that knows every rule and alerts if one "
           "fails or quietly gets cancelled."),
    bullet("<b>Stage C — App-initiated.</b> The app moves money itself via Plaid "
           "Transfer / ACH — only between our own accounts, under per-transfer and "
           "monthly caps, per rules approved by both of us. Phase 3, only after "
           "Stages A-B have run clean for months."),
    P("<b>Bank connections (read side):</b> Plaid or equivalent. We log into each "
      "bank inside Plaid's own secure window — <b>our app never sees or stores bank "
      "passwords</b>; it holds only revocable read tokens. Same rails as Venmo and "
      "every budgeting app. Roughly $10-30/month at our scale."),
    P("<b>Raises and windfalls:</b> when income jumps, the waterfall automatically "
      "proposes saving at least half the raise <i>before</i> lifestyle expands "
      "(pay-yourself-first; Thaler's Save More Tomorrow). Lifestyle creep needs a "
      "signature, not a shrug."),
]

# ================================================================ 7. RULEBOOK
story += sec(7, "The Rulebook — the numbers the app enforces",
    "Written once, in calm, enforced by software. Draft values — we finalize them "
    "together before build. Every rule is tunable, with the 72-hour loosening delay.")
story.append(tbl([
    ["#", "Rule", "Draft value"],
    ["R1", "Fixed costs ceiling (% of take-home)", "60% max"],
    ["R2", "Automatic investing floor (% of take-home, monthly)", "15% min"],
    ["R3", "Guilt-free spending — protected, not just capped", "20-30%"],
    ["R4", "Emergency reserve target (months of expenses, high-yield savings)", "6 months"],
    ["R5", "Real-estate allocation cap (% of net worth incl. home)", "40% max"],
    ["R6", "Single-purchase alert threshold", "$500"],
    ["R7", "24-hour rule threshold / 7-day rule threshold", "$200 / $1,000"],
    ["R8", "Two-key purchases (both must approve)", "$2,500+"],
    ["R9", "Any new debt besides a mortgage", "Two-key + 7 days"],
    ["R10", "Weekly money check-in (15 min) / monthly meeting (45 min)", "Sun / 1st of month"],
    ["R11", "Rental deals must cash-flow day one (after vacancy, mgmt, upkeep)", "DSCR 1.25+"],
    ["R12", "Tzedakah / giving — a waterfall Mission, not an afterthought", "set together"],
    ["R13", "Raise rule: % of any raise saved before lifestyle expands", "50% min"],
    ["R14", "Kids' Missions funded before parents' luxuries upgrade", "always"],
    ["R15", "Every two-key decision is checked against the Constitution", "always"],
], [0.45 * inch, 4.35 * inch, 1.9 * inch]))
story.append(Spacer(1, 6))
story.append(P("The Rulebook lives on its own page in the app, signed by both of us, "
               "with a change history. Rules are the product; screens are just how we "
               "look at them.", "lead"))

# ================================================================ 8. AI CFO
story += sec(8, "The AI Chief Financial Officer",
    "Claude doesn't wait to be asked. It holds scheduled jobs with named outputs, "
    "grounded in our live numbers, the Rulebook, the Constitution, and the "
    "Library's principles. Warm, direct, zero scolding.")
story.append(tbl([
    ["Cadence", "Job", "Sounds like"],
    ["Daily", P("The pulse: yesterday vs. plan, anything drifting.", "small"),
     P("“Yesterday you spent $87 less than budget.”", "small")],
    ["Weekly", P("The digest for the Sunday check-in (R10): buckets, wins, one "
                 "question to discuss.", "small"),
     P("“Your investment rate went up this week.”", "small")],
    ["Monthly", P("The close: plan vs. actual, net worth move, Mission funding, "
                  "one recommendation.", "small"),
     P("“You are on track to retire at 53.”", "small")],
    ["Quarterly", P("Opportunities: allocation drift, cash building up, rate "
                    "changes, the Desk.", "small"),
     P("“You'll have enough cash for another rental in ~19 months.”", "small")],
    ["Annually", P("The Summit report (Section 10) and every child's re-projection.", "small"),
     P("“Judah's education fund is 8% behind — add $95/month to close it.”", "small")],
], [0.85 * inch, 3.15 * inch, 2.7 * inch]))
story.append(Spacer(1, 6))
story.append(P("The CFO also runs the Family Timeline: it opens checklists for "
               "upcoming life events months ahead, re-projects every Mission when "
               "reality drifts from plan, and drafts — never sends — anything that "
               "involves the outside world."))

# ================================================================ 9. RE DESK
story += sec(9, "The real-estate desk",
    "Real estate is a lane, not the whole road. The desk keeps it disciplined.")
story += [
    bullet("<b>Allocation gauge.</b> Live view of real estate as % of net worth "
           "against the R5 cap, on every deal screen."),
    bullet("<b>Deal analyzer.</b> Enter address, price, expected rent › the app forces "
           "the boring math: vacancy 8%, management 8-10%, maintenance/capex 10-15%, "
           "taxes, insurance, a real mortgage quote. Outputs cash-on-cash, cap rate, "
           "DSCR, and a plain verdict. <i>No deal can be marked “buy” if it fails "
           "R11.</i>"),
    bullet("<b>Pipeline board.</b> Watching › Analyzed › Offer › Owned. Every property "
           "we even glance at gets a card, so urgency-sellers get answered with data."),
    bullet("<b>Owned-property P&amp;L.</b> Each property's true annual return — "
           "compared honestly against “what if this equity were in index funds.”"),
    bullet("<b>The funding path.</b> The waterfall's real-estate Mission shows "
           "time-to-down-payment at current pace."),
]

# ================================================================ 10. CONSTITUTION & SUMMIT
story += sec(10, "The Family Constitution & the Annual Summit",
    "Step 6 of the ladder: transferring values, not just assets.")
story.append(Paragraph("The Constitution — one page, signed by both of us", S["h2"]))
story.append(P("Written together, revised only at a Summit. It answers six questions:"))
story.append(tbl([
    ["Question", "Why it matters"],
    ["What do we believe about money?",
     P("The values sentence everything else hangs from.", "small")],
    ["What do we spend freely on?",
     P("Our money dials — lavish here, guilt-free, on purpose.", "small")],
    ["What do we never finance?",
     P("The bright lines that end debates before they start.", "small")],
    ["How much risk do we take?",
     P("Sets the caps in the Rulebook (R5, R9, R11).", "small")],
    ["What does “rich” mean to us?",
     P("The definition of enough — the whole game (Housel).", "small")],
    ["What are we trying to build?",
     P("The sentence Judah reads someday and recognizes.", "small")],
], [2.5 * inch, 4.2 * inch]))
story.append(Spacer(1, 6))
story.append(P("Every two-key decision screen shows the Constitution next to the "
               "numbers (R15). The question is never only “can we afford it?” — it's "
               "“is this us?”"))
story.append(Paragraph("The Annual Family Summit", S["h2"]))
story.append(P(
    "Once a year, a real sit-down. The app auto-generates the report pack — our "
    "family's Berkshire letter: net worth and returns, spending, taxes, giving, "
    "each child's Missions and projections, estate and insurance status, real "
    "estate, goals hit and missed, lessons learned, wins, mistakes, and next "
    "year's goals. We add the human part: the annual letter to each child, and "
    "this year's family video. The Summit closes with signatures: Constitution "
    "reaffirmed or amended, Rulebook re-signed, next year's numbers set."))

# ================================================================ 11. VAULT & SCORE
story += sec(11, "The Legacy Vault & the Family Strength Score")
story.append(Paragraph("The Legacy Vault", S["h2"]))
story.append(P(
    "Encrypted storage for the documents and words that matter: wills, trusts, "
    "insurance policies, birth certificates, passports, property deeds, account "
    "inventory, passwords (via a proper password manager, referenced not copied), "
    "letters to the kids, annual videos, voice recordings. Organized so that if "
    "something happened tomorrow, Rachel — or the trustee — would know exactly "
    "where everything is. A sealed “break-glass” page prints the first-72-hours "
    "instructions; opening it is logged and alerts the other owner."))
story.append(Paragraph("The Family Strength Score", S["h2"]))
story.append(P(
    "Not a credit score — a weighted health check across ten categories. The goal "
    "is not to maximize the score; it is to surface the weakest area before it "
    "becomes a problem. The AI CFO reports the weakest category every month, with "
    "one concrete move to strengthen it."))
story.append(tbl([
    ["Category", "Weight", "Category", "Weight"],
    ["Emergency preparedness", "15%", "Insurance coverage", "10%"],
    ["Savings rate", "12%", "Debt management", "10%"],
    ["Investment consistency", "12%", "Kids' funding progress", "12%"],
    ["Estate planning", "12%", "Giving", "5%"],
    ["Spending discipline", "7%", "Long-term goal completion", "5%"],
], [2.15 * inch, 0.8 * inch, 2.15 * inch, 0.8 * inch]))
story.append(Spacer(1, 6))
story.append(P("Weights are drafts (decision D13). Estate, insurance, and kids' "
               "funding deliberately outweigh spending: a perfectly-kept budget with "
               "no will is a weak family balance sheet.", "lead"))

# ================================================================ 12. BEHAVIORAL + LIBRARY
story += sec(12, "The behavioral bench & the Library",
    "The app quietly encodes the best of behavioral finance. These are the defaults "
    "under the hood; the Library teaches us why they work.")
story += [
    bullet("<b>Default to automation</b> — willpower is not a plan (Thaler & "
           "Sunstein, <i>Nudge</i>; BJ Fogg on making the right behavior the easy one)."),
    bullet("<b>Save the raise before the lifestyle sees it</b> (Thaler's Save More "
           "Tomorrow; Rulebook R13)."),
    bullet("<b>Friction only for impulse</b> — needs flow, wants wait (Kahneman: give "
           "System 2 time to show up)."),
    bullet("<b>Frame tradeoffs as future gains, not current losses</b> — every "
           "blocked purchase shows the Mission it feeds (loss aversion, flipped)."),
    bullet("<b>Celebrate consistency, not perfection</b> — habits compound like money "
           "(James Clear, <i>Atomic Habits</i>); a blown week gets a reset, not a "
           "streak-shaped funeral."),
    bullet("<b>Identity over outcomes</b> — the app talks about who we're becoming "
           "(“a family that funds its future”), not just what we saved."),
]
story.append(Paragraph("The reading bench", S["h2"]))
story.append(P(
    "Housel (<i>The Psychology of Money</i>) · Sethi (<i>I Will Teach You to Be "
    "Rich</i>) · Collins (<i>The Simple Path to Wealth</i>) · Bogle · Perkins "
    "(<i>Die With Zero</i>) · Clason · Keller · Munger — joined by the behavioral "
    "bench: Clear (<i>Atomic Habits</i>), Thaler (<i>Nudge</i>, <i>Misbehaving</i>), "
    "Kahneman (<i>Thinking, Fast and Slow</i>), Fogg (<i>Tiny Habits</i>), Hallam "
    "(<i>Millionaire Teacher</i>), and Nick True's mapped-out cash-flow method. One "
    "book a month, together; notes live in the Library."))

# ================================================================ 13. ARCHITECTURE
story += sec(13, "Architecture, security & running cost",
    "Deliberately boring technology, matched to what already runs Armada — one "
    "person can maintain it. Fully separate from the business.")
story.append(tbl([
    ["Layer", "Choice", "Why"],
    ["Frontend", P("Server-rendered pages + light JS, installable as a phone app "
                   "(PWA) for push notifications.", "small"),
     P("Fast to build, works on both phones.", "small")],
    ["Backend", P("Node.js + Express", "small"),
     P("Same stack as Armada — shared patterns.", "small")],
    ["Database", P("PostgreSQL, encrypted at rest; nightly encrypted backups with "
                   "a tested restore.", "small"),
     P("Accounts, transactions, Missions, rules, audit log.", "small")],
    ["Vault", P("Client-side encryption for vault files; keys held by us, not the "
                "server.", "small"),
     P("The most personal data gets the strongest lock.", "small")],
    ["Bank data", P("Plaid (Transactions + Auth; Transfer in Phase 3).", "small"),
     P("No credentials ever touch our server.", "small")],
    ["AI", P("Claude API — claude-sonnet-5 as the CFO; Haiku for the transaction "
             "stream.", "small"),
     P("Scheduled jobs + coaching grounded in our data.", "small")],
    ["Notifications", P("Web push + SMS fallback (Twilio) for Witness-level alerts; "
                        "quiet hours honored (no pings on Shabbos).", "small"),
     P("Guardrails only work if they reach the phone in minutes.", "small")],
    ["Hosting", P("Render — separate account from the business. No employee ever "
                  "has access.", "small"),
     P("Personal data stays fully out of company systems.", "small")],
], [0.95 * inch, 3.35 * inch, 2.4 * inch]))
story += [
    Spacer(1, 8),
    P("<b>Security non-negotiables:</b> two-factor for both owners (passkeys "
      "preferred) · full audit log readable by both, deletable by neither · a kill "
      "switch on either phone that revokes all Plaid tokens and freezes transfers "
      "instantly · full data export (CSV/JSON) any time — the app never holds our "
      "life hostage."),
    P("<b>Running cost:</b> hosting + database ~$25-40/mo · Plaid ~$10-30/mo · "
      "Claude API ~$10-25/mo with the CFO jobs · Twilio ~$5/mo. "
      "<b>Total ~$50-100/month</b> — cheaper than one impulse purchase it prevents."),
]

# ================================================================ 14. HONESTY
story += sec(14, "What this app will not do",
    "Written down so the blueprint stays honest.")
story += [
    bullet("It will not <b>replace the professionals</b>: the estate attorney does "
           "the trust; a fee-only fiduciary reviews the big picture annually; a "
           "therapist or DA meeting addresses compulsion at the root. The app tracks "
           "that these happen — it doesn't pretend to be them."),
    bullet("It will not <b>move money it wasn't told to move</b>, ever. App-initiated "
           "transfers arrive only in Phase 3, capped and two-key approved."),
    bullet("It will not <b>pick investments or time markets.</b> The investing rule "
           "is a boring automatic index-fund transfer; the app's job is to make sure "
           "it fires."),
    bullet("It will not <b>police Rachel</b> or become surveillance in either "
           "direction. Alerts are symmetric and every monitoring feature is one both "
           "partners agreed to in writing (this document)."),
    bullet("It will not <b>turn the kids into spreadsheets.</b> Judah sees goals, "
           "growth, and a savings match — never guilt, never comparison. The "
           "Missions fund a childhood; they don't gamify it."),
]

# ================================================================ 15. PHASES
story += sec(15, "Build phases — Legacy is the destination",
    "Each phase is a complete, useful product, used for real before the next one "
    "starts. The app earns its next power by being right with the current one.")
story.append(tbl([
    ["Phase", "What ships", "We know it works when..."],
    ["1 — The Cockpit\n(~2-3 wks)",
     P("Logins + 2FA · manual accounts &amp; CSV import · Missions and plan vs. "
       "actual · net worth &amp; goals · family profiles (Judah, Baby #2) · Rulebook "
       "&amp; Constitution pages · Library · weekly digest email.", "small"),
     P("We run one full monthly money meeting inside the app, and the Constitution "
       "is signed.", "small")],
    ["2 — Live Data\n(~3-4 wks)",
     P("Plaid linking · auto-categorization · the guardrail ladder with push "
       "alerts · urge journal &amp; want-to-buy list · income detection with guided "
       "waterfall (Stage A).", "small"),
     P("An over-threshold purchase pings Shlomo's phone within minutes; a month of "
       "transactions needs under 15 minutes of fixing.", "small")],
    ["3 — Autopilot\n(~3-4 wks)",
     P("Bank-rule auditor (Stage B) › app-initiated transfers (Stage C, capped, "
       "two-key) · AI CFO daily/weekly/monthly jobs · cool-down &amp; witness "
       "automation · raise rule.", "small"),
     P("Three consecutive months of zero-touch saving with zero missed rules, and "
       "“every dollar assigned” shows green.", "small")],
    ["4 — The Desk\n(~2-3 wks)",
     P("Deal analyzer, pipeline, owned-property P&amp;L · quarterly CFO "
       "opportunities job · advisor/CPA guest reports.", "small"),
     P("First property analyzed — or rightly rejected — inside the app.", "small")],
    ["5 — The Legacy\n(~3-4 wks)",
     P("Full per-child Missions with projections &amp; glide paths · Family "
       "Timeline with event checklists · Legacy Vault · Family Strength Score · "
       "the Summit report pack · annual letters &amp; videos · kids' view.", "small"),
     P("We hold the first Annual Family Summit entirely from the app's report — "
       "and if something happened tomorrow, Rachel would know exactly where "
       "everything is.", "small")],
], [1.15 * inch, 3.2 * inch, 2.35 * inch]))

# ================================================================ 16. DECISIONS
story += sec(16, "Decisions to make before we build",
    "The blueprint is finished when every line below has an answer. This is the "
    "agenda for one sit-down between Shlomo and Rachel.")
story.append(tbl([
    ["#", "Decision", "Notes"],
    ["D1", "Final Rulebook numbers (R1-R15)", "Section 7 has drafts"],
    ["D2", "The list of accounts & cards to connect", "banks, cards, loans, brokerage"],
    ["D3", "Alert thresholds & quiet hours", "no pings on Shabbos — define the window"],
    ["D4", "Witness-level wording", "exactly what Rachel's alert says — dignity matters"],
    ["D5", "Money dials", "the 1-2 categories we spend lavishly on, guilt-free"],
    ["D6", "Waterfall order & amounts, and starting stage (A/B/C)", "Section 6"],
    ["D7", "Estate checklist owner & deadline", "who books the attorney, by when"],
    ["D8", "Outside support", "therapist / DA meeting cadence — named, scheduled"],
    ["D9", "App name & domain", "Family Money HQ is a placeholder"],
    ["D10", "Draft the Constitution's six answers", "Section 10 — the one-page version"],
    ["D11", "Each child's Mission menu & priorities", "which funds open now vs. later"],
    ["D12", "Real dates for the Family Timeline", "birthdays, school years, Baby #2"],
    ["D13", "Strength Score weights", "Section 11 has drafts"],
    ["D14", "Vault contents & break-glass person", "who besides us can ever open it"],
    ["D15", "Summit date", "same week every year — pick the anchor"],
], [0.5 * inch, 2.9 * inch, 3.3 * inch]))

story += [
    Spacer(1, 16),
    HRFlowable(width="100%", thickness=1.2, color=GOLD),
    Spacer(1, 10),
    P("<b>Next step:</b> read v2.0 together. If the six-step ladder, the waterfall "
      "order, and the per-child Missions feel right, answer the D-list and the "
      "blueprint is final. Then Phase 1 starts.", "lead"),
    Paragraph("Family Money HQ · Blueprint v2.0 · Prepared July 2026 · "
              "Education and planning document — not legal, tax, or investment advice.",
              S["small"]),
]

doc.build(story)
print(f"Wrote {OUT}")
