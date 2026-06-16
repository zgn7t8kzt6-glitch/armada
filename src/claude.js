// Claude integration: turn a Client Care Card into specific, per-shift, per-role
// tasks — the Ritz "daily lineup", drafted automatically. Human-in-the-loop:
// staff review and edit every suggestion before it's saved.
import Anthropic from '@anthropic-ai/sdk';
import { STANDARD_PRIMER } from './standard.js';
import { getState } from './db.js';

// Every Claude feature is grounded in The Armada Standard.
const G = STANDARD_PRIMER + '\n\n';

// ── AI provider ──────────────────────────────────────────────────────────────
// AI_PROVIDER=anthropic (default) calls the Anthropic API directly (needs an
// Anthropic BAA before real PHI). AI_PROVIDER=bedrock calls Claude through AWS
// Bedrock, so the AWS BAA covers the model — no separate Anthropic BAA. Flip the
// env var once your AWS BAA is signed; nothing else changes.
const PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
// Model id. On Bedrock the id is namespaced and usually needs a region inference
// profile (e.g. us.anthropic.claude-...-v1:0) — CONFIRM the exact id available in
// your account/region in the Bedrock console and set BEDROCK_MODEL_ID.
export const MODEL = process.env.AI_MODEL || (PROVIDER === 'bedrock'
  ? (process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-opus-4-5-20251101-v1:0')
  : 'claude-opus-4-8');

// Anthropic API key resolves from the in-app setting first (Settings → AI), then
// the env var — same pattern as the email config — so an admin can connect Claude
// without server access. (Bedrock auth stays env/instance-role only.)
export function anthropicKey() { return getState('ai_anthropic_key') || process.env.ANTHROPIC_API_KEY || ''; }

// Lazily build a client for the active provider (Bedrock SDK is only imported
// when actually used, so the dependency is optional on the Anthropic path).
let _client = null;
// Drop the cached client so a newly-saved key takes effect without a restart.
export function resetAiClient() { _client = null; }
async function getClient() {
  if (_client) return _client;
  if (PROVIDER === 'bedrock') {
    const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk');
    // Read creds explicitly and TRIM them — a stray space pasted into a host's
    // env var is a classic cause of "signature does not match" (403). Passing
    // them in directly (rather than the ambient AWS chain) makes the source
    // unambiguous.
    const opts = {};
    const region = (process.env.AWS_REGION || '').trim();
    const access = (process.env.AWS_ACCESS_KEY_ID || '').trim();
    const secret = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
    const session = (process.env.AWS_SESSION_TOKEN || '').trim();
    if (region) opts.awsRegion = region;
    if (access) opts.awsAccessKey = access;
    if (secret) opts.awsSecretKey = secret;
    if (session) opts.awsSessionToken = session;
    _client = new AnthropicBedrock(opts);
  } else {
    const key = anthropicKey();
    _client = key ? new Anthropic({ apiKey: key }) : new Anthropic(); // falls back to ANTHROPIC_API_KEY
  }
  return _client;
}

export function aiProvider() { return PROVIDER; }

// Call the model with retry + backoff on throttling / transient errors — the
// batch assessment runs many in parallel and Bedrock rate-limits aggressively.
async function callAI(params, tries = 4) {
  const client = await getClient();
  let wait = 1200;
  for (let i = 0; i < tries; i++) {
    try { return await client.messages.create(params); }
    catch (e) {
      const status = e?.status || e?.statusCode;
      const msg = String(e?.message || e);
      // A DAILY token/quota cap won't clear with a short backoff — fail fast and
      // mark it so the batch can stop instead of burning more of the budget.
      if (/per day|daily|quota/i.test(msg)) { const err = new Error('Daily AI limit reached'); err.dailyLimit = true; throw err; }
      const throttled = status === 429 || status === 529 || (status >= 500 && status < 600) || /throttl|rate.?limit|too many|timeout|ECONNRESET|503|overloaded/i.test(msg);
      if (!throttled || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait + Math.random() * 600));
      wait *= 2;
    }
  }
}

// De-identification: on by default. No client names/identifiers are sent to
// Claude. Set AI_DEIDENTIFY=false only with a signed BAA covering the AI
// (the AWS BAA when AI_PROVIDER=bedrock, or an Anthropic BAA on the direct path).
export const DEID = process.env.AI_DEIDENTIFY !== 'false';
// Remove a person's name(s) from free text, replacing with a neutral token.
export function scrub(text, names = []) {
  if (!DEID || !text) return text || '';
  let out = String(text);
  for (const n of names) {
    if (!n || String(n).trim().length < 2) continue;
    out = out.replace(new RegExp(String(n).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'the client');
  }
  return out;
}

const SHIFTS = ['Morning', 'Day', 'Evening', 'Night'];
const ROLES = ['All', 'BHT / Tech', 'Nurse', 'Therapist', 'Kitchen'];

const SYSTEM = `You are a care coordinator at a residential addiction-recovery
center that follows the Ritz-Carlton service model: every client should feel
genuinely, individually cared for. You translate a client's Care Card into a
concrete shift plan — the specific things each staff role should do on each
shift so the client feels seen and stays safe.

Rules:
- Produce specific, actionable tasks a staff member can actually do on a shift.
  Good: "Bring oat-milk coffee at wake-up and ask about her daughter Mia."
  Bad: "Provide good care."
- Assign each task to the right role and shift. Personal touches and preferences
  usually go to BHT/Tech or Kitchen; clinical/observation items to Nurse;
  goal/therapy follow-ups to Therapist.
- Anything related to safety, medical watch items, or risk MUST be priority "High"
  and assigned to "Nurse" (or "All" if everyone must know).
- Do NOT invent medical orders, medications, doses, or diagnoses. Phrase clinical
  items as observations, checks, or reminders that a staff member can perform and
  that a nurse would verify. Only use what the Care Card states.
- Turn the "personal touch" into at least one warm, specific gesture.
- Keep each task to one clear action. Aim for 5-10 tasks spread across shifts.
- These are draft suggestions a human will review and edit before use.`;

const SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shift: { type: 'string', enum: SHIFTS },
          job_role: { type: 'string', enum: ROLES },
          text: { type: 'string', description: 'One specific action for this shift.' },
          priority: { type: 'string', enum: ['Normal', 'High'] },
        },
        required: ['shift', 'job_role', 'text', 'priority'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

export function claudeConfigured() {
  if (PROVIDER === 'bedrock') {
    // Configured if any AWS credential source is present; on an instance role
    // only AWS_REGION may be set, so accept that too.
    return Boolean(
      process.env.AWS_REGION || process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE || process.env.AWS_DEFAULT_REGION
    );
  }
  return Boolean(anthropicKey());
}

// Evidence-informed AMA (against-medical-advice / early dropout) warning signs.
// Seed list — the clinical team should review and tune it.
export const AMA_TRIGGERS = [
  'First 72 hours / first week',
  'Severe withdrawal or discomfort',
  'Strong cravings',
  'Conflict with a peer',
  'Conflict with staff',
  'Upsetting family call or visit',
  'Talking about leaving / asking about discharge',
  'Packing or "checked out" behavior',
  'Missing or refusing groups',
  'Withdrawn / isolating',
  'Irritable / agitated',
  'Hopeless / "this isn\'t working"',
  'Overconfident / "I\'m fine now"',
  'Poor sleep',
  'Money / legal / job worry',
  'Boredom / restlessness',
];

const AMA_SYSTEM = `You are an experienced clinical care coordinator at a
residential addiction-recovery center that follows the Ritz-Carlton service
model: every client should feel genuinely, individually cared for. Your job is
to help staff prevent AMA discharges — clients leaving Against Medical Advice
before completing treatment — by reading beneath the surface and giving the team
a warm, concrete plan to keep the client.

You will be given a client's Care Card, their recent Daily Pulse check-ins, and
recent shift handoff notes. Produce a recap and action plan.

What matters most:
- READ THE EMOTION UNDERNEATH. A client's stated complaint ("I want to go home,"
  "this isn't working," "the food is bad") is rarely the real reason. Name the
  most likely underlying emotional driver — the unmet need — grounded in what you
  know about THIS client (e.g., fear of failing, shame, grief, missing their
  child, feeling unseen, craving control, loneliness). Be specific, not generic.
- THE BEST PLAY. Recommend the single most promising way to keep this client
  right now — what one move, if the team does it well this shift, is most likely
  to turn the moment around.
- MAKE THEM FEEL CARED FOR. In the Ritz spirit, give specific, personalized
  gestures tied to this client's preferences, people, and personal touch — small
  things that say "we see you and you matter here."

Rules:
- This is decision SUPPORT for trained staff, not a diagnosis or a prediction.
  Be measured; say "most likely," never claim certainty about what a client will do.
- Ground every point in the information provided. Do not invent symptoms,
  events, medications, or diagnoses.
- Weight the first 72 hours and first week as higher-risk windows.
- DETOX SETTING: also assess WITHDRAWAL severity (use CIWA-Ar / COWS scores and
  symptoms if documented) and flag any MEDICATION concerns (refusals, side
  effects, missed doses, unmet comfort-med needs) — severe/worsening withdrawal
  and med problems are among the biggest early-AMA drivers.
- Conversation approach: calm, non-confrontational, motivational. Never use
  shame, threats, or "you'll regret it."
- WHAT WE COULD DO BETTER (the facility lens): separately capture "unmet" — what
  the client raised that WE have not adequately addressed during this stay, read
  across the note TIMELINE. The question is not "what is wrong in this person's
  life" but "are we treating and responding to them well." A symptom or request
  is only "unmet" if a later note shows it is STILL unresolved or recurring with
  no documented response from us (e.g., came in with pain AND a later note still
  reports uncontrolled pain = unmet; pain at intake that was medicated and
  resolved = NOT unmet). Their intake circumstances and history (housing, legal,
  employment, diagnosis, reasons for using) are NOT "unmet" — they are the
  starting point we serve, not a defect in our care.
- LEADERSHIP REVIEW: a Clinical Director also reviews this. From the notes only,
  capture the discharge / step-down plan (next level of care, destination,
  transportation, any anticipated date) and flag documentation that appears
  missing or late (biopsychosocial, treatment plan/ASAM, case-management note,
  recent group or individual counseling note). Only flag what is genuinely
  absent from the provided notes — never invent a gap, and never assume a
  document is missing just because these particular notes didn't include it if
  the notes are clearly a partial set; prefer the specific, defensible flag.
- If there is little signal, say risk is Low and keep everything brief.`;

const AMA_SCHEMA = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['Low', 'Elevated', 'High'] },
    summary: { type: 'string', description: 'One or two sentences: the risk and why.' },
    underlying: { type: 'string', description: 'The most likely underlying emotional reason beneath the client\'s complaints — the real unmet need, specific to this client.' },
    best_play: { type: 'string', description: 'The single most promising way to keep this client right now — one concrete recommendation the team can act on this shift.' },
    cared_for: { type: 'array', items: { type: 'string' }, description: '2-4 specific, personalized gestures that will make THIS client feel genuinely cared for (Ritz-Carlton spirit), tied to their preferences/people/personal touch.' },
    triggers: { type: 'array', items: { type: 'string' }, description: 'Specific warning signs observed.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shift: { type: 'string', enum: SHIFTS },
          job_role: { type: 'string', enum: ROLES },
          text: { type: 'string' },
        },
        required: ['shift', 'job_role', 'text'],
        additionalProperties: false,
      },
    },
    approach: { type: 'string', description: 'How to talk with this client right now.' },
    unmet: { type: 'array', items: { type: 'string' }, description: 'WHAT WE COULD DO BETTER — needs, symptoms, or requests THIS client has raised that we have NOT yet adequately addressed during this stay, judged across the note TIMELINE. Each item should be about OUR responsiveness / their experience with us, e.g. "still reports uncontrolled pain in the latest nursing note — not re-medicated", "asked twice to call family, not yet arranged", "complained the room is cold, unresolved", "missed group with no follow-up". A condition present at INTAKE counts only if a LATER note shows it persisting or recurring without a documented response from us. EXCLUDE pure intake/history facts (homelessness, legal charges, unemployment, diagnosis, why they came, substance-use history) — those are their starting circumstances, not something we failed to do. Empty array if care looks responsive and nothing is outstanding.' },
    withdrawal_level: { type: 'string', enum: ['None', 'Mild', 'Moderate', 'Severe', 'Unknown'], description: 'Detox withdrawal severity from the notes (use CIWA-Ar / COWS scores if documented).' },
    withdrawal: { type: 'string', description: 'Brief note on withdrawal status — latest CIWA/COWS score, symptoms, and whether it is worsening.' },
    med_concerns: { type: 'array', items: { type: 'string' }, description: 'Medication issues from the notes: refusals, side effects, missed doses, or unmet comfort-med needs. Empty array if none.' },
    step_down: { type: 'string', enum: ['Residential', 'PHP', 'IOP', 'Outpatient', 'Sober Living', 'Home', 'Other', 'Undecided', 'Unknown'], description: 'The next level of care / discharge destination the notes indicate is planned for this client. "Undecided" if the client has not committed; "Unknown" if nothing is documented.' },
    transport: { type: 'string', enum: ['Arranged', 'Needed', 'Unknown'], description: 'Discharge transportation status from the notes. "Needed" if a ride/transport is clearly required but not yet arranged; "Arranged" if confirmed; "Unknown" if not mentioned.' },
    anticipated_dc: { type: 'string', description: 'Anticipated discharge / transfer date if the notes mention one (plain text, e.g. "approx. June 16" or "within 2 days"). Empty string if not documented.' },
    discharge_plan: { type: 'string', description: 'One or two plain sentences summarizing this client\'s discharge / step-down plan as documented: where they are going next and the state of planning. Empty string if nothing is documented.' },
    doc_flags: { type: 'array', items: { type: 'string' }, description: 'Documentation that appears MISSING, LATE, or thin based ONLY on the notes you were given — for a Clinical Director\'s compliance review. Use short phrases such as "No biopsychosocial seen", "No treatment plan documented", "No case-management note this stay", "No group note in the last 48h", "No recent individual counseling note". Only flag what is genuinely absent from the provided notes; do NOT guess. Empty array if documentation looks complete.' },
    snapshot: { type: 'string', description: 'A warm, plain-language at-a-glance summary (3-5 sentences) anyone walking in could read to instantly know this client as a whole: who they are, why they came, how they are doing right now (withdrawal/mood/engagement), what matters most to them, and the one thing to focus on. No jargon, person-first, grounded in the notes.' },
    likes: { type: 'string', description: 'What this client LIKES and what makes them feel comfortable/cared for — foods, drinks, activities, interests, comfort items, important people — gathered from the notes. Empty string if nothing is documented.' },
    case_needs: {
      type: 'array',
      description: 'Concrete case-management needs the team should proactively help with — anticipate before the client asks. Empty array if none documented.',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['Aftercare / Housing', 'Transportation', 'Legal / Court / Parole', 'Employment', 'Education', 'Insurance / Financial', 'ID / Documents', 'Medical / Dental', 'Family / Support', 'Benefits', 'Communication', 'Other'] },
          item: { type: 'string', description: 'One specific, actionable need (e.g. "Needs ride to court hearing Thursday 9am", "Lost ID — help replace", "Wants to reconnect with daughter").' },
        },
        required: ['category', 'item'],
        additionalProperties: false,
      },
    },
  },
  required: ['level', 'summary', 'underlying', 'best_play', 'cared_for', 'triggers', 'actions', 'approach', 'unmet', 'withdrawal_level', 'withdrawal', 'med_concerns', 'step_down', 'transport', 'anticipated_dc', 'discharge_plan', 'doc_flags', 'snapshot', 'likes', 'case_needs'],
  additionalProperties: false,
};

function pulsesText(pulses = [], names = []) {
  if (!pulses.length) return 'No Daily Pulse check-ins logged yet.';
  return pulses
    .map((p) => {
      const trig = (p.triggers && p.triggers.length) ? ` | signs: ${p.triggers.join(', ')}` : '';
      const eng = p.engagement ? ` | engagement: ${p.engagement}` : '';
      const st = p.statements ? ` | said: "${scrub(p.statements, names)}"` : '';
      const note = p.note ? ` | note: ${scrub(p.note, names)}` : '';
      return `- ${p.date} ${p.shift} | concern: ${p.concern}${eng}${trig}${st}${note}`;
    })
    .join('\n');
}

// ---- Ask Armada: an AI concierge that answers staff questions from the data ----
const ASSISTANT_SYSTEM = `You are "Armada", the AI care concierge for a
residential addiction-recovery center built on the Ritz-Carlton philosophy:
every client should feel genuinely cared for and important, and so should the
staff. A staff member is asking you a question. Answer using ONLY the data
provided below the question — about the house or a specific client.

- Be warm, specific, and immediately useful. Lead with the answer.
- If asked to draft something (a family update, a note, a plan), write it ready
  to use.
- If the data doesn't contain the answer, say so plainly rather than guessing.
- Ground every claim in the provided data. Do not invent clinical facts,
  diagnoses, medications, or events. This is support for trained staff, not a
  medical or clinical directive.`;

export async function askAssistant(question, contextText) {
  const client = await getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: G + ASSISTANT_SYSTEM,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `QUESTION:\n${question}\n\n=== DATA ===\n${contextText}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---- AI Care Brief: a warm, whole-person summary + today's caring moves ----
const BRIEF_SYSTEM = `You are a Ritz-Carlton–style care coordinator at a
residential recovery center. Given everything known about ONE client, write a
short, warm brief for the staff caring for them today. The goal: help this client
feel genuinely cared for, important, and seen.
- summary: 2-4 sentences on who this person is right now and how they're doing.
- feel_cared_for: 3 specific, personalized things to do TODAY to make them feel
  cared for, tied to their preferences, people, goals, and current state.
- watch: one thing to keep an eye on (safety, mood, or retention).
Ground everything in the information provided. Do not invent facts, diagnoses, or
medications. This is support for trained staff, not a clinical directive.`;

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    feel_cared_for: { type: 'array', items: { type: 'string' } },
    watch: { type: 'string' },
  },
  required: ['summary', 'feel_cared_for', 'watch'],
  additionalProperties: false,
};

export async function generateCareBrief(contextText) {
  const client = await getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: G + BRIEF_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: BRIEF_SCHEMA } },
    messages: [{ role: 'user', content: contextText }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  const t = response.content.find((b) => b.type === 'text');
  if (!t) throw new Error('No brief returned.');
  const r = JSON.parse(t.text);
  r.feel_cared_for = r.feel_cared_for || [];
  return r;
}

// ---- AI Welcome / first-72-hour plan: generated from OUR policy, not typed ----
const WELCOME_SYSTEM = `You are the care coordinator writing the WELCOME / first-72-hour
plan for a brand-new admit at a residential addiction-detox center that runs the
Ritz-Carlton / Horst Schulze service model. Ground everything in our Standard
(above) and especially the Intake Anchor & Quiet AMA play.

The first 72 hours are the highest-risk window for leaving. Write a concrete,
warm, step-by-step arrival plan THIS team can execute, personalized to this
client from their Care Card. Cover:
- The greeting & first moments (by name, warm welcome gesture, orient them).
- Comfort & dignity right away (food/drink they like, smoking/NRT, blanket,
  belongings, dignity kit, phone call home if appropriate).
- Set the Intake Anchor: capture/repeat WHY they came in their own words; pre-brief
  "the wave" (motivation dips by morning); the clinician's "give it 24-72 hours".
- Withdrawal comfort & safety per protocol; who checks on them and when.
- Peer buddy / connection; easing first-night anxiety.
- The Quiet-AMA watch: what to do if "I feel fine, I'll finish at home" comes.

Rules: specific and actionable, person-first, no clinical fabrication, no meds
dosing. 6-10 short bullets or two tight paragraphs. This is staff guidance.`;
export async function generateWelcomePlan(careCard) {
  const response = await callAI({
    model: MODEL,
    max_tokens: 1100,
    system: G + WELCOME_SYSTEM,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Write the welcome / first-72-hour plan for this new admit.\n\n=== CARE CARD ===\n${careCardText(careCard)}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---- AI Aftercare / continuity plan: the farewell, authored from policy ----
const AFTERCARE_SYSTEM = `You are the case coordinator writing the AFTERCARE /
continuity plan for a client at a residential addiction-detox center on the
Ritz-Carlton / Horst Schulze model. Ground it in our Standard (above) and the
Safe Departure (Warm AMA) standard — continuity of care is how recovery sticks.

Using the client's Care Card and their documented step-down / discharge plan,
write a concrete continuity plan THIS team can act on:
- Next level of care / destination (use the documented next-LOC and anticipated
  date if given) and what must be arranged for it (auth, bed, transport).
- Warm handoff: who to call, appointments to set (outpatient/PHP/IOP, sponsor,
  meetings), prescriptions/MAT continuity per protocol.
- Naloxone + overdose education to go with them; food for the road; belongings
  with dignity; "you are welcome back any time".
- The follow-up call within 24-72 hours (and the second-Save if they leave AMA).
- Anything still missing for a safe, dignified discharge.

Rules: specific, person-first, no clinical fabrication or med dosing. 6-10 short
bullets. Staff guidance.`;
export async function generateAftercarePlan(careCard) {
  const extra = [
    careCard.next_loc ? `Planned next level of care: ${careCard.next_loc}` : '',
    careCard.anticipated_dc ? `Anticipated discharge date: ${careCard.anticipated_dc}` : '',
    careCard.aftercare_plan ? `Existing aftercare notes: ${scrub(careCard.aftercare_plan, [careCard.name, careCard.pref])}` : '',
  ].filter(Boolean).join('\n');
  const response = await callAI({
    model: MODEL,
    max_tokens: 1100,
    system: G + AFTERCARE_SYSTEM,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Write the aftercare / continuity plan for this client.\n\n=== CARE CARD ===\n${careCardText(careCard)}\n${extra}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---- AI Referral insights: why people leave + BD relationship read ----
const REFERRAL_SYSTEM = `You are an operations and business-development advisor for
a residential addiction-treatment center, in the Horst Schulze / Ritz-Carlton
spirit: obsessed with why guests leave and with the health of partner
relationships. You are given de-identified outbound-referral data: counts by
reason, by destination facility, by department and employee, the discharge/
transfer/declined mix, and partner reciprocity (referrals we send a partner vs.
referrals they send us). Write a tight leadership brief:
- TOP REASONS PEOPLE LEAVE OR ARE TURNED AWAY — name the biggest drivers and what
  they signal. Separate what we can FIX (service, follow-through, LOC fit,
  capacity, intake screening) from what is appropriate clinical routing.
- WHAT TO FIX THIS MONTH — 2-4 concrete, specific actions, each tied to the data.
- PARTNER RELATIONSHIPS — call out one-sided relationships (we send a lot, they
  send little, or vice versa) and where to invest or rebalance BD effort.
- WHO IS REFERRING & TO WHERE — note any concentration worth a conversation.
Be specific and grounded in the numbers provided. No PHI, no individual client
details. Short headers and bullets. This is decision support for leadership.`;

export async function generateReferralInsights(contextText) {
  const client = await getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1600,
    system: G + REFERRAL_SYSTEM,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: contextText }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---- AI Discharge debrief: learn from every departure (esp. AMA) ----
const DEBRIEF_SYSTEM = `You are conducting a retrospective discharge review at a
residential addiction-treatment center, in the Horst Schulze / Ritz-Carlton
spirit, with the mission of REDUCING AMA (against-medical-advice) departures.
Given a recently discharged client's documentation, determine what happened and
what the team can learn — so the next client like this stays.
- type: classify the discharge using ONLY the documentation — one of:
  Completed, AMA, Transferred, Administrative, Unknown.
- reason: the most likely REAL reason they left — the emotional/underlying
  driver, not just the surface complaint.
- warning_signs: signals in the notes that preceded the departure the team could
  have caught earlier.
- could_do_better: 2-4 concrete, specific things the team could have done to keep
  or better serve this client (run the Save, fix the fixable, follow through,
  the warm gesture). Constructive and systemic — never blame an individual.
- summary: one or two sentences for leadership.
Ground everything in the documentation. Do not invent. Person-first language.`;
const DEBRIEF_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['Completed', 'AMA', 'Transferred', 'Administrative', 'Unknown'] },
    reason: { type: 'string' },
    warning_signs: { type: 'array', items: { type: 'string' } },
    could_do_better: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['type', 'reason', 'warning_signs', 'could_do_better', 'summary'],
  additionalProperties: false,
};
export async function generateDischargeDebrief(careCard, notesText) {
  const client = await getClient();
  const names = [careCard.name, careCard.pref];
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1400,
    system: G + DEBRIEF_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: DEBRIEF_SCHEMA } },
    messages: [{ role: 'user', content:
      `Review this discharged client and what we could learn.\n\n=== CARE CARD ===\n${careCardText(careCard)}\n\n` +
      `=== DOCUMENTATION (this stay) ===\n${scrub(notesText || 'No documentation available.', names)}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  const t = response.content.find((b) => b.type === 'text');
  if (!t) throw new Error('No debrief returned.');
  const r = JSON.parse(t.text);
  if (!['Completed', 'AMA', 'Transferred', 'Administrative', 'Unknown'].includes(r.type)) r.type = 'Unknown';
  r.warning_signs = r.warning_signs || [];
  r.could_do_better = r.could_do_better || [];
  return r;
}

// ---- AI Outcome analytics: read LOS/AMA patterns + staff attribution ----
const OUTCOME_SYSTEM = `You are a data-driven clinical-operations advisor for a
residential addiction-treatment center. You are given de-identified aggregate
analytics: length-of-stay (LOS) and AMA (against-medical-advice) rates broken
down by day-of-week admitted, time of admit, day-of-month, and by therapist and
case manager. Write a sharp, practical leadership read:
- THE BIGGEST RISK PATTERNS — which admit timing (day/time) correlates with the
  shortest stays and highest AMA, stated carefully as correlation, not cause.
- STAFF SIGNAL — where therapist/case-manager outcomes diverge meaningfully
  (LOS, AMA, experience). Frame as "worth a supportive look / share what's
  working," never as blame; small samples are unreliable, say so.
- WHAT TO TEST THIS MONTH — 2-4 concrete operational experiments (e.g., a
  stronger first-night protocol for high-risk admit windows, pairing a struggling
  caseload with a high-retention therapist's playbook).
- DATA GAPS — note where the sample is too small or attribution is missing.
Be specific and grounded ONLY in the numbers given. Never name a client. Always
flag small samples. Short headers and bullets.`;

export async function generateOutcomeInsights(contextText) {
  const client = await getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1600,
    system: G + OUTCOME_SYSTEM,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: contextText }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---- Trending issues: cluster what clients are raising across all notes ----
const ISSUE_SYSTEM = `You are the clinical-quality / experience director at a
detox & residential recovery center, in the Ritz-Carlton spirit. You are given a
batch of DE-IDENTIFIED, in-stay observations — things clients raised that we have
NOT yet adequately addressed, plus staff check-ins.

Your job is to find WHAT WE COULD DO BETTER AS A FACILITY — the themes in how we
are caring for and responding to people RIGHT NOW. Think "are we treating them
well, is their experience with us good," not "what problems did they arrive
with."

CRITICAL — what counts and what does not:
- COUNT: unaddressed or recurring symptoms (e.g., pain still uncontrolled across
  notes), ignored or slow requests, comfort/food/environment/staff-responsiveness
  complaints, dignity and communication failures, anything that reflects on OUR
  service and that we could fix.
- DO NOT COUNT: a client's intake baseline or history — homelessness, legal
  charges, unemployment, diagnosis, family estrangement, the reasons they use, why
  they came. Those describe their starting circumstances, not a defect in our
  care. A condition present at admission is only an issue if it PERSISTS without a
  response from us.

Cluster the real issues into the TOP themes. For each: a short plain name, an
approximate mention count, a severity, ONE de-identified representative example,
and ONE concrete operational fix the team can own (fix the system, Horst-style).
Merge near-duplicates; rank by frequency × severity. If there is little signal,
return only what is real — never invent issues, and never pad the list with
intake circumstances.`;
const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    top_issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string', description: 'Short theme name, e.g. "Smoke-break timing", "Food temperature", "Feeling unheard at night".' },
          mentions: { type: 'integer', description: 'Approximate number of observations in this cluster.' },
          severity: { type: 'string', enum: ['Low', 'Medium', 'High'] },
          example: { type: 'string', description: 'One representative paraphrase, de-identified — no names.' },
          fix: { type: 'string', description: 'One concrete operational fix the team can own.' },
        },
        required: ['issue', 'mentions', 'severity', 'example', 'fix'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string', description: 'One or two sentences: the overall read for this window.' },
  },
  required: ['top_issues', 'summary'],
  additionalProperties: false,
};
export async function generateIssueDigest(lines, label) {
  if (!lines.length) return { top_issues: [], summary: '' };
  const client = await getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1400,
    system: G + ISSUE_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ISSUE_SCHEMA } },
    messages: [{ role: 'user', content: `Time window: ${label}\n\nDe-identified observations (one per line):\n${lines.join('\n')}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  const t = response.content.find((b) => b.type === 'text');
  if (!t) return { top_issues: [], summary: '' };
  const r = JSON.parse(t.text);
  r.top_issues = (r.top_issues || []).filter((i) => i && i.issue);
  r.summary = r.summary || '';
  return r;
}

// ---- AI Shift Briefing: the daily lineup for the whole house ----
const SHIFT_BRIEF_SYSTEM = `You are the care coordinator giving the shift-huddle
briefing for a residential recovery center, in the Ritz-Carlton spirit. Given the
status of the whole house, write a concise, warm briefing the charge nurse could
read aloud in two minutes:
- Who needs extra care today and why (especially retention/AMA risk).
- Open requests and concerns to close out this shift.
- 2-3 specific delights or caring moments to deliver, named to the client.
- One genuine, uplifting line for the team (Ladies and Gentlemen serving Ladies
  and Gentlemen).
Be specific and grounded in the data. Do not invent clinical facts. Use short
paragraphs or bullets. This is support for staff, not a clinical directive.`;

export async function generateShiftBriefing(contextText) {
  const client = await getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: G + SHIFT_BRIEF_SYSTEM,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: contextText }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The request was declined.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// ---- Scan a documentation note for red flags that need follow-up ----
const NOTE_SYSTEM = `You scan a documentation note about a client at a recovery
center for RED FLAGS that need staff follow-up — anything signaling the client
is unhappy, uncomfortable, bothered, mistreated, or at risk of leaving (AMA), or
any safety concern or unresolved complaint. This is NOT clinical charting — it
feeds a care/retention dashboard.
- flagged = true only if there's something a human should follow up on.
- level: None | Low | Elevated | High (High = imminent AMA talk, safety, or a
  serious unaddressed complaint).
- categories: short tags (e.g., "dissatisfaction", "wants to leave", "conflict",
  "unmet request", "withdrawal discomfort", "family stress").
- summary: one plain sentence a charge nurse can act on.
- suggested_action: one concrete, warm next step in the Armada way (fix the
  fixable, run the Save, a human goes to the client).
Ground everything in the note. Do not invent. Person-first language.`;
const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    flagged: { type: 'boolean' },
    level: { type: 'string', enum: ['None', 'Low', 'Elevated', 'High'] },
    categories: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    suggested_action: { type: 'string' },
  },
  required: ['flagged', 'level', 'categories', 'summary', 'suggested_action'],
  additionalProperties: false,
};
export async function scanNote(text, clientName) {
  const response = await callAI({
    model: MODEL,
    max_tokens: 900,
    system: G + NOTE_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: NOTE_SCHEMA } },
    messages: [{ role: 'user', content: `Client: ${DEID ? 'the client (name withheld)' : (clientName || 'unknown')}\n\nNOTE:\n${scrub(String(text).slice(0, 5000), [clientName])}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Declined.');
  const t = response.content.find((b) => b.type === 'text');
  const r = JSON.parse(t.text);
  r.categories = r.categories || [];
  return r;
}

export async function generateAmaRead(careCard, pulses = [], handoffs = []) {
  const names = [careCard.name, careCard.pref];
  const handoffText = handoffs.length
    ? handoffs.map((h) => `- ${scrub(h.note, names)}`).join('\n')
    : 'None.';

  const response = await callAI({
    model: MODEL,
    max_tokens: 4000,   // the schema is large (snapshot + several arrays + unmet); 1500 truncated the JSON
    system: G + AMA_SYSTEM,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: AMA_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          `Assess this client's AMA risk.\n\n=== CARE CARD ===\n${careCardText(careCard)}\n\n` +
          `=== RECENT DAILY PULSES (newest first) ===\n${pulsesText(pulses, names)}\n\n` +
          `=== RECENT HANDOFF NOTES ===\n${handoffText}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The request was declined. Please review the content.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No assessment returned.');
  const r = JSON.parse(textBlock.text);
  if (!['Low', 'Elevated', 'High'].includes(r.level)) r.level = 'Low';
  r.actions = (r.actions || []).filter((a) => a.text && SHIFTS.includes(a.shift) && ROLES.includes(a.job_role));
  r.triggers = r.triggers || [];
  r.cared_for = r.cared_for || [];
  r.withdrawal_level = r.withdrawal_level || 'Unknown';
  r.withdrawal = r.withdrawal || '';
  r.med_concerns = r.med_concerns || [];
  r.snapshot = r.snapshot || '';
  r.likes = r.likes || '';
  r.case_needs = (r.case_needs || []).filter((n) => n && n.item);
  r.step_down = r.step_down || 'Unknown';
  r.transport = ['Arranged', 'Needed', 'Unknown'].includes(r.transport) ? r.transport : 'Unknown';
  r.anticipated_dc = r.anticipated_dc || '';
  r.discharge_plan = r.discharge_plan || '';
  r.doc_flags = Array.isArray(r.doc_flags) ? r.doc_flags.filter((x) => x && String(x).trim()) : [];
  r.unmet = Array.isArray(r.unmet) ? r.unmet.filter((x) => x && String(x).trim()) : [];
  return r;
}

function careCardText(c) {
  const names = [c.name, c.pref];
  const v = (x) => scrub(x, names);
  const line = (label, val) => (val && String(val).trim() ? `${label}: ${v(val).trim()}\n` : '');
  return (
    (DEID ? 'Client: the client (name withheld for privacy)\n' : (line('Preferred name', c.pref) + line('Full name', c.name))) +
    line('Program / level of care', c.program) +
    line('Personal touch (what makes them feel cared for)', c.touch) +
    line('⚓ Intake Anchor — why they came (their own words)', c.anchor_why) +
    line('Preferences', c.prefs) +
    line('Goals this week', c.goals) +
    line('Triggers / handle with care', c.triggers) +
    line('Safety / sensitivities', c.safety) +
    (DEID ? '' : line('Support system', c.support))
  ) || 'No details provided.';
}

export async function generateShiftTasks(careCard) {
  const client = await getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: G + SYSTEM,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          `Draft the shift plan for this client's Care Card.\n\n` +
          careCardText(careCard),
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The request was declined. Please review the Care Card content.');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No suggestion returned.');
  const parsed = JSON.parse(textBlock.text);
  // Defensive: keep only well-formed tasks.
  return (parsed.tasks || []).filter(
    (t) => t.text && SHIFTS.includes(t.shift) && ROLES.includes(t.job_role)
  );
}

// Pre-flight check: confirms the active provider/model works AND that the
// structured-output params (output_config + json_schema) the app relies on are
// supported on this provider (the main thing to verify on Bedrock). Returns a
// plain object — never throws — so an admin can read the result.
export async function aiHealth() {
  const base = { provider: PROVIDER, model: MODEL, deidentify: DEID, configured: claudeConfigured() };
  if (PROVIDER === 'bedrock') {
    // Non-secret diagnostics: the access key id is public; we expose only the
    // LENGTH of the secret (an AWS secret is exactly 40 chars — 41 means a
    // trailing space slipped in). Helps pinpoint a 403 signature mismatch.
    base.region = (process.env.AWS_REGION || '').trim();
    base.accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
    base.secretLen = (process.env.AWS_SECRET_ACCESS_KEY || '').trim().length;
    base.secretRawLen = (process.env.AWS_SECRET_ACCESS_KEY || '').length;
  }
  // Surface the *real* reason behind a generic "Connection error" — the SDK
  // wraps the underlying network/credential failure in e.cause / e.status.
  const describe = (e) => {
    if (!e) return 'unknown error';
    const parts = [];
    if (e.name && e.name !== 'Error') parts.push(e.name);
    if (e.status) parts.push('HTTP ' + e.status);
    if (e.message) parts.push(e.message);
    const c = e.cause;
    if (c) parts.push('cause: ' + [c.code, c.name, c.message].filter(Boolean).join(' ') || String(c));
    return parts.join(' — ');
  };
  if (!base.configured) {
    return { ...base, ok: false, structuredOutput: false, error: PROVIDER === 'bedrock'
      ? 'No AWS credentials/region found (set AWS_REGION + credentials or use an instance role).'
      : 'ANTHROPIC_API_KEY is not set.' };
  }
  const schema = {
    type: 'object',
    properties: { ok: { type: 'boolean' }, word: { type: 'string' } },
    required: ['ok', 'word'], additionalProperties: false,
  };
  try {
    const client = await getClient();
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 64,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: 'Reply with ok=true and word="ready".' }],
    });
    const text = (r.content.find((b) => b.type === 'text') || {}).text || '';
    JSON.parse(text); // throws if not valid structured JSON
    return { ...base, ok: true, structuredOutput: true };
  } catch (e) {
    // A 429 proves the key authenticated — the request reached Anthropic and was
    // rate-limited, not rejected. Report it as connected-but-busy (don't retry
    // immediately; that just burns another request against the same limit).
    const status = e?.status || e?.statusCode;
    if (status === 429 || /rate.?limit|too many|429/i.test(String(e?.message || ''))) {
      return { ...base, ok: true, rateLimited: true, structuredOutput: true,
        error: 'Connected — but your Anthropic account is over its rate limit right now (HTTP 429). The key works; wait a minute and retry, or raise your usage tier / add credits at console.anthropic.com.' };
    }
    // Retry once WITHOUT output_config to tell apart "provider down" from
    // "structured outputs unsupported here" (the Bedrock risk we flagged).
    let plainOk = false, plainErr = null;
    try {
      const client = await getClient();
      const r2 = await client.messages.create({
        model: MODEL, max_tokens: 16,
        messages: [{ role: 'user', content: 'Say ready.' }],
      });
      plainOk = Boolean(r2.content.find((b) => b.type === 'text'));
    } catch (e2) { plainErr = describe(e2); }
    if (!plainOk) console.error('[aiHealth] AI call failed:', plainErr || describe(e));
    return {
      ...base, ok: plainOk, structuredOutput: false,
      error: plainOk
        ? `Connected, but structured outputs (output_config/json_schema) failed on this provider: ${describe(e)}. The app can fall back to tool-use JSON mode here.`
        : `AI call failed: ${plainErr || describe(e)}`,
    };
  }
}
