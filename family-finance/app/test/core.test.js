import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate, dedupeHashes, ruleChangeEffectiveAt, LOOSEN_DELAY_MS,
  parseCsv, parseMoney, normalizeMerchant,
  mapPlaidType, plaidAmountToCents,
} from '../core.js';

// ---------- allocator ----------
test('allocator: percent of original income, in order, remainder last', () => {
  const steps = [
    { mission_id: 1, rule_kind: 'percent', amount_or_pct: 5500, sort_order: 10 }, // 55%
    { mission_id: 2, rule_kind: 'percent', amount_or_pct: 1500, sort_order: 20 }, // 15%
    { mission_id: 3, rule_kind: 'remainder', amount_or_pct: 0, sort_order: 30 },
  ];
  const { allocations, leftover } = allocate(2000000, steps); // $20,000
  assert.deepEqual(allocations, [
    { mission_id: 1, amount: 1100000 },
    { mission_id: 2, amount: 300000 },
    { mission_id: 3, amount: 600000 },
  ]);
  assert.equal(leftover, 0);
});

test('allocator: fixed caps at remaining; steps run by sort_order not array order', () => {
  const steps = [
    { mission_id: 2, rule_kind: 'fixed', amount_or_pct: 80000, sort_order: 20 },
    { mission_id: 1, rule_kind: 'fixed', amount_or_pct: 50000, sort_order: 10 },
  ];
  const { allocations, leftover } = allocate(100000, steps); // $1,000
  assert.deepEqual(allocations, [
    { mission_id: 1, amount: 50000 },
    { mission_id: 2, amount: 50000 }, // capped: only $500 left
  ]);
  assert.equal(leftover, 0);
});

test('allocator: fill_to_target stops at the gap and skips when full', () => {
  const steps = [
    { mission_id: 1, rule_kind: 'fill_to_target', amount_or_pct: 0, sort_order: 10,
      target_amount: 600000, balance: 550000 }, // gap $500
    { mission_id: 2, rule_kind: 'fill_to_target', amount_or_pct: 0, sort_order: 20,
      target_amount: 100000, balance: 100000 }, // full — skip
    { mission_id: 3, rule_kind: 'remainder', amount_or_pct: 0, sort_order: 30 },
  ];
  const { allocations } = allocate(200000, steps);
  assert.deepEqual(allocations, [
    { mission_id: 1, amount: 50000 },
    { mission_id: 3, amount: 150000 },
  ]);
});

test('allocator: no remainder step leaves leftover (surfaced to the user)', () => {
  const { allocations, leftover } = allocate(100000,
    [{ mission_id: 1, rule_kind: 'percent', amount_or_pct: 1000, sort_order: 1 }]);
  assert.deepEqual(allocations, [{ mission_id: 1, amount: 10000 }]);
  assert.equal(leftover, 90000);
});

test('allocator: zero and negative-free — never allocates more than income', () => {
  const steps = [
    { mission_id: 1, rule_kind: 'percent', amount_or_pct: 9000, sort_order: 1 },
    { mission_id: 2, rule_kind: 'percent', amount_or_pct: 9000, sort_order: 2 },
  ];
  const { allocations, leftover } = allocate(100000, steps);
  const total = allocations.reduce((s, a) => s + a.amount, 0);
  assert.equal(total + leftover, 100000);
  assert.equal(allocations[1].amount, 10000); // second 90% capped at remaining
});

// ---------- dedupe ----------
test('dedupe: same txn same hash; ±2 days collides via neighbor window', () => {
  const a = dedupeHashes(5, -18244, '2026-07-01', 'GROCERY STORE #12');
  const b = dedupeHashes(5, -18244, '2026-07-01', 'grocery store 12'); // normalized merchant
  assert.equal(a[0], b[0]);
  const c = dedupeHashes(5, -18244, '2026-07-03', 'GROCERY STORE #12');
  const overlap = a.some(h => c.includes(h));
  assert.ok(overlap, 'nearby dates should share at least one window hash');
});

test('dedupe: different account or amount never collides', () => {
  const a = dedupeHashes(5, -18244, '2026-07-01', 'X');
  const b = dedupeHashes(6, -18244, '2026-07-01', 'X');
  const c = dedupeHashes(5, -18245, '2026-07-01', 'X');
  assert.ok(!a.some(h => b.includes(h)));
  assert.ok(!a.some(h => c.includes(h)));
});

test('merchant normalization strips punctuation and case', () => {
  assert.equal(normalizeMerchant('  AMZN*Mktp US!!  '), 'amzn mktp us');
});

// ---------- rule change gate ----------
test('rule change: tighten is instant, loosen waits 72h', () => {
  const now = new Date('2026-07-19T12:00:00Z');
  assert.equal(ruleChangeEffectiveAt('tighten', now).getTime(), now.getTime());
  assert.equal(ruleChangeEffectiveAt('loosen', now).getTime(), now.getTime() + LOOSEN_DELAY_MS);
  assert.equal(LOOSEN_DELAY_MS, 72 * 3600 * 1000);
  assert.throws(() => ruleChangeEffectiveAt('sideways', now));
});

// ---------- parsing ----------
test('csv: quotes, embedded commas, CRLF, blank rows', () => {
  const rows = parseCsv('Date,Desc,Amount\r\n07/01/2026,"STORE, THE",-12.50\n\n"07/02/2026","A ""B""",3.00\n');
  assert.deepEqual(rows, [
    ['Date', 'Desc', 'Amount'],
    ['07/01/2026', 'STORE, THE', '-12.50'],
    ['07/02/2026', 'A "B"', '3.00'],
  ]);
});

test('money: formats, parens negatives, garbage rejected', () => {
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney('(45.00)'), -4500);
  assert.equal(parseMoney('-0.01'), -1);
  assert.equal(parseMoney('20000'), 2000000);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(''), null);
});

// ---------- plaid mapping ----------
test('plaid: account types map; credit/loan balances become negative', () => {
  assert.equal(mapPlaidType('depository', 'checking'), 'checking');
  assert.equal(mapPlaidType('depository', 'savings'), 'savings');
  assert.equal(mapPlaidType('credit', 'credit card'), 'credit');
  assert.equal(mapPlaidType('investment', '401k'), 'retirement');
  assert.equal(mapPlaidType('investment', 'brokerage'), 'brokerage');
  assert.equal(plaidAmountToCents(1234.56, 'checking'), 123456);
  assert.equal(plaidAmountToCents(842.19, 'credit'), -84219);
  assert.equal(plaidAmountToCents(310000, 'loan'), -31000000);
});
