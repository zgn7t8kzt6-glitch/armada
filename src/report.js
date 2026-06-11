// Weekly leadership report: outcomes, wow stories, concerns, delights, and the
// week's discharges/aftercare. Viewable in-app, printable, and emailable.
import { db } from './db.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.REPORT_TO);
}

export function buildWeeklyData() {
  const weekAgo = `datetime('now','-7 day')`;
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

  // Outcomes snapshot (all-time discharge mix)
  const disc = db.prepare(`SELECT discharge_status s, COUNT(*) n FROM clients WHERE discharge_status IS NOT NULL GROUP BY discharge_status`).all();
  const dc = {}; disc.forEach((r) => { dc[r.s] = r.n; });
  const completed = dc.Completed || 0, ama = dc.AMA || 0;
  const denom = completed + ama;
  const amaRate = denom ? Math.round((ama / denom) * 100) : 0;
  const completionRate = denom ? Math.round((completed / denom) * 100) : 0;
  const active = db.prepare(`SELECT COUNT(*) n FROM clients WHERE active = 1 AND discharge_status IS NULL`).get().n;

  // This week
  const dischargesWeek = db.prepare(`SELECT pref, name, discharge_status, discharge_date FROM clients WHERE discharge_date >= ? ORDER BY discharge_date`).all(since);
  const pulsesWeek = db.prepare(`SELECT COUNT(*) n FROM pulses WHERE created_at >= ${weekAgo}`).get().n;
  const highReads = db.prepare(`SELECT COUNT(*) n FROM ama_reads WHERE level = 'High' AND created_at >= ${weekAgo}`).get().n;
  const delights = db.prepare(`SELECT d.text, d.by_name, c.pref FROM delights d LEFT JOIN clients c ON c.id = d.client_id WHERE d.created_at >= ${weekAgo} ORDER BY d.id DESC`).all();
  const wows = db.prepare(`SELECT w.text, w.by_name, w.recognize, c.pref FROM wows w LEFT JOIN clients c ON c.id = w.client_id WHERE w.created_at >= ${weekAgo} ORDER BY w.id DESC`).all();
  const concernsOpened = db.prepare(`SELECT COUNT(*) n FROM concerns WHERE created_at >= ${weekAgo}`).get().n;
  const concernsResolved = db.prepare(`SELECT COUNT(*) n FROM concerns WHERE resolved_at >= ${weekAgo}`).get().n;
  const openConcerns = db.prepare(`SELECT co.text, co.owner_name, c.pref FROM concerns co JOIN clients c ON c.id = co.client_id WHERE co.status = 'Open' ORDER BY co.id DESC`).all();
  const ce = db.prepare(`SELECT AVG(cared) a, COUNT(*) n FROM client_experience WHERE created_at >= ${weekAgo}`).get();
  const callsDue = db.prepare(`SELECT f.type, f.due_date, c.pref, c.name FROM followups f JOIN clients c ON c.id = f.client_id WHERE f.status = 'Pending' ORDER BY f.due_date LIMIT 30`).all();

  return {
    period: { from: since, to: new Date().toISOString().slice(0, 10) },
    amaRate, completionRate, active, completed, ama,
    dischargesWeek, pulsesWeek, highReads, delights, wows,
    concernsOpened, concernsResolved, openConcerns,
    feltCare: ce.a ? Math.round(ce.a * 10) / 10 : null, feltCareN: ce.n, callsDue,
  };
}

export function renderReportHtml(d) {
  const kpi = (n, l) => `<td style="text-align:center;padding:10px;border:1px solid #e5e0d6;border-radius:8px">
    <div style="font-size:26px;font-weight:700;color:#2a585d">${n}</div>
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px">${l}</div></td>`;
  const list = (arr, fn) => arr.length ? `<ul style="margin:6px 0;padding-left:18px">${arr.map(fn).join('')}</ul>` : `<p style="color:#888;font-style:italic">None this week.</p>`;
  const h = (t) => `<h2 style="color:#2a585d;font-size:16px;border-bottom:2px solid #c89461;padding-bottom:4px;margin:22px 0 8px">${t}</h2>`;

  return `<div style="font-family:Georgia,serif;color:#2a2a2a;max-width:680px;margin:0 auto;line-height:1.5">
    <div style="background:#2a585d;color:#fff;padding:18px 22px;border-bottom:3px solid #c89461">
      <div style="font-size:20px;font-weight:600">Armada Recovery — Weekly Care Report</div>
      <div style="font-size:12px;color:#e6cfa9;letter-spacing:1px">${esc(d.period.from)} to ${esc(d.period.to)} · The Gold Standard of Client Care</div>
    </div>
    <div style="padding:18px 22px">
      <table style="width:100%;border-collapse:separate;border-spacing:8px"><tr>
        ${kpi(d.amaRate + '%', 'AMA rate')}
        ${kpi(d.completionRate + '%', 'Completion')}
        ${kpi(d.feltCare != null ? d.feltCare : '—', 'Felt-care /5')}
        ${kpi(d.active, 'Active clients')}
      </tr></table>

      ${h('★ Wow Stories — moments of care')}
      ${list(d.wows, (w) => `<li>${esc(w.text)} <span style="color:#888;font-size:12px">— ${esc(w.by_name || '')}${w.recognize ? ', recognizing ' + esc(w.recognize) : ''}${w.pref ? ' (about ' + esc(w.pref) + ')' : ''}</span></li>`)}

      ${h('♥ Delights delivered')}
      ${list(d.delights, (x) => `<li>${esc(x.text)}${x.pref ? ' <span style="color:#888;font-size:12px">— for ' + esc(x.pref) + '</span>' : ''}</li>`)}

      ${h('This week at a glance')}
      <ul style="margin:6px 0;padding-left:18px">
        <li>Daily pulses logged: <strong>${d.pulsesWeek}</strong></li>
        <li>High-risk plans generated: <strong>${d.highReads}</strong></li>
        <li>Concerns opened / resolved: <strong>${d.concernsOpened} / ${d.concernsResolved}</strong></li>
        <li>Discharges: <strong>${d.dischargesWeek.length}</strong>${d.dischargesWeek.length ? ' — ' + d.dischargesWeek.map((x) => esc(x.pref || x.name) + ' (' + esc(x.discharge_status) + ')').join(', ') : ''}</li>
      </ul>

      ${h('⚑ Open concerns (need ownership)')}
      ${list(d.openConcerns, (c) => `<li>${esc(c.text)} <span style="color:#888;font-size:12px">— ${esc(c.pref || '')}, owned by ${esc(c.owner_name || '?')}</span></li>`)}

      ${h('🤝 Aftercare calls coming due')}
      ${list(d.callsDue, (f) => `<li>${esc(f.pref || f.name)} — ${esc(f.type)} call, due ${esc(f.due_date)}</li>`)}

      <p style="color:#999;font-size:11px;font-style:italic;margin-top:24px;border-top:1px solid #e5e0d6;padding-top:10px">
        Generated by Armada Care Standards. Contains client information — handle per your privacy policy. For clinical review.</p>
    </div>
  </div>`;
}

export async function sendEmail({ subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_TO;
  if (!key || !to) throw new Error('Email not configured. Set RESEND_API_KEY and REPORT_TO.');
  const from = process.env.REPORT_FROM || 'Armada Care <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: to.split(',').map((s) => s.trim()), subject, html }),
  });
  if (!r.ok) throw new Error('Email send failed: ' + (await r.text()).slice(0, 200));
}

export async function sendWeeklyReport() {
  const d = buildWeeklyData();
  const html = renderReportHtml(d);
  await sendEmail({ subject: `Armada Weekly Care Report · ${d.period.from} to ${d.period.to}`, html });
}
