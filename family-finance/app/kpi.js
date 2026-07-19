// K1-K7 (SPEC-PHASE1.md section 1), computed live from the database.
import { q } from './db.js';

const moneyFromRule = t => {
  const m = String(t || '').replace(/,/g, '').match(/\$?(\d+)/);
  return m ? Number(m[1]) * 100 : 250000;
};

export async function computeKpis() {
  const kpis = [];

  // K1 weekly active use — check-ins completed by both, last 52 weeks
  const k1 = await q(`SELECT count(*) c FROM checkins
    WHERE kind='weekly' AND completed_by_1 IS NOT NULL AND completed_by_2 IS NOT NULL
      AND week_of > CURRENT_DATE - interval '52 weeks'`);
  const firstUser = await q('SELECT min(created_at) t FROM users');
  const weeksLive = firstUser.rows[0].t
    ? Math.max(1, Math.min(52, Math.ceil((Date.now() - new Date(firstUser.rows[0].t)) / (7 * 86400000))))
    : 1;
  kpis.push({ code: 'K1', name: 'Weekly check-ins (both of us)',
    value: `${k1.rows[0].c} of ${weeksLive} wk`, target: '45 of 52',
    ok: Number(k1.rows[0].c) >= Math.min(45, Math.floor(weeksLive * 45 / 52)) });

  // K2 income assigned within 48h
  const k2 = await q(`SELECT count(*) total,
      count(*) FILTER (WHERE assigned_at IS NOT NULL AND assigned_at <= logged_at + interval '48 hours') ok
    FROM income_events`);
  const { total, ok } = k2.rows[0];
  const pct = Number(total) ? Math.round(Number(ok) / Number(total) * 100) : null;
  kpis.push({ code: 'K2', name: 'Income assigned within 48h',
    value: pct === null ? 'no income yet' : pct + '%', target: '95%+',
    ok: pct === null || pct >= 95 });

  // K3 engine coverage of two-key-size spends (quarter)
  const thr = moneyFromRule((await q(`SELECT value_text FROM rules WHERE code='R8'`)).rows[0]?.value_text);
  const bigSpends = await q(`SELECT count(*) c FROM transactions
    WHERE amount <= $1 AND status='ok' AND occurred_on > CURRENT_DATE - interval '90 days'`, [-thr]);
  const engineRuns = await q(`SELECT count(*) c FROM decisions
    WHERE created_at > now() - interval '90 days' AND (amount IS NULL OR amount >= $1)`, [thr]);
  const bs = Number(bigSpends.rows[0].c), er = Number(engineRuns.rows[0].c);
  kpis.push({ code: 'K3', name: `Two-key spends with an Engine run (90d)`,
    value: bs === 0 ? 'no large spends' : `${Math.min(er, bs)}/${bs}`, target: '100%',
    ok: bs === 0 || er >= bs });

  // K4 — Phase 2 (want-to-buy list ships with guardrails)
  kpis.push({ code: 'K4', name: 'Want-to-buy conversion', value: 'Phase 2', target: '<40%', ok: null });

  // K5 engine runs this month
  const k5 = await q(`SELECT count(*) c FROM decisions
    WHERE created_at >= date_trunc('month', now())`);
  kpis.push({ code: 'K5', name: 'Decision Engine runs this month',
    value: String(k5.rows[0].c), target: '1+', ok: Number(k5.rows[0].c) >= 1 });

  // K6 consecutive monthly closes
  const closes = await q(`SELECT week_of FROM checkins WHERE kind='monthly'
    AND completed_by_1 IS NOT NULL AND completed_by_2 IS NOT NULL ORDER BY week_of DESC`);
  let streak = 0, cursor = new Date();
  cursor.setDate(1);
  for (const r of closes.rows) {
    const d = new Date(r.week_of);
    const diff = (cursor.getFullYear() - d.getFullYear()) * 12 + (cursor.getMonth() - d.getMonth());
    if (diff === streak || diff === streak + 1) { streak++; } else break;
  }
  kpis.push({ code: 'K6', name: 'Consecutive monthly closes',
    value: String(streak), target: '12 = year one', ok: streak > 0 });

  // K7 stale manual valuations (>90 days)
  const k7 = await q(`SELECT count(*) c FROM accounts
    WHERE NOT archived AND is_manual AND valued_at < CURRENT_DATE - 90`);
  kpis.push({ code: 'K7', name: 'Stale account values (>90 days)',
    value: String(k7.rows[0].c), target: '0', ok: Number(k7.rows[0].c) === 0 });

  return kpis;
}

export function weakestKpi(kpis) {
  return kpis.find(k => k.ok === false) || null;
}
