// Claude integration: turn a Client Care Card into specific, per-shift, per-role
// tasks — the Ritz "daily lineup", drafted automatically. Human-in-the-loop:
// staff review and edit every suggestion before it's saved.
import Anthropic from '@anthropic-ai/sdk';

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

function pulsesText(pulses = []) {
  if (!pulses.length) return 'No Daily Pulse check-ins logged yet.';
  return pulses
    .map((p) => {
      const trig = (p.triggers && p.triggers.length) ? ` | signs: ${p.triggers.join(', ')}` : '';
      const eng = p.engagement ? ` | engagement: ${p.engagement}` : '';
      const st = p.statements ? ` | said: "${p.statements}"` : '';
      const note = p.note ? ` | note: ${p.note}` : '';
      return `- ${p.date} ${p.shift} | concern: ${p.concern}${eng}${trig}${st}${note}`;
    })
    .join('\n');
}

export async function generateAmaRead(careCard, pulses = [], handoffs = []) {
  const client = new Anthropic();
  const handoffText = handoffs.length
    ? handoffs.map((h) => `- ${h.note}`).join('\n')
    : 'None.';

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1500,
    system: AMA_SYSTEM,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: AMA_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          `Assess this client's AMA risk.\n\n=== CARE CARD ===\n${careCardText(careCard)}\n\n` +
          `=== RECENT DAILY PULSES (newest first) ===\n${pulsesText(pulses)}\n\n` +
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
  const line = (label, val) => (val && val.trim() ? `${label}: ${val.trim()}\n` : '');
  return (
    line('Preferred name', c.pref) +
    line('Full name', c.name) +
    line('Program / level of care', c.program) +
    line('Personal touch (what makes them feel cared for)', c.touch) +
    line('Preferences', c.prefs) +
    line('Goals this week', c.goals) +
    line('Triggers / handle with care', c.triggers) +
    line('Safety / medical watch items', c.safety) +
    line('Support system', c.support)
  ) || 'No details provided.';
}

export async function generateShiftTasks(careCard) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2000,
    system: SYSTEM,
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
