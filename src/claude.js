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
