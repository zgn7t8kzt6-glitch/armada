// Weekly digest (spec section 3.2: email is a digest channel; Phase 1 = weekly).
// Renders HTML; sends via SMTP_URL if configured, else preview-only.
import nodemailer from 'nodemailer';
import { q } from './db.js';
import { fmtMoney } from './core.js';
import { computeKpis, weakestKpi } from './kpi.js';

export async function buildDigest() {
  const nw = await q(`SELECT coalesce(sum(valuation),0) s FROM accounts WHERE NOT archived`);
  const week = await q(`SELECT coalesce(sum(amount),0) spend FROM transactions
    WHERE amount < 0 AND status='ok' AND occurred_on > CURRENT_DATE - 7`);
  const unassigned = await q(`SELECT count(*) c, coalesce(sum(amount),0) s
    FROM income_events WHERE assigned_at IS NULL`);
  const goals = await q(`SELECT name, balance, target_amount FROM missions
    WHERE closed_at IS NULL AND target_amount IS NOT NULL ORDER BY sort_order LIMIT 6`);
  const kpis = await computeKpis();
  const weakest = weakestKpi(kpis);

  const rows = goals.rows.map(g => {
    const pct = g.target_amount > 0 ? Math.min(100, Math.round(g.balance / g.target_amount * 100)) : 0;
    return `<tr><td style="padding:4px 8px">${g.name}</td>
      <td style="padding:4px 8px;text-align:right">${pct}%</td></tr>`;
  }).join('');

  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:auto;color:#1d2429">
    <h2 style="color:#b07d1e">FamilyOS — weekly digest</h2>
    <p><b>Net worth:</b> ${fmtMoney(nw.rows[0].s)}<br>
       <b>Spent this week:</b> ${fmtMoney(-week.rows[0].spend)}<br>
       <b>Unassigned income:</b> ${unassigned.rows[0].c} event(s), ${fmtMoney(unassigned.rows[0].s)}</p>
    <h3>Goal funding</h3>
    <table style="border-collapse:collapse">${rows || '<tr><td>No targeted goals yet.</td></tr>'}</table>
    ${weakest ? `<p><b>Weakest area:</b> ${weakest.name} — ${weakest.value} (target ${weakest.target}).</p>` : '<p>All tracked KPIs are on target.</p>'}
    <p><b>One question to discuss Sunday:</b> what did money do for us this week?</p>
    <p style="color:#5d6b74;font-size:12px">Sent by your own FamilyOS. Data never leaves your server.</p>
  </div>`;
  return { html, subject: `FamilyOS weekly digest — net worth ${fmtMoney(nw.rows[0].s)}` };
}

export async function sendDigest() {
  const { html, subject } = await buildDigest();
  if (!process.env.SMTP_URL) return { sent: false, reason: 'SMTP_URL not configured — preview only' };
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  const to = (await q('SELECT email FROM users')).rows.map(r => r.email).join(',');
  await transport.sendMail({ from: process.env.SMTP_FROM || 'familyos@localhost', to, subject, html });
  return { sent: true };
}
