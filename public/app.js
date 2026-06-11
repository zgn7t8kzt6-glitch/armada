/* Armada Care Standards — front-end (talks to the API) */
let ME = null, META = { shifts: ['Morning','Day','Evening','Night'], jobRoles: ['BHT / Tech','Nurse','Therapist','Kitchen'] };
let currentId = null;
let PB = {};   // last playbook clients, keyed by id (for print/share)

const $ = id => document.getElementById(id);
const esc = s => (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const initials = n => (n||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
const today = () => new Date().toISOString().slice(0,10);

async function api(path, opts={}) {
  const r = await fetch('/api'+path, { headers:{'Content-Type':'application/json'}, ...opts });
  if (r.status === 401) { showLogin(); throw new Error('auth'); }
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || 'Error');
  return data;
}

/* ---- auth ---- */
function showLogin(){ $('app').style.display='none'; $('loginScreen').style.display='flex'; }
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginErr').textContent='';
  try {
    const { user } = await api('/login', { method:'POST', body: JSON.stringify({ username:$('l_user').value, password:$('l_pass').value }) });
    ME = user; boot();
  } catch(err){ $('loginErr').textContent = err.message; }
});
async function doLogout(){ await api('/logout',{method:'POST'}); location.reload(); }

async function boot(){
  $('loginScreen').style.display='none'; $('app').style.display='block';
  $('whoami').textContent = `${ME.name} · ${ME.job_role}${ME.role==='admin'?' · Admin':''}`;
  document.querySelectorAll('[data-admin]').forEach(el => el.style.display = ME.role==='admin' ? '' : 'none');
  try { META = await api('/meta'); } catch(e){}
  if (META.claude) { $('aiBtn').style.display = 'inline-block'; $('briefBtn').style.display = 'inline-block'; }
  // fill shift/role selects
  fillSelect($('r_shift'), META.shifts); fillSelect($('a_shift'), META.shifts);
  fillSelect($('r_role'), ['All', ...META.jobRoles]);
  fillSelect($('u_job'), META.jobRoles);
  $('r_date').value = today(); $('a_date').value = today();
  loadPlaybook();
}
function fillSelect(el, items){ el.innerHTML = items.map(i=>`<option>${esc(i)}</option>`).join(''); }

/* ---- nav ---- */
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => show(b.dataset.view));
function show(v){
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id===v));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  if(v==='clients') renderClients();
  if(v==='retention') loadRetention();
  if(v==='outcomes') loadOutcomes();
  if(v==='lineup') loadLineup();
  if(v==='surveys') loadSurveys();
  if(v==='concierge') loadConcierge();
  if(v==='program') loadProgram();
  if(v==='nursing') loadNursing();
  if(v==='family') loadFamily();
  if(v==='admissions') loadAdmissions();
  if(v==='team') loadTeam();
  if(v==='report') loadPlaybook();
  if(v==='users') loadUsers();
  if(v==='audit') loadAudit();
  if(v==='report-view') loadReport();
  if(v==='assign') loadAssign();
}

/* ---- clients ---- */
async function renderClients(){
  const { clients } = await api('/clients');
  const g = $('clientGrid'); g.innerHTML='';
  $('clientEmpty').style.display = clients.length ? 'none':'block';
  clients.forEach(c => {
    const d = document.createElement('div'); d.className='ctile'; d.onclick=()=>openJourney(c.id);
    const touch = c.touch ? `<div class="pref">★ ${esc(c.touch.slice(0,90))}${c.touch.length>90?'…':''}</div>` : '';
    d.innerHTML = `<h4>${esc(c.pref||c.name||'Unnamed')}</h4>
      <div class="meta">${esc(c.name||'')} ${c.room?'· Room '+esc(c.room):''}</div>
      <div class="meta">${esc(c.program||'')}</div>${touch}
      <div style="margin-top:8px">${(c.tasks||[]).length} task${(c.tasks||[]).length===1?'':'s'}</div>`;
    g.appendChild(d);
  });
}

function newClient(){ currentId=null; fillForm({}); $('editorTitle').textContent='New Care Card'; $('deleteBtn').style.display='none'; $('dischargeBox').style.display='none'; show('editor'); }
async function editClient(id){
  const { client } = await api('/clients/'+id);
  currentId = id; fillForm(client);
  $('editorTitle').textContent = 'Care Card · '+(client.pref||client.name||'');
  $('deleteBtn').style.display = ME.role==='admin' ? 'inline-block':'none';
  $('dischargeBox').style.display='block'; $('d_date').value = today();
  show('editor');
}
async function dischargeClient(){
  if(!currentId) return;
  const status=$('d_status').value;
  if(!confirm(`Discharge this client as "${status}"? This starts the aftercare calls and removes them from the active playbook.`)) return;
  const cid = currentId;
  await api('/clients/'+currentId+'/discharge',{method:'POST',body:JSON.stringify({status,date:$('d_date').value})});
  if(status!=='Transferred' && confirm('Discharged — aftercare calls scheduled.\n\nWould you like to do the Discharge survey with the client now?')){
    gotoSurvey('discharge', cid);
  } else {
    alert('Discharged. Aftercare calls scheduled — see the Outcomes tab.');
    show('clients');
  }
}
const FF = ['name','pref','room','program','admit','sober','touch','prefs','goals','triggers','safety','support','welcome_plan','aftercare_plan','allergies','medications'];
function fillForm(c){
  FF.forEach(f => $('f_'+f).value = c[f]||'');
  const tl = $('taskList'); tl.innerHTML='';
  (c.tasks||[]).forEach(t=>addTaskRow(t));
  if(!(c.tasks||[]).length) addTaskRow();
}
function addTaskRow(t={}){
  const tl=$('taskList'); const row=document.createElement('div'); row.className='task-row sans';
  const shiftOpts=META.shifts.map(s=>`<option ${t.shift===s?'selected':''}>${s}</option>`).join('');
  const roles=['All',...META.jobRoles];
  const roleOpts=roles.map(r=>`<option ${t.job_role===r?'selected':''}>${r}</option>`).join('');
  row.innerHTML=`<select class="t-shift">${shiftOpts}</select>
    <select class="t-role">${roleOpts}</select>
    <input class="t-text" placeholder="Specific action — e.g. 'Bring oat-milk coffee at wake-up'" value="${esc(t.text||'')}"/>
    <select class="t-pri" style="width:110px"><option ${t.priority!=='High'?'selected':''}>Normal</option><option ${t.priority==='High'?'selected':''}>High</option></select>
    <button class="btn btn-danger btn-sm" onclick="this.parentNode.remove()">✕</button>`;
  tl.appendChild(row);
}
function collectTasks(){
  return [...document.querySelectorAll('#taskList .task-row')].map(r=>({
    shift:r.querySelector('.t-shift').value, job_role:r.querySelector('.t-role').value,
    text:r.querySelector('.t-text').value.trim(), priority:r.querySelector('.t-pri').value
  })).filter(t=>t.text);
}
async function saveClient(){
  const body = {}; FF.forEach(f => body[f]=$('f_'+f).value.trim()); body.tasks=collectTasks();
  if(!body.name && !body.pref){ alert('Please enter at least a name.'); return; }
  if(currentId) await api('/clients/'+currentId,{method:'PUT',body:JSON.stringify(body)});
  else await api('/clients',{method:'POST',body:JSON.stringify(body)});
  show('clients');
}
async function suggestTasks(){
  const body = {}; FF.forEach(f => body[f] = $('f_'+f).value.trim());
  const btn = $('aiBtn'), status = $('aiStatus');
  btn.disabled = true; const label = btn.textContent; btn.textContent = '✦ Drafting…';
  status.style.display = 'block'; status.style.color = ''; status.textContent = 'Claude is reading the Care Card and drafting shift tasks…';
  try {
    const { tasks } = await api('/suggest-tasks', { method:'POST', body: JSON.stringify(body) });
    tasks.forEach(t => addTaskRow(t));
    status.textContent = `Added ${tasks.length} suggested task${tasks.length===1?'':'s'} below — review and edit each one, then Save.`;
  } catch(e) {
    status.style.color = 'var(--danger)';
    status.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

async function deleteCurrent(){
  if(!currentId||!confirm('Deactivate this client\'s Care Card?'))return;
  await api('/clients/'+currentId,{method:'DELETE'}); show('clients');
}

/* ---- playbook ---- */
async function loadPlaybook(){
  const date=$('r_date').value||today(), shift=$('r_shift').value, role=$('r_role').value;
  const data = await api(`/playbook?date=${date}&shift=${encodeURIComponent(shift)}&role=${encodeURIComponent(role)}`);
  const names = data.assignees.map(a=>`${esc(a.name)} (${esc(a.job_role)})`).join(' · ');
  $('assignees').innerHTML = names ? `On this shift: ${names}` : 'No staff assigned to this shift yet.';
  const dstr = new Date(date+'T00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('reportHead').innerHTML = `<div class="card" style="border-left:4px solid var(--gold)">
    <h3 style="margin:0">${esc(shift)} Shift Playbook${role!=='All'?' · '+esc(role):''}</h3>
    <p class="sub sans" style="margin:6px 0 0">${dstr}</p>
    <p class="hint">Touch every client. Deliver every ★ personal touch. Confirm every ⚠ safety item at handoff.</p></div>`;

  const body=$('reportBody'); body.innerHTML='';
  PB = {}; data.clients.forEach(c => { PB[c.id] = c; });
  if(!data.clients.length){ body.innerHTML='<div class="empty">No clients with tasks or notes for this shift/role.</div>'; return; }
  data.clients.forEach(c => {
    const todos = c.tasks.length ? c.tasks.map(t=>`<div class="todo ${t.done?'done':''}">
        <div class="box" onclick="toggleDone(${t.id}, ${t.done?0:1})">${t.done?'✓':''}</div>
        <div class="txt"><span class="pr ${t.priority==='High'?'high':'normal'}">${t.priority==='High'?'PRIORITY':(t.job_role==='All'?'ALL':esc(t.job_role))}</span> ${esc(t.text)}</div>
      </div>`).join('')
      : `<div class="pc-note">No shift-specific task. Still: greet by name, check in, deliver the personal touch.</div>`;
    const handoffHtml = (c.handoffs||[]).map(h=>`<div class="handoff">${esc(h.note)}<div class="by">— shift note</div></div>`).join('');
    body.insertAdjacentHTML('beforeend', `
      <div class="playbook-client">
        <div class="pc-head"><span class="avatar">${initials(c.name||c.pref)}</span>
          <h3>${esc(c.pref||c.name)} ${c.pref&&c.name?`<span style="font-weight:400;color:var(--gold-soft);font-size:13px">(${esc(c.name)})</span>`:''}</h3>
          <span class="room">${c.room?'Room '+esc(c.room):''}${c.program?' · '+esc(c.program):''}</span></div>
        <div class="pc-body">
          ${retentionBanner(c)}
          ${c.touch?`<div class="pc-touch">★ ${esc(c.touch)}</div>`:''}
          ${c.safety?`<div class="pc-section"><div class="alert-line">⚠ Safety watch: ${esc(c.safety)}</div></div>`:''}
          <div class="pc-section"><div class="h">This shift — to do</div>${todos}</div>
          <div class="row" style="display:flex;gap:24px;flex-wrap:wrap">
            ${c.goals?`<div class="pc-section" style="flex:1;min-width:200px"><div class="h">Goal focus</div><div class="pc-note">${esc(c.goals)}</div></div>`:''}
            ${c.triggers?`<div class="pc-section" style="flex:1;min-width:200px"><div class="h">Handle with care</div><div class="pc-note">${esc(c.triggers)}</div></div>`:''}
          </div>
          <div class="pc-section"><div class="h">Handoff notes</div>${handoffHtml||'<div class="pc-note">None yet.</div>'}
            <div class="handoff-add no-print"><input id="ho_${c.id}" placeholder="Add a handoff note for the next shift…"/>
              <button class="btn btn-ghost btn-sm sans" onclick="addHandoff(${c.id})">Add</button></div>
          </div>
          ${pulsePanel(c)}
          ${carePanel(c)}
        </div>
      </div>`);
  });
}
/* ---- retention dashboard ---- */
function riskBadge(level){
  const m = { High:'risk-high', Elevated:'risk-elev', Low:'risk-low' };
  return `<span class="risk ${m[level]||'risk-none'}">${esc(level||'No read')}</span>`;
}
async function loadRetention(){
  const { clients, triggerCounts, summary } = await api('/retention');
  $('retSummary').innerHTML = `
    <div class="ret-card ${summary.high?'rc-high':''}"><div class="n">${summary.high}</div><div class="l">High risk</div></div>
    <div class="ret-card ${summary.elevated?'rc-elev':''}"><div class="n">${summary.elevated}</div><div class="l">Elevated</div></div>
    <div class="ret-card ${summary.notPulsedToday?'rc-warn':''}"><div class="n">${summary.notPulsedToday}</div><div class="l">No pulse today</div></div>
    <div class="ret-card"><div class="n">${summary.pulsesToday}</div><div class="l">Pulses today</div></div>
    <div class="ret-card"><div class="n">${summary.total}</div><div class="l">Active clients</div></div>`;

  $('retClients').innerHTML = clients.length ? `<table class="tbl">
    <tr><th>Client</th><th>Room</th><th>AMA risk</th><th>Last pulse</th><th>Today</th></tr>
    ${clients.map(c=>`<tr class="ret-row" onclick="gotoPlaybook()">
      <td><strong>${esc(c.pref||c.name||'')}</strong>${c.summary?`<div class="hint" style="margin-top:2px">${esc(c.summary.slice(0,80))}${c.summary.length>80?'…':''}</div>`:''}</td>
      <td>${esc(c.room||'')}</td>
      <td>${riskBadge(c.level)}</td>
      <td>${c.lastPulse?esc(c.lastPulse.date)+' '+esc(c.lastPulse.shift)+' · '+esc(c.lastPulse.concern):'<span class="hint">none</span>'}</td>
      <td>${c.pulsedToday?'<span class="risk risk-low">✓</span>':'<span class="risk risk-warn">—</span>'}</td>
    </tr>`).join('')}</table>` : '<div class="empty">No clients yet.</div>';

  const max = Math.max(1, ...triggerCounts.map(t=>t.count));
  $('retTriggers').innerHTML = triggerCounts.length ? triggerCounts.map(t=>`
    <div class="trbar"><div class="trbar-l">${esc(t.trigger)}</div>
      <div class="trbar-track"><div class="trbar-fill" style="width:${Math.round(t.count/max*100)}%"></div></div>
      <div class="trbar-n">${t.count}</div></div>`).join('') : '<div class="hint">No pulses logged in the last 14 days.</div>';
}
function gotoPlaybook(){ show('report'); }

/* ---- AMA retention: banner + daily pulse ---- */
function retentionBanner(c){
  const a = c.ama;
  if (!a) return '';
  const cls = a.level === 'High' ? 'ama-high' : a.level === 'Elevated' ? 'ama-elev' : 'ama-low';
  const icon = a.level === 'Low' ? '✦' : '⚠';
  const trig = (a.triggers||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join('');
  const cared = (a.cared_for||[]).map(t=>`<li>${esc(t)}</li>`).join('');
  const acts = (a.actions||[]).map(x=>`<div class="todo"><div class="box" style="cursor:default"></div><div class="txt"><span class="pr ${x.priority==='High'?'high':'normal'}">${esc(x.job_role)} · ${esc(x.shift)}</span> ${esc(x.text)}</div></div>`).join('');
  return `<div class="ama-banner ${cls}">
    <div class="ama-head">${icon} Retention Focus — AMA risk: ${esc(a.level)} <span class="ama-tag">for clinical review · not a diagnosis</span></div>
    <div class="ama-sum">${esc(a.summary||'')}</div>
    ${a.underlying?`<div class="pc-section"><div class="h">What's really going on (emotionally)</div><div class="pc-note">${esc(a.underlying)}</div></div>`:''}
    ${a.best_play?`<div class="ama-play"><div class="h">★ Best play to keep them</div><div>${esc(a.best_play)}</div></div>`:''}
    ${cared?`<div class="pc-section"><div class="h">Make them feel cared for</div><ul class="ama-list">${cared}</ul></div>`:''}
    ${trig?`<div class="pc-section"><div class="h">Warning signs</div><div class="ama-trig">${trig}</div></div>`:''}
    ${acts?`<div class="pc-section"><div class="h">Keep them — this shift</div>${acts}</div>`:''}
    ${a.approach?`<div class="pc-section"><div class="h">How to talk with them</div><div class="pc-note">${esc(a.approach)}</div></div>`:''}
    <div class="ama-actions no-print">
      <button class="btn btn-ghost btn-sm sans" onclick="planToTasks(${c.id})">➕ Add to shift tasks</button>
      <button class="btn btn-ghost btn-sm sans" onclick="printPlan(${c.id})">🖨 Print / share plan</button>
    </div>
  </div>`;
}

async function planToTasks(clientId){
  if (!confirm('Add this plan\'s actions and gestures to the client\'s shift tasks?')) return;
  try {
    const { added } = await api('/clients/'+clientId+'/plan-to-tasks', { method:'POST', body: JSON.stringify({ shift: $('r_shift').value }) });
    alert(added ? `Added ${added} task${added===1?'':'s'} to the Care Card.` : 'Those tasks are already on the Care Card.');
    loadPlaybook();
  } catch(e){ alert(e.message); }
}

function printPlan(clientId){
  const c = (PB[clientId]||{}); const a = c.ama;
  if (!a) return;
  const list = (arr) => (arr||[]).map(x=>`<li>${esc(typeof x==='string'?x:(x.job_role+' · '+x.shift+': '+x.text))}</li>`).join('');
  const when = new Date(a.created_at ? a.created_at+'Z' : Date.now()).toLocaleString();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Retention plan — ${esc(c.pref||c.name||'')}</title>
  <style>body{font-family:Georgia,serif;color:#222;max-width:700px;margin:30px auto;padding:0 20px;line-height:1.5}
  h1{color:#2a585d;margin:0 0 2px} .meta{color:#666;font-size:13px;margin-bottom:16px}
  .lvl{display:inline-block;padding:3px 10px;border-radius:20px;font-weight:700;font-size:12px}
  .h{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#888;margin:16px 0 4px;font-family:sans-serif}
  .play{background:#faf6ee;border:1px solid #d9c4a3;border-radius:6px;padding:10px 12px}
  .tag{font-style:italic;color:#999;font-size:12px} ul{margin:4px 0}</style></head><body>
  <h1>${esc(c.pref||c.name||'')} ${c.room?'· Room '+esc(c.room):''}</h1>
  <div class="meta">Retention recap &amp; action plan · ${when} · <span class="tag">for clinical review — not a diagnosis</span></div>
  <div class="lvl" style="background:${a.level==='High'?'#fbecea':a.level==='Elevated'?'#fdf6ec':'#eef5f0'}">AMA risk: ${esc(a.level)}</div>
  <div class="h">Summary</div><div>${esc(a.summary||'')}</div>
  ${a.underlying?`<div class="h">What's really going on (emotionally)</div><div>${esc(a.underlying)}</div>`:''}
  ${a.best_play?`<div class="h">★ Best play to keep them</div><div class="play">${esc(a.best_play)}</div>`:''}
  ${(a.cared_for||[]).length?`<div class="h">Make them feel cared for</div><ul>${list(a.cared_for)}</ul>`:''}
  ${(a.actions||[]).length?`<div class="h">This shift — to do</div><ul>${list(a.actions)}</ul>`:''}
  ${a.approach?`<div class="h">How to talk with them</div><div>${esc(a.approach)}</div>`:''}
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(()=>w.print(), 300);
}

function pulsePanel(c){
  const trigs = (META.amaTriggers||[]).map((t,i)=>`<label class="trg"><input type="checkbox" value="${esc(t)}"/> ${esc(t)}</label>`).join('');
  const aiBtn = META.claude ? `<button class="btn btn-gold btn-sm sans" onclick="assessAma(${c.id})">✦ Recap &amp; action plan</button>` : '';
  const done = c.pulsedThisShift ? '<span class="hint" style="margin-left:8px">✓ pulse logged this shift</span>' : '';
  const lvl = c.ama ? `<span class="hint">last read: ${esc(c.ama.level)}</span>` : '';
  return `<details class="pulse-wrap no-print" id="pulse_${c.id}">
    <summary>Daily Pulse &amp; retention ${done} ${lvl}</summary>
    <div class="pulse-body">
      <div class="grid2">
        <div><label>Retention concern</label>
          <select class="p-concern"><option>Low</option><option>Medium</option><option>High</option></select></div>
        <div><label>Engagement</label>
          <select class="p-eng"><option value="">—</option><option>Engaged</option><option>Quiet</option><option>Withdrawn</option><option>Missed group</option></select></div>
      </div>
      <label>Warning signs seen this shift</label>
      <div class="trg-grid">${trigs}</div>
      <label>Notable statements (their words)</label>
      <input class="p-stmt" placeholder='e.g. "I don\\'t think this is for me"'/>
      <label>Note</label>
      <input class="p-note" placeholder="Anything else worth passing on"/>
      <div class="toolbar" style="margin-top:12px">
        ${aiBtn}
        <button class="btn btn-primary btn-sm sans" onclick="logPulse(${c.id})">Save pulse</button>
      </div>
    </div>
  </details>`;
}

function carePanel(c){
  return `<details class="pulse-wrap no-print" id="care_${c.id}">
    <summary>Moments, concerns &amp; client voice</summary>
    <div class="pulse-body">
      <label>How cared for does the client feel? (ask them)</label>
      <div class="care-scale">${[1,2,3,4,5].map(n=>`<button class="care-btn" onclick="setCare(${c.id},${n})">${n}</button>`).join('')}<span class="hint" style="margin-left:8px">1 = not at all · 5 = deeply</span></div>
      <label>♥ Log a delight ("whatever it takes")</label>
      <div class="handoff-add"><input id="dl_${c.id}" placeholder="e.g. arranged a call with her daughter"/><button class="btn btn-ghost btn-sm sans" onclick="logDelight(${c.id})">Add</button></div>
      <label>⚑ Raise a concern (you own it until it's resolved)</label>
      <div class="handoff-add"><input id="cn_${c.id}" placeholder="e.g. upset the shower was cold this morning"/><button class="btn btn-ghost btn-sm sans" onclick="raiseConcern(${c.id})">Add</button></div>
    </div>
  </details>`;
}
async function setCare(clientId, n){
  await api('/client-experience',{method:'POST',body:JSON.stringify({client_id:clientId,cared:n})});
  const root=$('care_'+clientId); root.querySelectorAll('.care-btn').forEach((b,i)=>b.classList.toggle('on', i<n));
}
async function logDelight(clientId){
  const inp=$('dl_'+clientId); if(!inp.value.trim())return;
  await api('/delights',{method:'POST',body:JSON.stringify({client_id:clientId,text:inp.value})});
  inp.value=''; inp.placeholder='✓ logged — thank you';
}
async function raiseConcern(clientId){
  const inp=$('cn_'+clientId); if(!inp.value.trim())return;
  await api('/concerns',{method:'POST',body:JSON.stringify({client_id:clientId,text:inp.value})});
  inp.value=''; inp.placeholder='✓ logged — you own this until resolved';
}

async function logPulse(clientId){
  const root = $('pulse_'+clientId);
  const triggers = [...root.querySelectorAll('.trg-grid input:checked')].map(i=>i.value);
  const concern = root.querySelector('.p-concern').value;
  const body = {
    client_id: clientId, date: $('r_date').value, shift: $('r_shift').value,
    concern,
    engagement: root.querySelector('.p-eng').value,
    triggers,
    statements: root.querySelector('.p-stmt').value.trim(),
    note: root.querySelector('.p-note').value.trim(),
  };
  const btn = root.querySelector('.btn-primary');
  btn.disabled = true; const label = btn.textContent;
  btn.textContent = (concern === 'High' && META.claude) ? 'Saving + drafting plan…' : 'Saving…';
  try {
    await api('/pulses',{method:'POST',body:JSON.stringify(body)});
    loadPlaybook();
  } catch(e){ btn.disabled=false; btn.textContent=label; alert(e.message); }
}

async function assessAma(clientId){
  const root = $('pulse_'+clientId);
  const btn = root.querySelector('.btn-gold');
  btn.disabled = true; const label = btn.textContent; btn.textContent = '✦ Assessing…';
  try {
    await api('/clients/'+clientId+'/ama-read',{method:'POST'});
    loadPlaybook();
  } catch(e){
    btn.disabled = false; btn.textContent = label;
    alert(e.message);
  }
}

async function toggleDone(taskId, done){
  await api('/completions',{method:'POST',body:JSON.stringify({date:$('r_date').value,shift:$('r_shift').value,task_id:taskId,done:!!done})});
  loadPlaybook();
}
async function addHandoff(clientId){
  const inp=$('ho_'+clientId); if(!inp.value.trim())return;
  await api('/handoffs',{method:'POST',body:JSON.stringify({date:$('r_date').value,shift:$('r_shift').value,client_id:clientId,note:inp.value})});
  loadPlaybook();
}

/* ---- outcomes ---- */
async function loadOutcomes(){
  const o = await api('/outcomes');
  $('outKpis').innerHTML = `
    <div class="ret-card ${o.ama?'rc-high':''}"><div class="n">${o.amaRate}%</div><div class="l">AMA rate</div></div>
    <div class="ret-card"><div class="n">${o.completionRate}%</div><div class="l">Completion rate</div></div>
    <div class="ret-card"><div class="n">${o.feltCare!=null?o.feltCare:'—'}</div><div class="l">Felt-care (avg/5, 30d)</div></div>
    <div class="ret-card ${o.openConcerns?'rc-warn':''}"><div class="n">${o.openConcerns}</div><div class="l">Open concerns</div></div>
    <div class="ret-card"><div class="n">${o.delights30}</div><div class="l">Delights (30d)</div></div>
    <div class="ret-card"><div class="n">${o.surveys?.recommend.avg!=null?o.surveys.recommend.avg:'—'}</div><div class="l">Recommend /5 (survey)</div></div>
    <div class="ret-card"><div class="n">${o.surveys?.food.avg!=null?o.surveys.food.avg:'—'}</div><div class="l">Food /5 (survey)</div></div>
    <div class="ret-card"><div class="n">${o.active}</div><div class="l">Active clients</div></div>`;

  const { followups } = await api('/followups');
  $('outFollow').innerHTML = followups.length ? followups.map(f=>`<div class="todo">
      <div class="txt"><strong>${esc(f.pref||f.name||'')}</strong> — ${esc(f.type)} call · due ${esc(f.due_date)}</div>
      <button class="btn btn-ghost btn-sm sans" onclick="markFollow(${f.id},'Done')">Done</button>
      <button class="btn btn-ghost btn-sm sans" onclick="markFollow(${f.id},'Unreachable')">No answer</button>
    </div>`).join('') : '<div class="hint">No aftercare calls due. They appear here when a client is discharged.</div>';

  $('outMiles').innerHTML = o.milestones.length ? o.milestones.map(m=>`<div class="todo"><div class="txt">🎉 <strong>${esc(m.client)}</strong> — ${esc(m.label)} ${m.inDays===0?'<span class="risk risk-low">today</span>':'in '+m.inDays+'d'}</div></div>`).join('') : '<div class="hint">No milestones in the next 7 days.</div>';

  const { concerns } = await api('/concerns');
  const open = concerns.filter(c=>c.status==='Open');
  $('outConcerns').innerHTML = open.length ? open.map(c=>`<div class="todo">
      <div class="txt"><strong>${esc(c.pref||c.name||'')}</strong> — ${esc(c.text)} <span class="hint">· owned by ${esc(c.owner_name||'?')}</span></div>
      <button class="btn btn-ghost btn-sm sans" onclick="resolveConcern(${c.id})">Resolve</button>
    </div>`).join('') : '<div class="hint">No open concerns. 🎉</div>';
}
async function markFollow(id, status){
  let note=''; if(status==='Done') note = prompt('How did the call go? (optional)')||'';
  await api('/followups/'+id,{method:'POST',body:JSON.stringify({status,note})});
  loadOutcomes();
}
async function resolveConcern(id){
  const resolution = prompt('How was it resolved? (optional)')||'';
  await api('/concerns/'+id+'/resolve',{method:'POST',body:JSON.stringify({resolution})});
  loadOutcomes();
}

/* ---- lineup / culture ---- */
let staffLoad = null;
async function loadLineup(){
  const { value, wows } = await api('/lineup');
  $('lineValue').textContent = value;
  // client dropdown for wow
  try { const { clients } = await api('/clients');
    $('w_client').innerHTML = '<option value="">—</option>' + clients.map(c=>`<option value="${c.id}">${esc(c.pref||c.name)}</option>`).join('');
  } catch(e){}
  $('wowFeed').innerHTML = wows.length ? wows.map(w=>`<div class="wow">
      <div>${esc(w.text)}</div>
      <div class="wow-meta">${w.pref?'about '+esc(w.pref)+' · ':''}${w.recognize?'👏 '+esc(w.recognize)+' · ':''}${esc(w.by_name||'')}</div>
    </div>`).join('') : '<div class="hint">No stories yet. Be the first to share a moment of care.</div>';
  // wire load buttons
  document.querySelectorAll('#staffLoad .load-btn').forEach(b=>b.onclick=()=>{
    staffLoad=b.dataset.v; document.querySelectorAll('#staffLoad .load-btn').forEach(x=>x.classList.toggle('on',x===b));
  });
}
async function addWow(){
  const text=$('w_text').value.trim(); if(!text){return;}
  await api('/wows',{method:'POST',body:JSON.stringify({text,client_id:$('w_client').value||null,recognize:$('w_recognize').value.trim()||null})});
  $('w_text').value=''; $('w_recognize').value='';
  loadLineup();
}
async function submitStaffPulse(){
  await api('/staff-pulse',{method:'POST',body:JSON.stringify({load:staffLoad,note:$('staffNote').value.trim()})});
  $('staffNote').value=''; $('staffPulseMsg').textContent='Thank you — submitted.';
  document.querySelectorAll('#staffLoad .load-btn').forEach(x=>x.classList.remove('on')); staffLoad=null;
}

/* ---- assignments ---- */
async function loadAssign(){
  const date=$('a_date').value||today(), shift=$('a_shift').value;
  const { assigned, staff } = await api(`/assignments?date=${date}&shift=${encodeURIComponent(shift)}`);
  const set=new Set(assigned);
  $('assignList').innerHTML = staff.map(s=>`<label class="assign-row">
    <input type="checkbox" value="${s.id}" ${set.has(s.id)?'checked':''}/>
    <span>${esc(s.name)}</span><span class="badge">${esc(s.job_role)}</span></label>`).join('') || '<div class="empty">No staff yet.</div>';
}
async function saveAssign(){
  const ids=[...document.querySelectorAll('#assignList input:checked')].map(i=>+i.value);
  await api('/assignments',{method:'POST',body:JSON.stringify({date:$('a_date').value,shift:$('a_shift').value,user_ids:ids})});
  alert('Assignments saved.');
}

/* ---- users ---- */
async function loadUsers(){
  const { users } = await api('/users');
  $('userList').innerHTML = `<table class="tbl"><tr><th>Name</th><th>Username</th><th>Job role</th><th>Access</th></tr>${
    users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(u.job_role)}</td>
      <td><span class="badge ${u.role==='admin'?'admin':''}">${u.role}</span></td></tr>`).join('')}</table>`;
}
async function addUser(){
  try{
    await api('/users',{method:'POST',body:JSON.stringify({
      name:$('u_name').value,username:$('u_user').value,password:$('u_pass').value,role:$('u_role').value,job_role:$('u_job').value})});
    $('u_name').value=$('u_user').value=$('u_pass').value=''; loadUsers();
  }catch(e){ alert(e.message); }
}

/* ---- concierge / requests ---- */
function fillClientSelect(el, withBlank){
  return api('/clients').then(({clients})=>{
    el.innerHTML = (withBlank?'<option value="">'+withBlank+'</option>':'') + clients.map(c=>`<option value="${c.id}">${esc(c.pref||c.name)}${c.room?' · '+esc(c.room):''}</option>`).join('');
  }).catch(()=>{});
}
async function loadConcierge(){
  await fillClientSelect($('rq_client'), 'Whole house / no client');
  if($('rq_dept').options.length===0){ $('rq_dept').innerHTML=(META.departments||[]).map(d=>`<option>${esc(d)}</option>`).join(''); $('rq_filter_dept').innerHTML='<option value="">All departments</option>'+(META.departments||[]).map(d=>`<option>${esc(d)}</option>`).join(''); }
  const dept=$('rq_filter_dept').value, status=$('rq_filter_status').value;
  const qs = new URLSearchParams(); if(dept) qs.set('department',dept); if(status) qs.set('status',status);
  const { requests } = await api('/requests?'+qs.toString());
  // group by department
  const byDept = {}; requests.forEach(r=>{ (byDept[r.department]=byDept[r.department]||[]).push(r); });
  const board = Object.keys(byDept).sort().map(dep=>`<div class="card"><h3>${esc(dep)} <span class="hint">(${byDept[dep].length})</span></h3>
    ${byDept[dep].map(r=>`<div class="todo ${r.status==='Done'?'done':''}">
      <div class="txt"><span class="pr ${r.priority==='High'?'high':'normal'}">${r.status==='Done'?'DONE':r.status==='In progress'?'IN PROGRESS':esc(r.priority)}</span>
        ${r.pref?'<strong>'+esc(r.pref)+'</strong> — ':''}${esc(r.text)} <span class="hint">· ${esc(r.created_by_name||'')}</span></div>
      ${r.status!=='Done'?`<button class="btn btn-ghost btn-sm sans" onclick="setRequestStatus(${r.id},'In progress')">Start</button>
        <button class="btn btn-ghost btn-sm sans" onclick="setRequestStatus(${r.id},'Done')">Done</button>`:''}
    </div>`).join('')}</div>`).join('');
  $('rqBoard').innerHTML = board || '<div class="empty">No requests. Anticipate a wish and log it.</div>';
}
async function addRequest(){
  const text=$('rq_text').value.trim(); if(!text) return;
  await api('/requests',{method:'POST',body:JSON.stringify({client_id:$('rq_client').value||null,department:$('rq_dept').value,text,priority:$('rq_pri').value})});
  $('rq_text').value=''; loadConcierge();
}
async function setRequestStatus(id,status){ await api('/requests/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadConcierge(); }

/* ---- program / schedule ---- */
async function loadProgram(){
  if(!$('pg_date').value) $('pg_date').value = today();
  if($('pg_type').options.length===0) $('pg_type').innerHTML=(META.scheduleTypes||[]).map(t=>`<option>${esc(t)}</option>`).join('');
  await fillClientSelect($('pg_client'), 'Whole house');
  const date=$('pg_date').value;
  const { items } = await api('/schedule?date='+date);
  $('pgHeading').textContent = 'Schedule · '+new Date(date+'T00:00').toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
  $('pgList').innerHTML = items.length ? items.map(it=>`<div class="todo">
      <div class="txt"><strong>${it.time?esc(it.time):'—'}</strong> · <span class="chip">${esc(it.type)}</span> ${esc(it.title)}
        ${it.location?' <span class="hint">@ '+esc(it.location)+'</span>':''}${it.pref?' <span class="hint">· for '+esc(it.pref)+'</span>':''}</div>
      <button class="btn btn-ghost btn-sm sans no-print" onclick="delSchedule(${it.id})">✕</button>
    </div>`).join('') : '<div class="empty">Nothing scheduled. Add the day\'s groups, meals, and activities.</div>';
}
async function addSchedule(){
  const title=$('pg_title').value.trim(); if(!title) return;
  await api('/schedule',{method:'POST',body:JSON.stringify({date:$('pg_date').value||today(),time:$('pg_time').value||null,title,type:$('pg_type').value,location:$('pg_loc').value.trim()||null,client_id:$('pg_client').value||null})});
  $('pg_title').value=''; $('pg_loc').value=''; loadProgram();
}
async function delSchedule(id){ await api('/schedule/'+id,{method:'DELETE'}); loadProgram(); }

/* ---- client 360 journey ---- */
let JOURNEY_ID = null;
function openJourney(id){ JOURNEY_ID=id; show('journey'); loadJourney(); }
async function loadJourney(){
  const { journey:j } = await api('/clients/'+JOURNEY_ID+'/journey');
  const c=j.client;
  const sec=(t,inner)=>`<div class="jcard"><div class="h">${t}</div>${inner}</div>`;
  const amaHtml = j.ama ? `<span class="risk ${j.ama.level==='High'?'risk-high':j.ama.level==='Elevated'?'risk-elev':'risk-low'}">AMA risk: ${esc(j.ama.level)}</span>` : '<span class="risk risk-none">No AMA read</span>';
  const goalsHtml = j.goals.length ? j.goals.map(g=>`<div class="todo"><div class="box" style="cursor:pointer" onclick="toggleGoal(${g.id},'${g.status==='Met'?'Active':'Met'}')">${g.status==='Met'?'✓':''}</div><div class="txt ${g.status==='Met'?'done':''}">${esc(g.text)}${g.target_date?' <span class="hint">· by '+esc(g.target_date)+'</span>':''}</div></div>`).join('') : '<div class="pc-note">No goals yet.</div>';
  const reqHtml = j.requests.length ? j.requests.map(r=>`<div class="pc-note">• ${esc(r.department)}: ${esc(r.text)} <span class="hint">(${esc(r.status)})</span></div>`).join('') : '<div class="pc-note">None open.</div>';
  const concernHtml = j.concerns.length ? j.concerns.map(x=>`<div class="pc-note">⚑ ${esc(x.text)}</div>`).join('') : '<div class="pc-note">None open.</div>';
  const delHtml = j.delights.length ? j.delights.map(x=>`<div class="pc-note">♥ ${esc(x.text)}</div>`).join('') : '<div class="pc-note">None yet.</div>';
  const pulseHtml = j.pulses.length ? j.pulses.map(p=>`<div class="pc-note">${esc(p.date)} ${esc(p.shift)} — concern ${esc(p.concern)}${(p.triggers||[]).length?' · '+p.triggers.map(esc).join(', '):''}${p.statements?' · "'+esc(p.statements)+'"':''}</div>`).join('') : '<div class="pc-note">No pulses yet.</div>';
  const schedHtml = j.schedule.length ? j.schedule.map(s=>`<div class="pc-note">${s.time?esc(s.time)+' · ':''}${esc(s.type)}: ${esc(s.title)}</div>`).join('') : '<div class="pc-note">No client-specific items today.</div>';
  const followHtml = j.followups.length ? j.followups.map(f=>`<div class="pc-note">${esc(f.type)} aftercare call · due ${esc(f.due_date)}</div>`).join('') : '';
  const health = (c.allergies||c.medications) ? `${c.allergies?'<div class="pc-note"><strong>Allergies:</strong> '+esc(c.allergies)+'</div>':''}${c.medications?'<div class="pc-note"><strong>Medications:</strong> '+esc(c.medications)+'</div>':''}` : '<div class="pc-note">None recorded.</div>';
  const v=j.vitals, w=j.withdrawal;
  const nursingSummary = `${(j.meds||[]).length?'<div class="pc-note"><strong>Meds:</strong> '+j.meds.map(m=>esc(m.name)).join(', ')+'</div>':'<div class="pc-note">No active meds.</div>'}`+
    `${v?'<div class="pc-note">Vitals: BP '+esc(v.bp||'-')+' · HR '+esc(v.hr||'-')+' · T '+esc(v.temp||'-')+'</div>':''}`+
    `${w?'<div class="pc-note">'+esc(w.scale)+': <strong>'+w.score+'</strong></div>':''}`+
    `<button class="btn btn-ghost btn-sm sans no-print" style="margin-top:6px" onclick="openNursing(${c.id})">Open nursing</button>`;
  const familySummary = `${(j.family||[]).length?j.family.map(f=>'<div class="pc-note">'+esc(f.name)+(f.relationship?' ('+esc(f.relationship)+')':'')+(f.phone?' · '+esc(f.phone):'')+'</div>').join(''):'<div class="pc-note">No contacts.</div>'}`+
    `${(j.visits||[]).length?'<div class="pc-note">Next visit: '+esc(j.visits[0].date)+(j.visits[0].contact_name?' · '+esc(j.visits[0].contact_name):'')+'</div>':''}`+
    `<button class="btn btn-ghost btn-sm sans no-print" style="margin-top:6px" onclick="openFamily(${c.id})">Open family</button>`;
  const phase = c.discharge_status ? 'Discharged ('+esc(c.discharge_status)+')' : (c.admit ? 'In treatment' : 'Active');

  $('journeyBody').innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span class="avatar" style="width:48px;height:48px;font-size:18px">${initials(c.name||c.pref)}</span>
        <div><h2 style="margin:0;color:var(--navy)">${esc(c.pref||c.name)} ${c.pref&&c.name?'<span class="hint">('+esc(c.name)+')</span>':''}</h2>
          <div class="hint">${c.room?'Room '+esc(c.room)+' · ':''}${esc(c.program||'')} · ${phase}</div></div>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">${amaHtml}
          <button class="btn btn-ghost btn-sm sans" onclick="editClient(${c.id})">Edit Care Card</button>
          <button class="btn btn-gold btn-sm sans" id="cbBtn" onclick="careBrief(${c.id})" style="${META.claude?'':'display:none'}">✦ AI Care Brief</button>
        </div>
      </div>
      ${c.touch?`<div class="pc-touch" style="margin-top:12px">★ ${esc(c.touch)}</div>`:''}
      <div id="careBriefOut"></div>
    </div>
    <div class="jgrid">
      ${sec('⚠ Safety', c.safety?`<div class="pc-note alert-line">${esc(c.safety)}</div>`:'<div class="pc-note">None noted.</div>')}
      ${sec('⚕ Health', health)}
      ${sec('⚕ Nursing', nursingSummary)}
      ${sec('👪 Family', familySummary)}
      ${sec('Preferences', c.prefs?`<div class="pc-note">${esc(c.prefs)}</div>`:'<div class="pc-note">—</div>')}
      ${sec('Triggers / handle with care', c.triggers?`<div class="pc-note">${esc(c.triggers)}</div>`:'<div class="pc-note">—</div>')}
      ${sec('Treatment goals', goalsHtml + `<div class="handoff-add no-print" style="margin-top:8px"><input id="goalInput" placeholder="Add a goal…"/><button class="btn btn-ghost btn-sm sans" onclick="addGoal(${c.id})">Add</button></div>`)}
      ${sec("Today's schedule", schedHtml)}
      ${sec('Open requests', reqHtml)}
      ${sec('Open concerns', concernHtml)}
      ${sec('Recent delights', delHtml)}
      ${sec('Recent pulses', pulseHtml)}
      ${followHtml?sec('Aftercare', followHtml):''}
      ${sec('Support / family', c.support?`<div class="pc-note">${esc(c.support)}</div>`:'<div class="pc-note">—</div>')}
    </div>`;
}
async function addGoal(clientId){ const inp=$('goalInput'); if(!inp.value.trim())return; await api('/goals',{method:'POST',body:JSON.stringify({client_id:clientId,text:inp.value})}); loadJourney(); }
async function toggleGoal(id,status){ await api('/goals/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadJourney(); }
async function careBrief(clientId){
  const btn=$('cbBtn'); btn.disabled=true; const l=btn.textContent; btn.textContent='✦ Thinking…';
  try{ const { brief }=await api('/clients/'+clientId+'/care-brief',{method:'POST'});
    $('careBriefOut').innerHTML=`<div class="ama-banner ama-low" style="margin-top:12px">
      <div class="ama-head" style="color:var(--gold)">✦ AI Care Brief — for the team today</div>
      <div class="ama-sum">${esc(brief.summary||'')}</div>
      ${(brief.feel_cared_for||[]).length?`<div class="pc-section"><div class="h">Make them feel cared for today</div><ul class="ama-list">${brief.feel_cared_for.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></div>`:''}
      ${brief.watch?`<div class="pc-section"><div class="h">Watch</div><div class="pc-note">${esc(brief.watch)}</div></div>`:''}</div>`;
  }catch(e){ alert(e.message); }
  finally{ btn.disabled=false; btn.textContent=l; }
}

/* ---- nursing ---- */
async function loadNursing(){
  if(!$('nu_client').value) await fillClientSelect($('nu_client'), null);
  const cid=$('nu_client').value; if(!cid){ $('nursingArea').innerHTML='<div class="empty">Pick a client.</div>'; return; }
  const n = await api('/clients/'+cid+'/nursing');
  const meds = n.meds.length ? n.meds.map(m=>`<div class="todo">
      <div class="txt"><strong>${esc(m.name)}</strong> ${esc(m.dose||'')} ${esc(m.route||'')} ${m.schedule?'· '+esc(m.schedule):''} ${m.prn?'<span class="chip">PRN</span>':''}</div>
      <button class="btn btn-ghost btn-sm sans" onclick="giveMed(${m.id},'Given')">Given</button>
      <button class="btn btn-ghost btn-sm sans" onclick="giveMed(${m.id},'Refused')">Refused</button>
      <button class="btn btn-ghost btn-sm sans" onclick="giveMed(${m.id},'Held')">Held</button>
      <button class="btn btn-danger btn-sm sans" onclick="stopMed(${m.id})">Stop</button>
    </div>`).join('') : '<div class="pc-note">No active meds.</div>';
  const mar = n.recentAdmin.length ? n.recentAdmin.map(a=>`<div class="pc-note">${esc(a.given_at)} — ${esc(a.name)}: <strong>${esc(a.status)}</strong></div>`).join('') : '<div class="pc-note">No administrations logged.</div>';
  const vit = n.vitals.length ? n.vitals.map(v=>`<div class="pc-note">${esc(v.taken_at)} — BP ${esc(v.bp||'-')} · HR ${esc(v.hr||'-')} · T ${esc(v.temp||'-')} · RR ${esc(v.resp||'-')} · O₂ ${esc(v.o2||'-')}${v.note?' · '+esc(v.note):''}</div>`).join('') : '<div class="pc-note">No vitals.</div>';
  const wd = n.withdrawal.length ? n.withdrawal.map(w=>`<div class="pc-note">${esc(w.taken_at)} — ${esc(w.scale)}: <strong>${w.score}</strong>${w.note?' · '+esc(w.note):''}</div>`).join('') : '<div class="pc-note">No scores.</div>';
  $('nursingArea').innerHTML = `
    <div class="card"><h3>Medications</h3>${meds}
      <div class="sv-cat">Add medication</div>
      <div class="grid3"><div><input id="md_name" placeholder="Name"/></div><div><input id="md_dose" placeholder="Dose"/></div><div><input id="md_route" placeholder="Route"/></div></div>
      <div class="grid2"><div><input id="md_sched" placeholder="Schedule (e.g. BID)"/></div><div><label class="sans" style="text-transform:none;letter-spacing:0"><input type="checkbox" id="md_prn" style="width:auto"/> PRN</label></div></div>
      <div class="toolbar"><button class="btn btn-gold btn-sm sans" onclick="addMed()">Add med</button></div>
    </div>
    <div class="row" style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      <div class="card" style="flex:1;min-width:260px"><h3>Vitals</h3>${vit}
        <div class="grid3" style="margin-top:8px"><div><input id="v_bp" placeholder="BP"/></div><div><input id="v_hr" placeholder="HR"/></div><div><input id="v_temp" placeholder="Temp"/></div></div>
        <div class="grid3"><div><input id="v_resp" placeholder="RR"/></div><div><input id="v_o2" placeholder="O₂%"/></div><div><input id="v_wt" placeholder="Weight"/></div></div>
        <div class="toolbar"><button class="btn btn-ghost btn-sm sans" onclick="addVitals()">Record vitals</button></div>
      </div>
      <div class="card" style="flex:1;min-width:260px"><h3>Withdrawal scale</h3>${wd}
        <div class="grid2" style="margin-top:8px"><div><select id="w_scale"><option>CIWA-Ar</option><option>COWS</option></select></div><div><input id="w_score" type="number" placeholder="Score"/></div></div>
        <input id="w_note" placeholder="Note (optional)"/>
        <div class="toolbar"><button class="btn btn-ghost btn-sm sans" onclick="addWithdrawal()">Record score</button></div>
      </div>
    </div>
    <div class="card"><h3>Recent MAR</h3>${mar}</div>`;
}
async function addMed(){ const cid=$('nu_client').value; if(!$('md_name').value.trim())return;
  await api('/meds',{method:'POST',body:JSON.stringify({client_id:cid,name:$('md_name').value,dose:$('md_dose').value,route:$('md_route').value,schedule:$('md_sched').value,prn:$('md_prn').checked})}); loadNursing(); }
async function giveMed(id,status){ await api('/meds/'+id+'/admin',{method:'POST',body:JSON.stringify({status})}); loadNursing(); }
async function stopMed(id){ if(confirm('Stop this medication?')){ await api('/meds/'+id+'/stop',{method:'POST'}); loadNursing(); } }
async function addVitals(){ const cid=$('nu_client').value;
  await api('/vitals',{method:'POST',body:JSON.stringify({client_id:cid,bp:$('v_bp').value,hr:$('v_hr').value,temp:$('v_temp').value,resp:$('v_resp').value,o2:$('v_o2').value,weight:$('v_wt').value})}); loadNursing(); }
async function addWithdrawal(){ const cid=$('nu_client').value; if($('w_score').value==='')return;
  await api('/withdrawal',{method:'POST',body:JSON.stringify({client_id:cid,scale:$('w_scale').value,score:$('w_score').value,note:$('w_note').value})}); loadNursing(); }
function openNursing(id){ show('nursing'); setTimeout(async()=>{ await fillClientSelect($('nu_client'),null); $('nu_client').value=id; loadNursing(); },50); }

/* ---- family ---- */
async function loadFamily(){
  if(!$('fm_client').value) await fillClientSelect($('fm_client'), null);
  const cid=$('fm_client').value; if(!cid){ $('familyArea').innerHTML='<div class="empty">Pick a client.</div>'; return; }
  const f = await api('/clients/'+cid+'/family');
  const contacts = f.contacts.length ? f.contacts.map(c=>`<div class="pc-note"><strong>${esc(c.name)}</strong>${c.relationship?' ('+esc(c.relationship)+')':''}${c.phone?' · '+esc(c.phone):''}${c.email?' · '+esc(c.email):''}</div>`).join('') : '<div class="pc-note">No contacts yet.</div>';
  const updates = f.updates.length ? f.updates.map(u=>`<div class="pc-note">${esc(u.created_at)} — ${u.contact_name?'to '+esc(u.contact_name)+': ':''}${esc(u.text)} <span class="hint">(${esc(u.by_name||'')})</span></div>`).join('') : '<div class="pc-note">No updates shared.</div>';
  const visits = f.visits.length ? f.visits.map(v=>`<div class="todo"><div class="txt"><strong>${esc(v.date)}</strong>${v.time?' '+esc(v.time):''} · <span class="chip">${esc(v.type)}</span> ${v.contact_name?esc(v.contact_name):''} <span class="hint">${esc(v.status)}</span></div>${v.status==='Scheduled'?`<button class="btn btn-ghost btn-sm sans" onclick="setVisit(${v.id},'Completed')">Done</button><button class="btn btn-ghost btn-sm sans" onclick="setVisit(${v.id},'Cancelled')">Cancel</button>`:''}</div>`).join('') : '<div class="pc-note">No visits.</div>';
  $('familyArea').innerHTML = `
    <div class="card"><h3>Contacts</h3>${contacts}
      <div class="grid3" style="margin-top:8px"><div><input id="fc_name" placeholder="Name"/></div><div><input id="fc_rel" placeholder="Relationship"/></div><div><input id="fc_phone" placeholder="Phone"/></div></div>
      <div class="toolbar"><button class="btn btn-gold btn-sm sans" onclick="addContact()">Add contact</button></div>
    </div>
    <div class="card"><h3>Family updates</h3>${updates}
      <div class="handoff-add"><input id="fu_text" placeholder="Share an update with family…"/><button class="btn btn-ghost btn-sm sans" onclick="addFamilyUpdate()">Share</button></div>
    </div>
    <div class="card"><h3>Visits</h3>${visits}
      <div class="grid3" style="margin-top:8px"><div><input id="fv_date" type="date"/></div><div><input id="fv_time" type="time"/></div><div><select id="fv_type"><option>In-person</option><option>Virtual</option><option>Family therapy</option></select></div></div>
      <div class="handoff-add"><input id="fv_name" placeholder="Who's visiting (optional)"/><button class="btn btn-gold btn-sm sans" onclick="addVisit()">Schedule visit</button></div>
    </div>`;
}
async function addContact(){ const cid=$('fm_client').value; if(!$('fc_name').value.trim())return; await api('/family/contacts',{method:'POST',body:JSON.stringify({client_id:cid,name:$('fc_name').value,relationship:$('fc_rel').value,phone:$('fc_phone').value})}); loadFamily(); }
async function addFamilyUpdate(){ const cid=$('fm_client').value; if(!$('fu_text').value.trim())return; await api('/family/updates',{method:'POST',body:JSON.stringify({client_id:cid,text:$('fu_text').value})}); loadFamily(); }
async function addVisit(){ const cid=$('fm_client').value; if(!$('fv_date').value)return; await api('/visits',{method:'POST',body:JSON.stringify({client_id:cid,date:$('fv_date').value,time:$('fv_time').value,type:$('fv_type').value,contact_name:$('fv_name').value})}); loadFamily(); }
async function setVisit(id,status){ await api('/visits/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadFamily(); }
function openFamily(id){ show('family'); setTimeout(async()=>{ await fillClientSelect($('fm_client'),null); $('fm_client').value=id; loadFamily(); },50); }

/* ---- admissions + bed board ---- */
async function loadAdmissions(){
  const { admissions } = await api('/admissions');
  const stages=['Inquiry','Screening','Scheduled','Admitted','Declined'];
  $('admBoard').innerHTML = admissions.length ? admissions.map(a=>`<div class="todo">
      <div class="txt"><strong>${esc(a.name)}</strong> <span class="chip">${esc(a.status)}</span>${a.referral_source?' · '+esc(a.referral_source):''}${a.phone?' · '+esc(a.phone):''}${a.scheduled_date?' · '+esc(a.scheduled_date):''}</div>
      ${a.status!=='Admitted'&&a.status!=='Declined'?`<select onchange="setAdmStatus(${a.id},this.value)" class="sans" style="width:auto">${stages.filter(s=>s!=='Admitted').map(s=>`<option ${s===a.status?'selected':''}>${s}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm sans" onclick="admitClient(${a.id})">Admit</button>`:''}
    </div>`).join('') : '<div class="empty">No one in the pipeline yet.</div>';
  loadBeds();
}
async function addAdmission(){ if(!$('ad_name').value.trim())return;
  await api('/admissions',{method:'POST',body:JSON.stringify({name:$('ad_name').value,referral_source:$('ad_ref').value,phone:$('ad_phone').value,insurance:$('ad_ins').value,scheduled_date:$('ad_date').value||null})});
  $('ad_name').value=$('ad_ref').value=$('ad_phone').value=$('ad_ins').value=''; loadAdmissions(); }
async function setAdmStatus(id,status){ await api('/admissions/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadAdmissions(); }
async function admitClient(id){ const room=prompt('Room/bed for the new client? (optional)')||''; await api('/admissions/'+id+'/admit',{method:'POST',body:JSON.stringify({room})}); alert('Admitted — a Care Card was created. Fill in their Welcome plan to start the arrival right.'); loadAdmissions(); }
async function loadBeds(){
  const { beds } = await api('/beds');
  const cls={Open:'bed-open',Occupied:'bed-occ',Hold:'bed-hold',Cleaning:'bed-clean'};
  $('bedBoard').innerHTML = beds.length ? beds.map(b=>`<div class="bed ${cls[b.status]||''}" onclick="cycleBed(${b.id},'${b.status}')" title="click to change">
      <div class="bed-room">${esc(b.room)}${b.label?'-'+esc(b.label):''}</div>
      <div class="bed-status">${esc(b.status)}</div>${b.pref?`<div class="bed-client">${esc(b.pref)}</div>`:''}</div>`).join('') : '<div class="hint">No beds added yet.</div>';
}
async function addBed(){ if(!$('bed_room').value.trim())return; await api('/beds',{method:'POST',body:JSON.stringify({room:$('bed_room').value,label:$('bed_label').value,unit:$('bed_unit').value})}); $('bed_room').value=$('bed_label').value=''; loadBeds(); }
async function cycleBed(id,cur){ const order=['Open','Hold','Cleaning','Occupied']; const next=order[(order.indexOf(cur)+1)%order.length]; await api('/beds/'+id,{method:'POST',body:JSON.stringify({status:next})}); loadBeds(); }

/* ---- team ---- */
async function loadTeam(){
  const [{value}, t, {staff}] = await Promise.all([api('/lineup'), api('/team'), api('/staff')]);
  $('teamValue').textContent = value;
  $('trainBtn').disabled = t.trainedToday; $('trainMsg').textContent = t.trainedToday ? `✓ reviewed · ${t.trainingCount} on the team today` : `${t.trainingCount} teammates reviewed today`;
  $('ku_to').innerHTML = '<option value="">Whole team</option>'+staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('kudosFeed').innerHTML = t.kudos.length ? t.kudos.map(k=>`<div class="wow"><div>👏 ${esc(k.text)}</div><div class="wow-meta">${k.from_name?'from '+esc(k.from_name):''}${k.to_name?' → '+esc(k.to_name):''}</div></div>`).join('') : '<div class="hint">No kudos yet. Catch someone doing something great.</div>';
  if(t.pulseTrend){ const total=t.pulseTrend.reduce((a,b)=>a+b.n,0)||1;
    $('pulseTrend').innerHTML = t.pulseTrend.length ? t.pulseTrend.map(p=>`<div class="trbar"><div class="trbar-l">${esc(p.load||'—')}</div><div class="trbar-track"><div class="trbar-fill" style="width:${Math.round(p.n/total*100)}%"></div></div><div class="trbar-n">${p.n}</div></div>`).join('') : '<div class="hint">No staff pulses this week.</div>'; }
}
async function ackTraining(){ await api('/training-ack',{method:'POST',body:JSON.stringify({value_text:$('teamValue').textContent})}); loadTeam(); }
async function giveKudos(){ if(!$('ku_text').value.trim())return; await api('/kudos',{method:'POST',body:JSON.stringify({to_user_id:$('ku_to').value||null,text:$('ku_text').value})}); $('ku_text').value=''; loadTeam(); }

/* ---- AI shift briefing ---- */
async function genShiftBriefing(){
  const btn=$('briefBtn'); btn.disabled=true; const l=btn.textContent; btn.textContent='✦ Briefing…';
  $('shiftBrief').innerHTML='<div class="hint">Claude is reading the whole house…</div>';
  try{ const { brief }=await api('/shift-briefing',{method:'POST',body:JSON.stringify({shift:$('r_shift').value})});
    $('shiftBrief').innerHTML=`<div class="ama-banner ama-low" style="margin-top:12px"><div class="ama-head" style="color:var(--gold)">✦ Shift Briefing — ${esc($('r_shift').value)}</div><div class="brief-body">${esc(brief).replace(/\n/g,'<br>')}</div></div>`;
  }catch(e){ $('shiftBrief').innerHTML='<div class="hint" style="color:var(--danger)">'+e.message+'</div>'; }
  finally{ btn.disabled=false; btn.textContent=l; }
}

/* ---- surveys ---- */
let SURVEYS = [];
async function loadSurveys(){
  const { surveys } = await api('/surveys'); SURVEYS = surveys;
  $('sv_select').innerHTML = surveys.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('');
  try { const { clients } = await api('/clients');
    $('sv_client').innerHTML = '<option value="">Anonymous</option>' + clients.map(c=>`<option value="${c.id}">${esc(c.pref||c.name)}</option>`).join('');
  } catch(e){}
  $('surveyArea').innerHTML = '<div class="empty">Pick a survey and press Start.</div>';
  try {
    const { due } = await api('/surveys/due');
    $('surveyDue').innerHTML = due.length ? `<div class="card"><h3>Surveys to offer</h3>
      <p class="sub sans">The app auto-offers the Experience survey weekly and the Discharge survey after discharge.</p>
      ${due.map(d=>`<div class="todo"><div class="txt"><strong>${esc(d.client)}</strong> — ${esc(d.title)} <span class="hint">· ${esc(d.reason)}</span></div>
        <button class="btn btn-gold btn-sm sans" onclick="startDue(${d.survey_id},${d.client_id})">Offer now</button></div>`).join('')}</div>` : '';
  } catch(e){ $('surveyDue').innerHTML=''; }
}
function startDue(surveyId, clientId){
  $('sv_select').value = surveyId;
  $('sv_client').value = clientId || '';
  startSurvey();
  $('surveyArea').scrollIntoView({behavior:'smooth'});
}
async function gotoSurvey(key, clientId){
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id==='surveys'));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.view==='surveys'));
  await loadSurveys();
  const sv = SURVEYS.find(s=>s.key===key); if(!sv) return;
  $('sv_select').value = sv.id; if(clientId) $('sv_client').value = clientId;
  startSurvey();
}
function qInput(q){
  if(q.type==='text') return `<textarea class="sq-text"></textarea>`;
  if(q.type==='yesno') return `<div class="sv-opts">
      <button type="button" class="sv-opt" data-v="1" onclick="pickOpt(this)">Yes</button>
      <button type="button" class="sv-opt" data-v="0" onclick="pickOpt(this)">No</button></div>`;
  // scale / rating: 1..5
  const labels = q.type==='rating' ? ['1','2','3','4','5'] : ['1','2','3','4','5'];
  return `<div class="sv-opts">${labels.map((l,i)=>`<button type="button" class="sv-opt" data-v="${i+1}" onclick="pickOpt(this)">${l}</button>`).join('')}
    <span class="hint" style="margin-left:6px">${q.type==='rating'?'1 = poor · 5 = excellent':'1 = strongly disagree · 5 = strongly agree'}</span></div>`;
}
function pickOpt(btn){
  btn.parentNode.querySelectorAll('.sv-opt').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on'); btn.parentNode.dataset.val = btn.dataset.v;
}
function startSurvey(){
  const s = SURVEYS.find(x=>x.id==$('sv_select').value); if(!s) return;
  let cat='', html='';
  s.questions.forEach(q=>{
    if(q.category && q.category!==cat){ cat=q.category; html+=`<div class="sv-cat">${esc(cat)}</div>`; }
    html+=`<div class="sq" data-qid="${q.id}" data-type="${q.type}">
      <div class="sq-q">${esc(q.text)}</div>${qInput(q)}</div>`;
  });
  $('surveyArea').innerHTML = `<div class="card"><h3>${esc(s.title)}</h3>
    <p class="sub sans">${esc(s.description||'')}</p>${html}
    <div class="toolbar" style="margin-top:16px"><button class="btn btn-primary sans" onclick="submitSurvey(${s.id})">Submit survey</button></div>
    <div id="svMsg" class="hint"></div></div>`;
}
async function submitSurvey(id){
  const answers = [];
  document.querySelectorAll('#surveyArea .sq').forEach(sq=>{
    const qid = +sq.dataset.qid, type = sq.dataset.type;
    if(type==='text'){ const t=sq.querySelector('.sq-text').value.trim(); if(t) answers.push({question_id:qid, text:t}); }
    else { const opts=sq.querySelector('.sv-opts'); if(opts && opts.dataset.val!=null) answers.push({question_id:qid, num:+opts.dataset.val}); }
  });
  if(!answers.length){ $('svMsg').textContent='Please answer at least one question.'; return; }
  await api('/surveys/'+id+'/respond',{method:'POST',body:JSON.stringify({client_id:$('sv_client').value||null, answers})});
  $('surveyArea').innerHTML = '<div class="card"><h3>Thank you 💚</h3><p class="sans">Your responses were recorded. They help us care for everyone better.</p><button class="btn btn-ghost sans" onclick="loadSurveys()">Done</button></div>';
}
async function showSurveyResults(){
  const id = $('sv_select').value;
  let data;
  try { data = await api('/surveys/'+id+'/results'); } catch(e){ $('surveyArea').innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  const { survey, responses, questions } = data;
  let cat='', html='';
  questions.forEach(q=>{
    if(q.category && q.category!==cat){ cat=q.category; html+=`<div class="sv-cat">${esc(cat)}</div>`; }
    if(q.type==='text'){
      html += `<div class="sq"><div class="sq-q">${esc(q.text)}</div>${q.comments&&q.comments.length?'<ul class="ama-list">'+q.comments.map(c=>`<li>${esc(c)}</li>`).join('')+'</ul>':'<div class="hint">No comments yet.</div>'}</div>`;
    } else if(q.type==='yesno'){
      html += `<div class="sq res"><div class="sq-q">${esc(q.text)}</div><div class="res-val">${q.yesPct!=null?q.yesPct+'% yes <span class="hint">('+q.count+')</span>':'<span class="hint">no responses</span>'}</div></div>`;
    } else {
      const low = q.avg!=null && q.avg<3.5;
      const pct = q.avg!=null ? Math.round(q.avg/5*100) : 0;
      html += `<div class="sq res"><div class="sq-q">${esc(q.text)}</div>
        <div class="res-bar"><div class="res-track"><div class="res-fill ${low?'low':''}" style="width:${pct}%"></div></div>
        <div class="res-num ${low?'low':''}">${q.avg!=null?q.avg+'/5':'—'} <span class="hint">(${q.count})</span></div></div></div>`;
    }
  });
  $('surveyArea').innerHTML = `<div class="card"><h3>${esc(survey.title)} — results</h3>
    <p class="sub sans">${responses} response${responses===1?'':'s'}. Scores under 3.5 are flagged. Low "feel cared for" scores are an early AMA signal.</p>${html}</div>`;
}

/* ---- weekly report ---- */
async function loadReport(){
  const { html, emailConfigured } = await api('/report/weekly');
  $('reportPreview').innerHTML = html;
  const btn = $('sendReportBtn');
  btn.style.display = emailConfigured ? 'inline-block' : 'none';
  $('reportEmailHint').textContent = emailConfigured
    ? 'Auto-sends every Monday. You can also send it now.'
    : 'Email isn\'t set up yet — you can still print or save as PDF. To enable email + the weekly auto-send, set RESEND_API_KEY and REPORT_TO in Render.';
}
async function sendReport(){
  const btn = $('sendReportBtn'); btn.disabled = true; const l = btn.textContent; btn.textContent = 'Sending…';
  try { await api('/report/send',{method:'POST'}); $('reportEmailHint').textContent = '✓ Sent to leadership.'; }
  catch(e){ $('reportEmailHint').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = l; }
}

/* ---- audit ---- */
async function loadAudit(){
  const { entries } = await api('/audit');
  $('auditList').innerHTML = `<table class="tbl"><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr>${
    entries.map(e=>`<tr><td>${esc(e.at)}</td><td>${esc(e.username||'')}</td><td>${esc(e.action)}</td>
      <td>${esc(e.entity||'')} ${e.entity_id||''}</td><td>${esc(e.detail||'')}</td></tr>`).join('')}</table>`;
}

/* ---- brand logo: if an official /logo.png is added to the repo, use it ---- */
// Drop a file at public/logo.png (the horizontal Armada lockup) and it replaces
// the SVG fallback automatically — no code change needed.
(function applyBrandLogo(){
  const probe = new Image();
  probe.onload = () => {            // only fires for a real image, not the SPA's index.html fallback
    const el = document.getElementById('loginBrand');
    if (el) el.innerHTML = '<img src="/logo.png" alt="Armada Recovery" class="login-lockup"/>';
  };
  probe.src = '/logo.png?v=' + Date.now();
})();

/* ---- start ---- */
(async()=>{ try{ const { user } = await api('/me'); if(user){ ME=user; boot(); } else showLogin(); }catch(e){ showLogin(); } })();
