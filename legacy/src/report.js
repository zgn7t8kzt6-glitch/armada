// Weekly leadership report: outcomes, wow stories, concerns, delights, and the
// week's discharges/aftercare. Viewable in-app, printable, and emailable.
import { db, getState } from './db.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Email config resolves from the in-app settings first, then env vars.
function ecfg(key, envName) { const v = getState('email_' + key); return (v != null && v !== '') ? v : (process.env[envName] || ''); }
// Default leadership CC on every outgoing email (until overridden in Settings → Email).
export const DEFAULT_CC = 'shlomo@armadarecovery.com, apepose@armadarecovery.com, bmiller@armadarecovery.com';
export function smtpConfigured() { return Boolean(ecfg('smtp_host', 'SMTP_HOST') && ecfg('smtp_user', 'SMTP_USER') && ecfg('smtp_pass', 'SMTP_PASS')); }
export function resendConfigured() { return Boolean(ecfg('resend_key', 'RESEND_API_KEY')); }
export function emailConfigured() { return smtpConfigured() || resendConfigured(); }
export function emailStatus() {
  return { smtp: smtpConfigured(), resend: resendConfigured(),
    provider: smtpConfigured() ? 'smtp' : (resendConfigured() ? 'resend' : null),
    from: ecfg('from', 'SMTP_FROM') || ecfg('from', 'REPORT_FROM') || ecfg('smtp_user', 'SMTP_USER') || '',
    smtpHost: ecfg('smtp_host', 'SMTP_HOST'), smtpUser: ecfg('smtp_user', 'SMTP_USER') };
}

// Headline survey scores (averages) over the last `days` days.
export function surveyMetrics(days = 30) {
  const q = (like) => {
    const r = db.prepare(
      `SELECT AVG(a.value_num) avg, COUNT(a.value_num) n
       FROM survey_answers a
       JOIN survey_questions q ON q.id = a.question_id
       JOIN survey_responses r ON r.id = a.response_id
       WHERE q.text LIKE ? AND r.created_at >= datetime('now', ?)`).get(like, `-${days} day`);
    return { avg: r.avg != null ? Math.round(r.avg * 10) / 10 : null, n: r.n };
  };
  return {
    feltCared: q('I feel genuinely cared for%'),
    recommend: q('How likely are you to recommend%'),
    food: q('Overall, how satisfied are you with the food%'),
  };
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
    surveys: surveyMetrics(30),
    trainingPct: trainingCompliance(),
  };
}

// % of (active staff × active courses) that are currently certified (not due).
export function trainingCompliance() {
  const courses = db.prepare(`SELECT id, recert_days FROM courses WHERE active = 1`).all();
  const users = db.prepare(`SELECT id FROM users WHERE active = 1`).all();
  if (!courses.length || !users.length) return null;
  let req = 0, cur = 0;
  for (const c of courses) for (const u of users) {
    req++;
    const last = db.prepare(`SELECT completed_at FROM course_completions WHERE course_id = ? AND user_id = ? AND passed = 1 ORDER BY id DESC LIMIT 1`).get(c.id, u.id);
    let ok = !!last;
    if (last && c.recert_days > 0) ok = (Date.now() - new Date(last.completed_at + 'Z').getTime()) <= c.recert_days * 864e5;
    if (ok) cur++;
  }
  return Math.round((cur / req) * 100);
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
        ${kpi(d.feltCare != null ? d.feltCare : '—', 'Felt-care /10')}
        ${kpi(d.active, 'Active clients')}
      </tr></table>

      ${h('Voice of the client — survey scores (30 days)')}
      <table style="width:100%;border-collapse:separate;border-spacing:8px"><tr>
        ${kpi(d.surveys.feltCared.avg != null ? Math.round(d.surveys.feltCared.avg * 10) + '%' : '—', 'Feel cared for')}
        ${kpi(d.surveys.recommend.avg != null ? Math.round(d.surveys.recommend.avg * 10) + '%' : '—', 'Would recommend')}
        ${kpi(d.surveys.food.avg != null ? Math.round(d.surveys.food.avg * 10) + '%' : '—', 'Food rating')}
        ${kpi(d.trainingPct != null ? d.trainingPct + '%' : '—', 'Training current')}
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

export async function sendEmail({ subject, html, to, cc, bcc, replyTo, suppressCc }) {
  const bccList = bcc ? String(bcc).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const dest = (to || ecfg('to', 'CENSUS_EMAIL_TO') || process.env.REPORT_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!dest.length) throw new Error('No recipient address.');
  // Always CC the owner (or whoever's set in Settings → Email) on every send, so
  // there's one inbox with a copy of everything that leaves the system. Deduped
  // against the To list and any explicit cc, case-insensitively. Set 'email_cc'
  // to a blank-ish value ('-' / 'none') to turn the global CC off.
  const ccGlobal = ecfg('cc', 'EMAIL_CC');
  const ccSetting = ccGlobal === '' ? DEFAULT_CC : ccGlobal; // default to leadership
  // suppressCc: skip the automatic leadership CC entirely (e.g. team blasts that
  // shouldn't copy leadership on every send).
  const ccRaw = suppressCc ? [] : [...(cc ? String(cc).split(',') : []), ...(/^(-|none|off)$/i.test(ccSetting) ? [] : ccSetting.split(','))];
  const lowerDest = dest.map((d) => d.toLowerCase());
  const ccList = [...new Set(ccRaw.map((s) => s.trim()).filter(Boolean))]
    .filter((c) => !lowerDest.includes(c.toLowerCase()));
  // Preferred: send from your OWN mailbox over SMTP (e.g. Microsoft 365 / Google).
  if (smtpConfigured()) {
    const nodemailer = (await import('nodemailer')).default;
    const port = +(ecfg('smtp_port', 'SMTP_PORT') || 587);
    const transport = nodemailer.createTransport({
      host: ecfg('smtp_host', 'SMTP_HOST'), port, secure: port === 465,
      auth: { user: ecfg('smtp_user', 'SMTP_USER'), pass: ecfg('smtp_pass', 'SMTP_PASS') },
    });
    const from = ecfg('from', 'SMTP_FROM') || ecfg('from', 'REPORT_FROM') || ecfg('smtp_user', 'SMTP_USER');
    await transport.sendMail({ from, to: dest, ...(ccList.length ? { cc: ccList } : {}), ...(bccList.length ? { bcc: bccList } : {}), ...(replyTo ? { replyTo } : {}), subject, html });
    return;
  }
  // Fallback: Resend API.
  const key = ecfg('resend_key', 'RESEND_API_KEY');
  if (!key) throw new Error('Email not configured. Add SMTP (your mailbox) or a Resend key in Settings → Email.');
  const from = ecfg('from', 'REPORT_FROM') || 'Armada Care <onboarding@resend.dev>';
  // Resend caps requests/second; on a 429, wait and retry (respecting Retry-After)
  // up to 4 times so quick successive sends don't fail.
  let lastBody = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: dest, ...(ccList.length ? { cc: ccList } : {}), ...(bccList.length ? { bcc: bccList } : {}), ...(replyTo ? { reply_to: replyTo } : {}), subject, html }),
    });
    if (r.ok) return;
    lastBody = (await r.text()).slice(0, 200);
    if (r.status === 429 && attempt < 4) {
      const retryAfter = +r.headers.get('retry-after') || 0;
      await new Promise((res) => setTimeout(res, retryAfter ? retryAfter * 1000 : 600 * (attempt + 1)));
      continue;
    }
    break;
  }
  throw new Error('Email send failed: ' + lastBody);
}

export function smsConfigured() { return Boolean(ecfg('sms_sid', 'TWILIO_SID') && ecfg('sms_token', 'TWILIO_TOKEN') && ecfg('sms_from', 'TWILIO_FROM')); }
export function smsStatus() { return { ready: smsConfigured(), from: ecfg('sms_from', 'TWILIO_FROM'), sid: ecfg('sms_sid', 'TWILIO_SID'), oncall: getState('oncall_phone') || process.env.ONCALL_PHONE || '' }; }
export async function sendSms({ to, body }) {
  const sid = ecfg('sms_sid', 'TWILIO_SID'), token = ecfg('sms_token', 'TWILIO_TOKEN'), from = ecfg('sms_from', 'TWILIO_FROM');
  if (!sid || !token || !from || !to) throw new Error('Texting not connected — Settings → Texting.');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  if (!r.ok) throw new Error('SMS send failed: ' + (await r.text()).slice(0, 200));
}

export async function sendWeeklyReport() {
  const d = buildWeeklyData();
  const html = renderReportHtml(d);
  await sendEmail({ subject: `Armada Weekly Care Report · ${d.period.from} to ${d.period.to}`, html });
}
