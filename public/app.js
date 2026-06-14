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
let mfaTicket = null;
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginErr').textContent='';
  try {
    if (mfaTicket) {
      const { user } = await api('/login/mfa', { method:'POST', body: JSON.stringify({ ticket: mfaTicket, code: $('l_code').value }) });
      mfaTicket = null; ME = user; boot(); return;
    }
    const r = await api('/login', { method:'POST', body: JSON.stringify({ username:$('l_user').value, password:$('l_pass').value }) });
    if (r.mfaRequired) { mfaTicket = r.ticket; $('mfaRow').style.display='block'; $('l_code').focus(); $('loginBtn').textContent='Verify code'; return; }
    ME = r.user; boot();
  } catch(err){ $('loginErr').textContent = err.message; }
});
async function manageMfa(){
  if(!ME){ alert('Sign in first.'); return; }
  if(ME.mfaEnabled){ if(confirm('Two-factor is ON for your account. Turn it off?')){ await api('/mfa/disable',{method:'POST'}); ME.mfaEnabled=false; alert('Two-factor disabled.'); } return; }
  const { secret } = await api('/mfa/setup');
  const code = prompt('Set up two-factor:\n\n1) Open Google Authenticator / Authy → add account → "Enter a setup key".\n2) Account: Armada Care · Key:\n\n'+secret+'\n\n3) Type the 6-digit code it shows:');
  if(!code) return;
  try{ await api('/mfa/enable',{method:'POST',body:JSON.stringify({code})}); ME.mfaEnabled=true; alert('✓ Two-factor enabled. You\'ll enter a code each time you sign in.'); }
  catch(e){ alert(e.message); }
}
/* auto-logoff after inactivity (HIPAA) */
let idleTimer=null;
function resetIdle(){ clearTimeout(idleTimer); idleTimer=setTimeout(()=>{ if(ME){ alert('Signed out after 15 minutes of inactivity.'); doLogout(); } }, 15*60000); }
['click','keydown','mousemove','touchstart'].forEach(ev=>document.addEventListener(ev, resetIdle, {passive:true}));
async function doLogout(){ await api('/logout',{method:'POST'}); location.reload(); }

/* ---- night mode + PWA + voice ---- */
function applyTheme(t){ document.documentElement.dataset.theme = t==='dark'?'dark':''; const b=$('themeBtn'); if(b) b.textContent = t==='dark'?'☀️':'🌙'; }
function toggleTheme(){ const cur=document.documentElement.dataset.theme==='dark'?'dark':'light'; const next=cur==='dark'?'light':'dark'; localStorage.setItem('theme',next); applyTheme(next); }
(function initTheme(){ const saved=localStorage.getItem('theme'); const hr=new Date().getHours(); applyTheme(saved || ((hr>=19||hr<6)?'dark':'light')); })();
if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js').catch(()=>{}); }
function dictateInto(btn){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ alert('Voice capture needs Chrome or Edge.'); return; }
  const w=btn.closest('.voicewrap')||btn.parentNode; const inp=w.querySelector('input,textarea'); if(!inp) return;
  const r=new SR(); r.lang='en-US'; r.interimResults=false; r.maxAlternatives=1;
  btn.textContent='●'; btn.disabled=true;
  r.onresult=e=>{ const t=e.results[0][0].transcript; inp.value=(inp.value?inp.value.trim()+' ':'')+t; inp.dispatchEvent(new Event('input')); };
  r.onend=()=>{ btn.textContent='🎤'; btn.disabled=false; };
  r.onerror=()=>{ btn.textContent='🎤'; btn.disabled=false; };
  try{ r.start(); }catch(e){ btn.textContent='🎤'; btn.disabled=false; }
}
async function changeMyPassword(){
  const current = prompt('Current password:'); if(current===null) return;
  const next = prompt('New password (at least 6 characters):'); if(!next) return;
  try { await api('/change-password',{method:'POST',body:JSON.stringify({current,next})}); alert('Password changed.'); }
  catch(e){ alert(e.message); }
}

async function boot(){
  $('loginScreen').style.display='none'; $('app').style.display='block';
  $('whoami').textContent = `${ME.name}${ME.role==='admin'?' · Admin':''}`;
  if($('sideAvatar')) $('sideAvatar').textContent = initials(ME.name);
  document.querySelectorAll('[data-admin]').forEach(el => el.style.display = ME.role==='admin' ? '' : 'none');
  try { META = await api('/meta'); } catch(e){}
  if (META.claude) { $('aiBtn').style.display = 'inline-block'; $('briefBtn').style.display = 'inline-block'; }
  // fill shift/role selects
  fillSelect($('r_shift'), META.shifts); fillSelect($('a_shift'), META.shifts);
  fillSelect($('r_role'), ['All', ...META.jobRoles]);
  fillSelect($('u_job'), META.jobRoles);
  $('r_date').value = today(); $('a_date').value = today();
  renderGroups();
  // Role-based landing: everyone opens already where they work.
  const landing = ME.role==='admin' ? 'command'
    : ({ 'Nurse':'retention', 'Therapist':'casemgmt', 'BHT / Tech':'report', 'Kitchen':'concierge' }[ME.job_role] || 'today');
  show(landing);
}
function fillSelect(el, items){ el.innerHTML = items.map(i=>`<option>${esc(i)}</option>`).join(''); }
// Build a deep link to a patient's Kipu chart from the configured URL pattern.
// Tokens: {id} full kipu_id, {master} numeric master id, {casefile} UUID.
function kipuWebLink(kipuId){
  const tpl = META && META.kipuWeb; if(!tpl || !kipuId) return '';
  const id = String(kipuId); const parts = id.split(':');
  return tpl.replace(/\{id\}/g, encodeURIComponent(id))
            .replace(/\{master\}/g, encodeURIComponent(parts[0]||''))
            .replace(/\{casefile\}/g, encodeURIComponent(parts[1]||''));
}

/* ---- grouped nav (role-aware: everyday up top; leadership & admin tucked away) ---- */
const GROUPS=[
  {g:'today',label:'Today',first:'today'},
  {g:'clients',label:'Clients',first:'clients'},
  {g:'care',label:'Care',first:'report'},
  {g:'clinical',label:'Clinical',first:'casemgmt'},
  {g:'frontdoor',label:'Front Door',first:'arrivals'},
  {g:'team',label:'Team',first:'mytasks'},
  {g:'command',label:'Command',first:'command',admin:true},
];
const GROUP_OF={
  today:'today',lineup:'today',
  clients:'clients',editor:'clients',journey:'clients',family:'clients',
  report:'care',concierge:'care',dignity:'care',rounds:'care',program:'care',
  casemgmt:'clinical',retention:'clinical',surveys:'clinical',incidents:'clinical',
  arrivals:'frontdoor',admissions:'frontdoor',referrals:'frontdoor',partners:'frontdoor',alumni:'frontdoor',
  mytasks:'team',team:'team',coverage:'team',schedule:'team',assign:'team',training:'team',library:'team',standard:'team',
  command:'command',compliance:'command',accountability:'command',outcomes:'command',analytics:'command',scorecard:'command','report-view':'command',settings:'command',users:'command',audit:'command',askai:'command',
};
function renderGroups(){
  const isAdmin = ME && ME.role==='admin';
  const mk = x=>`<button data-g="${x.g}"${x.admin?' class="side-admingroup"':''}>${x.label}</button>`;
  const everyday = GROUPS.filter(x=>!x.admin).map(mk).join('');
  const leadership = isAdmin ? GROUPS.filter(x=>x.admin).map(mk).join('') : '';
  $('groupbar').innerHTML = everyday + (leadership ? '<div class="side-divider"></div>'+leadership : '');
  document.querySelectorAll('#nav button').forEach(b=>{ b.dataset.group = GROUP_OF[b.dataset.view]||'care'; });
  document.querySelectorAll('#groupbar button').forEach(b=>b.onclick=()=>{ const grp=GROUPS.find(x=>x.g===b.dataset.g); show(grp.first); });
}
function selectGroup(g){
  document.querySelectorAll('#groupbar button').forEach(b=>b.classList.toggle('active', b.dataset.g===g));
  const navBtns=[...document.querySelectorAll('#nav button')];
  navBtns.forEach(b=>{
    const adminHidden = b.hasAttribute('data-admin') && ME && ME.role!=='admin';
    const sub = b.hasAttribute('data-subview');   // reached via in-page tabs, not the sidebar
    b.style.display = (b.dataset.group===g && !adminHidden && !sub) ? '' : 'none';
  });
  // Hide the sub-nav when a section has only one screen (no redundant repeat).
  const visible=navBtns.filter(b=>b.dataset.group===g && b.style.display!=='none').length;
  const navEl=document.getElementById('nav'); if(navEl) navEl.style.display = visible<=1 ? 'none' : '';
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => show(b.dataset.view));
function toggleNav(){ document.getElementById('shell').classList.toggle('nav-open'); }
function show(v){
  selectGroup(GROUP_OF[v]||'care');
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id===v));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.querySelectorAll('.itab').forEach(b=>b.classList.toggle('active', b.dataset.tab===v));   // Insights tabs
  const activeBtn=document.querySelector(`#nav button[data-view="${v}"]`);
  const noNavTitles={journey:'Client 360',editor:'Care Card',analytics:'Risk Analytics',scorecard:'Scorecard',accountability:'Accountability','report-view':'Reports',surveys:'Surveys',incidents:'Incidents',partners:'Partners',coverage:'Coverage',assign:'Assign Staff',standard:'The Standard',lineup:'Daily Lineup',dignity:'Dignity Kits',family:'Family',askai:'Ask AI'};
  if($('topbarTitle')) $('topbarTitle').textContent = (noNavTitles[v]) || (activeBtn ? activeBtn.textContent : $('topbarTitle').textContent);
  document.getElementById('shell')?.classList.remove('nav-open');
  if(v==='today') loadToday();
  if(v==='command') loadCommand();
  if(v==='compliance') loadCompliance();
  if(v==='askai') loadAskAI();
  if(v==='incidents') loadIncidents();
  if(v==='alumni') loadAlumni();
  if(v==='accountability') loadAccountability();
  if(v==='standard') loadStandard();
  if(v==='library') loadLibrary();
  if(v==='training') loadTraining();
  if(v==='scorecard') loadScorecard();
  if(v==='mytasks') loadMyTasks();
  if(v==='settings') loadSettings();
  if(v==='referrals') loadReferrals();
  if(v==='partners') loadPartners();
  if(v==='analytics') loadAnalytics();
  if(v==='coverage') loadCoverage();
  if(v==='schedule') loadSchedule();
  if(v==='clients') renderClients();
  if(v==='retention') loadRetention();
  if(v==='casemgmt') loadCaseMgmt();
  if(v==='dignity') loadDignity();
  if(v==='rounds') loadRounds();
  if(v==='arrivals') loadArrivals();
  if(v==='outcomes') loadOutcomes();
  if(v==='lineup') loadLineup();
  if(v==='surveys') loadSurveys();
  if(v==='concierge') loadConcierge();
  if(v==='program') loadProgram();
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
  // Single source of truth: with Kipu connected, clients come from the chart —
  // no manual creation. Otherwise allow it (standalone/demo use).
  if($('clientsToolbar')) $('clientsToolbar').innerHTML = (META&&META.kipu)
    ? '<span class="hint">Clients sync from Kipu. Create the admission in Kipu — the Care Card appears here to fill in.</span>'
    : '<button class="btn btn-gold sans" onclick="newClient()">+ New Client Care Card</button>';
  const g = $('clientGrid'); g.innerHTML='';
  $('clientEmpty').style.display = clients.length ? 'none':'block';
  clients.forEach(c => {
    const d = document.createElement('div'); d.className='ctile'; d.onclick=()=>openJourney(c.id);
    const snap = c.summary ? `<div class="pref" style="font-style:normal;color:#4a5a56">${esc(c.summary.slice(0,140))}${c.summary.length>140?'…':''}</div>`
      : (c.touch ? `<div class="pref">★ ${esc(c.touch.slice(0,90))}${c.touch.length>90?'…':''}</div>` : '');
    d.innerHTML = `<div style="display:flex;gap:12px;align-items:flex-start">${c.photo?`<img src="${esc(c.photo)}" class="client-photo sm" alt=""/>`:''}<div style="flex:1;min-width:0"><h4>${esc(c.pref||c.name||'Unnamed')}</h4>
      <div class="meta">${esc(c.name||'')} ${c.room?'· Room '+esc(c.room):''}</div>
      <div class="meta">${esc(c.program||'')}</div></div></div>${snap}
      <div style="margin-top:8px">${(c.tasks||[]).length} task${(c.tasks||[]).length===1?'':'s'}</div>`;
    g.appendChild(d);
  });
}

function newClient(){
  // Single source of truth: clients are admitted in Kipu (via Salesforce) and
  // sync in automatically — never created here by hand.
  if(META&&META.kipu){ alert('Clients are admitted in Kipu (created in Salesforce → sent to Kipu). Once admitted, they appear here automatically — there is no manual add.'); show('clients'); return; }
  currentId=null; fillForm({}); $('editorTitle').textContent='New Care Card'; $('deleteBtn').style.display='none'; $('dischargeBox').style.display='none'; if($('kipuChartCard'))$('kipuChartCard').style.display='none'; if($('photoCard'))$('photoCard').style.display='none'; show('editor');
}
async function editClient(id){
  const { client } = await api('/clients/'+id);
  currentId = id; fillForm(client);
  $('editorTitle').textContent = 'Care Card · '+(client.pref||client.name||'');
  $('deleteBtn').style.display = ME.role==='admin' ? 'inline-block':'none';
  $('dischargeBox').style.display='block'; $('d_date').value = today();
  show('editor');
  if(client.kipu_id) loadKipuChart(id); else if($('kipuChartCard')) $('kipuChartCard').style.display='none';
}
async function loadKipuChart(cid, reload){
  const card=$('kipuChartCard'); if(!card) return;
  card.style.display='';
  await chartRender(cid, 'kipuChartList', 'kipuChartSub', reload);
}
async function loadJourneyChart(cid){
  const btn=$('jChartBtn'); if(btn){ btn.disabled=true; btn.textContent='Loading…'; }
  if($('jChartFilter')) $('jChartFilter').style.display='';
  await chartRender(cid, 'jChartList', null, true);
  if(btn) btn.style.display='none';
}
async function chartRender(cid, listId, subId, reload, all){
  const listEl=$(listId); if(!listEl) return;
  if(reload) listEl.innerHTML='<div class="hint">Loading the chart…</div>';
  try{
    const d=await api('/clients/'+cid+'/chart'+(all?'?all=1':''));
    if(!d.kipu){ listEl.innerHTML='<div class="hint">This client isn\'t linked to Kipu yet (sync the roster).</div>'; return; }
    const extras=d.extras||[];
    if(!d.evaluations.length && !extras.length){ listEl.innerHTML='<div class="hint">No documents found in Kipu for this client'+(all?'.':' for the current stay. <a href="#" onclick="chartRender('+cid+',\''+listId+'\',\''+(subId||'')+'\',true,true);return false">Show full history →</a>')+'</div>'; return; }
    if(subId&&$(subId)) $(subId).textContent = `${all?'Full history':'Current stay'} · ${d.evaluations.length} notes${extras.length?' + '+extras.length+' meds/vitals/labs/scales':''} — click any to read it.`;
    const toggle = `<div style="margin-bottom:10px"><button class="btn btn-ghost btn-sm sans" onclick="chartRender(${cid},'${listId}','${subId||''}',true,${all?'false':'true'})">${all?'← Current stay only':'Show full history (all admissions) →'}</button></div>`;
    let extraHtml='';
    if(extras.length){
      const cats=[...new Set(extras.map(x=>x.category))];
      extraHtml = '<div class="cmd-sub">Medications · Vitals · Withdrawal scales · Labs</div>'+cats.map(cat=>{
        const items=extras.filter(x=>x.category===cat);
        return `<details class="chart-note"><summary><span class="chart-name">${esc(cat)}</span> <span class="hint">· ${items.length}</span></summary><div class="chart-body">${items.map(it=>`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><strong class="hint">${esc(it.date||'')}</strong>\n${esc(it.content)}</div>`).join('')}</div></details>`;
      }).join('');
    }
    const notesHtml = d.evaluations.length ? '<div class="cmd-sub">Notes &amp; forms</div>'+d.evaluations.map(e=>`<details class="chart-note"><summary><span class="chart-name">${esc(e.name)}</span>${e.date?` <span class="hint">· ${esc(e.date)}</span>`:''}</summary><div class="chart-body" data-cid="${cid}" data-eid="${esc(String(e.id))}" data-loaded="0">Loading…</div></details>`).join('') : '';
    const diagHtml = (ME&&ME.role==='admin'&&d.diag&&d.diag.length) ? `<details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Source diagnostic</summary><div class="hint" style="white-space:pre-wrap">${d.diag.map(x=>`${x.cat}: ${x.count==null?'not available':x.count+' records'}`).join('\n')}</div></details>` : '';
    listEl.innerHTML = toggle + extraHtml + notesHtml + diagHtml;
    listEl.querySelectorAll('details').forEach(dt=>dt.addEventListener('toggle',function(){ if(this.open){ const b=this.querySelector('.chart-body[data-loaded="0"]'); if(b){ b.dataset.loaded='1'; openChartNote(b); } } }));
  }catch(e){ listEl.innerHTML='<div class="hint" style="color:var(--danger)">'+esc(e.message)+'</div>'; }
}
async function openChartNote(b){
  try{ const d=await api('/clients/'+b.dataset.cid+'/chart/'+encodeURIComponent(b.dataset.eid)); b.textContent = d.content || '(no readable content in this note)'; }
  catch(e){ b.textContent='Could not load this note — '+(e.message||'error'); }
}
function filterChartIn(listId){ const inp = listId==='jChartList'?$('jChartFilter'):$('kipuChartFilter'); const q=(inp?inp.value:'').toLowerCase(); ($(listId)||document).querySelectorAll('details').forEach(dt=>{ const el=dt.querySelector('.chart-name'); const nm=(el?el.textContent:'').toLowerCase(); dt.style.display=(!q||nm.includes(q))?'':'none'; }); }
async function dischargeClient(){
  if(!currentId) return;
  const status=$('d_status').value;
  if(!confirm(`Discharge this client as "${status}"? This starts the aftercare calls and removes them from the active playbook.`)) return;
  const cid = currentId;
  const steps = [...document.querySelectorAll('#safeDeparture .sd:checked')].map(c=>c.dataset.s);
  await api('/clients/'+currentId+'/discharge',{method:'POST',body:JSON.stringify({status,date:$('d_date').value,steps,reason:$('d_reason').value,followthrough:$('d_follow').value,improve:$('d_improve').value})});
  if(status!=='Transferred' && confirm('Discharged — aftercare calls scheduled.\n\nWould you like to do the Discharge survey with the client now?')){
    gotoSurvey('discharge', cid);
  } else {
    alert('Discharged. Aftercare calls scheduled — see the Outcomes tab.');
    show('clients');
  }
}
const FF = ['name','pref','room','program','admit','admit_time','sober','therapist','case_manager','referral_source','touch','prefs','goals','triggers','safety','support','anchor_why','welcome_plan','aftercare_plan'];
function fillForm(c){
  FF.forEach(f => $('f_'+f).value = c[f]||'');
  // Identity comes from Kipu (single source of truth) — lock those fields; staff
  // edit the hospitality/preferences fields only.
  const fromKipu = !!c.kipu_id;
  // Identity + care team come from Kipu (therapist/CM are read from note authors) — locked here.
  ['name','room','program','admit','admit_time','therapist','case_manager'].forEach(f=>{ const el=$('f_'+f); if(el){ el.readOnly=fromKipu; el.classList.toggle('locked',fromKipu); el.title = fromKipu?'From Kipu — edit in the chart':''; } });
  // Welcome + aftercare plans are authored by Claude from policy, never free-typed.
  ['welcome_plan','aftercare_plan'].forEach(f=>{ const el=$('f_'+f); if(el){ el.readOnly=true; el.classList.add('locked'); } });
  // Deep link to this patient's Kipu chart (opens out of the app).
  const kl=$('kipuOpenLink');
  if(kl){ const url=kipuWebLink(c.kipu_id); if(url){ kl.href=url; kl.style.display=''; } else kl.style.display='none'; }
  renderKipuDemo(c);
  renderPhotoCard(c);
  const tl = $('taskList'); tl.innerHTML='';
  (c.tasks||[]).forEach(t=>addTaskRow(t));
  if(!(c.tasks||[]).length) addTaskRow();
}
function renderPhotoCard(c){
  const card=$('photoCard'); if(!card) return;
  if(!currentId){ card.style.display='none'; return; }   // only for saved clients
  card.style.display='';
  $('photoThumb').innerHTML = c.photo ? `<img src="${esc(c.photo)}" class="client-photo lg" alt=""/>` : `<span class="avatar" style="width:72px;height:72px;font-size:26px">${initials(c.name||c.pref)}</span>`;
  $('photoClearBtn').style.display = c.photo ? 'inline-block' : 'none';
}
async function genWelcomePlan(){
  if(!currentId){ alert('Save the Care Card first.'); return; }
  const btn=$('welcomeBtn'); btn.disabled=true; $('welcomeMsg').textContent='Writing from policy…';
  try{ const r=await api('/clients/'+currentId+'/welcome-plan',{method:'POST'}); $('f_welcome_plan').value=r.welcome_plan||''; $('welcomeMsg').textContent='✓ Generated'; }
  catch(e){ $('welcomeMsg').textContent='Error: '+(e.message||'failed'); }
  finally{ btn.disabled=false; }
}
async function genAftercarePlan(){
  if(!currentId){ alert('Save the Care Card first.'); return; }
  const btn=$('aftercareBtn'); btn.disabled=true; $('aftercareMsg').textContent='Writing from policy…';
  try{ const r=await api('/clients/'+currentId+'/aftercare-plan',{method:'POST'}); $('f_aftercare_plan').value=r.aftercare_plan||''; $('aftercareMsg').textContent='✓ Generated'; }
  catch(e){ $('aftercareMsg').textContent='Error: '+(e.message||'failed'); }
  finally{ btn.disabled=false; }
}
async function uploadPhoto(input){
  const file=input.files && input.files[0]; if(!file) return;
  $('photoMsg').textContent='Processing…';
  try{
    const dataUrl = await resizeImage(file, 360, 0.82);
    await api('/clients/'+currentId+'/photo',{method:'POST',body:JSON.stringify({photo:dataUrl})});
    $('photoMsg').textContent='✓ Saved';
    $('photoThumb').innerHTML = `<img src="${dataUrl}" class="client-photo lg" alt=""/>`;
    $('photoClearBtn').style.display='inline-block';
  }catch(e){ $('photoMsg').textContent='Could not save: '+(e.message||'error'); }
  input.value='';
}
async function clearPhoto(){
  if(!confirm('Remove this client\'s photo?')) return;
  await api('/clients/'+currentId+'/photo',{method:'POST',body:JSON.stringify({photo:null})});
  renderPhotoCard({name:$('f_name').value,pref:$('f_pref').value});
  $('photoMsg').textContent='Removed';
}
// Downscale + compress an image file to a small JPEG data URL (client-side).
function resizeImage(file, max, quality){
  return new Promise((resolve,reject)=>{
    const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let {width:w,height:h}=img; if(w>h && w>max){ h=Math.round(h*max/w); w=max; } else if(h>max){ w=Math.round(w*max/h); h=max; }
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      resolve(cv.toDataURL('image/jpeg',quality||0.82));
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src=url;
  });
}
function ageFrom(dob){ if(!dob) return null; const d=new Date(dob); if(isNaN(d)) return null; const t=new Date(); let a=t.getFullYear()-d.getFullYear(); if(t.getMonth()<d.getMonth()||(t.getMonth()===d.getMonth()&&t.getDate()<d.getDate())) a--; return (a>=0&&a<120)?a:null; }
function renderKipuDemo(c){
  const box=$('kipuDemo'), body=$('kipuDemoBody'); if(!box) return;
  const age=ageFrom(c.dob);
  const items=[
    ['Date of birth', c.dob ? esc((c.dob||'').slice(0,10))+(age!=null?` · ${age} yrs`:'') : ''],
    ['Level of care', c.loc && c.loc!=='Unspecified' ? esc(c.loc) : ''],
    ['Next level of care', c.next_loc ? esc(c.next_loc) : ''],
    ['Anticipated discharge', c.anticipated_dc ? esc((c.anticipated_dc||'').slice(0,10)) : ''],
    ['Diagnosis', c.diagnosis ? esc(c.diagnosis) : ''],
    ['Insurance', c.insurance ? esc(c.insurance) : ''],
    ['Phone', c.phone ? esc(c.phone) : ''],
    ['Pronouns', c.pronouns ? esc(c.pronouns) : ''],
    ['Language', c.language ? esc(c.language) : ''],
    ['MRN', c.mrn ? esc(c.mrn) : ''],
    ['Referral source', c.referral_source ? esc(c.referral_source) : ''],
  ].filter(x=>x[1]);
  if(!items.length){ box.style.display='none'; return; }
  box.style.display='';
  body.innerHTML = items.map(([k,v])=>`<div class="kdemo-item"><div class="kdemo-k">${k}</div><div class="kdemo-v">${v}</div></div>`).join('');
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

async function setCrisisOwner(uid){
  await api('/crisis-owner',{method:'POST',body:JSON.stringify({date:$('r_date').value,shift:$('r_shift').value,user_id:uid||null})});
  loadPlaybook();
}

/* ---- library (SOPs & policies) ---- */
let DOCS = [];
async function loadLibrary(){ const { docs } = await api('/docs'); DOCS = docs; renderDocs(); }
function renderDocs(){
  const q=($('libSearch').value||'').toLowerCase();
  const list = DOCS.filter(d=> !q || (d.title+d.body+d.category+(d.tags||'')).toLowerCase().includes(q));
  $('libList').innerHTML = list.length ? list.map(d=>`<div class="card">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="chip">${esc(d.category)}</span><h3 style="margin:0">${esc(d.title)}</h3>
      <span style="margin-left:auto" class="hint">${d.read?'✓ reviewed':''}</span></div>
    <div class="brief-body" style="margin-top:8px;white-space:pre-wrap">${esc(d.body)}</div>
    <div class="toolbar" style="justify-content:flex-start;margin-top:8px">
      ${d.read?'':`<button class="btn btn-ghost btn-sm sans" onclick="readDoc(${d.id})">Mark reviewed</button>`}
      ${ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" onclick="editDoc(${d.id})">Edit</button><button class="btn btn-danger btn-sm sans" onclick="delDoc(${d.id})">Delete</button>`:''}
    </div></div>`).join('') : '<div class="empty">Nothing found.</div>';
}
async function readDoc(id){ await api('/docs/'+id+'/read',{method:'POST'}); loadLibrary(); }
async function delDoc(id){ if(confirm('Delete this document?')){ await api('/docs/'+id,{method:'DELETE'}); loadLibrary(); } }
function newDoc(){ docForm({}); }
function editDoc(id){ docForm(DOCS.find(d=>d.id===id)||{}); }
function docForm(d){
  $('docEditor').innerHTML = `<div class="card"><h3>${d.id?'Edit':'New'} document</h3>
    <div class="grid2"><div><label>Title</label><input id="dc_title" value="${esc(d.title||'')}"/></div>
      <div><label>Category</label><select id="dc_cat">${['SOP','Policy','Training guideline','Safety','HR'].map(c=>`<option ${d.category===c?'selected':''}>${c}</option>`).join('')}</select></div></div>
    <label>Tags (comma-separated)</label><input id="dc_tags" value="${esc(d.tags||'')}"/>
    <label>Body</label><textarea id="dc_body" style="min-height:160px">${esc(d.body||'')}</textarea>
    <div class="toolbar"><button class="btn btn-ghost sans" onclick="$('docEditor').innerHTML=''">Cancel</button><button class="btn btn-primary sans" onclick="saveDoc(${d.id||0})">Save</button></div></div>`;
  $('docEditor').scrollIntoView({behavior:'smooth'});
}
async function saveDoc(id){
  const body={id:id||undefined,title:$('dc_title').value,category:$('dc_cat').value,tags:$('dc_tags').value,body:$('dc_body').value};
  if(!body.title.trim()||!body.body.trim()){alert('Title and body required');return;}
  await api('/docs',{method:'POST',body:JSON.stringify(body)}); $('docEditor').innerHTML=''; loadLibrary();
}

/* ---- training ---- */
async function loadTraining(){
  const { courses } = await api('/courses');
  $('trainingArea').innerHTML = courses.map(c=>`<div class="card">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <h3 style="margin:0">${esc(c.title)}</h3>
      ${c.due?'<span class="risk risk-high">Due</span>':'<span class="risk risk-low">Current</span>'}
      ${c.lastPassed?`<span class="hint">last passed ${esc((c.lastPassed.at||'').slice(0,10))} · ${c.lastPassed.score}%</span>`:'<span class="hint">not yet completed</span>'}
      ${c.lastPassed?`<button class="btn btn-ghost btn-sm sans" style="margin-left:auto" onclick="certificate(${JSON.stringify(c.title).replace(/"/g,'&quot;')},${c.lastPassed.score},'${esc((c.lastPassed.at||'').slice(0,10))}')">🏅 Certificate</button>`:''}
      <button class="btn btn-gold btn-sm sans" ${c.lastPassed?'':'style="margin-left:auto"'} onclick="openCourse(${c.id})">${c.lastPassed?'Refresh':'Start'} (${c.questionCount} q)</button>
    </div>
    <p class="sub sans" style="margin:6px 0 0">${esc(c.description||'')}${c.recert_days?' · refresher every '+c.recert_days+' days':''}</p>
  </div>`).join('') || '<div class="empty">No courses yet.</div>';
}
async function openCourse(id){
  const { course } = await api('/courses/'+id);
  const qs = course.questions.map((q,qi)=>`<div class="sq" data-qid="${q.id}"><div class="sq-q">${qi+1}. ${esc(q.text)}</div>
    ${q.options.map((o,oi)=>`<label class="trg"><input type="radio" name="q${q.id}" value="${oi}"/> ${esc(o)}</label>`).join('')}</div>`).join('');
  $('trainingArea').innerHTML = `<div class="card"><h3>${esc(course.title)}</h3>
    ${course.body?`<div class="brief-body" style="white-space:pre-wrap;margin-bottom:12px">${esc(course.body)}</div>`:''}
    <div class="sv-cat">Quiz — 80% to pass</div>${qs}
    <div id="quizMsg" class="hint"></div>
    <div class="toolbar"><button class="btn btn-ghost sans" onclick="loadTraining()">Back</button><button class="btn btn-primary sans" onclick="submitCourse(${course.id})">Submit</button></div></div>`;
  window.scrollTo(0,0);
}
async function submitCourse(id){
  const answers={};
  document.querySelectorAll('#trainingArea .sq').forEach(sq=>{ const qid=sq.dataset.qid; const sel=sq.querySelector('input:checked'); if(sel) answers[qid]=sel.value; });
  const { score, passed } = await api('/courses/'+id+'/complete',{method:'POST',body:JSON.stringify({answers})});
  $('quizMsg').innerHTML = passed ? `<span style="color:var(--good)">✓ Passed — ${score}%. Recorded as proof of training.</span>` : `<span style="color:var(--danger)">Scored ${score}% — 80% needed. Review the lesson and try again.</span>`;
  if(passed) setTimeout(loadTraining, 1800);
}
function newCourse(){
  $('trainingArea').innerHTML = `<div class="card"><h3>New course</h3>
    <label>Title</label><input id="nc_title"/>
    <label>Description</label><input id="nc_desc"/>
    <label>Lesson</label><textarea id="nc_body" style="min-height:120px"></textarea>
    <label>Refresher interval (days, 0 = none)</label><input id="nc_recert" type="number" value="180"/>
    <div class="sv-cat">Questions — one per line as: Question | option A | option B | option C ‖ correctIndex(0-based)</div>
    <textarea id="nc_qs" style="min-height:120px" placeholder="What does P in PAUSE mean? | Pause your reaction | Page the leader | Print the form ‖ 0"></textarea>
    <div class="toolbar"><button class="btn btn-ghost sans" onclick="loadTraining()">Cancel</button><button class="btn btn-primary sans" onclick="saveCourse()">Create</button></div></div>`;
}
async function saveCourse(){
  const questions=$('nc_qs').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const [main,ans]=l.split('‖'); const parts=main.split('|').map(x=>x.trim()); return { q:parts[0], o:parts.slice(1), a:Number((ans||'0').trim()) };
  }).filter(x=>x.q&&x.o.length>=2);
  if(!$('nc_title').value.trim()||!questions.length){alert('Need a title and at least one question (use the format shown).');return;}
  await api('/courses',{method:'POST',body:JSON.stringify({title:$('nc_title').value,description:$('nc_desc').value,body:$('nc_body').value,recert_days:$('nc_recert').value,questions})});
  loadTraining();
}
function certificate(title, score, at){
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Certificate — ${esc(title)}</title>
  <style>body{font-family:Georgia,serif;color:#2a585d;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f6f3ec}
  .cert{background:#fff;border:3px solid #c89461;border-radius:14px;max-width:720px;padding:48px 56px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12)}
  .k{color:#c89461;letter-spacing:3px;text-transform:uppercase;font-size:12px;font-family:sans-serif}
  h1{font-size:34px;margin:8px 0}.nm{font-size:30px;margin:18px 0 6px;border-bottom:1px solid #e5e0d6;display:inline-block;padding:0 30px 8px}
  .c{font-size:20px;margin:14px 0}.meta{color:#888;font-size:13px;margin-top:18px;font-family:sans-serif}.mark{width:60px;margin-bottom:6px}</style></head>
  <body><div class="cert">
    <img class="mark" src="/logo.svg"/><div class="k">Armada Recovery · Certificate of Training</div>
    <h1>Certificate of Completion</h1>
    <div class="k">This certifies that</div><div class="nm">${esc(ME.name)}</div>
    <div class="c">has successfully completed<br><strong>${esc(title)}</strong></div>
    <div class="meta">Score ${score}% · Completed ${esc(at)} · The Gold Standard of Client Care</div>
  </div></body></html>`;
  const w=window.open('','_blank'); w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>w.print(),300);
}
async function trainingStatus(){
  const { courses, rows } = await api('/training-status');
  $('trainingArea').innerHTML = `<div class="card"><h3>Team training status</h3>
    <table class="tbl"><tr><th>Teammate</th>${courses.map(c=>`<th>${esc(c)}</th>`).join('')}</tr>
    ${rows.map(r=>`<tr><td>${esc(r.name)}</td>${r.courses.map(c=>`<td>${c.due?'<span class="risk risk-high">due</span>':'<span class="risk risk-low">'+(c.lastPassed?c.lastPassed.score+'%':'✓')+'</span>'}</td>`).join('')}</tr>`).join('')}</table>
    <div class="toolbar"><button class="btn btn-ghost sans" onclick="loadTraining()">Back</button></div></div>`;
}

/* ---- my tasks / assigned tasks ---- */
async function loadMyTasks(){
  const { calls, tasks, today } = await api('/my-tasks');
  const callRows = calls.map(c=>`<div class="todo"><div class="txt">🤝 <strong>${esc(c.pref||c.name)}</strong> — ${esc(c.type)} aftercare call · due ${esc(c.due_date)} ${c.due_date<=today?'<span class="risk risk-high">due</span>':''}</div>
    <button class="btn btn-ghost btn-sm sans" onclick="doneCall(${c.id},'Done')">Done</button><button class="btn btn-ghost btn-sm sans" onclick="doneCall(${c.id},'Unreachable')">No answer</button></div>`).join('');
  const taskRows = tasks.map(t=>`<div class="todo"><div class="txt">✅ ${esc(t.title)}${t.pref?' · '+esc(t.pref):''}${t.due_date?' · due '+esc(t.due_date):''} <span class="hint">from ${esc(t.assigned_by||'')}</span>${t.detail?'<div class="hint">'+esc(t.detail)+'</div>':''}</div>
    <button class="btn btn-ghost btn-sm sans" onclick="doneTask(${t.id})">Done</button></div>`).join('');
  $('myTasksList').innerHTML = (callRows+taskRows) || '<div class="pc-note">Nothing assigned to you. 🎉</div>';
  await fillClientSelect($('at_client'),'No client');
  try { const { staff } = await api('/staff'); const opts = staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $('at_to').innerHTML = '<option value="">Pick teammate…</option>'+opts;
  } catch(e){}
  if(ME.role==='admin'){ try { const { calls:ac, tasks:at } = await api('/all-tasks');
    $('allTasksList').innerHTML = (ac.map(c=>`<div class="pc-note">🤝 ${esc(c.pref)} — ${esc(c.type)} call due ${esc(c.due_date)} · <strong>${esc(c.assignee_name||'unassigned')}</strong></div>`).join('')+
      at.map(t=>`<div class="pc-note">✅ ${esc(t.title)} · <strong>${esc(t.assignee_name||'')}</strong>${t.due_date?' · due '+esc(t.due_date):''}</div>`).join('')) || '<div class="hint">No open team tasks.</div>'; }catch(e){} }
}
async function doneCall(id,status){ await api('/followups/'+id,{method:'POST',body:JSON.stringify({status})}); loadMyTasks(); }
async function doneTask(id){ await api('/assigned-tasks/'+id+'/done',{method:'POST'}); loadMyTasks(); }
async function assignTask(){
  if(!$('at_to').value||!$('at_title').value.trim()){ alert('Pick a teammate and enter a task.'); return; }
  await api('/assigned-tasks',{method:'POST',body:JSON.stringify({assignee_id:$('at_to').value,title:$('at_title').value,client_id:$('at_client').value||null,due_date:$('at_due').value||null})});
  $('at_title').value=''; $('at_due').value=''; alert('Assigned.'); loadMyTasks();
}
async function saveCoordinator(){ await api('/settings/aftercare-coordinator',{method:'POST',body:JSON.stringify({user_id:$('acc_user').value||null})}); alert('Aftercare Coordinator saved. New discharges will auto-assign their calls.'); }
async function saveOncall(){ await api('/settings/oncall',{method:'POST',body:JSON.stringify({email:$('oc_email').value,phone:$('oc_phone').value})}); alert('On-call leader saved. High alerts will reach them in real time.'); }

/* ---- settings hub ---- */
function emailProviderUI(){ const p=$('em_provider').value; if($('em_smtp'))$('em_smtp').style.display=(p==='smtp')?'':'none'; if($('em_resend'))$('em_resend').style.display=(p==='resend')?'':'none'; }
async function loadEmailConfig(){
  try{ const c=await api('/email/config');
    if($('em_provider')){ $('em_provider').value = c.provider||'resend'; }
    if($('em_from')) $('em_from').value=c.from||'';
    if($('em_smtp_host')) $('em_smtp_host').value=c.smtpHost||'';
    if($('em_smtp_port')) $('em_smtp_port').value=c.smtpPort||'587';
    if($('em_smtp_user')) $('em_smtp_user').value=c.smtpUser||'';
    if($('em_to')) $('em_to').value=c.to||'';
    if($('em_smtp_pass')) $('em_smtp_pass').placeholder = c.hasSmtpPass?'•••••• (saved)':'app password';
    if($('em_resend_key')) $('em_resend_key').placeholder = c.hasResendKey?'•••••• (saved)':'re_…';
    emailProviderUI();
  }catch(e){}
}
async function saveEmailConfig(){
  $('em_msg').textContent='Saving…';
  const body={ provider:$('em_provider').value, from:$('em_from').value, to:$('em_to').value,
    smtp_host:$('em_smtp_host').value, smtp_port:$('em_smtp_port').value, smtp_user:$('em_smtp_user').value };
  if($('em_smtp_pass').value) body.smtp_pass=$('em_smtp_pass').value;
  if($('em_resend_key').value) body.resend_key=$('em_resend_key').value;
  try{ const r=await api('/email/config',{method:'POST',body:JSON.stringify(body)}); $('em_msg').textContent='✓ Saved'+(r.status&&r.status.provider?(' ('+r.status.provider+' ready)'):''); $('em_smtp_pass').value='';$('em_resend_key').value=''; loadEmailConfig(); }
  catch(e){ $('em_msg').textContent='Error: '+e.message; }
}
async function testEmail(){
  $('em_msg').textContent='Sending test…';
  const to=$('em_test').value||$('em_to').value;
  try{ const r=await api('/email/test',{method:'POST',body:JSON.stringify({to})}); $('em_msg').innerHTML='✓ Sent to '+esc(r.to)+' — check the inbox.'; }
  catch(e){ $('em_msg').innerHTML='<span style="color:var(--danger)">Failed: '+esc(e.message)+'</span>'; }
}
async function loadSmsConfig(){
  try{ const c=await api('/sms/config');
    if($('sms_sid')) $('sms_sid').value=c.sid||'';
    if($('sms_from')) $('sms_from').value=c.from||'';
    if($('sms_oncall')) $('sms_oncall').value=c.oncall||'';
    if($('sms_token')) $('sms_token').placeholder = c.hasToken?'•••••• (saved)':'auth token';
  }catch(e){}
}
async function saveSmsConfig(){
  $('sms_msg').textContent='Saving…';
  const body={ sid:$('sms_sid').value, from:$('sms_from').value, oncall:$('sms_oncall').value };
  if($('sms_token').value) body.token=$('sms_token').value;
  try{ const r=await api('/sms/config',{method:'POST',body:JSON.stringify(body)}); $('sms_msg').textContent='✓ Saved'+(r.status&&r.status.ready?' (ready)':''); $('sms_token').value=''; loadSmsConfig(); }
  catch(e){ $('sms_msg').textContent='Error: '+e.message; }
}
async function testSms(){
  $('sms_msg').textContent='Sending test text…';
  const to=$('sms_test').value||$('sms_oncall').value;
  try{ const r=await api('/sms/test',{method:'POST',body:JSON.stringify({to})}); $('sms_msg').innerHTML='✓ Sent to '+esc(r.to)+' — check the phone.'; }
  catch(e){ $('sms_msg').innerHTML='<span style="color:var(--danger)">Failed: '+esc(e.message)+'</span>'; }
}
async function loadSfConfig(){
  try{ const c=await api('/salesforce/config');
    if($('sf_instance_url')) $('sf_instance_url').value=c.instanceUrl||'';
    if($('sf_api_version')) $('sf_api_version').value=c.apiVersion||'v60.0';
    if($('sf_client_secret')) $('sf_client_secret').placeholder = c.hasSecret?'•••••• (saved)':'consumer secret';
  }catch(e){}
}
async function saveSfConfig(){
  $('sf_msg').textContent='Saving…';
  const body={ instance_url:$('sf_instance_url').value, api_version:$('sf_api_version').value, client_id:$('sf_client_id').value };
  if($('sf_client_secret').value) body.client_secret=$('sf_client_secret').value;
  try{ const r=await api('/salesforce/config',{method:'POST',body:JSON.stringify(body)}); $('sf_msg').textContent='✓ Saved'+(r.status&&r.status.configured?' (configured)':''); $('sf_client_secret').value=''; loadSfConfig(); }
  catch(e){ $('sf_msg').textContent='Error: '+e.message; }
}
async function testSf(){
  $('sf_msg').textContent='Testing…';
  try{ const r=await api('/salesforce/test',{method:'POST'}); $('sf_msg').innerHTML='✓ Connected — Salesforce reachable.'; }
  catch(e){ $('sf_msg').innerHTML='<span style="color:var(--danger)">Failed: '+esc(e.message)+'</span>'; }
}
async function sfSyncNow(){
  $('sf_msg').textContent='Pulling Leads and matching to admitted clients…';
  try{ const r=await api('/salesforce/sync',{method:'POST'});
    $('sf_msg').innerHTML=`✓ ${r.leads} leads · <strong>${r.matched}</strong> matched to admitted clients · referral source filled. ${r.partnerRefs} partner referrals.`; }
  catch(e){ $('sf_msg').innerHTML='<span style="color:var(--danger)">Failed: '+esc(e.message)+'</span>'; }
}
async function sfAutomap(){
  const box=$('sf_discover'); if(!box) return;
  box.innerHTML='Scanning your objects for referral + patient fields… (this takes ~10s)';
  try{
    const r=await api('/salesforce/automap');
    const rows=(r.results||[]).map(o=>{
      if(o.error) return `<tr><td>${esc(o.object)}</td><td colspan="6" style="color:var(--danger)">${esc(o.error)}</td></tr>`;
      const cell=(arr)=> arr&&arr.length?`<span title="${esc(arr.join(', '))}">${arr.length} ✓</span>`:'—';
      const best=o.object===r.best?' style="background:rgba(212,175,55,.15);font-weight:600"':'';
      return `<tr${best}><td><a href="#" onclick="sfDescribe('${esc(o.object)}');return false">${esc(o.object)}</a></td>`+
        `<td>${o.score||0}</td><td>${cell(o.hits&&o.hits.referral)}</td><td>${cell(o.hits&&o.hits.patient)}</td>`+
        `<td>${cell(o.hits&&o.hits.mrn)}</td><td>${cell(o.hits&&o.hits.status)}</td><td>${cell(o.hits&&o.hits.insurance)}</td></tr>`;
    }).join('');
    box.innerHTML=`<div style="margin-bottom:6px">Scanned ${r.scanned} objects. Best match: <strong>${esc(r.best||'none')}</strong>. Hover a ✓ to see the field names.</div>`+
      `<div style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table style="width:100%;font-size:12px"><thead><tr><th>Object</th><th>Score</th><th>Referral src</th><th>Patient name</th><th>MRN/Kipu id</th><th>Status</th><th>Insurance</th></tr></thead><tbody>${rows}</tbody></table></div>`+
      `<div id="sf_describe" style="margin-top:10px"></div>`;
  }catch(e){ box.innerHTML='<span style="color:var(--danger)">Failed: '+esc(e.message)+'</span>'; }
}
async function sfDiscover(){
  const box=$('sf_discover'); if(!box) return;
  box.innerHTML='Asking Salesforce what objects it has…';
  try{
    const r=await api('/salesforce/discover');
    const rows=(r.objects||[]).map(o=>`<tr><td><a href="#" onclick="sfDescribe('${esc(o.name)}');return false">${esc(o.name)}</a></td><td>${esc(o.label||'')}</td><td>${o.custom?'custom':'standard'}</td></tr>`).join('');
    box.innerHTML=`<div style="margin-bottom:6px">${r.count} queryable objects (custom first). Click one to see its fields:</div>`+
      `<div style="max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table style="width:100%;font-size:13px"><thead><tr><th>API name</th><th>Label</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table></div>`+
      `<div id="sf_describe" style="margin-top:10px"></div>`;
  }catch(e){ box.innerHTML='<span style="color:var(--danger)">Failed: '+esc(e.message)+'</span>'; }
}
async function sfDescribe(obj){
  const box=$('sf_describe'); if(!box) return;
  box.innerHTML='Describing '+esc(obj)+'…';
  try{
    const r=await api('/salesforce/describe?object='+encodeURIComponent(obj));
    const rows=(r.fields||[]).map(f=>`<tr><td>${esc(f.name)}</td><td>${esc(f.label||'')}</td><td>${esc(f.type)}</td><td>${f.refTo?esc(f.refTo.join(', ')):''}</td></tr>`).join('');
    box.innerHTML=`<div style="font-weight:600;margin-bottom:4px">${esc(r.object)} — ${r.fieldCount} fields</div>`+
      `<div style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table style="width:100%;font-size:12px"><thead><tr><th>Field</th><th>Label</th><th>Type</th><th>Lookup→</th></tr></thead><tbody>${rows}</tbody></table></div>`+
      (r.sample&&r.sample.length?`<details style="margin-top:6px"><summary>Sample rows (${r.sample.length})</summary><pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify(r.sample,null,2))}</pre></details>`:'');
  }catch(e){ box.innerHTML='<span style="color:var(--danger)">Failed: '+esc(e.message)+'</span>'; }
}
async function saveKipuWeb(){
  $('kipuWebMsg').textContent='Saving…';
  try{ const r=await api('/settings/kipu-web',{method:'POST',body:JSON.stringify({url:$('kipuWebUrl').value})}); META.kipuWeb=r.kipuWeb; $('kipuWebMsg').textContent='✓ Saved — "Open in Kipu" now shows on each Care Card.'; }
  catch(e){ $('kipuWebMsg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function loadSettings(){
  loadEmailConfig(); loadSmsConfig(); loadSfConfig();
  if($('kipuWebUrl')) $('kipuWebUrl').value = (META && META.kipuWeb) || '';
  const st = await api('/settings');
  const dot=(ok)=>ok?'<span class="risk risk-low">ready</span>':'<span class="risk risk-warn">not set</span>';
  const prov = st.aiProvider==='bedrock'?'AWS Bedrock':'Anthropic API';
  $('intStatus').innerHTML = `
    <div class="ret-card"><div class="n" style="font-size:18px">${st.claudeReady?'✓':'—'}</div><div class="l">Claude AI · ${prov}${st.claudeReady?'':(st.aiProvider==='bedrock'?' (AWS creds)':' (ANTHROPIC_API_KEY)')}</div></div>
    <div class="ret-card"><div class="n" style="font-size:18px">${st.deidentify?'🔒':'⚠'}</div><div class="l">PHI to AI: ${st.deidentify?'de-identified':'real (BAA required)'}</div></div>
    <div class="ret-card"><div class="n" style="font-size:18px">${st.emailReady?'✓':'—'}</div><div class="l">Email ${st.emailReady?'':'(RESEND_API_KEY)'}</div></div>
    <div class="ret-card"><div class="n" style="font-size:18px">${st.smsReady?'✓':'—'}</div><div class="l">SMS ${st.smsReady?'':'(Twilio)'}</div></div>`;
  $('aiHealthWrap').innerHTML = `<button class="btn btn-ghost btn-sm sans" onclick="runAiHealth()">Run AI health check</button> <span id="aiHealthResult" class="hint"></span>`;
  const ac=st.aftercareCoordinator;
  $('acc_user').innerHTML='<option value="">— none —</option>'+st.staff.map(s=>`<option value="${s.id}" ${ac&&ac.id===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  $('oc_email').value=st.oncallEmail||''; $('oc_phone').value=st.oncallPhone||'';
  $('ocStatus').textContent = `Email ${st.emailReady?'ready':'needs RESEND_API_KEY'} · SMS ${st.smsReady?'ready':'needs Twilio env vars'}.`;
  $('kc_code').value = st.kioskCode||'';
  try { const k = await api('/kipu/status'); $('kipuStatus').innerHTML = k.configured ? '<span class="risk risk-low">credentials set</span>' : '<span class="risk risk-warn">not configured — set Kipu env vars on your host</span>'; } catch(e){}
  try { const w = await api('/warehouse/status'); $('whStatus').innerHTML = w.configured ? '<span class="risk risk-low">credentials set</span>' : '<span class="risk risk-warn">not configured — set WH_* env vars on your host</span>'; } catch(e){}
}
async function runAiHealth(){
  const el=$('aiHealthResult'); el.innerHTML='Checking…';
  try{ const r=await api('/ai/health');
    const tag=(ok)=>ok?'<span style="color:var(--good)">✓</span>':'<span style="color:var(--danger)">✗</span>';
    const diag = (r.provider==='bedrock' && r.secretLen!=null)
      ? `<div class="hint">region: ${esc(r.region||'—')} · access key: ${esc(r.accessKeyId||'—')} · secret length: ${r.secretLen}${r.secretLen===40?' ✓':' ⚠ (should be 40)'}${r.secretRawLen!==r.secretLen?' — has surrounding spaces!':''}</div>`
      : '';
    el.innerHTML = `${tag(r.ok)} ${esc(r.provider)} · model ${esc(r.model||'?')} · structured output ${tag(r.structuredOutput)}`
      + diag
      + (r.error?`<div class="hint" style="color:var(--danger)">${esc(r.error)}</div>`:'');
  }catch(e){ el.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function kipuTest(){ $('kipuResult').textContent='Testing…'; try{ const r=await api('/kipu/test',{method:'POST'}); $('kipuResult').innerHTML='<span style="color:var(--good)">✓ Connected'+(r.sampleCount!=null?' · '+r.sampleCount+' clients visible':'')+'</span>'; }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function kipuSync(){ $('kipuResult').textContent='Syncing…'; try{ const r=await api('/kipu/sync',{method:'POST'}); $('kipuResult').textContent=`Synced from Kipu: ${r.activeNow} active clients (${r.created} new, ${r.matched} updated, ${r.deactivated} no longer active, ${r.importedDischarges||0} discharges imported). Census returned ${r.total} records. Reading notes for snapshots & risk in the background…`; }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function kipuInspect(){ $('kipuResult').textContent='Inspecting Kipu fields…'; const el=$('kipuInspect'); el.style.display='none'; try{ const r=await api('/kipu/inspect',{method:'POST'}); $('kipuResult').textContent=`Census returns ${r.count} records. Fields + location/status values below — copy this to your assistant:`; el.style.display='block'; el.textContent = 'COUNT: '+r.count
  + (r.locations&&r.locations.length ? '\n\nLOCATIONS (set KIPU_LOCATION_ID to the right id):\n'+r.locations.map(l=>'  '+l.id+'  =  '+l.name).join('\n') : '')
  + '\n\nFIELDS: '+r.fields.join(', ')
  + '\n\nFACETS:\n'+Object.entries(r.facets).map(([k,v])=>'  '+k+': '+v.join(' | ')).join('\n')
  + (r.patientDetail ? '\n\n===== PATIENT DETAIL PROBE (copy this whole part to me) =====\n'+JSON.stringify(r.patientDetail,null,2) : '')
  + (r.dischargeAnalysis ? '\n\n===== DISCHARGE PROBE (copy this whole part to me) =====\n'+JSON.stringify(r.dischargeAnalysis,null,2) : '')
  + (r.photoProbe ? '\n\n===== PHOTO PROBE (copy this whole part to me) =====\n'+JSON.stringify(r.photoProbe,null,2) : '')
  + (r.roundsProbe ? '\n\n===== ROUNDS PROBE (copy this whole part to me) =====\n'+JSON.stringify(r.roundsProbe,null,2) : ''); }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function kipuFindRounds(){
  const client = prompt('Check a specific client by name (e.g. Shawn Adams)? Leave blank for the first active client.','')||'';
  $('kipuResult').textContent='Pulling the chart form names…'; const el=$('kipuInspect'); el.style.display='none';
  try{
    const r=await api('/kipu/find-rounds',{method:'POST',body:JSON.stringify({client})});
    if(r.error){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(r.error)+'</span>'; return; }
    $('kipuResult').textContent=`${esc(r.client)}: ${r.totalForms} forms on chart. Copy this to me:`;
    el.style.display='block';
    const cm=r.categoryMatches||{};
    const catLine=(k,lbl)=>`  ${lbl}: ${(cm[k]&&cm[k].length)?cm[k].join(' | '):'(none found)'}`;
    el.textContent='FORM-CATEGORY MATCHES (what we detect):\n'+
      [catLine('tx_plan','Treatment plan'),catLine('biopsych','Biopsychosocial'),catLine('asam','ASAM'),catLine('cm_note','Case mgmt note'),catLine('nursing','Nursing'),catLine('rounds','Rounds')].join('\n')+
      '\n\nALL FORM NAMES (by frequency):\n  '+(r.topByCount.join('\n  '));
  }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function kipuDischargeDebug(){
  const el=$('kipuInspect'); el.style.display='block'; el.textContent='Loading discharge diagnostic…';
  try{
    const d=await api('/command/discharge-debug');
    const src=Object.entries(d.bySource||{}).map(([k,n])=>`${k}: ${n}`).join(', ');
    const rows=(d.flowEvents||[]).map(r=>`${r.kind.toUpperCase()} · ${esc(r.name||'⟨deleted client #'+r.client_id+'⟩')} · src=${esc(r.source||'—')} · active=${r.active} · dc_date=${esc(r.discharge_date||'—')} · kipu=${esc(r.kipu_id||'—')}`).join('\n');
    el.innerHTML=`<div style="white-space:pre-wrap;font-family:monospace;font-size:12px">`+
      `TODAY = ${d.today}\n`+
      `Discharge/AMA flow-events dated today: ${d.flowEventCount} (orphaned: ${d.orphanFlowEvents})\n`+
      `Clients with discharge_date=today: ${d.dischargeDateTodayCount}  [${esc(src)}]\n\n`+
      esc(rows)+`</div>`+
      `<div class="toolbar" style="justify-content:flex-start;margin-top:10px">`+
      `<button class="btn btn-danger btn-sm sans" onclick="kipuDischargeCleanup()">Delete orphaned / stale discharge events</button></div>`;
  }catch(e){ el.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function kipuDischargeCleanup(){
  if(!confirm('Delete discharge events that point to deleted clients or to clients that are no longer discharged?'))return;
  try{ const r=await api('/command/discharge-cleanup',{method:'POST'}); $('kipuResult').textContent=`✓ Removed ${r.orphansDeleted} orphaned and ${r.staleDeleted} stale discharge events. Reopen the Command Center.`; kipuDischargeDebug(); }
  catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function kipuFixDc(){
  $('kipuResult').textContent='Correcting discharge dates from Kipu…';
  try{ const r=await api('/kipu/fix-discharge-dates',{method:'POST'}); $('kipuResult').textContent=`✓ Checked ${r.checked} discharges — corrected ${r.fixed} to real dates, restored ${r.reactivated||0} still-active client(s), re-rolled ${r.daysRerolled} day(s). Reopen the Command Center to see the fixed counts.`; }
  catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function kipuReconcile(){
  $('kipuResult').textContent='Reconciling census vs app…'; const el=$('kipuInspect'); el.style.display='none';
  try{
    const r=await api('/kipu/reconcile',{method:'POST'});
    $('kipuResult').textContent=`Kipu active @ location ${r.locationId}: ${r.censusActiveAtLocation} · App active: ${r.appActive}`;
    el.style.display='block';
    el.textContent =
      `Census total returned: ${r.censusTotal}\nAt this location — active: ${r.censusActiveAtLocation}, discharged: ${r.censusDischargedAtLocation}\nOther locations in response: ${r.otherLocations}\nApp active: ${r.appActive}\n\n`+
      `MISSING FROM APP (in Kipu active here, not active in app) — ${r.missingFromApp.length}:\n`+
      (r.missingFromApp.map(m=>`  ${m.initials} ${m.kid} — inApp:${m.inApp} active:${m.appActive} status:${m.appStatus||'-'}`).join('\n')||'  (none)')+
      `\n\nSTALE IN APP (active in app, not in Kipu census) — ${r.staleInApp.length}:\n`+
      (r.staleInApp.map(s=>`  ${s.initials} ${s.kid}`).join('\n')||'  (none)');
  }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function kipuCoverage(){
  $('kipuResult').textContent='Checking what each field is pulling…';
  $('kipuInspect').style.display='none'; const el=$('kipuCoverage'); el.style.display='none';
  try{
    const r=await api('/kipu/coverage');
    $('kipuResult').textContent=`Data coverage — ${r.activeCount} active client(s), ${r.dischargedCount} discharged in last 90 days:`;
    el.style.display='block';
    el.innerHTML = `<table class="tbl"><thead><tr><th>Field</th><th>Source</th><th style="text-align:right">Filled</th><th style="width:120px">Coverage</th></tr></thead><tbody>`+
      r.fields.map(f=>{
        const pct = f.total ? Math.round(f.filled/f.total*100) : 0;
        const col = f.total===0 ? 'var(--muted)' : pct>=80?'var(--good)':pct>=1?'var(--gold)':'var(--danger)';
        return `<tr><td>${esc(f.label)}</td><td><span class="hint">${esc(f.source)}</span></td><td style="text-align:right">${f.total?f.filled+'/'+f.total:'—'}</td>
          <td><div class="trbar-track" style="margin:0"><div class="trbar-fill" style="width:${pct}%;background:${col}"></div></div></td></tr>`;
      }).join('')+`</tbody></table>
      <p class="hint" style="margin-top:8px">Anything at 0% means Kipu isn't charting that field under a name we recognize. Run "Inspect fields" and send me the result and I'll map it exactly. Census fields fill on Sync; patient-detail fields (level of care, therapist, etc.) fill on the next full sync.</p>`;
  }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function kipuDocInspect(){ $('kipuResult').textContent='Probing Kipu documentation for one client…'; const el=$('kipuInspect'); el.style.display='none'; try{ const r=await api('/kipu/doc-inspect',{method:'POST'}); $('kipuResult').textContent='Documentation probe — copy this whole box to your assistant:'; el.style.display='block'; el.textContent=JSON.stringify(r,null,2); }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function kipuNotesPreview(){ $('kipuResult').textContent='Pulling one client\'s documentation…'; const el=$('kipuInspect'); el.style.display='none'; try{ const r=await api('/kipu/notes-preview',{method:'POST'}); $('kipuResult').textContent=`Pulled ${r.noteCount||0} notes · ${r.chars} characters. Per-note breakdown + preview below:`; el.style.display='block'; const bd=(r.breakdown||[]).map(b=>`  ${b.chars} chars — ${b.head}`).join('\n'); const dbg=r.debug?`DIAGNOSTIC: ${r.debug.candidates} candidate notes · dated:${r.debug.anyDated} · fetched ${r.debug.fetched} · ${r.debug.withContent} had content\nNote types seen: ${(r.debug.sampleNames||[]).join(' | ')}\ntherapist: ${r.therapist||'(none)'} · case manager: ${r.case_manager||'(none)'}\n\n`:''; el.textContent=dbg+'BREAKDOWN:\n'+bd+'\n\n----- PREVIEW -----\n'+(r.preview||'(empty — no note content returned)'); }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function kipuReset(){ if(!confirm('This clears the current client list and rebuilds it from the live Kipu active census. Continue?'))return; $('kipuResult').textContent='Rebuilding roster from Kipu…'; try{ const r=await api('/kipu/reset',{method:'POST'}); $('kipuResult').textContent=`✓ Roster rebuilt: ${r.activeNow} active clients, ${r.importedDischarges||0} recent discharges imported (of ${r.total} census records). Reading every client's notes for snapshots & AMA risk in the background — check the Command Center shortly.`; }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whTestConn(){ $('whResult').textContent='Connecting… (first connect can take ~20s)'; try{ const r=await api('/warehouse/test',{method:'POST'}); $('whResult').innerHTML='<span style="color:var(--good)">✓ Connected'+(r.sampleCount!=null?' · census returns '+r.sampleCount+' rows':' (census query not confirmed yet)')+'</span>'; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whSync(){ $('whResult').textContent='Syncing census…'; try{ const r=await api('/warehouse/sync',{method:'POST'}); $('whResult').textContent=`Synced: ${r.created} new, ${r.matched} updated (of ${r.total} in warehouse).`; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whSyncNotes(){ $('whResult').textContent='Scanning recent notes for red flags…'; try{ const r=await api('/warehouse/sync-notes',{method:'POST',body:JSON.stringify({days:3})}); $('whResult').textContent=`Scanned ${r.scanned} notes · ${r.flagged} red-flagged.`; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whCols(){ $('whResult').textContent='Reading census columns…'; try{ const r=await api('/warehouse/columns',{method:'POST'}); $('whResult').innerHTML = r.columns.length ? 'Census columns: <code style="font-size:11px">'+r.columns.map(esc).join(', ')+'</code>' : '<span class="hint">Connected, but the census query returned no rows.</span>'; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function saveKioskCode(){ await api('/settings/kiosk-code',{method:'POST',body:JSON.stringify({code:$('kc_code').value})}); alert('Kiosk/display code saved.'); }
async function testAlert(){ const r=await api('/settings/test-alert',{method:'POST'}); alert(`Test sent. Email ${r.emailReady?'attempted':'not configured'}, SMS ${r.smsReady?'attempted':'not configured'}.`); }

/* ---- huddle mode (full-screen daily lineup) ---- */
async function startHuddle(){
  const [t, line, conc] = await Promise.all([api('/today'), api('/lineup'), api('/concerns').catch(()=>({concerns:[]}))]);
  const atRisk = (t.attention||[]).filter(a=>a.kind==='risk');
  const welcome = (t.attention||[]).filter(a=>a.kind==='welcome');
  const wow = (line.wows||[])[0];
  const openConcern = (conc.concerns||[]).find(c=>c.status==='Open');
  const dt = new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  $('huddleBody').innerHTML = `
    <h1>Daily Lineup</h1><div class="hint" style="color:#cfe">${dt} · ${esc($('r_shift')?.value||'')} shift</div>
    <h2>Today's value</h2><div class="hv">${esc(line.value||'')}</div>
    <h2>The house</h2>
    <div class="hitem">${t.metrics.active} active clients · ${t.metrics.highRisk} at risk · ${t.metrics.openConcerns} open concerns · ${t.metrics.callsDue} aftercare calls due</div>
    ${welcome.length?`<h2>New arrivals — deliver the welcome</h2>${welcome.map(w=>`<div class="hitem">☀ ${esc(w.text)}</div>`).join('')}`:''}
    <h2>Needs extra care today</h2>${atRisk.length?atRisk.map(a=>`<div class="hitem">⚠ ${esc(a.text)}</div>`).join(''):'<div class="hitem">All steady — touch every client, deliver every personal touch.</div>'}
    <h2>Recognition</h2><div class="hitem">${wow?'👏 '+esc(wow.text)+(wow.by_name?' — '+esc(wow.by_name):''):'Catch someone doing something great today and name it.'}</div>
    <h2>One defect to own</h2><div class="hitem">${openConcern?'⚑ '+esc(openConcern.pref||'')+': '+esc(openConcern.text)+' — who owns the fix?':'No open concerns. 🎉'}</div>
    <h2>Today's focus</h2><div class="hitem">${esc(t.focus?.t||'')} — ${esc(t.focus?.g||'')}</div>`;
  $('huddle').style.display='block'; window.scrollTo(0,0);
}
function closeHuddle(){ $('huddle').style.display='none'; }
async function lineupDone(){ await api('/lineup-log',{method:'POST',body:JSON.stringify({shift:$('r_shift')?.value||'Day'})}); closeHuddle(); alert('Lineup logged ✓ (counts toward Scorecard compliance).'); }

/* ---- scorecard + saves ---- */
async function loadScorecard(){
  const { metrics } = await api('/scorecard');
  $('scoreGrid').innerHTML = metrics.map(x=>`<div class="ret-card ${x.met===false?'rc-high':x.met===true?'':''}" style="${x.met===true?'border-color:#bcd8c6;background:#eef5f0':x.met===false?'':''}">
    <div class="n" style="${x.met===false?'color:var(--danger)':x.met===true?'color:var(--good)':''}">${x.value}${x.unit||''}</div>
    <div class="l">${esc(x.label)}</div><div class="hint" style="margin-top:3px">${esc(x.target)}${x.note?' · '+esc(x.note):''}</div></div>`).join('');
  await fillClientSelect($('sv_save_client'),'No client');
  const { saves } = await api('/saves');
  $('savesList').innerHTML = saves.length ? saves.map(s=>`<div class="todo">
    <div class="txt"><strong>${esc(s.pref||'—')}</strong> ${s.trigger?'· '+esc(s.trigger):''} ${s.note?'· '+esc(s.note):''} <span class="hint">${esc(s.by_name||'')} ${esc((s.created_at||'').slice(0,10))}</span></div>
    ${s.outcome==='Pending'?`<button class="btn btn-ghost btn-sm sans" onclick="saveOutcome(${s.id},'Stayed')">Stayed ✓</button><button class="btn btn-ghost btn-sm sans" onclick="saveOutcome(${s.id},'Left')">Left</button>`:`<span class="risk ${s.outcome==='Stayed'?'risk-low':'risk-high'}">${esc(s.outcome)}</span>`}
  </div>`).join('') : '<div class="pc-note">No saves logged yet.</div>';
}
async function logSave(){
  await api('/saves',{method:'POST',body:JSON.stringify({client_id:$('sv_save_client').value||null,trigger:$('sv_trigger').value,note:$('sv_note').value})});
  $('sv_trigger').value=''; $('sv_note').value=''; loadScorecard();
}
async function saveOutcome(id,outcome){ await api('/saves/'+id+'/outcome',{method:'POST',body:JSON.stringify({outcome})}); loadScorecard(); }

/* ---- the armada standard ---- */
let STD = null;
async function loadStandard(){
  if(!STD){ const d = await api('/standard'); STD = d; $('stdNorth').textContent = '"'+d.motto+'" · '+d.northStar; }
  renderStandard();
}
function renderStandard(){
  if(!STD) return;
  const q = ($('stdSearch').value||'').toLowerCase();
  const secs = STD.sections.filter(s=> !q || s.title.toLowerCase().includes(q) || s.points.some(p=>p.toLowerCase().includes(q)));
  $('stdSections').innerHTML = secs.length ? secs.map(s=>`<div class="card"><h3>${s.n}. ${esc(s.title)}</h3>
    <ul class="ama-list">${s.points.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`).join('') : '<div class="empty">Nothing matches "'+esc(q)+'".</div>';
}

/* ---- playbook ---- */
async function loadPlaybook(){
  const date=$('r_date').value||today(), shift=$('r_shift').value, role=$('r_role').value;
  const data = await api(`/playbook?date=${date}&shift=${encodeURIComponent(shift)}&role=${encodeURIComponent(role)}`);
  const names = data.assignees.map(a=>`${esc(a.name)} (${esc(a.job_role)})`).join(' · ');
  const coOpts = (data.staff||[]).map(s=>`<option value="${s.id}" ${data.crisisOwner===s.name?'selected':''}>${esc(s.name)}</option>`).join('');
  $('assignees').innerHTML = `${names?`On this shift: ${names}<br>`:''}<span class="no-print">🚨 Crisis Owner: <select class="sans" style="width:auto" onchange="setCrisisOwner(this.value)"><option value="">— name one —</option>${coOpts}</select></span>${data.crisisOwner?`<strong class="only-print">🚨 Crisis Owner: ${esc(data.crisisOwner)}</strong>`:''}`;
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
        <div class="pc-head">${c.photo?`<img src="${esc(c.photo)}" class="client-photo" alt=""/>`:`<span class="avatar">${initials(c.name||c.pref)}</span>`}
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
/* ---- ama sparkline ---- */
function sparkline(vals, w=80, h=22){
  if(!vals || vals.length<1) return '<span class="hint">—</span>';
  if(vals.length===1) vals=[vals[0],vals[0]];
  const max=3, n=vals.length, step=w/(n-1);
  const y=v=>h-2-((v-1)/(max-1))*(h-4);
  const pts=vals.map((v,i)=>`${(i*step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last=vals[vals.length-1];
  const col=last>=3?'#9b2c2c':last>=2?'#9a6a1f':'#2f7a4f';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle"><polyline fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/><circle cx="${(w).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.5" fill="${col}"/></svg>`;
}

/* ---- retention dashboard ---- */
function riskBadge(level){
  const m = { High:'risk-high', Elevated:'risk-elev', Low:'risk-low' };
  return `<span class="risk ${m[level]||'risk-none'}">${esc(level||'No read')}</span>`;
}
let assessPoll = null;
async function assessAll(){
  const btn=$('assessBtn');
  try{ const r=await api('/assess-all',{method:'POST'});
    if(r.started===false && !r.already){ $('assessProgress').textContent='Could not start.'; return; }
    btn.disabled=true; pollAssess();
  }catch(e){ $('assessProgress').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function pollAssess(){
  clearTimeout(assessPoll);
  try{ const s=await api('/assess-all/status');
    if(s.running){
      $('assessProgress').innerHTML=`Assessing ${s.done}/${s.total}… <strong>${s.high}</strong> high · <strong>${s.elevated}</strong> elevated${s.current?' · reading '+esc(s.current):''}`;
      assessPoll=setTimeout(pollAssess, 2500);
    } else {
      $('assessBtn').disabled=false;
      if(s.total){ $('assessProgress').innerHTML=`✓ Assessed ${s.done} clients — <strong style="color:var(--danger)">${s.high} high</strong>, <strong>${s.elevated} elevated</strong>, ${s.low} low${s.flagged?' · '+s.flagged+' red-flagged from notes':''}${s.errors?' · '+s.errors+' errors':''}.`; loadRetention(); }
    }
  }catch(e){ $('assessProgress').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
let debriefPoll=null;
async function debriefDischarges(){
  try{ const r=await api('/debrief-discharges',{method:'POST'});
    if(r.started===false && !r.already){ $('debriefProgress').textContent='Nothing to review.'; return; }
    $('debriefBtn').disabled=true; pollDebrief();
  }catch(e){ $('debriefProgress').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function pollDebrief(){
  clearTimeout(debriefPoll);
  try{ const s=await api('/debrief-discharges/status');
    if(s.running){ $('debriefProgress').innerHTML=`Reviewing discharges ${s.done}/${s.total}…${s.current?' · '+esc(s.current):''}`; debriefPoll=setTimeout(pollDebrief,2500); }
    else { $('debriefBtn').disabled=false; if(s.total){ $('debriefProgress').innerHTML=`✓ Reviewed ${s.done} discharges${s.ama?' · <strong style="color:var(--danger)">'+s.ama+' AMA</strong>':''}.`; loadDischargeLearnings(); } }
  }catch(e){ $('debriefProgress').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function loadDischargeLearnings(){
  try{ const { discharges } = await api('/discharge-learnings');
    if(!discharges.length){ $('learnCard').style.display='none'; return; }
    $('learnCard').style.display='block';
    $('dischargeLearnings').innerHTML = discharges.map(d=>{
      const ama = d.discharge_status==='AMA';
      return `<div class="todo"><div class="txt">
        <span class="risk ${ama?'risk-high':'risk-low'}">${esc(d.discharge_status||'Discharged')}</span>
        <strong>${esc(d.pref||d.name||'')}</strong> <span class="hint">· ${esc(d.discharge_date||'')}</span>
        ${d.discharge_reason?`<div class="pc-note">Why: ${esc(d.discharge_reason)}</div>`:''}
        ${d.discharge_improve?`<div class="pc-note" style="color:var(--gold)">Could do better: ${esc(d.discharge_improve)}</div>`:''}
      </div></div>`;
    }).join('');
  }catch(e){}
}
async function loadDetoxWatch(){
  try{ const { watch } = await api('/detox-watch');
    if(!watch.length){ $('detoxCard').style.display='none'; return; }
    $('detoxCard').style.display='block';
    $('detoxWatch').innerHTML = watch.map(w=>{
      const sev = w.withdrawal_level==='Severe', mod = w.withdrawal_level==='Moderate';
      return `<div class="todo"><div class="txt">
        ${w.withdrawal_level&&w.withdrawal_level!=='Unknown'?`<span class="risk ${sev?'risk-high':mod?'risk-elev':'risk-low'}">Withdrawal: ${esc(w.withdrawal_level)}</span> `:''}
        <strong>${esc(w.name)}</strong>${w.room?' · '+esc(w.room):''}
        ${w.withdrawal?`<div class="pc-note">${esc(w.withdrawal)}</div>`:''}
        ${w.med_concerns.length?`<div class="pc-note" style="color:var(--danger)">💊 ${w.med_concerns.map(esc).join(' · ')}</div>`:''}
      </div><button class="btn btn-ghost btn-sm sans" onclick="openJourney(${w.id})">Open</button></div>`;
    }).join('');
  }catch(e){}
}
async function loadRetention(){
  pollAssess();   // resume the progress readout if a job is running
  pollDebrief();
  loadDischargeLearnings();
  loadDetoxWatch();
  const { clients, triggerCounts, summary } = await api('/retention');
  $('retSummary').innerHTML = `
    <div class="ret-card ${summary.high?'rc-high':''}"><div class="n">${summary.high}</div><div class="l">High risk</div></div>
    <div class="ret-card ${summary.elevated?'rc-elev':''}"><div class="n">${summary.elevated}</div><div class="l">Elevated</div></div>
    <div class="ret-card ${summary.notPulsedToday?'rc-warn':''}"><div class="n">${summary.notPulsedToday}</div><div class="l">No pulse today</div></div>
    <div class="ret-card"><div class="n">${summary.pulsesToday}</div><div class="l">Pulses today</div></div>
    <div class="ret-card"><div class="n">${summary.total}</div><div class="l">Active clients</div></div>`;

  $('retClients').innerHTML = clients.length ? `<table class="tbl">
    <tr><th>Client</th><th>Room</th><th>AMA risk</th><th>Trend</th><th>Last pulse</th><th>Today</th></tr>
    ${clients.map(c=>`<tr class="ret-row" onclick="openJourney(${c.id})">
      <td><strong>${esc(c.pref||c.name||'')}</strong>${c.summary?`<div class="hint" style="margin-top:2px">${esc(c.summary.slice(0,80))}${c.summary.length>80?'…':''}</div>`:''}</td>
      <td>${esc(c.room||'')}</td>
      <td>${riskBadge(c.level)}</td>
      <td>${sparkline(c.trend)}</td>
      <td>${c.lastPulse?esc(c.lastPulse.date)+' '+esc(c.lastPulse.shift)+' · '+esc(c.lastPulse.concern):'<span class="hint">none</span>'}</td>
      <td>${c.pulsedToday?'<span class="risk risk-low">✓</span>':'<span class="risk risk-warn">—</span>'}</td>
    </tr>`).join('')}</table>` : '<div class="empty">No clients yet.</div>';

  const max = Math.max(1, ...triggerCounts.map(t=>t.count));
  $('retTriggers').innerHTML = triggerCounts.length ? triggerCounts.map(t=>`
    <div class="trbar"><div class="trbar-l">${esc(t.trigger)}</div>
      <div class="trbar-track"><div class="trbar-fill" style="width:${Math.round(t.count/max*100)}%"></div></div>
      <div class="trbar-n">${t.count}</div></div>`).join('') : '<div class="hint">No pulses logged in the last 14 days.</div>';
}

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
      <span class="voicewrap"><input class="p-stmt" placeholder='e.g. "I don\\'t think this is for me"'/><button type="button" class="mic" onclick="dictateInto(this)" title="Dictate">🎤</button></span>
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

/* ---- outbound referrals & partners ---- */
let REFMETA = null;
async function ensureReferralMeta(){
  if(REFMETA) return REFMETA;
  REFMETA = await api('/referrals/meta');
  // categories (key/label), departments, reasons, facility types
  $('rf_category').innerHTML = REFMETA.categories.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('');
  fillSelect($('rf_department'), REFMETA.departments);
  $('rf_reason').innerHTML = '<option value="">— reason —</option>'+REFMETA.reasons.map(r=>`<option>${esc(r)}</option>`).join('');
  fillSelect($('pt_type'), REFMETA.facilityTypes);
  // staff (referred-by) + clients
  try{ const { users } = await api('/users'); $('rf_by').innerHTML = users.filter(u=>u.active!==0).map(u=>`<option value="${u.id}" ${ME&&u.id===ME.id?'selected':''}>${esc(u.name)}</option>`).join(''); }
  catch(e){ $('rf_by').innerHTML = `<option value="${ME?ME.id:''}">${esc(ME?ME.name:'Me')}</option>`; }
  try{ const { clients } = await api('/clients'); $('rf_client').innerHTML = '<option value="">— none / not admitted —</option>'+clients.map(c=>`<option value="${c.id}">${esc(c.pref||c.name)}</option>`).join(''); }catch(e){}
  return REFMETA;
}
async function refreshFacilityList(){
  try{ const { facilities } = await api('/facilities'); window._FACS = facilities;
    $('rf_facility_list').innerHTML = facilities.map(f=>`<option data-id="${f.id}" value="${esc(f.name)}">`).join('');
  }catch(e){}
}
async function loadReferrals(){
  await ensureReferralMeta(); await refreshFacilityList();
  if(!$('rf_date').value) $('rf_date').value = today();
  if(META.claude) $('rfInsightBtn').style.display='inline-block';
  const range = $('rf_range').value || '30';
  const s = await api('/referrals/summary?range='+range);
  const c = s.counters;
  $('rfKpis').innerHTML = `
    <div class="ret-card"><div class="n">${c.today}</div><div class="l">Today</div></div>
    <div class="ret-card"><div class="n">${c.week}</div><div class="l">This week</div></div>
    <div class="ret-card"><div class="n">${c.month}</div><div class="l">Last 30 days</div></div>
    <div class="ret-card"><div class="n">${c.range}</div><div class="l">In window ${sparkline(s.trend,70,20)}</div></div>
    ${s.byCategory.map(x=>`<div class="ret-card"><div class="n">${x.n}</div><div class="l">${esc(x.k)}</div></div>`).join('')}`;
  const bars = (rows, total) => rows.length ? rows.map(r=>{
    const pct = total? Math.round(r.n/total*100):0;
    return `<div class="pc-note" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(r.k)}</span><span class="hint">${r.n} · ${pct}%</span></div><div style="height:5px;background:var(--gold);width:${pct}%;border-radius:3px;margin:2px 0 8px"></div>`;
  }).join('') : '<div class="hint">No data in this window.</div>';
  const tot = s.counters.range || 1;
  $('rfByReason').innerHTML = bars(s.byReason, tot);
  $('rfByDest').innerHTML = bars(s.byDestination, tot);
  $('rfByRef').innerHTML = bars(s.byReferrer, tot);
  const { referrals } = await api('/referrals?from='+new Date(Date.now()-(({'7':7,'30':30,'90':90,'365':365})[range]||30)*864e5).toISOString().slice(0,10));
  $('rfList').innerHTML = referrals.length ? referrals.map(r=>`<div class="todo">
      <div class="txt"><span class="badge ${r.category==='declined'?'':'admin'}">${esc(r.category)}</span> <strong>${esc(r.facility_name||'—')}</strong>
        <span class="hint">· ${esc(r.reason||'')}</span>
        <div class="hint">${esc(r.ref_date)} · ${esc(r.department)} · by ${esc(r.referred_by_name||'?')}${r.client_pref?' · '+esc(r.client_pref):''}${r.person_ref?' · '+esc(r.person_ref):''}${r.reason_detail?' · '+esc(r.reason_detail):''}</div></div>
      ${ME&&ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" onclick="delReferral(${r.id})">✕</button>`:''}
    </div>`).join('') : '<div class="hint">No referrals logged yet.</div>';
}
async function addReferral(){
  const fname = $('rf_facility').value.trim();
  const match = (window._FACS||[]).find(f=>f.name.toLowerCase()===fname.toLowerCase());
  const body = {
    ref_date: $('rf_date').value || today(),
    category: $('rf_category').value,
    department: $('rf_department').value,
    referred_by: $('rf_by').value || null,
    facility_id: match?match.id:null,
    facility_name: match?null:fname,
    reason: $('rf_reason').value,
    client_id: $('rf_client').value || null,
    person_ref: $('rf_person').value || null,
    insurance: $('rf_insurance').value || null,
    reason_detail: $('rf_detail').value || null,
  };
  $('rf_msg').textContent='Saving…';
  try{ await api('/referrals',{method:'POST',body:JSON.stringify(body)});
    $('rf_msg').textContent='✓ Logged.'; setTimeout(()=>$('rf_msg').textContent='',2500);
    ['rf_facility','rf_person','rf_insurance','rf_detail'].forEach(id=>$(id).value=''); $('rf_reason').value='';
    loadReferrals();
  }catch(e){ $('rf_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function delReferral(id){ if(!confirm('Delete this referral?'))return; await api('/referrals/'+id,{method:'DELETE'}); loadReferrals(); }
async function referralInsights(){
  const btn=$('rfInsightBtn'); btn.disabled=true; const l=btn.textContent; btn.textContent='✦ Thinking…';
  $('rfInsight').innerHTML='<div class="hint">Reading the trends…</div>';
  try{ const { brief } = await api('/referrals/insights?range='+($('rf_range').value||'90'));
    $('rfInsight').innerHTML = `<div class="ama-banner ama-low" style="margin-top:12px"><div class="ama-head" style="color:var(--gold)">✦ Why people leave + partner read</div><div class="brief-body">${esc(brief).replace(/\n/g,'<br>')}</div></div>`;
  }catch(e){ $('rfInsight').innerHTML='<span class="hint" style="color:var(--danger)">'+esc(e.message)+'</span>'; }
  finally{ btn.disabled=false; btn.textContent=l; }
}
async function loadPartners(){
  await ensureReferralMeta();
  const range = $('pt_range').value || '90';
  const s = await api('/referrals/summary?range='+range);
  $('sfRow').innerHTML = s.salesforce ? '<span class="risk risk-low">Salesforce connected</span>' : '<span class="risk risk-warn">Salesforce not connected — inbound referrals are manual until SF credentials are set</span>';
  const rows = s.reciprocity;
  $('ptTable').innerHTML = rows.length ? `<table class="tbl"><tr><th>Partner</th><th>Sent →</th><th>← Received</th><th>Net</th><th>Relationship</th></tr>`+
    rows.map(r=>{
      const flag = r.received===0 && r.sent>0 ? '<span class="risk risk-warn">we send, they don\'t</span>'
        : r.sent===0 && r.received>0 ? '<span class="risk risk-elev">they send, we don\'t</span>'
        : Math.abs(r.net)<=1 ? '<span class="risk risk-low">balanced</span>'
        : (r.net>0?'<span class="hint">we send more</span>':'<span class="hint">they send more</span>');
      return `<tr><td><strong>${esc(r.name)}</strong></td><td>${r.sent}</td><td>${r.received}</td><td>${r.net>0?'+':''}${r.net}</td><td>${flag}</td></tr>`;
    }).join('')+`</table>` : '<div class="hint">No partner activity in this window. Log referrals and partners below.</div>';
}
async function addPartner(){
  const name=$('pt_name').value.trim(); if(!name){ $('pt_msg').textContent='Name required.'; return; }
  $('pt_msg').textContent='Saving…';
  try{ await api('/facilities',{method:'POST',body:JSON.stringify({name,type:$('pt_type').value,location:$('pt_location').value})});
    $('pt_msg').textContent='✓ Partner saved.'; setTimeout(()=>$('pt_msg').textContent='',2500); refreshFacilityList(); loadPartners();
  }catch(e){ $('pt_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function logInbound(){
  const name=$('pt_name').value.trim(); if(!name){ $('pt_msg').textContent='Name the partner first.'; return; }
  try{ await api('/inbound-referrals',{method:'POST',body:JSON.stringify({facility_name:name,outcome:'pending'})});
    $('pt_msg').textContent='✓ Inbound referral logged.'; setTimeout(()=>$('pt_msg').textContent='',2500); loadPartners();
  }catch(e){ $('pt_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
/* ---- Front desk: scheduled arrivals ---- */
let _arrivalsTimer=null;
async function loadArrivals(){
  try{
    const d=await api('/arrivals');
    const c=d.counts||{};
    $('arrivalsKpis').innerHTML=
      `<div class="ret-card"><div class="n">${c.expected||0}</div><div class="l">Still expected</div></div>`+
      `<div class="ret-card"><div class="n" style="color:var(--good,#1a8)">${c.arrived||0}</div><div class="l">Arrived</div></div>`+
      `<div class="ret-card"><div class="n" style="color:var(--danger)">${c.no_show||0}</div><div class="l">No-show</div></div>`;
    const badge=(s)=> s==='arrived'?'<span class="risk risk-low">arrived</span>'
      : s==='no_show'?'<span class="risk risk-warn">no-show</span>'
      : s==='cancelled'?'<span class="hint">cancelled</span>'
      : '<span class="risk risk-elev">expected</span>';
    const rows=(d.arrivals||[]).map(a=>{
      const greet=esc((a.preferred_name||a.first_name||'')+' '+(a.last_name||''));
      const sub=[a.referral_source&&('via '+esc(a.referral_source)), a.insurance&&esc(a.insurance)].filter(Boolean).join(' · ');
      const acts = a.status==='arrived' && a.auto ? '<span class="hint">confirmed by Kipu</span>'
        : `<button class="btn btn-gold btn-sm sans" onclick="setArrival(${a.id},'arrived')">Arrived</button>`+
          `<button class="btn btn-ghost btn-sm sans" onclick="setArrival(${a.id},'no_show')">No-show</button>`+
          `<button class="btn btn-ghost btn-sm sans" onclick="setArrival(${a.id},'cancelled')">Cancel</button>`;
      return `<tr><td><strong>${greet}</strong>${sub?`<div class="hint">${sub}</div>`:''}</td><td>${badge(a.status)}</td><td style="text-align:right">${acts}</td></tr>`;
    }).join('');
    $('arrivalsList').innerHTML = rows
      ? `<table class="tbl"><tr><th>Guest</th><th>Status</th><th></th></tr>${rows}</table>`
      : (d.configured?'<div class="hint">No one scheduled to admit today.</div>':'<div class="hint">Connect Salesforce in Settings, then click “Pull from Salesforce.”</div>');
    const fu=(d.followUps||[]).map(a=>`<tr><td><strong>${esc((a.first_name||'')+' '+(a.last_name||''))}</strong><div class="hint">was due ${esc(a.scheduled_date||'')}${a.phone?' · '+esc(a.phone):''}</div></td>`+
      `<td><input class="sans" style="width:100%" placeholder="Follow-up note (what happened / next step)" value="${esc(a.follow_up||'')}" onchange="setArrivalNote(${a.id}, this.value)"/></td>`+
      `<td style="text-align:right"><button class="btn btn-ghost btn-sm sans" onclick="setArrival(${a.id},'cancelled')">Close</button></td></tr>`).join('');
    $('arrivalsFollow').innerHTML = fu ? `<table class="tbl"><tr><th>Guest</th><th>Follow-up</th><th></th></tr>${fu}</table>` : '<div class="hint">No outstanding no-shows. 🎉</div>';
  }catch(e){ $('arrivalsList').innerHTML='<div class="hint" style="color:var(--danger)">'+esc(e.message)+'</div>'; }
  clearTimeout(_arrivalsTimer); _arrivalsTimer=setTimeout(()=>{ if(document.getElementById('arrivals').classList.contains('active')) loadArrivals(); }, 60000);
}
async function setArrival(id,status){
  try{ await api('/arrivals/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadArrivals(); }
  catch(e){ alert(e.message); }
}
async function setArrivalNote(id,note){
  try{ await api('/arrivals/'+id+'/status',{method:'POST',body:JSON.stringify({status:'no_show',follow_up:note})}); }catch(e){}
}
async function arrivalsSync(){
  $('arrivals_msg').textContent='Pulling from Salesforce…';
  try{ const r=await api('/arrivals/sync',{method:'POST'}); $('arrivals_msg').textContent=`✓ ${r.pulled} scheduled · ${r.matched} already arrived (Kipu).`; loadArrivals(); }
  catch(e){ $('arrivals_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function syncSalesforce(){
  $('pt_msg').textContent='Syncing Salesforce…';
  try{ const r=await api('/salesforce/sync',{method:'POST'}); $('pt_msg').textContent=`✓ ${r.leads} leads pulled · ${r.matched} matched to admitted clients · referral source filled. ${r.partnerRefs} partner referrals.`; loadPartners(); }
  catch(e){ $('pt_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}

/* ---- risk & outcome analytics ---- */
async function loadAnalytics(){
  if(META.claude) $('anInsightBtn').style.display='inline-block';
  const a = await api('/analytics?range='+($('an_range').value||'365'));
  const t = a.totals;
  $('anKpis').innerHTML = `
    <div class="ret-card"><div class="n">${a.sampleSize}</div><div class="l">Completed stays</div></div>
    <div class="ret-card ${t.amaRate>=20?'rc-high':''}"><div class="n">${t.amaRate}%</div><div class="l">AMA rate</div></div>
    <div class="ret-card"><div class="n">${t.avgLos??'—'}</div><div class="l">Avg length of stay (days)</div></div>
    <div class="ret-card ${a.risk.length?'rc-warn':''}"><div class="n">${a.risk.length}</div><div class="l">At-risk now</div></div>`;
  // distribution table: label, n, avg LOS, AMA% with a small bar by AMA rate
  const distTable = (rows, lblHead) => rows.length ? `<table class="tbl"><tr><th>${lblHead}</th><th>Stays</th><th>Avg LOS</th><th>AMA %</th></tr>`+
    rows.map(r=>`<tr><td>${esc(r.key)}</td><td>${r.n}</td><td>${r.avgLos??'—'}</td><td>${r.n?`<span class="risk ${r.amaRate>=30?'risk-high':r.amaRate>=15?'risk-elev':'risk-low'}">${r.amaRate}%</span>`:'—'}</td></tr>`).join('')+`</table>`
    : '<div class="hint">No completed stays in this window yet.</div>';
  $('anDow').innerHTML = distTable(a.byDow, 'Day');
  $('anTime').innerHTML = distTable(a.byTime, 'Time');
  $('anDom').innerHTML = distTable(a.byDom, 'Part of month');
  const staffTable = (rows) => rows.length ? `<table class="tbl"><tr><th>Staff</th><th>Clients</th><th>Avg LOS</th><th>AMA %</th><th>Exp /5</th></tr>`+
    rows.map(r=>`<tr><td><strong>${esc(r.key)}</strong></td><td>${r.n}</td><td>${r.avgLos??'—'}</td><td><span class="risk ${r.amaRate>=30?'risk-high':r.amaRate>=15?'risk-elev':'risk-low'}">${r.amaRate}%</span></td><td>${r.exp??'—'}</td></tr>`).join('')+`</table>`
    : '<div class="hint">No staff attribution yet — set Primary Therapist / Case Manager on Care Cards (or sync Kipu).</div>';
  $('anTher').innerHTML = staffTable(a.byTherapist);
  $('anCM').innerHTML = staffTable(a.byCaseManager);
  $('anRisk').innerHTML = a.risk.length ? a.risk.map(r=>`<div class="todo"><div class="txt"><span class="risk ${r.level==='High'?'risk-high':'risk-elev'}">${esc(r.level)}</span> <strong>${esc(r.name)}</strong>${r.room?' · '+esc(r.room):''} <span class="hint">${esc(r.summary||'')}</span></div><button class="btn btn-ghost btn-sm sans" onclick="openJourney(${r.id})">Open</button></div>`).join('') : '<div class="hint">No active clients flagged Elevated/High. 🎉</div>';
  $('anMissing').innerHTML = a.missingDischarge.length ? a.missingDischarge.map(m=>`<div class="todo">
      <div class="txt"><strong>${esc(m.pref||m.name)}</strong> <span class="hint">· ${esc(m.discharge_status||'')} ${esc(m.discharge_date||'')}</span></div>
      <button class="btn btn-gold btn-sm sans" onclick="fillDischargeInfo(${m.id},'${esc((m.pref||m.name||'').replace(/'/g,''))}')">Add where/why</button>
    </div>`).join('') : '<div class="hint">Nothing missing — every discharge has where &amp; why. ✓</div>';
}
async function analyticsInsights(){
  const btn=$('anInsightBtn'); btn.disabled=true; const l=btn.textContent; btn.textContent='✦ Thinking…';
  $('anInsight').innerHTML='<div class="hint">Reading the patterns…</div>';
  try{ const { brief } = await api('/analytics/insights?range='+($('an_range').value||'365'));
    $('anInsight').innerHTML = `<div class="ama-banner ama-low" style="margin-top:12px"><div class="ama-head" style="color:var(--gold)">✦ What the data says</div><div class="brief-body">${esc(brief).replace(/\n/g,'<br>')}</div></div>`;
  }catch(e){ $('anInsight').innerHTML='<span class="hint" style="color:var(--danger)">'+esc(e.message)+'</span>'; }
  finally{ btn.disabled=false; btn.textContent=l; }
}
async function fillDischargeInfo(id, name){
  const destination = prompt('Where did '+name+' go? (facility / home / sober living…)'); if(destination===null) return;
  const reason = prompt('Why did they leave? (reason)')||'';
  await api('/clients/'+id+'/discharge-info',{method:'POST',body:JSON.stringify({destination:destination||null,reason:reason||null})});
  loadAnalytics();
}

/* ---- case management ---- */
let CM_CATS = null;
async function loadCaseMgmt(){
  const d = await api('/case-management');
  CM_CATS = d.categories;
  $('cmKpis').innerHTML = `
    <div class="ret-card ${d.openCount?'rc-warn':''}"><div class="n">${d.openCount}</div><div class="l">Open needs</div></div>
    <div class="ret-card"><div class="n">${d.clients.length}</div><div class="l">Clients with needs</div></div>
    ${d.byCategory.slice(0,4).map(c=>`<div class="ret-card"><div class="n">${c.n}</div><div class="l">${esc(c.k||'Other')}</div></div>`).join('')}`;
  $('cmList').innerHTML = d.clients.length ? d.clients.map(c=>{
    const open = c.tasks.filter(t=>t.status==='open');
    const done = c.tasks.filter(t=>t.status==='done');
    const opts = CM_CATS.map(x=>`<option>${esc(x)}</option>`).join('');
    const taskRow = t=>`<div class="todo">
      <div class="box" style="cursor:pointer" onclick="cmDone(${t.id},${t.status==='open'?'true':'false'})">${t.status==='done'?'✓':''}</div>
      <div class="txt ${t.status==='done'?'done':''}"><span class="badge">${esc(t.category||'Other')}</span> ${esc(t.item)}${t.source==='ai'?'':' <span class="hint">· added</span>'}</div>
      <button class="btn btn-ghost btn-sm sans" onclick="cmDelete(${t.id})">✕</button></div>`;
    return `<div class="card">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <strong style="font-size:16px">${esc(c.name)}</strong>${c.room?' <span class="hint">· Room '+esc(c.room)+'</span>':''}${c.program?' <span class="hint">· '+esc(c.program)+'</span>':''}
        <button class="btn btn-ghost btn-sm sans" style="margin-left:auto" onclick="openJourney(${c.id})">Open</button>
      </div>
      ${c.likes?`<div class="pc-touch" style="margin:10px 0">★ Likes: ${esc(c.likes)}</div>`:''}
      <div style="margin-top:8px">${open.length?open.map(taskRow).join(''):'<div class="hint">No open needs.</div>'}</div>
      ${done.length?`<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">${done.length} completed</summary>${done.map(taskRow).join('')}</details>`:''}
      <div class="handoff-add no-print" style="margin-top:10px">
        <select id="cmcat_${c.id}" style="width:auto">${opts}</select>
        <input id="cmitem_${c.id}" placeholder="Add a need to help with…"/>
        <button class="btn btn-ghost btn-sm sans" onclick="cmAdd(${c.id})">Add</button>
      </div>
    </div>`;
  }).join('') : '<div class="card"><div class="empty">No case-management needs yet. They populate automatically when the assessment reads the notes.</div></div>';
}
async function cmDone(id, done){ await api('/case-tasks/'+id+'/done',{method:'POST',body:JSON.stringify({done})}); loadCaseMgmt(); }
async function cmDelete(id){ await api('/case-tasks/'+id,{method:'DELETE'}); loadCaseMgmt(); }
async function cmAdd(cid){ const item=$('cmitem_'+cid).value.trim(); if(!item)return; await api('/case-tasks',{method:'POST',body:JSON.stringify({client_id:cid,category:$('cmcat_'+cid).value,item})}); loadCaseMgmt(); }

/* ---- Observation / safety rounds ---- */
let roundsTimer=null;
async function loadRounds(){
  clearTimeout(roundsTimer);
  const board=$('roundsBoard'); if(!board) return;
  let d; try{ d=await api('/rounds/board'); }catch(e){ board.innerHTML='<div class="hint">Could not load.</div>'; return; }
  $('roundsKpis').innerHTML = `
    <div class="ret-card ${d.overdue?'rc-high':''}"><div class="n">${d.overdue}</div><div class="l">Overdue now</div></div>
    <div class="ret-card"><div class="n">${d.onTime}</div><div class="l">On time</div></div>
    <div class="ret-card"><div class="n">${d.total}</div><div class="l">Clients</div></div>
    <div class="ret-card"><div class="n">q${d.defaultMin}</div><div class="l">Default cadence</div></div>`;
  const rows=[...d.rows].sort((a,b)=>(b.overdue-a.overdue)||((b.minsSince??1e9)-(a.minsSince??1e9)));
  board.innerHTML = rows.map(r=>{
    const when = r.minsSince==null?'never checked':(r.minsSince+'m ago'+(r.lastBy?' · '+esc(r.lastBy):''));
    return `<div class="cmd-row ${r.overdue?'cmd-row-flag':''}">
      ${r.photo?`<img src="${esc(r.photo)}" class="client-photo sm" alt=""/>`:''}
      <div class="cmd-row-main"><strong>${esc(r.name)}</strong>${r.room?' <span class="hint">· '+esc(r.room)+'</span>':''}
        <div class="hint">${r.overdue?'<span style="color:var(--danger);font-weight:600">OVERDUE</span> · ':''}last: ${when}${r.lastStatus&&r.lastStatus!=='ok'?' · '+esc(r.lastStatus):''} · q${r.interval}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-gold btn-sm sans" onclick="roundCheck(${r.id},'ok')">✓ Check</button>
        <button class="btn btn-ghost btn-sm sans" onclick="roundConcern(${r.id})" title="Log a concern">⚑</button>
      </div></div>`;
  }).join('');
  $('roundsAccount').innerHTML = (d.byPerson||[]).length ? d.byPerson.map(p=>`<div class="cmd-row"><div class="cmd-row-main"><strong>${esc(p.k)}</strong></div><span class="chip">${p.n} checks</span></div>`).join('') : '<div class="hint">No checks logged today yet.</div>';
  if(ME&&ME.role==='admin'){ try{ const es=await api('/rounds/escalation'); $('roundsEscalateRow').innerHTML=`<label class="trg" style="display:inline-flex"><input type="checkbox" ${es.on?'checked':''} onchange="setRoundsEscalation(this.checked)"/> Text the on-call leader when a client goes overdue ${es.smsReady?'':'<span class="hint">(connect Texting first)</span>'}</label>`; }catch(e){} }
  // Live: refresh every 45s so the clocks stay honest.
  if($('rounds').classList.contains('active')) roundsTimer=setTimeout(loadRounds, 45000);
}
async function roundCheck(id, status){ await api('/rounds/check',{method:'POST',body:JSON.stringify({client_id:id,status:status||'ok'})}); loadRounds(); }
async function roundConcern(id){ const note=prompt('What did you observe? (logs a safety concern)'); if(note===null) return; await api('/rounds/check',{method:'POST',body:JSON.stringify({client_id:id,status:'concern',note})}); loadRounds(); }
async function roundsSweep(){ if(!confirm('Log a completed safety check for EVERY client right now?')) return; await api('/rounds/sweep',{method:'POST'}); loadRounds(); }
async function setRoundsEscalation(on){ await api('/rounds/escalation',{method:'POST',body:JSON.stringify({on})}); }

/* ---- Dignity Kits ---- */
async function loadDignity(){
  const d = await api('/dignity');
  $('dignityKpis').innerHTML = `
    <div class="ret-card ${d.outstanding.length?'rc-warn':''}"><div class="n">${d.outstanding.length}</div><div class="l">Needs delivery</div></div>
    <div class="ret-card ${d.overdueCount?'rc-high':''}"><div class="n">${d.overdueCount}</div><div class="l">Overdue</div></div>
    <div class="ret-card"><div class="n">${d.deliveredToday}</div><div class="l">Delivered today</div></div>
    <div class="ret-card"><div class="n">${d.dueHours}h</div><div class="l">Delivery window</div></div>`;
  $('dignityOutstanding').innerHTML = d.outstanding.length ? d.outstanding.map(k=>`
    <div class="cmd-row ${k.overdue?'cmd-row-flag':''}">
      <div class="cmd-row-main"><strong>${esc(k.name)}</strong>${k.room?' <span class="hint">· Room '+esc(k.room)+'</span>':''}
        <div class="hint">${k.assigned_name?'Owner: '+esc(k.assigned_name):'For: '+esc(k.assigned_role||'any staff')} · due ${esc((k.due_by||'').slice(5,16).replace('T',' '))}${k.overdue?' · <span style="color:var(--danger);font-weight:600">OVERDUE</span>':''}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm sans" onclick="dignityDeliver(${k.id},'${esc(k.name).replace(/'/g,"\\'")}')">✓ Confirm delivered</button>
        <button class="btn btn-ghost btn-sm sans" onclick="dignityNa(${k.id})">N/A</button>
      </div>
    </div>`).join('') : '<div class="hint">All kits delivered. 🎉</div>';
  $('dignityDelivered').innerHTML = d.delivered.length ? d.delivered.slice(0,40).map(k=>`
    <div class="cmd-row"><div class="cmd-row-main"><strong>${esc(k.name)}</strong>${k.room?' <span class="hint">· '+esc(k.room)+'</span>':''}
      <div class="hint">by ${esc(k.delivered_by||'—')} · ${esc((k.delivered_at||'').slice(5,16).replace('T',' '))}${k.late?' · <span style="color:var(--danger)">late</span>':''}</div></div>
      <button class="btn btn-ghost btn-sm sans" onclick="dignityReopen(${k.id})">Undo</button></div>`).join('') : '<div class="hint">None delivered yet.</div>';
  $('dignityAccount').innerHTML = d.accountability.length ? d.accountability.map(p=>`
    <div class="cmd-row"><div class="cmd-row-main"><strong>${esc(p.name)}</strong></div>
      <span class="chip">${p.delivered} delivered${p.late?' · '+p.late+' late':''}</span></div>`).join('') : '<div class="hint">No deliveries logged yet.</div>';
}
async function dignityDeliver(id, name){
  if(!confirm('Confirm you personally handed '+(name||'this client')+' their Dignity Kit?')) return;
  await api('/dignity/'+id+'/deliver',{method:'POST',body:JSON.stringify({})}); loadDignity();
}
async function dignityNa(id){ const note=prompt('Mark not needed — reason? (e.g. client brought their own)'); if(note===null) return; await api('/dignity/'+id+'/na',{method:'POST',body:JSON.stringify({note})}); loadDignity(); }
async function dignityReopen(id){ await api('/dignity/'+id+'/reopen',{method:'POST'}); loadDignity(); }

/* ---- Documentation compliance ---- */
async function loadCompliance(){
  let d; try{ d=await api('/compliance'); }catch(e){ $('compFields').innerHTML='<div class="card"><div class="empty">Available to leadership.</div></div>'; return; }
  $('compScore').textContent = (d.score==null?'—':d.score+'%')+' complete · '+d.clients+' clients';
  $('compFields').innerHTML = (d.fields||[]).map(f=>{
    const pct=f.pct==null?0:f.pct;
    const col=f.pct==null?'var(--muted)':pct>=90?'var(--good)':pct>=60?'var(--gold)':'var(--danger)';
    const od=f.overdue||[];
    return `<div class="card">
      <div class="cmd-hero-row">
        <div><strong>${esc(f.label)}</strong> <span class="hint">· due within ${f.slaHrs}h of admit</span></div>
        <div><span class="risk ${pct>=90?'risk-low':pct>=60?'risk-elev':'risk-high'}">${f.pct==null?'—':pct+'%'}</span> <span class="hint">${f.complete}/${f.total}${f.overdueCount?' · '+f.overdueCount+' overdue':''}</span></div>
      </div>
      <div class="trbar-track" style="margin:8px 0"><div class="trbar-fill" style="width:${pct}%;background:${col}"></div></div>
      ${od.length?`<details><summary class="hint" style="cursor:pointer">${od.length} overdue — show</summary>${od.map(o=>`<div class="cmd-row cmd-row-flag"><div class="cmd-row-main"><strong>${esc(o.name)}</strong>${o.room?' <span class="hint">· '+esc(o.room)+'</span>':''}<div class="hint">${o.mins==null?'admit time unknown':Math.floor(o.mins/60)+'h since admit'} · still missing</div></div><button class="btn btn-ghost btn-sm sans" onclick="openJourney(${o.id})">Open</button></div>`).join('')}</details>`:'<div class="hint">All current clients complete (or within the window). ✓</div>'}
    </div>`;
  }).join('');
  loadOwnerAccountability();
}
async function loadOwnerAccountability(){
  const host=$('compFields'); if(!host) return;
  let d; try{ d=await api('/accountability/owners'); }catch(e){ return; }
  const tbl=(rows,who)=>rows.length?`<table class="tbl"><thead><tr><th>${who}</th><th style="text-align:right">Caseload</th><th style="text-align:right">Chart complete</th><th style="text-align:right">Care cards</th><th style="text-align:right">AMA</th><th style="text-align:right">Avg stay</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.owner)}</td><td style="text-align:right">${r.caseload}</td><td style="text-align:right"><span class="risk ${r.chartPct>=90?'risk-low':r.chartPct>=60?'risk-elev':'risk-high'}">${r.chartPct}%</span></td><td style="text-align:right">${r.ccPct}%</td><td style="text-align:right">${r.amaRate==null?'—':r.amaRate+'%'}</td><td style="text-align:right">${r.avgLos==null?'—':r.avgLos+'d'}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">No assigned owners yet (they come from Kipu note authors after a Read).</div>';
  const card=document.createElement('div'); card.className='card';
  card.innerHTML=`<h3>By owner — accountability</h3>
    <p class="sub sans">Chart completeness &amp; outcomes per therapist / case manager (their active caseload; AMA + avg stay from the last 90 days).</p>
    ${(d.unassignedTherapist||d.unassignedCM)?`<div class="pc-note">⚠ ${d.unassignedTherapist} client(s) with no therapist · ${d.unassignedCM} with no case manager assigned in Kipu.</div>`:''}
    <div class="cmd-sub">Therapists</div>${tbl(d.byTherapist,'Therapist')}
    <div class="cmd-sub">Case managers</div>${tbl(d.byCaseManager,'Case manager')}`;
  host.appendChild(card);
}

/* ---- Leadership Command Center ---- */
async function loadCommandPeriod(){
  const since=($('periodSince')&&$('periodSince').value)||'2026-06-01';
  let p; try{ p = await api('/command/since?date='+encodeURIComponent(since)); }catch(e){ return; }
  const dc=p.discharged||{}, sc=p.scheduled||{};
  $('periodKpis').innerHTML=
    `<div class="ret-card"><div class="n">${sc.total||0}</div><div class="l">Scheduled</div></div>`+
    `<div class="ret-card"><div class="n">${p.admitted||0}</div><div class="l">Admitted</div></div>`+
    `<div class="ret-card"><div class="n">${dc.total||0}</div><div class="l">Discharged</div></div>`+
    `<div class="ret-card ${dc.amaRate>=20?'rc-high':(p.ama&&p.ama.count?'rc-warn':'')}"><div class="n">${(p.ama&&p.ama.count)||0}</div><div class="l">AMA · ${dc.amaRate||0}%</div></div>`+
    `<div class="ret-card"><div class="n">${dc.avgLos!=null?dc.avgLos:'—'}</div><div class="l">Avg LOS (days)</div></div>`;
  const sb=Object.entries(dc.byStatus||{}).map(([k,n])=>`<span class="risk ${/ama/i.test(k)?'risk-warn':'risk-low'}" style="margin-right:6px">${esc(k)}: ${n}</span>`).join('');
  const row=(a)=>`<tr onclick="editClient(${a.id})" style="cursor:pointer" title="Open full chart">`+
    `<td><strong>${esc(a.name)}</strong>${a.therapist?`<div class="hint">${esc(a.therapist)}</div>`:''}</td>`+
    `<td>${/ama/i.test(a.status)?'<span class="risk risk-warn">AMA</span>':esc(a.status||'')}</td>`+
    `<td>${esc(a.date||'')}</td><td>${a.los!=null?a.los+'d':'—'}</td>`+
    `<td>${esc(a.reason||'')||'<span class=hint>—</span>'}</td>`+
    `<td>${a.hasRead?'<span class="risk risk-low">read ✓</span>':'<span class="hint">›</span>'}</td></tr>`;
  const dlist=(dc.list||[]);
  $('periodDetail').innerHTML =
    (sb?`<div style="margin:10px 0">${sb}</div>`:'')+
    (dlist.length?`<div class="cmd-sub">All discharges — click any patient to open the full chart and review the notes</div>`+
      `<table class="tbl"><tr><th>Client</th><th>Type</th><th>Left</th><th>LOS</th><th>Reason / what we'd improve</th><th></th></tr>${dlist.map(row).join('')}</table>`
      :'<div class="hint" style="margin-top:8px">No discharges in this period.</div>');
}
async function loadCommand(){
  let d; try{ d = await api('/command/overview'); }catch(e){ $('cmdFlow').innerHTML='<div class="card"><div class="empty">Command Center is available to leadership.</div></div>'; return; }
  loadCommandPeriod();
  $('cmdAsOf').textContent = 'as of '+new Date(d.asOf).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const f = d.flow;
  $('cmdFlow').innerHTML = `
    <div class="ret-card"><div class="n">${f.census}</div><div class="l">Census</div></div>
    ${d.scheduled?`<div class="ret-card ${d.scheduled.waiting?'rc-warn':''}" onclick="show('arrivals')" style="cursor:pointer"><div class="n">${d.scheduled.waiting}</div><div class="l">Scheduled to arrive</div></div>`:''}
    <div class="ret-card"><div class="n">${f.admitsToday}</div><div class="l">Admits today</div></div>
    <div class="ret-card"><div class="n">${f.dischargesToday}</div><div class="l">Discharges today</div></div>
    <div class="ret-card"><div class="n">${f.discharges7d}</div><div class="l">Discharges · 7d</div></div>
    <div class="ret-card ${d.staffing.gaps.length?'rc-high':''}"><div class="n">${d.staffing.pct!=null?d.staffing.pct+'%':'—'}</div><div class="l">Covered today</div></div>
    <div class="ret-card ${d.documentation.gaps.length?'rc-warn':''}"><div class="n">${d.documentation.gaps.length}</div><div class="l">Doc gaps</div></div>
    ${d.rounds?`<div class="ret-card ${d.rounds.overdue?'rc-high':''}"><div class="n">${d.rounds.overdue}</div><div class="l">Rounds overdue</div></div>`:''}
    ${d.careCards?`<div class="ret-card ${d.careCards.overdue?'rc-high':(d.careCards.incomplete?'rc-warn':'')}"><div class="n">${d.careCards.incomplete}</div><div class="l">Care cards to fill</div></div>`:''}`;

  // Midnight Census — mirrors the nightly census email
  if($('cmdCensus')){
    if(d.syncedAt) $('censusAsOf').textContent='Kipu data as of '+new Date(d.syncedAt.replace(' ','T')+'Z').toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const lv=(d.levels&&d.levels.census)||[];
    const locLine = lv.length ? lv.map(l=>`<div class="cmd-row"><div class="cmd-row-main"><strong>${esc(l.code||l.label)}</strong>${l.code?' <span class="hint">'+esc(l.label)+'</span>':''}</div><span class="risk risk-low">${l.count}</span></div>`).join('') : '<div class="hint">No level-of-care data — run a Kipu sync.</div>';
    const intakes=(f.admitsTodayList||[]);
    const dcs=(f.dischargesTodayList||[]);
    const dcRecent=(f.dischargesRecentList||[]);
    const sendouts=(f.sendouts||[]);
    const dcLine=(x,extra='')=>`<div class="pc-note"${x.id?` onclick="editClient(${x.id})" style="cursor:pointer" title="Open chart"`:''}>↗ <strong>${esc(x.name)}</strong> — ${esc(x.status)}${extra}${x.reason?' · '+esc(x.reason):''}${x.id?' <span class="hint">›</span>':''}</div>`;
    const dcBlock = dcs.length
      ? dcs.map(x=>dcLine(x)).join('')
      : '<div class="pc-note">ZERO today</div>'+(dcRecent.length?`<div class="hint" style="margin-top:4px">Recent (72h):</div>`+dcRecent.map(x=>dcLine(x,` <span class="hint">${esc(x.date||'')}</span>`)).join(''):'');
    const sendoutBlock = sendouts.length?sendouts.map(s=>`<div class="pc-note">🏥 <strong>${esc(s.client_name)}</strong> — ${esc(s.destination||'sent out')}${s.reason?': '+esc(s.reason):''}</div>`).join(''):'<div class="hint">None out right now.</div>';
    const sched=(d.scheduled&&d.scheduled.list)||[];
    const schedBlock = sched.length
      ? sched.map(s=>`<div class="pc-note">${s.status==='arrived'?'✓':s.status==='no_show'?'✕':'•'} <strong>${esc(s.name)}</strong> <span class="hint">${esc(s.status==='no_show'?'no-show':s.status)}</span></div>`).join('')
      : '<div class="pc-note">None scheduled</div>';
    $('cmdCensus').innerHTML =
      `<div class="cmd-sub">By level of care</div>${locLine}`+
      `<div class="cmd-row" style="border-top:2px solid var(--line)"><div class="cmd-row-main"><strong>TOTAL CENSUS</strong></div><span class="risk risk-elev">${f.census}</span></div>`+
      `<div class="cmd-sub">Scheduled to arrive today</div>${schedBlock}`+
      `<div class="cmd-sub">Intakes today</div>${intakes.length?intakes.map(a=>`<div class="pc-note">☀ <strong>${esc(a.name)}</strong>${a.loc?' · '+esc(a.loc):''}</div>`).join(''):'<div class="pc-note">ZERO</div>'}`+
      `<div class="cmd-sub">Discharges</div>${dcBlock}`+
      `<div class="cmd-sub">Other — medical send-outs (ED / hospital)</div>${sendoutBlock}`+
      `<div class="handoff-add no-print" style="margin-top:10px;flex-wrap:wrap">
         <input id="so_name" placeholder="Client" style="flex:1;min-width:120px"/>
         <input id="so_dest" placeholder="Where (e.g. Akron General ED)" style="flex:1;min-width:140px"/>
         <input id="so_reason" placeholder="Reason" style="flex:2;min-width:160px"/>
         <button class="btn btn-ghost btn-sm sans" onclick="sendoutAdd()">Log send-out</button>
       </div>
       <div class="toolbar no-print" style="justify-content:flex-start;margin-top:8px">
         <button class="btn btn-gold btn-sm sans" onclick="emailCensus()">✉ Email census now</button>
         <button class="btn btn-ghost btn-sm sans" onclick="censusRecipients()">Recipients…</button>
         <span id="censusMsg" class="hint" style="align-self:center"></span>
       </div>`;
  }

  // Daily snapshot (midnight cutoff) + 14-day trend
  const dm = d.daily.today;
  $('cmdCutoff').textContent = 'resets at midnight';
  const spart = (label,val,cls)=>`<div class="cmd-day"><div class="cmd-day-n ${cls||''}">${val}</div><div class="cmd-day-l">${label}</div></div>`;
  const tr = d.daily.trend||[];
  const mx = Math.max(1,...tr.map(t=>Math.max(t.intakes,t.discharges,t.ama)));
  const sched = tr.length ? `<div class="cmd-trend">${tr.map(t=>{
    const dd=new Date(t.date+'T12:00').getDate();
    return `<div class="cmd-trend-col" title="${t.date} · ${t.intakes} in · ${t.discharges} out · ${t.loc_changes} LOC · ${t.ama} AMA">
      <div class="cmd-trend-bars"><span style="height:${Math.round(t.intakes/mx*40)}px;background:var(--good)"></span><span style="height:${Math.round(t.discharges/mx*40)}px;background:var(--gold)"></span><span style="height:${Math.round(t.ama/mx*40)}px;background:var(--danger)"></span></div>
      <div class="cmd-trend-d">${dd}</div></div>`;}).join('')}</div>
    <div class="hint" style="margin-top:6px"><span style="color:var(--good)">●</span> intakes &nbsp;<span style="color:var(--gold)">●</span> discharges &nbsp;<span style="color:var(--danger)">●</span> AMA</div>` : '<div class="hint">The daily trend builds up from today onward.</div>';
  $('cmdDaily').innerHTML = `<div class="cmd-days">${spart('Intakes',dm.intakes)}${spart('Discharges',dm.discharges)}${spart('LOC changes',dm.loc_changes)}${spart('AMA',dm.ama,dm.ama?'cmd-day-bad':'')}${spart('Census',dm.census)}</div>${sched}`;

  // Census by level of care + step-downs
  const lv = d.levels;
  const lvRows = lv.census.length ? lv.census.map(l=>`<tr><td>${l.code?`<strong>${esc(l.code)}</strong> <span class="hint">${esc(l.label)}</span>`:`<strong>${esc(l.label)}</strong>`}</td><td style="text-align:right">${l.count}</td><td style="text-align:right">${l.avgLos!=null?l.avgLos+'d':'—'}</td></tr>`).join('') : '<tr><td colspan="3" class="hint">No level-of-care data yet — it fills in on the next Kipu sync.</td></tr>';
  const dest = lv.stepByDest.length ? lv.stepByDest.map(s=>`<span class="chip">→ ${esc(s.code)} · ${s.n}</span>`).join(' ') : '<span class="hint">No level-of-care changes recorded in the last 30 days yet.</span>';
  $('cmdLevels').innerHTML = `
    <table class="tbl"><thead><tr><th>Level of care</th><th style="text-align:right">Clients</th><th style="text-align:right">Avg stay</th></tr></thead><tbody>${lvRows}</tbody></table>
    <div class="cmd-sub">Step-downs · last 30 days <span class="hint" style="text-transform:none;letter-spacing:0">(${lv.stepDowns} down · ${lv.stepUps} up)</span></div>
    <div>${dest}</div>`;

  // Detox step-down clock
  $('cmdDetox').innerHTML = d.detox.length ? d.detox.map(c=>{
    const los = c.los==null?'—':c.los+'d';
    return `<div class="cmd-row ${c.overdue?'cmd-row-flag':''}">
      <div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}
        <div class="hint">${esc(c.program||'Detox')}${c.step_down&&c.step_down!=='Unknown'?' → '+esc(c.step_down):''}</div></div>
      <div class="cmd-row-tag"><span class="risk ${c.overdue?'risk-high':'risk-low'}">${los}${c.overdue?' · over 4':''}</span></div>
    </div>`;
  }).join('') : '<div class="hint">No detox/3.2-WM clients on the census.</div>';

  // Discharge planning
  const p = d.planning;
  const sd = Object.entries(p.stepDownCounts).sort((a,b)=>b[1]-a[1]);
  const chips = sd.map(([k,n])=>`<span class="chip">${esc(k)} · ${n}</span>`).join(' ');
  const transRows = p.transportNeeded.length ? p.transportNeeded.map(c=>`<div class="cmd-row cmd-row-flag"><div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}<div class="hint">${esc(c.step_down)} · transport not yet arranged</div></div><span class="risk risk-elev">ride needed</span></div>`).join('') : '';
  const antiRows = p.anticipated.length ? p.anticipated.map(c=>`<div class="cmd-row"><div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}<div class="hint">→ ${esc(c.step_down)} · transport: ${esc(c.transport)}</div></div><span class="chip">${esc(c.when)}</span></div>`).join('') : '';
  $('cmdPlanning').innerHTML = `<div style="margin-bottom:10px">${chips||'<span class="hint">No step-down plans documented yet.</span>'}</div>`+
    (p.undecided.length?`<div class="pc-note">⚠ ${p.undecided.length} client${p.undecided.length>1?'s':''} undecided on next level of care — needs a documented conversation.</div>`:'')+
    (transRows?`<div class="cmd-sub">Transportation needed</div>${transRows}`:'')+
    (antiRows?`<div class="cmd-sub">Anticipated discharges</div>${antiRows}`:'')+
    (!transRows&&!antiRows&&!p.undecided.length?'<div class="hint">Nothing pending. Discharge planning looks current.</div>':'');

  // Documentation compliance
  const dg = d.documentation;
  $('cmdDocs').innerHTML = `<div class="pc-note" style="margin-bottom:8px"><span class="risk risk-low">${dg.clean}</span> of ${dg.total} clients look documentation-complete.</div>`+
    (dg.gaps.length ? dg.gaps.map(c=>`<div class="cmd-row cmd-row-flag"><div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}<div style="margin-top:4px">${c.flags.map(fl=>`<span class="chip chip-warn">${esc(fl)}</span>`).join(' ')}</div></div></div>`).join('') : '<div class="hint">No documentation gaps detected in the notes. ✓</div>');

  // Staffing
  const st = d.staffing;
  $('cmdStaffing').innerHTML = `
    <div class="pc-note"><span class="risk ${st.gaps.length?'risk-high':'risk-low'}">${st.pct!=null?st.pct+'% covered':'no schedule set'}</span> ${st.needed?'· '+st.scheduled+'/'+st.needed+' assigned':''}${st.callOffsToday?' · <strong>'+st.callOffsToday+' call-off'+(st.callOffsToday>1?'s':'')+'</strong>':''}</div>`+
    (st.gaps.length ? '<div class="cmd-sub">Open coverage</div>'+st.gaps.map(g=>`<div class="cmd-row cmd-row-flag"><div class="cmd-row-main"><strong>${esc(g.part)}</strong> · ${esc(g.role)}</div><span class="risk risk-elev">short ${g.short}</span></div>`).join('') : (st.needed?'<div class="hint">Every shift covered today. ✓</div>':'<div class="hint">No shifts scheduled yet today. Set them on the Schedule screen.</div>'));

  loadCommandTrends();
  loadCommandChecklist();
  loadCommandIssues(ISSUE_RANGE);
  loadCareCards();
  cmdAssessPoll();
}
async function loadCareCards(){
  const box=$('cmdCareCards'); if(!box) return;
  let d; try{ d=await api('/carecards'); }catch(e){ return; }
  if($('ccProgress')) $('ccProgress').textContent = `${d.complete}/${d.total} complete${d.overdue?' · '+d.overdue+' overdue':''}`;
  const inc=d.incomplete||[];
  box.innerHTML = inc.length ? inc.map(c=>{
    const m=c.minsSinceAdmit;
    const clock = m==null?'admit time unknown':(m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m')+' since admit';
    return `<div class="cmd-row ${c.overdue?'cmd-row-flag':''}">
      <div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}
        <div class="hint">${c.overdue?'<span style="color:var(--danger);font-weight:600">OVERDUE</span> · ':''}${clock} · missing: ${c.missing.map(esc).join(', ')}</div></div>
      <button class="btn btn-gold btn-sm sans" onclick="openJourney(${c.id})">Fill Care Card</button>
    </div>`;
  }).join('') : '<div class="hint">Every active client has a complete Care Card. ✓</div>';
}
async function sendoutAdd(){
  const client_name=$('so_name').value.trim(); if(!client_name){ $('censusMsg').textContent='Enter a client.'; return; }
  await api('/sendouts',{method:'POST',body:JSON.stringify({client_name,destination:$('so_dest').value,reason:$('so_reason').value})});
  loadCommand();
}
async function emailCensus(){
  $('censusMsg').textContent='Sending…';
  try{ const r=await api('/command/census/email',{method:'POST'}); $('censusMsg').textContent = r.sent?('✓ Emailed to '+r.to):('Not sent — '+(r.reason||'email not configured')); }
  catch(e){ $('censusMsg').textContent='Error: '+e.message; }
}
async function censusRecipients(){
  let cur=''; try{ cur=(await api('/command/census/recipients')).to||''; }catch(e){}
  const to=prompt('Email the midnight census to (comma-separated addresses):', cur);
  if(to===null) return;
  await api('/command/census/recipients',{method:'POST',body:JSON.stringify({to})});
  $('censusMsg').textContent='✓ Recipients saved';
}
let ISSUE_RANGE='day';
function setIssueRange(r){ ISSUE_RANGE=r; $('issTabDay').classList.toggle('active',r==='day'); $('issTabWeek').classList.toggle('active',r==='week'); loadCommandIssues(r); }
async function loadCommandIssues(range, refresh){
  const box=$('cmdIssues'); if(!box) return;
  box.innerHTML='<div class="hint">Reading the notes…</div>';
  let d; try{ d=await api('/command/issues?range='+range+(refresh?'&refresh=1':'')); }catch(e){ box.innerHTML='<div class="hint">Could not load.</div>'; return; }
  if(!d.sampleSize){ box.innerHTML='<div class="empty">Nothing flagged in this window yet. Run “✦ Read all notes” to scan the latest documentation, then check back.</div>'; return; }
  const sev=s=>`<span class="risk ${s==='High'?'risk-high':s==='Medium'?'risk-elev':'risk-low'}">${esc(s)}</span>`;
  const issues=(d.digest&&d.digest.top_issues)||[];
  const issuesHtml = issues.length ? issues.map(i=>`
    <div class="cmd-row" style="align-items:flex-start">
      <div class="cmd-row-main">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong>${esc(i.issue)}</strong>${sev(i.severity)}<span class="hint">${i.mentions} mention${i.mentions==1?'':'s'}</span></div>
        <div class="pc-note" style="font-style:italic;margin-top:4px">“${esc(i.example||'')}”</div>
        <div class="note-act" style="margin-top:4px">→ ${esc(i.fix||'')}</div>
      </div>
    </div>`).join('') : (d.ai?'<div class="hint">No clear pattern yet — see raw signals below.</div>':'<div class="hint">AI clustering is off; showing raw signal counts.</div>');
  const chips=(d.counts||[]).map(c=>`<span class="chip">${esc(c.label)} · ${c.n}</span>`).join(' ');
  box.innerHTML =
    (d.digest&&d.digest.summary?`<div class="pc-note" style="margin-bottom:10px">${esc(d.digest.summary)}</div>`:'')+
    issuesHtml+
    (chips?`<div class="cmd-sub">Signal counts (${range==='week'?'7 days':'24 hours'})</div><div>${chips}</div>`:'');
}
let cmdAssessTimer=null;
async function cmdAssess(){
  const btn=$('cmdAssessBtn');
  try{ const r=await api('/assess-all',{method:'POST'});
    if(r.started===false && !r.already){ $('cmdAssessMsg').textContent='Could not start — AI may not be configured.'; return; }
    if(btn) btn.disabled=true; cmdAssessPoll();
  }catch(e){ $('cmdAssessMsg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function cmdAssessPoll(){
  clearTimeout(cmdAssessTimer); const msg=$('cmdAssessMsg'); if(!msg) return;
  try{ const s=await api('/assess-all/status');
    const btn=$('cmdAssessBtn');
    if(s.running){
      if(btn) btn.disabled=true;
      msg.innerHTML=`Reading notes… <strong>${s.done}/${s.total}</strong> · ${s.high} high · ${s.elevated} elevated${s.current?' · '+esc(s.current):''}`;
      cmdAssessTimer=setTimeout(cmdAssessPoll, 2500);
    } else {
      if(btn) btn.disabled=false;
      if(s.total && s.finishedAt){ msg.innerHTML=`✓ Read ${s.done} clients — <strong>${s.high} high</strong>, ${s.elevated} elevated, ${s.low} low${s.flagged?' · '+s.flagged+' flagged':''}${s.errors?` · <span style="color:var(--danger)">${s.errors} errors</span>`:''}. <a href="#" onclick="loadCommand();return false">Refresh ↻</a>`+(s.errors&&s.lastError?`<div class="hint" style="color:var(--danger)">Last error: ${esc(s.lastError)}</div>`:''); }
      else { msg.textContent=''; }
    }
  }catch(e){ /* silent */ }
}
async function loadCommandTrends(){
  const range = $('cmdTrendRange') ? $('cmdTrendRange').value : '365';
  let a; try{ a = await api('/analytics?range='+range); }catch(e){ return; }
  if(!a.sampleSize){ $('cmdTrends').innerHTML = '<div class="empty">No discharge history in this window yet. Day-of-week, time-of-day and referral-source trends appear automatically as clients are discharged through Kipu.</div>'; return; }
  // A labeled retention table: avg stay + AMA-rate bar per bucket.
  const bucketTbl = (rows, head, note)=>{
    const live = rows.filter(r=>r.n>0);
    if(!live.length) return '';
    const noteHtml = note?`<div class="hint" style="margin:2px 0 8px">${note}</div>`:'';
    return `<div class="cmd-sub">${head}</div>${noteHtml}`+live.map(r=>`
      <div class="trbar">
        <div class="trbar-l">${esc(r.key)} <span class="hint">(${r.n})</span></div>
        <div class="trbar-track"><div class="trbar-fill" style="width:${r.amaRate}%;background:${r.amaRate>=40?'var(--danger)':r.amaRate>=20?'var(--gold)':'var(--good)'}"></div></div>
        <div class="trbar-n">${r.amaRate}% AMA</div>
        <div class="trbar-n" style="flex-basis:54px">${r.avgLos!=null?r.avgLos+'d stay':'—'}</div>
      </div>`).join('');
  };
  // Day of week insight
  const dow = a.byDow.filter(r=>r.n>0);
  const shortest = dow.filter(r=>r.avgLos!=null).sort((x,y)=>x.avgLos-y.avgLos)[0];
  const mostAma = [...dow].sort((x,y)=>y.amaRate-x.amaRate)[0];
  const dowNote = (shortest&&mostAma)?`⏱ Shortest stays: <strong>${esc(shortest.key)}</strong> (${shortest.avgLos}d avg) · ⚠ Most AMA: <strong>${esc(mostAma.key)}</strong> (${mostAma.amaRate}%)`:'';
  // Time of day insight
  const tm = a.byTime.filter(r=>r.n>0);
  const tmAma = [...tm].sort((x,y)=>y.amaRate-x.amaRate)[0];
  const tmNote = tmAma?`⚠ Hardest window: <strong>${esc(tmAma.key)}</strong> (${tmAma.amaRate}% AMA)`:'';
  // Referral sources — retention (which sources send clients who STAY), with
  // inbound conversion as a secondary read.
  const rso = (a.bySourceOutcome||[]).filter(r=>r.n>0);
  const rsc = (a.byReferralSource||[]).filter(r=>r.n>0);
  let rsBlock = '';
  if (rso.length){
    const best = [...rso].filter(r=>r.avgLos!=null).sort((x,y)=>y.avgLos-x.avgLos)[0];
    rsBlock = bucketTbl(rso, 'Referral sources — retention', best?`✅ Best retention: <strong>${esc(best.key)}</strong> (${best.avgLos}d avg stay)`:'');
  } else if (rsc.length){
    rsBlock = `<div class="cmd-sub">Referral sources — conversion</div>`+rsc.map(r=>`
      <div class="trbar"><div class="trbar-l">${esc(r.key)} <span class="hint">(${r.n})</span></div>
        <div class="trbar-track"><div class="trbar-fill" style="width:${r.admitRate}%;background:var(--good)"></div></div>
        <div class="trbar-n">${r.admitRate}% admitted</div></div>`).join('')+
      `<div class="hint" style="margin-top:6px">Retention by source appears once discharged clients have a referral source recorded.</div>`;
  } else {
    rsBlock = '<div class="cmd-sub">Referral sources</div><div class="hint">Add a referral source on the Care Card (or it syncs from Kipu) to see which sources send clients who stay.</div>';
  }
  $('cmdTrends').innerHTML =
    `<div class="pc-note" style="margin-bottom:10px">Based on ${a.sampleSize} discharges · AMA rate overall ${a.totals.amaRate}% · avg stay ${a.totals.avgLos!=null?a.totals.avgLos+'d':'—'}</div>`+
    bucketTbl(a.byDow, 'By admit day of week', dowNote)+
    bucketTbl(a.byTime, 'By admit time of day', tmNote)+
    rsBlock;
}
async function loadCommandChecklist(){
  const {items} = await api('/command/checklist');
  const done = items.filter(i=>i.status==='done').length;
  const na = items.filter(i=>i.status==='na').length;
  $('cmdChkProgress').textContent = `${done}/${items.length} done${na?' · '+na+' n/a':''}`;
  const sections = [...new Set(items.map(i=>i.section))];
  $('cmdChecklist').innerHTML = sections.map(sec=>{
    const rows = items.filter(i=>i.section===sec).map(i=>`<div class="todo">
      <div class="box" style="cursor:pointer" onclick="cmdChk(${i.id},'${i.status==='done'?'open':'done'}')">${i.status==='done'?'✓':(i.status==='na'?'–':'')}</div>
      <div class="txt ${i.status==='done'?'done':''}">${esc(i.item)}${i.done_by&&i.status!=='open'?` <span class="hint">· ${esc(i.done_by)} ${i.done_at?new Date(i.done_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):''}</span>`:''}</div>
      <button class="btn btn-ghost btn-sm sans" title="Not applicable today" onclick="cmdChk(${i.id},'${i.status==='na'?'open':'na'}')">${i.status==='na'?'undo':'n/a'}</button></div>`).join('');
    return `<div class="cmd-chk-sec"><div class="cmd-sub">${esc(sec)}</div>${rows}</div>`;
  }).join('');
}
async function cmdChk(id, status){ await api('/command/checklist/'+id,{method:'POST',body:JSON.stringify({status})}); loadCommandChecklist(); }

/* ---- scheduling & workforce ---- */
async function loadCoverage(){
  // clock-in/out widget
  try{ const c = await api('/clock/status');
    $('clockBox').innerHTML = c.clockedIn
      ? `<span class="risk risk-low" style="margin-right:8px">On the clock</span><button class="btn btn-ghost sans" onclick="clockToggle(false)">Clock out</button>`
      : `<button class="btn btn-gold sans" onclick="clockToggle(true)">🕐 Clock in</button>`;
  }catch(e){}
  const s = await api('/workforce/summary?range=30');
  const cov = s.coverage;
  $('wfKpis').innerHTML = `
    <div class="ret-card"><div class="n">${s.onNow.length}</div><div class="l">On shift now</div></div>
    <div class="ret-card ${cov.pct!=null&&cov.pct<100?'rc-warn':''}"><div class="n">${cov.pct!=null?cov.pct+'%':'—'}</div><div class="l">Today covered (${cov.scheduled}/${cov.needed})</div></div>
    <div class="ret-card ${cov.gaps?'rc-high':''}"><div class="n">${cov.gaps}</div><div class="l">Coverage gaps today</div></div>
    <div class="ret-card ${s.calloffsWeek?'rc-elev':''}"><div class="n">${s.calloffsWeek}</div><div class="l">Call-offs this week</div></div>
    <div class="ret-card"><div class="n">${s.roundsToday}</div><div class="l">Rounds today</div></div>
    <div class="ret-card"><div class="n">${s.dutiesToday}</div><div class="l">Duties logged today</div></div>`;
  $('wfOnNow').innerHTML = s.onNow.length ? s.onNow.map(p=>`<div class="pc-note">🟢 <strong>${esc(p.user_name||'')}</strong> <span class="hint">since ${esc((p.clock_in||'').slice(11,16))}</span></div>`).join('') : '<div class="hint">No one clocked in right now.</div>';
  const bars=(rows)=>{ const max=Math.max(1,...rows.map(r=>r.n)); return rows.length&&rows.some(r=>r.n)?rows.map(r=>`<div class="pc-note" style="display:flex;justify-content:space-between"><span>${esc(r.k)}</span><span class="hint">${r.n}</span></div><div style="height:5px;background:var(--gold);width:${Math.round(r.n/max*100)}%;border-radius:3px;margin:2px 0 8px"></div>`).join(''):'<div class="hint">No call-offs in this window. 🎉</div>'; };
  $('wfByPerson').innerHTML = bars(s.byPerson);
  $('wfByDow').innerHTML = bars(s.byDow);
  // duty/round selects
  await ensureReferralMeta().catch(()=>{});
  fillSelect($('du_part'), META.shifts||['Morning','Day','Evening','Night']);
  fillSelect($('du_role'), ['All',...(META.jobRoles||['BHT / Tech','Nurse','Therapist','Kitchen'])]);
  loadRoundsToday();
}
async function clockToggle(inn){ await api('/clock/'+(inn?'in':'out'),{method:'POST'}); loadCoverage(); }
async function logRound(){ const area=$('rd_area').value.trim(); await api('/rounds',{method:'POST',body:JSON.stringify({area,note:$('rd_note').value})}); $('rd_area').value='';$('rd_note').value=''; $('rd_msg').textContent='✓ Logged'; setTimeout(()=>$('rd_msg').textContent='',2000); loadRoundsToday(); loadCoverage(); }
async function loadRoundsToday(){ try{ const {rounds}=await api('/rounds/today'); $('rdList').innerHTML = rounds.length?rounds.map(r=>`<div class="pc-note">✓ ${esc((r.ts||'').slice(11,16))} · ${esc(r.area||'round')} <span class="hint">${esc(r.by_name||'')}${r.note?' · '+esc(r.note):''}</span></div>`).join(''):'<div class="hint">No rounds logged today yet.</div>'; }catch(e){} }
async function logDuty(){ const text=$('du_text').value.trim(); if(!text){return;} await api('/duties',{method:'POST',body:JSON.stringify({part:$('du_part').value,role:$('du_role').value,text})}); $('du_text').value=''; $('du_msg').textContent='✓ Logged'; setTimeout(()=>$('du_msg').textContent='',2000); loadCoverage(); }

let SCHED_STAFF=null;
async function loadSchedule(){
  if(!$('sc_date').value) $('sc_date').value=today();
  await ensureReferralMeta().catch(()=>{});
  fillSelect($('sc_part'), META.shifts||['Morning','Day','Evening','Night']);
  fillSelect($('sc_role'), META.jobRoles||['BHT / Tech','Nurse','Therapist','Kitchen']);
  if(!SCHED_STAFF){ try{ const {users}=await api('/users'); SCHED_STAFF=users.filter(u=>u.active!==0); }catch(e){ SCHED_STAFF=[]; } }
  const { slots } = await api('/staffing?date='+$('sc_date').value);
  $('scBoard').innerHTML = slots.length ? slots.map(s=>{
    const opt = SCHED_STAFF.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
    const people = s.assignments.map(a=>`<span class="chip" style="${a.status==='called_off'?'text-decoration:line-through;opacity:.6':''}">${esc(a.user_name||'?')}${a.status==='called_off'?' (off)':''}
      ${a.status!=='called_off'?`<a onclick="callOff(${a.id})" title="Mark call-off" style="cursor:pointer;color:var(--danger);margin-left:4px">⊘</a>`:''}
      <a onclick="unassign(${a.id})" title="Remove" style="cursor:pointer;color:var(--muted);margin-left:4px">✕</a></span>`).join(' ');
    return `<div class="card" style="border-left:4px solid ${s.covered?'var(--good)':'var(--gold)'}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <strong>${esc(s.part)}</strong> · ${esc(s.role)}
        <span class="risk ${s.covered?'risk-low':'risk-elev'}">${s.scheduledCount}/${s.needed} ${s.covered?'covered':'short '+(s.needed-s.scheduledCount)}</span>
        ${s.calledOffCount?`<span class="risk risk-warn">${s.calledOffCount} off</span>`:''}
        ${ME&&ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" style="margin-left:auto" onclick="delSlot(${s.id})">Delete</button>`:''}
      </div>
      <div style="margin:8px 0">${people||'<span class="hint">No one assigned.</span>'}</div>
      ${ME&&ME.role==='admin'?`<div class="handoff-add"><select id="asgn_${s.id}">${opt}</select><button class="btn btn-ghost btn-sm sans" onclick="assignSlot(${s.id})">Assign</button></div>`:''}
    </div>`;
  }).join('') : '<div class="card"><div class="empty">No shifts scheduled for this day. Add shift needs above.</div></div>';
}
function schShift(n){ const d=new Date($('sc_date').value||today()); d.setDate(d.getDate()+n); $('sc_date').value=d.toISOString().slice(0,10); loadSchedule(); }
async function addSlot(){ try{ await api('/staffing/slots',{method:'POST',body:JSON.stringify({date:$('sc_date').value||today(),part:$('sc_part').value,role:$('sc_role').value,needed:$('sc_needed').value})}); $('sc_msg').textContent='✓ Added'; setTimeout(()=>$('sc_msg').textContent='',2000); loadSchedule(); }catch(e){ $('sc_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function delSlot(id){ if(!confirm('Delete this shift need?'))return; await api('/staffing/slots/'+id,{method:'DELETE'}); loadSchedule(); }
async function assignSlot(id){ const u=$('asgn_'+id).value; if(!u)return; await api('/staffing/slots/'+id+'/assign',{method:'POST',body:JSON.stringify({user_id:u})}); loadSchedule(); }
async function unassign(id){ await api('/staffing/assignments/'+id,{method:'DELETE'}); loadSchedule(); }
async function callOff(id){ const reason=prompt('Call-off reason (optional):'); if(reason===null)return; await api('/staffing/assignments/'+id+'/calloff',{method:'POST',body:JSON.stringify({reason})}); loadSchedule(); }

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
  const trendVals = (j.amaHistory||[]).map(r=>({High:3,Elevated:2,Low:1}[r.level]||0));
  const amaHtml = (j.ama ? `<span class="risk ${j.ama.level==='High'?'risk-high':j.ama.level==='Elevated'?'risk-elev':'risk-low'}">AMA risk: ${esc(j.ama.level)}</span>` : '<span class="risk risk-none">No AMA read</span>')
    + (trendVals.length>1?` <span title="AMA risk trend">${sparkline(trendVals,70,20)}</span>`:'');
  const goalsHtml = j.goals.length ? j.goals.map(g=>`<div class="todo"><div class="box" style="cursor:pointer" onclick="toggleGoal(${g.id},'${g.status==='Met'?'Active':'Met'}')">${g.status==='Met'?'✓':''}</div><div class="txt ${g.status==='Met'?'done':''}">${esc(g.text)}${g.target_date?' <span class="hint">· by '+esc(g.target_date)+'</span>':''}</div></div>`).join('') : '<div class="pc-note">No goals yet.</div>';
  const reqHtml = j.requests.length ? j.requests.map(r=>`<div class="pc-note">• ${esc(r.department)}: ${esc(r.text)} <span class="hint">(${esc(r.status)})</span></div>`).join('') : '<div class="pc-note">None open.</div>';
  const concernHtml = j.concerns.length ? j.concerns.map(x=>`<div class="pc-note">⚑ ${esc(x.text)}</div>`).join('') : '<div class="pc-note">None open.</div>';
  const delHtml = j.delights.length ? j.delights.map(x=>`<div class="pc-note">♥ ${esc(x.text)}</div>`).join('') : '<div class="pc-note">None yet.</div>';
  const pulseHtml = j.pulses.length ? j.pulses.map(p=>`<div class="pc-note">${esc(p.date)} ${esc(p.shift)} — concern ${esc(p.concern)}${(p.triggers||[]).length?' · '+p.triggers.map(esc).join(', '):''}${p.statements?' · "'+esc(p.statements)+'"':''}</div>`).join('') : '<div class="pc-note">No pulses yet.</div>';
  const schedHtml = j.schedule.length ? j.schedule.map(s=>`<div class="pc-note">${s.time?esc(s.time)+' · ':''}${esc(s.type)}: ${esc(s.title)}</div>`).join('') : '<div class="pc-note">No client-specific items today.</div>';
  const followHtml = j.followups.length ? j.followups.map(f=>`<div class="pc-note">${esc(f.type)} aftercare call · due ${esc(f.due_date)}</div>`).join('') : '';
  const familySummary = `${(j.family||[]).length?j.family.map(f=>'<div class="pc-note">'+esc(f.name)+(f.relationship?' ('+esc(f.relationship)+')':'')+(f.phone?' · '+esc(f.phone):'')+'</div>').join(''):'<div class="pc-note">No contacts.</div>'}`+
    `${(j.visits||[]).length?'<div class="pc-note">Next visit: '+esc(j.visits[0].date)+(j.visits[0].contact_name?' · '+esc(j.visits[0].contact_name):'')+'</div>':''}`+
    `<button class="btn btn-ghost btn-sm sans no-print" style="margin-top:6px" onclick="openFamily(${c.id})">Open family</button>`;
  const phase = c.discharge_status ? 'Discharged ('+esc(c.discharge_status)+')' : (c.admit ? 'In treatment' : 'Active');

  $('journeyBody').innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        ${c.photo?`<img src="${esc(c.photo)}" class="client-photo" alt="${esc(c.pref||c.name||'')}"/>`:`<span class="avatar" style="width:48px;height:48px;font-size:18px">${initials(c.name||c.pref)}</span>`}
        <div><h2 style="margin:0;color:var(--navy)">${esc(c.pref||c.name)} ${c.pref&&c.name?'<span class="hint">('+esc(c.name)+')</span>':''}</h2>
          <div class="hint">${c.room?'Room '+esc(c.room)+' · ':''}${esc(c.program||'')} · ${phase}</div></div>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">${amaHtml}
          <button class="btn btn-ghost btn-sm sans" onclick="editClient(${c.id})">Edit Care Card</button>
          <button class="btn btn-gold btn-sm sans" id="cbBtn" onclick="careBrief(${c.id})" style="${META.claude?'':'display:none'}">✦ AI Care Brief</button>
        </div>
      </div>
      ${c.summary?`<div class="snapshot-card" style="margin-top:14px">
        <div class="snapshot-head">◆ At a glance${c.summary_at?` <span class="snapshot-when">· updated ${esc((c.summary_at||'').slice(0,16))}</span>`:''}</div>
        <div class="snapshot-body">${esc(c.summary)}</div>
      </div>`:''}
      ${c.touch?`<div class="pc-touch" style="margin-top:12px">★ ${esc(c.touch)}</div>`:''}
      ${c.anchor_why?`<div class="anchor-card" style="margin-top:12px">
        <div class="anchor-head">⚓ Intake Anchor — why they came (their own words)</div>
        <div class="anchor-words">“${esc(c.anchor_why)}”</div>
        <div class="anchor-foot sans no-print">If a quiet "I feel fine, I'll finish at home" ever comes — read these words back, then make the 48-hour ask.
          <button class="btn btn-ghost btn-sm sans" style="margin-left:8px" onclick="printAnchor(${c.id})">🖨 Print anchor card</button></div>
      </div>`:''}
      <div id="careBriefOut"></div>
    </div>
    <div class="jgrid">
      ${sec('⚠ Safety', c.safety?`<div class="pc-note alert-line">${esc(c.safety)}</div>`:'<div class="pc-note">None noted.</div>')}
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
    </div>
    ${c.kipu_id?`<div class="card no-print">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div><h3 style="margin:0">📋 Full chart from Kipu</h3><p class="sub sans" style="margin:2px 0 0" id="jChartSub">The complete record — every note, plus meds, vitals, withdrawal scales &amp; labs.</p></div>
        <button class="btn btn-gold btn-sm sans" style="margin-left:auto" id="jChartBtn" onclick="loadJourneyChart(${c.id})">Open full chart</button>
      </div>
      <input id="jChartFilter" placeholder="Filter notes (nursing, group, progress, CIWA…)" oninput="filterChartIn('jChartList')" style="margin-top:12px;display:none"/>
      <div id="jChartList" style="margin-top:10px"></div>
    </div>`:''}
    <div class="card no-print">
      <h3>Documentation notes — red-flag scan</h3>
      <p class="sub sans">Drop in a note (or it arrives from the EMR). Claude flags anything that means they're unhappy or at risk, and raises it on Today.</p>
      <div class="voicewrap"><textarea id="noteText" placeholder="e.g. Client was withdrawn at group and said the food is terrible and nobody listens…"></textarea><button type="button" class="mic" onclick="dictateInto(this)" title="Dictate">🎤</button></div>
      <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-gold sans" onclick="addNote(${c.id})">Scan &amp; save</button></div>
      <div id="noteResult"></div>
      <div id="notesList"></div>
    </div>`;
  loadClientNotes(c.id);
}
async function loadClientNotes(id){
  try { const { notes } = await api('/clients/'+id+'/notes');
    $('notesList').innerHTML = notes.length ? notes.map(n=>{
      const lvl = n.flag_level==='High'?'risk-high':n.flag_level==='Elevated'?'risk-elev':'risk-low';
      // Lead with the clean AI read; tuck the raw chart text behind a toggle.
      return `<div class="note-card">
        <div class="note-top">
          ${n.flagged?`<span class="risk ${lvl}">⚑ ${esc(n.flag_level||'Flag')}</span>`:'<span class="risk risk-low">note</span>'}
          <span class="hint">${esc(n.source||'')} · ${esc((n.created_at||'').slice(0,16))}</span>
        </div>
        ${n.flag_summary?`<div class="note-sum">${esc(n.flag_summary)}</div>`:''}
        ${n.suggested_action?`<div class="note-act">→ ${esc(n.suggested_action)}</div>`:''}
        ${n.text?`<details class="note-raw"><summary>View source note</summary><div class="note-rawbody">${esc(n.text.slice(0,4000))}</div></details>`:''}
      </div>`;
    }).join('') : '<div class="pc-note" style="margin-top:8px">No notes yet.</div>';
  } catch(e){}
}
async function addNote(clientId){
  const t=$('noteText').value.trim(); if(!t) return;
  $('noteResult').innerHTML='<span class="hint">Scanning…</span>';
  try{ const r=await api('/notes',{method:'POST',body:JSON.stringify({client_id:clientId,text:t})});
    $('noteResult').innerHTML = r.flagged ? `<div class="ama-banner ${r.level==='High'?'ama-high':'ama-elev'}" style="margin:8px 0"><div class="ama-head">⚑ Red flag (${esc(r.level)})</div><div class="ama-sum">${esc(r.summary||'')}</div><div class="pc-note">→ ${esc(r.suggested_action||'')}</div></div>` : '<div class="hint" style="margin:6px 0">✓ Saved — no red flags found.</div>';
    $('noteText').value=''; loadClientNotes(clientId);
  }catch(e){ $('noteResult').innerHTML='<span class="hint" style="color:var(--danger)">'+e.message+'</span>'; }
}
async function printAnchor(id){
  const { journey:j } = await api('/clients/'+id+'/journey'); const c=j.client;
  const w=window.open('','_blank','width=600,height=700'); if(!w) return;
  w.document.write(`<html><head><title>Intake Anchor</title><style>
    body{font-family:Georgia,serif;margin:0;padding:48px;color:#0b1f3a;text-align:center}
    .mark{font-size:54px;margin-bottom:8px}
    .label{font-family:Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;font-size:12px;color:#9a7b4f;margin-bottom:24px}
    .words{font-size:26px;line-height:1.5;font-style:italic;margin:0 auto;max-width:440px}
    .name{margin-top:28px;font-size:15px;color:#555}
    .foot{margin-top:40px;font-family:Arial,sans-serif;font-size:12px;color:#888}
  </style></head><body>
    <div class="mark">⚓</div>
    <div class="label">My reason for being here</div>
    <div class="words">“${esc(c.anchor_why||'')}”</div>
    <div class="name">${esc(c.pref||c.name||'')}</div>
    <div class="foot">Armada Recovery — keep this where you'll see it on the hard mornings.</div>
  </body></html>`);
  w.document.close(); setTimeout(()=>w.print(),250);
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

/* ---- today command center ---- */
async function loadTodayCareCards(){
  const card=$('todayCareCards'); if(!card) return;
  let d; try{ d=await api('/carecards'); }catch(e){ return; }
  const inc=d.incomplete||[];
  if(!inc.length){ card.style.display='none'; return; }
  card.style.display='block';
  $('todayCcCount').textContent = inc.length+(d.overdue?' · '+d.overdue+' overdue':'');
  $('todayCcList').innerHTML = inc.map(c=>{
    const m=c.minsSinceAdmit;
    const clock = m==null?'':(m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m')+' since admit';
    return `<div class="cmd-row ${c.overdue?'cmd-row-flag':''}">
      <div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}
        <div class="hint">${c.overdue?'<span style="color:var(--danger);font-weight:600">OVERDUE</span> · ':''}${clock} · missing: ${c.missing.map(esc).join(', ')}</div></div>
      <button class="btn btn-gold btn-sm sans" onclick="openJourney(${c.id})">Fill</button></div>`;
  }).join('');
}
async function loadToday(){
  const t = await api('/today');
  $('todayDate').textContent = new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  loadTodayCareCards();
  if(META.kioskCode) $('kioskCodeHint').innerHTML = 'kiosk code: <strong>'+esc(META.kioskCode)+'</strong>';
  if(t.claude) $('todayBriefBtn').style.display='inline-block';
  const m=t.metrics;
  $('todayKpis').innerHTML = `
    <div class="ret-card ${m.highRisk?'rc-high':''}"><div class="n">${m.highRisk}</div><div class="l">At risk</div></div>
    <div class="ret-card"><div class="n">${m.active}</div><div class="l">Active clients</div></div>
    <div class="ret-card ${m.callsDue?'rc-warn':''}"><div class="n">${m.callsDue}</div><div class="l">Aftercare calls due</div></div>
    <div class="ret-card ${m.openRequests?'rc-warn':''}"><div class="n">${m.openRequests}</div><div class="l">Open requests</div></div>
    <div class="ret-card ${m.openConcerns?'rc-warn':''}"><div class="n">${m.openConcerns}</div><div class="l">Open concerns</div></div>
    <div class="ret-card ${m.openIncidents?'rc-high':''}"><div class="n">${m.openIncidents}</div><div class="l">Open incidents</div></div>
    <div class="ret-card"><div class="n">${m.surveysDue}</div><div class="l">Surveys due</div></div>
    <div class="ret-card ${m.refreshersDue?'rc-warn':''}"><div class="n">${m.refreshersDue}</div><div class="l">Refreshers due</div></div>
    <div class="ret-card"><div class="n">${m.visitsToday}</div><div class="l">Visits today</div></div>
    <div class="ret-card"><div class="n">${m.bedsOpen}</div><div class="l">Open beds</div></div>
    <div class="ret-card"><div class="n">${m.pipeline}</div><div class="l">In pipeline</div></div>`;
  const icon={risk:'⚠',welcome:'☀',call:'🤝',request:'🛎'};
  $('todayAttention').innerHTML = t.attention.length ? t.attention.map(a=>`<div class="todo">
      <div class="txt">${icon[a.kind]||'•'} ${esc(a.text)}</div>
      ${a.client_id?`<button class="btn btn-ghost btn-sm sans" onclick="openJourney(${a.client_id})">Open</button>`:''}</div>`).join('') : '<div class="pc-note">All clear. Touch every client, deliver every personal touch.</div>';
  $('todaySchedule').innerHTML = t.schedule.length ? t.schedule.map(s=>`<div class="pc-note">${s.time?'<strong>'+esc(s.time)+'</strong> · ':''}<span class="chip">${esc(s.type)}</span> ${esc(s.title)}${s.pref?' · '+esc(s.pref):''}</div>`).join('') : '<div class="pc-note">Nothing scheduled. Build the day in Program.</div>';
  const wins=[...t.wins.wows.map(w=>'👏 '+w.text+(w.pref?' ('+w.pref+')':'')),...t.wins.delights.map(d=>'♥ '+d.text+(d.pref?' ('+d.pref+')':''))];
  $('todayWins').innerHTML = wins.length ? wins.map(w=>`<div class="pc-note">${esc(w)}</div>`).join('') : '<div class="pc-note">Log a Wow Story or a delight to celebrate the team.</div>';
  if(t.focus){
    $('focusCard').innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div><div class="h sans" style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--gold)">Today's Focus — the team stresses this</div>
          <h3 style="margin:2px 0 0">${esc(t.focus.t)}</h3><p class="sub sans" style="margin:4px 0 0">${esc(t.focus.g)}</p></div>
        <button class="btn btn-gold btn-sm sans" style="margin-left:auto" onclick="joinFocus()">I'm on it ✋</button>
        ${ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" onclick="setFocus()">Set focus</button>`:''}</div>
      <div id="focusMsg" class="hint"></div>`;
  }
  const ad = [];
  (t.admitsToday||[]).forEach(c=>ad.push(`<div class="pc-note">☀ <strong>Admit:</strong> ${esc(c.pref||c.name)}${c.room?' · Room '+esc(c.room):''}${c.program?' · '+esc(c.program):''} <button class="btn btn-ghost btn-sm sans no-print" onclick="openJourney(${c.id})">Open</button></div>`));
  (t.dischargesToday||[]).forEach(c=>ad.push(`<div class="pc-note">🤝 <strong>Discharge (${esc(c.discharge_status)}):</strong> ${esc(c.pref||c.name)}${c.discharge_reason?' — '+esc(c.discharge_reason):''}</div>`));
  if($('todayAdmitsDischarges')) $('todayAdmitsDischarges').innerHTML = ad.length ? ad.join('') : '<div class="pc-note">No admits or discharges logged today.</div>';
  $('todayDate').innerHTML = new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}) + (t.myTaskCount?` · <a href="#" onclick="show('mytasks');return false" style="color:var(--gold)">You have ${t.myTaskCount} task${t.myTaskCount===1?'':'s'} →</a>`:'');
  loadAlerts();
}
async function joinFocus(){
  const note = prompt("Optional: a quick win or result you'll aim for today:")||'';
  await api('/focus',{method:'POST',body:JSON.stringify({note})});
  const f = await api('/focus');
  $('focusMsg').textContent = `✓ ${f.participants} teammate${f.participants===1?'':'s'} focused on this today.`;
}
async function setFocus(){
  const f = await api('/focus');
  const list = f.options.map((o,i)=>`${i+1}. ${o.t}`).join('\n');
  const pick = prompt(`Set today's focus — enter a number, or type your own topic:\n\n${list}`); if(pick===null) return;
  let t=pick.trim(), g='';
  const idx=parseInt(pick,10);
  if(!isNaN(idx) && f.options[idx-1]){ t=f.options[idx-1].t; g=f.options[idx-1].g; }
  else { g = prompt("Goal / what to try (optional):")||''; }
  await api('/focus/set',{method:'POST',body:JSON.stringify({t,g})});
  loadToday();
}
async function loadAlerts(){
  const { alerts, newCount } = await api('/alerts');
  $('alertsCard').style.display = newCount ? 'block' : 'none';
  $('alertCount').textContent = newCount || '';
  $('alertsList').innerHTML = alerts.map(a=>`<div class="todo">
      <div class="txt">⚡ ${esc(a.message)} <span class="hint">· ${esc(a.created_at)}</span></div>
      ${a.client_id?`<button class="btn btn-ghost btn-sm sans" onclick="openJourney(${a.client_id})">Open</button>`:''}
      <button class="btn btn-ghost btn-sm sans" onclick="ackAlert(${a.id})">Got it</button></div>`).join('');
}
async function ackAlert(id){ await api('/alerts/'+id+'/ack',{method:'POST'}); loadAlerts(); }

/* ---- alumni ---- */
async function loadAlumni(){
  const { alumni } = await api('/alumni');
  $('alumniList').innerHTML = alumni.length ? alumni.map(a=>`<div class="todo">
      <div class="txt"><strong>${esc(a.pref||a.name)}</strong> <span class="chip">${esc(a.discharge_status)}</span>
        ${a.discharge_date?' · discharged '+esc(a.discharge_date):''}${a.daysSober!=null?' · '+a.daysSober+' days sober':''}
        ${a.openCalls?' · <span class="risk risk-warn">'+a.openCalls+' aftercare call(s) due</span>':''}
        ${a.lastTouch?' · last touch '+esc(a.lastTouch.slice(0,10)):' · <span class="hint">no touchpoint yet</span>'}</div>
      <button class="btn btn-ghost btn-sm sans" onclick="alumniNote(${a.id})">Log touchpoint</button></div>`).join('') : '<div class="empty">No alumni yet. Completed discharges appear here.</div>';
}
async function alumniNote(id){ const t=prompt('Log an alumni touchpoint (call, message, event):'); if(!t||!t.trim())return; await api('/alumni/'+id+'/notes',{method:'POST',body:JSON.stringify({text:t})}); loadAlumni(); }

/* ---- accountability ---- */
async function loadAccountability(){
  if(!$('ac_month').value) $('ac_month').value = today().slice(0,7);
  const d = await api('/accountability?month='+$('ac_month').value);
  $('championCard').innerHTML = d.champion ? `<div class="card" style="border-left:4px solid var(--gold);background:#faf6ee">
    <h3 style="margin:0">🏅 Care Champion — ${esc(d.month)}</h3>
    <p class="sans" style="margin:6px 0 0"><strong>${esc(d.champion.name)}</strong> (${esc(d.champion.job_role)}) — ${d.champion.missed} missed · ${d.champion.actions} care actions logged.</p>
    <button class="btn btn-gold btn-sm sans" style="margin-top:8px" onclick="recognizeChampion('${esc(d.champion.name)}')">Recognize publicly</button></div>` : '';
  $('acTable').innerHTML = `<table class="tbl"><tr><th>Teammate</th><th>Role</th><th>Used (care actions)</th><th>Assigned</th><th>Covered</th><th>Missed</th><th>Training</th></tr>${
    d.staff.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.job_role)}</td><td><strong>${s.actions}</strong> <span class="hint">${Object.entries(s.breakdown).map(([k,v])=>k+':'+v).join(' · ')}</span></td><td>${s.assigned}</td><td>${s.covered}</td><td>${s.missed?'<span class="risk risk-high">'+s.missed+'</span>':'0'}</td><td>${s.trainingDue?'<span class="risk risk-high">'+s.trainingCurrent+'/'+s.trainingTotal+'</span>':'<span class="risk risk-low">'+s.trainingCurrent+'/'+s.trainingTotal+'</span>'}</td></tr>`).join('')}</table>`;
  $('acGaps').innerHTML = `<p class="sub sans">${d.gaps.count} client-day check-in${d.gaps.count===1?'':'s'} missed this month.</p>` +
    (d.gaps.recent.length ? d.gaps.recent.map(g=>`<div class="pc-note">• ${esc(g.client)} — no check-in on ${esc(g.date)}</div>`).join('') : '<div class="pc-note">No gaps. Every client checked in, every day. 🎉</div>');
}
async function recognizeChampion(name){ await api('/kudos',{method:'POST',body:JSON.stringify({text:`🏅 Care Champion of the month — ${name}. Thank you for showing up for every client.`})}); alert('Recognized — posted to the Team kudos feed.'); }

async function askFromToday(){
  const q=$('today_ask').value.trim(); if(!q) return;
  $('todayAskOut').innerHTML='<span class="hint">Thinking…</span>';
  try{ const { answer }=await api('/assistant',{method:'POST',body:JSON.stringify({question:q})}); $('todayAskOut').innerHTML=esc(answer).replace(/\n/g,'<br>'); }
  catch(e){ $('todayAskOut').innerHTML='<span class="hint" style="color:var(--danger)">'+e.message+'</span>'; }
}
async function todayBriefing(){
  const btn=$('todayBriefBtn'); btn.disabled=true; const l=btn.textContent; btn.textContent='✦ Briefing…';
  $('todayBrief').innerHTML='<div class="hint">Claude is reading the whole house…</div>';
  try{ const { brief }=await api('/shift-briefing',{method:'POST',body:JSON.stringify({shift:'today'})});
    $('todayBrief').innerHTML=`<div class="ama-banner ama-low" style="margin-top:12px"><div class="ama-head" style="color:var(--gold)">✦ AI House Briefing</div><div class="brief-body">${esc(brief).replace(/\n/g,'<br>')}</div></div>`;
  }catch(e){ $('todayBrief').innerHTML='<div class="hint" style="color:var(--danger)">'+e.message+'</div>'; }
  finally{ btn.disabled=false; btn.textContent=l; }
}

/* ---- ask AI ---- */
async function loadAskAI(){
  await fillClientSelect($('ai_client'), 'The whole house');
  $('aiHint').textContent = (META.claude ? '' : 'Claude is not configured — set ANTHROPIC_API_KEY to enable. ') + (META.deidentify ? '🔒 Privacy: AI runs on de-identified data — client names are not sent to Claude.' : '');
  $('aiAskBtn').disabled = !META.claude;
}
async function askAI(){
  const q=$('ai_q').value.trim(); if(!q) return;
  const btn=$('aiAskBtn'); btn.disabled=true; const l=btn.textContent; btn.textContent='Thinking…';
  $('aiAnswer').innerHTML='';
  try{ const { answer }=await api('/assistant',{method:'POST',body:JSON.stringify({question:q,client_id:$('ai_client').value||null})});
    $('aiAnswer').innerHTML=`<div class="ama-banner ama-low" style="margin-top:12px"><div class="brief-body">${esc(answer).replace(/\n/g,'<br>')}</div></div>`;
  }catch(e){ $('aiHint').textContent=e.message; }
  finally{ btn.disabled=false; btn.textContent=l; }
}

/* ---- incidents ---- */
async function loadIncidents(){
  await fillClientSelect($('in_client'), 'No client / facility');
  const { incidents } = await api('/incidents');
  const sev={Low:'risk-low',Moderate:'risk-elev',High:'risk-high',Critical:'risk-high'};
  $('inList').innerHTML = incidents.length ? incidents.map(i=>`<div class="todo ${i.status==='Closed'?'done':''}">
      <div class="txt"><span class="risk ${sev[i.severity]||''}">${esc(i.severity)}</span> <strong>${esc(i.type)}</strong>${i.pref?' · '+esc(i.pref):''} — ${esc(i.description)}
        ${i.action_taken?'<div class="hint">Action: '+esc(i.action_taken)+'</div>':''}<div class="hint">${esc(i.created_at)} · ${esc(i.reported_by_name||'')} · ${esc(i.status)}</div></div>
      ${i.status!=='Closed'?`<button class="btn btn-ghost btn-sm sans" onclick="setIncident(${i.id},'Reviewed')">Reviewed</button><button class="btn btn-ghost btn-sm sans" onclick="setIncident(${i.id},'Closed')">Close</button>`:''}</div>`).join('') : '<div class="empty">No incidents reported.</div>';
}
async function addIncident(){
  if(!$('in_desc').value.trim()) return;
  await api('/incidents',{method:'POST',body:JSON.stringify({client_id:$('in_client').value||null,type:$('in_type').value,severity:$('in_sev').value,description:$('in_desc').value,action_taken:$('in_action').value})});
  $('in_desc').value=''; $('in_action').value=''; loadIncidents();
}
async function setIncident(id,status){ await api('/incidents/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadIncidents(); }

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
  try { const { history } = await api('/focus/history');
    if($('focusHistory')) $('focusHistory').innerHTML = history.length ? history.map(h=>`<div class="pc-note"><strong>${esc(h.date)}</strong> — ${esc(h.topic)} <span class="hint">· ${h.n} joined</span></div>`).join('') : '<div class="hint">No focus participation logged yet.</div>';
  } catch(e){}
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
  show('surveys');                       // route through the group router (fixes sidebar highlight/visibility)
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

/* ---- start ---- */
(async()=>{ try{ const { user } = await api('/me'); if(user){ ME=user; boot(); } else showLogin(); }catch(e){ showLogin(); } })();
