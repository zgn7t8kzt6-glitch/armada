// Idempotent seed: Rulebook R1-R15, Constitution questions, Library, family
// profiles, default Goals + waterfall. Safe to run repeatedly.
import { q, migrate, pool } from './db.js';

const RULES = [
  ['R1',  'Fixed costs ceiling (% of take-home)', '60% max'],
  ['R2',  'Automatic investing floor (% of take-home, monthly)', '15% min'],
  ['R3',  'Guilt-free spending — protected, not just capped', '20-30%'],
  ['R4',  'Emergency reserve target (months of expenses, high-yield savings)', '6 months'],
  ['R5',  'Real-estate allocation cap (% of net worth incl. home)', '40% max'],
  ['R6',  'Single-purchase alert threshold', '$500'],
  ['R7',  '24-hour rule threshold / 7-day rule threshold', '$200 / $1,000'],
  ['R8',  'Two-key purchases (both must approve)', '$2,500+'],
  ['R9',  'Any new debt besides a mortgage', 'Two-key + 7 days'],
  ['R10', 'Weekly money check-in (15 min) / monthly meeting (45 min)', 'Sun / 1st of month'],
  ['R11', 'Rental deals must cash-flow day one (after vacancy, mgmt, upkeep)', 'DSCR 1.25+'],
  ['R12', 'Tzedakah / giving — a waterfall Goal, not an afterthought', 'set together'],
  ['R13', 'Raise rule: % of any raise saved before lifestyle expands', '50% min'],
  ['R14', "Kids' Goals funded before parents' luxuries upgrade", 'always'],
  ['R15', 'Every two-key decision runs through the Decision Engine', 'always'],
];

const QUESTIONS = [
  'What do we believe about money?',
  'What do we spend freely on?',
  'What do we never finance?',
  'How much risk do we take?',
  'What does "rich" mean to us?',
  'What are we trying to build?',
];

const BOOKS = [
  ['The Psychology of Money', 'Morgan Housel', 'Start here. Behavior beats spreadsheets; "enough" is the whole game.'],
  ['I Will Teach You to Be Rich', 'Ramit Sethi', 'The system behind the Spending Plan. Automation + guilt-free spending.'],
  ['The Simple Path to Wealth', 'JL Collins', 'Investing solved: low-cost index funds, keep buying, never panic-sell.'],
  ['The Little Book of Common Sense Investing', 'John C. Bogle', 'From the inventor of the index fund. Costs are everything.'],
  ['Die With Zero', 'Bill Perkins', 'How to spend: memories, experiences, giving with a warm hand.'],
  ['Atomic Habits', 'James Clear', 'Habits compound like money. Consistency over perfection.'],
  ['Nudge', 'Richard Thaler & Cass Sunstein', 'Defaults decide. Design the environment, not the willpower.'],
  ['Thinking, Fast and Slow', 'Daniel Kahneman', 'Why the urge is System 1 and the plan is System 2.'],
  ['The Millionaire Real Estate Investor', 'Gary Keller', 'The models-and-numbers discipline for the Desk.'],
  ['The Richest Man in Babylon', 'George S. Clason', 'Short, ancient, timeless: pay yourself first.'],
  ['Tiny Habits', 'BJ Fogg', 'Make the right behavior the easy one.'],
  ["Poor Charlie's Almanack", 'Charlie Munger', 'The wisdom layer. Read last, reread forever.'],
];

// name, bucket, sort_order in waterfall — the Blueprint section 6 order
const DEFAULT_GOALS = [
  ['Fixed expenses',    'fixed',  10],
  ['Emergency fund',    'save',   20],
  ['Retirement',        'invest', 30],
  ['Brokerage',         'invest', 40],
  ['Real estate fund',  'save',   50],
  ['Kids — education',  'save',   60],
  ['Kids — life funds', 'save',   70],
  ['Vacation / simchas','fun',    80],
  ['Giving / tzedakah', 'give',   90],
  ['Fun money',         'fun',   100],
  ['Opportunity fund',  'save',  110],
];

export async function seed() {
  for (const [code, title, value] of RULES) {
    await q(`INSERT INTO rules (code, title, value_text) VALUES ($1,$2,$3)
             ON CONFLICT (code) DO NOTHING`, [code, title, value]);
  }
  for (let i = 0; i < QUESTIONS.length; i++) {
    const exists = await q('SELECT 1 FROM constitution WHERE question = $1', [QUESTIONS[i]]);
    if (!exists.rows.length)
      await q('INSERT INTO constitution (question, sort_order) VALUES ($1,$2)', [QUESTIONS[i], i + 1]);
  }
  for (let i = 0; i < BOOKS.length; i++) {
    const [title, author, blurb] = BOOKS[i];
    const exists = await q('SELECT 1 FROM books WHERE title = $1', [title]);
    if (!exists.rows.length)
      await q('INSERT INTO books (title, author, blurb, sort_order) VALUES ($1,$2,$3,$4)',
              [title, author, blurb, i + 1]);
  }
  for (const name of ['Judah', 'Baby #2']) {
    const exists = await q('SELECT 1 FROM people WHERE name = $1', [name]);
    if (!exists.rows.length)
      await q('INSERT INTO people (name, kind) VALUES ($1,$2)',
              [name, name === 'Judah' ? 'child' : 'future']);
  }
  const goals = await q('SELECT count(*) c FROM missions');
  if (Number(goals.rows[0].c) === 0) {
    const prof = await q(`INSERT INTO waterfall_profiles (name) VALUES ('Standard') RETURNING id`);
    for (const [name, bucket, order] of DEFAULT_GOALS) {
      const m = await q(
        'INSERT INTO missions (name, bucket, sort_order) VALUES ($1,$2,$3) RETURNING id',
        [name, bucket, order]);
      const kind = name === 'Opportunity fund' ? 'remainder' : 'percent';
      // draft split (basis points) — owners tune on the Goals page (D6)
      const bp = { 'Fixed expenses': 5500, 'Emergency fund': 500, 'Retirement': 1000,
                   'Brokerage': 500, 'Real estate fund': 500, 'Kids — education': 400,
                   'Kids — life funds': 300, 'Vacation / simchas': 300,
                   'Giving / tzedakah': 500, 'Fun money': 500 }[name] ?? 0;
      await q(`INSERT INTO waterfall_steps (profile_id, mission_id, rule_kind, amount_or_pct, sort_order)
               VALUES ($1,$2,$3,$4,$5)`, [prof.rows[0].id, m.rows[0].id, kind, bp, order]);
    }
    const src = await q('SELECT count(*) c FROM income_sources');
    if (Number(src.rows[0].c) === 0)
      await q(`INSERT INTO income_sources (name, kind, waterfall_profile_id)
               VALUES ('Primary income', 'salary', $1)`, [prof.rows[0].id]);
  }
  console.log('seeded');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(seed).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}
