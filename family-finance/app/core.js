// Pure functions — unit tested before any UI polish (SPEC-PHASE1.md section 8).
import { createHash } from 'node:crypto';

/**
 * The waterfall allocator (spec 6.1-6.2). Routes an income amount (cents)
 * through ordered steps. Step kinds:
 *   fixed          - allocate min(amount_or_pct, remaining)
 *   percent        - allocate floor(income * bp / 10000), capped at remaining
 *   fill_to_target - allocate up to (target - balance), capped at remaining
 *   remainder      - allocate everything left
 * Returns { allocations: [{mission_id, amount}], leftover }.
 * Percent is computed on the ORIGINAL income, not the remainder, so profiles
 * read the way humans write them ("10% of the check").
 */
export function allocate(incomeCents, steps) {
  let remaining = incomeCents;
  const allocations = [];
  const ordered = [...steps].sort((a, b) => a.sort_order - b.sort_order);
  for (const s of ordered) {
    if (remaining <= 0) break;
    let amt = 0;
    if (s.rule_kind === 'fixed') amt = Math.min(Number(s.amount_or_pct), remaining);
    else if (s.rule_kind === 'percent') amt = Math.min(Math.floor(incomeCents * Number(s.amount_or_pct) / 10000), remaining);
    else if (s.rule_kind === 'fill_to_target') {
      const gap = Math.max(0, Number(s.target_amount ?? 0) - Number(s.balance ?? 0));
      amt = Math.min(gap, Number(s.amount_or_pct) > 0 ? Math.min(Number(s.amount_or_pct), gap) : gap, remaining);
    } else if (s.rule_kind === 'remainder') amt = remaining;
    if (amt > 0) { allocations.push({ mission_id: s.mission_id, amount: amt }); remaining -= amt; }
  }
  return { allocations, leftover: remaining };
}

/**
 * Dedupe hash (spec 6.5): f(account, amount, date bucketed to 3-day window,
 * normalized merchant). Two candidate hashes per txn (its window and the
 * neighboring one) so +/-3-day pairs collide in at least one.
 */
export function normalizeMerchant(m) {
  return String(m || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function dedupeHashes(accountId, amountCents, isoDate, merchant) {
  const day = Math.floor(Date.parse(isoDate + 'T00:00:00Z') / 86400000);
  const win = Math.floor(day / 3);
  const mk = w => createHash('sha256')
    .update(`${accountId}|${amountCents}|${w}|${normalizeMerchant(merchant)}`)
    .digest('hex').slice(0, 24);
  return [mk(win), mk(win + 1)];
}

/**
 * Rule-change gate (spec: tighten instant, loosen +72h).
 * Returns the effective timestamp for a proposed change.
 */
export const LOOSEN_DELAY_MS = 72 * 3600 * 1000;
export function ruleChangeEffectiveAt(direction, now = new Date()) {
  if (direction !== 'tighten' && direction !== 'loosen') throw new Error('direction must be tighten|loosen');
  return direction === 'tighten' ? new Date(now) : new Date(now.getTime() + LOOSEN_DELAY_MS);
}

/** Minimal CSV parser: handles quotes, commas, CRLF. Returns array of rows. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

/** "1,234.56" | "$1,234.56" | "(45.00)" -> cents (negative for parens). */
export function parseMoney(s) {
  let t = String(s || '').trim().replace(/[$,\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [d, c = ''] = t.split('.');
  const cents = (parseInt(d || '0', 10) * 100) + parseInt((c + '00').slice(0, 2), 10);
  return neg ? -cents : cents;
}

export const fmtMoney = cents => {
  const v = Number(cents || 0), a = Math.abs(v);
  return (v < 0 ? '-$' : '$') + (a / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
