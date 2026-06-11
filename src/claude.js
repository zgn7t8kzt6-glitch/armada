// Claude integration: turn a Client Care Card into specific, per-shift, per-role
// tasks — the Ritz "daily lineup", drafted automatically. Human-in-the-loop:
// staff review and edit every suggestion before it's saved.
import Anthropic from '@anthropic-ai/sdk';
import { STANDARD_PRIMER } from './standard.js';

// Every Claude feature is grounded in The Armada Standard.
const G = STANDARD_PRIMER + '\n\n';

// De-identification: on by default. No client names/identifiers are sent to
// Claude. Set AI_DEIDENTIFY=false only if you hold a signed Anthropic BAA.
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
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
- Conversation approach: calm, non-confrontational, motivational. Never use
  shame, threats, or "you'll regret it."
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
  },
  required: ['level', 'summary', 'underlying', 'best_play', 'cared_for', 'triggers', 'actions', 'approach'],
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
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
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
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
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
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
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
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 700,
    system: G + NOTE_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: NOTE_SCHEMA } },
    messages: [{ role: 'user', content: `Client: ${DEID ? 'the client (name withheld)' : (clientName || 'unknown')}\n\nNOTE:\n${scrub(text, [clientName])}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Declined.');
  const t = response.content.find((b) => b.type === 'text');
  const r = JSON.parse(t.text);
  r.categories = r.categories || [];
  return r;
}

export async function generateAmaRead(careCard, pulses = [], handoffs = []) {
  const client = new Anthropic();
  const names = [careCard.name, careCard.pref];
  const handoffText = handoffs.length
    ? handoffs.map((h) => `- ${scrub(h.note, names)}`).join('\n')
    : 'None.';

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1500,
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
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
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
