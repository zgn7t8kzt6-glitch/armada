/* Armada Care Standards — front-end (talks to the API) */
let ME = null, META = { shifts: ['Morning','Day','Evening','Night'], jobRoles: ['BHT / Tech','Nurse','Therapist','Catering / Dietary'] };
let currentId = null;
let PB = {};   // last playbook clients, keyed by id (for print/share)

const $ = id => document.getElementById(id);
const esc = s => (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const initials = n => (n||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
const today = () => new Date().toISOString().slice(0,10);

// Which API paths honor ?facility= (server-side facCtx). Kept as an explicit
// allowlist so an unscoped endpoint never silently ignores the chip.
const FAC_SCOPED_API=/^\/(clients($|[?/]\d)|dashboard|arrivals?($|\?|\/)|incidents($|\?)|billingready($|\?|\/(run|export))|appts($|\?)|inventory($|\?|\/reorders)|maintenance($|\?|\/history)|requests($|\?|\/(count|stats))|command\/(overview|since|discharge-debug|census\/email)|retention|opscenter|diag\/admit(s|-discharge)|outpatient($|\?|\/(analytics|php-outcomes|group-attendance|refresh|field-inspect))|housing\/|case-management|workforce\/summary|rounds($|\?|\/(today|board))|duties($|\?)|onshift\/manual|staffing\/?|roster($|\?|\/)|schedule($|\?|\/(week|\d))|clock\/status|care-team\/onshift|shift-crew|shift-briefing|assistant|records\/search|search($|\?)|property($|\?|\/\d)|sendouts($|\?)|alerts($|\?|\/scorecard)|carecards|dignity($|\?)|engagement($|\?|\/staff)|continuum|discharges\/incomplete|discharge-learnings|followups|alumni($|\?)|admissions($|\?|\/\d)|auth-register($|\?)|finance\/revenue|analytics($|\?)|compliance($|\?)|bedboard($|\?|\/(sync|total))|beds($|\?|\/\d)|referrals($|\?|\/(\d|summary|insights))|inbound-referrals($|\?)|client-voice($|\?|\/unseen)|voice($|\?)|surveys\/(due|overview|\d+\/(results|clear))|detox-watch|behavior-contracts($|\?|\/active)|concerns($|\?)|delights($|\?)|saves($|\?)|goals($|\?)|moments($|\?)|notes\/flagged|today($|\?))/;
async function api(path, opts={}) {
  // Rebuild Phase 2: the topbar facility chip scopes every facility-aware
  // endpoint automatically — one lever instead of 90 loaders remembering to.
  try{
    if(typeof FAC_SCOPE==='string' && FAC_SCOPE && !/[?&]facility=/.test(path) && FAC_SCOPED_API.test(path)){
      path += (path.includes('?')?'&':'?') + 'facility=' + encodeURIComponent(FAC_SCOPE);
    }
  }catch(_e){ /* scope not initialized yet — unscoped call is fine */ }
  const r = await fetch('/api'+path, { headers:{'Content-Type':'application/json'}, ...opts });
  // A 401 on a normal call means the session lapsed — bounce to login. But on the
  // login calls themselves, let the real message ("Invalid username or password")
  // through instead of the generic 'auth'.
  if (r.status === 401 && !path.startsWith('/login')) { showLogin(); throw new Error('auth'); }
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
      const trust = $('l_trust') ? $('l_trust').checked : true;
      const { user } = await api('/login/mfa', { method:'POST', body: JSON.stringify({ ticket: mfaTicket, code: $('l_code').value, trust }) });
      mfaTicket = null; ME = user; boot(); return;
    }
    const r = await api('/login', { method:'POST', body: JSON.stringify({ username:$('l_user').value, password:$('l_pass').value }) });
    if (r.mfaRequired) { mfaTicket = r.ticket; $('mfaRow').style.display='block'; if($('mfaEnrollBox'))$('mfaEnrollBox').style.display='none'; $('l_code').focus(); $('loginBtn').textContent='Verify code'; return; }
    if (r.mfaEnroll) {
      mfaTicket = r.ticket; $('mfaRow').style.display='block';
      if($('mfaEnrollBox')) $('mfaEnrollBox').style.display='block';
      if($('mfaQr')) $('mfaQr').src = '/api/login/qr.svg?ticket=' + encodeURIComponent(r.ticket);
      if($('mfaKey')) $('mfaKey').textContent = r.secret || '';
      $('l_code').focus(); $('loginBtn').textContent='Verify & turn on';
      return;
    }
    ME = r.user; boot();
  } catch(err){ $('loginErr').textContent = err.message; }
});
async function manageMfa(){
  if(!ME){ alert('Sign in first.'); return; }
  if(ME.mfaEnabled){ if(confirm('Two-factor is ON for your account. Turn it off?')){ await api('/mfa/disable',{method:'POST'}); ME.mfaEnabled=false; alert('Two-factor disabled.'); } return; }
  let secret=''; try{ const s=await api('/mfa/setup'); secret=s.secret; }catch(e){ alert(e.message); return; }
  closeMfaDialog();
  const ov=document.createElement('div'); ov.id='mfaOverlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
  ov.innerHTML=`<div style="background:#fff;border-radius:10px;max-width:380px;width:100%;padding:20px;max-height:92vh;overflow:auto">
    <h3 style="margin:0 0 6px">Set up two-factor</h3>
    <p class="sub sans" style="margin:0 0 12px">In <b>Microsoft Authenticator</b>: tap <b>+</b> → <b>Add account</b> → <b>Other account</b> → <b>Scan a QR code</b>, then point your phone at this:</p>
    <div style="text-align:center"><img src="/api/mfa/qr.svg?ts=${Date.now()}" alt="Two-factor QR code" style="width:220px;height:220px;border:1px solid #eee;border-radius:6px"/></div>
    <p class="hint" style="text-align:center;margin:8px 0">Can't scan? Enter this key by hand:<br><code style="font-size:13px;word-break:break-all">${esc(secret)}</code></p>
    <label class="sans" style="display:block;margin-top:8px;font-size:13px">Enter the 6-digit code it shows</label>
    <input id="mfaCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" style="width:100%;font-size:20px;letter-spacing:4px;text-align:center;padding:8px;box-sizing:border-box"/>
    <div id="mfaErr" class="hint" style="color:var(--danger);min-height:16px;margin-top:4px"></div>
    <div class="toolbar" style="justify-content:flex-end;gap:8px;margin-top:8px"><button class="btn btn-ghost sans" onclick="closeMfaDialog()">Cancel</button><button class="btn btn-primary sans" onclick="confirmMfa()">Turn on</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',(e)=>{ if(e.target===ov) closeMfaDialog(); });
  const inp=$('mfaCode'); if(inp){ inp.focus(); inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter') confirmMfa(); }); }
}
function closeMfaDialog(){ const o=$('mfaOverlay'); if(o) o.remove(); }
async function confirmMfa(){
  const code=$('mfaCode')?$('mfaCode').value.trim():'';
  if(!/^\d{6}$/.test(code)){ if($('mfaErr'))$('mfaErr').textContent='Enter the 6-digit code from the app.'; return; }
  try{ await api('/mfa/enable',{method:'POST',body:JSON.stringify({code})}); ME.mfaEnabled=true; closeMfaDialog(); alert('✓ Two-factor enabled. You\'ll enter a code from Microsoft Authenticator each time you sign in.'); }
  catch(e){ if($('mfaErr'))$('mfaErr').textContent=e.message; }
}
/* auto-logoff after inactivity (HIPAA) */
let idleTimer=null;
function resetIdle(){ clearTimeout(idleTimer); idleTimer=setTimeout(()=>{ if(ME){ alert('Signed out after 15 minutes of inactivity.'); doLogout(); } }, 15*60000); }
['click','keydown','mousemove','touchstart'].forEach(ev=>document.addEventListener(ev, resetIdle, {passive:true}));
async function doLogout(){ try{ localStorage.removeItem('facScope'); }catch(e){} await api('/logout',{method:'POST'}); location.reload(); }

/* ---- night mode + PWA + voice ---- */
function applyTheme(t){ document.documentElement.dataset.theme = t==='dark'?'dark':''; const b=$('themeBtn'); if(b) b.textContent = t==='dark'?'☀️':'🌙'; }
function toggleTheme(){ const cur=document.documentElement.dataset.theme==='dark'?'dark':'light'; const next=cur==='dark'?'light':'dark'; localStorage.setItem('theme',next); applyTheme(next); }
(function initTheme(){ const saved=localStorage.getItem('theme'); const hr=new Date().getHours(); applyTheme(saved || ((hr>=19||hr<6)?'dark':'light')); })();
if('serviceWorker' in navigator){
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
  // When an updated service worker takes control, reload once so the page never
  // keeps running against a stale/half-updated cache (auto-heals stuck devices).
  let swReloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{ if(swReloaded||!hadController) return; swReloaded=true; location.reload(); });
  // Also nudge for an update on every load.
  navigator.serviceWorker.ready.then(r=>{ try{ r.update(); }catch(e){} }).catch(()=>{});
}
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
  // Default the Playbook to the viewer's own role so they see their lineup, not
  // every role's. Admin/ED default to All (they run the whole-shift sheet); anyone
  // can still switch the dropdown.
  if($('r_role')){ const dflt=(ME.role==='admin'||ME.job_role==='Executive Director'||!META.jobRoles.includes(ME.job_role))?'All':ME.job_role; $('r_role').value=dflt; }
  fillSelect($('u_job'), META.jobRoles);
  $('r_date').value = today(); $('a_date').value = today();
  applyCompanyBranding();
  renderGroups();
  // Role-based landing: everyone opens already where they work. Leadership lands
  // on the Operations Center — the "what's happening right now" board.
  const landing = isHousingRole() ? 'housing' : isCorporateRole() ? 'corphub' : (ME.role==='admin' || ME.opsAccess) ? 'opscenter' : 'dashboard';
  facScopeInit();          // give FAC_SCOPE its value BEFORE the first view loads,
  renderShellContext();    // so the landing loader is already facility-scoped (not
  show(landing);           // an unscoped first paint under a chip that claims a facility)
  pollMsgUnread(); setInterval(pollMsgUnread, 30000);   // unread message badge
  if(isLeadershipUser()){ pollWpBadge(); setInterval(pollWpBadge, 60000); }   // Best Place to Work attention badge
  if(canSeeView('concierge')){ if($('reqBell'))$('reqBell').style.display=''; pollReqBadge(); setInterval(pollReqBadge, 45000); }   // concierge request bell
  if(canSeeView('clientvoice')){ pollCvBadge(); setInterval(pollCvBadge, 60000); }   // new kiosk feedback badge
}
function updateCvBadge(n){ const b=$('cvBadge'); if(!b) return; if(n>0){ b.textContent=n; b.style.display=''; } else { b.textContent=''; b.style.display='none'; } }
async function pollCvBadge(){ try{ const {unseen}=await api('/client-voice/unseen'); updateCvBadge(unseen); }catch(e){} }
// Hilltop and the detox/clinical side are two separate companies — never mix
// their branding or tools. Hilltop-only staff see Hilltop branding and never the
// detox client kiosk.
function applyCompanyBranding(){
  const hilltopOnly = isHousingRole();
  const brand = $('sideBrand');
  if(brand && hilltopOnly){
    brand.innerHTML = `<div style="text-align:center;line-height:1.05">
      <div style="font-size:30px">⛰</div>
      <div class="hilltop-word">Hilltop</div>
      <div class="hilltop-sub">Recovery Home</div></div>`;
  }
  const ck = $('clientKioskLink');                  // detox client kiosk — hide for Hilltop staff
  if(ck) ck.style.display = hilltopOnly ? 'none' : '';
  if(hilltopOnly && $('whoami')) document.title = 'Hilltop Recovery Home';
}
function updateReqBadge(n){ const b=$('reqBadge'); if(!b) return; if(n>0){ b.textContent=n; b.style.display=''; } else { b.textContent=''; b.style.display='none'; } }
async function pollReqBadge(){ try{ const {open}=await api('/requests/count'); updateReqBadge(open); }catch(e){} }
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

/* ---- grouped nav, by the Ritz guest journey: Arrival → Stay → Handoff,
   then Team (culture) and Facility (operations); My Shift on top, Command for leadership ---- */
const GROUPS=[
  // The flow of a day: land Home, work the journey left→right, manage below the divider.
  {g:'today',label:'Home',first:'dashboard'},
  {g:'arrival',label:'Arrival',first:'arrivals'},
  {g:'stay',label:'Care',first:'clients'},
  {g:'handoff',label:'Discharge',first:'dischargepage'},
  {g:'revenue',label:'Revenue',first:'authreg'},
  {g:'facility',label:'Facility',first:'inventory'},
  {g:'team',label:'Team',first:'mytasks'},
  {g:'housing',label:'Sober Living',first:'housing'},
  {g:'enterprise',label:'Enterprise',first:'ownership'},
  {g:'insight',label:'Insight',first:'outcomes',admin:true},
  {g:'command',label:'Admin',first:'settings',admin:true},
];
const GROUP_OF={
  // Home — where every day starts: my shift, the live board, the facility command
  dashboard:'today',today:'today',opscenter:'today',command:'today',mydesk:'today',
  // Arrival — the warm welcome (front door + intake)
  arrivals:'arrival',arrivalcheck:'arrival',admissions:'arrival',referrals:'arrival',partners:'arrival',
  // Care — anticipate every need (the daily care)
  clients:'stay',editor:'stay',journey:'stay',records:'stay',family:'stay',report:'stay',
  concierge:'stay',dignity:'stay',rounds:'stay',roundscan:'stay',bedboard:'stay',bedmap:'stay',laundry:'stay',engagement:'stay',program:'stay',meals:'stay',property:'stay',
  casemgmt:'stay',appts:'stay',retention:'stay',surveys:'stay',clientvoice:'stay',incidents:'stay',compliance:'stay',
  // Discharge — the fond farewell + continuum
  dischargepage:'handoff',continuum:'handoff',alumni:'handoff',
  // Revenue — Revenue OS: authorizations, money in
  authreg:'revenue',billingready:'revenue',finance:'revenue',expenses:'revenue',
  // Outpatient day programs (PHP/IOP/OP) live under Care — the facility chip
  // says WHICH program (Armada Clinical, Dayton, Spark); the sidebar stays functional.
  outpatient:'stay',
  // Hilltop — the recovery-residence suite (separate world)
  housing:'housing',staffhub:'housing',hstaffdev:'housing',houses:'housing',fleet:'housing',residents:'housing',resident:'housing',intake:'housing',screens:'housing',houselife:'housing',housingstaff:'housing',shiftreports:'housing',hincidents:'housing',voice:'housing',hmaint:'housing',activities:'housing',hfarewell:'housing',movement:'housing',coordination:'housing',employment:'housing',rentrun:'housing',ledger:'housing',orh:'housing',housingoutcomes:'housing',
  // Team — culture, recognition, learning, tasks
  myrole:'team',mystats:'team',mygrowth:'team',employees:'team',leadmirror:'team',mytasks:'team',messages:'team',team:'team',workplace:'team',lineup:'team',accountability:'team',training:'team',library:'team',standard:'team',hiring:'team',handbook:'team',
  // Facility — the building runs (ordering, maintenance, staffing)
  inventory:'facility',maintenance:'facility',operations:'facility',coverage:'facility',schedule:'facility',roster:'facility',weekgrid:'facility',assign:'facility',staffmodel:'facility',staffsignins:'facility',
  // Enterprise — the parent company: corporate, people, leadership programs
  ownership:'enterprise',corphub:'enterprise',hcos:'enterprise',plan:'enterprise',excellence:'enterprise',onboarding:'enterprise',playbook:'enterprise',leadership:'enterprise',
  // Insight — why it happened (Analytics answers "why"; Home answers "now")
  outcomes:'insight',analytics:'insight',scorecard:'insight','report-view':'insight',admitcheck:'insight',askai:'insight',
  // Admin — configuration & governance
  settings:'command',facreg:'command',users:'command',audit:'command',guide:'command',dupes:'command',
};
// Role → pages. Only views listed here are restricted; anything NOT listed stays
// visible to everyone (generous "when in doubt, show" default). Admin and the
// Executive Director always see every page. My Shift + the whole Team/culture
// section are intentionally never gated — the shared Standard is for everyone.
const CARE = ['BHT / Tech','Nurse','Therapist','Case Manager','Clinical Director'];
const VIEW_ROLES = {
  // Facility / operations — the Director of Operations' lane (+ the depts that act in it)
  operations:  ['Director of Operations'],
  coverage:    ['Director of Operations'],
  schedule:    ['Director of Operations'],
  roster:      ['Director of Operations','Clinical Director'],
  weekgrid:    ['Director of Operations'],
  assign:      ['Director of Operations'],
  staffmodel:  ['Director of Operations'],
  maintenance: ['Director of Operations','Housekeeping'],
  inventory:   ['Director of Operations','Catering / Dietary','Housekeeping','Nurse','Front Desk'],
  meals:       ['Director of Operations','Catering / Dietary','BHT / Tech'],
  // Clinical / care pages — the care team (+ Clinical Director)
  clients:     [...CARE,'Front Desk','Director of Revenue Cycle Management','Director of Billing Compliance'],
  journey:     [...CARE,'Front Desk','Director of Revenue Cycle Management','Director of Billing Compliance'],   // Front Desk can open a client's 360 from the Clients grid
  editor:      CARE,
  records:     ['Nurse','Case Manager','Therapist','Clinical Director','Director of Revenue Cycle Management','Director of Billing Compliance'],
  rounds:      ['BHT / Tech','Nurse','Therapist','Case Manager','Clinical Director'],
  roundscan:   ['BHT / Tech','Nurse','Therapist','Case Manager','Clinical Director'],
  bedboard:    ['BHT / Tech','Nurse','Housekeeping','Director of Operations','Clinical Director'],
  laundry:     ['BHT / Tech','Housekeeping','Nurse','Director of Operations','Clinical Director'],
  clientvoice: [...CARE,'Front Desk','Director of Operations'],
  bedmap:      ['BHT / Tech','Nurse','Housekeeping','Director of Operations','Clinical Director','Front Desk'],
  property:    ['BHT / Tech','Nurse','Case Manager','Front Desk','Clinical Director','Director of Operations'],
  workplace:   ['Executive Director','Director of Operations','Clinical Director'],
  employees:   ['Executive Director','Director of Operations','Clinical Director'],
  leadmirror:  ['Executive Director','Director of Operations','Clinical Director','Housing Director','HR'],
  hiring:      ['Executive Director','Director of Operations','Clinical Director'],
  plan:        ['Executive Director','Director of Operations','Clinical Director'],
  excellence:  ['Executive Director','Director of Operations','Clinical Director'],
  onboarding:  ['Executive Director','Director of Operations','Clinical Director'],
  playbook:    ['Executive Director','Director of Operations','Clinical Director'],
  dignity:     ['BHT / Tech','Nurse','Clinical Director'],
  engagement:  ['BHT / Tech','Therapist','Clinical Director'],
  program:     ['BHT / Tech','Therapist','Clinical Director'],
  casemgmt:    ['Case Manager','Therapist','Clinical Director'],
  continuum:   ['Case Manager','Clinical Director','Director of Revenue Cycle Management'],
  retention:   CARE,
  incidents:   ['BHT / Tech','Nurse','Therapist','Case Manager','Clinical Director'],
  compliance:  ['Nurse','Case Manager','Therapist','Clinical Director','Director of Billing Compliance'],
  family:      ['Case Manager','Therapist','Clinical Director','Front Desk'],
  // Handoff — discharge & continuum (case management + clinical)
  dischargepage: ['Case Manager','Nurse','Clinical Director'],
  alumni:      ['Case Manager','Clinical Director'],
  // Arrival — front door + admissions
  admissions:  ['Front Desk','Case Manager','Clinical Director'],
  referrals:   ['Front Desk','Case Manager','Clinical Director'],
  partners:    ['Front Desk','Case Manager','Clinical Director'],
  // Concierge requests — front desk + hands-on care
  concierge:   ['Front Desk','BHT / Tech','Nurse','Clinical Director'],
};
// Recovery Housing is a separate world from clinical detox. Only housing staff
// (and the owner/admin) ever see it; nobody on the detox/clinical side does.
const HOUSING_VIEWS = ['housing','staffhub','hstaffdev','houses','fleet','residents','resident','intake','screens','houselife','housingstaff','shiftreports','hincidents','voice','hmaint','activities','hfarewell','movement','coordination','employment','rentrun','ledger','orh','housingoutcomes'];
const HOUSING_ROLES = ['Housing Director','House Manager','Recovery Coach'];
// Hilltop hubs: consolidate related screens behind one sidebar item with in-page tabs.
// The first view in each hub is its "host" (what the sidebar item opens).
const HUBS = {
  residents: {label:'Residents', items:[['residents','Roster'],['intake','Intake & Forms'],['screens','Drug Screening'],['hfarewell','Farewell & Alumni'],['employment','Employment']]},
  houses:    {label:'Houses',    items:[['houses','Beds'],['houselife','House Life'],['hmaint','Maintenance & Supplies'],['fleet','Vehicles']]},
  team:      {label:'Team & Ops',items:[['housingstaff','Staffing'],['shiftreports','Shift Reports'],['hincidents','Incident Reports'],['hstaffdev','Staff Growth']]},
  insight:   {label:'Insight',   items:[['housingoutcomes','Outcomes'],['orh','ORH Compliance'],['movement','Daily Movement'],['coordination','Clinical Coordination']]},
  billing:   {label:'Billing',   items:[['rentrun','Rent Run'],['ledger','Rent & Funding']]},
};
const HUB_OF = {};
Object.entries(HUBS).forEach(([k,h])=>h.items.forEach(([v])=>{ HUB_OF[v]=k; }));
const isHousingRole = () => !!(ME && HOUSING_ROLES.includes(ME.job_role));
// The handful of shared pages housing staff still get (their own tasks/comms/learning) —
// everything else clinical/detox stays hidden from them.
const UNIVERSAL_VIEWS = ['myrole','mystats','mygrowth','mytasks','messages','team','training','library','standard','handbook'];
/* ── FACILITY-FIRST NAVIGATION ─────────────────────────────────────────────────
   Pick a facility in the switcher and the sidebar becomes THAT facility's
   dashboard — built from its service-line module set (org registry). A detox
   shows rounds/beds/billing-readiness; a sober-living home shows the housing
   suite; Corporate shows the corporate lane. "All facilities" shows everything
   the role allows (the leadership rollup). Views not mapped here are personal/
   role-level and always follow the existing role rules. */
const VIEW_MODULE = {
  // front door
  arrivals:'arrivals', arrivalcheck:'arrivals', admissions:'admissions', referrals:'admissions', partners:'admissions',
  // clinical core
  clients:'census', journey:'census', editor:'census', property:'census', command:'census', admitcheck:'census',
  records:'clinical', report:'clinical', program:'clinical', casemgmt:'casemgmt',
  rounds:'rounds', roundscan:'rounds', bedmap:'beds', bedboard:'beds', laundry:'beds',
  appts:'scheduling', concierge:'concierge', meals:'concierge', dignity:'concierge',
  engagement:'morale', retention:'morale', surveys:'morale', clientvoice:'morale',
  incidents:'incidents', compliance:'compliance',
  dischargepage:'discharges', continuum:'discharges', alumni:'discharges',
  // money
  authreg:'authregister', billingready:'billingready', outpatient:'outpatient_census', finance:'finance', expenses:'finance',
  // building
  inventory:'inventory', maintenance:'maintenance',
  operations:'staffing', coverage:'staffing', schedule:'staffing', roster:'staffing', weekgrid:'staffing', assign:'staffing', staffmodel:'staffing', staffsignins:'staffing',
  // housing suite (sober living)
  housing:'housing', staffhub:'housing', hstaffdev:'housing', houses:'housing', fleet:'housing', residents:'housing', resident:'housing', intake:'housing', screens:'housing', houselife:'housing', housingstaff:'housing', shiftreports:'housing', hincidents:'housing', voice:'housing', hmaint:'housing', activities:'housing', hfarewell:'housing', movement:'housing', coordination:'housing', employment:'housing', housingoutcomes:'housing',
  rentrun:'rent', ledger:'rent', orh:'orh',
  // corporate lane
  ownership:'corporate', corphub:'corporate', plan:'corporate', excellence:'corporate', playbook:'corporate',
  hcos:'hr', onboarding:'hr', leadership:'hr', hiring:'hr',
};
function curFacility(){ if(typeof FAC_SCOPE!=='string'||!FAC_SCOPE||!ME) return null; return (ME.facilities||[]).find(f=>String(f.id)===FAC_SCOPE)||null; }
function moduleVisible(v){
  const m=VIEW_MODULE[v]; if(!m) return true;                 // unmapped → role rules only
  const fac=curFacility(); if(!fac) return true;              // All facilities → everything the role allows
  return (fac.modules||[]).includes(m);
}
// Where each facility TYPE lands when you switch to it — its natural home page.
const TYPE_HOME = { 'detox':'opscenter', 'residential':'opscenter', 'outpatient':'outpatient', 'sober-living':'housing', 'corporate':'corphub' };
// Corporate Operations (Chava): walled to her lane — the hub, ordering,
// supplies/par levels, and maintenance work orders. No facility pulse and no
// food-service pages: ordering happens on the Corp Hub queue, not in Meals.
const CORPORATE_VIEWS = ['corphub','inventory','maintenance'];
let PREVIEW_ROLE=null;   // admin "preview as" — see the app exactly as a role does
function isCorporateRole(){ const jr=(v)=>String(v||'').trim().toLowerCase()==='executive assistant'; return !!(ME && (jr(ME.job_role) || jr(PREVIEW_ROLE))); }
// Role-based menu: frontline care staff get a flat, task-ordered sidebar (no group
// tabs, nothing buried) instead of the journey groups. Other roles keep the full nav.
const ROLE_MENU = {
  // Ordered by how the shift actually flows. Round Status (not the duplicate scan
  // tab), Intake (the full arrival checklist — dignity bag lives there, no standalone
  // Dignity tab), then the day's work. My Tasks lives ON My Shift, not as a tab.
  // My Role is folded into My Shift (its own collapsible at the bottom) — no tab.
  'BHT / Tech': ['dashboard','mystats','mygrowth','rounds','arrivalcheck','property','meals','bedboard','laundry','engagement','clients','incidents','concierge','messages','team','training','handbook','library'],
  'Nurse':      ['dashboard','mystats','mygrowth','rounds','arrivalcheck','clients','records','incidents','bedmap','inventory','compliance','concierge','messages','team','training','handbook','library'],
  'Front Desk': ['dashboard','mystats','mygrowth','arrivals','arrivalcheck','admissions','referrals','partners','clients','concierge','clientvoice','family','bedmap','property','inventory','messages','team','training','handbook','library'],
  // Housing staff don't use the detox My Shift, so they keep a My Role tab.
  'Executive Assistant': ['corphub','inventory','maintenance','myrole','mygrowth','handbook','messages'],
  // The Case Manager's day, in order: home → meeting queue → caseload → the exits
  // (discharge/continuum) → the money guardrails (auths, billing readiness) → circle.
  'Case Manager': ['dashboard','appts','casemgmt','clients','records','dischargepage','continuum','authreg','billingready','family','referrals','alumni','incidents','messages','team','training','handbook','library'],
  // Revenue lane — the money side of care, in the order the day flows:
  // what expires (auths) → what bills today (readiness) → the charts behind it.
  'Director of Revenue Cycle Management': ['dashboard','authreg','billingready','outpatient','clients','records','continuum','messages','team','training','handbook','library'],
  // Compliance lane — is every billed day defensible: readiness first, then the
  // documentation review, then the charts and auths it all points back to.
  'Director of Billing Compliance': ['dashboard','billingready','compliance','records','clients','authreg','messages','team','training','handbook','library'],
  'Housing Director': ['housing','myrole','mygrowth','handbook','leadmirror','staffhub','voice','activities','residents','houses','housingstaff','housingoutcomes','rentrun','mytasks','messages'],
  'House Manager':    ['housing','myrole','mygrowth','handbook','staffhub','voice','activities','residents','houses','housingstaff','rentrun','mytasks','messages'],
  'Recovery Coach':   ['staffhub','myrole','mygrowth','handbook','housing','voice','activities','residents','houses','mytasks','messages'],
};
// Plain-language "how my shift flows" — the rhythm of the job in order, each step
// linking to the tool. This is the train-a-new-hire-in-five-minutes layer.
const SHIFT_FLOW = {
  'BHT / Tech': [
    { t:'Start of shift — read My Shift', d:'Your tiles show exactly what needs you right now. Start at the top.', v:'dashboard' },
    { t:'Every hour — do your Rounds', d:'Scan each room, lay eyes on every client, and log it. The clock only clears when you scan.', v:'roundscan' },
    { t:'New arrival — Belongings, then welcome', d:'Search with a witness, secure & sign for everything, then greet them by name and start their Care Card.', v:'property' },
    { t:'Mealtimes — the Table', d:'Announce the meal, help serve, and make sure snacks, coffee & juice are out.', v:'meals' },
    { t:'After a discharge — flip the room', d:'Turn the room over and finish the laundry so it’s spotless for the next person.', v:'bedboard' },
    { t:'All shift — keep them engaged', d:'Deliver the personal touches on your dashboard; nobody bored or alone.', v:'engagement' },
    { t:'End of shift — hand off clean', d:'Finish any open rounds and leave a note for the next shift.', v:'messages' },
  ],
  'Nurse': [
    { t:'Start of shift — read My Shift', d:'Your tiles flag what’s urgent: meds, assessments, and who to watch.', v:'dashboard' },
    { t:'Every hour — verify Rounds', d:'Lay eyes on every client and log it by scanning each room.', v:'roundscan' },
    { t:'Clinical care', d:'Meds, vitals, and withdrawal monitoring — document as you go.', v:'records' },
    { t:'End of shift — hand off clean', d:'Update records and leave a clear note for the next nurse.', v:'messages' },
  ],
  'Case Manager': [
    { t:'Start of day — read My Shift', d:'Your tiles show who needs you: new admits without a case plan, discharges coming, meetings requested.', v:'dashboard' },
    { t:'Work the meeting queue', d:'Clients asked for you by name — promise a time, meet, and close each with the one-minute note.', v:'appts' },
    { t:'Discharges in the next 72 hours', d:'Aftercare confirmed, ride arranged, meds plan, continuum referral — the fond farewell starts days early.', v:'dischargepage' },
    { t:'Authorization check', d:'Nothing expires unseen — renew or escalate anything inside the window.', v:'authreg' },
    { t:'Billing readiness — your caseload', d:'Every client of yours needs today\'s qualifying encounter documented before 4 PM.', v:'billingready' },
    { t:'Family touchpoints', d:'One update to a family member changes their whole week. Log the contact.', v:'family' },
    { t:'End of day — clear your follow-ups', d:'Expand any quick notes flagged for a full note; reschedule anything missed. Leave nothing hanging.', v:'appts' },
  ],
  'Front Desk': [
    { t:'Start of shift — read My Shift', d:'See who’s arriving today and what the door needs.', v:'dashboard' },
    { t:'Arrivals — the warm welcome', d:'Greet by name, run the arrival checklist, and tap Done when finished.', v:'arrivalcheck' },
    { t:'All day — field requests', d:'Take concierge requests and route them to the right person.', v:'concierge' },
    { t:'Keep stock ready', d:'Take inventory so the team never runs short.', v:'inventory' },
  ],
};
function flatMenu(){
  if(!ME) return null;
  // Admin previewing as a role sees that role's focused menu.
  if(PREVIEW_ROLE) return (ROLE_MENU[PREVIEW_ROLE]||[]).filter(canSeeView);
  // A person's COMPANY is their job role. Hilltop staff (Housing Director / House
  // Manager / Recovery Coach) ALWAYS get the focused, Hilltop-only flat menu —
  // even if they're also an admin — so they never see any Armada/detox pages.
  if(isHousingRole()) return ROLE_MENU[ME.job_role] ? ROLE_MENU[ME.job_role].filter(canSeeView) : null;
  // Corporate (Chava) gets a focused, corporate-only flat menu.
  if(isCorporateRole()) return ROLE_MENU['Executive Assistant'].filter(canSeeView);
  // Admins + leadership keep the full grouped nav.
  if(ME.role==='admin' || ME.job_role==='Director of Operations') return null;
  if(ME.job_role==='Executive Director') return null;
  return ROLE_MENU[ME.job_role] ? ROLE_MENU[ME.job_role].filter(canSeeView) : null;
}
function canManageStaffing(){ return !!(ME && (ME.role==='admin' || ME.job_role==='Director of Operations')); }
function canSeeView(v){
  if(!ME) return true;
  // Admin "preview as" — restrict to exactly what that role sees.
  if(PREVIEW_ROLE==='Executive Assistant') return CORPORATE_VIEWS.includes(v)||UNIVERSAL_VIEWS.includes(v);
  if(PREVIEW_ROLE) return (ROLE_MENU[PREVIEW_ROLE]||[]).includes(v)||UNIVERSAL_VIEWS.includes(v);
  // Akron Outpatient is owner-only: the admin, plus anyone the owner explicitly grants.
  // Even Exec/Ops directors don't see it unless granted — so this check comes first.
  if(v==='outpatient'||v==='ownership') return !!(ME.role==='admin' || ME.outpatientAccess);
  // Operations Center: leadership's live board (admin/ED/DoO/Clinical Director/HR/EA).
  if(v==='opscenter') return !!(ME.role==='admin' || ME.opsAccess);
  // My Desk: the owner's private capture inbox.
  if(v==='mydesk') return ME.role==='admin';
  // Authorization register (Revenue OS): UR-permitted roles + clinical leadership.
  if(v==='authreg') return !!(ME.role==='admin' || ME.authAccess);
  // Billing readiness: leadership + clinical staff (rows scoped server-side).
  if(v==='billingready') return !!(ME.role==='admin' || ME.billingAccess);
  // Scheduling & queue: the care team + front desk.
  if(v==='appts') return !!(ME.role==='admin' || ME.apptsAccess);
  // Corporate hub: Chava, plus owner/leadership. Even non-corporate leadership gets it.
  if(v==='corphub') return !!(ME.role==='admin' || ME.corpAccess);
  if(v==='hcos') return !!(ME.role==='admin' || ME.hrAccess);
  // Corporate role is walled to its own lane — the hub, ordering, maintenance.
  if(isCorporateRole()) return CORPORATE_VIEWS.includes(v) || UNIVERSAL_VIEWS.includes(v);
  // Recovery Housing is walled off: only the owner/admin and housing staff see it.
  // Nobody on the clinical/detox side does — not even the broad-leadership roles below.
  if(HOUSING_VIEWS.includes(v)) return ME.role==='admin' || ME.job_role==='Executive Director' || HOUSING_ROLES.includes(ME.job_role);
  // Housing-only staff never see the clinical/detox pages — just a few shared ones.
  if(isHousingRole()) return UNIVERSAL_VIEWS.includes(v) || (v==='leadmirror' && ME.job_role==='Housing Director');
  // Broad leadership sees every (non-housing) page (Command/config stays admin-only via renderGroups).
  // The Director of Operations oversees clinical, medical, admissions & case management
  // and owns QA/compliance + discharge/retention, so she needs the full picture.
  if(ME.role==='admin' || ME.job_role==='Executive Director' || ME.job_role==='Director of Operations') return true;
  const allowed = VIEW_ROLES[v];
  if(!allowed) return true;   // ungated → visible to everyone (generous default)
  return allowed.includes(ME.job_role);
}
// One visibility rule for the sidebar: a button is showable when the role may see
// the view AND it isn't an admin-only tool (unless VIEW_ROLES explicitly grants it)
// AND it isn't a subview reached through in-page tabs. Group tabs, nav filtering,
// and group landing all consult THIS — so an empty group never shows its tab.
function buttonShowable(b){
  const v=b.dataset.view;
  let adminHidden = b.hasAttribute('data-admin') && ME && ME.role!=='admin';
  if(adminHidden && VIEW_ROLES[v] && canSeeView(v)) adminHidden=false;
  return !adminHidden && !b.hasAttribute('data-subview') && canSeeView(v) && moduleVisible(v);
}
function groupVisible(g){
  if(g==='today' || g==='team') return true;   // Home + culture: always
  return [...document.querySelectorAll('#nav button')].some(b=>(GROUP_OF[b.dataset.view]||'stay')===g && buttonShowable(b));
}
function firstAllowedView(grp){
  // Staffing is the Director of Operations' core job — land the Facility section
  // on the Staffing schedule for her, not the supplies list.
  if(grp.g==='facility' && ME && ME.job_role==='Director of Operations' && canSeeView('schedule')) return 'schedule';
  if(canSeeView(grp.first)) return grp.first;
  const b=[...document.querySelectorAll('#nav button')].find(b=>(GROUP_OF[b.dataset.view]||'stay')===grp.g && buttonShowable(b));
  return b ? b.dataset.view : grp.first;
}
// Frontline roles get their whole toolset as a persistent bar across the top of
// every page — no sidebar to hunt through; their tools are always one tap away.
function renderToolsbar(){
  const bar=document.getElementById('toolsbar'), shell=document.getElementById('shell'); if(!bar||!shell) return;
  const flat=flatMenu();
  const acct=document.getElementById('topAccount');
  if(flat){
    shell.classList.add('flatnav');
    bar.innerHTML = flat.filter(canSeeView).map(v=>{ const b=document.querySelector(`#nav button[data-view="${v}"]`); const label=b?(b.firstChild?b.firstChild.textContent.trim():b.textContent.trim()):v; return `<button data-tv="${v}" onclick="show('${v}')">${esc(label)}</button>`; }).join('');
    bar.style.display='';
    if(acct){ acct.style.display='flex'; const w=document.getElementById('whoamiTop'); if(w&&ME) w.textContent=ME.name||''; }
  } else {
    shell.classList.remove('flatnav');
    bar.style.display='none'; bar.innerHTML='';
    if(acct) acct.style.display='none';
  }
}
/* ── SIDEBAR v3 — the whole map, one glance ────────────────────────────────────
   Every group is a collapsible section you can SEE at all times — no more
   hunting through tabs for where a page lives. Type in the filter to find any
   page by name. Star (★) anything to pin it to the top. The active section
   opens itself; your open/closed choices persist per device. Frontline roles
   keep their flat task menus (unchanged). */
const navPins=()=>{ try{ const p=JSON.parse(localStorage.getItem('navPins')||'[]'); return Array.isArray(p)?p:[]; }catch(_e){ return []; } };
const navOpenState=()=>{ try{ return JSON.parse(localStorage.getItem('navOpen')||'{}')||{}; }catch(_e){ return {}; } };
let NAV_ORDER=null;   // original DOM order of buttons+captions, captured once
function togglePin(v,ev){ if(ev){ ev.stopPropagation(); ev.preventDefault(); }
  const p=navPins(); const i=p.indexOf(v); if(i>=0) p.splice(i,1); else p.push(v);
  localStorage.setItem('navPins',JSON.stringify(p)); renderGroups(); }
function navRecents(){ try{ const r=JSON.parse(localStorage.getItem('navRecent')||'[]'); return Array.isArray(r)?r:[]; }catch(_e){ return []; } }
function navRecordRecent(v){
  if(['dashboard','today'].includes(v)||navPins().includes(v)) return;
  const r=navRecents().filter(x=>x!==v); r.unshift(v);
  localStorage.setItem('navRecent',JSON.stringify(r.slice(0,4)));
  const host=$('navRecent'); if(host) renderNavShortcuts();
}
function navLabelOf(v){ const b=document.querySelector(`#navSecs button[data-view="${v}"]`); return b?b.childNodes[0].textContent.trim():v; }
function renderNavShortcuts(){
  const pinHost=$('navPinned'), recHost=$('navRecent'); if(!pinHost||!recHost) return;
  const mk=(v,star)=>{ const b=document.createElement('button'); b.dataset.view=v; b.className='nav-shortcut';
    b.innerHTML=`<span class="pinbtn on" title="${star?'Unpin':''}">${star?'★':'·'}</span>${esc(navLabelOf(v))}`;
    b.onclick=()=>show(v);
    if(star) b.querySelector('.pinbtn').onclick=(ev)=>togglePin(v,ev);
    return b; };
  const pins=navPins().filter(v=>{ const ob=document.querySelector(`#navSecs button[data-view="${v}"]`); return ob&&buttonShowable(ob); });
  pinHost.innerHTML=pins.length?'<div class="side-cap">★ Pinned</div>':''; pins.forEach(v=>pinHost.appendChild(mk(v,true)));
  const recents=navRecents().filter(v=>{ const ob=document.querySelector(`#navSecs button[data-view="${v}"]`); return ob&&buttonShowable(ob)&&!navPins().includes(v); }).slice(0,4);
  recHost.innerHTML=recents.length?'<div class="side-cap">Recent</div>':''; recents.forEach(v=>recHost.appendChild(mk(v,false)));
}
function applyNavVisibility(){
  document.querySelectorAll('#navSecs .side-sec').forEach(sec=>{
    let visible=0;
    sec.querySelectorAll('.side-secbody > button[data-view]').forEach(b=>{ const ok=buttonShowable(b); b.style.display=ok?'':'none'; if(ok)visible++; });
    sec.querySelectorAll('.side-secbody > [data-cap]').forEach(c=>{ c.style.display=''; });
    sec.style.display=visible?'':'none';
    const n=sec.querySelector('.side-count'); if(n) n.textContent=visible;
  });
  renderNavShortcuts();
}
function navToggleSec(g){
  const sec=document.querySelector(`#navSecs .side-sec[data-g="${g}"]`); if(!sec) return;
  sec.classList.toggle('open');
  const st=navOpenState(); st[g]=sec.classList.contains('open'); localStorage.setItem('navOpen',JSON.stringify(st));
}
function navApplyFilter(){
  const q=(($('navFilter')||{}).value||'').trim().toLowerCase();
  const nav=$('nav'); if(!nav) return;
  nav.classList.toggle('nav-filtering',!!q);
  if(!q){ applyNavVisibility(); return; }
  document.querySelectorAll('#navSecs .side-sec').forEach(sec=>{
    let hits=0;
    sec.querySelectorAll('.side-secbody > button[data-view]').forEach(b=>{
      const ok=buttonShowable(b)&&b.childNodes[0].textContent.toLowerCase().includes(q);
      b.style.display=ok?'':'none'; if(ok)hits++;
    });
    sec.querySelectorAll('.side-secbody > [data-cap]').forEach(c=>{ c.style.display='none'; });
    sec.style.display=hits?'':'none';
  });
}
function navFilterKey(ev){
  if(ev.key==='Escape'){ ev.target.value=''; navApplyFilter(); ev.target.blur(); return; }
  if(ev.key==='Enter'){ const b=[...document.querySelectorAll('#navSecs .side-secbody > button[data-view]')].find(x=>x.style.display!=='none'); if(b){ show(b.dataset.view); ev.target.value=''; navApplyFilter(); } }
}
function renderGroups(){
  document.querySelectorAll('#nav > button, #navSecs button[data-view]').forEach(b=>{ b.dataset.group = GROUP_OF[b.dataset.view]||'stay'; });
  renderToolsbar();
  const flat = flatMenu();
  const nav=$('nav');
  if(flat){
    // Flat task menu: the top tools bar is the nav; no sections needed.
    if($('groupbar')) $('groupbar').style.display='none';
    if(nav){
      // restore any sectioned buttons to the flat nav, in role order
      document.querySelectorAll('#navSecs button[data-view]').forEach(b=>nav.appendChild(b));
      const secs=$('navSecs'); if(secs) secs.style.display='none';
      ['navPinned','navRecent','navFilterWrap'].forEach(id=>{ const el=$(id); if(el) el.style.display='none'; });
      flat.forEach(v=>{ const b=nav.querySelector(`button[data-view="${v}"]`); if(b) nav.appendChild(b); });
    }
    renderBottomNav();
    return;
  }
  if($('groupbar')) $('groupbar').style.display='none';   // v3: sections replace the group tabs
  if(!nav) return;
  ['navFilterWrap','navPinned','navRecent'].forEach(id=>{ const el=$(id); if(el) el.style.display=''; });
  // Capture the original order of buttons + captions once (rebuilds stay stable).
  if(!NAV_ORDER) NAV_ORDER=[...nav.querySelectorAll('button[data-view], [data-cap]')];
  // Scaffold: filter · pinned · recent · sections · build stamp
  if(!$('navSecs')){
    nav.insertAdjacentHTML('afterbegin',
      `<div class="side-filter" id="navFilterWrap"><input id="navFilter" placeholder="Find a page…" oninput="navApplyFilter()" onkeydown="navFilterKey(event)" autocomplete="off"/></div>
       <div id="navPinned"></div><div id="navRecent"></div><div id="navSecs"></div>`);
    nav.insertAdjacentHTML('beforeend', `<div class="side-build" id="navBuild"></div>`);
  }
  const secsHost=$('navSecs');
  const isAdmin = ME && ME.role==='admin';
  const open=navOpenState();
  secsHost.innerHTML='';
  for(const grp of GROUPS){
    if(grp.admin && !isAdmin) continue;
    const sec=document.createElement('div');
    sec.className='side-sec'+(open[grp.g]?' open':'');
    sec.dataset.g=grp.g;
    sec.innerHTML=`<button type="button" class="side-sechead${grp.admin?' side-admingroup':''}" onclick="navToggleSec('${grp.g}')"><span class="side-caret">▸</span>${esc(grp.label)}<span class="side-count"></span></button><div class="side-secbody"></div>`;
    secsHost.appendChild(sec);
  }
  // Move each button/caption into its group's body, preserving original order.
  for(const el of NAV_ORDER){
    const g=el.dataset.view?(GROUP_OF[el.dataset.view]||'stay'):(el.dataset.group||'stay');
    const body=secsHost.querySelector(`.side-sec[data-g="${g}"] .side-secbody`);
    if(body) body.appendChild(el);
  }
  // Pin affordance on every page row (hover on desktop, always on touch).
  secsHost.querySelectorAll('.side-secbody > button[data-view]').forEach(b=>{
    if(!b.querySelector('.pinbtn')){
      const star=document.createElement('span'); star.className='pinbtn';
      star.onclick=(ev)=>togglePin(b.dataset.view,ev);
      b.appendChild(star);
    }
    const on=navPins().includes(b.dataset.view);
    const st=b.querySelector('.pinbtn'); st.textContent=on?'★':'☆'; st.classList.toggle('on',on); st.title=on?'Unpin':'Pin to top';
  });
  applyNavVisibility();
  renderBottomNav();
  // Build stamp — so "did it deploy?" is answered by looking at the sidebar.
  const bs=$('navBuild');
  if(bs&&!bs.textContent){ fetch('/sw.js').then(r=>r.text()).then(t=>{ const m=t.match(/armada-v(\d+)/); if(m) bs.textContent='build '+m[1]; }).catch(()=>{}); }
}
function selectGroup(g){
  const flat = flatMenu();
  if(flat){
    [...document.querySelectorAll('#nav button[data-view]')].forEach(b=>{ b.style.display = (flat.includes(b.dataset.view) && canSeeView(b.dataset.view)) ? '' : 'none'; });
    document.querySelectorAll('#nav [data-cap]').forEach(c=>{ c.style.display='none'; });
    const navEl=$('nav'); if(navEl) navEl.style.display='';
    return;
  }
  // v3: highlight + auto-open the active section (without persisting the auto-open).
  document.querySelectorAll('#navSecs .side-sec').forEach(sec=>{
    const active=sec.dataset.g===g;
    sec.classList.toggle('current',active);
    if(active) sec.classList.add('open');
  });
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => show(b.dataset.view));
// In-page hub tab strip: render the tabs for whichever hub the current view belongs to.
function renderHubTabs(v){
  const host=document.getElementById('hubTabs'); if(!host) return;
  const key=HUB_OF[v];
  if(!key){ host.style.display='none'; host.innerHTML=''; return; }
  const items=HUBS[key].items.filter(([view])=>canSeeView(view));
  if(items.length<=1){ host.style.display='none'; host.innerHTML=''; return; }
  host.style.display='';
  host.innerHTML=items.map(([view,label])=>`<button class="hubtab ${view===v?'active':''}" onclick="show('${view}')">${label}</button>`).join('');
  // keep the sidebar highlight on the hub's host even when a sub-tab view is open
  const hostView=HUBS[key].items[0][0];
  const hb=document.querySelector(`#nav button[data-view="${hostView}"]`); if(hb) hb.classList.add('active');
}
function toggleNav(){ document.getElementById('shell').classList.toggle('nav-open'); }
/* ── Mobile bottom bar: the phone gets FOUR tabs + Menu, nothing else.
   Star (★) pages in the menu to choose your own four; otherwise the bar is
   your role's daily essentials. Everything else lives behind ☰ Menu. ── */
const BN_ICON={today:'☀️',dashboard:'🕐',clients:'👥',mydesk:'🗂️',ownership:'🏢',staffhub:'🏠',residents:'🧑‍🤝‍🧑',houses:'🛏️',movement:'🚐',command:'🎛️',opscenter:'⚙️',arrivals:'🚪',schedule:'📅',outpatient:'🧠',housing:'🏘️',records:'📁',rounds:'🔄',roundscan:'📷',corphub:'🗂️',hcos:'👥',appts:'📅',incidents:'⚠️'};
const BN_LABEL={today:'Today',dashboard:'My Shift',clients:'Clients',mydesk:'Desk',ownership:'Exec',staffhub:'Hub',residents:'Residents',movement:'Movement',command:'Command',opscenter:'Ops',arrivals:'Front Desk',corphub:'Corp',hcos:'HR',appts:'Schedule',records:'Records',outpatient:'Outpatient'};
function bnLabelOf(v){
  if(BN_LABEL[v]) return BN_LABEL[v];
  const b=document.querySelector(`#navSecs button[data-view="${v}"]`)||document.querySelector(`#nav button[data-view="${v}"]`);
  const t=b?(b.childNodes[0]?b.childNodes[0].textContent.trim():b.textContent.trim()):v;
  return t.length>11?t.split(/[\s—·]+/)[0]:t;
}
function bottomNavItems(){
  if(!ME) return [];
  const pins=navPins().filter(canSeeView);
  if(pins.length>=2) return pins.slice(0,4);
  const flat=flatMenu();
  if(flat&&flat.length) return flat.slice(0,4);
  let items;
  if(ME.role==='admin') items=['today','clients','mydesk','ownership'];
  else if(ME.job_role==='Executive Director') items=['today','clients','ownership','opscenter'];
  else items=['today','clients','dashboard','opscenter'];
  return items.filter(canSeeView).slice(0,4);
}
function renderBottomNav(){
  const host=$('bottomNav'); if(!host) return;
  const items=bottomNavItems();
  if(!items.length){ host.style.display='none'; return; }
  host.style.display='';
  host.innerHTML=items.map(v=>`<button data-bn="${v}" onclick="show('${v}')"><span class="bn-ico">${BN_ICON[v]||'📄'}</span><span class="bn-lbl">${esc(bnLabelOf(v))}</span></button>`).join('')
    +`<button data-bn="__menu" onclick="toggleNav()"><span class="bn-ico">☰</span><span class="bn-lbl">Menu</span></button>`;
  const cur=document.querySelector('.view.active');
  if(cur) host.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.bn===cur.id));
}
function show(v){
  if(!canSeeView(v)) v = isHousingRole() ? 'staffhub' : 'dashboard';   // can't see it → send home (Hilltop staff never to detox)
  selectGroup(GROUP_OF[v]||'stay');
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id===v));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.querySelectorAll('#toolsbar button').forEach(b=>b.classList.toggle('active', b.dataset.tv===v));
  document.querySelectorAll('#bottomNav button').forEach(b=>b.classList.toggle('active', b.dataset.bn===v));
  renderHubTabs(v);
  document.querySelectorAll('.itab').forEach(b=>b.classList.toggle('active', b.dataset.tab===v));   // Insights tabs
  try{ navRecordRecent(v); }catch(_e){ /* shortcuts optional */ }
  const activeBtn=document.querySelector(`#nav button[data-view="${v}"]`);
  const noNavTitles={journey:'Client 360',editor:'Care Card',analytics:'Risk Analytics',scorecard:'Scorecard',accountability:'Accountability','report-view':'Reports',surveys:'Surveys',incidents:'Incidents',partners:'Partners',coverage:'Coverage',assign:'Assign Staff',standard:'The Standard',lineup:'Daily Lineup',dignity:'Dignity Kits',family:'Family',askai:'Ask AI',authreg:'Authorization Register',billingready:'Billing Readiness',mydesk:'My Desk',appts:'Scheduling & Queue',housing:'Recovery Housing — HQ',staffhub:'Staff Hub',hstaffdev:'Staff Growth',hfarewell:'Farewell & Alumni',fleet:'Vehicles & Transportation',houses:'Houses & Beds',residents:'Residents',resident:'Resident 360',screens:'Drug Screening',houselife:'House Life',coordination:'Clinical Coordination',ledger:'Rent & Funding',orh:'ORH Compliance',housingoutcomes:'Housing Outcomes',intake:'Intake & Forms',rentrun:'Rent Run',employment:'Employment & Job Search',housingstaff:'Staffing',shiftreports:'Shift Reports',hincidents:'Incident Reports',voice:'Resident Voice & Kiosk',hmaint:'Maintenance & Supplies',activities:'Activities & Engagement',movement:'Daily Movement'};
  if($('topbarTitle')) $('topbarTitle').textContent = (noNavTitles[v]) || (activeBtn ? (activeBtn.childNodes[0] ? activeBtn.childNodes[0].textContent.trim() : activeBtn.textContent) : $('topbarTitle').textContent);
  document.getElementById('shell')?.classList.remove('nav-open');
  if(v==='dashboard') loadDashboard();
  if(v==='today') loadToday();
  if(v==='opscenter') loadOpsCenter();
  if(v==='mydesk') loadMyDesk();
  if(v==='authreg') loadAuthReg();
  if(v==='billingready') loadBillingReady();
  if(v==='appts') loadAppts();
  if(v==='command') loadCommand();
  if(v==='finance') loadFinance();
  if(v==='expenses') loadExpenses();
  if(v==='plan') loadPlan();
  if(v==='excellence') loadExcellence();
  if(v==='onboarding') loadOnboarding();
  if(v==='playbook') loadPlaybookScore();
  if(v==='leadership') loadLeadership();
  if(v==='compliance') loadCompliance();
  if(v==='askai') loadAskAI();
  if(v==='incidents') loadIncidents();
  if(v==='alumni') loadAlumni();
  if(v==='accountability') loadAccountability();
  if(v==='standard') loadStandard();
  if(v==='handbook') loadHandbook();
  if(v==='library') loadLibrary();
  if(v==='training') loadTraining();
  if(v==='scorecard') loadScorecard();
  if(v==='mytasks') loadMyTasks();
  if(v==='messages') loadMessages();
  if(v==='settings') loadSettings();
  if(v==='referrals') loadReferrals();
  if(v==='partners') loadPartners();
  if(v==='analytics') loadAnalytics();
  if(v==='coverage') loadCoverage();
  if(v==='schedule') loadSchedule();
  if(v==='roster') loadRoster();
  if(v==='bedboard') loadBedBoard();
  if(v==='bedmap') loadBedMap();
  if(v==='property') loadProperty();
  if(v==='workplace') loadWorkplace();
  if(v==='weekgrid') loadWeekGrid();
  if(v==='staffmodel') loadStaffModel();
  if(v==='clients') renderClients();
  if(v==='records') loadRecords();
  if(v==='retention') loadRetention();
  if(v==='casemgmt') loadCaseMgmt();
  if(v==='continuum') loadContinuum();
  if(v==='dignity') loadDignity();
  if(v==='laundry') loadLaundry();
  if(v==='clientvoice') loadClientVoice();
  if(v==='myrole') loadMyRole();
  if(v==='mystats') loadMyStats();
  if(v==='mygrowth') loadMyGrowth();
  if(v==='employees') loadEmployees();
  if(v==='leadmirror') loadLeadMirror();
  if(v==='staffsignins') loadStaffSignins();
  if(v==='admitcheck') loadAdmitCheck();
  if(v==='dupes') loadDupes();
  if(v==='outpatient') loadOutpatient();
  if(v==='facreg') loadOrgFacs('orgFacs2');
  if(v==='ownership') loadOwnership();
  if(v==='corphub') loadCorpHub();
  if(v==='hcos') loadHcos();
  if(v==='rounds') loadRounds();
  if(v==='engagement') loadEngagement();
  if(v==='inventory') loadInventory();
  if(v==='meals') loadMeals();
  if(v==='dischargepage') loadDischargePage();
  if(v==='maintenance') loadMaintenance();
  if(v==='operations') loadOps();
  if(v==='arrivals') loadArrivals();
  if(v==='arrivalcheck') loadArrivalTasks();
  if(v==='roundscan') loadRoundScan();
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
  if(v==='hiring') loadHiring('detox','hiringBody');
  if(v==='audit') loadAudit();
  if(v==='report-view') loadReport();
  if(v==='assign') loadAssign();
  // Recovery Housing suite (functions live in housing.js)
  if(v==='housing' && window.loadHousingHQ) loadHousingHQ();
  if(v==='houses' && window.loadHouses) loadHouses();
  if(v==='residents' && window.loadResidents) loadResidents();
  if(v==='screens' && window.loadScreens) loadScreens();
  if(v==='houselife' && window.loadHouseLife) loadHouseLife();
  if(v==='coordination' && window.loadCoordination) loadCoordination();
  if(v==='ledger' && window.loadLedger) loadLedger();
  if(v==='orh' && window.loadOrh) loadOrh();
  if(v==='housingoutcomes' && window.loadHousingOutcomes) loadHousingOutcomes();
  if(v==='intake' && window.loadIntake) loadIntake();
  if(v==='rentrun' && window.loadRentRun) loadRentRun();
  if(v==='employment' && window.loadEmployment) loadEmployment();
  if(v==='housingstaff' && window.loadHousingStaff) loadHousingStaff();
  if(v==='shiftreports' && window.loadShiftReports) loadShiftReports();
  if(v==='hincidents' && window.loadHIncidents) loadHIncidents();
  if(v==='voice' && window.loadVoice) loadVoice();
  if(v==='hmaint' && window.loadHmaint) loadHmaint();
  if(v==='activities' && window.loadActivities) loadActivities();
  if(v==='movement' && window.loadDailyMovement) loadDailyMovement();
  if(v==='staffhub' && window.loadStaffHub) loadStaffHub();
  if(v==='hstaffdev' && window.loadStaffDev) loadStaffDev();
  if(v==='hfarewell' && window.loadFarewell) loadFarewell();
  if(v==='fleet' && window.loadFleet) loadFleet();
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
  if($('editorAllergy')) $('editorAllergy').innerHTML = (client.allergies&&client.allergies.trim())?`<div class="allergy-banner">⚠ ALLERGIES: ${esc(client.allergies)}</div>`:'';
  $('editorTitle').textContent = 'Care Card · '+(client.pref||client.name||'');
  $('deleteBtn').style.display = ME.role==='admin' ? 'inline-block':'none';
  $('dischargeBox').style.display='block'; $('d_date').value = today();
  if($('d_dest')){ $('d_dest').value = client.aftercare_dest||''; if($('d_partner')) $('d_partner').dataset.loaded=''; dischargeDestUI(); }
  show('editor');
  if(client.kipu_id) loadKipuChart(id); else if($('kipuChartCard')) $('kipuChartCard').style.display='none';
}
function dischargeDestUI(){ const w=$('d_partnerWrap'); if(!w) return; const partner=$('d_dest').value==='Approved partner'; w.style.display=partner?'':'none'; if(partner) loadDischargePartners(); }
async function loadDischargePartners(){ if(!$('d_partner')) return; try{ const d=await api('/continuum'); const opts=(d.partners||[]); $('d_partner').innerHTML = opts.length ? '<option value="">— choose —</option>'+opts.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('') : '<option value="">No approved partners — an admin sets these in Settings → Approved partners</option>'; }catch(e){} }
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
// Discharge guard: warn if the client's belongings/cash haven't been returned.
async function belongingsGuard(cid){
  try{ const s=await api('/clients/'+cid+'/property-status');
    if(s.hasRecord && !s.returned && ((s.balance||0)>0 || (s.storedItems||0)>0)){
      return confirm(`⚠ Belongings NOT returned for this client:\n• $${(s.balance||0).toFixed(2)} in trust\n• ${s.storedItems} item(s) still stored\n\nReturn them in Belongings first (Stay → Belongings).\n\nDischarge anyway?`);
    }
  }catch(e){}
  return true;
}
async function dischargeClient(){
  if(!currentId) return;
  const status=$('d_status').value;
  const dest=$('d_dest')?$('d_dest').value:'';
  if(!dest){ alert('Set the next step in the continuum first — no one leaves without a plan. (Choose Armada Outpatient, an approved partner, or Home/self.)'); if($('d_dest'))$('d_dest').focus(); return; }
  const fid = dest==='Approved partner' ? ($('d_partner')&&$('d_partner').value||null) : null;
  if(dest==='Approved partner' && !fid){ alert('Pick which approved partner.'); return; }
  if(!confirm(`Discharge this client as "${status}"? Next step: ${dest}${fid?' (partner)':''}. This starts the aftercare calls and removes them from the active playbook.`)) return;
  const cid = currentId;
  if(!(await belongingsGuard(cid))) return;
  const steps = [...document.querySelectorAll('#safeDeparture .sd:checked')].map(c=>c.dataset.s);
  try{ await api('/clients/'+currentId+'/continuum',{method:'POST',body:JSON.stringify({aftercare_dest:dest, aftercare_facility_id:fid})}); }catch(e){}
  await api('/clients/'+currentId+'/discharge',{method:'POST',body:JSON.stringify({status,date:$('d_date').value,steps,reason:$('d_reason').value,followthrough:$('d_follow').value,improve:$('d_improve').value})});
  if(status!=='Transferred' && confirm('Discharged — aftercare calls scheduled.\n\nWould you like to do the Discharge survey with the client now?')){
    gotoSurvey('discharge', cid);
  } else {
    alert('Discharged. Aftercare calls scheduled — see the Outcomes tab.');
    show('clients');
  }
}
/* ---- Standalone simple Discharge page ---- */
let DP_ID=null;
async function loadDischargePage(){
  DP_ID=null;
  if($('dpForm')) $('dpForm').style.display='none';
  if($('dp_msg')) $('dp_msg').textContent='';
  try{ const { clients } = await api('/clients');
    const active=(clients||[]).filter(c=>c.active!==0 && !c.discharge_status);
    $('dp_client').innerHTML='<option value="">— select a client —</option>'+active.map(c=>`<option value="${c.id}">${esc(c.pref||c.name)}${c.room?' · '+esc(c.room):''}</option>`).join('');
  }catch(e){ $('dp_client').innerHTML='<option value="">'+esc(e.message)+'</option>'; }
}
function dpPick(){
  DP_ID=$('dp_client').value||null;
  if(!DP_ID){ $('dpForm').style.display='none'; return; }
  $('dpForm').style.display='block';
  if(!$('dp_date').value) $('dp_date').value=today();
  // reset fields for the newly picked client
  ['dp_reason','dp_follow','dp_improve'].forEach(x=>{ if($(x)) $(x).value=''; });
  document.querySelectorAll('#dpSafe .sd').forEach(c=>c.checked=false);
  $('dp_dest').value=''; dpDestUI(); $('dp_msg').textContent='';
}
function dpDestUI(){ const w=$('dp_partnerWrap'); if(!w) return; const partner=$('dp_dest').value==='Approved partner'; w.style.display=partner?'':'none'; if(partner) loadDpPartners(); }
async function loadDpPartners(){ if(!$('dp_partner')) return; try{ const d=await api('/continuum'); const opts=(d.partners||[]); $('dp_partner').innerHTML = opts.length ? '<option value="">— choose —</option>'+opts.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('') : '<option value="">No approved partners — an admin sets these in Settings → Approved partners</option>'; }catch(e){} }
async function dischargeStandalone(){
  if(!DP_ID){ return; }
  const status=$('dp_status').value;
  const dest=$('dp_dest').value;
  if(!dest){ $('dp_msg').textContent='Set the next step — no one leaves without a plan.'; $('dp_dest').focus(); return; }
  const fid = dest==='Approved partner' ? ($('dp_partner')&&$('dp_partner').value||null) : null;
  if(dest==='Approved partner' && !fid){ $('dp_msg').textContent='Pick which approved partner.'; return; }
  if(!confirm(`Discharge as "${status}"? Next step: ${dest}${fid?' (partner)':''}. This starts the aftercare calls.`)) return;
  const cid=DP_ID;
  if(!(await belongingsGuard(cid))) return;
  const steps=[...document.querySelectorAll('#dpSafe .sd:checked')].map(c=>c.dataset.s);
  $('dp_msg').textContent='Saving…';
  try{
    try{ await api('/clients/'+cid+'/continuum',{method:'POST',body:JSON.stringify({aftercare_dest:dest, aftercare_facility_id:fid})}); }catch(e){}
    await api('/clients/'+cid+'/discharge',{method:'POST',body:JSON.stringify({status,date:$('dp_date').value,steps,reason:$('dp_reason').value,followthrough:$('dp_follow').value,improve:$('dp_improve').value})});
    $('dp_msg').textContent='✓ Discharged — aftercare calls scheduled.';
    if(status!=='Transferred' && confirm('Discharged — aftercare calls scheduled.\n\nDo the Discharge survey with the client now?')){ gotoSurvey('discharge', cid); return; }
    loadDischargePage();
  }catch(e){ $('dp_msg').textContent=e.message; }
}
const FF = ['name','pref','room','program','admit','admit_time','sober','therapist','case_manager','referral_source','touch','prefs','goals','triggers','safety','support','anchor_why','interests','welcome_plan','aftercare_plan'];
const AMENITIES = ['Music room','Gym','Art room','Arcade','Outdoors','Games','Movies','Reading'];
function renderInterestChips(){
  const box=$('interestChips'); if(!box) return;
  const cur = ($('f_interests').value||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  box.innerHTML = AMENITIES.map(a=>{ const on=cur.includes(a.toLowerCase());
    return `<button type="button" class="btn ${on?'btn-gold':'btn-ghost'} btn-sm sans" style="margin:2px" onclick="toggleInterest('${esc(a).replace(/'/g,"\\'")}')">${on?'✓ ':''}${esc(a)}</button>`; }).join('');
}
function toggleInterest(a){
  let cur = ($('f_interests').value||'').split(',').map(s=>s.trim()).filter(Boolean);
  const i = cur.findIndex(x=>x.toLowerCase()===a.toLowerCase());
  if(i>=0) cur.splice(i,1); else cur.push(a);
  $('f_interests').value = cur.join(', '); renderInterestChips();
}
function fillForm(c){
  FF.forEach(f => $('f_'+f).value = c[f]||'');
  renderInterestChips();
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
    ['Allergies', c.allergies ? esc(c.allergies) : ''],
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
function taskCard(t, role){
  // role: 'mine' (assigned to me — can reply + done) or 'byme' (I assigned — can reply/follow up)
  const meta = role==='mine' ? `from ${esc(t.assigned_by||'')}` : `to ${esc(t.assignee_name||'')}`;
  const cbadge = t.comments ? `<span class="badge">${t.comments} ${t.comments==1?'reply':'replies'}</span>` : '';
  const doneBtn = (role==='mine' && t.status==='Open') ? `<button class="btn btn-gold btn-sm sans" onclick="doneTask(${t.id})">Mark done</button>` : (t.status!=='Open'?'<span class="risk risk-low">done</span>':'');
  return `<details class="todo" style="display:block">
    <summary style="cursor:pointer;list-style:none">✅ <strong>${esc(t.title)}</strong>${t.pref?' · '+esc(t.pref):''}${t.due_date?' · due '+esc(t.due_date):''} <span class="hint">${meta}</span> ${cbadge} ${t.status!=='Open'?'<span class="risk risk-low">done</span>':''}</summary>
    ${t.detail?'<div class="hint" style="margin:6px 0">'+esc(t.detail)+'</div>':''}
    <div id="thread_${t.id}" class="task-thread" style="margin:8px 0"><div class="hint">Loading…</div></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px"><input id="reply_${t.id}" placeholder="Reply / follow up…" style="flex:1;min-width:160px"/><button class="btn btn-ghost btn-sm sans" onclick="replyTask(${t.id})">Send</button>${doneBtn}</div>
  </details>`;
}
async function loadTaskThread(id){
  const box=$('thread_'+id); if(!box) return;
  try{ const d=await api('/assigned-tasks/'+id); box.innerHTML = d.comments.length
    ? d.comments.map(c=>`<div class="pc-note" style="margin:4px 0"><strong>${esc(c.by)}</strong> <span class="hint">${esc(c.at)}</span><div>${esc(c.text)}</div></div>`).join('')
    : '<div class="hint">No replies yet — be the first to follow up.</div>'; }
  catch(e){ box.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; }
}
async function replyTask(id){
  const inp=$('reply_'+id); const text=inp?inp.value.trim():''; if(!text) return;
  try{ await api('/assigned-tasks/'+id+'/comment',{method:'POST',body:JSON.stringify({text})}); if(inp) inp.value=''; loadTaskThread(id); }
  catch(e){ alert(e.message); }
}
async function loadMyTasks(){
  const { calls, tasks, assignedByMe, today } = await api('/my-tasks');
  const callRows = calls.map(c=>`<div class="todo"><div class="txt">🤝 <strong>${esc(c.pref||c.name)}</strong> — ${esc(c.type)} aftercare call · due ${esc(c.due_date)} ${c.due_date<=today?'<span class="risk risk-high">due</span>':''}</div>
    <button class="btn btn-ghost btn-sm sans" onclick="doneCall(${c.id},'Done')">Done</button><button class="btn btn-ghost btn-sm sans" onclick="doneCall(${c.id},'Unreachable')">No answer</button></div>`).join('');
  const taskRows = tasks.map(t=>taskCard(t,'mine')).join('');
  $('myTasksList').innerHTML = (callRows+taskRows) || '<div class="pc-note">Nothing assigned to you. 🎉</div>';
  // Tasks I assigned to others
  if($('byMeCard')){
    if(assignedByMe && assignedByMe.length){ $('byMeCard').style.display='block'; $('byMeList').innerHTML = assignedByMe.map(t=>taskCard(t,'byme')).join(''); }
    else $('byMeCard').style.display='none';
  }
  // Lazy-load each thread when its row is opened (and once on render for any with replies).
  document.querySelectorAll('#mytasks details.todo').forEach(d=>{
    const id=(d.querySelector('[id^="thread_"]')||{}).id; if(!id) return; const tid=id.split('_')[1];
    d.addEventListener('toggle', ()=>{ if(d.open) loadTaskThread(tid); }, {once:false});
  });
  await fillClientSelect($('at_client'),'No client');
  try { const { staff } = await api('/staff'); const opts = staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $('at_to').innerHTML = '<option value="">Pick teammate…</option>'+opts;
  } catch(e){}
  if(ME.role==='admin'){ try { const { calls:ac, tasks:at } = await api('/all-tasks');
    $('allTasksList').innerHTML = (ac.map(c=>`<div class="pc-note">🤝 ${esc(c.pref)} — ${esc(c.type)} call due ${esc(c.due_date)} · <strong>${esc(c.assignee_name||'unassigned')}</strong></div>`).join('')+
      at.map(t=>`<div class="pc-note">✅ ${esc(t.title)} · <strong>${esc(t.assignee_name||'')}</strong>${t.due_date?' · due '+esc(t.due_date):''}</div>`).join('')) || '<div class="hint">No open team tasks.</div>'; }catch(e){} }
}
async function doneCall(id,status){ await api('/followups/'+id,{method:'POST',body:JSON.stringify({status})}); loadMyTasks(); }
async function doneTask(id){ const note=prompt('Mark done. Add a closing note for whoever assigned it (optional):','')||''; await api('/assigned-tasks/'+id+'/done',{method:'POST',body:JSON.stringify({note})}); loadMyTasks(); }
async function assignTask(){
  if(!$('at_to').value||!$('at_title').value.trim()){ alert('Pick a teammate and enter a task.'); return; }
  await api('/assigned-tasks',{method:'POST',body:JSON.stringify({assignee_id:$('at_to').value,title:$('at_title').value,client_id:$('at_client').value||null,due_date:$('at_due').value||null})});
  $('at_title').value=''; $('at_due').value=''; alert('Assigned.'); loadMyTasks();
}
async function saveCoordinator(){ await api('/settings/aftercare-coordinator',{method:'POST',body:JSON.stringify({user_id:$('acc_user').value||null})}); alert('Aftercare Coordinator saved. New discharges will auto-assign their calls.'); }
async function saveOncall(){ const emailAlerts=$('oc_email_alerts')?$('oc_email_alerts').checked:false; await api('/settings/oncall',{method:'POST',body:JSON.stringify({email:$('oc_email').value,phone:$('oc_phone').value,email_alerts:emailAlerts})}); alert('On-call leader saved. High alerts show in-app'+(emailAlerts?' and email':'')+(($('oc_phone').value||'').trim()?' and text the on-call leader':'')+'.'); }

/* ---- settings hub ---- */
function emailProviderUI(){ const p=$('em_provider').value; if($('em_smtp'))$('em_smtp').style.display=(p==='smtp')?'':'none'; if($('em_resend'))$('em_resend').style.display=(p==='resend')?'':'none'; }
async function loadEmailConfig(){
  try{ const c=await api('/email/config');
    if($('em_provider')){ $('em_provider').value = c.provider||'resend'; }
    if($('em_from')) $('em_from').value=c.from||'';
    if($('em_cc')) $('em_cc').value=c.cc||'';
    if($('em_smtp_host')) $('em_smtp_host').value=c.smtpHost||'';
    if($('em_smtp_port')) $('em_smtp_port').value=c.smtpPort||'587';
    if($('em_smtp_user')) $('em_smtp_user').value=c.smtpUser||'';
    if($('em_to')) $('em_to').value=c.to||'';
    if($('em_smtp_pass')) $('em_smtp_pass').placeholder = c.hasSmtpPass?'•••••• (saved)':'app password';
    if($('em_resend_key')) $('em_resend_key').placeholder = c.hasResendKey?'•••••• (saved)':'re_…';
    const h=$('em_health');
    if(h){
      const ready = c.provider && (c.provider==='resend'? c.hasResendKey : c.hasSmtpPass);
      const fromDomain = (c.from||'').match(/@([^>\s]+)/);
      const ownDomain = fromDomain && /armadarecovery\.com/i.test(fromDomain[1]);
      const usingResendDev = !c.from || /resend\.dev/i.test(c.from);
      let msg, bg, fg;
      if(!ready){ bg='#fdecea'; fg='#b00'; msg='⚠ Email not connected — reports and orders cannot send. Add a provider below.'; }
      else if(usingResendDev){ bg='#fff7e6'; fg='#a60'; msg='● Email working via '+(c.provider||'resend')+', but sending as <b>onboarding@resend.dev</b>. Verify <b>armadarecovery.com</b> in Resend → Domains, then set the From below to <b>care@armadarecovery.com</b> so mail lands in inboxes, not spam.'; }
      else if(ownDomain){ bg='#eaf7ee'; fg='#2d7a4f'; msg='✓ Email healthy — sending via '+(c.provider||'resend')+' from <b>'+esc(c.from)+'</b> (your domain).'; }
      else { bg='#eef4fb'; fg='#1a3a5c'; msg='● Email working via '+(c.provider||'resend')+', sending from <b>'+esc(c.from)+'</b>.'; }
      h.innerHTML=msg; h.style.background=bg; h.style.color=fg; h.style.display='';
    }
    emailProviderUI();
  }catch(e){}
}
async function saveEmailConfig(){
  $('em_msg').textContent='Saving…';
  const body={ provider:$('em_provider').value, from:$('em_from').value, to:$('em_to').value, cc:($('em_cc')?$('em_cc').value:''),
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
    if($('sf_client_id')) $('sf_client_id').value=c.clientId||'';
    if($('sf_api_version')) $('sf_api_version').value=c.apiVersion||'v60.0';
    if($('sf_client_secret')) $('sf_client_secret').placeholder = c.hasSecret?'•••••• (saved)':'consumer secret';
    if($('sf_facility_field')) $('sf_facility_field').value=c.facilityField||'';
    if($('sf_facility_value')) $('sf_facility_value').value=c.facilityValue||'';
    if($('sf_schedule_stages')) $('sf_schedule_stages').value=c.scheduleStages||'';
    if($('sf_admit_date_field')) $('sf_admit_date_field').value=c.admitDateField||'';
  }catch(e){}
}
async function saveSfConfig(){
  $('sf_msg').textContent='Saving…';
  const body={ instance_url:$('sf_instance_url').value, api_version:$('sf_api_version').value, client_id:$('sf_client_id').value,
    facility_field:$('sf_facility_field').value, facility_value:$('sf_facility_value').value,
    schedule_stages:($('sf_schedule_stages')||{}).value||'', admit_date_field:($('sf_admit_date_field')||{}).value||'' };
  if($('sf_client_secret').value) body.client_secret=$('sf_client_secret').value;
  try{ const r=await api('/salesforce/config',{method:'POST',body:JSON.stringify(body)}); $('sf_msg').textContent='✓ Saved'+(r.status&&r.status.configured?' (configured)':''); $('sf_client_secret').value=''; loadSfConfig(); }
  catch(e){ $('sf_msg').textContent='Error: '+e.message; }
}
async function sfDiagnoseSchedule(){
  $('sf_msg').textContent='Diagnosing…';
  let d; try{ d=await api('/arrivals/diagnose'); }catch(e){ $('sf_msg').textContent=e.message; return; }
  $('sf_msg').textContent='';
  const fields=d.oppFacilityFields||[]; const vals=d.facilityValues||{};
  let html='<div class="card" style="margin-top:8px"><h4 class="sans">Facility fields on Opportunity</h4>';
  if(!fields.length){ html+='<div class="hint">No obvious facility/location field found. Use “Discover objects” to inspect, or paste a field name manually.</div>'; }
  else {
    html += fields.map(f=>{
      const fv=(vals[f.name]||[]);
      return `<div class="todo" style="display:block"><div><strong>${esc(f.name)}</strong> <span class="hint">${esc(f.label||'')} · ${esc(f.type||'')}</span></div>
        ${fv.length?`<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px">${fv.map(v=>`<button class="btn btn-ghost btn-sm sans" onclick="pickFacility('${esc(f.name).replace(/'/g,"\\'")}','${esc(String(v.value)).replace(/'/g,"\\'")}')">${esc(String(v.value))} <span class="hint">(${v.count})</span></button>`).join('')}</div>`:'<div class="hint">no values returned</div>'}</div>`;
    }).join('');
    html += '<p class="hint" style="margin-top:6px">Click a value to set the filter, then <strong>Save</strong>. The schedule re-pulls automatically; to apply now go to <strong>Front Desk → Pull from Salesforce</strong>.</p>';
  }
  html+='</div>';
  // What the app ACTUALLY pulls right now (scoped) — compare this to Salesforce.
  if(d.appScope){
    const sc=d.appScope;
    html += `<div class="card" style="margin-top:8px"><h4 class="sans">What the app pulls right now</h4>
      <div class="pc-note">Facility value: <strong>${esc(sc.facilityValue||'')}</strong> · matched field: <strong>${esc(sc.facilityField||'')}</strong></div>
      <div class="pc-note">Scheduled stage(s): <strong>${esc(sc.scheduleStages||'')}</strong></div>`;
    html += `<div class="cmd-sub">Scheduled (open) it would show</div>`;
    html += (d.appScheduled&&d.appScheduled.length) ? d.appScheduled.map(r=>`<div class="pc-note"><strong>${esc(r.name)}</strong> · admit <strong>${esc(r.admit)}</strong> · ${esc(r.stage)}</div>`).join('') : '<div class="hint">None — check the stage name &amp; facility match Salesforce.</div>';
    html += `<div class="cmd-sub">Admitted (last 7 days) it would mark arrived</div>`;
    html += (d.appAdmitted&&d.appAdmitted.length) ? d.appAdmitted.map(r=>`<div class="pc-note">✅ <strong>${esc(r.name)}</strong> · ${esc(r.admit)} · ${esc(r.stage)}</div>`).join('') : '<div class="hint">None in the last 7 days for this facility.</div>';
    if(d.scheduledDateValues&&d.scheduledDateValues.rows&&d.scheduledDateValues.rows.length){
      const f=d.scheduledDateValues.fields;
      html += `<div class="cmd-sub">📅 Date values for scheduled people — find the column that shows TODAY for someone scheduled today, then set that as the Admit-date field</div>`;
      html += `<div style="overflow-x:auto"><table class="tbl" style="font-size:12px"><tr><th>Name</th>${f.map(x=>`<th>${esc(x)}</th>`).join('')}</tr>`;
      html += d.scheduledDateValues.rows.map(r=>`<tr><td>${esc(r.name)}</td>${f.map(x=>`<td>${esc(r[x]||'—')}</td>`).join('')}</tr>`).join('');
      html += `</table></div>`;
    }
    if(d.oppDateFields&&d.oppDateFields.length){ html += `<div class="cmd-sub">All date fields on Opportunity</div><div class="hint">${d.oppDateFields.map(esc).join(', ')}</div>`; }
    html += '</div>';
  }
  $('sf_discover').innerHTML = html;
}
function pickFacility(field, value){ if($('sf_facility_field'))$('sf_facility_field').value=field; if($('sf_facility_value'))$('sf_facility_value').value=value; $('sf_msg').textContent='Set — click Save'; window.scrollTo({top:0}); }
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
async function loadAutomation(){
  try{ const a=await api('/settings/automation');
    const set=(id,v)=>{ const el=$(id); if(el) el.value = v; };
    set('au_detox_min',a.detox_min); set('au_default_min',a.default_min); set('au_carecard_min',a.carecard_min);
    set('au_brief_hour',a.brief_hour); set('au_brief_on',a.brief_on); set('au_recovery_max',a.recovery_max); set('au_welcome_auto',a.welcome_auto); set('au_alert_detail',a.alert_detail);
    set('au_meal_on',a.meal_on); set('au_meal_hour',a.meal_hour);
    set('au_survey_alert_on',a.survey_alert_on); set('au_survey_alert_to',a.survey_alert_to);
    set('au_scorecard_on',a.scorecard_on); set('au_scorecard_day',a.scorecard_day);
    set('au_inv_check_on',a.inv_check_on); set('au_inv_check_hour',a.inv_check_hour);
    set('au_target_rounds_per_shift',a.target_rounds_per_shift); set('au_target_snacks_per_shift',a.target_snacks_per_shift);
  }catch(e){}
}
async function saveAutomation(){
  $('au_msg').textContent='Saving…';
  const body={ detox_min:$('au_detox_min').value, default_min:$('au_default_min').value, carecard_min:$('au_carecard_min').value,
    brief_hour:$('au_brief_hour').value, brief_on:$('au_brief_on').value, recovery_max:$('au_recovery_max').value, welcome_auto:$('au_welcome_auto').value, alert_detail:$('au_alert_detail').value,
    meal_on:$('au_meal_on').value, meal_hour:$('au_meal_hour').value,
    survey_alert_on:$('au_survey_alert_on').value, survey_alert_to:$('au_survey_alert_to').value,
    scorecard_on:$('au_scorecard_on').value, scorecard_day:$('au_scorecard_day').value,
    inv_check_on:$('au_inv_check_on').value, inv_check_hour:$('au_inv_check_hour').value,
    target_rounds_per_shift:($('au_target_rounds_per_shift')||{}).value, target_snacks_per_shift:($('au_target_snacks_per_shift')||{}).value };
  try{ await api('/settings/automation',{method:'POST',body:JSON.stringify(body)}); $('au_msg').textContent='✓ Saved'; }
  catch(e){ $('au_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function loadMealCount(){
  if(!$('mealPreview')) return;
  try{ const m=await api('/command/meals');
    const fb=m.feedback;
    $('mealPreview').innerHTML = `
      <div class="ret-card"><div class="n">${m.portions!=null?m.portions:m.total}</div><div class="l">Portions tomorrow</div></div>
      <div class="ret-card"><div class="n">${m.census}</div><div class="l">Current residents</div></div>
      <div class="ret-card"><div class="n">${m.welcome}</div><div class="l">Welcome meals</div></div>
      ${fb&&fb.total?`<div class="ret-card"><div class="n">${fb.likedPct}%</div><div class="l">Liked food (2d)</div></div>`:''}`;
    const d=m.dietary;
    let extra='';
    if(d&&(d.diets.length||d.allergies.length)){
      extra += `<div><strong>Dietary:</strong> ${d.diets.length?d.diets.map(x=>esc(x.label)+' ×'+x.n).join(' · '):'none flagged'}`;
      if(d.allergies.length) extra += ` <span style="color:var(--danger)">⚠ Allergies: ${d.allergies.map(x=>esc(x.label)+(x.n>1?' (×'+x.n+')':'')).join(' · ')}</span>`;
      extra += `</div>`;
    }
    if(fb&&fb.comments&&fb.comments.length) extra += `<div style="margin-top:4px"><strong>Recent food notes:</strong> ${fb.comments.slice(0,3).map(c=>esc(c.t)).join(' · ')}</div>`;
    if(m.kitchenLow&&m.kitchenLow.length) extra += `<div style="margin-top:4px"><strong>Kitchen low:</strong> ${m.kitchenLow.map(k=>`${k.status==='out'?'<span style="color:var(--danger)">OUT</span> ':''}${esc(k.name)}`).join(' · ')}</div>`;
    const sc=m.scorecard;
    if(sc&&sc.logged) extra += `<div style="margin-top:4px"><strong>Caterer (30d):</strong> ${sc.completePct!=null?`<span style="color:${sc.completePct<90?'var(--danger)':'var(--good)'}">${sc.completePct}% met standard</span>`:''}${sc.likedPct!=null?' · '+sc.likedPct+'% liked':''}${sc.shortCount?' · <span style="color:var(--danger)">'+sc.shortCount+' short</span>':''}${sc.missing.length?' · most-missed: '+sc.missing.map(x=>esc(x.group)).join(', '):''} <a href="#" class="hint" onclick="show('meals');return false">open Meals ›</a></div>`;
    if($('mealExtra')) $('mealExtra').innerHTML = extra;
    if($('meal_to')) $('meal_to').value = m.to||'';
  }catch(e){}
}
async function saveMealRecipients(){ const to=$('meal_to').value.trim(); try{ await api('/command/meals/recipients',{method:'POST',body:JSON.stringify({to})}); $('meal_msg').textContent='✓ Saved'; }catch(e){ $('meal_msg').textContent=e.message; } }
async function sendMealNow(){ $('meal_msg').textContent='Sending…'; try{ const r=await api('/command/meals/send',{method:'POST'}); $('meal_msg').textContent = r.sent?('✓ Sent to '+r.to):('Not sent — '+(r.reason||'')); }catch(e){ $('meal_msg').textContent=e.message; } }
async function loadSettings(){
  loadEmailConfig(); loadSmsConfig(); loadSfConfig(); loadAutomation(); loadApprovedPartners();
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
  loadAiConfig(st);
  const ac=st.aftercareCoordinator;
  $('acc_user').innerHTML='<option value="">— none —</option>'+st.staff.map(s=>`<option value="${s.id}" ${ac&&ac.id===s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  $('oc_email').value=st.oncallEmail||''; $('oc_phone').value=st.oncallPhone||''; if($('oc_email_alerts')) $('oc_email_alerts').checked=!!st.oncallEmailAlerts;
  $('ocStatus').textContent = `Email ${st.emailReady?'ready':'needs RESEND_API_KEY'} · SMS ${st.smsReady?'ready':'needs Twilio env vars'}.`;
  $('kc_code').value = st.kioskCode||'';
  if($('set_principle')){ try{ const p=await api('/principle/today'); $('set_principle').innerHTML=(p.options||[]).map(o=>`<option ${o===p.title?'selected':''}>${esc(o)}</option>`).join(''); }catch(e){} }
  if($('set_value')){ try{ const lv=await api('/lineup'); $('set_value').innerHTML=(lv.valueOptions||[]).map(o=>`<option ${o===lv.value?'selected':''}>${esc(o)}</option>`).join(''); }catch(e){} }
  if($('lineup_email')) $('lineup_email').value = st.lineupEmail||'';
  if($('purpose')) $('purpose').value = st.purpose||'';
  if($('lineup_reward')) $('lineup_reward').value = st.lineupReward||'';
  if($('lineup_horst')) $('lineup_horst').checked = !!st.lineupHorst;
  if($('app_live')) $('app_live').checked = !!st.appLive;
  if($('lineup_bcc')) $('lineup_bcc').checked = !!st.lineupBcc;
  if($('lineup_auto')) $('lineup_auto').checked = !!st.lineupAuto;
  if($('lineup_auto_hour')) $('lineup_auto_hour').value = st.lineupAutoHour||8;
  if($('kc_warn')) $('kc_warn').innerHTML = st.kioskCodeWeak ? '<span style="color:var(--danger);font-weight:600">⚠ This kiosk code is weak/default. Set a strong code (6+ chars) and re-enter it on the iPads — anyone on the internet can otherwise reach the kiosk.</span>' : '<span class="risk risk-low">Strong code set ✓</span>';
  try { const k = await api('/kipu/status'); $('kipuStatus').innerHTML = k.configured ? '<span class="risk risk-low">credentials set</span>' : '<span class="risk risk-warn">not configured — set Kipu env vars on your host</span>'; } catch(e){}
  try { const w = await api('/warehouse/status'); $('whStatus').innerHTML = w.configured ? '<span class="risk risk-low">credentials set</span>' : '<span class="risk risk-warn">not configured — set WH_* env vars on your host</span>'; } catch(e){}
  loadKipuTemplateConfig();
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
      + (r.error?`<div class="hint" style="color:${r.rateLimited?'var(--gold)':'var(--danger)'}">${esc(r.error)}</div>`:'');
  }catch(e){ el.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function loadAiConfig(st){
  const wrap=$('aiKeyWrap'), h=$('ai_health'); if(!wrap) return;
  // Bedrock uses AWS creds (env/instance role), not an in-app key — hide the field there.
  if(st && st.aiProvider==='bedrock'){ wrap.innerHTML=''; if(h) h.style.display='none'; return; }
  let cfg={}; try{ cfg=await api('/ai/config'); }catch(e){}
  if(h){
    if(cfg.hasKey){ h.style.background='#eaf7ee'; h.style.color='#2d7a4f';
      h.innerHTML='✓ Claude is connected'+(cfg.fromState?' (key saved in app)':' (key from server env)')+'. AI features are on.'; }
    else { h.style.background='#fdecea'; h.style.color='#b00';
      h.innerHTML='⚠ Claude is not connected — AI briefs, Care Cards, and recaps are off. Paste an Anthropic API key below to turn them on.'; }
    h.style.display='';
  }
  wrap.innerHTML='<label>Anthropic API key '
    +'<span class="hint" style="font-weight:400">(starts with sk-ant- ; get one at console.anthropic.com → API Keys)</span></label>'
    +'<div class="toolbar" style="gap:6px"><input id="ai_key" style="flex:1" placeholder="'+(cfg.hasKey?'•••••• (saved — paste to replace)':'sk-ant-…')+'"/>'
    +'<button class="btn btn-gold sans" onclick="saveAiKey()">Save key</button></div>'
    +'<div id="ai_key_msg" class="hint" style="margin-top:4px"></div>';
}
async function saveAiKey(){
  const v=$('ai_key')?$('ai_key').value.trim():''; const m=$('ai_key_msg');
  if(!v){ if(m) m.textContent='Paste a key first (or it stays unchanged).'; return; }
  if(m) m.textContent='Saving…';
  try{ await api('/ai/config',{method:'POST',body:JSON.stringify({anthropic_key:v})});
    if(m) m.textContent='Saving… running health check…';
    META.claude=true;                        // optimistic — surfaces AI buttons immediately
    await loadSettings();                     // refresh status tiles + banner
    runAiHealth();                            // verify the live connection
  }catch(e){ if(m) m.textContent='Error: '+esc(e.message); }
}
async function kipuTest(){ $('kipuResult').textContent='Testing…'; try{ const r=await api('/kipu/test',{method:'POST'}); $('kipuResult').innerHTML='<span style="color:var(--good)">✓ Connected'+(r.sampleCount!=null?' · '+r.sampleCount+' clients visible':'')+'</span>'; }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function kipuSync(){ $('kipuResult').textContent='Syncing…'; try{ const r=await api('/kipu/sync',{method:'POST'}); $('kipuResult').textContent=`Synced from Kipu: ${r.activeNow} active clients (${r.created} new, ${r.matched} updated, ${r.deactivated} no longer active, ${r.importedDischarges||0} discharges imported). Census returned ${r.total} records. Reading notes for snapshots & risk in the background…`; }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function kipuInspect(){ $('kipuResult').textContent='Inspecting Kipu fields…'; const el=$('kipuInspect'); el.style.display='none'; try{ const r=await api('/kipu/inspect',{method:'POST'}); $('kipuResult').textContent=`Census returns ${r.count} records. Fields + location/status values below — copy this to your assistant:`; el.style.display='block'; el.textContent = 'COUNT: '+r.count
  + (r.locations&&r.locations.length ? '\n\nLOCATIONS (set KIPU_LOCATION_ID to the right id):\n'+r.locations.map(l=>'  '+l.id+'  =  '+l.name).join('\n') : '')
  + '\n\nFIELDS: '+r.fields.join(', ')
  + '\n\nFACETS:\n'+Object.entries(r.facets).map(([k,v])=>'  '+k+': '+v.join(' | ')).join('\n')
  + (r.admitTimeSamples ? '\n\n===== ADMIT-TIME SAMPLES (copy this to me) =====\n'+JSON.stringify(r.admitTimeSamples,null,1) : '')
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
  try{ const r=await api('/kipu/fix-discharge-dates',{method:'POST'}); $('kipuResult').textContent=`✓ Checked ${r.checked} clients — corrected ${r.fixed} discharge dates, restored ${r.reactivated||0} still-active, filled ${r.admitTimes||0} admit times, re-rolled ${r.daysRerolled} day(s). Reopen the Command Center.`; }
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
async function kipuProbeTemplates(){
  const msg=$('kipuTplMsg'), pre=$('kipuTplResult');
  msg.textContent='Probing Kipu for evaluation templates…'; pre.style.display='none';
  try{
    const r=await api('/kipu/templates',{method:'POST'});
    if(r.ok && r.templates && r.templates.length){
      msg.textContent=`Found ${r.templates.length} templates via ${r.path}`;
      pre.style.display='block';
      pre.textContent='TEMPLATES:\n'+r.templates.map(t=>`  [${t.id}] ${t.name}${t.category?' ('+t.category+')':''}`).join('\n');
    } else {
      msg.textContent='No templates found — see details below';
      pre.style.display='block';
      pre.textContent='Tried:\n'+(r.tried||[]).map(t=>`  ${t.path}: ${t.status}${t.error?' — '+t.error:''}`).join('\n')+'\n\nThis may mean your Kipu API key needs write permissions, or the templates endpoint is different for your facility. Contact Kipu support and ask for the evaluation_template_id for your Case Management Note form.';
    }
  }catch(e){ msg.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}

async function saveKipuTemplates(){
  const msg=$('kipuTplSaveMsg');
  msg.textContent='Saving…';
  try{
    await api('/kipu/template-config',{method:'POST',body:JSON.stringify({
      cm_id:$('tplCmId').value.trim(), cm_name:$('tplCmName').value.trim(),
      handoff_id:$('tplHandoffId').value.trim(), handoff_name:$('tplHandoffName').value.trim(),
      pulse_id:$('tplPulseId').value.trim(), pulse_name:$('tplPulseName').value.trim(),
      note_id:$('tplNoteId').value.trim(), note_name:$('tplNoteName').value.trim(),
    })});
    msg.textContent='✓ Saved';
    setTimeout(()=>{ msg.textContent=''; },2500);
  }catch(e){ msg.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}

async function loadKipuTemplateConfig(){
  try{
    const r=await api('/kipu/template-config');
    if(r.cm){    if($('tplCmId')) $('tplCmId').value=r.cm.id||'';    if($('tplCmName')) $('tplCmName').value=r.cm.name||''; }
    if(r.handoff){ if($('tplHandoffId')) $('tplHandoffId').value=r.handoff.id||''; if($('tplHandoffName')) $('tplHandoffName').value=r.handoff.name||''; }
    if(r.pulse){  if($('tplPulseId')) $('tplPulseId').value=r.pulse.id||'';  if($('tplPulseName')) $('tplPulseName').value=r.pulse.name||''; }
    if(r.note){   if($('tplNoteId')) $('tplNoteId').value=r.note.id||'';   if($('tplNoteName')) $('tplNoteName').value=r.note.name||''; }
  }catch{ /* not critical */ }
}

// Push a single note to a client's Kipu chart. Call from any note form.
// noteType: 'cm' | 'handoff' | 'pulse' | 'note'
async function pushNoteToKipu(clientId, text, noteType, btnEl){
  if(!clientId || !text) return;
  const orig = btnEl ? btnEl.textContent : '';
  if(btnEl){ btnEl.disabled=true; btnEl.textContent='Pushing…'; }
  try{
    const r = await api('/kipu/push-note',{method:'POST',body:JSON.stringify({client_id:clientId,text,note_type:noteType||'note'})});
    if(btnEl){ btnEl.textContent='✓ In Kipu'; setTimeout(()=>{ btnEl.disabled=false; btnEl.textContent=orig; },3000); }
  }catch(e){
    if(btnEl){ btnEl.textContent='Failed: '+e.message.slice(0,40); setTimeout(()=>{ btnEl.disabled=false; btnEl.textContent=orig; },4000); }
  }
}

async function kipuReset(){ if(!confirm('This clears the current client list and rebuilds it from the live Kipu active census. Continue?'))return; $('kipuResult').textContent='Rebuilding roster from Kipu…'; try{ const r=await api('/kipu/reset',{method:'POST'}); $('kipuResult').textContent=`✓ Roster rebuilt: ${r.activeNow} active clients, ${r.importedDischarges||0} recent discharges imported (of ${r.total} census records). Reading every client's notes for snapshots & AMA risk in the background — check the Command Center shortly.`; }catch(e){ $('kipuResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whTestConn(){ $('whResult').textContent='Connecting… (first connect can take ~20s)'; try{ const r=await api('/warehouse/test',{method:'POST'}); $('whResult').innerHTML='<span style="color:var(--good)">✓ Connected'+(r.sampleCount!=null?' · census returns '+r.sampleCount+' rows':' (census query not confirmed yet)')+'</span>'; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whSync(){ $('whResult').textContent='Syncing census…'; try{ const r=await api('/warehouse/sync',{method:'POST'}); $('whResult').textContent=`Synced: ${r.created} new, ${r.matched} updated (of ${r.total} in warehouse).`; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whSyncNotes(){ $('whResult').textContent='Scanning recent notes for red flags…'; try{ const r=await api('/warehouse/sync-notes',{method:'POST',body:JSON.stringify({days:3})}); $('whResult').textContent=`Scanned ${r.scanned} notes · ${r.flagged} red-flagged.`; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function whCols(){ $('whResult').textContent='Reading census columns…'; try{ const r=await api('/warehouse/columns',{method:'POST'}); $('whResult').innerHTML = r.columns.length ? 'Census columns: <code style="font-size:11px">'+r.columns.map(esc).join(', ')+'</code>' : '<span class="hint">Connected, but the census query returned no rows.</span>'; }catch(e){ $('whResult').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function saveKioskCode(){ try{ await api('/settings/kiosk-code',{method:'POST',body:JSON.stringify({code:$('kc_code').value})}); alert('Kiosk code saved. Re-enter it on each iPad/kiosk to reconnect.'); if($('kc_warn')) $('kc_warn').innerHTML='<span class="risk risk-low">Strong code set ✓</span>'; }catch(e){ alert(e.message); } }
async function saveLineupEmail(){ try{ await api('/settings/lineup-email',{method:'POST',body:JSON.stringify({email:$('lineup_email').value,purpose:($('purpose')||{}).value||'',reward:($('lineup_reward')||{}).value||'',horst:$('lineup_horst')?$('lineup_horst').checked:false,appLive:$('app_live')?$('app_live').checked:false,bcc:$('lineup_bcc')?$('lineup_bcc').checked:false,auto:$('lineup_auto')?$('lineup_auto').checked:false,autoHour:($('lineup_auto_hour')||{}).value||8})}); if($('lineup_email_msg')) $('lineup_email_msg').textContent='✓ Saved'; setTimeout(()=>{if($('lineup_email_msg'))$('lineup_email_msg').textContent='';},2000); }catch(e){ if($('lineup_email_msg')) $('lineup_email_msg').textContent=e.message; } }
async function testAlert(){ const r=await api('/settings/test-alert',{method:'POST'}); alert(`Test sent. Email ${r.emailReady?'attempted':'not configured'}, SMS ${r.smsReady?'attempted':'not configured'}.`); }

/* ---- huddle mode: the start-of-shift lineup as a paced, stepped ritual ---- */
let HUDDLE_STEPS=[], HUDDLE_I=0;
async function startHuddle(){
  const [t, line, conc, hb] = await Promise.all([api('/today'), api('/lineup'), api('/concerns').catch(()=>({concerns:[]})), handbook().catch(()=>null)]);
  const atRisk = (t.attention||[]).filter(a=>a.kind==='risk');
  const welcome = (t.attention||[]).filter(a=>a.kind==='welcome');
  const leaving = (t.dischargesToday||[]);
  const wow = (line.wows||[])[0];
  const openConcern = (conc.concerns||[]).find(c=>c.status==='Open');
  const dt = new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  const shift = $('r_shift')?.value||'Day';
  const credo = 'We are here to restore dignity and save lives — Ladies and Gentlemen serving Ladies and Gentlemen.';
  HUDDLE_STEPS = [
    {k:'Why we’re here', html:`<h1>Daily Lineup</h1><div class="hint" style="color:#cfe">${dt} · ${esc(shift)} shift</div><div class="hv" style="margin-top:18px">${esc(credo)}</div>`},
    // The handbook's line-up spine: one principle · one story/standard · one safety reminder · one focus.
    ...(hb?[{k:'Today’s Principle', html:`<h2>Today’s Principle — ${hb.todays.principle.n} of 10</h2><div class="hv">${esc(hb.todays.principle.title)}</div><div class="hitem" style="margin-top:12px">${esc(hb.todays.principle.line)}</div><div class="hitem" style="margin-top:12px">Who saw this lived yesterday? Name the moment.</div>`}]:[]),
    {k:'Today’s Standard', html:`<h2>Today’s Standard — say it aloud</h2><div class="hv">${esc(line.value||'')}</div>${t.focus?.t?`<div class="hitem" style="margin-top:16px">⭐ <strong>${esc(t.focus.t)}</strong>${t.focus.g?' — '+esc(t.focus.g):''}</div>`:''}`},
    ...(hb?[{k:'Safety', html:`<h2>Today’s Safety Reminder</h2><div class="hitem">🛡 ${esc(hb.todays.safety)}</div>`}]:[]),
    {k:'The house right now', html:`<h2>The house right now</h2><div class="hitem">${t.metrics.active} active · ${t.metrics.highRisk} at risk · ${t.metrics.callsDue} aftercare calls due</div>`+
      (welcome.length?`<h3 style="margin-top:16px">Welcome today ☀</h3>`+welcome.map(w=>`<div class="hitem">${esc(w.text)}</div>`).join(''):'')+
      `<h3 style="margin-top:16px">Needs extra care ⚠</h3>`+(atRisk.length?atRisk.map(a=>`<div class="hitem">${esc(a.text)}</div>`).join(''):'<div class="hitem">All steady — touch every client, deliver every personal touch.</div>')+
      (leaving.length?`<h3 style="margin-top:16px">Leaving today — a fond farewell 🤝</h3>`+leaving.map(d=>`<div class="hitem">${esc(d.pref||d.name)}${d.discharge_status?' ('+esc(d.discharge_status)+')':''}</div>`).join(''):'')},
    {k:'Recognition', html:`<h2>Recognition — catch someone great</h2><div class="hitem">${wow?'👏 '+esc(wow.text)+(wow.by_name?' — '+esc(wow.by_name):''):'No Wow logged yet — name one now.'}</div><div class="huddle-cta"><button class="btn btn-gold sans" onclick="logWow()">✨ Name a Wow</button></div>`},
    {k:'Own one defect', html:`<h2>One defect to own</h2><div class="hitem">${openConcern?'⚑ '+esc((openConcern.pref?openConcern.pref+': ':''))+esc(openConcern.text)+' — who owns the fix?':'No open concerns. 🎉 Keep it that way.'}</div>`},
    {k:'Commit', html:`<h2>We’re aligned</h2><div class="hitem">Everyone present commits to today’s Standard. Tap below — it logs you into the lineup and counts toward your streak.</div><div class="huddle-cta"><button class="btn btn-gold sans" id="huddleCommit" onclick="huddleCommit()">✋ I’m on it</button> <span id="huddleCommitMsg" class="hint" style="color:#cfe;align-self:center"></span></div>`},
  ];
  HUDDLE_I=0; renderHuddleStep();
  $('huddle').style.display='block'; window.scrollTo(0,0);
}
function renderHuddleStep(){
  const s=HUDDLE_STEPS[HUDDLE_I]; if(!s) return;
  const dots = HUDDLE_STEPS.map((x,i)=>`<span class="hdot${i===HUDDLE_I?' on':''}"></span>`).join('');
  const next = HUDDLE_I<HUDDLE_STEPS.length-1 ? `<button class="btn btn-gold sans" onclick="huddleNav(1)">Next →</button>` : `<button class="btn btn-gold sans" onclick="closeHuddle()">Done ✓</button>`;
  const nav = `<div class="huddle-nav"><button class="btn btn-ghost sans" onclick="huddleNav(-1)" ${HUDDLE_I===0?'disabled':''}>← Back</button><div class="hdots">${dots}</div>${next}</div>`;
  $('huddleBody').innerHTML = `<div class="huddle-step-k">${HUDDLE_I+1} / ${HUDDLE_STEPS.length} · ${esc(s.k)}</div>${s.html}${nav}`;
}
function huddleNav(d){ HUDDLE_I=Math.max(0,Math.min(HUDDLE_STEPS.length-1,HUDDLE_I+d)); renderHuddleStep(); }
async function huddleCommit(){
  try{ await api('/lineup-log',{method:'POST',body:JSON.stringify({shift:$('r_shift')?.value||'Day'})});
    await api('/focus',{method:'POST',body:JSON.stringify({})});
    const f=await api('/focus'); $('huddleCommitMsg').textContent=`✓ ${f.participants} on it today`;
    const b=$('huddleCommit'); if(b){ b.textContent='✓ On it'; b.disabled=true; } }
  catch(e){ $('huddleCommitMsg').textContent=e.message; }
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
async function debriefDischarges(redo){
  try{ const r=await api('/debrief-discharges'+(redo?'?redo=1':''),{method:'POST'});
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
  try{ const { discharges, docGap, total } = await api('/discharge-learnings');
    if(!discharges.length){ $('learnCard').style.display='none'; return; }
    $('learnCard').style.display='block';
    const banner = docGap ? `<div class="pc-note" style="color:#a60;margin-bottom:6px">⚠ ${docGap} of ${total} discharges had <strong>no in-stay documentation</strong> — only intake paperwork (or nothing) was in the chart, so their reason couldn’t be determined. These need progress/discharge notes charted in Kipu.</div>` : '';
    $('dischargeLearnings').innerHTML = banner + discharges.map(d=>{
      const ama = d.discharge_status==='AMA';
      const gap = !!d.discharge_doc_gap;
      return `<div class="todo"><div class="txt">
        <span class="risk ${ama?'risk-high':'risk-low'}">${esc(d.discharge_status||'Discharged')}</span>
        ${gap?'<span class="risk risk-elev" title="No progress or discharge notes were in the chart — only intake paperwork">⚠ No in-stay notes</span> ':''}
        <strong>${esc(d.pref||d.name||'')}</strong> <span class="hint">· ${esc(d.discharge_date||'')}</span>
        ${d.discharge_reason?`<div class="pc-note">Why: ${esc(d.discharge_reason)}</div>`:''}
        ${d.discharge_evidence?`<div class="pc-note" style="font-style:italic">Based on: ${esc(d.discharge_evidence)}</div>`:''}
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
      <div class="care-scale" style="flex-wrap:wrap">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="care-btn" onclick="setCare(${c.id},${n})">${n}</button>`).join('')}<span class="hint" style="margin-left:8px">1 = not at all · 10 = deeply</span></div>
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
async function addHandoff(clientId, btnEl){
  const inp=$('ho_'+clientId); if(!inp.value.trim())return;
  const text = inp.value;
  await api('/handoffs',{method:'POST',body:JSON.stringify({date:$('r_date').value,shift:$('r_shift').value,client_id:clientId,note:text})});
  loadPlaybook();
  // Silently attempt to push to Kipu if templates are configured.
  pushNoteToKipu(clientId, text, 'handoff', null).catch(()=>{});
}

/* ---- outcomes ---- */
async function loadOutcomes(){
  const o = await api('/outcomes');
  $('outKpis').innerHTML = `
    <div class="ret-card ${o.ama?'rc-high':''}"><div class="n">${o.amaRate}%</div><div class="l">AMA rate</div></div>
    <div class="ret-card"><div class="n">${o.completionRate}%</div><div class="l">Completion rate</div></div>
    <div class="ret-card"><div class="n">${o.feltCare!=null?o.feltCare:'—'}</div><div class="l">Felt-care (avg/10, 30d)</div></div>
    <div class="ret-card ${o.openConcerns?'rc-warn':''}"><div class="n">${o.openConcerns}</div><div class="l">Open concerns</div></div>
    <div class="ret-card"><div class="n">${o.delights30}</div><div class="l">Delights (30d)</div></div>
    <div class="ret-card ${survCls(pct10(o.surveys?.recommend.avg))}"><div class="n">${o.surveys?.recommend.avg!=null?pct10(o.surveys.recommend.avg)+'%':'—'}</div><div class="l">Recommend (survey)</div></div>
    <div class="ret-card ${survCls(pct10(o.surveys?.food.avg))}"><div class="n">${o.surveys?.food.avg!=null?pct10(o.surveys.food.avg)+'%':'—'}</div><div class="l">Food satisfaction (survey)</div></div>
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
/* ---- Staff messaging ---- */
let MSG_CHANNEL=null, MSG_STAFF=[], MSG_POLL=null;
async function loadMessages(){
  await loadMsgThreads();
  if(MSG_POLL) clearInterval(MSG_POLL);
  MSG_POLL=setInterval(()=>{ if(document.getElementById('messages').classList.contains('active')){ loadMsgThreads(); if(MSG_CHANNEL) openChannel(MSG_CHANNEL,true); } else { clearInterval(MSG_POLL); } }, 12000);
}
async function loadMsgThreads(){
  let d; try{ d=await api('/messages/threads'); }catch(e){ $('msgThreads').innerHTML='<div class="hint" style="padding:10px">'+esc(e.message)+'</div>'; return; }
  MSG_STAFF=d.staff;
  const row=t=>`<button class="msg-thread ${t.channel===MSG_CHANNEL?'on':''}" onclick="openChannel('${t.channel}')">
    <div class="nm">${esc(t.name)} ${t.unread?`<span class="badge-danger">${t.unread}</span>`:''}</div>
    <div class="pv">${t.last?esc((t.last.by?t.last.by.split(' ')[0]+': ':'')+t.last.body):'No messages yet'}</div></button>`;
  $('msgThreads').innerHTML = d.threads.map(row).join('') +
    `<button class="msg-thread" onclick="newDm()"><div class="nm" style="color:var(--gold)">＋ New message</div><div class="pv">Message a teammate</div></button>`;
  updateMsgBadge(d.threads.reduce((a,t)=>a+(t.unread||0),0));
}
function newDm(){
  const opts=MSG_STAFF.map((s,i)=>`${i+1}. ${s.name} (${s.job_role||''})`).join('\n');
  const p=prompt('Message which teammate?\n\n'+opts+'\n\nEnter a number:'); if(p===null) return;
  const s=MSG_STAFF[parseInt(p,10)-1]; if(!s) return;
  openChannel('dm:new:'+s.id);
}
async function openChannel(channel, quiet){
  if(channel.startsWith('dm:new:')){ MSG_CHANNEL=channel; const sid=channel.split(':')[2]; const s=MSG_STAFF.find(x=>String(x.id)===String(sid));
    $('msgHead').textContent=(s?s.name:'New message'); $('msgBody').innerHTML='<div class="hint" style="padding:12px">Say hi 👋</div>'; $('msgCompose').style.display='flex'; $('msgInput').dataset.to=sid; $('msgInput').focus();
    document.querySelectorAll('.msg-thread').forEach(b=>b.classList.remove('on')); return;
  }
  MSG_CHANNEL=channel; $('msgInput')&&($('msgInput').dataset.to='');
  let d; try{ d=await api('/messages?channel='+encodeURIComponent(channel)); }catch(e){ $('msgBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const t=(await api('/messages/threads')).threads.find(x=>x.channel===channel);
  $('msgHead').textContent = t?t.name:(channel==='team'?'📣 Team':'Conversation');
  const atBottom=true;
  $('msgBody').innerHTML = d.messages.length ? d.messages.map(m=>`<div class="msg-row ${m.mine?'me':'them'}">${m.mine?'':`<div class="meta">${esc(m.by||'')}</div>`}${esc(m.body)}<div class="meta" style="text-align:right">${esc(m.at.slice(11))}</div></div>`).join('') : '<div class="hint" style="padding:12px">No messages yet — start the conversation.</div>';
  $('msgCompose').style.display='flex';
  $('msgBody').scrollTop=$('msgBody').scrollHeight;
  if(!quiet){ document.querySelectorAll('.msg-thread').forEach(b=>b.classList.toggle('on', b.getAttribute('onclick')?.includes("'"+channel+"'"))); $('msgInput').focus(); }
  loadMsgThreads();
}
async function sendMessage(){
  const inp=$('msgInput'); const body=inp.value.trim(); if(!body||!MSG_CHANNEL) return;
  const to=inp.dataset.to; inp.value='';
  try{ const r=await api('/messages',{method:'POST',body:JSON.stringify(to?{to,body}:{channel:MSG_CHANNEL,body})}); openChannel(r.channel); }
  catch(e){ inp.value=body; alert(e.message); }
}
function updateMsgBadge(n){ const b=$('msgBadge'); if(!b) return; if(n>0){ b.textContent=n; b.style.display=''; } else { b.textContent=''; b.style.display='none'; } }
async function pollMsgUnread(){ try{ const {unread}=await api('/messages/unread'); updateMsgBadge(unread); }catch(e){} }
function updateWpBadge(n){ const b=$('wpBadge'); if(!b) return; if(n>0){ b.textContent=n; b.style.display=''; b.title=n+' item(s) need attention — open Staff Voice or a morale/recognition nudge'; } else { b.textContent=''; b.style.display='none'; } }
async function pollWpBadge(){ try{ const {count}=await api('/workplace/attention'); updateWpBadge(count); }catch(e){} }

/* ---- Scan Rounds: QR-verified physical rounds ---- */
function scanBanner(msg, ok){
  const el=$('scanMsg'); if(!el) return;
  el.style.display=''; el.style.padding='10px 14px'; el.style.borderRadius='8px'; el.style.fontSize='15px';
  el.style.background= ok?'#eaf7ee':'#fdecea'; el.style.color= ok?'#2d7a4f':'#b00'; el.innerHTML=msg;
  clearTimeout(scanBanner._t); scanBanner._t=setTimeout(()=>{ el.style.display='none'; }, 6000);
}
async function doRoundScan(code, opts){
  opts=opts||{};
  try{ const r=await api('/round-scan',{method:'POST',body:JSON.stringify({code,manual:!!opts.manual,photo:opts.photo||null})});
    const who = r.by ? ` <span class="hint">— ${esc(r.by)}</span>` : '';
    if(r.flagged) scanBanner(`⚠ Logged, but FLAGGED: ${esc(r.reason||'suspicious pattern')}. A leader will review the photo.`, false);
    else scanBanner(`✓ <strong>${esc(r.label)}</strong> scanned${r.clients?` · ${r.clients} client check${r.clients>1?'s':''} logged`:''}${who}`, true);
    if(navigator.vibrate) navigator.vibrate(80);
    renderScanStatus(r);
    if($('roundscan')&&$('roundscan').classList.contains('active')){ loadScanCoverage(); if(ME&&ME.role==='admin') loadScanReview(); }
  }catch(e){ scanBanner('✗ '+esc(e.message), false); }
}
// After a room scan, tap each client's condition — logged straight to the round.
function renderScanStatus(r){
  const sp=$('scanStatus'); if(!sp) return;
  if(!(r.clientList&&r.clientList.length)){ sp.style.display='none'; sp.innerHTML=''; return; }
  const opts=[['asleep','😴 Asleep'],['awake','🙂 Awake'],['good','✅ Good'],['distressed','😣 Distressed'],['needs_help','🆘 Needs help'],['out','🚪 Out'],['refused','🚫 Refused']];
  sp.style.display='';
  sp.innerHTML=`<div class="card" style="margin-top:10px;border-left:4px solid var(--gold)"><h3 style="margin:0 0 4px">${esc(r.label)} — how is each client?</h3><p class="sub sans" style="margin:0">Tap a status for everyone in the room.</p>
    ${r.clientList.map(c=>`<div id="sst_${c.id}" style="padding:9px 0;border-top:1px solid var(--line)"><strong>${esc(c.name)}</strong>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${opts.map(([k,l])=>`<button class="btn btn-ghost btn-sm sans" onclick="roundStatus(${c.id},'${k}',${JSON.stringify(c.name).replace(/"/g,'&quot;')})">${l}</button>`).join('')}</div></div>`).join('')}</div>`;
}
async function roundStatus(cid,key,name){ try{ await api('/rounds/status',{method:'POST',body:JSON.stringify({client_id:cid,status:key})}); const row=$('sst_'+cid); if(row) row.innerHTML=`<strong>${esc(name)}</strong> <span class="risk ${key==='needs_help'||key==='distressed'?'risk-high':'risk-low'}">✓ ${esc(key.replace('_',' '))}</span>`; if(navigator.vibrate) navigator.vibrate(40); }catch(e){ alert(e.message); } }
let SCAN_STREAM=null, SCAN_RAF=null;
async function startScanner(){
  if(typeof jsQR!=='function'){ scanBanner('Scanner library not loaded — reload the page and try again.', false); return; }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ scanBanner('This device/browser has no camera access. Use a different browser or type the code.', false); return; }
  let stream;
  try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}}); }
  catch(e){ scanBanner('Camera permission denied or unavailable: '+esc(e.message), false); return; }
  SCAN_STREAM=stream;
  const ov=document.createElement('div'); ov.id='scanOverlay'; ov.style.cssText='position:fixed;inset:0;background:#000;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';
  const vid=document.createElement('video'); vid.autoplay=true; vid.muted=true; vid.playsInline=true; vid.setAttribute('playsinline',''); vid.style.cssText='max-width:100%;max-height:70vh;border-radius:12px';
  vid.srcObject=stream;
  const tip=document.createElement('div'); tip.className='sans'; tip.style.cssText='color:#fff;margin:14px 0;font-size:16px;text-align:center'; tip.textContent='Point the camera at the room/area QR';
  const btn=document.createElement('button'); btn.textContent='✕ Close'; btn.className='btn btn-gold sans';
  btn.onclick=stopScanner;
  ov.appendChild(vid); ov.appendChild(tip); ov.appendChild(btn); document.body.appendChild(ov);
  await vid.play().catch(()=>{});
  const cv=document.createElement('canvas'); const cx=cv.getContext('2d',{willReadFrequently:true});
  const tick=()=>{
    if(!SCAN_STREAM) return;
    if(vid.readyState===vid.HAVE_ENOUGH_DATA){
      cv.width=vid.videoWidth; cv.height=vid.videoHeight; cx.drawImage(vid,0,0,cv.width,cv.height);
      try{ const img=cx.getImageData(0,0,cv.width,cv.height); const q=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
        if(q&&q.data){
          // Grab a small JPEG of what the camera saw, for paper-vs-phone review.
          let photo=null;
          try{ const sc=document.createElement('canvas'); const W=360, scale=W/cv.width; sc.width=W; sc.height=Math.round(cv.height*scale);
            sc.getContext('2d').drawImage(cv,0,0,sc.width,sc.height); photo=sc.toDataURL('image/jpeg',0.5); }catch(e){}
          stopScanner(); doRoundScan(q.data,{photo}); return;
        }
      }catch(e){}
    }
    SCAN_RAF=requestAnimationFrame(tick);
  };
  SCAN_RAF=requestAnimationFrame(tick);
}
function stopScanner(){ if(SCAN_RAF) cancelAnimationFrame(SCAN_RAF); SCAN_RAF=null; if(SCAN_STREAM){ SCAN_STREAM.getTracks().forEach(t=>t.stop()); SCAN_STREAM=null; } const ov=$('scanOverlay'); if(ov) ov.remove(); }
async function loadRoundScan(){
  if($('scanWho')&&ME) $('scanWho').innerHTML = `Scanning as <strong>${esc(ME.name)}</strong>${ME.job_role?' · '+esc(ME.job_role):''} — every scan is logged under your name. <a href="#" class="hint" onclick="doLogout();return false">Not you? Switch user</a>`;
  loadScanCoverage();
  if(ME&&ME.role==='admin'){ loadScanScorecard(); loadScanReview(); loadScanPoints(); loadRoomHours(); }
}
async function loadScanReview(){
  const el=$('scanReview'); if(!el) return;
  let d; try{ d=await api('/rounds/scan-review?photos=1'); }catch(e){ el.innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if(!d.scans.length){ el.innerHTML='<div class="empty">No scan photos yet. They appear here as staff scan with the in-app camera (typed-code entries have no photo).</div>'; return; }
  el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px">'+d.scans.map(s=>`
    <div style="width:150px;border:1px solid ${s.flagged?'var(--danger)':'var(--line)'};border-radius:10px;padding:6px;text-align:center">
      <img src="/api/rounds/scan-photo/${s.id}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:6px;background:#eee"/>
      <div class="sans" style="font-size:12px;margin-top:4px"><strong>${esc(s.label||'?')}</strong></div>
      <div class="hint" style="font-size:11px">${esc(s.by_name||'')} · ${esc((s.ts||'').slice(5,16))}</div>
      ${s.flagged?`<div class="risk risk-high" style="margin-top:3px">flagged</div><button class="btn btn-ghost btn-sm sans" onclick="flagScan(${s.id},0)">Clear</button>`
        :`<button class="btn btn-ghost btn-sm sans" style="color:var(--danger);margin-top:3px" onclick="flagScan(${s.id},1)">⚠ Phone screen</button>`}
    </div>`).join('')+'</div>';
}
async function flagScan(id,on){ try{ await api('/rounds/scan-flag',{method:'POST',body:JSON.stringify({id,flagged:on})}); loadScanReview(); loadScanScorecard(); }catch(e){ alert(e.message); } }
async function loadScanCoverage(){
  let d; try{ d=await api('/rounds/coverage'); }catch(e){ if($('scanCoverage'))$('scanCoverage').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if($('scanCoverageKpis')) $('scanCoverageKpis').innerHTML =
    `<div class="ret-card ${d.overdue?'rc-high':''}"><div class="n">${d.covered}/${d.expectedNow}</div><div class="l">Covered now (last ${d.interval}m)</div></div>`+
    `<div class="ret-card ${d.overdue?'rc-high':''}"><div class="n">${d.overdue}</div><div class="l">Overdue — walk these</div></div>`+
    `<div class="ret-card"><div class="n">${d.offHours}</div><div class="l">Off-hours (not expected now)</div></div>`;
  if(!d.rows.length){ $('scanCoverage').innerHTML='<div class="empty">No scan points yet. An admin can auto-create them under “Manage scan points”.</div>'; return; }
  const status=(r)=> !r.expectedNow ? '<span class="hint">off-hours ('+esc(r.window)+')</span>'
    : r.overdue ? '<span class="risk risk-high">'+(r.minsSince==null?'never scanned':r.minsSince+'m ago — OVERDUE')+'</span>'
    : '<span class="risk risk-low">'+r.minsSince+'m ago ✓</span>';
  $('scanCoverage').innerHTML = '<table class="tbl" style="width:100%"><tr><th>Point</th><th>Area</th><th>Window</th><th>Status</th><th>By</th></tr>'+
    d.rows.map(r=>`<tr${r.expectedNow?'':' style="opacity:.55"'}><td><strong>${esc(r.label)}</strong></td><td class="hint">${esc(r.area)}</td><td class="hint">${esc(r.window)}</td>
      <td>${status(r)}</td><td class="hint">${esc(r.lastBy||'—')}</td></tr>`).join('')+'</table>';
}
async function loadScanScorecard(){
  const days=$('scanScoreDays')?$('scanScoreDays').value:7;
  let d; try{ d=await api('/rounds/scorecard?days='+days); }catch(e){ return; }
  const c = d.compliancePct;
  let html = `<div class="ret-cards"><div class="ret-card ${c!=null&&c<80?'rc-warn':''}"><div class="n">${c==null?'—':c+'%'}</div><div class="l">Facility compliance (${d.days}d)</div></div>`+
    `<div class="ret-card"><div class="n">${d.totalScans}</div><div class="l">Scans logged</div></div>`+
    `<div class="ret-card"><div class="n">${d.activePoints}</div><div class="l">Active points</div></div></div>`;
  html += d.people.length ? '<table class="tbl" style="width:100%;margin-top:10px"><tr><th>Staff</th><th>Scans</th><th>Points covered</th><th>⚠ Flagged</th><th>Last</th></tr>'+
    d.people.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.scans}</td><td>${p.points}</td><td>${p.flagged?'<span class="risk risk-high">'+p.flagged+'</span>':'0'}</td><td class="hint">${esc((p.last||'').slice(0,16))}</td></tr>`).join('')+'</table>'
    : '<div class="empty" style="margin-top:8px">No scans logged in this window yet.</div>';
  html += `<p class="hint" style="margin-top:6px">Compliance estimate = scans ÷ (active points × cycles of ${d.interval}m). Use scan counts as the accountability signal; review context before any discipline.</p>`;
  $('scanScorecard').innerHTML = html;
}
async function loadScanPoints(){
  let d; try{ d=await api('/scan-points'); }catch(e){ return; }
  if($('scanInterval')&&!$('scanInterval').value) $('scanInterval').value=d.interval;
  const hrSel=(pid,which,val)=>`<select id="w_${which}_${pid}" onchange="setScanWindow(${pid})" class="sans" style="width:64px">${['',...Array.from({length:24},(_,i)=>i)].map(h=>`<option value="${h}" ${String(val??'')===String(h)?'selected':''}>${h===''?'24/7':(h+':00')}</option>`).join('')}</select>`;
  $('scanPointsList').innerHTML = d.points.length ? '<table class="tbl" style="width:100%"><tr><th>Label</th><th>Area</th><th>Room</th><th>From</th><th>To</th><th>Active</th><th>Code</th><th></th></tr>'+
    d.points.map(p=>`<tr${p.active?'':' style="opacity:.5"'} data-pid="${p.id}"><td>${esc(p.label)}</td><td>${esc(p.area)}</td><td>${esc(p.room||'')}</td>
      <td>${hrSel(p.id,'from', p.active_from)}</td><td>${hrSel(p.id,'to', p.active_to)}</td>
      <td style="text-align:center"><input type="checkbox" ${p.active?'checked':''} onchange="toggleScanPoint(${p.id},this.checked)"/></td>
      <td class="hint"><code>${esc(p.code)}</code></td>
      <td><button class="btn btn-ghost btn-sm sans" style="color:var(--danger)" onclick="delScanPoint(${p.id},'${esc(p.label).replace(/'/g,"")}')">Delete</button></td></tr>`).join('')+'</table><p class="hint" style="margin-top:4px">From/To = the daily window a point must be scanned (24/7 = always). Rooms default to your room hours; common areas 24/7.</p>'
    : '<div class="empty">No scan points yet.</div>';
}
async function addScanPoint(){
  const label=$('newScanLabel').value.trim(); if(!label){return;}
  const area=$('newScanArea').value, room=$('newScanRoom').value.trim();
  try{ await api('/scan-points',{method:'POST',body:JSON.stringify({label,area,room})}); $('newScanLabel').value='';$('newScanRoom').value=''; loadScanPoints(); }catch(e){ alert(e.message); }
}
async function toggleScanPoint(id,active){ try{ await api('/scan-points',{method:'POST',body:JSON.stringify({id,active:active?1:0})}); }catch(e){ alert(e.message); } }
async function setScanWindow(id){ const f=$('w_from_'+id), t=$('w_to_'+id); try{ await api('/scan-points',{method:'POST',body:JSON.stringify({id,active_from:f?f.value:'',active_to:t?t.value:''})}); loadScanCoverage(); }catch(e){ alert(e.message); } }
async function saveRoomHours(applyAll){
  const f=+($('roomFrom')?$('roomFrom').value:8), t=+($('roomTo')?$('roomTo').value:22);
  try{ const r=await api('/rounds/room-hours',{method:'POST',body:JSON.stringify({from:f,to:t,applyAll:!!applyAll})});
    $('roomHrMsg').textContent = applyAll?('✓ Applied to '+r.applied+' room point(s)'):'✓ Saved (applies to new rooms)'; loadScanPoints(); loadScanCoverage();
  }catch(e){ $('roomHrMsg').textContent=e.message; }
}
async function loadRoomHours(){ try{ const r=await api('/rounds/room-hours'); if($('roomFrom'))$('roomFrom').value=r.from; if($('roomTo'))$('roomTo').value=r.to; }catch(e){} }
async function delScanPoint(id,label){ if(!confirm('Delete scan point "'+label+'"? Its QR will stop working.')) return; try{ await api('/scan-points',{method:'POST',body:JSON.stringify({id,delete:true})}); loadScanPoints(); }catch(e){ alert(e.message); } }
async function seedScanPoints(){ try{ const r=await api('/scan-points/seed',{method:'POST'}); alert('Added '+r.added+' scan point(s).'); loadScanPoints(); loadScanCoverage(); }catch(e){ alert(e.message); } }
async function saveScanInterval(){ const m=+$('scanInterval').value||60; try{ await api('/rounds/sweep-interval',{method:'POST',body:JSON.stringify({minutes:m})}); $('scanIntMsg').textContent='✓ Saved'; loadScanCoverage(); }catch(e){ $('scanIntMsg').textContent=e.message; } }
async function printScanCodes(){
  let d; try{ d=await api('/scan-points'); }catch(e){ alert(e.message); return; }
  const pts=d.points.filter(p=>p.active);
  if(!pts.length){ alert('No active scan points to print.'); return; }
  const w=window.open('','_blank');
  w.document.write('<html><head><title>Armada — Rounds QR codes</title><style>body{font-family:Georgia,serif;margin:0}.g{display:flex;flex-wrap:wrap;gap:0}.q{width:50%;box-sizing:border-box;padding:24px;text-align:center;page-break-inside:avoid;border:1px dashed #ccc}.q img{width:240px;height:240px}.q h2{margin:8px 0 2px}.q .c{color:#888;font-size:12px;font-family:monospace}.q .i{color:#555;font-size:13px;margin-top:4px}</style></head><body><div class="g">'+
    pts.map(p=>`<div class="q"><h2>${esc(p.label)}</h2><img src="/api/scan-points/${p.id}/qr.svg" alt=""/><div class="c">${esc(p.code)}</div><div class="i">Mount at the FARTHEST reachable point of this ${p.area==='Room'?'room':'area'}.</div></div>`).join('')+
    '</div><script>setTimeout(()=>window.print(),600)<\/script></body></html>');
  w.document.close();
}
/* ---- Arrival Tasks: per-role on-arrival checklist per admit ---- */
async function loadArrivalTasks(){
  let d; try{ d=await api('/arrival/board'); }catch(e){ $('arrBoard').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if(!d.admits.length){ $('arrBoard').innerHTML='<div class="hint">No new admits in the last 5 days.</div>'; $('arrDetail').innerHTML=''; return; }
  $('arrBoard').innerHTML = '<table class="tbl"><tr><th>New admit</th><th>Arrival progress</th><th>By role</th><th></th></tr>'+d.admits.map(a=>`<tr>
    <td><strong>${esc(a.name)}</strong>${a.room?' · '+esc(a.room):''}<div class="hint">admit ${esc(a.admit)}</div></td>
    <td style="min-width:120px"><div style="display:flex;align-items:center;gap:6px"><div class="res-track" style="flex:1"><div class="res-fill ${a.pct<100?'':''}" style="width:${a.pct}%"></div></div><span class="hint">${a.pct}%</span></div></td>
    <td class="hint">${(arrIsMgmt()?a.roles:a.roles.filter(r=>roleMatchesMe(r.role))).map(r=>`${esc(r.role.split(' ')[0])} ${r.done}/${r.total}`).join(' · ')||'—'}</td>
    <td><button class="btn btn-gold btn-sm sans" onclick="openArrival(${a.id})">Open</button></td>
  </tr>`).join('')+'</table>';
}
// Management (sees every role's arrival tasks) vs a worker (sees only their own).
const ARR_MGMT_ROLES = ['Executive Director','Clinical Director','Director of Operations'];
function arrIsMgmt(){ return !!(ME && (ME.role==='admin' || ARR_MGMT_ROLES.includes(ME.job_role))); }
function roleMatchesMe(role){
  const jr=((ME&&ME.job_role)||'').toLowerCase(); const r=(role||'').toLowerCase(); if(!jr) return false;
  return ['nurse','bht','tech','therapist','case','front','desk','kitchen','housekeep','provider','medical'].some(k=>r.includes(k)&&jr.includes(k));
}
let ARR_CID=null, ARR_SHOWALL=false;
function openArrival(id){ ARR_CID=id; ARR_SHOWALL=false; renderArrivalChecklist(); }
async function renderArrivalChecklist(){
  const id=ARR_CID; if(id==null) return;
  let d; try{ d=await api('/arrival/checklist/'+id); }catch(e){ $('arrDetail').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const mgmt=arrIsMgmt();
  const myRoles=d.roles.filter(r=>roleMatchesMe(r.role));
  const showAll = mgmt || ARR_SHOWALL || !myRoles.length;   // managers (or no role match) see the full checklist
  const roles = showAll ? d.roles : myRoles;
  const allItems=d.roles.flatMap(r=>r.items||[]); const overall=allItems.length?Math.round(allItems.filter(i=>i.done).length/allItems.length*100):0;
  // "Done" should reflect THIS person's own arrival tasks — a front-desk worker is
  // finished when their items are done, even if other roles' items are still open.
  const myItems=myRoles.flatMap(r=>r.items||[]);
  const worker=!mgmt && !showAll && myItems.length>0;
  const scopeItems=worker?myItems:allItems;
  const scopePct=scopeItems.length?Math.round(scopeItems.filter(i=>i.done).length/scopeItems.length*100):0;
  const allDone=scopePct===100;
  const itemRow=(i)=>{
    if(i.gated){
      // Belongings — the critical one. No checkbox; only the signed form completes it.
      return `<div style="display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border:1.5px solid ${i.done?'var(--line)':'#e3b3ac'};border-radius:12px;margin:8px 0;background:${i.done?'#f3f8f4':'#fff8f7'}">
        <span style="font-size:22px;margin-top:1px;flex:none">${i.done?'✅':'🔒'}</span>
        <div style="flex:1"><span style="font-size:16px;line-height:1.35;${i.done?'color:#2d7a4f':'font-weight:600'}">${esc(i.label)}</span>
          <div class="hint" style="margin-top:3px">${i.done?'✓ Belongings form completed & signed':'Required — fill the signed Belongings form. This can’t be checked off by hand.'}</div>
          ${i.done?'':`<button class="btn btn-gold btn-sm sans no-print" style="margin-top:8px" onclick="openBelongings(${d.client.id})">📦 Fill belongings form</button>`}</div></div>`;
    }
    return `<label style="display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border:1px solid var(--line);border-radius:12px;margin:8px 0;cursor:pointer;background:${i.done?'#f3f8f4':'#fff'}">
      <input type="checkbox" ${i.done?'checked':''} onchange="toggleArrival(${d.client.id},${i.id},this.checked)" style="width:22px;height:22px;margin-top:1px;flex:none;accent-color:var(--gold)"/>
      <span style="font-size:16px;line-height:1.35;${i.done?'color:#2d7a4f;text-decoration:line-through':''}">${esc(i.label)}${i.done&&i.by?`<br><span class="hint" style="text-decoration:none">✓ ${esc(i.by)}${i.at?' · '+esc(i.at):''}</span>`:''}</span></label>`;
  };
  const roleBlock=(r)=>{ const done=r.items.filter(i=>i.done).length; const mine=roleMatchesMe(r.role); const pct=r.items.length?Math.round(done/r.items.length*100):0;
    return `<div style="margin:16px 0 4px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><strong class="sans" style="font-size:15px">${esc(r.role)}</strong>${mine?'<span class="badge">your role</span>':''}<span class="hint" style="margin-left:auto">${done}/${r.items.length}</span></div>
      <div class="res-track" style="height:5px;margin-bottom:6px"><div class="res-fill" style="width:${pct}%"></div></div>
      ${r.items.length?r.items.map(itemRow).join(''):'<div class="pc-note">No items for this role.</div>'}</div>`; };
  const toggleBtn = (!mgmt && myRoles.length && d.roles.length>myRoles.length)
    ? (ARR_SHOWALL ? `<button class="btn btn-ghost btn-sm sans no-print" onclick="ARR_SHOWALL=false;renderArrivalChecklist()">Show just my role</button>`
                   : `<button class="btn btn-ghost btn-sm sans no-print" onclick="ARR_SHOWALL=true;renderArrivalChecklist()">Show all roles</button>`) : '';
  $('arrDetail').innerHTML = `<div class="card">
    <div class="cmd-hero-row"><div><h3 style="margin:0">${esc(d.client.name)}${d.client.room?' · '+esc(d.client.room):''}</h3>
      <p class="sub sans" style="margin:2px 0 0">Arrival checklist · admitted ${esc(d.client.admit)} · ${worker?`<strong>your tasks ${scopePct}%</strong> · overall ${overall}%`:`<strong>${overall}% complete</strong>`}</p></div>
      <div class="toolbar" style="margin:0;gap:8px">${canSeeView('property')?`<button class="btn btn-gold btn-sm sans no-print" onclick="openBelongings(${d.client.id})">📦 Belongings form</button>`:''}${toggleBtn}<button class="btn btn-primary btn-sm sans no-print" onclick="closeArrival()">${allDone?'✓ Done — back':'Done — back to arrivals'}</button></div></div>
    <div class="res-track" style="height:7px;margin:8px 0 2px"><div class="res-fill" style="width:${worker?scopePct:overall}%"></div></div>
    ${(!mgmt && !myRoles.length)?'<div class="pc-note" style="margin-top:8px">Nothing assigned to your role for this admit — showing the full checklist.</div>':''}
    ${(allDone && worker)?`<div class="pc-note" style="margin-top:8px;color:var(--good);font-weight:600">✅ All your arrival tasks for ${esc((d.client.name||'').split(' ')[0]||'this client')} are done — tap Done to head back.</div>`:''}
    ${roles.map(roleBlock).join('')}
    <div class="toolbar no-print" style="margin-top:14px"><button class="btn ${allDone?'btn-primary':'btn-ghost'} sans" style="${allDone?'font-size:16px;padding:12px 22px':''}" onclick="closeArrival()">${allDone?'✓ Done — back to arrivals':'← Back to arrivals'}</button></div>
  </div>`;
  $('arrDetail').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeArrival(){ ARR_CID=null; const el=$('arrDetail'); if(el) el.innerHTML=''; loadArrivalTasks(); const b=$('arrBoard'); if(b) b.scrollIntoView({behavior:'smooth',block:'start'}); }
// Jump straight to a client's belongings (chain-of-custody) form.
function openBelongings(cid){ show('property'); setTimeout(()=>openProperty(cid), 30); }
async function toggleArrival(cid,iid,done){ try{ await api('/arrival/check',{method:'POST',body:JSON.stringify({client_id:cid,item_id:iid,done})}); renderArrivalChecklist(); loadArrivalTasks(); }catch(e){ alert(e.message); } }
async function loadArrivalTemplate(){
  let d; try{ d=await api('/arrival/template'); }catch(e){ return; }
  const byRole={}; d.items.filter(i=>i.active).forEach(i=>{ (byRole[i.role]=byRole[i.role]||[]).push(i); });
  $('arrTemplate').innerHTML = d.roles.map(role=>`<div style="margin-bottom:10px"><strong class="sans">${esc(role)}</strong>
    ${(byRole[role]||[]).map(i=>`<div class="todo"><div class="txt">${esc(i.label)}</div><button class="btn btn-ghost btn-sm sans" onclick="delArrivalItem(${i.id})">Remove</button></div>`).join('')}
    <div class="toolbar" style="justify-content:flex-start;margin-top:4px"><input id="arr_new_${esc(role).replace(/[^a-z]/gi,'')}" placeholder="Add an item for ${esc(role)}…" style="min-width:240px"/><button class="btn btn-ghost btn-sm sans" onclick="addArrivalItem('${esc(role).replace(/'/g,"\\'")}')">+ Add</button></div></div>`).join('');
}
async function addArrivalItem(role){ const inp=$('arr_new_'+role.replace(/[^a-z]/gi,'')); const label=inp?inp.value.trim():''; if(!label)return; try{ await api('/arrival/template',{method:'POST',body:JSON.stringify({role,label})}); loadArrivalTemplate(); }catch(e){ alert(e.message); } }
async function delArrivalItem(id){ if(!confirm('Remove this arrival item?'))return; try{ await api('/arrival/template',{method:'POST',body:JSON.stringify({id,delete:true})}); loadArrivalTemplate(); }catch(e){ alert(e.message); } }

/* ---- Client belongings & valuables — chain of custody (dual control) ---- */
let PROP_CATS=['Cash','Phone / electronics','Wallet / ID / cards','Jewelry / watch','Keys','Clothing','Medication (to pharmacy/secure)','Documents','Other'];
async function loadProperty(){
  let d; try{ d=await api('/property'); }catch(e){ $('propBody').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  PROP_CATS=d.categories||PROP_CATS; window.PROP_STAFF=d.staff||[]; window.PROP_FLAG=d.flagAmount; window.PROP_CANMANAGE=d.canManage; window.PROP_LISTS=d.lists||window.PROP_LISTS;
  $('propKpis').innerHTML=`<div class="ret-cards" style="margin:0 0 8px">
    <div class="ret-card"><div class="n">${d.clients.filter(c=>c.hasIntake).length}</div><div class="l">Belongings on file</div></div>
    <div class="ret-card"><div class="n">${money(d.totalCash)}</div><div class="l">Cash held in trust</div></div>
    <div class="ret-card ${d.flagged?'rc-high':''}"><div class="n">${d.flagged}</div><div class="l">Open discrepancies</div></div></div>
    <div class="hint" style="margin:0 0 14px">🚩 Cash-outs of <b>${money(d.flagAmount)}</b> or more alert leadership automatically.${d.canManage?` <a onclick="setPropFlag()" style="cursor:pointer;color:var(--navy);font-weight:600">Change</a>`:''}</div>`;
  const rows=d.clients.map(c=>`<tr style="cursor:pointer" onclick="openProperty(${c.id})">
    <td><b>${esc(c.name)}</b>${c.room?' · '+esc(c.room):''}</td>
    <td>${c.hasIntake?(c.status==='returned'?'<span class="risk risk-low">returned</span>':'<span class="risk risk-warn">stored</span>'):'<span class="risk risk-high">no count yet</span>'}</td>
    <td>${c.items} item(s)</td>
    <td><b>${money(c.cash)}</b></td>
    <td>${c.flagged?'<span class="badge-danger">discrepancy</span>':''}</td>
    <td><button class="btn btn-gold btn-sm sans" onclick="event.stopPropagation();openProperty(${c.id})">Open</button></td></tr>`).join('');
  $('propBody').innerHTML=`<div class="card"><h3>Client belongings & valuables</h3>
    <p class="sub sans">Every client's secured property and cash, with a full signed chain of custody. Tap a client to count, store, move cash, audit, or return at discharge.</p>
    <table class="tbl"><tr><th>Client</th><th>Status</th><th>Items</th><th>Cash</th><th></th><th></th></tr>${rows||'<tr><td colspan="6" class="empty">No active clients.</td></tr>'}</table></div>`;
}
async function openProperty(cid){
  let d; try{ d=await api('/property/'+cid); }catch(e){ alert(e.message); return; }
  if(d.staff) window.PROP_STAFF=d.staff; if(d.lists) window.PROP_LISTS=d.lists;
  const m=d.meta; const items=d.items||[];
  const itemRow=i=>`<div class="cmd-row">${i.hasPhoto?`<img src="/api/property/item/${i.id}/photo" onclick="window.open('/api/property/item/${i.id}/photo','_blank')" style="width:46px;height:46px;border-radius:8px;object-fit:cover;border:1px solid var(--line);cursor:pointer;flex:none" alt="photo"/>`:''}<div class="cmd-row-main">${i.status==='returned'?'↩︎ ':'📦 '}<b>${esc(i.category||'Item')}</b> — ${esc(i.description)}${i.qty&&i.qty!==1?' ×'+i.qty:''}${i.est_value!=null?' <span class="hint">· est '+money(i.est_value)+'</span>':''}${i.condition?' <span class="hint">· '+esc(i.condition)+'</span>':''}${i.status==='returned'?' <span class="hint">· returned '+esc(String(i.returned_at||'').slice(0,10))+'</span>':''}</div>${i.status==='stored'?`<button class="btn btn-ghost btn-sm sans" onclick="returnPropItem(${i.id},${cid})">Return</button>`:''}</div>`;
  const evIcon={intake_count:'📝',cash_deposit:'➕',cash_withdrawal:'➖',return:'↩︎',return_all:'✅',audit:'🔍',discrepancy:'⚠️',access:'🔓'};
  const evRow=e=>`<div class="cmd-row ${e.type==='discrepancy'?'cmd-row-flag':''}"><div class="cmd-row-main">${evIcon[e.type]||'•'} ${esc((e.type||'').replace(/_/g,' '))}${e.amount!=null?` <b>${e.amount<0?'−':''}${money(Math.abs(e.amount))}</b>`:''}${e.balance_after!=null&&/cash|return/.test(e.type)?` <span class="hint">→ bal ${money(e.balance_after)}</span>`:''}
    <div class="hint">${esc(String(e.created_at||'').slice(0,16).replace('T',' '))} · by ${esc(e.staff||'')}${e.witness?' · witness '+esc(e.witness):''}${e.client_ack&&e.client_ack!=='signed'?' · client '+esc(e.client_ack):''}${e.hasSig?` · <a onclick="window.open('/api/property/event/${e.id}/sig','_blank')" style="cursor:pointer;color:var(--gold);font-weight:600">✍ signature</a>`:''}${e.hasPhoto?` · <a onclick="window.open('/api/property/event/${e.id}/photo','_blank')" style="cursor:pointer;color:var(--gold);font-weight:600">📷 cash photo</a>`:''}${e.note?'<br>'+esc(e.note):''}</div></div></div>`;
  const s=m&&m.search;
  const searchBlock = s ? `<div style="margin-top:8px;border-top:1px dashed var(--line);padding-top:8px">
      <div class="kv"><span class="k">Search</span><span class="v">${s.consent?'consent ✓':'consent ?'} · ${s.none_found?'none found':((s.found||[]).length+' item(s) found')}</span></div>
      ${(s.found||[]).length?`<div class="hint">Found: ${s.found.map(esc).join(', ')}</div>`:''}
      ${(s.disposed||[]).length||s.disposed_other?`<div class="hint">Disposed (witnessed): ${[...(s.disposed||[]),s.disposed_other].filter(Boolean).map(esc).join(', ')}</div>`:''}
      ${s.sent_home?`<div class="hint">Sent home: ${esc(s.sent_home)}${s.sent_home_person?' → '+esc(s.sent_home_person):''}</div>`:''}
      ${(s.bins||s.luggage)?`<div class="hint">${s.bins||0} bin(s) · ${s.luggage||0} luggage piece(s)</div>`:''}
      ${(s.meds||[]).length?`<div class="hint">Meds: ${s.meds.map(esc).join(', ')}</div>`:''}
    </div>` : '';
  const intakeBlock = m
    ? `<div class="kv"><span class="k">Counted by</span><span class="v">${esc(m.intake_by||'')}${m.intake_witness?' + witness '+esc(m.intake_witness):''}</span></div>
       <div class="kv"><span class="k">Client signed</span><span class="v">${m.hasIntakeSig?`<img src="/api/property/${cid}/intake-sig" style="height:44px;border:1px solid var(--line);border-radius:6px;background:#fff;vertical-align:middle"/>`:esc(m.intake_client_ack||'—')}</span></div>
       <div class="kv"><span class="k">Stored</span><span class="v">${esc(m.safe_location||'—')}${m.bag_number?' · bag '+esc(m.bag_number):''}${m.sealed?' · sealed ✓':''}</span></div>${searchBlock}`
    : `<div class="pc-note" style="background:#fbecea;border-left:3px solid var(--danger)">No belongings count on file. Do the dual-witnessed search &amp; intake first.</div>`;
  $('propBody').innerHTML=`
    <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-ghost btn-sm sans" onclick="loadProperty()">← All clients</button></div>
    <div class="cmd-grid">
      <div class="card"><div class="cmd-hero-row"><div><h3>${esc(d.client.name)}${d.client.room?' · '+esc(d.client.room):''}</h3><p class="sub sans" style="margin:0">Belongings & valuables</p></div>
        <button class="btn ${m?'btn-ghost':'btn-primary'} btn-sm sans" onclick="propIntake(${cid})">${m?'Re-do search & intake':'🔎 Search & intake'}</button></div>
        ${intakeBlock}
        <div style="margin:14px 0 6px;display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0;font-size:14px">Cash in trust</h3><b style="font-size:20px;color:var(--navy)">${money(d.balance)}</b></div>
        <div class="toolbar no-print" style="justify-content:flex-start;gap:6px"><button class="btn btn-primary btn-sm sans" onclick="propCash(${cid},'deposit')">＋ Cash in</button><button class="btn btn-ghost btn-sm sans" onclick="propCash(${cid},'withdrawal')">－ Cash out</button><button class="btn btn-ghost btn-sm sans" onclick="propAudit(${cid})">🔍 Audit count</button></div>
        <div class="toolbar no-print" style="justify-content:flex-start;margin-top:8px"><button class="btn btn-gold sans" onclick="propReturnAll(${cid})">↩︎ Return all at discharge</button></div>
      </div>
      <div class="card"><div class="cmd-hero-row"><div><h3>Itemized belongings</h3></div><button class="btn btn-gold btn-sm sans" onclick="addPropItem(${cid})">+ Item</button></div>
        <div style="margin-top:8px">${items.length?items.map(itemRow).join(''):'<div class="hint">No items logged yet.</div>'}</div></div>
    </div>
    <div class="card"><h3>Chain of custody</h3><p class="sub sans">Every count, cash move, audit, and return — who, witness, client signature, and time.</p>
      <div style="margin-top:8px">${(d.events||[]).length?d.events.map(evRow).join(''):'<div class="hint">No activity yet.</div>'}</div></div>`;
}
function sigFields(opts={}){
  const staff=(window.PROP_STAFF||[]).map(s=>`<option value="${s.id}">${esc(s.name)}${s.job_role?' · '+esc(s.job_role):''}</option>`).join('');
  return `<label>Witness — a second staff member signs in (required)</label>
    <div class="grid2"><div><select id="pp_witness"><option value="">— select staff —</option>${staff}</select></div>
    <div><input id="pp_witnesspw" type="password" placeholder="Their password" autocomplete="off"/></div></div>
    <p class="hint">The witness selects their name and enters their own password — a real second signature.</p>
    ${opts.clientAck?`<label>Client — print name</label><input id="pp_client" placeholder="Client full name"/>
      <label>Client signature ✍️ — have the client sign below</label>
      <div style="border:1px solid var(--line);border-radius:10px;background:#fff"><canvas id="pp_sigpad" style="width:100%;height:150px;display:block;touch-action:none;border-radius:10px"></canvas></div>
      <div class="toolbar" style="margin:5px 0 0;justify-content:space-between;align-items:center"><span class="hint">Hand the device to the client to sign with their finger.</span><button type="button" class="btn btn-ghost btn-sm sans" onclick="window._sigpad&&window._sigpad.clear()">Clear</button></div>`:''}`;
}
function witnessBody(){ return { witness_id: $('pp_witness').value, witness_pw: $('pp_witnesspw').value }; }
function initSigPad(){ setTimeout(()=>{ window._sigpad=makeSigPad('pp_sigpad'); }, 30); }
function clientSig(){ return window._sigpad ? window._sigpad.dataURL() : null; }
function makeSigPad(id){ const c=document.getElementById(id); if(!c) return null; const ctx=c.getContext('2d');
  const ratio=window.devicePixelRatio||1; const rect=c.getBoundingClientRect();
  c.width=Math.max(1,rect.width)*ratio; c.height=Math.max(1,rect.height)*ratio; ctx.scale(ratio,ratio);
  ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#16242a';
  let drawing=false,dirty=false,last=null;
  const pos=e=>{ const r=c.getBoundingClientRect(); const t=(e.touches&&e.touches[0])||e; return {x:t.clientX-r.left,y:t.clientY-r.top}; };
  const down=e=>{ drawing=true; last=pos(e); if(e.cancelable)e.preventDefault(); };
  const mv=e=>{ if(!drawing)return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; if(e.cancelable)e.preventDefault(); };
  const up=()=>{ drawing=false; };
  c.addEventListener('pointerdown',down); c.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
  c.addEventListener('touchstart',down,{passive:false}); c.addEventListener('touchmove',mv,{passive:false}); window.addEventListener('touchend',up);
  return { clear(){ ctx.clearRect(0,0,c.width*ratio,c.height*ratio); dirty=false; }, isEmpty(){ return !dirty; }, dataURL(){ return dirty? c.toDataURL('image/png'):null; } };
}
// Belongings intake — a step-by-step wizard so staff aren't faced with one huge
// scrolling form. State lives in window.PI so moving between steps never loses data.
function propIntake(cid){
  window.PI={ cid, step:1, proh:new Set(), disp:new Set(), meds:new Set(),
    consent:true, none:false, scrubs:false, wand:false, disposed_other:'', sent_home:'', sent_home_person:'',
    bins:'', luggage:'', safe_location:'', bag_number:'', sealed:false };
  piRender();
}
function piChips(arr,key){ return (arr||[]).map(it=>{ const on=PI[key].has(it)?' on':''; return `<button type="button" class="pchip${on}" data-k="${key}" data-l="${esc(it)}" onclick="piToggle(this)">${esc(it)}</button>`; }).join(''); }
function piToggle(el){ const k=el.dataset.k,l=el.dataset.l,set=PI[k];
  if(set.has(l)){ set.delete(l); el.classList.remove('on'); }
  else{ set.add(l); el.classList.add('on'); if(k==='proh'){ PI.none=false; const n=document.getElementById('pi_none'); if(n) n.checked=false; } } }
function piFilter(q){ q=(q||'').toLowerCase(); document.querySelectorAll('#pi_proh .pchip').forEach(c=>{ c.style.display=c.dataset.l.toLowerCase().includes(q)?'':'none'; }); }
function piCapture(){ const g=id=>document.getElementById(id);
  if(g('pi_consent')) PI.consent=g('pi_consent').checked;
  if(g('pi_none')) PI.none=g('pi_none').checked;
  if(g('pi_scrubs')) PI.scrubs=g('pi_scrubs').checked;
  if(g('pi_wand')) PI.wand=g('pi_wand').checked;
  if(g('pi_disp_other')) PI.disposed_other=g('pi_disp_other').value;
  if(g('pi_senthome')) PI.sent_home=g('pi_senthome').value;
  if(g('pi_person')) PI.sent_home_person=g('pi_person').value;
  if(g('pi_bins')) PI.bins=g('pi_bins').value;
  if(g('pi_lug')) PI.luggage=g('pi_lug').value;
  if(g('pi_loc')) PI.safe_location=g('pi_loc').value;
  if(g('pi_bag')) PI.bag_number=g('pi_bag').value;
  if(g('pi_sealed')) PI.sealed=g('pi_sealed').checked; }
function piNav(dir){ piCapture(); PI.step=Math.min(3,Math.max(1,PI.step+dir)); piRender(); }
function piStep1(){ const L=window.PROP_LISTS||{prohibited:[]};
  return `<p class="sub sans">Search the client &amp; their bags <b>with the client and a second staff witness present.</b></p>
    <label class="pi-toggle"><input type="checkbox" id="pi_consent" ${PI.consent?'checked':''}/> <span>Client was told the search is for safety (non-punitive) and agreed</span></label>
    <label class="pi-toggle"><input type="checkbox" id="pi_scrubs" ${PI.scrubs?'checked':''}/> <span>Client changed into facility scrubs</span></label>
    <label class="pi-toggle"><input type="checkbox" id="pi_wand" ${PI.wand?'checked':''}/> <span>Scanned with the metal wand</span></label>
    <label class="pi-toggle pi-big"><input type="checkbox" id="pi_none" ${PI.none?'checked':''}/> <span>✅ Nothing prohibited found — clean intake</span></label>
    <label style="margin-top:14px">Tap any prohibited / restricted item found</label>
    <input id="pi_filter" placeholder="🔍 Type to find an item…" oninput="piFilter(this.value)" style="margin-bottom:9px"/>
    <div id="pi_proh" class="pchips">${piChips(L.prohibited,'proh')}</div>`; }
function piStep2(){ const L=window.PROP_LISTS||{disposed:[],meds:[]};
  return `<label>Items disposed of per policy (witness present)</label>
    <div class="pchips">${piChips(L.disposed,'disp')}</div>
    <input id="pi_disp_other" placeholder="Other disposed item…" value="${esc(PI.disposed_other)}" style="margin-top:9px"/>
    <label style="margin-top:14px">Items sent home with an approved person</label>
    <input id="pi_senthome" placeholder="Describe items sent home" value="${esc(PI.sent_home)}"/>
    <input id="pi_person" placeholder="Name of approved person" value="${esc(PI.sent_home_person)}" style="margin-top:7px"/>
    <div class="grid2" style="margin-top:11px"><div><label>Number of bins</label><input id="pi_bins" type="number" min="0" value="${esc(PI.bins)}"/></div>
      <div><label>Luggage pieces</label><input id="pi_lug" type="number" min="0" value="${esc(PI.luggage)}"/></div></div>
    <label style="margin-top:14px">Medication handling</label>
    <div class="pchips">${piChips(L.meds,'meds')}</div>`; }
function piStep3(){
  return `<label>Where stored (safe / locker)</label><input id="pi_loc" placeholder="e.g. Front safe, locker 3" value="${esc(PI.safe_location)}"/>
    <div class="grid2" style="margin-top:6px"><div><label>Sealed bag #</label><input id="pi_bag" placeholder="e.g. 0481" value="${esc(PI.bag_number)}"/></div>
      <div><label class="pi-toggle" style="margin-top:24px"><input type="checkbox" id="pi_sealed" ${PI.sealed?'checked':''}/> <span>Tamper-evident bag sealed</span></label></div></div>
    <hr style="margin:16px 0">
    ${sigFields({clientAck:true})}`; }
function piRender(){ const s=PI.step;
  const steps=[[1,'Search'],[2,'Items & count'],[3,'Store & sign']];
  const head=`<h3 style="margin-bottom:2px">Belongings intake</h3>
    <div class="pi-steps">${steps.map(([n,t])=>`<span class="pi-step${n===s?' on':''}${n<s?' done':''}">${n<s?'✓':n}. ${t}</span>`).join('')}</div>`;
  const body = s===1?piStep1() : s===2?piStep2() : piStep3();
  const foot=`<div class="toolbar" style="margin-top:18px;justify-content:space-between">
    <button class="btn btn-ghost sans" onclick="${s===1?'closeHModal()':'piNav(-1)'}">${s===1?'Cancel':'← Back'}</button>
    <button class="btn btn-primary sans" onclick="${s<3?'piNav(1)':'piSubmit()'}">${s<3?'Next →':'Save intake'}</button></div>`;
  hmodalPlain(head+body+foot);
  if(s===3) initSigPad();
}
function piSubmit(){ piCapture();
  const sig=clientSig(); if(!sig){ alert('Please have the client sign on the screen.'); return; }
  if(!$('pp_witness').value){ alert('A second staff witness must sign in.'); return; }
  const cid=PI.cid;
  const search={ consent:PI.consent, none_found:PI.none, scrubs:PI.scrubs, wand:PI.wand, found:[...PI.proh], disposed:[...PI.disp], disposed_other:PI.disposed_other.trim(), sent_home:PI.sent_home.trim(), sent_home_person:PI.sent_home_person.trim(), bins:PI.bins, luggage:PI.luggage, meds:[...PI.meds] };
  api('/property/'+cid+'/intake',{method:'POST',body:JSON.stringify({safe_location:PI.safe_location,bag_number:PI.bag_number,sealed:PI.sealed,search,...witnessBody(),client_ack:($('pp_client')&&$('pp_client').value)||'',client_sig:sig})}).then(()=>{ closeHModal(); openProperty(cid); }).catch(e=>alert(e.message));
}
function addPropItem(cid){
  const save=hmodal(`<h3>Add belonging</h3>
    <label>Category</label><select id="pp_cat">${PROP_CATS.map(c=>`<option>${esc(c)}</option>`).join('')}</select>
    <label>Description (be specific)</label><input id="pp_desc" placeholder="e.g. iPhone 14, black, cracked corner / silver ring"/>
    <div class="grid2"><div><label>Qty</label><input id="pp_qty" type="number" value="1" min="1"/></div>
      <div><label>Est. value ($)</label><input id="pp_val" type="number" step="0.01"/></div></div>
    <label>Condition</label><input id="pp_cond" placeholder="e.g. good, scratched, new in box"/>
    <label>Photo (optional — recommended for valuables &amp; cash)</label><input id="pp_photo" type="file" accept="image/*" capture="environment"/>
    <p class="hint">For cash, use "Cash in" so it's tracked to the dollar — and snap a photo of the count here as a "Cash" item if you want a visual record.</p>`);
  save.onclick=async()=>{ if(!$('pp_desc').value.trim()){ alert('Describe the item.'); return; }
    let photo=null; const f=$('pp_photo')&&$('pp_photo').files[0]; if(f){ try{ photo=await resizeImage(f,900,0.6); }catch(e){} }
    try{ await api('/property/'+cid+'/item',{method:'POST',body:JSON.stringify({category:$('pp_cat').value,description:$('pp_desc').value,qty:$('pp_qty').value,est_value:$('pp_val').value,condition:$('pp_cond').value,photo})}); closeHModal(); openProperty(cid); }catch(e){ alert(e.message); } };
}
function propCash(cid,type){
  const out=type==='withdrawal';
  const save=hmodal(`<h3>${out?'Cash out — return to client':'Cash in — count into trust'}</h3>
    <p class="sub sans">${out?'The client receives cash from their balance. Requires a witness sign-in and the client’s signature.':'Count the cash to the dollar with a second staff witness present. The client signs to confirm the amount put in — no loose cash left unlogged.'}</p>
    <label>Amount ($)</label><input id="pp_amt" type="number" step="0.01" min="0"/>
    <label>Note (denominations, reason)</label><input id="pp_note" placeholder="${out?'what it’s for':'e.g. 2×$20, 1×$5'}"/>
    <label>📷 Photo of the counted cash ${out?'(recommended)':'(recommended — snap the bills laid out)'}</label><input id="pp_cashphoto" type="file" accept="image/*" capture="environment"/>
    ${sigFields({clientAck:true})}`);
  initSigPad();
  save.onclick=async()=>{ const sig=clientSig(); if(!sig){ alert(out?'Please have the client sign to confirm they received the cash.':'Please have the client sign to confirm the amount put in.'); return; }
    if(!($('pp_client').value||'').trim()){ alert('Print the client’s name with the signature.'); return; }
    if(!$('pp_witness').value){ alert('A second staff witness must sign in.'); return; }
    let photo=null; const f=$('pp_cashphoto')&&$('pp_cashphoto').files[0]; if(f){ try{ photo=await resizeImage(f,900,0.6); }catch(e){} }
    try{ await api('/property/'+cid+'/cash',{method:'POST',body:JSON.stringify({type,amount:$('pp_amt').value,note:$('pp_note').value,...witnessBody(),client_ack:$('pp_client').value,client_sig:sig,photo})}); closeHModal(); openProperty(cid); }catch(e){ alert(e.message); } };
}
function propAudit(cid){
  const save=hmodal(`<h3>Audit cash count</h3>
    <p class="sub sans">Physically count the cash on hand and enter it. If it doesn't match the ledger, leadership is alerted immediately and an incident is logged.</p>
    <label>Cash counted now ($)</label><input id="pp_amt" type="number" step="0.01" min="0"/>
    <label>Witness (recommended)</label><input id="pp_witness" placeholder="Second staff (optional but advised)"/>
    <label>Note</label><input id="pp_note"/>`);
  save.onclick=async()=>{ try{ const r=await api('/property/'+cid+'/audit',{method:'POST',body:JSON.stringify({counted:$('pp_amt').value,witness:$('pp_witness').value,note:$('pp_note').value})}); closeHModal(); if(r.discrepancy) alert('⚠️ Discrepancy of '+(r.discrepancy>0?'+':'')+'$'+Math.abs(r.discrepancy).toFixed(2)+' — leadership has been alerted.'); openProperty(cid); }catch(e){ alert(e.message); } };
}
function propReturnAll(cid){
  const save=hmodal(`<h3>Return all belongings (discharge)</h3>
    <p class="sub sans">Return every stored item and the full cash balance. For safety, load cash onto a <b>prepaid Visa card</b> rather than handing out bills. Witnessed; the client signs they received everything.</p>
    <label>How is the cash returned?</label>
    <select id="pp_method"><option>Prepaid Visa card</option><option>Check</option><option>Electronic transfer</option><option>Cash</option></select>
    <label id="pp_reflabel">Prepaid card — last 4 digits</label><input id="pp_ref" placeholder="e.g. 4821"/>
    ${sigFields({clientAck:true})}
    <label>Note</label><input id="pp_note"/>`);
  const upd=()=>{ const m=$('pp_method').value; $('pp_reflabel').textContent = m==='Check'?'Check #':m==='Electronic transfer'?'Reference / where sent':m==='Cash'?'(cash — small amounts only)':'Prepaid card — last 4 digits'; };
  if($('pp_method')) $('pp_method').onchange=upd;
  initSigPad();
  save.onclick=async()=>{ const sig=clientSig(); if(!sig){ alert('Please have the client sign on the screen.'); return; }
    try{ await api('/property/'+cid+'/return-all',{method:'POST',body:JSON.stringify({...witnessBody(),client_ack:$('pp_client').value,note:$('pp_note').value,method:$('pp_method').value,reference:$('pp_ref').value,client_sig:sig})}); closeHModal(); openProperty(cid); }catch(e){ alert(e.message); } };
}
async function returnPropItem(id,cid){ if(!confirm('Mark this item returned to the client?'))return; try{ await api('/property/item/'+id+'/return',{method:'POST',body:'{}'}); openProperty(cid); }catch(e){ alert(e.message); } }
function setPropFlag(){ const cur=window.PROP_FLAG||100; const v=prompt('Alert leadership when a single cash-out is at or above this amount ($):', cur); if(v===null) return; const amt=Math.max(0,+v||0); api('/property/settings',{method:'POST',body:JSON.stringify({flag_amount:amt})}).then(()=>loadProperty()).catch(e=>alert(e.message)); }

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
      ? `<table class="tbl"><tr><th>Client</th><th>Status</th><th></th></tr>${rows}</table>`
      : (d.configured?'<div class="hint">No one scheduled to admit today.</div>':'<div class="hint">Connect Salesforce in Settings, then click “Pull from Salesforce.”</div>');
    const up=(d.upcoming||[]);
    if($('arrivalsUpcomingCard')){
      $('arrivalsUpcomingCard').style.display = up.length?'block':'none';
      $('arrivalsUpcoming').innerHTML = up.map(a=>{
        const greet=esc((a.preferred_name||a.first_name||'')+' '+(a.last_name||''));
        const when=a.scheduled_date||'';
        return `<div class="pc-note"><strong>${greet}</strong> <span class="hint">· ${esc(when)}</span>${a.referral_source?' <span class="hint">· via '+esc(a.referral_source)+'</span>':''}</div>`;
      }).join('');
    }
    const uns=(d.unscheduled||[]);
    if($('arrivalsUnschedCard')){
      $('arrivalsUnschedCard').style.display = uns.length?'block':'none';
      $('arrivalsUnsched').innerHTML = uns.map(c=>`<div class="todo" onclick="editClient(${c.id})" style="cursor:pointer"><div class="txt"><span class="risk risk-high">UNSCHEDULED</span> <strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}${(c.loc||c.referral)?'<div class="hint">'+[c.loc&&esc(c.loc), c.referral&&('via '+esc(c.referral))].filter(Boolean).join(' · ')+'</div>':''}</div><span class="hint">›</span></div>`).join('');
    }
    const fu=(d.followUps||[]).map(a=>`<tr><td><strong>${esc((a.first_name||'')+' '+(a.last_name||''))}</strong><div class="hint">was due ${esc(a.scheduled_date||'')}${a.phone?' · '+esc(a.phone):''}</div></td>`+
      `<td><input class="sans" style="width:100%" placeholder="Follow-up note (what happened / next step)" value="${esc(a.follow_up||'')}" onchange="setArrivalNote(${a.id}, this.value)"/></td>`+
      `<td style="text-align:right"><button class="btn btn-ghost btn-sm sans" onclick="setArrival(${a.id},'cancelled')">Close</button></td></tr>`).join('');
    $('arrivalsFollow').innerHTML = fu ? `<table class="tbl"><tr><th>Client</th><th>Follow-up</th><th></th></tr>${fu}</table>` : '<div class="hint">No outstanding no-shows. 🎉</div>';
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
async function diagnoseSchedule(){
  const name = prompt('Whose schedule are we checking? (e.g. Brandon) — leave blank for the overall picture:','')||'';
  const box=$('arrivalsDiag'); box.innerHTML='<div class="card">Checking Salesforce…</div>';
  try{
    const d=await api('/arrivals/diagnose?name='+encodeURIComponent(name));
    let html='<div class="card"><h3 style="margin:0 0 6px">Schedule diagnostic</h3>';
    html += `<div class="pc-note">Leads with a scheduled admit date in Salesforce: <strong>${d.leadsWithAdmitDate!=null?d.leadsWithAdmitDate:'—'}</strong></div>`;
    if(d.matches){
      html += `<div class="cmd-sub">Matches for "${esc(name)}"</div>`;
      html += d.matches.length ? d.matches.map(m=>`<div class="pc-note"><strong>${esc(m.name)}</strong> — admit date: <strong>${esc(m.admitDate)}</strong> · status: ${esc(m.status||'—')} · ${m.converted?'converted (admitted)':'not converted'}${m.patientId?' · patient id '+esc(m.patientId):''} <span class="hint">(lead created ${esc(m.created)})</span></div>`).join('') : '<div class="pc-note">No Lead found by that name in Salesforce.</div>';
    }
    if(d.upcoming&&d.upcoming.length){ html += `<div class="cmd-sub">Future-dated leads (Date_Looking_to_Admit ≥ today)</div>`+d.upcoming.map(u=>`<div class="pc-note">☀ <strong>${esc(u.name)}</strong> · ${esc(u.date)} · ${esc(u.status||'')}${u.converted?' · admitted':''}</div>`).join(''); }
    if(d.pipelineByStatus){ html += `<div class="cmd-sub">Live pipeline — Leads not yet admitted, by status</div>`+(d.pipelineByStatus.length?d.pipelineByStatus.map(s=>`<div class="pc-note"><strong>${esc(s.status)}</strong> — ${s.count}</div>`).join(''):'<div class="pc-note">None.</div>'); }
    if(d.recentPipeline&&d.recentPipeline.length){ html += `<div class="cmd-sub">Most recent not-yet-admitted leads</div>`+d.recentPipeline.map(r=>`<div class="pc-note">${esc(r.name)} · status: ${esc(r.status||'—')} · admit date: ${esc(r.admitDate)} <span class="hint">(created ${esc(r.created)})</span></div>`).join(''); }
    if(d.oppByStage){ html += `<div class="cmd-sub">⭐ OPPORTUNITIES — open, by stage (the likely real schedule)</div>`+(d.oppByStage.length?d.oppByStage.map(s=>`<div class="pc-note"><strong>${esc(s.stage)}</strong> — ${s.count}</div>`).join(''):'<div class="pc-note">None open.</div>'); }
    if(d.recentOpps&&d.recentOpps.length){ html += `<div class="cmd-sub">Recent open opportunities</div>`+d.recentOpps.map(o=>`<div class="pc-note"><strong>${esc(o.name)}</strong> · stage: ${esc(o.stage||'—')} · close date: ${esc(o.closeDate||'—')} <span class="hint">(created ${esc(o.created)})</span></div>`).join(''); }
    if(d.oppDateFields&&d.oppDateFields.length){ html += `<div class="cmd-sub">Opportunity date fields</div><div class="pc-note">${d.oppDateFields.map(esc).join(' · ')}</div>`; }
    if(d.oppFacilityFields&&d.oppFacilityFields.length){ html += `<div class="cmd-sub">🏥 Facility/location fields on the Opportunity</div>`+d.oppFacilityFields.map(f=>`<div class="pc-note"><strong>${esc(f.name)}</strong> (${esc(f.type)})${f.label?' — '+esc(f.label):''}</div>`).join(''); }
    if(d.facilityValues){ for(const [field,vals] of Object.entries(d.facilityValues)){ if(!vals.length) continue; html += `<div class="cmd-sub">Scheduled admits split by ${esc(field)}</div>`+vals.map(v=>`<div class="pc-note"><strong>${esc(v.value||'(blank)')}</strong> — ${v.count}</div>`).join(''); } }
    html += '</div>';
    box.innerHTML=html;
  }catch(e){ box.innerHTML='<div class="card"><span style="color:var(--danger)">'+esc(e.message)+'</span></div>'; }
}
async function arrivalsSync(){
  $('arrivals_msg').textContent='Pulling from Salesforce…';
  try{ const r=await api('/arrivals/sync',{method:'POST'}); $('arrivals_msg').textContent=`✓ ${r.pulled} scheduled · ${r.admitted||0} admitted in the last 7 days · ${r.matched} matched in Kipu${r.removed?(' · '+r.removed+' stale removed'):''}.${r.facilityValue?(' Scoped to '+r.facilityValue+(r.scopedTo?'':' (⚠ location field not found — run Diagnose)')):''}`; loadArrivals(); }
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
  const staffTable = (rows) => rows.length ? `<table class="tbl"><tr><th>Staff</th><th>Clients</th><th>Avg LOS</th><th>AMA %</th><th>Exp /10</th></tr>`+
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
    <div class="ret-card ${(d.total-d.askedThisShift)?'rc-warn':''}"><div class="n">${d.askedThisShift}/${d.total}</div><div class="l">Asked this shift</div></div>
    <div class="ret-card"><div class="n">q${d.defaultMin}</div><div class="l">Default cadence</div></div>`;
  if($('roundsQuestion')) $('roundsQuestion').innerHTML = d.question ? `<div class="card" style="border-left:4px solid var(--gold);background:#faf6ee"><div class="hint" style="text-transform:uppercase;letter-spacing:.6px;color:var(--gold)">Ask every client this ${esc((d.shift||'').toLowerCase())} shift</div><h3 style="margin:4px 0 0">“${esc(d.question)}”</h3><p class="sub sans" style="margin:4px 0 0">Ask it on rounds. Capture anything worth keeping with 📝 Note next to the client.</p></div>` : '';
  const rows=[...d.rows].sort((a,b)=>(b.overdue-a.overdue)||((b.minsSince??1e9)-(a.minsSince??1e9)));
  const scanBannerHtml = `<div class="card" style="border-left:4px solid var(--gold);background:#faf6ee"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div style="flex:1;min-width:220px"><strong>This is the status board — to actually do a round, scan each room.</strong> <span class="hint">A check below only clears when you scan that room's QR; there is no desk check-off. The clock reflects verified scans.</span></div><button class="btn btn-gold sans" onclick="show('roundscan')">📍 Start Rounds</button></div></div>`;
  const stOpts=[['asleep','😴 Asleep'],['awake','🙂 Awake'],['good','✅ Good'],['distressed','😣 Distressed'],['needs_help','🆘 Needs help'],['out','🚪 Out'],['refused','🚫 Refused']];
  board.innerHTML = scanBannerHtml
    + `<p class="sub sans" style="margin:4px 2px 8px">Scan each room's QR to log the round, then tap how each client is doing.</p>`
    + rows.map(r=>{
    const when = r.minsSince==null?'never scanned':(r.minsSince+'m ago'+(r.lastBy?' · '+esc(r.lastBy):''));
    const noteHtml = r.note ? `<div class="hint" style="margin-top:2px">📝 ${esc(r.note)}${r.noteBy?' <span style="opacity:.7">— '+esc(r.noteBy)+'</span>':''}</div>` : '';
    const nm=JSON.stringify(r.name||'').replace(/"/g,'&quot;');
    const stBtns=stOpts.map(([k,l])=>`<button class="btn btn-ghost btn-sm sans" onclick="roundStatus(${r.id},'${k}',${nm})">${l}</button>`).join('');
    return `<div class="cmd-row ${r.overdue?'cmd-row-flag':''}" style="flex-wrap:wrap">
      ${r.photo?`<img src="${esc(r.photo)}" class="client-photo sm" alt=""/>`:''}
      <div class="cmd-row-main" style="flex:1;min-width:180px"><strong>${esc(r.name)}</strong>${r.room?' <span class="hint">· '+esc(r.room)+'</span>':''}
        <div class="hint">${r.overdue?'<span style="color:var(--danger);font-weight:600">OVERDUE</span> · ':''}last verified: ${when}${r.lastStatus&&r.lastStatus!=='ok'?' · <b>'+esc(r.lastStatus)+'</b>':''} · q${r.interval}</div>${noteHtml}</div>
      <button class="btn btn-ghost btn-sm sans" onclick="roundNote(${r.id}, ${JSON.stringify(r.note||'').replace(/"/g,'&quot;')})" title="Add or edit an optional note">📝 ${r.note?'Edit note':'Note'}</button>
      <div id="sst_${r.id}" style="flex-basis:100%;display:flex;flex-wrap:wrap;gap:5px;margin-top:7px">${stBtns}</div></div>`;
  }).join('');
  $('roundsAccount').innerHTML = (d.byPerson||[]).length ? d.byPerson.map(p=>`<div class="cmd-row"><div class="cmd-row-main"><strong>${esc(p.k)}</strong></div><span class="chip">${p.n} checks</span></div>`).join('') : '<div class="hint">No checks logged today yet.</div>';
  if(ME&&ME.role==='admin'){ try{ const es=await api('/rounds/escalation'); $('roundsEscalateRow').innerHTML=`<label class="trg" style="display:inline-flex"><input type="checkbox" ${es.on?'checked':''} onchange="setRoundsEscalation(this.checked)"/> Text the on-call leader when a client goes overdue ${es.smsReady?'':'<span class="hint">(connect Texting first)</span>'}</label>`; }catch(e){} }
  loadShiftQuestions();
  // Live: refresh every 45s so the clocks stay honest.
  if($('rounds').classList.contains('active')) roundsTimer=setTimeout(loadRounds, 45000);
}
async function loadShiftQuestions(){ if(!($('sq_text')&&ME&&ME.role==='admin')) return; try{ const q=await api('/checkins/questions'); if(!$('sq_text').value) $('sq_text').value=q.text||''; }catch(e){} }
async function saveShiftQuestions(){ try{ await api('/checkins/questions',{method:'POST',body:JSON.stringify({text:$('sq_text').value})}); $('sq_msg').textContent='✓ Saved'; loadRounds(); }catch(e){ $('sq_msg').textContent=e.message; } }
async function resetShiftQuestions(){ try{ await api('/checkins/questions',{method:'POST',body:JSON.stringify({text:''})}); $('sq_text').value=''; const q=await api('/checkins/questions'); $('sq_text').value=q.text||''; $('sq_msg').textContent='✓ Reset to defaults'; loadRounds(); }catch(e){ $('sq_msg').textContent=e.message; } }
async function roundNote(id, current){ const note=prompt('Optional note for this client:', current||''); if(note===null) return; try{ await api('/rounds/check',{method:'POST',body:JSON.stringify({client_id:id,status:'note',note})}); loadRounds(); }catch(e){ alert(e.message); } }
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
  const end=($('periodEnd')&&$('periodEnd').value)||'';
  let p; try{ p = await api('/command/since?date='+encodeURIComponent(since)+(end?'&end='+encodeURIComponent(end):'')); }catch(e){ return; }
  const dc=p.discharged||{}, sc=p.scheduled||{};
  $('periodKpis').innerHTML=
    `<div class="ret-card"><div class="n">${sc.total||0}</div><div class="l">Scheduled</div></div>`+
    `<div class="ret-card"><div class="n">${p.admitted||0}</div><div class="l">Admitted</div></div>`+
    `<div class="ret-card"><div class="n">${dc.total||0}</div><div class="l">Discharged</div></div>`+
    `<div class="ret-card ${dc.amaRate>=20?'rc-high':(p.ama&&p.ama.count?'rc-warn':'')}"><div class="n">${(p.ama&&p.ama.count)||0}</div><div class="l">AMA · ${dc.amaRate||0}%</div></div>`+
    `<div class="ret-card"><div class="n">${dc.avgLos!=null?dc.avgLos:'—'}</div><div class="l">Avg LOS (days)</div></div>`+
    ((p.referredOut&&p.referredOut.count)?`<div class="ret-card"><div class="n">${p.referredOut.count}</div><div class="l">Referred out (no intake)</div></div>`:'');
  const sb=Object.entries(dc.byStatus||{}).map(([k,n])=>`<span class="risk ${/ama/i.test(k)?'risk-warn':'risk-low'}" style="margin-right:6px">${esc(k)}: ${n}</span>`).join('');
  const row=(a)=>`<tr onclick="editClient(${a.id})" style="cursor:pointer" title="Open full chart">`+
    `<td><strong>${esc(a.name)}</strong>${a.therapist?`<div class="hint">${esc(a.therapist)}</div>`:''}</td>`+
    `<td>${/ama/i.test(a.status)?'<span class="risk risk-warn">AMA</span>':esc(a.status||'')}</td>`+
    `<td>${esc(a.date||'')}</td><td>${a.los!=null?a.los+'d':'—'}</td>`+
    `<td>${esc(a.reason||'')||'<span class=hint>—</span>'}</td>`+
    `<td>${a.hasRead?'<span class="risk risk-low">read ✓</span>':'<span class="hint">›</span>'}</td></tr>`;
  const dlist=(dc.list||[]);
  const ref=(p.referredOut&&p.referredOut.list)||[];
  const phantom=(p.phantom&&p.phantom.list)||[];
  $('periodDetail').innerHTML =
    (sb?`<div style="margin:10px 0">${sb}</div>`:'')+
    (dlist.length?`<div class="cmd-sub">All discharges — click any patient to open the full chart and review the notes</div>`+
      `<table class="tbl"><tr><th>Client</th><th>Type</th><th>Left</th><th>LOS</th><th>Reason / what we'd improve</th><th></th></tr>${dlist.map(row).join('')}</table>`
      :'<div class="hint" style="margin-top:8px">No discharges in this period.</div>')+
    (ref.length?`<div class="cmd-sub" style="margin-top:12px">Referred out / didn't complete intake <span class="hint" style="font-weight:400">— not counted as admissions or discharges</span></div>`+
      ref.map(r=>`<div class="pc-note">↪ <strong>${esc(r.name)}</strong> <span class="hint">${esc(r.date||'')}${r.status&&r.status!=='Merged (duplicate)'?' · '+esc(r.status):''}</span></div>`).join(''):'')+
    (phantom.length?`<div class="cmd-sub" style="margin-top:12px">⚠ Excluded as phantom discharges <span class="hint" style="font-weight:400">— these people are still active patients (census-sync artifact), so not counted as discharges</span></div>`+
      phantom.map(r=>`<div class="pc-note">👻 <strong>${esc(r.name)}</strong> <span class="hint">marked ${esc(r.date||'')} but still here</span></div>`).join(''):'');
}
let COMMAND_DATA=null;
async function cmdFlowPanel(key){
  const d=COMMAND_DATA; if(!d) return;
  const host=$('cmdFlowDetail'); if(!host) return;
  // toggle off if same tile re-clicked
  if(host.getAttribute('data-key')===key && host.style.display!=='none'){ host.style.display='none'; host.removeAttribute('data-key'); document.querySelectorAll('#cmdFlow .ret-card').forEach(t=>t.classList.remove('tile-active')); return; }
  const row=(x)=>`<div class="pc-note" ${x.id?`onclick="editClient(${x.id})" style="cursor:pointer" title="Open chart"`:''}>↗ <strong>${esc(x.name)}</strong> — ${esc(x.status||'')}${x.date?' <span class="hint">'+esc(x.date)+'</span>':''}${x.reason?' · '+esc(x.reason):''}${x.id?' <span class="hint">›</span>':''}</div>`;
  const mark=(t)=>{ host.style.display='block'; host.setAttribute('data-key',key); document.querySelectorAll('#cmdFlow .ret-card').forEach(x=>x.classList.toggle('tile-active', x.getAttribute('data-cmd')===key)); host.scrollIntoView({behavior:'smooth',block:'nearest'}); };
  let html='';
  if(key==='census'){ const lv=(d.levels&&d.levels.census)||[]; html=`<h3>Census by level of care — ${d.flow.census}</h3>`+(lv.length?lv.map(l=>`<div class="cmd-row"><div class="cmd-row-main"><strong>${esc(l.code||l.label)}</strong> <span class="hint">${esc(l.label||'')}</span></div><span class="risk risk-low">${l.count}</span></div>`).join(''):'<div class="hint">No level-of-care data — run a Kipu sync.</div>'); }
  else if(key==='scheduled'){ const a=(d.scheduled&&d.scheduled.list)||[]; html=`<div class="cmd-hero-row"><h3 style="margin:0">Scheduled to arrive today</h3><button class="btn btn-ghost btn-sm sans" onclick="show('arrivals')">Open Front Desk ↗</button></div>`+(a.length?a.map(s=>`<div class="pc-note">${s.status==='arrived'?'✓':s.status==='no_show'?'✕':'•'} <strong>${esc(s.name)}</strong> <span class="hint">${esc(s.status==='no_show'?'no-show':s.status)}</span></div>`).join(''):'<div class="hint">None scheduled today.</div>'); }
  else if(key==='admits'){ const a=d.flow.admitsTodayList||[]; html=`<h3>Admits today (${a.length})</h3>`+(a.length?a.map(x=>`<div class="pc-note">☀ <strong>${esc(x.name)}</strong>${x.loc?' · '+esc(x.loc):''}</div>`).join(''):'<div class="hint">No admits today.</div>'); }
  else if(key==='dcToday'){ const a=d.flow.dischargesTodayList||[]; html=`<h3>Discharges today (${a.length}) — click to open the chart</h3>`+(a.length?a.map(row).join(''):'<div class="hint">No discharges today.</div>'); }
  else if(key==='dc7d'){ const a=d.flow.dischargesRecentList||[]; html=`<h3>Recent discharges (${a.length}) — click to open the chart</h3>`+(a.length?a.map(row).join(''):'<div class="hint">No recent discharges.</div>'); }
  else if(key==='engage'){ const a=(d.engagement&&d.engagement.disengaged)||[]; html=`<h3>No activity today (${a.length}) — boredom is an AMA risk; encourage them</h3>`+(a.length?a.map(x=>`<div class="pc-note" onclick="editClient(${x.id})" style="cursor:pointer"><strong>${esc(x.name)}</strong>${x.room?' <span class="hint">· '+esc(x.room)+'</span>':''}${x.interests?'<div class="hint">💛 loves: '+esc(x.interests)+'</div>':'<div class="hint">no interests set</div>'}</div>`).join(''):'<div class="pc-note">✓ Everyone engaged today.</div>'); }
  else if(key==='carecards'){
    host.innerHTML='<div class="hint">Loading care cards…</div>'; mark();
    let cc; try{ cc=await api('/carecards'); }catch(e){ host.innerHTML='<div class="hint" style="color:var(--danger)">'+esc(e.message)+'</div>'; return; }
    const inc=cc.incomplete||[];
    host.innerHTML=`<h3>Care cards to fill (${inc.length}${cc.overdue?` · ${cc.overdue} overdue`:''}) — click Fill</h3>`+(inc.length?inc.map(c=>{
      const m=c.minsSinceAdmit; const clock=m==null?'':(m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m')+' since admit';
      return `<div class="cmd-row ${c.overdue?'cmd-row-flag':''}"><div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}<div class="hint">${c.overdue?'<span style="color:var(--danger);font-weight:600">OVERDUE</span> · ':''}${clock} · missing: ${(c.missing||[]).map(esc).join(', ')}</div></div><button class="btn btn-gold btn-sm sans" onclick="openJourney(${c.id})">Fill</button></div>`;
    }).join(''):'<div class="hint">✓ Every care card is complete.</div>');
    return;
  }
  host.innerHTML=html; mark();
}
async function loadMoments(){
  let m; try{ m=await api('/moments'); }catch(e){ return; }
  const step=(title,done,total,gap,gapLabel)=>{
    const pct = total? Math.round(done/total*100):100;
    const gaps = gap.length ? `<div class="hint" style="margin:4px 0 2px">${gapLabel}:</div>`+gap.map(g=>`<div class="pc-note" onclick="editClient(${g.id})" style="cursor:pointer"><strong>${esc(g.name)}</strong>${g.room?' <span class="hint">· '+esc(g.room)+'</span>':''}${g.status?' <span class="hint">· '+esc(g.status)+'</span>':''} <span class="hint">›</span></div>`).join('') : '<div class="pc-note">✓ All set.</div>';
    const sev = pct>=90?'risk-low':pct>=70?'risk-elev':'risk-high';
    return `<div class="cmd-sub">${title} <span class="risk ${sev}" style="margin-left:6px">${done}/${total} · ${pct}%</span></div>${gaps}`;
  };
  $('momentsBody').innerHTML =
    step('1 · Warm welcome — Care Card known in the first hour', m.welcomed.done, m.active, m.welcomed.gap, 'Not yet welcomed')+
    step('2 · Anticipation — a personal touch delivered', m.anticipated.done, m.active, m.anticipated.gap, 'No touch delivered yet')+
    step('3 · Fond farewell — Dignity Kit at departure (last 30d)', m.farewell.done, m.farewell.total, m.farewell.gap, 'Left without a kit logged');
  const overall = m.active? Math.round((m.welcomed.done+m.anticipated.done)/(m.active*2)*100):100;
  if($('momentsBadge')) $('momentsBadge').textContent = overall+'% served';
}
async function loadVoice(){
  if(!$('cmdVoice')) return;
  try{ const v=await api('/voice');
    const reqs=(v.requests||[]).map(r=>`<div class="pc-note">🛎 <strong>${esc(r.client)}</strong>${r.room?' <span class="hint">· '+esc(r.room)+'</span>':''} asked: “${esc(r.text)}”${r.priority==='Urgent'?' <span class="risk risk-high">urgent</span>':''} <span class="hint">— ${esc((r.at||'').slice(5))}</span></div>`).join('');
    const chk=(v.checkins||[]).map(x=>`<div class="pc-note">💬 <strong>${esc(x.client||'Client')}</strong>${x.room?' <span class="hint">· '+esc(x.room)+'</span>':''}: “${esc(x.answer)}” <span class="hint">— ${esc(x.shift||'')} ${esc((x.at||'').slice(5))}${x.by?' · '+esc(x.by):''}</span></div>`).join('');
    $('cmdVoice').innerHTML = (reqs||chk) ? ((reqs?`<div class="cmd-sub">What they're asking for (kiosk)</div>${reqs}`:'')+(chk?`<div class="cmd-sub">What they're telling us (rounds)</div>${chk}`:'')) : '<div class="hint">No client voice yet. Ask the shift question on Rounds, and put the kiosk on the unit.</div>';
  }catch(e){ $('cmdVoice').innerHTML='<div class="hint">'+esc(e.message)+'</div>'; }
}
async function loadLeadership(){
  let d; try{ d=await api('/leadership'); }catch(e){ $('leadBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const o=d.ops, c=d.clinical;
  const holders=h=>h&&h.length?h.join(', '):'<span class="hint">unassigned</span>';
  const scColor=(p,t)=>p===t?'var(--good)':p>=t-2?'#9a6a1f':'var(--danger)';
  const pctColor=p=>p==null?'var(--muted)':p>=90?'var(--good)':p>=60?'#9a6a1f':'var(--danger)';
  const day=s=>new Date(s.date+'T12:00').toLocaleDateString('en-US',{weekday:'narrow'});
  const opsCard=`<div class="card" style="border-left:4px solid var(--gold)">
    <div class="cmd-hero-row"><div><h3 style="margin:0">⚙️ Operations</h3><div class="hint">${holders(o.holders)}</div></div>
      <button class="btn btn-ghost btn-sm sans" onclick="setDashPreview('Director of Operations');show('dashboard')">Open dashboard →</button></div>
    <div class="ret-cards" style="margin-top:8px">
      <div class="ret-card"><div class="n" style="color:${scColor(o.scorePass,o.scoreTotal)}">${o.scorePass}/${o.scoreTotal}</div><div class="l">Systems holding</div></div>
      <div class="ret-card"><div class="n" style="color:${pctColor(o.routinePct)}">${o.routinePct!=null?o.routinePct+'%':'—'}</div><div class="l">Routine run (7d)</div></div>
      <div class="ret-card ${o.rescuesWeek?'rc-high':''}"><div class="n">${o.rescuesWeek}</div><div class="l">CEO rescues (wk)</div></div>
      <div class="ret-card ${o.projectsOverdue?'rc-high':''}"><div class="n">${o.projectsOverdue}</div><div class="l">Projects overdue</div></div>
    </div>
    <div style="display:flex;gap:4px;margin-top:8px">${(o.routineSeries||[]).map(s=>`<div title="${s.date}: ${s.done}/${s.due}" style="flex:1;text-align:center"><div style="height:22px;display:flex;align-items:flex-end;justify-content:center"><div style="width:13px;background:${pctColor(s.pct)};height:${s.pct==null?3:Math.max(3,Math.round(s.pct/100*22))}px;border-radius:2px"></div></div><div class="hint" style="font-size:10px">${day(s)}</div></div>`).join('')}</div>
    ${o.misses.length?`<div class="pc-note" style="margin-top:8px;border-left:3px solid var(--danger)"><strong>Not holding:</strong> ${o.misses.map(esc).join(' · ')}</div>`:'<div class="pc-note" style="margin-top:8px;border-left:3px solid var(--good)">All systems holding. 🎯</div>'}
    <button class="btn btn-ghost btn-sm sans" style="margin-top:8px" onclick="show('operations')">Open Operations hub →</button></div>`;
  const clinCard=`<div class="card">
    <div class="cmd-hero-row"><div><h3 style="margin:0">🩺 Clinical</h3><div class="hint">${holders(c.holders)}</div></div>
      <button class="btn btn-ghost btn-sm sans" onclick="setDashPreview('Clinical Director');show('dashboard')">Open dashboard →</button></div>
    <div class="ret-cards" style="margin-top:8px">
      <div class="ret-card"><div class="n" style="color:${c.served>=80?'var(--good)':c.served>=60?'#9a6a1f':'var(--danger)'}">${c.served}%</div><div class="l">3 Steps of Service</div></div>
      <div class="ret-card"><div class="n">${c.census}</div><div class="l">Census</div></div>
      <div class="ret-card ${c.atRisk?'rc-high':''}"><div class="n">${c.atRisk}</div><div class="l">At risk</div></div>
      <div class="ret-card ${c.amaToday?'rc-high':''}"><div class="n">${c.amaToday}</div><div class="l">AMA today</div></div>
      <div class="ret-card ${c.openIncidents?'rc-warn':''}"><div class="n">${c.openIncidents}</div><div class="l">Open incidents</div></div>
      <div class="ret-card ${c.dcMissing?'rc-high':''}"><div class="n">${c.dcMissing}</div><div class="l">Discharges missing form</div></div>
    </div></div>`;
  $('leadBody').innerHTML = opsCard + clinCard + `<p class="hint">Executive Director: ${holders(d.execHolders)}. More seats show their scorecard + routine here as they're built.</p>`;
}
/* ---- 90-Day Belonging Plan ---- */
let PLAN_DATA=null;
function planTaskRow(t){
  const badge = t.status==='done'?'<span class="risk risk-low">done</span>'
    : t.status==='overdue'?'<span class="risk risk-high">overdue</span>'
    : t.status==='due'?'<span class="risk risk-warn">do now</span>'
    : '<span class="hint">upcoming · day '+t.day+'</span>';
  const link = t.view?` <a href="#" onclick="show('${t.view}');return false" class="hint">open ↗</a>`:'';
  return `<div class="pc-note" style="display:flex;gap:8px;align-items:flex-start;${t.status==='done'?'opacity:.6':''}">
    <input type="checkbox" ${t.done?'checked':''} onchange="togglePlanTask('${t.id}',this.checked)" style="margin-top:3px"/>
    <div style="flex:1"><div><strong>${esc(t.title)}</strong> ${badge}</div>
      <div class="hint" style="margin-top:2px">${esc(t.detail)}</div>
      <div class="hint" style="margin-top:2px">👤 ${esc(t.owner)}${link}${t.done_by?' · ✓ '+esc(t.done_by):''}</div></div></div>`;
}
async function loadPlan(){
  let d; try{ d=await api('/plan'); }catch(e){ if($('planTasks'))$('planTasks').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  PLAN_DATA=d;
  if($('planStart')&&d.start) $('planStart').value=d.start;
  const m=d.metrics||{};
  $('planHeader').innerHTML=`<div style="font-size:15px"><strong>Day ${d.day} of 90 · ${esc(d.phaseLabel)}</strong> — ${esc(d.thisWeek)}</div>
    <div class="hint" style="margin-top:2px">${d.counts.done}/${d.counts.total} steps done · ${d.counts.openNow} open now</div>`;
  const bl=m.belonging||{};
  $('planMetrics').innerHTML=`
    <div class="ret-card ${bl.avg!=null&&bl.avg<7?'rc-high':''}"><div class="n">${bl.avg==null?'—':bl.avg+'/10'}</div><div class="l">Belonging pulse${bl.n?' ('+bl.n+')':''}</div></div>
    <div class="ret-card ${m.weekendRate!=null&&m.weekdayRate!=null&&m.weekendRate>m.weekdayRate?'rc-high':''}"><div class="n">${m.weekendRate==null?'—':m.weekendRate+'%'}</div><div class="l">Weekend AMA rate (90d)</div></div>
    <div class="ret-card"><div class="n">${m.weekdayRate==null?'—':m.weekdayRate+'%'}</div><div class="l">Weekday AMA rate</div></div>
    <div class="ret-card"><div class="n">${m.census}</div><div class="l">Census (toward 30)</div></div>
    <div class="ret-card"><div class="n">${m.recognitions7d}</div><div class="l">Recognitions · 7d</div></div>`;
  // group tasks by week, in order
  const weeks=[]; const seen={};
  d.tasks.forEach(t=>{ if(!seen[t.week]){ seen[t.week]=[]; weeks.push(t.week); } seen[t.week].push(t); });
  $('planTasks').innerHTML = weeks.map(w=>`<div class="card"><h3 style="font-size:15px">${esc(w)}</h3>${seen[w].map(planTaskRow).join('')}</div>`).join('');
}
async function loadPlanMorning(){
  const boxes=['planMorning','planMorningOps'].map(id=>$(id)).filter(Boolean); if(!boxes.length) return;
  let d; try{ d=await api('/plan'); }catch(e){ boxes.forEach(b=>b.style.display='none'); return; }
  const open=d.tasks.filter(t=>t.status==='overdue'||t.status==='due');
  let pbLine='';
  try{ const pb=await api('/playbook'); const all=pb.parts.flatMap(p=>p.items); const op=all.filter(i=>i.status==='on'||i.status==='set').length; const watch=all.filter(i=>i.status==='watch').length;
    pbLine=`<div class="hint" style="margin:6px 0;cursor:pointer" onclick="show('playbook')">📋 Playbook health: <strong>${op}/${all.length} operational</strong>${watch?' · <span style="color:#a60">'+watch+' need attention</span>':''} <span style="color:var(--muted)">— open scorecard ›</span></div>`;
  }catch(e){}
  const html=`<div class="cmd-hero-row"><div><h3 style="margin:0">📋 Today on the 90-Day Plan — Day ${d.day} · ${esc(d.phaseLabel)}</h3>
      <p class="sub sans" style="margin:2px 0 0">${esc(d.thisWeek)}</p></div>
      <button class="btn btn-ghost btn-sm sans" onclick="show('plan')">Full plan ↗</button></div>
    ${pbLine}
    ${d.focus?`<div style="margin:10px 0;padding:10px 14px;background:#faf6ee;border-left:3px solid #c8a44d;border-radius:4px"><div class="hint" style="text-transform:uppercase;letter-spacing:.5px;font-size:10px">Focus today</div><strong>${esc(d.focus.title)}</strong><div class="hint" style="margin-top:2px">${esc(d.focus.detail)}</div></div>`:''}
    ${open.length?open.map(planTaskRow).join(''):'<div class="hint">✓ Nothing open right now — you\'re on track.</div>'}`;
  boxes.forEach(b=>{ b.style.display=''; b.innerHTML=html; });
}
async function togglePlanTask(id,done){
  try{ await api('/plan/task',{method:'POST',body:JSON.stringify({id,done})}); if($('plan')&&$('plan').classList.contains('active'))loadPlan(); loadPlanMorning(); }catch(e){ alert(e.message); }
}
async function setPlanStart(){
  const date=$('planStart')?$('planStart').value:''; if(!date) return;
  try{ await api('/plan/start',{method:'POST',body:JSON.stringify({date})}); loadPlan(); loadPlanMorning(); }catch(e){ alert(e.message); }
}
/* ---- Excellence Standards ---- */
async function loadExcellence(){
  let d; try{ d=await api('/excellence'); }catch(e){ if($('exDefects'))$('exDefects').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const c=d.cfg, set=(id,v)=>{ if($(id)) $(id).value=v||''; };
  set('ex_goalText',c.goalText); set('ex_goalTarget',c.goalTarget); set('ex_goalDeadline',c.goalDeadline);
  set('ex_empowerment',c.empowerment); set('ex_budget',c.budget); set('ex_nonneg',c.nonneg); set('ex_anticipation',c.anticipation); set('ex_interview',c.interview);
  const m=d.metrics||{}; const tgt=parseFloat(c.goalTarget)||null;
  const hit=tgt!=null&&m.ratio!=null&&m.ratio<=tgt;
  $('exGoalProgress').innerHTML=`
    <div class="ret-card ${m.ratio!=null&&m.ratio>1.5?'rc-high':''}"><div class="n">${m.ratio==null?'—':m.ratio+'×'}</div><div class="l">Weekend ÷ weekday AMA now</div></div>
    <div class="ret-card ${hit?'rc-warn':''}"><div class="n">${tgt?tgt+'×':'—'}</div><div class="l">Target ${hit?'✓ hit':''}</div></div>
    <div class="ret-card"><div class="n">${m.weekendRate==null?'—':m.weekendRate+'%'}</div><div class="l">Weekend AMA rate</div></div>
    <div class="ret-card"><div class="n">${m.weekdayRate==null?'—':m.weekdayRate+'%'}</div><div class="l">Weekday AMA rate</div></div>
    <div class="ret-card ${(d.comfort&&d.comfort.avgMin>15)?'rc-high':''}"><div class="n">${d.comfort&&d.comfort.avgMin!=null?d.comfort.avgMin+'m':'—'}</div><div class="l">Avg time to comfort</div></div>`;
  // AMA defect log
  const wkEnd=d.defects.filter(x=>x.weekend).length, wkDay=d.defects.length-wkEnd;
  $('exDefectStats').innerHTML=`
    <div class="ret-card"><div class="n">${d.defects.length}</div><div class="l">AMAs · 60 days</div></div>
    <div class="ret-card ${wkEnd>wkDay?'rc-high':''}"><div class="n">${wkEnd}</div><div class="l">On weekends</div></div>
    <div class="ret-card"><div class="n">${wkDay}</div><div class="l">On weekdays</div></div>
    <div class="ret-card"><div class="n">${d.nearMisses.length}</div><div class="l">Near-misses saved</div></div>`;
  const rows=d.defects.map(x=>`<div class="pc-note" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="min-width:150px"><strong>${esc(x.name)}</strong> <span class="hint">${esc(x.date)}${x.weekend?' · weekend':''}</span></span>
      <input class="sans" style="flex:1;min-width:180px" value="${esc(x.root_cause)}" placeholder="root cause${x.reason?' (Kipu: '+esc(x.reason).slice(0,40)+')':''}" onchange="tagRootCause(${x.client_id},'${esc(x.name).replace(/'/g,"\\'")}',${x.weekend?1:0},this.value)"/>
    </div>`).join('');
  const nm=d.nearMisses.map(x=>`<div class="pc-note">💪 <strong>${esc(x.client_name||'A patient')}</strong> — ${esc(x.root_cause)} <span class="hint">· ${esc(x.by_name||'')} ${esc(x.at||'')}${x.weekend?' · weekend':''}</span></div>`).join('');
  $('exDefects').innerHTML = (rows||'<div class="hint">No AMAs in the last 60 days.</div>') + (nm?'<div class="cmd-sub">Near-misses (talked back into bed)</div>'+nm:'');
}
async function saveExcellence(){
  const g=id=>($(id)||{}).value||'';
  const body={ goalText:g('ex_goalText'),goalTarget:g('ex_goalTarget'),goalDeadline:g('ex_goalDeadline'),empowerment:g('ex_empowerment'),budget:g('ex_budget'),nonneg:g('ex_nonneg'),anticipation:g('ex_anticipation'),interview:g('ex_interview') };
  try{ await api('/excellence/config',{method:'POST',body:JSON.stringify(body)}); if($('ex_msg'))$('ex_msg').textContent='✓ Saved'; setTimeout(()=>{if($('ex_msg'))$('ex_msg').textContent='';},2000); }catch(e){ if($('ex_msg'))$('ex_msg').textContent=e.message; }
}
async function tagRootCause(client_id,client_name,weekend,root_cause){
  try{ await api('/excellence/defect',{method:'POST',body:JSON.stringify({client_id,client_name,weekend,root_cause})}); }catch(e){ alert(e.message); }
}
async function addNearMiss(){
  const cause=($('ex_nmcause')||{}).value||''; if(!cause.trim()){ return; }
  try{ await api('/excellence/defect',{method:'POST',body:JSON.stringify({client_name:($('ex_nmname')||{}).value||'',root_cause:cause})}); $('ex_nmname').value='';$('ex_nmcause').value=''; loadExcellence(); }catch(e){ alert(e.message); }
}
/* ---- Comfort med response timer ---- */
async function loadComfortMeds(){
  const box=$('cmOpen'); if(!box) return;
  if($('cm_client')&&$('cm_client').options.length<=1) fillClientSelect($('cm_client'),'Pick patient');
  let d; try{ d=await api('/comfort-meds'); }catch(e){ return; }
  const s=d.stats||{};
  if($('cmStats')) $('cmStats').innerHTML=`
    <div class="ret-card ${s.avgMin!=null&&s.avgMin>15?'rc-high':''}"><div class="n">${s.avgMin==null?'—':s.avgMin+'m'}</div><div class="l">Avg time to comfort</div></div>
    <div class="ret-card ${s.within15Pct!=null&&s.within15Pct<80?'rc-warn':''}"><div class="n">${s.within15Pct==null?'—':s.within15Pct+'%'}</div><div class="l">Within 15 min</div></div>
    <div class="ret-card ${s.open?'rc-warn':''}"><div class="n">${s.open||0}</div><div class="l">Waiting now</div></div>`;
  box.innerHTML = (d.open.length?d.open.map(o=>`<div class="pc-note" style="display:flex;gap:8px;align-items:center;justify-content:space-between;${o.waiting>=15?'border-left:3px solid var(--danger)':''}">
      <span><strong>${esc(o.client_name)}</strong>${o.note?' — '+esc(o.note):''} <span class="hint">· ⏱ ${o.waiting}m${o.waiting>=15?' — overdue':''} · ${esc(o.requested_by||'')}</span></span>
      <button class="btn btn-gold btn-sm sans" onclick="giveComfortMed(${o.id})">Given ✓</button></div>`).join(''):'<div class="hint">No comfort meds waiting.</div>')
    + (d.recent.length?'<div class="cmd-sub">Recent</div>'+d.recent.map(r=>`<div class="pc-note">✓ <strong>${esc(r.client_name)}</strong> — ${r.mins}m <span class="hint">· ${esc(r.given_by||'')} ${esc(r.at||'')}</span></div>`).join(''):'');
}
async function logComfortMed(){
  const sel=$('cm_client'); const client_id=sel&&sel.value?sel.value:null;
  try{ await api('/comfort-meds',{method:'POST',body:JSON.stringify({client_id,note:($('cm_note')||{}).value||''})}); if($('cm_note'))$('cm_note').value=''; loadComfortMeds(); }catch(e){ alert(e.message); }
}
async function giveComfortMed(id){ try{ await api('/comfort-meds/'+id+'/given',{method:'POST'}); loadComfortMeds(); }catch(e){ alert(e.message); } }
/* ---- Sacred onboarding ---- */
async function loadOnboarding(){
  if(!$('ob_start').value) $('ob_start').value=today();
  let d; try{ d=await api('/onboarding'); }catch(e){ if($('obList'))$('obList').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('obList').innerHTML = d.hires.length ? d.hires.map(h=>{
    const byDay={1:[],21:[]}; h.tasks.forEach(t=>byDay[t.day].push(t));
    const grp=(day,label)=>`<div class="cmd-sub">${label}</div>`+byDay[day].map(t=>`<div class="pc-note" style="display:flex;gap:8px;align-items:flex-start;${t.done?'opacity:.6':''}">
        <input type="checkbox" ${t.done?'checked':''} onchange="toggleOnboard(${h.id},'${t.id}',this.checked)" style="margin-top:3px"/>
        <div><strong>${esc(t.title)}</strong><div class="hint">${esc(t.detail)}</div></div></div>`).join('');
    return `<div class="card" style="${h.day21Due?'border-left:4px solid var(--danger)':''}">
      <div class="cmd-hero-row"><div><h3 style="margin:0">${esc(h.name)}${h.role?' · '+esc(h.role):''}</h3>
        <p class="sub sans" style="margin:2px 0 0">Day ${h.day} · ${h.doneCount}/${h.total} done${h.day21Due?' · <strong style="color:var(--danger)">Day 21 check-in due</strong>':''}</p></div>
        <button class="btn btn-ghost btn-sm sans" onclick="removeOnboarding(${h.id},'${esc(h.name).replace(/'/g,"\\'")}')">Remove</button></div>
      ${grp(1,'Day 1 — immersion')}${grp(21,'Day 21 — reorientation')}</div>`;
  }).join('') : '<div class="card"><div class="empty">No one in onboarding yet. Add a new hire above.</div></div>';
}
async function addOnboarding(){
  const name=($('ob_name')||{}).value||''; if(!name.trim()){ if($('ob_msg'))$('ob_msg').textContent='Name?'; return; }
  try{ await api('/onboarding',{method:'POST',body:JSON.stringify({name,role:($('ob_role')||{}).value||'',start_date:($('ob_start')||{}).value||''})}); $('ob_name').value='';$('ob_role').value=''; loadOnboarding(); }catch(e){ if($('ob_msg'))$('ob_msg').textContent=e.message; }
}
async function toggleOnboard(id,task_id,done){ try{ await api('/onboarding/'+id+'/task',{method:'POST',body:JSON.stringify({task_id,done})}); loadOnboarding(); }catch(e){ alert(e.message); } }
async function removeOnboarding(id,name){ if(!confirm('Remove '+name+' from onboarding?'))return; try{ await api('/onboarding/'+id,{method:'DELETE'}); loadOnboarding(); }catch(e){ alert(e.message); } }
/* ---- Playbook scorecard ---- */
async function loadPlaybookScore(){
  let d; try{ d=await api('/playbook'); }catch(e){ if($('pbParts'))$('pbParts').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const all=d.parts.flatMap(p=>p.items);
  const cnt=s=>all.filter(i=>i.status===s).length;
  const dot=s=> s==='on'?'<span class="risk risk-low">live</span>' : s==='set'?'<span class="risk risk-low">set</span>' : s==='watch'?'<span class="risk risk-warn">watch</span>' : '<span class="risk risk-high">to do</span>';
  $('pbSummary').innerHTML=`
    <div class="ret-card"><div class="n">${cnt('on')+cnt('set')}/20</div><div class="l">Operational</div></div>
    <div class="ret-card ${cnt('watch')?'rc-warn':''}"><div class="n">${cnt('watch')}</div><div class="l">Needs attention</div></div>
    <div class="ret-card ${cnt('off')?'rc-high':''}"><div class="n">${cnt('off')}</div><div class="l">To set up</div></div>`;
  $('pbParts').innerHTML = d.parts.map(p=>`<div class="card"><h3 style="font-size:15px">${esc(p.part)}</h3>
    ${p.items.map(i=>`<div class="cmd-row" style="cursor:${i.view?'pointer':'default'}" ${i.view?`onclick="show('${i.view}')"`:''}>
        <div class="cmd-row-main"><strong>${i.n}. ${esc(i.title)}</strong><div class="hint">${esc(i.value||'')}</div></div>
        ${dot(i.status)}${i.view?'<span class="hint" style="margin-left:6px">›</span>':''}</div>`).join('')}</div>`).join('');
}
const usd=(n)=>'$'+Math.round(n||0).toLocaleString();
async function loadFinance(){
  let d; try{ d=await api('/finance/revenue'); }catch(e){ if($('finBreakdown'))$('finBreakdown').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const since = d.ledgerStart ? ' since '+esc(d.ledgerStart) : '';
  const sub='font-size:12px;margin-top:5px;color:#5a6671;font-weight:600';
  $('finKpis').innerHTML=`
    <div class="ret-card rc-elev"><div class="n">${usd(d.cumulative)}</div><div class="l">Revenue to date</div><div class="hint" style="${sub}">${d.cumulativeDays.toLocaleString()} billed days${since}</div></div>
    <div class="ret-card"><div class="n">${usd(d.mtd)}</div><div class="l">This month</div><div class="hint" style="${sub}">${d.mtdDays.toLocaleString()} days · ${esc(d.monthLabel)}</div></div>
    <div class="ret-card"><div class="n">${usd(d.todayBilled)}</div><div class="l">Billed today</div><div class="hint" style="${sub}">${d.censusCount} in service</div></div>
    <div class="ret-card"><div class="n">${usd(d.monthProjection)}</div><div class="l">Projected this month</div><div class="hint" style="${sub}">at today's census · ${d.daysInMonth} days</div></div>
    <div class="ret-card"><div class="n">${usd(d.annualRunRate)}</div><div class="l">Annual run-rate</div><div class="hint" style="${sub}">today × 365</div></div>
    ${d.unrated?`<div class="ret-card rc-warn"><div class="n">${d.unrated}</div><div class="l">No rate set</div><div class="hint" style="${sub}">not counted — set below</div></div>`:''}`;
  const mtdRows = (d.mtdByLoc||[]).filter(r=>r.total>0 || r.days>0);
  $('finBreakdown').innerHTML = `<div class="card"><h3>Today's census by level of care</h3>
    <table class="tbl"><thead><tr><th>Level of care</th><th style="text-align:right">Clients</th><th style="text-align:right">Daily rate</th><th style="text-align:right">Revenue / day</th></tr></thead>
    <tbody>${d.census.map(r=>`<tr${r.rate?'':' style="color:var(--muted)"'}><td>${esc(r.label)}</td><td style="text-align:right">${r.count}</td><td style="text-align:right">${r.rate?usd(r.rate):'<span class="hint">— set rate</span>'}</td><td style="text-align:right;font-weight:600">${r.rate?usd(r.daily):'—'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No one in service.</td></tr>'}</tbody>
    <tfoot><tr style="border-top:2px solid var(--line);font-weight:700"><td>Total</td><td style="text-align:right">${d.censusCount}</td><td></td><td style="text-align:right">${usd(d.dailyTotal)}/day</td></tr></tfoot></table>
    <p class="hint" style="margin-top:8px">Each day is billed at the level of care the client was actually at that day, accumulated since ${esc(d.ledgerStart||d.asOf)}. As of ${esc(d.asOf)}.</p></div>
    <div class="card"><h3>This month so far (${esc(d.monthLabel)}) — billed by level</h3>
    <table class="tbl"><thead><tr><th>Level of care</th><th style="text-align:right">Billed days</th><th style="text-align:right">Revenue</th></tr></thead>
    <tbody>${mtdRows.map(r=>`<tr><td>${esc(r.label)}</td><td style="text-align:right">${r.days.toLocaleString()}</td><td style="text-align:right;font-weight:600">${usd(r.total)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Nothing billed yet this month.</td></tr>'}</tbody>
    <tfoot><tr style="border-top:2px solid var(--line);font-weight:700"><td>Total</td><td style="text-align:right">${d.mtdDays.toLocaleString()}</td><td style="text-align:right">${usd(d.mtd)}</td></tr></tfoot></table></div>`;
  const rates=d.rates||{};
  $('finRates').innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:10px">${d.levels.map(l=>`
    <div class="field" style="margin:0;min-width:200px"><label>${esc(l.label)}</label>
      <div style="display:flex;align-items:center;gap:4px"><span class="hint">$</span><input type="number" min="0" step="1" data-loc="${esc(l.code)}" value="${rates[l.code]||''}" placeholder="0" style="width:110px"/><span class="hint">/day</span></div></div>`).join('')}</div>`;
}
async function saveRates(){
  const rates={}; document.querySelectorAll('#finRates input[data-loc]').forEach(i=>{ rates[i.dataset.loc]=+i.value||0; });
  if($('fin_msg'))$('fin_msg').textContent='Saving…';
  try{ await api('/finance/rates',{method:'POST',body:JSON.stringify({rates})}); if($('fin_msg'))$('fin_msg').textContent='✓ Saved'; loadFinance(); }catch(e){ if($('fin_msg'))$('fin_msg').textContent=e.message; }
}
async function recomputeRevenue(){
  if(!confirm('Re-bill the entire revenue history at the current rates and known level-of-care history? This replaces the accumulated ledger.')) return;
  if($('fin_msg'))$('fin_msg').textContent='Recomputing…';
  try{ await api('/finance/recompute',{method:'POST'}); if($('fin_msg'))$('fin_msg').textContent='✓ Rebuilt'; loadFinance(); }catch(e){ if($('fin_msg'))$('fin_msg').textContent=e.message; }
}
let EXP_MONTH=null;
async function loadExpenses(month){
  if(month!=null) EXP_MONTH=month;
  const q = EXP_MONTH ? ('?month='+encodeURIComponent(EXP_MONTH)) : '';
  let d; try{ d=await api('/finance/expenses'+q); }catch(e){ if($('expBody'))$('expBody').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  EXP_MONTH=d.month;
  const sub='font-size:12px;margin-top:5px;color:#5a6671;font-weight:600';
  const pct = d.budgetTotal ? Math.round(d.actualTotal/d.budgetTotal*100) : null;
  // biggest overage line — "where we went wrong"
  const overs = d.rows.filter(r=>r.variance!=null && r.variance<0).sort((a,b)=>a.variance-b.variance);
  const worst = overs[0];
  $('expKpis').innerHTML=`
    <div class="ret-card"><div class="n">${usd(d.budgetTotal)}</div><div class="l">Budget · ${esc(d.month)}</div></div>
    <div class="ret-card"><div class="n">${usd(d.actualTotal)}</div><div class="l">Actual</div><div class="hint" style="${sub}">${pct!=null?pct+'% of budget':''}</div></div>
    <div class="ret-card ${d.variance<0?'rc-high':'rc-elev'}"><div class="n">${usd(Math.abs(d.variance))}</div><div class="l">${d.variance<0?'Over budget':'Under budget'}</div></div>
    ${worst?`<div class="ret-card rc-high"><div class="n">${usd(-worst.variance)}</div><div class="l">Worst line</div><div class="hint" style="${sub}">${esc(worst.cat)}</div></div>`:''}
    <div class="ret-card"><div class="n">${overs.length}</div><div class="l">Lines over budget</div></div>`;
  const vcell=(v)=>v==null?'<span class="hint">—</span>':`<span style="color:${v<0?'var(--danger)':'#2f6b44'};font-weight:600">${v<0?'-':'+'}${usd(Math.abs(v))}</span>`;
  const money=(id,cat,val,ph='')=>`<div style="display:inline-flex;align-items:center;gap:2px"><span class="hint">$</span><input data-${id}="${esc(cat)}" type="number" min="0" value="${val!=null?val:''}" placeholder="${ph}" style="width:100px;text-align:right"/></div>`;
  const rowHtml=(r)=>`<tr><td>${esc(r.cat)}${r.computed?' <span class="hint">· auto</span>':''}</td>
        <td style="text-align:right">${r.budgetComputed?`<strong>${usd(r.budget)}</strong> <span class="hint">· ${r.type==='ppd'?'PPD':'model'}</span>`:money('bud',r.cat,r.budget||'')}</td>
        <td style="text-align:right">${(r.computed||r.type==='payroll')?'<span class="hint">—</span>':`<div style="display:inline-flex;align-items:center;gap:2px"><span class="hint">$</span><input data-ppd="${esc(r.cat)}" type="number" min="0" step="0.5" value="${r.ppd||''}" placeholder="—" title="Set a per-patient-per-day rate to drive this line off census" style="width:64px;text-align:right"/></div>`}</td>
        <td style="text-align:right">${r.computed?`<strong>${usd(r.actual)}</strong>`:money('act',r.cat,r.actual)}</td>
        <td style="text-align:right">${vcell(r.variance)}</td>
        <td style="text-align:right">${r.computed?'':`<button class="btn btn-ghost btn-sm sans no-print" onclick="removeExpenseLine('${esc(r.cat)}')" title="Remove line">×</button>`}</td></tr>`;
  // group rows by P&L group, with a subtotal per group
  let body='', cg=null, gb=0, ga=0;
  const subtotal=()=>{ if(cg){ body+=`<tr style="background:#faf7f0;font-weight:600"><td>Subtotal — ${esc(cg)}</td><td style="text-align:right">${usd(gb)}</td><td></td><td style="text-align:right">${usd(ga)}</td><td style="text-align:right">${vcell(gb-ga)}</td><td></td></tr>`; } };
  for(const r of d.rows){ const g=r.group||''; if(g!==cg){ subtotal(); cg=g; gb=0; ga=0; if(g) body+=`<tr><td colspan="6" style="font-weight:700;padding-top:12px;color:var(--navy)">${esc(g)}</td></tr>`; } gb+=r.budget; ga+=(r.actual||0); body+=rowHtml(r); }
  subtotal();
  const monthSel=`<select onchange="loadExpenses(this.value)" class="sans" style="padding:4px 8px;border:1px solid var(--line);border-radius:6px">${(d.months||[d.month]).map(m=>`<option value="${m}"${m===d.month?' selected':''}>${m}${m===d.curMonth?' (current)':''}</option>`).join('')}</select>`;
  const be=d.breakeven||{};
  const beCard = `<div class="card" style="border-left:4px solid #c8a44d;background:#fbf7ee">
    <h3 style="margin:0">Break-even census</h3>
    <p class="sub sans" style="margin-top:2px">Most costs are fixed — the lever is census. Covering ${esc(d.month)}'s <strong>${usd(be.costBase)}</strong> cost base needs about <strong>${usd(be.costPerDay)}/day</strong> of revenue.</p>
    <div class="ret-cards" style="margin-top:8px">
      <div class="ret-card rc-elev"><div class="n">${be.breakevenCensus!=null?be.breakevenCensus:'—'}</div><div class="l">Break-even census</div><div class="hint" style="font-size:11px;margin-top:4px;color:#5a6671;font-weight:600">avg patients/day</div></div>
      <div class="ret-card"><div class="n">${be.census}</div><div class="l">Census now</div></div>
      <div class="ret-card ${be.gap>0?'rc-high':'rc-elev'}"><div class="n">${be.gap>0?'+'+be.gap:(be.gap||0)}</div><div class="l">${be.gap>0?'Patients short':'Cushion'}</div></div>
      <div class="ret-card"><div class="n">${usd(be.avgPerDiem)}</div><div class="l">Blended per-diem</div></div>
      <div class="ret-card"><div class="n">${usd(be.dailyRevenue)}</div><div class="l">Revenue / day now</div></div>
    </div></div>`;
  $('expBody').innerHTML=beCard+`<div class="card"><div class="cmd-hero-row"><h3 style="margin:0">Budget vs actual</h3><div style="display:flex;gap:8px;align-items:center">${monthSel}<button class="btn btn-gold sans" onclick="saveExpenses()">Save</button></div></div>
    <table class="tbl" style="margin-top:8px"><thead><tr><th>Line</th><th style="text-align:right">Budget / mo</th><th style="text-align:right">PPD</th><th style="text-align:right">Actual</th><th style="text-align:right">Variance</th><th></th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr style="border-top:2px solid var(--line);font-weight:700"><td>Total expenses</td><td style="text-align:right">${usd(d.budgetTotal)}</td><td></td><td style="text-align:right">${usd(d.actualTotal)}</td><td style="text-align:right">${vcell(d.variance)}</td><td></td></tr></tfoot></table>
    <div style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input id="exp_newcat" placeholder="New expense line" style="width:220px"/><button class="btn btn-ghost btn-sm sans" onclick="addExpenseLine()">+ Add line</button><span class="hint" id="exp_msg"></span></div>
    <p class="hint" style="margin-top:8px">Variance = budget − actual; <span style="color:var(--danger)">red is over budget</span>. Set a <strong>PPD</strong> ($/patient/day) on a line (e.g. Client Meals) to budget it off census (${d.census} patients). ${d.payrollItemized?'Payroll is itemized below (Salaries, Taxes, Benefits…).':'Payroll is live from covered shifts + salaried.'} As of ${esc(d.asOf)}.</p></div>
    <div class="card"><h3>Payroll by role — ${esc(d.month)}</h3>
    <table class="tbl"><thead><tr><th>Role</th><th style="text-align:right">Shifts</th><th style="text-align:right">Hours</th><th style="text-align:right">Cost</th></tr></thead>
    <tbody>${(d.payroll.byRole||[]).map(r=>`<tr><td>${esc(r.role)}</td><td style="text-align:right">${r.shifts}</td><td style="text-align:right">${r.hours.toLocaleString()}</td><td style="text-align:right;font-weight:600">${usd(r.cost)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No covered shifts this month.</td></tr>'}</tbody></table>
    <p class="hint" style="margin-top:8px">Role cost shown at base rate; the overtime premium (${usd(d.payroll.otCost)}) is added into the totals above.</p></div>
    <div class="card"><div class="cmd-hero-row"><h3 style="margin:0">Payroll budget — from the staffing model</h3><button class="btn btn-gold sans" onclick="saveStaffingRates()">Save rates</button></div>
      <p class="sub sans" style="margin-top:4px">Budget = needed headcount × shift hours × rate, every day × ${d.payrollBudget.daysInMonth} days = <strong>${usd(d.payrollBudget.monthly)}/mo</strong> (${usd(d.payrollBudget.perDay)}/day). Edit a line's rate to update the budget.</p>
      ${(d.payrollBudget.missingRate||[]).length?`<div class="pc-note" style="border-left:3px solid var(--gold)">⚠ Set a rate for: ${d.payrollBudget.missingRate.map(esc).join(', ')}</div>`:''}
      <table class="tbl"><thead><tr><th>Block</th><th>Role · shift</th><th style="text-align:right">Needed</th><th style="text-align:right">Hrs</th><th style="text-align:right">$/hr</th><th style="text-align:right">Cost/day</th></tr></thead>
      <tbody>${(d.payrollBudget.lines||[]).map(l=>`<tr><td><span class="hint">${esc(l.block)}</span></td><td>${esc(l.role)} <span class="hint">· ${esc(l.shift)}</span></td><td style="text-align:right">${l.needed}</td><td style="text-align:right">${l.hours}</td><td style="text-align:right"><input data-sb="${l.id}" type="number" min="0" step="0.5" value="${l.rate||''}" placeholder="0" style="width:80px;text-align:right"/></td><td style="text-align:right;font-weight:600">${usd(l.perDay)}</td></tr>`).join('')}</tbody>
      <tfoot><tr style="border-top:2px solid var(--line);font-weight:700"><td colspan="5">Per day</td><td style="text-align:right">${usd(d.payrollBudget.perDay)}</td></tr></tfoot></table>
      <div class="pc-note" style="margin-top:8px;border-left:3px solid var(--gold)">
        Hourly (model) ${usd(d.payrollBudget.hourlyMonthly)} + Salaried ${usd(d.payrollBudget.salariedMonthly)} = <strong>base ${usd(d.payrollBudget.baseMonthly)}/mo</strong><br>
        + Taxes (${d.payrollBudget.burden.tax}%) ${usd(d.payrollBudget.taxesMonthly)} + Benefits (${d.payrollBudget.burden.benefits}%) ${usd(d.payrollBudget.benefitsMonthly)} = <strong>loaded ${usd(d.payrollBudget.monthly)}/mo</strong>
      </div>
      <div style="margin-top:10px;display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div class="field" style="margin:0"><label>Employer taxes %</label><input id="bd_tax" type="number" min="0" step="0.01" value="${d.payrollBudget.burden.tax}" style="width:100px"/></div>
        <div class="field" style="margin:0"><label>Benefits %</label><input id="bd_ben" type="number" min="0" step="0.01" value="${d.payrollBudget.burden.benefits}" style="width:100px"/></div>
        <button class="btn btn-ghost sans" onclick="saveBurden()">Save taxes & benefits</button>
        <span class="hint">Applied to all payroll — budget and actual.</span>
      </div></div>
    <div class="card"><div class="cmd-hero-row"><h3 style="margin:0">Salaried roles <span class="hint" style="font-weight:400">— not on the shift schedule</span></h3><button class="btn btn-gold sans" onclick="saveSalaried()">Save salaried</button></div>
      <p class="sub sans" style="margin-top:4px">Executive Director, BD reps, Director of Operations, Medical Director, NP, etc. Their monthly cost is added to the payroll budget (and prorated into actual: ${usd(d.salariedActual)} so far this month).</p>
      <table class="tbl"><thead><tr><th>Title</th><th style="text-align:right">$ / month</th><th></th></tr></thead>
      <tbody id="salRows">${(d.payrollBudget.salaried||[]).map(s=>`<tr><td><input data-sal-title type="text" value="${esc(s.title)}" style="width:220px"/></td><td style="text-align:right"><div style="display:inline-flex;align-items:center;gap:2px"><span class="hint">$</span><input data-sal-monthly type="number" min="0" value="${s.monthly||''}" placeholder="0" style="width:110px;text-align:right"/></div></td><td style="text-align:right"><button class="btn btn-ghost btn-sm sans no-print" onclick="this.closest('tr').remove()" title="Remove">×</button></td></tr>`).join('')}</tbody>
      <tfoot><tr style="border-top:2px solid var(--line);font-weight:700"><td>Total</td><td style="text-align:right">${usd(d.payrollBudget.salariedMonthly)}/mo</td><td></td></tr></tfoot></table>
      <div style="margin-top:8px"><button class="btn btn-ghost btn-sm sans" onclick="addSalariedRow()">+ Add role</button></div></div>`;
  // Config — shift hours, role rates, staff rates
  const rr=d.roleRates||{}; const sh=d.shiftHours||{};
  $('expConfig').innerHTML=`
    <div class="card"><h3>Shift length (hours)</h3>
      <p class="sub sans" style="margin-top:0">How many hours each covered shift counts as — drives the payroll math.</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${['Morning','Day','Evening','Night'].map(p=>`
        <div class="field" style="margin:0"><label>${p}</label><input data-sh="${p}" type="number" min="0" step="0.5" value="${sh[p]!=null?sh[p]:''}" style="width:80px"/></div>`).join('')}</div>
      <div style="margin-top:10px"><button class="btn btn-ghost sans" onclick="saveShiftHours()">Save hours</button></div>
    </div>
    <div class="card"><h3>Pay rates</h3>
      <p class="sub sans" style="margin-top:0">Per-person rate is used when set; otherwise the role default applies. Overtime over 40 hrs/week pays 1.5×.</p>
      <h4 style="margin:8px 0 4px">Role defaults ($/hr)</h4>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${(d.roles||[]).map(role=>`
        <div class="field" style="margin:0;min-width:150px"><label>${esc(role)}</label><div style="display:flex;align-items:center;gap:4px"><span class="hint">$</span><input data-rr="${esc(role)}" type="number" min="0" step="0.5" value="${rr[role]||''}" placeholder="0" style="width:90px"/></div></div>`).join('')}</div>
      <div style="margin-top:8px"><button class="btn btn-ghost sans" onclick="saveRoleRates()">Save role rates</button></div>
      <h4 style="margin:14px 0 4px">Per-person ($/hr) <span class="hint" style="font-weight:400">— blank = use role default</span></h4>
      <table class="tbl"><thead><tr><th>Staff</th><th>Role</th><th style="text-align:right">$/hr</th></tr></thead>
        <tbody>${(d.staff||[]).map(s=>`<tr><td>${esc(s.name)}</td><td><span class="hint">${esc(s.job_role||'')}</span></td><td style="text-align:right"><input data-sr="${s.id}" type="number" min="0" step="0.5" value="${s.hourly_rate!=null?s.hourly_rate:''}" placeholder="${rr[s.job_role]||'0'}" style="width:80px;text-align:right"/></td></tr>`).join('')}</tbody></table>
      <div style="margin-top:10px"><button class="btn btn-gold sans" onclick="saveStaffRates()">Save staff rates</button> <span class="hint" id="rate_msg"></span></div>
    </div>`;
}
function gatherExpenses(extraCat){
  const budgets={}; document.querySelectorAll('#expBody input[data-bud]').forEach(i=>{ budgets[i.dataset.bud]=+i.value||0; });
  const actuals={}; document.querySelectorAll('#expBody input[data-act]').forEach(i=>{ actuals[i.dataset.act]=i.value; });
  const ppd={}; document.querySelectorAll('#expBody input[data-ppd]').forEach(i=>{ ppd[i.dataset.ppd]=i.value; });
  const cats=[...document.querySelectorAll('#expBody input[data-ppd]')].map(i=>i.dataset.ppd);
  if(extraCat) cats.push(extraCat);
  return { cats, budgets, actuals, ppd, month: EXP_MONTH };
}
function gatherSalaried(){
  const roles=[]; document.querySelectorAll('#salRows tr').forEach(tr=>{ const t=tr.querySelector('[data-sal-title]'), m=tr.querySelector('[data-sal-monthly]'); if(t&&t.value.trim()) roles.push({title:t.value.trim(), monthly:+(m&&m.value)||0}); });
  return roles;
}
function addSalariedRow(){
  const tb=$('salRows'); if(!tb) return;
  const tr=document.createElement('tr');
  tr.innerHTML=`<td><input data-sal-title type="text" placeholder="Title" style="width:220px"/></td><td style="text-align:right"><div style="display:inline-flex;align-items:center;gap:2px"><span class="hint">$</span><input data-sal-monthly type="number" min="0" placeholder="0" style="width:110px;text-align:right"/></div></td><td style="text-align:right"><button class="btn btn-ghost btn-sm sans no-print" onclick="this.closest('tr').remove()">×</button></td>`;
  tb.appendChild(tr);
}
async function saveSalaried(){
  try{ await api('/finance/salaried',{method:'POST',body:JSON.stringify({roles:gatherSalaried()})}); loadExpenses(); }catch(e){ alert(e.message); }
}
async function saveBurden(){
  try{ await api('/finance/burden',{method:'POST',body:JSON.stringify({tax:($('bd_tax')||{}).value||0,benefits:($('bd_ben')||{}).value||0})}); loadExpenses(); }catch(e){ alert(e.message); }
}
async function saveExpenses(){
  if($('exp_msg'))$('exp_msg').textContent='Saving…';
  try{ await api('/finance/expenses-save',{method:'POST',body:JSON.stringify(gatherExpenses())}); if($('exp_msg'))$('exp_msg').textContent='✓ Saved'; loadExpenses(); }
  catch(e){ if($('exp_msg'))$('exp_msg').textContent=e.message; }
}
async function addExpenseLine(){
  const name=($('exp_newcat')||{}).value||''; if(!name.trim()){ if($('exp_msg'))$('exp_msg').textContent='Name the line first'; return; }
  try{ await api('/finance/expenses-save',{method:'POST',body:JSON.stringify(gatherExpenses(name.trim()))}); loadExpenses(); }
  catch(e){ if($('exp_msg'))$('exp_msg').textContent=e.message; }
}
async function removeExpenseLine(cat){
  if(!confirm('Remove the "'+cat+'" line? Its budget and entered actuals are cleared.')) return;
  const g=gatherExpenses(); g.cats=g.cats.filter(c=>c!==cat); delete g.budgets[cat]; delete g.actuals[cat]; delete g.ppd[cat];
  try{ await api('/finance/expenses-save',{method:'POST',body:JSON.stringify(g)}); loadExpenses(); }catch(e){ alert(e.message); }
}
async function saveStaffingRates(){
  const rates={}; document.querySelectorAll('#expBody input[data-sb]').forEach(i=>{ rates[i.dataset.sb]=i.value; });
  try{ await api('/finance/staffing-rate',{method:'POST',body:JSON.stringify({rates})}); loadExpenses(); }catch(e){ alert(e.message); }
}
async function saveShiftHours(){
  const hours={}; document.querySelectorAll('#expConfig input[data-sh]').forEach(i=>{ if(i.value!=='') hours[i.dataset.sh]=+i.value; });
  try{ await api('/finance/shift-hours',{method:'POST',body:JSON.stringify(hours)}); loadExpenses(); }catch(e){ alert(e.message); }
}
async function saveRoleRates(){
  const rates={}; document.querySelectorAll('#expConfig input[data-rr]').forEach(i=>{ rates[i.dataset.rr]=+i.value||0; });
  try{ await api('/finance/role-rates',{method:'POST',body:JSON.stringify({rates})}); loadExpenses(); }catch(e){ alert(e.message); }
}
async function saveStaffRates(){
  const rates={}; document.querySelectorAll('#expConfig input[data-sr]').forEach(i=>{ rates[i.dataset.sr]=i.value; });
  if($('rate_msg'))$('rate_msg').textContent='Saving…';
  try{ await api('/finance/staff-rates',{method:'POST',body:JSON.stringify({rates})}); if($('rate_msg'))$('rate_msg').textContent='✓ Saved'; loadExpenses(); }catch(e){ if($('rate_msg'))$('rate_msg').textContent=e.message; }
}
// Command Center revenue strip — admin only (the API is admin-gated too).
async function loadCmdRevenue(){
  const el=$('cmdRevenue'); if(!el) return;
  if(!(ME && ME.role==='admin')){ el.innerHTML=''; return; }
  let d; try{ d=await api('/finance/revenue'); }catch(e){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="card" style="border-left:4px solid #c8a44d;background:#fbf7ee">
    <div class="cmd-hero-row">
      <div><h3 style="margin:0">Revenue <span class="hint" style="font-weight:400">· admin only · private</span></h3></div>
      <button class="btn btn-ghost btn-sm sans" onclick="show('finance')">Open Revenue ›</button>
    </div>
    <div class="ret-cards" style="margin-top:10px">
      <div class="ret-card rc-elev"><div class="n">${usd(d.cumulative)}</div><div class="l">Revenue to date</div></div>
      <div class="ret-card"><div class="n">${usd(d.mtd)}</div><div class="l">This month</div></div>
      <div class="ret-card"><div class="n">${usd(d.todayBilled)}</div><div class="l">Billed today</div><div class="hint" style="font-size:12px;margin-top:5px;color:#5a6671;font-weight:600">${d.censusCount} in service</div></div>
      <div class="ret-card"><div class="n">${usd(d.monthProjection)}</div><div class="l">Projected ${esc(d.monthLabel)}</div></div>
      ${d.unrated?`<div class="ret-card rc-warn"><div class="n">${d.unrated}</div><div class="l">No rate set</div></div>`:''}
    </div></div>`;
}
async function loadCommand(){
  let d; try{ d = await api('/command/overview'); }catch(e){ $('cmdFlow').innerHTML='<div class="card"><div class="empty">Command Center is available to leadership.</div></div>'; return; }
  COMMAND_DATA=d;
  loadMoments(); loadVoice(); loadMealCount(); loadCmdSurveys(); loadPlanMorning(); loadCmdRevenue(); loadAlertScore();
  if($('cmdFlowDetail')){ $('cmdFlowDetail').style.display='none'; $('cmdFlowDetail').removeAttribute('data-key'); }
  loadCommandPeriod();
  $('cmdAsOf').textContent = 'as of '+new Date(d.asOf).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const f = d.flow;
  const clk=(key)=>`data-cmd="${key}" onclick="cmdFlowPanel('${key}')" style="cursor:pointer"`;
  // Kipu freshness, shown right on the Census tile so drift is obvious at a glance.
  const syncAgo = d.syncedAt ? Math.round((Date.now() - new Date(d.syncedAt.replace(' ','T')+'Z').getTime())/60000) : null;
  const syncTxt = syncAgo==null ? 'never synced' : syncAgo<1 ? 'just now' : syncAgo<60 ? syncAgo+'m ago' : Math.floor(syncAgo/60)+'h '+(syncAgo%60)+'m ago';
  const syncStale = syncAgo!=null && syncAgo>420;   // auto-sync runs every 6h; >7h means it's lagging
  $('cmdFlow').innerHTML = `
    <div class="ret-card ${syncStale?'rc-warn':''}" ${clk('census')}><div class="n">${f.census}</div><div class="l">Census ›</div><div class="hint" style="font-size:10px;margin-top:2px">Kipu · ${syncTxt}</div></div>
    <div class="ret-card ${f.bedsOpen===0?'rc-high':(f.bedsOpen<=3?'rc-warn':'')}" onclick="show('bedmap')" style="cursor:pointer"><div class="n">${f.bedsOpen!=null?f.bedsOpen:'—'}</div><div class="l">Open beds ›</div><div class="hint" style="font-size:10px;margin-top:2px">of ${f.bedTotal||40}</div></div>
    ${d.scheduled?`<div class="ret-card ${d.scheduled.waiting?'rc-warn':''}" ${clk('scheduled')}><div class="n">${d.scheduled.waiting}</div><div class="l">Scheduled to arrive ›</div></div>`:''}
    <div class="ret-card" ${clk('admits')}><div class="n">${f.admitsToday}</div><div class="l">Admits today ›</div></div>
    <div class="ret-card" ${clk('dcToday')}><div class="n">${f.dischargesToday}</div><div class="l">Discharges today ›</div></div>
    <div class="ret-card" ${clk('dc7d')}><div class="n">${f.discharges7d}</div><div class="l">Discharges · 7d ›</div></div>
    <div class="ret-card ${d.staffing.gaps.length?'rc-high':''}" onclick="show('schedule')" style="cursor:pointer"><div class="n">${d.staffing.pct!=null?d.staffing.pct+'%':'—'}</div><div class="l">Covered today ›</div></div>
    <div class="ret-card ${d.documentation.gaps.length?'rc-warn':''}" onclick="show('compliance')" style="cursor:pointer"><div class="n">${d.documentation.gaps.length}</div><div class="l">Notes to finish ›</div></div>
    ${d.rounds?`<div class="ret-card ${d.rounds.overdue?'rc-high':''}" onclick="show('rounds')" style="cursor:pointer"><div class="n">${d.rounds.overdue}</div><div class="l">Rounds overdue ›</div></div>`:''}
    ${d.engagement?`<div class="ret-card ${d.engagement.disengaged.length?'rc-warn':''}" ${clk('engage')}><div class="n">${d.engagement.pct!=null?d.engagement.pct+'%':'—'}</div><div class="l">Engaged today ›</div></div>`:''}
    ${d.careCards?`<div class="ret-card ${d.careCards.overdue?'rc-high':(d.careCards.incomplete?'rc-warn':'')}" ${clk('carecards')}><div class="n">${d.careCards.incomplete}</div><div class="l">Care cards to fill ›</div></div>`:''}`;

  // Midnight Census — mirrors the nightly census email
  if($('cmdCensus')){
    if(d.syncedAt) $('censusAsOf').textContent='Kipu data as of '+new Date(d.syncedAt.replace(' ','T')+'Z').toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const lv=(d.levels&&d.levels.census)||[];
    const locLine = lv.length ? lv.map(l=>`<div class="cmd-row"><div class="cmd-row-main"><strong>${esc(l.code||l.label)}</strong>${l.code?' <span class="hint">'+esc(l.label)+'</span>':''}</div><span class="risk risk-low">${l.count}</span></div>`).join('') : '<div class="hint">No level-of-care data — run a Kipu sync.</div>';
    const intakes=(f.admitsTodayList||[]);
    const dcs=(f.dischargesTodayList||[]);
    const referredOut=(f.referredOutTodayList||[]);
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
    const sentN=sendouts.length;
    $('cmdCensus').innerHTML =
      `<div class="cmd-sub">By level of care</div>${locLine}`+
      `<div class="cmd-row" style="border-top:2px solid var(--line)"><div class="cmd-row-main"><strong>TOTAL CENSUS</strong></div><span class="risk risk-elev">${f.census}</span></div>`+
      `<div class="cmd-sub">Today's movement <span class="hint" style="font-weight:400">— tap a number for the list</span></div>`+
      `<div class="ret-cards" style="margin-top:6px">`+
        `<div class="ret-card" onclick="cmdFlowPanel('scheduled')" style="cursor:pointer"><div class="n">${sched.length}</div><div class="l">Scheduled ›</div></div>`+
        `<div class="ret-card" onclick="cmdFlowPanel('admits')" style="cursor:pointer"><div class="n">${intakes.length}</div><div class="l">Intakes ›</div></div>`+
        `<div class="ret-card" onclick="cmdFlowPanel('dcToday')" style="cursor:pointer"><div class="n">${dcs.length}</div><div class="l">Discharges ›</div></div>`+
        (referredOut.length?`<div class="ret-card"><div class="n">${referredOut.length}</div><div class="l">Referred out (no intake)</div></div>`:'')+
        `<div class="ret-card ${sentN?'rc-warn':''}"><div class="n">${sentN}</div><div class="l">Out (ED/hospital)</div></div>`+
      `</div>`+
      (referredOut.length?`<div class="cmd-sub">Referred out / didn't complete intake <span class="hint" style="font-weight:400">— not counted as admits or discharges</span></div>`+referredOut.map(x=>`<div class="pc-note">↪ <strong>${esc(x.name)}</strong>${x.status&&x.status!=='Merged (duplicate)'?' — '+esc(x.status):''}</div>`).join(''):'')+
      (sentN?`<div class="cmd-sub">Medical send-outs (ED / hospital)</div>${sendoutBlock}`:'')+
      `<div class="handoff-add no-print" style="margin-top:10px;flex-wrap:wrap">
         <input id="so_name" placeholder="Client" style="flex:1;min-width:120px"/>
         <input id="so_dest" placeholder="Where (e.g. Akron General ED)" style="flex:1;min-width:140px"/>
         <input id="so_reason" placeholder="Reason" style="flex:2;min-width:160px"/>
         <button class="btn btn-ghost btn-sm sans" onclick="sendoutAdd()">Log send-out</button>
       </div>
       <div class="toolbar no-print" style="justify-content:flex-start;margin-top:8px">
         <button class="btn btn-gold btn-sm sans" onclick="emailCensus()">✉ Email census now</button>
         <button class="btn btn-ghost btn-sm sans" onclick="emailCensus('yesterday')">🌙 Send last night's summary</button>
         <button class="btn btn-ghost btn-sm sans" onclick="emailBrief()">☀ Send morning brief</button>
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
async function emailCensus(scope){
  $('censusMsg').textContent='Sending…';
  const body = scope==='yesterday' ? {scope:'yesterday'} : {};
  try{ const r=await api('/command/census/email',{method:'POST',body:JSON.stringify(body)}); $('censusMsg').textContent = r.sent?('✓ Emailed to '+r.to+(r.date?(' · '+r.date):'')):('Not sent — '+(r.reason||'email not configured')); }
  catch(e){ $('censusMsg').textContent='Error: '+e.message; }
}
async function emailBrief(){
  $('censusMsg').textContent='Sending morning brief…';
  try{ const r=await api('/command/brief',{method:'POST'}); $('censusMsg').textContent = r.sent?('✓ Brief emailed to '+r.to):('Not sent — '+(r.reason||'email not configured')); }
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
    const geoHint = c.geofenceOn ? '<div class="hint" style="margin-top:4px">📍 Must be at Armada to clock in/out</div>' : '';
    $('clockBox').innerHTML = (c.clockedIn
      ? `<span class="risk risk-low" style="margin-right:8px">On the clock</span><button class="btn btn-ghost sans" onclick="clockToggle(false)">Clock out</button>`
      : `<button class="btn btn-gold sans" onclick="clockToggle(true)">🕐 Clock in</button>`) + geoHint;
  }catch(e){}
  const s = await api('/workforce/summary?range=30');
  const cov = s.coverage;
  const manual = s.onNowManual||[];
  const sched = s.onNowScheduled||[];
  // Names already clocked in or manually added — so we don't list a scheduled person twice.
  const shown = new Set([...s.onNow.map(p=>(p.user_name||'').toLowerCase()), ...manual.map(p=>(p.name||'').toLowerCase())]);
  const schedExtra = sched.filter(p=>!shown.has((p.name||'').toLowerCase()));
  const onTotal = s.onNow.length + manual.length + schedExtra.length;
  $('wfKpis').innerHTML = `
    <div class="ret-card"><div class="n">${onTotal}</div><div class="l">On shift now</div></div>
    <div class="ret-card ${cov.pct!=null&&cov.pct<100?'rc-warn':''}"><div class="n">${cov.pct!=null?cov.pct+'%':'—'}</div><div class="l">Today covered (${cov.scheduled}/${cov.needed})</div></div>
    <div class="ret-card ${cov.gaps?'rc-high':''}"><div class="n">${cov.gaps}</div><div class="l">Coverage gaps today</div></div>
    <div class="ret-card ${s.calloffsWeek?'rc-elev':''}"><div class="n">${s.calloffsWeek}</div><div class="l">Call-offs this week</div></div>`;
  const clockedHtml = s.onNow.map(p=>`<div class="pc-note">🟢 <strong>${esc(p.user_name||'')}</strong> <span class="hint">clocked in ${esc((p.clock_in||'').slice(11,16))}</span></div>`).join('');
  const schedHtml = schedExtra.map(p=>`<div class="pc-note">🟢 <strong>${esc(p.name)}</strong> <span class="hint">${esc(p.shift_label||p.role||'scheduled')} · scheduled</span></div>`).join('');
  const manualHtml = manual.map(p=>`<div class="pc-note">🟢 <strong>${esc(p.name)}</strong> ${p.role?`<span class="hint">${esc(p.role)} · </span>`:''}<span class="hint">added manually</span></div>`).join('');
  $('wfOnNow').innerHTML = (clockedHtml+schedHtml+manualHtml) || '<div class="hint">No one on shift right now. Add people below, have them clock in, or build the schedule.</div>';
  const bars=(rows)=>{ const max=Math.max(1,...rows.map(r=>r.n)); return rows.length&&rows.some(r=>r.n)?rows.map(r=>`<div class="pc-note" style="display:flex;justify-content:space-between"><span>${esc(r.k)}</span><span class="hint">${r.n}</span></div><div style="height:5px;background:var(--gold);width:${Math.round(r.n/max*100)}%;border-radius:3px;margin:2px 0 8px"></div>`).join(''):'<div class="hint">No call-offs in this window. 🎉</div>'; };
  $('wfByPerson').innerHTML = bars(s.byPerson);
  $('wfByDow').innerHTML = bars(s.byDow);
  await ensureReferralMeta().catch(()=>{});
  if($('mos_role')) fillSelect($('mos_role'), ['(role optional)',...(META.jobRoles||['BHT / Tech','Nurse','Therapist','Case Manager'])]);
  loadManualOnShift();
  loadGeofence();
}
async function loadManualOnShift(){
  const box=$('mosList'); if(!box) return;
  let d; try{ d=await api('/onshift/manual'); }catch(e){ return; }
  box.innerHTML = d.rows.length ? d.rows.map(r=>`<div class="pc-note" style="display:flex;justify-content:space-between;align-items:center"><span>👤 <strong>${esc(r.name)}</strong>${r.role?' <span class="hint">· '+esc(r.role)+'</span>':''} <span class="hint">· added ${esc(r.at)} by ${esc(r.by_name||'')}</span></span><button class="btn btn-ghost btn-sm sans" onclick="delManualOnShift(${r.id})">Remove</button></div>`).join('') : '';
}
async function addManualOnShift(){
  const name=($('mos_name')||{}).value?.trim(); if(!name){ if($('mos_msg'))$('mos_msg').textContent='Enter a name.'; return; }
  let role=($('mos_role')||{}).value||''; if(role==='(role optional)') role='';
  try{ await api('/onshift/manual',{method:'POST',body:JSON.stringify({name,role})}); $('mos_name').value=''; if($('mos_msg'))$('mos_msg').textContent='✓ Added'; setTimeout(()=>{if($('mos_msg'))$('mos_msg').textContent='';},2000); loadCoverage(); }
  catch(e){ if($('mos_msg'))$('mos_msg').textContent=e.message; }
}
async function delManualOnShift(id){ try{ await api('/onshift/manual/'+id,{method:'DELETE'}); loadCoverage(); }catch(e){ alert(e.message); } }
function getGeo(){ return new Promise((res)=>{ if(!navigator.geolocation) return res({}); navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy}),()=>res({}),{enableHighAccuracy:true,timeout:9000,maximumAge:30000}); }); }
async function clockToggle(inn){
  const box=$('clockBox'); const prev=box?box.innerHTML:''; if(box) box.innerHTML='<span class="hint">Checking location…</span>';
  const coords = await getGeo();
  try{ await api('/clock/'+(inn?'in':'out'),{method:'POST',body:JSON.stringify(coords)}); loadCoverage(); }
  catch(e){ if(box) box.innerHTML=prev; alert(e.message); }
}
async function loadGeofence(){
  const box=$('geofenceBox'); if(!box) return;
  if(!canManageStaffing()){ box.style.display='none'; return; }
  let g; try{ g=await api('/clock/geofence'); }catch(e){ box.style.display='none'; return; }
  box.style.display='';
  box.style.borderLeft='4px solid '+(g.on?'var(--good)':'var(--muted)');
  box.innerHTML=`<h3>📍 Clock-in location lock</h3>
    <p class="sub sans">Limit clock-in / clock-out to Armada (105 E Market St, Akron OH 44308). Stand at the building and tap <strong>Use my current location</strong> to set it exactly, then turn enforcement on.</p>
    <div class="toolbar" style="justify-content:flex-start;gap:10px;flex-wrap:wrap;align-items:center">
      <label class="trg" style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="gf_on" ${g.on?'checked':''} onchange="saveGeofence({on:this.checked})"/> Enforce on-site only</label>
      <span>Radius <input id="gf_radius" type="number" min="30" value="${g.radius}" style="width:80px"/> m <button class="btn btn-ghost btn-sm sans" onclick="saveGeofence({radius:$('gf_radius').value})">Save radius</button></span>
      <button class="btn btn-gold btn-sm sans" onclick="setGeofenceHere()">📍 Use my current location</button>
    </div>
    <p class="hint" id="gf_msg" style="margin-top:6px">Currently: ${g.on?'<strong style="color:var(--good)">ON</strong>':'off'} · center ${g.lat.toFixed(5)}, ${g.lon.toFixed(5)} · ${g.radius}m</p>
    <hr style="margin:12px 0">
    <p class="sub sans" style="margin:0 0 6px">📶 <strong>Allow the Armada WiFi</strong> — staff on the building WiFi can clock in even without GPS. Stand on the office WiFi and tap below once.</p>
    <div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm sans" onclick="allowNetwork()">📶 Allow this network</button>${(g.ips&&g.ips.length)?`<button class="btn btn-ghost btn-sm sans" onclick="clearNetworks()">Clear</button>`:''}<span class="hint">${(g.ips&&g.ips.length)?'Approved: '+g.ips.map(esc).join(', '):'No network approved yet — GPS only.'}</span></div>`;
}
async function allowNetwork(){ try{ const r=await api('/clock/allow-network',{method:'POST'}); alert('✓ This network is approved for clock-in: '+r.ip); loadGeofence(); }catch(e){ alert(e.message); } }
async function clearNetworks(){ if(!confirm('Remove all approved networks? Staff will need GPS at the building.'))return; try{ await api('/clock/clear-networks',{method:'POST'}); loadGeofence(); }catch(e){ alert(e.message); } }
async function saveGeofence(patch){
  try{ const g=await api('/clock/geofence',{method:'POST',body:JSON.stringify(patch)}); if($('gf_msg'))$('gf_msg').innerHTML=`✓ Saved · ${g.on?'<strong style="color:var(--good)">ON</strong>':'off'} · center ${g.lat.toFixed(5)}, ${g.lon.toFixed(5)} · ${g.radius}m`; }
  catch(e){ if($('gf_msg'))$('gf_msg').textContent=e.message; }
}
async function setGeofenceHere(){
  if($('gf_msg'))$('gf_msg').textContent='Getting your location…';
  const c=await getGeo();
  if(c.lat==null){ if($('gf_msg'))$('gf_msg').textContent='Could not read your location — allow location access and try again.'; return; }
  saveGeofence({lat:c.lat,lon:c.lon});
}

let SCHED_STAFF=null;
async function loadStaffModel(){
  if($('sm_date')&&!$('sm_date').value) $('sm_date').value=today();
  const date=$('sm_date')?$('sm_date').value:today();
  let d; try{ d=await api('/staffing-model?date='+date); }catch(e){ $('smBoard').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const wk=d.staffedWeek, mo=d.staffedMonth;
  $('smKpis').innerHTML = `
    <div class="ret-card ${wk.pct!=null&&wk.pct<95?'rc-warn':''}"><div class="n">${wk.pct!=null?wk.pct+'%':'—'}</div><div class="l">Shifts staffed · week (${wk.logged})</div></div>
    <div class="ret-card ${mo.pct!=null&&mo.pct<95?'rc-warn':''}"><div class="n">${mo.pct!=null?mo.pct+'%':'—'}</div><div class="l">Shifts staffed · month (${mo.logged})</div></div>
    <div class="ret-card ${d.shortToday?'rc-high':''}"><div class="n">${d.shortToday}</div><div class="l">Short right now</div></div>`;
  const isAdmin = ME&&ME.role==='admin';
  $('smBoard').innerHTML = d.blocks.map(b=>`<div class="card"><h3>${esc(b.block)}</h3>
    <table class="tbl"><tr><th>Role</th><th>Shift</th><th>Needed</th><th>On now</th><th>Status</th></tr>
    ${b.rows.map(r=>`<tr ${r.short?'style="background:#fbeaea"':''}>
      <td><strong>${esc(r.role)}</strong></td><td class="hint">${esc(r.shift)}</td>
      <td>${isAdmin?`<input type="number" min="0" value="${r.needed}" style="width:54px" onchange="setStdNeeded(${r.id},this.value)"/>`:r.needed}</td>
      <td><input type="number" min="0" id="sm_a_${r.id}" value="${r.actual!=null?r.actual:''}" placeholder="${r.actual!=null?r.actual:'#'}" style="width:54px"/> <button class="btn btn-sm btn-gold sans" onclick="logStaff('${esc(r.role).replace(/'/g,"\\'")}','${esc(r.shift).replace(/'/g,"\\'")}',${r.id})">Save</button></td>
      <td>${!r.logged?'<span class="hint">not logged</span>':r.short?'<span class="risk risk-high">short '+(r.needed-r.actual)+'</span>':'<span class="risk risk-low">✓ staffed</span>'}</td>
    </tr>`).join('')}</table></div>`).join('');
  // trend
  const max=Math.max(1,...d.trend.map(t=>Math.max(t.understaffed,t.ama)));
  $('smTrend').innerHTML = `<table class="tbl"><tr><th>Day</th><th>Understaffed shifts</th><th>AMA</th><th>Census</th></tr>${d.trend.map(t=>`<tr>
    <td class="hint">${esc(t.date.slice(5))}</td>
    <td>${t.understaffed?'<span class="risk risk-warn">'+t.understaffed+'</span>':(t.logged?'0':'<span class="hint">—</span>')}</td>
    <td>${t.ama?'<span class="risk risk-high">'+t.ama+'</span>':'0'}</td>
    <td class="hint">${t.census??'—'}</td></tr>`).join('')}</table>
    <p class="hint" style="margin-top:6px">Understaffed = logged shifts below the standard that day. Log coverage daily to make this meaningful.</p>`;
}
async function setStdNeeded(id, needed){ try{ await api('/staffing-model/standard',{method:'POST',body:JSON.stringify({id,needed})}); loadStaffModel(); }catch(e){ alert(e.message); } }
async function logStaff(role, shift, id){ const inp=$('sm_a_'+id); if(!inp||inp.value==='')return; const date=$('sm_date')?$('sm_date').value:today(); try{ await api('/staffing-model/log',{method:'POST',body:JSON.stringify({date,role,shift_label:shift,actual:inp.value})}); loadStaffModel(); }catch(e){ alert(e.message); } }
async function loadSchedule(){
  if(!$('sc_date').value) $('sc_date').value=today();
  await ensureReferralMeta().catch(()=>{});
  fillSelect($('sc_part'), META.shifts||['Morning','Day','Evening','Night']);
  fillSelect($('sc_role'), META.jobRoles||['BHT / Tech','Nurse','Therapist','Catering / Dietary']);
  if(!SCHED_STAFF){ try{ const {staff}=await api('/staff'); SCHED_STAFF=staff; }catch(e){ SCHED_STAFF=[]; } }
  const { slots } = await api('/staffing?date='+$('sc_date').value);
  $('scBoard').innerHTML = slots.length ? slots.map(s=>{
    const opt = SCHED_STAFF.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
    const people = s.assignments.map(a=>`<span class="chip" style="${a.status==='called_off'?'text-decoration:line-through;opacity:.6':''}">${esc(a.user_name||'?')}${a.status==='called_off'?' (off)':''}
      ${a.status!=='called_off'?`<button type="button" onclick="callOff(${a.id})" title="Mark call-off" aria-label="Mark ${esc(a.user_name||'').replace(/'/g,"\\'")} as called off" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--danger);margin-left:4px">⊘</button>`:''}
      <button type="button" onclick="unassign(${a.id})" title="Remove" aria-label="Remove ${esc(a.user_name||'').replace(/'/g,"\\'")} from this shift" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--muted);margin-left:4px">✕</button></span>`).join(' ');
    return `<div class="card" style="border-left:4px solid ${s.covered?'var(--good)':'var(--gold)'}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <strong>${esc(s.part)}</strong> · ${esc(s.role)}
        <span class="risk ${s.covered?'risk-low':'risk-elev'}">${s.scheduledCount}/${s.needed} ${s.covered?'covered':'short '+(s.needed-s.scheduledCount)}</span>
        ${s.calledOffCount?`<span class="risk risk-warn">${s.calledOffCount} off</span>`:''}
        ${canManageStaffing()?`<button class="btn btn-ghost btn-sm sans" style="margin-left:auto" onclick="delSlot(${s.id})">Delete</button>`:''}
      </div>
      <div style="margin:8px 0">${people||'<span class="hint">No one assigned.</span>'}</div>
      ${canManageStaffing()?`<div class="handoff-add"><select id="asgn_${s.id}">${opt}</select><button class="btn btn-ghost btn-sm sans" onclick="assignSlot(${s.id})">Assign</button></div>`:''}
    </div>`;
  }).join('') : '<div class="card"><div class="empty">No shifts scheduled for this day. Add shift needs above.</div></div>';
  loadOnShiftToday();
  loadCareHealth();
}
// Mirrors exactly what the resident kiosk's "Who's on my care team?" will show for
// "on shift now", so a leader can confirm at a glance it has real data to show.
async function loadCareHealth(){
  const box=$('careHealth'); if(!box) return;
  let h; try{ h=await api('/care-team/onshift'); }catch(e){ box.style.display='none'; return; }
  const os=h.onShift||{};
  const chip=(label,arr)=>{ const n=(arr||[]).filter(Boolean); return `<span class="risk ${n.length?'risk-low':'risk-elev'}" style="margin:0 6px 6px 0;display:inline-block">${esc(label)}: ${n.length?esc(n.join(', ')):'none'}</span>`; };
  const empty=!h.clockedInCount && !h.scheduledCount;
  box.style.display='';
  box.style.borderLeft='4px solid '+(empty?'var(--danger)':'var(--good)');
  box.innerHTML=`<h3>Resident kiosk — who it shows as "on shift now"</h3>
    <p class="sub sans">This is exactly what a resident sees under <strong>Who's on my care team?</strong> right now (${esc(h.shift||'')} shift). It's the union of who's <strong>clocked in</strong> and who's <strong>scheduled</strong> for this shift.</p>
    <div style="margin:8px 0">${chip('Nurse',os.nurses)}${chip('RT / BHT',os.rts)}${chip('Therapist',os.therapists)}${chip('Case manager',os.caseManagers)}</div>
    <p class="hint">${h.clockedInCount} clocked in · ${h.scheduledCount} scheduled this shift.${empty?' <strong style="color:var(--danger)">Nothing populated — residents will only see their assigned CM/therapist, no on-shift names. Build today\'s schedule above or have staff clock in.</strong>':''}</p>`;
}
function schShift(n){ const d=new Date($('sc_date').value||today()); d.setDate(d.getDate()+n); $('sc_date').value=d.toISOString().slice(0,10); loadSchedule(); }

/* ---- Bed turnover board ---- */
/* ---- Bed Board (occupancy from Kipu) ---- */
async function loadBedMap(){
  let d; try{ d=await api('/bedboard'); }catch(e){ if($('bmBoard'))$('bmBoard').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if($('bm_total') && document.activeElement!==$('bm_total')) $('bm_total').value=d.total;
  const bg=d.byGender||{Male:{open:0},Female:{open:0}};
  $('bmKpis').innerHTML=`
    <div class="ret-card"><div class="n">${d.occupied}</div><div class="l">Occupied</div></div>
    <div class="ret-card ${d.open>0?'rc-warn':''}"><div class="n">${d.open}</div><div class="l">Open beds total</div></div>
    <div class="ret-card"><div class="n">${(bg.Male&&bg.Male.open)||0}</div><div class="l">♂ Male beds open</div></div>
    <div class="ret-card"><div class="n">${(bg.Female&&bg.Female.open)||0}</div><div class="l">♀ Female beds open</div></div>
    <div class="ret-card"><div class="n">${d.total}</div><div class="l">Total beds</div></div>
    <div class="ret-card ${d.noRoom?'rc-high':''}"><div class="n">${d.noRoom}</div><div class="l">No bed in Kipu</div></div>`;
  // unplaced: clients whose Kipu room isn't an inventory bed yet
  $('bmUnplaced').innerHTML = (d.unplaced&&d.unplaced.length) ? `<div class="card" style="border-left:4px solid var(--gold)"><h3>On the unit but not on the board <span class="hint" style="font-weight:400">— tap "Build from Kipu" to place them</span></h3>${d.unplaced.map(u=>`<div class="pc-note">🛏️ <strong>${esc(u.name)}</strong> — ${esc(u.room)}${u.loc?' <span class="hint">· '+esc(u.loc)+'</span>':''}</div>`).join('')}</div>` : '';
  if(!d.beds.length){ $('bmBoard').innerHTML='<div class="card"><div class="empty">No beds on the board yet. Tap <strong>⟳ Build from Kipu</strong> to populate occupied beds, then add your open beds.</div></div>'; return; }
  // group by unit then room
  const byUnit={}; d.beds.forEach(b=>{ (byUnit[b.unit||'Detox']=byUnit[b.unit||'Detox']||[]).push(b); });
  $('bmBoard').innerHTML = Object.keys(byUnit).sort().map(unit=>`<div class="card"><h3>${esc(unit)} <span class="hint">(${byUnit[unit].filter(b=>b.client).length}/${byUnit[unit].length})</span></h3>
    <div class="bed-grid" style="display:flex;flex-wrap:wrap;gap:10px">${byUnit[unit].map(b=>{
      const occ=!!b.client; const loc=b.client&&b.client.loc?b.client.loc:''; const gen=b.gender||'Any';
      const genTag = gen==='Male'?'<span class="badge" style="background:#e6eefb;color:#2b5; color:#2456a6">♂ Male</span>':gen==='Female'?'<span class="badge" style="background:#fbe9f3;color:#a6246e">♀ Female</span>':'<span class="badge">Any</span>';
      return `<div style="flex:1 1 150px;min-width:140px;border:1px solid var(--line);border-radius:10px;padding:12px;background:${occ?'#fbf3ea':'#eef7f0'}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><div class="sans" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">${esc(b.room)}${b.label?' · '+esc(b.label):''}</div>${genTag}</div>
        ${occ?`<div style="font-weight:600;margin-top:3px">${esc(b.client.name)}</div>${loc?`<div class="hint">${esc(loc)}</div>`:''}${b.client.admit?`<div class="hint">since ${esc(b.client.admit)}</div>`:''}`
          :`<div style="font-weight:600;color:#2f6b44;margin-top:3px">Open</div>`}
        <select class="sans no-print" onchange="setBedGender(${b.id},this.value)" style="margin-top:6px;width:100%;font-size:12px;padding:5px">
          <option value="Male" ${gen==='Male'?'selected':''}>♂ Male</option>
          <option value="Female" ${gen==='Female'?'selected':''}>♀ Female</option>
          <option value="Any" ${gen==='Any'?'selected':''}>Any / unset</option>
        </select>
        ${occ?'':`<button class="btn btn-ghost btn-sm sans no-print" style="margin-top:4px" onclick="removeBed(${b.id})">remove</button>`}
      </div>`;
    }).join('')}</div></div>`).join('');
}
async function syncBeds(){ if($('bm_msg'))$('bm_msg').textContent='Building…'; try{ const r=await api('/bedboard/sync',{method:'POST'}); if($('bm_msg'))$('bm_msg').textContent='✓ Added '+r.added+' bed(s) from Kipu'; loadBedMap(); }catch(e){ if($('bm_msg'))$('bm_msg').textContent=e.message; } }
async function bmAddBed(){ const room=($('bm_room')||{}).value||''; if(!room.trim()){ if($('bm_msg'))$('bm_msg').textContent='Room?'; return; } try{ await api('/beds',{method:'POST',body:JSON.stringify({room,label:($('bm_label')||{}).value||'',unit:'Detox',gender:($('bm_gender')||{}).value||'Any'})}); $('bm_room').value='';$('bm_label').value=''; loadBedMap(); }catch(e){ if($('bm_msg'))$('bm_msg').textContent=e.message; } }
async function removeBed(id){ try{ await api('/beds/'+id,{method:'DELETE'}); loadBedMap(); }catch(e){ alert(e.message); } }
async function setBedGender(id,gender){ try{ await api('/beds/'+id+'/gender',{method:'POST',body:JSON.stringify({gender})}); loadBedMap(); }catch(e){ alert(e.message); } }
async function setBedTotal(){ const total=($('bm_total')||{}).value||40; try{ await api('/bedboard/total',{method:'POST',body:JSON.stringify({total})}); loadBedMap(); }catch(e){ alert(e.message); } }
async function loadBedBoard(){
  let d; try{ d=await api('/turnovers'); }catch(e){ if($('tovDirty'))$('tovDirty').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('tovKpis').innerHTML=`
    <div class="ret-card ${d.openCount?'rc-warn':''}"><div class="n">${d.openCount}</div><div class="l">Beds to clean</div></div>
    <div class="ret-card ${d.overdue?'rc-high':''}"><div class="n">${d.overdue}</div><div class="l">Overdue (past a shift)</div></div>
    <div class="ret-card"><div class="n">${(d.cleaned||[]).length}</div><div class="l">Cleaned (24h)</div></div>`;
  const fmtAge=m=>m>=60?Math.floor(m/60)+'h '+(m%60)+'m':m+'m';
  $('tovDirty').innerHTML = d.dirty.length ? d.dirty.map(b=>`<div class="cmd-row ${b.overdue?'cmd-row-flag':''}" style="flex-wrap:wrap">
      <div class="cmd-row-main" style="flex:1;min-width:170px"><strong>🛏️ ${esc(b.room)}</strong>${b.status==='cleaning'?' <span class="risk risk-elev">cleaning</span>':' <span class="risk risk-warn">needs cleaning</span>'}${b.who?' <span class="hint">· '+esc(b.who)+' left</span>':''}
        <div class="hint">${b.overdue?'<span style="color:var(--danger);font-weight:600">OVERDUE</span> · ':''}waiting ${fmtAge(b.mins)}${b.reason?' · '+esc(b.reason):''}${b.status==='cleaning'&&b.cleaned_by?' · 🧹 '+esc(b.cleaned_by)+' cleaning':''}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${b.status==='cleaning'
          ? `<button class="btn btn-gold btn-sm sans" onclick="cleanTurnover(${b.id})">✓ Cleaned</button>`
          : `<button class="btn btn-ghost btn-sm sans" onclick="startTurnover(${b.id})">🧹 Start cleaning</button><button class="btn btn-gold btn-sm sans" onclick="cleanTurnover(${b.id})">✓ Cleaned</button>`}
        ${canManageStaffing()?`<button class="btn btn-ghost btn-sm sans" onclick="removeTurnover(${b.id})" title="Dismiss a mistaken flag (manager only)">✕</button>`:''}
      </div></div>`).join('') : '<div class="hint">All beds clean — nothing waiting. 🎉</div>';
  $('tovClean').innerHTML = (d.cleaned||[]).length ? d.cleaned.map(b=>`<div class="pc-note">✅ <strong>${esc(b.room)}</strong> <span class="hint">· cleaned by ${esc(b.cleaned_by||'')} · ${esc(b.at||'')}</span> <a onclick="reopenTurnover(${b.id})" style="cursor:pointer;color:var(--muted);margin-left:6px">undo</a></div>`).join('') : '<div class="hint">No beds cleaned in the last 24 hours.</div>';
  loadTurnoverScore();
}
async function loadTurnoverScore(){
  const card=$('tovScoreCard'); if(!card) return;
  if(!canManageStaffing()){ card.style.display='none'; return; }
  let d; try{ d=await api('/turnovers/scorecard'); }catch(e){ card.style.display='none'; return; }
  card.style.display='';
  const medal=i=>['🥇','🥈','🥉'][i]||(i+1)+'.';
  $('tovScore').innerHTML = d.byPerson.length
    ? `<table class="tbl"><tr><th>Staff</th><th>Beds cleaned</th><th>Avg time to clean</th></tr>${d.byPerson.map((p,i)=>`<tr><td>${medal(i)} <strong>${esc(p.name)}</strong></td><td>${p.n}</td><td>${p.avgMin!=null?(p.avgMin>=60?Math.floor(p.avgMin/60)+'h '+(p.avgMin%60)+'m':p.avgMin+'m'):'—'}</td></tr>`).join('')}</table><p class="hint" style="margin-top:6px">${d.total7} bed${d.total7===1?'':'s'} cleaned in the last 7 days.</p>`
    : '<div class="hint">No beds cleaned in the last 7 days yet.</div>';
}
async function addTurnover(){
  const room=$('tov_room')?$('tov_room').value.trim():''; if(!room){ if($('tov_msg'))$('tov_msg').textContent='Enter a room/bed.'; return; }
  try{ await api('/turnovers',{method:'POST',body:JSON.stringify({room,who:($('tov_who')||{}).value||''})}); $('tov_room').value=''; if($('tov_who'))$('tov_who').value=''; if($('tov_msg'))$('tov_msg').textContent=''; loadBedBoard(); }
  catch(e){ if($('tov_msg'))$('tov_msg').textContent=e.message; }
}
async function startTurnover(id){ try{ await api('/turnovers/'+id+'/start',{method:'POST'}); loadBedBoard(); }catch(e){ alert(e.message); } }
async function cleanTurnover(id){ try{ await api('/turnovers/'+id+'/clean',{method:'POST'}); loadBedBoard(); }catch(e){ alert(e.message); } }
async function reopenTurnover(id){ try{ await api('/turnovers/'+id+'/reopen',{method:'POST'}); loadBedBoard(); }catch(e){ alert(e.message); } }
async function removeTurnover(id){ if(!confirm('Dismiss this bed (flagged by mistake)? Only do this if it was not a real discharge.'))return; try{ await api('/turnovers/'+id,{method:'DELETE'}); loadBedBoard(); }catch(e){ alert(e.message); } }

/* ---- Daily roster / attendance ---- */
function rosterShift(n){ const d=new Date($('ros_date').value||today()); d.setDate(d.getDate()+n); $('ros_date').value=d.toISOString().slice(0,10); loadRoster(); }
async function loadRoster(){
  if($('ros_date')&&!$('ros_date').value) $('ros_date').value=today();
  const date=$('ros_date')?$('ros_date').value:today();
  let d; try{ d=await api('/roster?date='+date); }catch(e){ $('rosterBoard').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const s=d.summary;
  $('rosterKpis').innerHTML=`
    <div class="ret-card"><div class="n">${s.scheduled}</div><div class="l">Scheduled</div></div>
    <div class="ret-card ${s.present?'':''}"><div class="n" style="color:var(--good)">${s.present}</div><div class="l">Here</div></div>
    <div class="ret-card ${s.absent?'rc-high':''}"><div class="n">${s.absent}</div><div class="l">No-show</div></div>
    <div class="ret-card ${s.unmarked?'rc-warn':''}"><div class="n">${s.unmarked}</div><div class="l">Unmarked</div></div>
    <div class="ret-card ${s.calledOff?'rc-elev':''}"><div class="n">${s.calledOff}</div><div class="l">Called off (${s.covered} covered)</div></div>
    <div class="ret-card ${s.discrepancies?'rc-high':''}"><div class="n">${s.discrepancies}</div><div class="l">Clock mismatches</div></div>`;
  if(!d.shifts.length){ $('rosterBoard').innerHTML='<div class="card"><div class="empty">No one scheduled for this day. Build the week under Staffing → Build the schedule.</div></div>'; return; }
  $('rosterBoard').innerHTML = d.shifts.map(sh=>{
    const rows = sh.people.length ? sh.people.map(p=>rosterRow(p)).join('') : '<tr><td colspan="4" class="hint">No one assigned to this shift.</td></tr>';
    const head = sh.shift_label ? `${esc(sh.shift_label)} · ${esc(sh.role)}` : `${esc(sh.part)} · ${esc(sh.role)}`;
    return `<div class="card"><h3 style="margin:0 0 6px">${head} <span class="hint" style="font-weight:400">— ${sh.people.filter(p=>p.status!=='called_off').length}/${sh.needed} scheduled</span></h3>
      <table class="tbl" style="width:100%"><tr><th>Person</th><th>Attendance</th><th>Clock in / out</th><th>Notes</th></tr>${rows}</table></div>`;
  }).join('');
}
function rosterRow(p){
  const calledOff = p.status==='called_off';
  let attendance;
  if(calledOff){
    attendance = `<span class="risk risk-elev">Called off</span>`;
  } else {
    const on=p.attendance==='present', off=p.attendance==='absent';
    attendance = `<button class="btn btn-sm sans ${on?'btn-gold':'btn-ghost'}" onclick="markAttendance(${p.assignment_id},'${on?'clear':'present'}')">✓ Here</button>
      <button class="btn btn-sm sans ${off?'btn-danger':'btn-ghost'}" onclick="markAttendance(${p.assignment_id},'${off?'clear':'absent'}')">✗ No-show</button>`;
  }
  const clock = p.hasPunch ? `${esc(p.clockIn||'—')}${p.clockOut?' – '+esc(p.clockOut):' <span class="hint">(still in)</span>'}` : '<span class="hint">no punch</span>';
  let notes = '';
  if(calledOff){
    notes = p.covered_by_name
      ? `<span class="risk risk-low">Covered by ${esc(p.covered_by_name)}</span> <button type="button" onclick="rosterCover(${p.assignment_id})" aria-label="Change who covered this shift" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--muted)">change</button>`
      : `<button class="btn btn-ghost btn-sm sans" onclick="rosterCover(${p.assignment_id})">+ Who covered?</button>`;
    if(p.calloff_reason) notes += ` <span class="hint">· ${esc(p.calloff_reason)}</span>`;
  } else {
    if(p.discrepancy) notes += `<span class="risk risk-high">⚠ ${esc(p.discrepancy)}</span> `;
    notes += `<button class="btn btn-ghost btn-sm sans" onclick="rosterCallOff(${p.assignment_id})">Call-off</button>`;
  }
  return `<tr><td><strong>${esc(p.name||'?')}</strong>${!p.user_id?' <span class="hint">(no login)</span>':''}</td><td style="white-space:nowrap">${attendance}</td><td>${clock}</td><td>${notes}</td></tr>`;
}
async function markAttendance(id, val){ try{ await api('/roster/attendance/'+id,{method:'POST',body:JSON.stringify({attendance:val==='clear'?null:val})}); loadRoster(); }catch(e){ alert(e.message); } }
async function rosterCallOff(id){
  const reason=prompt('Call-off reason (optional):'); if(reason===null) return;
  const cover=prompt('Who covered this shift? (leave blank if no one — you can add later)','')||'';
  try{ await api('/staffing/assignments/'+id+'/calloff',{method:'POST',body:JSON.stringify({reason,covered_by_name:cover})}); loadRoster(); }catch(e){ alert(e.message); }
}
async function rosterCover(id){
  const cover=prompt('Who stepped in to cover this shift?','')||'';
  try{ await api('/staffing/assignments/'+id+'/cover',{method:'POST',body:JSON.stringify({covered_by_name:cover})}); loadRoster(); }catch(e){ alert(e.message); }
}

/* ---- Weekly schedule grid editor ---- */
function weekShift(n){ const d=new Date(($('wg_start').value||today())+'T00:00'); d.setDate(d.getDate()+n); $('wg_start').value=d.toISOString().slice(0,10); loadWeekGrid(); }
function startOfWeek(){ const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); }
async function loadWeekGrid(){
  await ensureReferralMeta().catch(()=>{});
  if($('wg_role')) fillSelect($('wg_role'), META.jobRoles||['Nurse','BHT / Tech','Therapist','Case Manager','Front Desk','Catering / Dietary','Housekeeping']);
  if($('wg_start')&&!$('wg_start').value) $('wg_start').value=startOfWeek();
  const start=$('wg_start')?$('wg_start').value:startOfWeek();
  let d; try{ d=await api('/schedule/week?start='+start); }catch(e){ $('weekGridBoard').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if(!d.templates.length){ $('weekGridBoard').innerHTML='<div class="empty">No shift rows yet. Add the shifts your schedule uses above — e.g. Nurse · "Intake 7:00 AM", BHT / Tech · "Resident Tech 7p–7a".</div>'; return; }
  const dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const head='<tr><th style="text-align:left">Shift</th>'+d.days.map(dt=>{const x=new Date(dt+'T00:00');return `<th>${dow[x.getDay()]}<br><span class="hint">${dt.slice(5)}</span></th>`;}).join('')+'</tr>';
  const rows=d.templates.map(t=>{
    const cells=d.days.map(dt=>{const k=t.id+'|'+dt;const v=d.cells[k]||'';return `<td style="padding:2px"><input class="wg-cell sans" data-k="${k}" value="${esc(v)}" style="width:90px;font-size:13px;padding:6px"/></td>`;}).join('');
    return `<tr><td style="white-space:nowrap"><strong>${esc(t.shift_label)}</strong><div class="hint">${esc(t.role)} <button type="button" onclick="delShiftRow(${t.id})" title="Remove row" aria-label="Remove shift row ${esc(t.shift_label).replace(/'/g,"\\'")}" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--muted)">✕</button></div></td>${cells}</tr>`;
  }).join('');
  $('weekGridBoard').innerHTML=`<table class="tbl" style="width:100%">${head}${rows}</table>`;
}
async function addShiftRow(){
  const role=$('wg_role')?$('wg_role').value:''; const label=$('wg_label')?$('wg_label').value.trim():'';
  if(!label){ if($('wg_row_msg'))$('wg_row_msg').textContent='Add a shift label (e.g. Intake · 7:00 AM).'; return; }
  try{ await api('/schedule/templates',{method:'POST',body:JSON.stringify({role,shift_label:label})}); $('wg_label').value=''; if($('wg_row_msg'))$('wg_row_msg').textContent='✓ Row added'; setTimeout(()=>{if($('wg_row_msg'))$('wg_row_msg').textContent='';},1500); loadWeekGrid(); }
  catch(e){ if($('wg_row_msg'))$('wg_row_msg').textContent=e.message; }
}
async function delShiftRow(id){ if(!confirm('Remove this shift row from the grid?'))return; try{ await api('/schedule/templates/'+id,{method:'DELETE'}); loadWeekGrid(); }catch(e){ alert(e.message); } }
async function saveWeekGrid(){
  const cells={}; document.querySelectorAll('.wg-cell').forEach(i=>{ cells[i.dataset.k]=i.value; });
  if($('wg_msg'))$('wg_msg').textContent='Saving…';
  try{ await api('/schedule/week',{method:'POST',body:JSON.stringify({start:$('wg_start').value,cells})}); if($('wg_msg'))$('wg_msg').textContent='✓ Saved — Roster & Coverage updated.'; setTimeout(()=>{if($('wg_msg'))$('wg_msg').textContent='';},2500); loadWeekGrid(); }
  catch(e){ if($('wg_msg'))$('wg_msg').textContent=e.message; }
}
async function addSlot(){ try{ await api('/staffing/slots',{method:'POST',body:JSON.stringify({date:$('sc_date').value||today(),part:$('sc_part').value,role:$('sc_role').value,needed:$('sc_needed').value})}); $('sc_msg').textContent='✓ Added'; setTimeout(()=>$('sc_msg').textContent='',2000); loadSchedule(); }catch(e){ $('sc_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
async function delSlot(id){ if(!confirm('Delete this shift need?'))return; await api('/staffing/slots/'+id,{method:'DELETE'}); loadSchedule(); }
async function assignSlot(id){ const u=$('asgn_'+id).value; if(!u)return; await api('/staffing/slots/'+id+'/assign',{method:'POST',body:JSON.stringify({user_id:u})}); loadSchedule(); }
async function unassign(id){ await api('/staffing/assignments/'+id,{method:'DELETE'}); loadSchedule(); }
async function callOff(id){ const reason=prompt('Call-off reason (optional):'); if(reason===null)return; await api('/staffing/assignments/'+id+'/calloff',{method:'POST',body:JSON.stringify({reason})}); loadSchedule(); }

/* ---- lineup / culture ---- */
let staffLoad = null;
function canSendLineup(){ return !!(ME && (ME.role==='admin' || ['Executive Director','Director of Operations','Clinical Director'].includes(ME.job_role))); }
async function previewLineupEmail(){
  const box=$('lineupEmailPreview'), msg=$('lineupEmailMsg');
  if(msg) msg.textContent='Loading…';
  try{
    const d=await api('/lineup/email-preview');
    const toLine = d.to ? esc(d.to) : '<span style="color:var(--danger)">not set — add it in Settings → Daily Lineup email</span>';
    const readyLine = d.emailReady ? 'email ready' : '<span style="color:var(--danger)">email not connected (Settings → Email)</span>';
    const fromLine = d.from ? esc(d.from) : '<span style="color:var(--danger)">blank — set a From on your verified domain (Settings → Email)</span>';
    const warn = d.fromIssue ? `<div style="margin-bottom:8px;padding:8px 10px;background:#fdecea;border:1px solid #f5b7b1;border-radius:6px;color:#922">⚠ ${esc(d.fromIssue)}</div>` : '';
    box.style.display='block';
    box.innerHTML = warn + `<div class="hint" style="margin-bottom:4px">From: <strong>${fromLine}</strong></div><div class="hint" style="margin-bottom:4px">To (BCC): <strong>${toLine}</strong> · ${readyLine}</div><div class="hint" style="margin-bottom:10px">Subject: ${esc(d.subject)}</div>`+d.html;
    if(msg) msg.textContent='';
  }catch(e){ if(msg) msg.textContent=e.message; }
}
async function saveLineupSpotlight(){
  const m=$('spotlightMsg'); const text=($('lineupSpotlight')||{}).value||'';
  try{ await api('/lineup/spotlight',{method:'POST',body:JSON.stringify({text})}); if(m) m.textContent='✓ Saved — it\'ll show at the top of today\'s lineup.'; }
  catch(e){ if(m) m.textContent=e.message; }
}
async function clearLineupSpotlight(){
  if($('lineupSpotlight')) $('lineupSpotlight').value='';
  const m=$('spotlightMsg');
  try{ await api('/lineup/spotlight',{method:'POST',body:JSON.stringify({text:''})}); if(m) m.textContent='Cleared.'; }
  catch(e){ if(m) m.textContent=e.message; }
}
async function sendLineupEmail(){
  const msg=$('lineupEmailMsg');
  if(!confirm("Send today's Lineup email to the team now?")) return;
  if(msg) msg.textContent='Sending…';
  try{
    const r=await api('/lineup/send',{method:'POST'});
    let ok='✓ Sent to '+r.sent+' of '+r.total+' recipients.';
    if(r.failed && r.failed.length) ok+=' ⚠ Failed: '+r.failed.join('; ');
    if(msg){ msg.textContent=ok; } else { alert(ok); }
  }
  catch(e){ if(msg){ msg.textContent=e.message; } else { alert(e.message); } }
}
async function loadPrinciple(){
  let d; try{ d=await api('/principle/today'); }catch(e){ return; }
  if($('principleTitle')) $('principleTitle').textContent = d.title||'';
  if($('principleWhy')) $('principleWhy').textContent = d.why||'';
  if($('principlePractice')) $('principlePractice').innerHTML = d.practice?('<b>Today:</b> '+esc(d.practice)):'';
  if($('principleSet')) $('principleSet').innerHTML = d.canSet
    ? `<div style="margin-top:8px;padding:10px 12px;background:#f3eefc;border:1px solid #d9cdf0;border-radius:8px">
         <label class="sans" for="principleSelect" style="font-weight:600;color:#5b3fa0;font-size:13px">📌 Set today's principle:</label>
         <select id="principleSelect" onchange="setPrinciple(this.value)" class="sans" style="margin-left:8px;min-width:240px">${(d.options||[]).map(o=>`<option ${o===d.title?'selected':''}>${esc(o)}</option>`).join('')}</select>
       </div>`
    : '<div class="hint" style="margin-top:6px">Today\'s principle is set by a leader (Admin / Executive Director / Director of Operations / Clinical Director).</div>';
  const feed=$('principleFeed'); if(!feed) return;
  feed.innerHTML = (d.stories&&d.stories.length) ? d.stories.map(s=>`<div class="pc-note" style="border-left:3px solid #7a5cc0">
    <div>${esc(s.action)}</div>
    ${s.clientResponse?`<div style="margin-top:4px;font-style:italic;color:#555">“${esc(s.clientResponse)}”</div>`:''}
    <div class="hint" style="margin-top:4px">${esc(s.by||'')}${s.principle?' · '+esc(s.principle):''}${s.at?' · '+esc(s.at):''}</div>
  </div>`).join('') : '<div class="hint">Be the first to show the team how you lived a principle this week.</div>';
}
async function setPrinciple(title){ try{ await api('/principle/set',{method:'POST',body:JSON.stringify({title})}); loadPrinciple(); }catch(e){ alert(e.message); } }
async function setValue(value){ try{ await api('/lineup/value/set',{method:'POST',body:JSON.stringify({value})}); if($('lineValue'))$('lineValue').textContent=value; }catch(e){ alert(e.message); } }
async function loadRaffle(){
  const box=$('raffleList'); if(!box) return;
  loadRaffleFeatured();
  let d; try{ d=await api('/lineup/raffle'); }catch(e){ return; }
  const rows=[
    ...(d.manual||[]).map(r=>`<div class="pc-note" style="display:flex;justify-content:space-between;align-items:center"><span>🎟️ <strong>${esc(r.name)}</strong> × ${r.count}${r.note?' <span class="hint">· '+esc(r.note)+'</span>':''} <span class="hint">· added by ${esc(r.by_name||'')}</span></span><button class="btn btn-ghost btn-sm sans" onclick="delRaffleEntry(${r.id})">Remove</button></div>`),
    ...(d.app||[]).map(r=>`<div class="pc-note">🎟️ <strong>${esc(r.name||'A teammate')}</strong> × ${r.count} <span class="hint">· from the app</span></div>`),
  ];
  box.innerHTML = `<div class="hint" style="margin-bottom:4px">${d.total||0} total entr${(d.total===1)?'y':'ies'} this week</div>`+(rows.length?rows.join(''):'<div class="hint">No entries yet — add the names as recognitions come in.</div>');
}
async function addRaffleEntry(){
  const name=$('raffle_name')?$('raffle_name').value.trim():''; const count=($('raffle_count')||{}).value||1;
  if(!name){ if($('raffleMsg')) $('raffleMsg').textContent='Enter a name.'; return; }
  try{ await api('/lineup/raffle/entry',{method:'POST',body:JSON.stringify({name,count})}); $('raffle_name').value=''; if($('raffle_count'))$('raffle_count').value=1; if($('raffleMsg'))$('raffleMsg').textContent=''; loadRaffle(); }
  catch(e){ if($('raffleMsg')) $('raffleMsg').textContent=e.message; }
}
async function delRaffleEntry(id){ try{ await api('/lineup/raffle/entry/'+id,{method:'DELETE'}); loadRaffle(); }catch(e){ alert(e.message); } }
async function drawRaffle(){
  const m=$('raffleMsg'); if(m) m.textContent='Drawing…';
  try{
    const r=await api('/lineup/raffle/draw',{method:'POST'});
    if(!r.entries){ if(m) m.textContent='No entries yet — add some above first.'; return; }
    if(m) m.innerHTML='🎉 Winner: <strong>'+esc(r.winner)+'</strong> — drawn from '+r.entries+' entr'+(r.entries===1?'y':'ies')+' across '+r.participants+' name'+(r.participants===1?'':'s')+'. <span style="color:#2f6b44">Now featured on the lineup email.</span> <button class="btn btn-ghost btn-sm sans" onclick="clearRaffleWinner()">Remove from email</button>';
  }catch(e){ if(m) m.textContent=e.message; }
}
async function clearRaffleWinner(){
  try{ await api('/lineup/raffle/clear-winner',{method:'POST'}); const m=$('raffleMsg'); if(m) m.textContent='Cleared — the winner will no longer show on the lineup email.'; loadRaffleFeatured(); }catch(e){ alert(e.message); }
}
async function setRaffleWinner(){
  const name=$('raffle_set_name')?$('raffle_set_name').value.trim():'';
  if(!name){ const m=$('raffleMsg'); if(m) m.textContent='Type a name to feature.'; return; }
  try{ await api('/lineup/raffle/set-winner',{method:'POST',body:JSON.stringify({name})}); if($('raffle_set_name'))$('raffle_set_name').value=''; const m=$('raffleMsg'); if(m) m.innerHTML='🎉 <strong>'+esc(name)+'</strong> is now featured on the lineup email.'; loadRaffleFeatured(); }catch(e){ const m=$('raffleMsg'); if(m) m.textContent=e.message; }
}
async function loadRaffleFeatured(){
  const el=$('raffleFeatured'); if(!el) return;
  try{ const {winner}=await api('/lineup/raffle/winner'); el.innerHTML = winner ? `Currently on the email: <strong>${esc(winner.name)}</strong>${winner.reward?' — '+esc(winner.reward):''} · <a href="#" onclick="clearRaffleWinner();return false">remove</a>` : 'No winner featured on the email right now.'; }catch(e){}
}
async function sharePrinciple(){
  const action=$('pr_action')?$('pr_action').value.trim():'';
  if(!action){ if($('pr_msg')) $('pr_msg').textContent='Tell us what you did first.'; return; }
  const cr=$('pr_response')?$('pr_response').value.trim():'';
  try{ await api('/principle/story',{method:'POST',body:JSON.stringify({action,client_response:cr})}); $('pr_action').value=''; if($('pr_response'))$('pr_response').value=''; if($('pr_msg')) $('pr_msg').textContent='✓ Shared — thank you!'; setTimeout(()=>{if($('pr_msg'))$('pr_msg').textContent='';},2500); loadPrinciple(); }
  catch(e){ if($('pr_msg')) $('pr_msg').textContent=e.message; }
}
async function loadLineupRecog(){
  const box=$('lineupRecogList'); if(!box) return;
  let d; try{ d=await api('/lineup/recognition'); }catch(e){ box.innerHTML=''; return; }
  box.innerHTML = d.items.length ? d.items.map(it=>`<div class="pc-note" style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between">
      <span>🌟 <strong>${esc(it.name)}</strong> — ${esc(it.what)}${it.by?' <span class="hint">— '+esc(it.by)+'</span>':''}</span>
      <button class="btn btn-ghost btn-sm sans" title="Remove from the lineup" onclick="removeLineupRecog('${it.type}',${it.id})">✕</button>
    </div>`).join('') : '<div class="hint">Nothing captured yet for tomorrow\'s lineup.</div>';
}
async function removeLineupRecog(type,id){
  try{ await api('/lineup/recognition/'+type+'/'+id,{method:'DELETE'}); loadLineupRecog(); }catch(e){ alert(e.message); }
}
async function loadLineup(){
  if($('lineupEmailCard')) $('lineupEmailCard').style.display = canSendLineup() ? '' : 'none';
  // Leaders read the week's reflections — four questions, every voice.
  if($('reflectionsCard')){ $('reflectionsCard').style.display = canSendLineup() ? '' : 'none';
    if(canSendLineup()) api('/reflections').then(d=>{
      $('reflectionsList').innerHTML = d.rows.length ? d.rows.map(r=>`<div class="pc-note"><strong>${esc(r.user_name)}</strong> <span class="hint">· week of ${esc(r.week)}</span>
        ${r.proud?`<div class="hint" style="margin-top:2px">😊 Proud: ${esc(r.proud)}</div>`:''}${r.barrier?`<div class="hint">🚧 Barrier: ${esc(r.barrier)}</div>`:''}${r.lived?`<div class="hint">🌟 Lived the standards: ${esc(r.lived)}</div>`:''}${r.improve?`<div class="hint">💡 Improve: ${esc(r.improve)}</div>`:''}</div>`).join('')
        : '<div class="hint">No reflections yet this week — they land here as the team submits (Team page, Fridays).</div>';
    }).catch(()=>{});
  }
  if($('lineupCaptureCard')){ $('lineupCaptureCard').style.display = canSendLineup() ? '' : 'none'; if(canSendLineup()) loadLineupRecog(); }
  if(canSendLineup() && $('lineupSpotlight')){ try{ const sp=await api('/lineup/spotlight'); $('lineupSpotlight').value=sp.text||''; }catch(e){} }
  if($('raffleCard')){ $('raffleCard').style.display = canSendLineup() ? '' : 'none'; if(canSendLineup()) loadRaffle(); }
  const d = await api('/lineup');
  const { value, wows, purpose } = d;
  if(purpose && $('purposeText')){ $('purposeText').textContent = purpose; $('purposeBanner').style.display=''; }
  loadPrinciple();
  $('lineValue').textContent = value;
  if($('valueSet')) $('valueSet').innerHTML = d.canSet
    ? `<div style="padding:8px 12px;background:#faf6ee;border:1px solid #e7d9b6;border-radius:8px"><label class="sans" for="valueSelect" style="font-weight:600;color:#8a6d1f;font-size:13px">🎯 Set today's service value:</label> <select id="valueSelect" onchange="setValue(this.value)" class="sans" style="margin-left:8px;min-width:260px">${(d.valueOptions||[]).map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`
    : '';
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
  const { users, domains } = await api('/users');
  const roles = META.jobRoles||[];
  if($('u_domains') && document.activeElement!==$('u_domains')) $('u_domains').value = (domains||[]).join('\n');
  if($('u_domhint')) $('u_domhint').textContent = (domains&&domains.length)?('Approved domains: '+domains.join(', ')):'No approved domains set — add some below first.';
  $('userList').innerHTML = `<table class="tbl"><tr><th>Name</th><th>Email / login</th><th>Phone</th><th>Job role</th><th>Access</th><th>Status</th><th></th></tr>${
    users.map(u=>{
      const roleOpts = roles.map(r=>`<option ${u.job_role===r?'selected':''}>${esc(r)}</option>`).join('');
      const missing = u.job_role && !roles.includes(u.job_role) ? `<option selected>${esc(u.job_role)}</option>` : (u.job_role?'':'<option selected value="">— none set —</option>');
      const status = u.active===0 ? '<span class="risk risk-warn">inactive</span>'
        : u.pending ? '<span class="risk risk-elev">invited · pending</span>'
        : '<span class="risk risk-low">active</span>';
      return `<tr data-uid="${u.id}">
        <td><input class="us-name sans" value="${esc(u.name)}" style="min-width:120px"/></td>
        <td>${esc(u.email||u.username)}</td>
        <td><input class="us-phone sans" value="${esc(u.phone||'')}" placeholder="cell" style="min-width:110px"/></td>
        <td><select class="us-job sans">${missing}${roleOpts}</select></td>
        <td><select class="us-role sans"><option value="staff" ${u.role!=='admin'?'selected':''}>Staff</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select></td>
        <td style="text-align:center">${status}<br><label class="hint" style="text-transform:none;letter-spacing:0"><input type="checkbox" class="us-active" ${u.active!==0?'checked':''}/> active</label></td>
        <td class="toolbar" style="gap:6px">
          <button class="btn btn-gold btn-sm sans" onclick="saveUser(${u.id})">Save</button>
          <button class="btn btn-ghost btn-sm sans" title="Which facilities this person can see" onclick="editUserFacilities(${u.id}, ${JSON.stringify(u.name).replace(/"/g,'&quot;')})">🏥</button>
          ${u.pending?`<button class="btn btn-ghost btn-sm sans" onclick="reinvite(${u.id})">Resend invite</button>`:''}
          <button class="btn btn-ghost btn-sm sans" onclick="deleteUser(${u.id}, ${JSON.stringify(u.name).replace(/"/g,'&quot;')})" style="color:var(--danger)">Delete</button>
        </td></tr>`;
    }).join('')}</table><div id="userMsg" class="hint" style="margin-top:6px"></div>`;
}
// 🏥 Facility access: which facilities a user can see (drives the topbar chip
// AND the server-side ?facility= guard). Rebuild Phase 1.
async function editUserFacilities(uid,uname){
  let facs,access;
  try{ [facs,access]=await Promise.all([api('/org/facilities'),api('/org/facility-access')]); }catch(e){ alert(e.message); return; }
  const mine=new Set(access.rows.filter(r=>r.user_id===uid).map(r=>r.facility_id));
  const save=hmodal(`<h3>🏥 ${esc(uname)} — facility access</h3>
    <p class="sub sans" style="margin:0 0 8px">Check every facility this person works with. No checks = they fall back to the default (detox) wall.</p>
    ${(facs.facilities||[]).filter(f=>f.active).map(f=>`<label style="display:flex;align-items:center;gap:8px;margin:4px 0;text-transform:none;letter-spacing:0"><input type="checkbox" class="ufa" value="${f.id}" ${mine.has(f.id)?'checked':''}/> ${esc(f.name)} <span class="hint">· ${esc(f.type||'')}</span></label>`).join('')}`);
  save.onclick=async()=>{
    const ids=[...document.querySelectorAll('.ufa:checked')].map(c=>+c.value);
    try{ await api('/org/facility-access',{method:'POST',body:JSON.stringify({user_id:uid,facility_ids:ids})}); closeHModal(); alert('✓ Saved — takes effect on their next page load.'); }
    catch(e){ alert(e.message); }
  };
}
async function saveDomains(){
  const list = $('u_domains').value.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
  if($('u_dommsg')) $('u_dommsg').textContent='Saving…';
  try{ const r=await api('/allowed-domains',{method:'POST',body:JSON.stringify({domains:list})}); if($('u_dommsg')) $('u_dommsg').textContent='✓ Saved'; if($('u_domhint')) $('u_domhint').textContent='Approved domains: '+r.domains.join(', '); }
  catch(e){ if($('u_dommsg')) $('u_dommsg').textContent='Error: '+esc(e.message); }
}
async function reinvite(id){
  if($('userMsg')) $('userMsg').textContent='Resending…';
  try{ const r=await api('/users/'+id+'/reinvite',{method:'POST'});
    if($('userMsg')) $('userMsg').innerHTML = r.emailed ? '✓ Invite re-sent.' : ('Email not sent ('+esc(r.emailErr||'')+'). Copy this link to them: <span style="word-break:break-all;color:var(--navy)">'+esc(r.link||'')+'</span>');
  }catch(e){ if($('userMsg')) $('userMsg').textContent='Error: '+esc(e.message); }
}
function userRow(id){ return document.querySelector('tr[data-uid="'+id+'"]'); }
async function saveUser(id){
  const r=userRow(id); if(!r) return;
  const body={ name:r.querySelector('.us-name').value, job_role:r.querySelector('.us-job').value,
    role:r.querySelector('.us-role').value, active:r.querySelector('.us-active').checked?1:0,
    phone:(r.querySelector('.us-phone')||{}).value||'' };
  if($('userMsg')) $('userMsg').textContent='Saving…';
  try{ await api('/users/'+id,{method:'POST',body:JSON.stringify(body)}); if($('userMsg')) $('userMsg').textContent='✓ Saved'; loadUsers(); }
  catch(e){ if($('userMsg')) $('userMsg').textContent='Error: '+esc(e.message); }
}
async function resetUserPw(id){
  const pw=prompt('New temporary password for this user (they\'ll be logged out and must use it next sign-in):');
  if(pw===null) return; if(!pw.trim()){ alert('Password cannot be blank.'); return; }
  try{ await api('/users/'+id,{method:'POST',body:JSON.stringify({password:pw.trim()})}); if($('userMsg')) $('userMsg').textContent='✓ Password reset'; }
  catch(e){ alert(e.message); }
}
async function deleteUser(id,name){
  if(!confirm('Delete '+name+'? If they have linked records they\'ll be deactivated instead.')) return;
  try{ const r=await api('/users/'+id,{method:'DELETE'});
    if($('userMsg')) $('userMsg').textContent = r.deleted?('✓ '+name+' deleted'):('✓ '+name+' deactivated (had linked records)');
    loadUsers();
  }catch(e){ if($('userMsg')) $('userMsg').textContent='Error: '+esc(e.message); }
}
async function makeDemoStaff(){
  $('demoStaffMsg').textContent='Creating…';
  try{ const r=await api('/demo-staff',{method:'POST'});
    $('demoStaffMsg').textContent='✓ Done.';
    $('demoStaffOut').innerHTML = `<div class="card" style="background:#faf6ee;margin-top:10px"><h3 style="margin:0 0 6px">Demo logins — password for all: <code>${esc(r.password)}</code></h3>`+
      `<table class="tbl"><tr><th>Role</th><th>Username</th><th>Status</th></tr>`+
      r.users.map(u=>`<tr><td>${esc(u.job_role)}</td><td><code>${esc(u.username)}</code></td><td>${u.status==='created'?'<span class="risk risk-low">created</span>':u.status==='exists'?'<span class="hint">already exists</span>':'<span class="risk risk-high">error</span>'}</td></tr>`).join('')+
      `</table><p class="hint" style="margin-top:8px">Sign out and log in as any of these to see that role's dashboard. Delete them before go-live.</p></div>`;
    loadUsers();
  }catch(e){ $('demoStaffMsg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
async function addUser(){
  const msg=$('u_addmsg');
  const name=$('u_name').value.trim(), email=$('u_email').value.trim();
  if(!name||!email){ if(msg) msg.textContent='Enter a name and a work email.'; return; }
  if(msg) msg.textContent='Sending invite…';
  try{
    const r=await api('/users',{method:'POST',body:JSON.stringify({name,email,role:$('u_role').value,job_role:$('u_job').value})});
    $('u_name').value=$('u_email').value='';
    if(msg) msg.innerHTML = r.emailed
      ? ('✓ Invitation sent to '+esc(email)+'. They’ll set their own password.')
      : ('Account created, but email isn’t connected ('+esc(r.emailErr||'')+'). Send them this sign-up link: <span style="word-break:break-all;color:var(--navy)">'+esc(r.link||'')+'</span>');
    loadUsers();
  }catch(e){ if(msg) msg.textContent='Error: '+esc(e.message); }
}

/* ---- Role profiles & hiring (selection over hiring) — shared by detox + Hilltop ---- */
let HIRE = { side:'detox', mount:'hiringBody', role:null, stages:[], canEdit:false, profile:null, cands:[] };
async function loadHiring(side, mount){
  HIRE.side = side==='hilltop'?'hilltop':'detox'; HIRE.mount = mount || 'hiringBody'; HIRE.role=null;
  const el=$(HIRE.mount); if(!el) return;
  let d; try{ d=await api('/hiring/roles?side='+HIRE.side); }catch(e){ el.innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  HIRE.stages=d.stages; HIRE.canEdit=d.canEdit;
  el.innerHTML = `<div class="clientlist">${d.roles.map(r=>`
    <div class="ctile" onclick="openHireRole('${encodeURIComponent(r.role)}')">
      <h4>${esc(r.role)}</h4>
      <div class="meta">${r.qualities} defining qualities</div>
      <div style="font-size:13px;margin-top:8px;color:var(--muted)">${esc(r.purpose||'')}</div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${r.openCandidates?`<span class="chip chip-warn">${r.openCandidates} in pipeline</span>`:'<span class="chip">no open candidates</span>'}${r.hired?`<span class="chip" style="background:#e8f3ec;color:#2f7a4f;border-color:#bfe0cb">${r.hired} hired</span>`:''}</div>
    </div>`).join('')}</div>`;
}
async function openHireRole(roleEnc){
  const role=decodeURIComponent(roleEnc); HIRE.role=role;
  const el=$(HIRE.mount); if(!el) return;
  let p, cd;
  try{ p=await api('/hiring/profile/'+encodeURIComponent(role)); cd=await api('/hiring/candidates?role='+encodeURIComponent(role)); }
  catch(e){ el.innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  HIRE.profile=p; HIRE.cands=cd.candidates||[];
  const qual=p.qualities.map(q=>`<div class="kv"><span class="k" style="min-width:150px">${esc(q.name)}</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted);max-width:60%">${esc(q.desc||'')}</span></div>`).join('');
  const resp=p.responsibilities.map(r=>`<li>${esc(r)}</li>`).join('');
  const lim=(p.limitations||[]).map(r=>`<li>${esc(r)}</li>`).join('');
  const intv=p.interview.map(i=>`<div class="cmd-row"><div class="cmd-row-main">❓ ${esc(i.q)}${i.look?`<br><span class="hint">Listen for: ${esc(i.look)}</span>`:''}</div></div>`).join('');
  const byStage={}; HIRE.stages.forEach(s=>byStage[s]=[]); HIRE.cands.forEach(c=>{ (byStage[c.stage]=byStage[c.stage]||[]).push(c); });
  const pipe=HIRE.stages.map(s=>{ const list=byStage[s]||[]; if(!list.length && s==='Passed') return '';
    return `<div style="margin-bottom:10px"><div style="font-weight:700;color:var(--navy);font-size:12.5px;border-bottom:1px solid var(--line);padding-bottom:3px;margin-bottom:5px">${esc(s)} <span class="hint">(${list.length})</span></div>
    ${list.map(c=>`<div class="cmd-row" style="cursor:pointer" onclick="openCandidate(${c.id})"><div class="cmd-row-main"><b>${esc(c.name)}</b>${c.rating?` <span class="hint">· ★ ${c.rating}/10</span>`:''}${c.email?`<span class="hint"> · ${esc(c.email)}</span>`:''}</div></div>`).join('')||'<div class="hint" style="font-size:12px">—</div>'}</div>`;
  }).join('');
  el.innerHTML=`
    <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-ghost btn-sm sans" onclick="loadHiring('${HIRE.side}','${HIRE.mount}')">← All roles</button></div>
    <div class="cmd-grid">
      <div class="card"><div class="cmd-hero-row"><div><h3>${esc(role)}</h3><p class="sub sans" style="margin:0">${esc(p.purpose||'')}</p></div>${p.canEdit?`<button class="btn btn-ghost btn-sm sans" onclick="editRoleProfile()">Edit profile</button>`:''}</div>
        <h3 style="margin-top:14px;font-size:13px">Defining qualities — select for these</h3>${qual}
        <h3 style="margin-top:14px;font-size:13px">Key responsibilities</h3><ul style="margin:6px 0;padding-left:18px;font-size:14px">${resp}</ul>
        ${lim?`<h3 style="margin-top:14px;font-size:13px;color:#b3382f">Out of their lane</h3><ul style="margin:6px 0;padding-left:18px;font-size:14px">${lim}</ul>`:''}
      </div>
      <div class="card"><div class="cmd-hero-row"><div><h3>Hiring pipeline</h3></div>${p.canEdit?`<button class="btn btn-gold btn-sm sans" onclick="addCandidate()">+ Candidate</button>`:''}</div>
        <div style="margin-top:10px">${pipe}</div></div>
    </div>
    <div class="card"><h3>Structured interview guide</h3><p class="sub sans">Ask these and score the candidate against the defining qualities — select for talent, don't settle.</p>${intv}</div>`;
}
// "My Role" — a staff member's own job description, always on hand: what they do,
// what's out of their lane, and one-tap access to every tool the job needs.
async function loadMyRole(){
  const host=$('myroleBody'); if(!host) return;
  host.innerHTML='<div class="card"><div class="empty">Loading…</div></div>';
  let p; try{ p=await api('/my-role'+(PREVIEW_ROLE?'?as='+encodeURIComponent(PREVIEW_ROLE):'')); }catch(e){ host.innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const role=p.role||(ME&&ME.job_role)||'Team member';
  const resp=(p.responsibilities||[]).map(r=>`<li>${esc(r)}</li>`).join('');
  const lim=(p.limitations||[]).map(r=>`<li>${esc(r)}</li>`).join('');
  const qual=(p.qualities||[]).map(q=>`<div class="kv"><span class="k" style="min-width:150px">${esc(q.name)}</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted);max-width:62%">${esc(q.desc||'')}</span></div>`).join('');
  // My tools — the exact app functions this role uses, proving every duty has a home.
  const menu=(ROLE_MENU[role]||[]).filter(v=>v!=='myrole'&&v!=='dashboard'&&canSeeView(v));
  const label=v=>{ const b=document.querySelector(`#nav button[data-view="${v}"]`); return b?b.textContent.trim():v; };
  const tools=menu.map(v=>`<button class="btn btn-ghost btn-sm sans" onclick="show('${v}')">${esc(label(v))} ›</button>`).join('');
  const flow=(SHIFT_FLOW[role]||[]).map((s,i)=>`<div class="flow-step"><div class="flow-num">${i+1}</div><div class="flow-body"><div class="flow-t">${esc(s.t)}</div><div class="flow-d">${esc(s.d)}</div>${s.v&&canSeeView(s.v)?`<button class="btn btn-ghost btn-sm sans" style="margin-top:6px" onclick="show('${s.v}')">Open ${esc(label(s.v))} ›</button>`:''}</div></div>`).join('');
  host.innerHTML=`
    <div class="card">
      <div class="cmd-hero-row"><div><h3 style="margin:0">${esc(role)}</h3><p class="sub sans" style="margin:2px 0 0">${esc(p.purpose||'')}</p></div></div>
      ${p.reportsTo?`<div class="hint" style="margin-top:8px">Reports to: <b>${esc(p.reportsTo)}</b></div>`:''}
    </div>
    ${p.chapter?`<div class="card" style="border-left:4px solid var(--gold)">
      <div class="cmd-hero-row"><div><div class="hint" style="text-transform:uppercase;letter-spacing:.6px;color:var(--gold)">The Armada Excellence Standards · Chapter ${p.chapter.chapter}</div>
      <h3 style="margin:2px 0 0">${esc(p.chapter.title)}</h3></div><button class="btn btn-ghost btn-sm sans" onclick="show('handbook')">Whole handbook ›</button></div>
      <div style="margin-top:10px">${hbChapterHtml(p.chapter)}</div>
      <div style="text-align:center;background:#faf6ee;border-radius:8px;padding:10px 14px;margin-top:10px"><p style="font-size:13px;line-height:1.6;margin:0">${esc(p.armadaStandard||'')}</p><div class="sans" style="margin-top:6px;font-weight:700;color:#8a6d1f">${esc(p.allBehindYou||'')}</div></div>
    </div>`:''}
    ${flow?`<div class="card"><h3>How my shift flows</h3><p class="sub sans">The rhythm of the job, in order. When in doubt, start at step 1.</p><div class="flow" style="margin-top:10px">${flow}</div></div>`:''}
    <div class="cmd-grid">
      <div class="card"><h3>What I do</h3><p class="sub sans">My responsibilities every shift.</p><ul style="margin:8px 0;padding-left:18px;font-size:14px;line-height:1.65">${resp||'<li>—</li>'}</ul></div>
      ${lim?`<div class="card" style="border-color:#e3b3ac;background:#fff8f7"><h3 style="color:#b3382f">Not my lane</h3><p class="sub sans">Hand these to the right person — never do them yourself.</p><ul style="margin:8px 0;padding-left:18px;font-size:14px;line-height:1.65">${lim}</ul></div>`:''}
    </div>
    ${tools?`<div class="card"><h3>My tools</h3><p class="sub sans">Everything the job needs is one tap away.</p><div class="toolbar" style="flex-wrap:wrap;gap:8px;margin-top:10px;justify-content:flex-start">${tools}</div></div>`:''}
    ${qual?`<div class="card"><h3>What great looks like</h3><p class="sub sans">The qualities we hire and recognize for.</p><div style="margin-top:8px">${qual}</div></div>`:''}`;
}
function editRoleProfile(){
  const p=HIRE.profile; if(!p) return;
  const qText=p.qualities.map(q=>`${q.name} — ${q.desc||''}`).join('\n');
  const iText=p.interview.map(i=>`${i.q} || ${i.look||''}`).join('\n');
  const save=hmodal(`<h3>Edit ${esc(p.role)} profile</h3>
    <label>Purpose</label><textarea id="rp_purpose" rows="2">${esc(p.purpose||'')}</textarea>
    <label>Defining qualities — one per line: "Name — description"</label><textarea id="rp_qual" rows="7">${esc(qText)}</textarea>
    <label>Key responsibilities — one per line</label><textarea id="rp_resp" rows="6">${esc(p.responsibilities.join('\n'))}</textarea>
    <label>Out of their lane / limitations — one per line</label><textarea id="rp_lim" rows="4">${esc((p.limitations||[]).join('\n'))}</textarea>
    <label>Interview questions — one per line: "Question || what to listen for"</label><textarea id="rp_intv" rows="7">${esc(iText)}</textarea>`);
  save.onclick=async()=>{
    const qualities=$('rp_qual').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const m=l.split(/\s+[—-]\s+/); return {name:(m[0]||'').trim(), desc:(m.slice(1).join(' - ')).trim()}; });
    const interview=$('rp_intv').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const m=l.split('||'); return {q:(m[0]||'').trim(), look:(m[1]||'').trim()}; });
    const responsibilities=$('rp_resp').value.split('\n').map(l=>l.trim()).filter(Boolean);
    const limitations=$('rp_lim').value.split('\n').map(l=>l.trim()).filter(Boolean);
    try{ await api('/hiring/profile/'+encodeURIComponent(p.role),{method:'POST',body:JSON.stringify({purpose:$('rp_purpose').value,qualities,responsibilities,limitations,interview})}); closeHModal(); openHireRole(encodeURIComponent(p.role)); }catch(e){ alert(e.message); }
  };
}
function addCandidate(){
  const save=hmodal(`<h3>Add candidate — ${esc(HIRE.role)}</h3>
    <label>Name</label><input id="cd_name"/>
    <div class="grid2"><div><label>Email</label><input id="cd_email" type="email"/></div><div><label>Phone</label><input id="cd_phone"/></div></div>
    <label>Source (optional)</label><input id="cd_source" placeholder="Referral, Indeed, walk-in…"/>`);
  save.onclick=async()=>{ if(!$('cd_name').value.trim()){ alert('Name?'); return; } try{ await api('/hiring/candidates',{method:'POST',body:JSON.stringify({name:$('cd_name').value,email:$('cd_email').value,phone:$('cd_phone').value,source:$('cd_source').value,role:HIRE.role})}); closeHModal(); openHireRole(encodeURIComponent(HIRE.role)); }catch(e){ alert(e.message); } };
}
function openCandidate(id){
  const c=(HIRE.cands||[]).find(x=>x.id===id); if(!c) return; const p=HIRE.profile; const scores=c.scores||{};
  const qRows=p.qualities.map(q=>`<div class="cmd-row"><div class="cmd-row-main">${esc(q.name)}</div>
    <select class="cand-score" data-q="${esc(q.name)}" style="width:auto"><option value="">—</option>${[1,2,3,4,5,6,7,8,9,10].map(n=>`<option value="${n}" ${String(scores[q.name])===String(n)?'selected':''}>${n}</option>`).join('')}</select></div>`).join('');
  const save=hmodal(`<h3>${esc(c.name)} <span class="hint" style="font-weight:400">· ${esc(c.role)}</span></h3>
    ${c.email?`<div class="hint">${esc(c.email)}${c.phone?' · '+esc(c.phone):''}${c.source?' · via '+esc(c.source):''}</div>`:''}
    <label style="margin-top:8px">Stage</label><select id="cd_stage">${HIRE.stages.map(s=>`<option ${c.stage===s?'selected':''}>${s}</option>`).join('')}</select>
    <h3 style="margin-top:12px;font-size:13px">Score against the defining qualities (1–10)</h3>${qRows}
    <label style="margin-top:10px">Interview notes</label><textarea id="cd_notes" rows="3">${esc(c.notes||'')}</textarea>
    <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-weight:500;margin-top:10px"><input type="checkbox" id="cd_invite" style="width:auto"/> On hire, email them a sign-up invite</label>
    <div class="toolbar" style="margin-top:6px;gap:6px"><button class="btn btn-danger btn-sm sans" onclick="delCandidate(${c.id})">Delete</button><button class="btn btn-primary btn-sm sans" onclick="hireCandidate(${c.id})">✓ Hire</button></div>`);
  save.onclick=async()=>{ const scores={}; let sum=0,n=0; document.querySelectorAll('.cand-score').forEach(s=>{ if(s.value){ scores[s.dataset.q]=+s.value; sum+=+s.value; n++; } }); const rating=n?Math.round(sum/n):0;
    try{ await api('/hiring/candidates/'+c.id,{method:'POST',body:JSON.stringify({stage:$('cd_stage').value,scores,rating,notes:$('cd_notes').value})}); closeHModal(); openHireRole(encodeURIComponent(HIRE.role)); }catch(e){ alert(e.message); } };
}
async function delCandidate(id){ if(!confirm('Remove this candidate?'))return; try{ await api('/hiring/candidates/'+id,{method:'DELETE'}); closeHModal(); openHireRole(encodeURIComponent(HIRE.role)); }catch(e){ alert(e.message); } }
async function hireCandidate(id){ const invite=$('cd_invite')&&$('cd_invite').checked; try{ const r=await api('/hiring/candidates/'+id+'/hire',{method:'POST',body:JSON.stringify({invite})}); closeHModal();
  if(invite) alert(r.invited?'Hired 🎉 — sign-up invite emailed.':('Hired 🎉 '+(r.emailErr||'')+(r.link?'\n\nSend them this link: '+r.link:''))); else alert('Hired 🎉');
  openHireRole(encodeURIComponent(HIRE.role)); }catch(e){ alert(e.message); } }

/* ---- concierge / requests ---- */
function fillClientSelect(el, withBlank){
  return api('/clients').then(({clients})=>{
    el.innerHTML = (withBlank?'<option value="">'+withBlank+'</option>':'') + clients.map(c=>`<option value="${c.id}">${esc(c.pref||c.name)}${c.room?' · '+esc(c.room):''}</option>`).join('');
  }).catch(()=>{});
}
let REQ_STAFF=null;
function reqMins(a,b){ if(!a||!b) return null; const t1=new Date(String(a).replace(' ','T')+'Z'), t2=new Date(String(b).replace(' ','T')+'Z'); const m=Math.round((t2-t1)/60000); return m>=0?m:null; }
function reqDur(m){ if(m==null) return ''; return m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m'; }
function reqTiming(r){
  const now=new Date().toISOString().slice(0,19).replace('T',' ');
  if(r.status==='Done'){ const resp=reqMins(r.created_at,r.acknowledged_at), tot=reqMins(r.created_at,r.done_at); return `<span class="hint">✓ done in ${reqDur(tot)}${resp!=null?' · responded in '+reqDur(resp):''}</span>`; }
  if(r.acknowledged_at){ const resp=reqMins(r.created_at,r.acknowledged_at); const openFor=reqMins(r.acknowledged_at,now); return `<span class="hint">responded in ${reqDur(resp)} · in progress ${reqDur(openFor)}</span>`; }
  const waiting=reqMins(r.created_at,now); const warn=waiting!=null&&waiting>=15; return `<span class="hint" style="${warn?'color:var(--danger);font-weight:600':''}">⏱ waiting ${reqDur(waiting)}${warn?' — needs a response':''}</span>`;
}
async function loadConcierge(){
  if(META.kioskCode && $('kioskCodeHint2')) $('kioskCodeHint2').innerHTML = 'Kiosk code: <strong>'+esc(META.kioskCode)+'</strong> — staff enter this to begin (change it in Settings → Kiosk &amp; display code).';
  await fillClientSelect($('rq_client'), 'Whole house / no client');
  if(!REQ_STAFF){ try{ const {staff}=await api('/staff'); REQ_STAFF=staff; }catch(e){ REQ_STAFF=[]; } }
  if($('rq_dept').options.length===0){ $('rq_dept').innerHTML=(META.departments||[]).map(d=>`<option>${esc(d)}</option>`).join(''); $('rq_filter_dept').innerHTML='<option value="">All departments</option>'+(META.departments||[]).map(d=>`<option>${esc(d)}</option>`).join(''); }
  const dept=$('rq_filter_dept').value, status=$('rq_filter_status').value;
  const qs = new URLSearchParams(); if(dept) qs.set('department',dept); if(status) qs.set('status',status);
  const { requests } = await api('/requests?'+qs.toString());
  const opts=(sel)=>'<option value="">Assign…</option>'+REQ_STAFF.map(u=>`<option value="${u.id}"${+sel===u.id?' selected':''}>${esc(u.name)}</option>`).join('');
  const byDept = {}; requests.forEach(r=>{ (byDept[r.department]=byDept[r.department]||[]).push(r); });
  const board = Object.keys(byDept).sort().map(dep=>`<div class="card"><h3>${esc(dep)} <span class="hint">(${byDept[dep].length})</span></h3>
    ${byDept[dep].map(r=>`<div class="todo ${r.status==='Done'?'done':''}">
      <div class="txt"><span class="pr ${r.priority==='High'?'high':'normal'}">${r.status==='Done'?'DONE':r.status==='In progress'?'IN PROGRESS':esc(r.priority)}</span>
        ${r.pref?'<strong>'+esc(r.pref)+'</strong> — ':''}${esc(r.text)} <span class="hint">· ${esc(r.created_by_name||'')}</span>
        <div style="margin-top:3px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${reqTiming(r)}${r.assigned_name?'<span class="hint">· 👤 '+esc(r.assigned_name)+'</span>':''}</div></div>
      ${r.status!=='Done'?`<select class="sans" style="max-width:130px" onchange="assignRequest(${r.id},this.value)">${opts(r.assigned_to)}</select>
        <button class="btn btn-ghost btn-sm sans" onclick="setRequestStatus(${r.id},'Done')">Done</button>`:''}
    </div>`).join('')}</div>`).join('');
  $('rqBoard').innerHTML = board || '<div class="empty">No requests. Anticipate a wish and log it.</div>';
  loadConciergeStats();
  loadComfortMeds();
}
async function assignRequest(id,uid){ try{ await api('/requests/'+id+'/assign',{method:'POST',body:JSON.stringify({user_id:uid||null})}); loadConcierge(); pollReqBadge(); }catch(e){ alert(e.message); } }
async function loadConciergeStats(){
  const el=$('rqStats'); if(!el) return;
  let d; try{ d=await api('/requests/stats?days=7'); }catch(e){ return; }
  const fmt=(m)=> m==null?'—':(m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m');
  el.innerHTML=`<div class="ret-cards" style="margin:10px 0">
      <div class="ret-card"><div class="n">${fmt(d.avgRespMin)}</div><div class="l">Avg response</div></div>
      <div class="ret-card"><div class="n">${fmt(d.avgResolveMin)}</div><div class="l">Avg to done</div></div>
      <div class="ret-card ${d.within15Pct!=null&&d.within15Pct<70?'rc-warn':''}"><div class="n">${d.within15Pct==null?'—':d.within15Pct+'%'}</div><div class="l">Responded ≤15m</div></div>
      <div class="ret-card"><div class="n">${d.total}</div><div class="l">Requests (7d)</div></div>
    </div>
    <div class="cmd-sub">🏅 Fastest responders</div>
    ${d.leaderboard.length?`<table class="tbl"><thead><tr><th>Teammate</th><th style="text-align:right">Handled</th><th style="text-align:right">Avg response</th></tr></thead><tbody>${d.leaderboard.map((b,i)=>`<tr><td>${i===0?'🥇 ':''}${esc(b.name)}</td><td style="text-align:right">${b.n}</td><td style="text-align:right">${fmt(b.avgRespMin)}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">No responses logged yet this week.</div>'}`;
}
async function addRequest(){
  const text=$('rq_text').value.trim(); if(!text) return;
  const msg=$('rq_msg'); if(msg) msg.textContent='Logging…';
  try{
    const r=await api('/requests',{method:'POST',body:JSON.stringify({client_id:$('rq_client').value||null,department:$('rq_dept').value,text,priority:$('rq_pri').value})});
    $('rq_text').value=''; loadConcierge(); if(typeof pollReqBadge==='function') pollReqBadge();
    if(msg) msg.innerHTML = r.emailed ? ('✓ Logged · team alerted · emailed <b>'+esc(r.to||'concierge')+'</b>')
      : ('✓ Logged · team alerted'+(r.emailReason?(' · <span style="color:var(--danger)">email not sent: '+esc(r.emailReason)+'</span>'):''));
  }catch(e){ if(msg) msg.textContent=e.message; }
}
async function setRequestStatus(id,status){ await api('/requests/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadConcierge(); if(typeof pollReqBadge==='function') pollReqBadge(); }

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
      ${sec("Care tasks", `<div id="jTaskWrap"></div>`)}
      ${sec("Today's schedule", schedHtml)}
      ${sec('Open requests', reqHtml)}
      ${sec('Open concerns', concernHtml)}
      ${sec('🎯 Engagement', (c.interests?`<div class="pc-note">💛 Loves: ${esc(c.interests)}</div>`:'<div class="pc-note">No interests set — ask and add to the Care Card.</div>')+`<div class="pc-note">${j.activityWeek||0} activit${(j.activityWeek||0)===1?'y':'ies'} this week</div>`+((j.activities||[]).length?j.activities.map(a=>`<div class="pc-note">▸ ${esc(a.type)} <span class="hint">· ${esc(a.d)}${a.by_name?' · '+esc(a.by_name):''}</span></div>`).join(''):'<div class="pc-note">No activities logged yet.</div>')+`<button class="btn btn-gold btn-sm sans no-print" style="margin-top:6px" onclick="dashLogActivity(${c.id}, ${JSON.stringify(c.pref||c.name).replace(/"/g,'&quot;')})">Log activity</button>`)}
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
      <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-gold sans" onclick="addNote(${c.id})">Scan &amp; save</button><button id="notePushKipu" class="btn btn-ghost btn-sm sans" style="display:none" onclick="pushNoteToKipu(this.dataset.clientId,this.dataset.text,'note',this)">Push to Kipu</button></div>
      <div id="noteResult"></div>
      <div id="notesList"></div>
    </div>`;
  JOURNEY_C = c; JTASK_ALL = false; renderJourneyTasks();
  loadClientNotes(c.id);
  loadOneJourney({client_id:c.id}, 'journeyBody');
}
/* ---- One Journey: the same person across detox, outpatient & sober living ---- */
async function loadOneJourney(params, hostId){
  try{
    const qs = Object.entries(params).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
    const j = await api('/person/journey?'+qs);
    if(!j.person || (j.episodes||[]).length < 2) return;   // one episode = no story to tell yet
    const host = $(hostId); if(!host) return;
    const ICON = {residential:'🏥', outpatient:'🧠', housing:'🏠'};
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<h3 style="margin:0 0 2px">🧭 One Journey — across Armada</h3>
      <div class="hint" style="margin-bottom:8px">${esc(j.person.name)}${j.person.dob?' · DOB '+esc(j.person.dob):''} · ${j.episodes.length} episodes</div>
      ${j.episodes.map(e=>`<div class="pc-note" style="display:flex;gap:8px;align-items:baseline${e.active?';font-weight:600':''}">
        <span>${ICON[e.world]||'•'}</span>
        <span style="min-width:150px;white-space:nowrap">${esc(e.start||'?')}${e.end?' → '+esc(e.end):(e.active?' → now':'')}</span>
        <span>${esc(e.label)} · ${esc(e.facility)}${e.detail?` <span class="hint">(${esc(e.detail)})</span>`:''} — ${esc(e.status)}</span>
      </div>`).join('')}`;
    host.appendChild(div);
  }catch(_e){ /* the journey card is a bonus — never block the page */ }
}
// This client's shift tasks, defaulting to the viewer's role; full plan on a toggle.
let JOURNEY_C = null, JTASK_ALL = false;
function renderJourneyTasks(){
  const wrap=$('jTaskWrap'); if(!wrap||!JOURNEY_C) return;
  const all=(JOURNEY_C.tasks||[]);
  const leadAll = ME.role==='admin' || ME.job_role==='Executive Director';
  const showAll = leadAll || JTASK_ALL;
  const list = showAll ? all : all.filter(t=> t.job_role==='All' || t.job_role===ME.job_role);
  const rows = list.length ? list.map(t=>`<div class="pc-note"><span class="pr ${t.priority==='High'?'high':'normal'}">${t.priority==='High'?'PRIORITY':(t.job_role==='All'?'ALL':esc(t.job_role))}</span> <span class="hint">${esc(t.shift)}</span> · ${esc(t.text)}</div>`).join('')
    : `<div class="pc-note">${all.length?'No tasks for your role — tap "Show all roles" for the full plan.':'No shift tasks set.'}</div>`;
  const toggle = (!leadAll && all.length) ? `<button class="btn btn-ghost btn-sm sans no-print" style="margin-top:6px" onclick="JTASK_ALL=!JTASK_ALL;renderJourneyTasks()">${JTASK_ALL?'Show just my role':'Show all roles ('+all.length+')'}</button>` : '';
  wrap.innerHTML = rows + toggle;
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
    const pushBtn = $('notePushKipu');
    $('noteResult').innerHTML = r.flagged ? `<div class="ama-banner ${r.level==='High'?'ama-high':'ama-elev'}" style="margin:8px 0"><div class="ama-head">⚑ Red flag (${esc(r.level)})</div><div class="ama-sum">${esc(r.summary||'')}</div><div class="pc-note">→ ${esc(r.suggested_action||'')}</div></div>` : '<div class="hint" style="margin:6px 0">✓ Saved — no red flags found.</div>';
    $('noteText').value=''; loadClientNotes(clientId);
    if(pushBtn){ pushBtn.dataset.clientId=clientId; pushBtn.dataset.text=t; pushBtn.style.display='inline-flex'; }
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
function renderCareCardsList(d){
  if(!$('todayCcList')) return;
  const inc=d.incomplete||[];
  $('todayCcCount').textContent = inc.length+(d.overdue?' · '+d.overdue+' overdue':'');
  $('todayCcList').innerHTML = inc.length ? inc.map(c=>{
    const m=c.minsSinceAdmit;
    const clock = m==null?'':(m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m')+' since admit';
    return `<div class="cmd-row ${c.overdue?'cmd-row-flag':''}">
      <div class="cmd-row-main"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}
        <div class="hint">${c.overdue?'<span style="color:var(--danger);font-weight:600">OVERDUE</span> · ':''}${clock} · missing: ${c.missing.map(esc).join(', ')}</div></div>
      <button class="btn btn-gold btn-sm sans" onclick="openJourney(${c.id})">Fill</button></div>`;
  }).join('') : '<div class="pc-note">✓ Every care card is complete.</div>';
}
// One detail panel open at a time; tiles drive it. nav: jumps to another view.
function todayPanel(key){
  if(String(key).startsWith('nav:')){ show(key.slice(4)); return; }
  const map={alerts:'alertsCard',carecards:'todayCareCards',attention:'attentionCard'};
  const id=map[key]; if(!id||!$(id)) return;
  const isOpen = $(id).style.display!=='none';
  document.querySelectorAll('#today .today-panel').forEach(p=>p.style.display='none');
  document.querySelectorAll('#todayActionTiles .ret-card').forEach(t=>t.classList.remove('tile-active'));
  if(!isOpen){ $(id).style.display='block'; const tile=document.querySelector(`#todayActionTiles [data-tile="${key}"]`); if(tile) tile.classList.add('tile-active'); $(id).scrollIntoView({behavior:'smooth',block:'nearest'}); }
}
function renderAttentionList(t){
  const icon={risk:'⚠',welcome:'☀',call:'🤝',request:'🛎'};
  $('todayAttention').innerHTML = (t.attention||[]).length ? t.attention.map(a=>`<div class="todo">
      <div class="txt">${icon[a.kind]||'•'} ${esc(a.text)}</div>
      ${a.client_id?`<button class="btn btn-ghost btn-sm sans" onclick="openJourney(${a.client_id})">Open</button>`:''}</div>`).join('') : '<div class="pc-note">✓ All clear. Touch every client, deliver every personal touch.</div>';
}
/* ---- Continuum of Care ---- */
let CONTINUUM_DATA=null;
async function loadContinuum(){
  let d; try{ d=await api('/continuum'); }catch(e){ if($('contBoard')) $('contBoard').innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  CONTINUUM_DATA=d;
  const pct = d.total? Math.round(d.planned/d.total*100):100;
  $('contKpis').innerHTML = `<div class="ret-card ${d.needsPlan.length?'rc-high':''}"><div class="n">${pct}%</div><div class="l">Have a next-step plan</div></div>`+
    `<div class="ret-card ${d.needsPlan.length?'rc-high':''}"><div class="n">${d.needsPlan.length}</div><div class="l">No plan yet</div></div>`+
    `<div class="ret-card"><div class="n">${d.destCounts['Armada Outpatient']||0}</div><div class="l">→ Armada Outpatient</div></div>`+
    `<div class="ret-card"><div class="n">${d.conversion.toArmada}</div><div class="l">Continued w/ Armada (90d)</div></div>`;
  const planBtn=(r)=>`<button class="btn btn-gold btn-sm sans" onclick="planContinuum(${r.id}, ${JSON.stringify(r.name).replace(/"/g,'&quot;')})">Set plan</button>`;
  $('contNeedsPlan').innerHTML = d.needsPlan.length ? d.needsPlan.map(r=>`<div class="todo"><div class="txt"><strong>${esc(r.name)}</strong>${r.room?' <span class="hint">· '+esc(r.room)+'</span>':''} <span class="hint">· ${esc(r.loc||'')}${r.caseManager?' · CM: '+esc(r.caseManager):' · no CM'}</span></div>${planBtn(r)}</div>`).join('') : '<div class="pc-note">✓ Everyone has a next-step plan.</div>';
  try{ const di=await api('/discharges/incomplete'); const inc=di.incomplete||[];
    if($('dcIncompleteCard')){ $('dcIncompleteCard').style.display = inc.length?'block':'none';
      $('dcIncomplete').innerHTML = inc.map(c=>`<div class="todo" onclick="editClient(${c.id})" style="cursor:pointer"><div class="txt"><span class="risk risk-high">INCOMPLETE</span> <strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''} <span class="hint">· discharged ${esc(c.date)}</span><div class="hint">missing: ${esc(c.missing.join(', '))}${c.kipuStaff?' · Kipu discharge by '+esc(c.kipuStaff):(c.owner?' · owner: '+esc(c.owner):'')}</div></div><span class="hint">complete ›</span></div>`).join(''); } }catch(e){}
  $('contBoard').innerHTML = d.rows.length ? `<table class="tbl"><tr><th>Client</th><th>Now</th><th>Next</th><th>Destination</th><th>By</th><th></th></tr>${d.rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong>${r.room?' <span class="hint">'+esc(r.room)+'</span>':''}</td><td>${esc(r.loc||'—')}</td><td>${esc(r.nextLoc||'—')}</td><td>${r.hasPlan?'<span class="risk risk-low">'+esc(r.destName||r.dest)+'</span>':'<span class="risk risk-high">none</span>'}</td><td class="hint">${esc(r.caseManager||'—')}</td><td>${planBtn(r)}</td></tr>`).join('')}</table>` : '<div class="hint">No active clients.</div>';
  $('contCM').innerHTML = d.byCM.length ? `<table class="tbl"><tr><th>Case manager</th><th>Clients</th><th>Planned</th><th>→ Armada</th></tr>${d.byCM.map(c=>`<tr><td>${esc(c.cm)}</td><td>${c.total}</td><td>${c.planned}/${c.total}</td><td>${c.armada}</td></tr>`).join('')}</table>` : '<div class="hint">—</div>';
}
async function planContinuum(id, name){
  const d=CONTINUUM_DATA; if(!d) return;
  const dest = await pickFrom('Plan the next step for '+name, d.dests); if(!dest) return;
  let fid=null;
  if(dest==='Approved partner'){
    if(!d.partners.length){ alert('No approved partners set yet. An admin marks them under "Approved referral partners".'); return; }
    const f = await pickFrom('Which approved partner?', d.partners.map(p=>p.name)); if(!f) return;
    fid = (d.partners.find(p=>p.name===f)||{}).id||null;
  }
  const nl = prompt('Next level of care (optional — e.g. PHP, IOP, Outpatient):','')||'';
  try{ await api('/clients/'+id+'/continuum',{method:'POST',body:JSON.stringify({aftercare_dest:dest, aftercare_facility_id:fid, next_loc:nl})}); loadContinuum(); }catch(e){ alert(e.message); }
}
function pickFrom(title, opts){ const list=opts.map((o,i)=>`${i+1}. ${o}`).join('\n'); const p=prompt(`${title}:\n\n${list}\n\nEnter a number:`); if(p===null) return Promise.resolve(null); const i=parseInt(p,10); return Promise.resolve(opts[i-1]||null); }
async function togglePartner(id, on){ try{ await api('/facilities/'+id+'/preferred',{method:'POST',body:JSON.stringify({preferred:on?1:0})}); loadApprovedPartners(); }catch(e){ alert(e.message); } }
async function loadApprovedPartners(){ if(!$('ap_list')) return; try{ const {facilities}=await api('/facilities'); $('ap_list').innerHTML = facilities.length ? facilities.map(f=>`<label class="sans" style="display:inline-flex;align-items:center;gap:6px;border:1px solid ${f.preferred?'var(--gold)':'var(--line)'};border-radius:8px;padding:6px 11px;margin:3px;cursor:pointer">${f.preferred?'✓ ':''}<input type="checkbox" ${f.preferred?'checked':''} onchange="togglePartner(${f.id}, this.checked)"/> ${esc(f.name)}</label>`).join('') : '<div class="hint">No facilities yet. Add one above, or they appear as you log outbound referrals.</div>'; }catch(e){} }
async function addApprovedPartner(){ const n=$('ap_new')?$('ap_new').value.trim():''; if(!n){ return; } try{ await api('/partners/approve',{method:'POST',body:JSON.stringify({name:n})}); $('ap_new').value=''; if($('ap_msg'))$('ap_msg').textContent='✓ Approved'; loadApprovedPartners(); }catch(e){ if($('ap_msg'))$('ap_msg').textContent=e.message; } }

/* ---- Engagement: client engagement tracking + STAFF rewards ---- */
let ENG_RANGE='week', ENG_STAFF=null;
async function loadEngagement(){
  let e, s; try{ [e, s] = await Promise.all([api('/engagement'), api('/engagement/staff')]); }catch(ex){ if($('engStaff')) $('engStaff').innerHTML='<div class="hint">'+esc(ex.message)+'</div>'; return; }
  ENG_STAFF=s;
  $('engKpis').innerHTML = `<div class="ret-card"><div class="n">${e.pctEngaged!=null?e.pctEngaged+'%':'—'}</div><div class="l">Engaged today</div></div>`+
    `<div class="ret-card ${e.disengaged.length?'rc-warn':''}"><div class="n">${e.disengaged.length}</div><div class="l">Not engaged today</div></div>`+
    `<div class="ret-card"><div class="n">${s.total}</div><div class="l">Activities logged (all-time)</div></div>`;
  $('engDisengaged').innerHTML = e.disengaged.length ? e.disengaged.map(c=>`<div class="todo"><div class="txt"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''}${c.interests?'<div class="hint">💛 loves: '+esc(c.interests)+'</div>':'<div class="hint">no interests set — ask &amp; add to Care Card</div>'}</div><button class="btn btn-gold btn-sm sans" onclick="dashLogActivity(${c.id}, ${JSON.stringify(c.name).replace(/"/g,'&quot;')})">Log activity</button></div>`).join('') : '<div class="pc-note">✓ Everyone engaged today.</div>';
  // Group/session logger
  if($('grp_type')){ $('grp_type').innerHTML = AMENITIES.concat(['Group therapy','Outing']).map(a=>`<option>${esc(a)}</option>`).join(''); }
  if($('grp_clients')){ $('grp_clients').innerHTML = (e.rows||[]).map(c=>`<label class="sans" style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:8px;padding:5px 9px;cursor:pointer"><input type="checkbox" value="${c.id}"/> ${esc(c.name)}${c.room?' <span class="hint">'+esc(c.room)+'</span>':''}</label>`).join(''); }
  renderEngStaff();
}
async function logGroup(){
  const type=$('grp_type').value; const ids=[...document.querySelectorAll('#grp_clients input:checked')].map(x=>+x.value);
  if(!type||!ids.length){ $('grp_msg').textContent='Pick an activity and at least one client.'; return; }
  try{ const r=await api('/activities/bulk',{method:'POST',body:JSON.stringify({type, client_ids:ids})}); $('grp_msg').textContent='✓ Logged '+r.logged+' attendee(s).'; loadEngagement(); }
  catch(e){ $('grp_msg').innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; }
}
function setEngRange(r){ ENG_RANGE=r; $('engTabWeek').classList.toggle('active',r==='week'); $('engTabMonth').classList.toggle('active',r==='month'); renderEngStaff(); }
function renderEngStaff(){
  if(!ENG_STAFF) return;
  const rows = ENG_RANGE==='month'?ENG_STAFF.month:ENG_STAFF.week;
  const medal=i=>['🥇','🥈','🥉'][i]||(i+1)+'.';
  $('engStaff').innerHTML = rows.length ? `<table class="tbl"><tr><th>Staff</th><th>Activities</th><th>Clients engaged</th></tr>${rows.map((r,i)=>`<tr><td>${medal(i)} <strong>${esc(r.by_name)}</strong></td><td>${r.n}</td><td>${r.clients}</td></tr>`).join('')}</table>` : '<div class="hint">No activities logged yet this '+ENG_RANGE+'. Log one from the disengaged list above.</div>';
}

/* ---- The Table: meal service / caterer delivery inspection ---- */
let MEALS_DATA=null, MEAL_PHOTO={};
async function loadMeals(){
  let d; try{ d=await api('/meals/today'); }catch(e){ $('mealsToday').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  MEALS_DATA=d;
  const done=d.today.filter(m=>m.logged).length, issues=d.today.filter(m=>m.logged&&!m.complete).length;
  const late=d.today.filter(m=>m.timeliness==='late'||m.timeliness==='overdue').length;
  $('mealsKpis').innerHTML = `
    <div class="ret-card"><div class="n">${d.expected}</div><div class="l">On the unit (portions)</div></div>
    <div class="ret-card ${done<d.today.length?'rc-warn':''}"><div class="n">${done}/${d.today.length}</div><div class="l">Meals inspected today</div></div>
    <div class="ret-card ${late?'rc-high':''}"><div class="n">${late}</div><div class="l">Late / overdue</div></div>
    <div class="ret-card ${issues?'rc-high':''}"><div class="n">${issues}</div><div class="l">Flagged today</div></div>`;
  $('mealsToday').innerHTML = d.today.map(m=>mealCard(m,d)).join('');
  loadSnack();
  loadMealsScore();
  loadMenu();
  loadMealFeedback();
  loadMealInsights();
}
async function loadMealInsights(){
  const el=$('mealInsights'); if(!el) return;
  const days=$('insightDays')?$('insightDays').value:30;
  let d; try{ d=await api('/meals/insights?days='+days); }catch(e){ el.innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const col=(p)=> p==null?'var(--muted)':p>=70?'var(--good)':p>=40?'var(--gold)':'var(--danger)';
  const bar=(p)=> `<span style="display:inline-block;min-width:42px;color:${col(p)};font-weight:600">${p==null?'—':p+'%'}</span>`;
  // Which meal slot lands best
  const withData = d.byMeal.filter(m=>m.likedPct!=null);
  const best = withData.length ? withData.reduce((a,b)=>(b.likedPct>a.likedPct?b:a)) : null;
  let mealRows = d.byMeal.length ? d.byMeal.map(m=>`<tr${best&&m.meal===best.meal?' style="background:#faf6ee"':''}>
      <td style="font-weight:600">${esc(m.meal)}${best&&m.meal===best.meal?' 🏆':''}</td>
      <td>${bar(m.likedPct)} <span class="hint">enjoyed</span></td>
      <td>${bar(m.enoughPct)} <span class="hint">enough</span></td>
      <td>${bar(m.againPct)} <span class="hint">want again</span></td>
      <td class="hint">${m.n}</td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">No ratings yet.</td></tr>';
  const dishList=(arr,emptyMsg)=> arr.length ? arr.map(x=>`<div class="sans" style="margin:5px 0;font-size:14px">
      <b>${esc(x.dish)}</b> <span class="hint">(${esc(x.meal)}, ${x.n})</span><br>
      <span style="color:${col(x.likedPct)}">${x.likedPct==null?'—':x.likedPct+'% enjoyed'}</span> ·
      <span style="color:${col(x.againPct)}">${x.againPct==null?'—':x.againPct+'% want again'}</span></div>`).join('')
    : '<div class="empty">'+emptyMsg+'</div>';
  el.innerHTML = `
    <table class="tbl" style="width:100%;font-size:14px"><tbody>${mealRows}</tbody></table>
    <div class="grid2" style="margin-top:14px">
      <div><strong class="sans">⭐ Crowd favorites — repeat these</strong>${dishList(d.favorites,'Set dish names in the menu above so favorites can be tracked.')}</div>
      <div><strong class="sans">🚫 Reconsider / retire</strong>${dishList(d.retire,'Nothing flagged — no dish is rating poorly. 👍')}</div>
    </div>
    <p class="hint" style="margin-top:8px">Dishes need at least ${d.minN} ratings to rank. ${d.dishCount} dish${d.dishCount===1?'':'es'} have enough so far.</p>`;
}
async function loadMenu(){
  const el=$('menuRows'); if(!el) return;
  if($('menuDate') && !$('menuDate').value){ $('menuDate').value=new Date().toISOString().slice(0,10); }
  const date=$('menuDate')?$('menuDate').value:'';
  let d; try{ d=await api('/meals/menu'+(date?('?date='+date):'')); }catch(e){ el.innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const meals=['Breakfast','Lunch','Dinner'];
  el.innerHTML = meals.map(m=>{
    const cur=(d.meals&&d.meals[m])?d.meals[m]:{dish:'',notes:''};
    return `<div class="toolbar" style="gap:8px;margin:6px 0;align-items:center">
      <div style="width:90px;color:var(--muted);font-weight:600" class="sans">${m}</div>
      <input id="dish_${m}" class="sans" style="flex:1" placeholder="e.g. Grilled chicken, rice, green beans" value="${esc(cur.dish||'')}"/>
      <button class="btn btn-ghost btn-sm sans" onclick="saveMenu('${m}')">Save</button>
    </div>`;
  }).join('');
}
async function saveMenu(meal){
  const date=$('menuDate')?$('menuDate').value:'';
  const dish=$('dish_'+meal)?$('dish_'+meal).value.trim():'';
  $('menu_msg').textContent='Saving '+meal+'…';
  try{ await api('/meals/menu',{method:'POST',body:JSON.stringify({date,meal,dish})});
    $('menu_msg').textContent='✓ '+meal+' menu saved';
    loadMealFeedback();   // refresh grid so the dish shows alongside ratings
  }catch(e){ $('menu_msg').textContent='Error: '+esc(e.message); }
}
async function loadMealFeedback(){
  const el=$('mealFeedback'); if(!el) return;
  let d; try{ d=await api('/meals/feedback?days=14'); }catch(e){ el.innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if(!d.byDay.length){ el.innerHTML='<div class="empty">No resident meal feedback yet. It appears here as they tap "How was the meal?" on the dining-room kiosk (reload the kiosk once so the button shows). <br><span class="hint">The longer ⭐ Meal &amp; Food Survey is separate — its responses live under the Surveys tab.</span></div>'; return; }
  const meals=['Breakfast','Lunch','Dinner'];
  const total=d.byDay.reduce((s,day)=> s + meals.reduce((t,m)=> t + (day.meals[m]?day.meals[m].n:0), 0), 0);
  const cellPct=(p)=> p==null?'<span class="hint">—</span>':`<span style="color:${p>=70?'var(--good)':p>=40?'var(--gold)':'var(--danger)'}">${p}%</span>`;
  const cell=(m)=> m?`${m.dish?`<div style="font-weight:600;color:var(--navy);font-size:12px">${esc(m.dish)}</div>`:''}${cellPct(m.likedPct)} liked · ${cellPct(m.enoughPct)} enough · ${cellPct(m.againPct)} again <span class="hint">(${m.n})</span>`:'<span class="hint">—</span>';
  const niceDate=(s)=>{const dt=new Date(s+'T12:00:00'); return dt.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});};
  let rows = d.byDay.map(day=>`<tr><td style="white-space:nowrap;font-weight:600">${niceDate(day.date)}</td>`
    + meals.map(m=>`<td style="font-size:13px">${cell(day.meals[m])}</td>`).join('') + '</tr>').join('');
  let html = `<div class="sans" style="margin-bottom:8px"><strong>${total} tap${total===1?'':'s'} in the last 14 days</strong> <span class="hint">— the number in parentheses on each meal is how many people tapped it. The longer ⭐ Meal &amp; Food Survey is separate; its responses are under the Surveys tab.</span></div>`
    + `<div style="overflow-x:auto"><table class="tbl" style="width:100%;font-size:14px">
    <thead><tr><th>Day</th>${meals.map(m=>`<th>${m}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  if(d.comments.length){
    html += '<div style="margin-top:12px"><strong class="sans">In their words</strong>'
      + d.comments.slice(0,12).map(c=>`<div class="sans" style="margin-top:6px;font-size:14px">“${esc(c.comment)}” <span class="hint">— ${esc(c.pref||'a resident')}, ${esc(c.meal)} ${esc(c.meal_date)}</span></div>`).join('')
      + '</div>';
  }
  el.innerHTML = html;
}
function mealCard(m,d){
  const cur = m.meal===d.current;
  const open = cur && !m.logged;   // auto-open the current uninspected meal
  const statusPill = !m.logged ? '<span class="risk risk-warn">not inspected</span>'
    : m.complete ? '<span class="risk risk-low">✓ complete</span>' : '<span class="risk risk-high">⚠ issue</span>';
  const chosen = m.groups||[];
  const req0 = m.required||[];
  const groupChips = d.groups.map(g=>{
    const on = chosen.includes(g); const req = req0.includes(g);
    return `<button type="button" class="meal-grp${on?' on':''}" data-meal="${m.meal}" data-grp="${esc(g)}" data-req="${req?1:0}" onclick="toggleGroup(this)">${on?'✓ ':''}${esc(g)}${req?' *':''}</button>`;
  }).join('');
  const likeBtn=(v,lbl)=>`<button type="button" class="meal-like${m.liked===v?' on':''}" data-meal="${m.meal}" data-like="${v}" onclick="pickLike(this)">${lbl}</button>`;
  const timePill = m.timeliness==='late' ? '<span class="risk risk-high">served late</span>'
    : m.timeliness==='overdue' ? '<span class="risk risk-high">⏰ LATE — serve now</span>'
    : m.timeliness==='ontime' ? '<span class="risk risk-low">on time</span>'
    : m.timeliness==='upcoming' ? `<span class="hint">serves ${esc(m.target||'')}</span>` : '';
  const star=(n)=>`<button type="button" class="meal-star${m.quality&&n<=m.quality?' on':''}" data-q="${n}" onclick="pickStar(this)">★</button>`;
  return `<details class="card" ${open?'open':''}>
    <summary class="sans" style="cursor:pointer;font-weight:600">${esc(m.meal)} ${statusPill} ${timePill} ${cur?'<span class="badge">now</span>':''} ${m.logged?`<span class="hint">· ${m.received??'?'}/${m.expected??'?'} portions${m.served_at?' · served '+esc(m.served_at):''}${m.by?' · '+esc(m.by):''}</span>`:''}</summary>
    <div style="margin-top:12px">
      <div class="grid2">
        <div class="field"><label>Portions needed (on the unit)</label><input type="number" id="meal_exp_${m.meal}" min="0" value="${m.expected!=null?m.expected:d.expected}"/></div>
        <div class="field"><label>Portions delivered</label><input type="number" id="meal_rec_${m.meal}" min="0" value="${m.received!=null?m.received:''}" placeholder="count what arrived"/></div>
      </div>
      <div class="field"><label>Time served ⏰ — serve on time; respecting their time respects them${m.target?` (target ${esc(m.target)})`:''}</label><input type="time" id="meal_served_${m.meal}" value="${esc(m.served_at||'')}"/></div>
      <label>Food groups delivered <span class="hint">(* = required for a complete plate)</span></label>
      <div id="meal_grps_${m.meal}" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 12px">${groupChips}</div>
      <label>Quality rating ⭐ — rate every meal 1–10 so we hold quality</label>
      <div id="meal_q_${m.meal}" class="meal-stars" data-val="${m.quality||''}" style="margin:4px 0 12px;flex-wrap:wrap">${[1,2,3,4,5,6,7,8,9,10].map(star).join('')}</div>
      <label>Did clients like it?</label>
      <div id="meal_like_${m.meal}" style="display:flex;gap:6px;margin:4px 0 12px">${likeBtn('Liked','👍 Liked')}${likeBtn('OK','😐 OK')}${likeBtn('Disliked','👎 No')}</div>
      <div class="field"><label>Issues / what was missing (optional)</label><textarea id="meal_iss_${m.meal}" rows="2" placeholder="e.g. only 18 trays for 22 · no vegetable · chicken undercooked">${esc(m.issues||'')}</textarea></div>
      <div class="toolbar" style="justify-content:flex-start;align-items:center">
        <label class="btn btn-ghost btn-sm sans" style="cursor:pointer;margin:0">📷 Photo<input type="file" accept="image/*" capture="environment" style="display:none" onchange="mealPhotoPick('${m.meal}',this)"/></label>
        <span id="meal_thumb_${m.meal}">${m.photo?`<img src="${m.photo}" style="height:36px;border-radius:6px;cursor:pointer" onclick="maintLightbox(this.src)"/>`:''}</span>
        <button class="btn btn-gold sans" onclick="saveMealCheck('${m.meal}')">Save inspection</button>
        <span id="meal_msg_${m.meal}" class="hint" style="align-self:center"></span>
      </div>
    </div>
  </details>`;
}
function toggleGroup(b){ b.classList.toggle('on'); b.textContent=(b.classList.contains('on')?'✓ ':'')+b.dataset.grp+(b.dataset.req==='1'?' *':''); }
function pickLike(b){ b.parentNode.querySelectorAll('.meal-like').forEach(x=>x.classList.remove('on')); b.classList.add('on'); b.parentNode.dataset.val=b.dataset.like; }
function pickStar(b){ const n=+b.dataset.q, wrap=b.parentNode; wrap.dataset.val=n; wrap.querySelectorAll('.meal-star').forEach(s=>s.classList.toggle('on', +s.dataset.q<=n)); }
async function mealPhotoPick(meal,input){ const f=input.files&&input.files[0]; if(!f)return; try{ MEAL_PHOTO[meal]=await resizeImage(f,900,0.7); $('meal_thumb_'+meal).innerHTML=`<img src="${MEAL_PHOTO[meal]}" style="height:36px;border-radius:6px"/>`; }catch(e){} input.value=''; }
async function saveMealCheck(meal){
  const grps=[...document.querySelectorAll(`#meal_grps_${meal} .meal-grp.on`)].map(b=>b.dataset.grp);
  const likeWrap=$('meal_like_'+meal); const liked=likeWrap?likeWrap.dataset.val:'';
  const qWrap=$('meal_q_'+meal); const quality=qWrap&&qWrap.dataset.val?+qWrap.dataset.val:undefined;
  const served_at=$('meal_served_'+meal)?$('meal_served_'+meal).value:'';
  const body={ meal, expected:$('meal_exp_'+meal).value, received:$('meal_rec_'+meal).value, groups:grps, liked:liked||undefined, quality, served_at:served_at||undefined, issues:$('meal_iss_'+meal).value };
  if(MEAL_PHOTO[meal]) body.photo=MEAL_PHOTO[meal];
  $('meal_msg_'+meal).textContent='Saving…';
  try{ const r=await api('/meals/check',{method:'POST',body:JSON.stringify(body)});
    $('meal_msg_'+meal).textContent = r.complete?'✓ Complete':('⚠ '+([r.enough?'':'short on portions', r.missing.length?'missing '+r.missing.join(', '):''].filter(Boolean).join(' · ')||'logged'));
    delete MEAL_PHOTO[meal]; loadMeals();
  }catch(e){ $('meal_msg_'+meal).textContent=e.message; }
}
async function loadSnack(){
  const el=$('snackBody'); if(!el) return;
  let sn=(MEALS_DATA&&MEALS_DATA.snack); if(!sn){ try{ sn=await api('/meals/snack'); }catch(e){ el.innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; } }
  const ageStr = sn.ageMin==null?'not stocked yet today':(sn.ageMin<60?sn.ageMin+'m ago':Math.round(sn.ageMin/60)+'h ago');
  const tog=(id,lbl)=>`<label class="pi-toggle" style="margin:0"><input type="checkbox" id="${id}" checked/> <span>${lbl}</span></label>`;
  el.innerHTML=`<div class="${sn.stale?'pc-note':'hint'}" style="margin-bottom:10px">${sn.stale?'⚠ ':'✓ '}${sn.lastBy?('Last stocked '+ageStr+' by '+esc(sn.lastBy)):'Not stocked yet today'}</div>
    <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:12px">${tog('sn_snacks','Snacks')}${tog('sn_coffee','Coffee')}${tog('sn_juice','Juice &amp; water')}</div>
    <button class="btn btn-gold sans" onclick="saveSnack()">Stocked now ✓</button> <span id="snack_msg" class="hint" style="margin-left:8px"></span>`;
}
async function saveSnack(){
  try{ const r=await api('/meals/snack',{method:'POST',body:JSON.stringify({snacks:$('sn_snacks').checked,coffee:$('sn_coffee').checked,juice:$('sn_juice').checked})});
    if(MEALS_DATA) MEALS_DATA.snack=r.snack; $('snack_msg').textContent='✓ Logged'; loadSnack();
  }catch(e){ $('snack_msg').textContent=e.message; }
}
async function loadMealsScore(){
  let s; try{ s=await api('/meals/scorecard'); }catch(e){ return; }
  if(!s.logged){ $('mealsScore').innerHTML='<div class="hint">No meals inspected in the last 30 days yet.</div>'; return; }
  $('mealsScore').innerHTML = `<div class="ret-cards">
      <div class="ret-card ${s.completePct!=null&&s.completePct<90?'rc-warn':''}"><div class="n">${s.completePct!=null?s.completePct+'%':'—'}</div><div class="l">Met the standard</div></div>
      <div class="ret-card ${s.onTimePct!=null&&s.onTimePct<90?'rc-warn':''}"><div class="n">${s.onTimePct!=null?s.onTimePct+'%':'—'}</div><div class="l">Served on time</div></div>
      <div class="ret-card"><div class="n">${s.qualityAvg!=null?s.qualityAvg+'/10':'—'}</div><div class="l">Avg quality (1–10)</div></div>
      <div class="ret-card"><div class="n">${s.likedPct!=null?s.likedPct+'%':'—'}</div><div class="l">Clients liked it</div></div>
      <div class="ret-card ${s.shortCount?'rc-high':''}"><div class="n">${s.shortCount}</div><div class="l">Short deliveries</div></div>
      <div class="ret-card"><div class="n">${s.logged}</div><div class="l">Meals inspected</div></div>
    </div>
    ${s.missing.length?`<p class="sans" style="margin-top:8px"><strong>Most-missed food groups:</strong> ${s.missing.map(m=>esc(m.group)+' ('+m.n+')').join(' · ')}</p>`:''}
    ${s.recentIssues.length?`<div style="margin-top:8px"><strong class="sans">Recent issues</strong>${s.recentIssues.map(i=>`<div class="pc-note">${esc(i.date)} ${esc(i.meal)} — ${esc(i.issue)}</div>`).join('')}</div>`:''}`;
}

/* ---- Supply Standards: shift inventory + reorder ---- */
let INV_DATA=null, INV_DEPT=null;
async function loadInventory(){
  let d; try{ d=await api('/inventory'); }catch(e){ $('invBoard').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  INV_DATA=d;
  if($('invShift')) $('invShift').textContent = d.shift+' shift';
  const s=d.stats;
  $('invKpis').innerHTML = `
    <div class="ret-card ${s.out?'rc-high':''}"><div class="n">${s.out}</div><div class="l">Out of stock</div></div>
    <div class="ret-card ${s.low?'rc-warn':''}"><div class="n">${s.low}</div><div class="l">Running low</div></div>
    <div class="ret-card ${s.criticalOut?'rc-high':''}"><div class="n">${s.criticalOut}</div><div class="l">Critical out</div></div>
    <div class="ret-card"><div class="n">${s.openReorders}</div><div class="l">On order</div></div>
    <div class="ret-card"><div class="n">${s.items}</div><div class="l">Items tracked</div></div>`;
  // department tabs
  const depts=d.departments.map(x=>x.name);
  if(!INV_DEPT||!depts.includes(INV_DEPT)) INV_DEPT=depts[0]||null;
  $('invTabs').innerHTML = depts.map(n=>{
    const dd=d.departments.find(x=>x.name===n);
    const short = dd.items.filter(i=>i.status==='low'||i.status==='out').length;
    const dot = dd.countedToday?'✓ ':(dd.overdue?'⏰ ':'');
    return `<button class="itab ${n===INV_DEPT?'active':''}" onclick="setInvDept('${n.replace(/'/g,"\\'")}')">${dot}${esc(n)}${short?` <span class="badge badge-danger">${short}</span>`:''}</button>`;
  }).join('');
  // Inventory-check status banner for the selected department
  if($('invCheckBar')){
    const dd=d.departments.find(x=>x.name===INV_DEPT);
    if(!d.checkOn||!dd){ $('invCheckBar').innerHTML=''; }
    else if(dd.countedToday){ $('invCheckBar').innerHTML=`<div class="pc-note" style="border-left:3px solid var(--good)">✓ ${esc(INV_DEPT)} counted today${dd.lastAt?' · '+esc(dd.lastAt):''}.</div>`; }
    else { const due=`${d.checkHour}:00`; $('invCheckBar').innerHTML=`<div class="pc-note" style="border-left:3px solid ${dd.overdue?'var(--danger)':'var(--gold)'}">${dd.overdue?'⏰ OVERDUE':'⏳ Due'} — count ${esc(INV_DEPT)} by ${due}. ${dd.overdue?'This shift missed the inventory check.':''}</div>`; }
  }
  renderInvBoard();
  loadReorders();
  if($('inv_corp_email')) $('inv_corp_email').placeholder = d.corporateEmail || 'orders@armadarecovery.com';
  if($('inv_pollak_email')) $('inv_pollak_email').placeholder = d.pollakEmail || 'mordy@pollakdist.com';
  if(ME&&ME.role==='admin') loadInvCatalog();
}
function setInvDept(n){ INV_DEPT=n; loadInventory(); }
function renderInvBoard(){
  if(!INV_DATA) return;
  const dd=(INV_DATA.departments||[]).find(x=>x.name===INV_DEPT);
  if(!dd){ $('invBoard').innerHTML=''; return; }
  // group by category
  const cats={}; dd.items.forEach(i=>{ (cats[i.category||'Other']=cats[i.category||'Other']||[]).push(i); });
  const dot=i=>{ const c=i.status==='out'?'var(--danger)':i.status==='low'?'#c98a14':i.status==='ok'?'var(--good)':'var(--line)'; const lbl=i.status==='unknown'?'not counted':i.status; return `<span class="risk" style="background:${c}1a;color:${c};border:1px solid ${c}55">${lbl}</span>`; };
  const row=i=>`<tr ${i.status==='out'?'style="background:#fbeaea"':i.status==='low'?'style="background:#fdf6e8"':''}>
    <td><strong>${esc(i.name)}</strong>${i.sku?` <span class="badge" title="Product code">${esc(i.sku)}</span>`:''}${i.critical?' <span class="badge badge-danger" title="Never out">critical</span>':''}<div class="hint">par ${i.par} ${esc(i.unit)} · reorder ≤${i.reorder}${i.checkedThisShift?' · ✓ counted this shift':i.lastAt?' · last '+i.lastAt:''}${i.notes?' · '+esc(i.notes):''}</div></td>
    <td>${dot(i)}${i.reorderOpen?' <span class="hint">🛒 on order</span>':''}</td>
    <td style="white-space:nowrap"><input type="number" min="0" id="invq_${i.id}" value="${i.qty!=null?i.qty:''}" placeholder="${i.qty!=null?i.qty:'qty'}" style="width:64px" ${i.trackExpiry?'':''}/>${i.trackExpiry?` <input type="date" id="inve_${i.id}" value="${i.expiry||''}" title="earliest expiry" style="width:140px"/>`:''} <button class="btn btn-sm btn-gold sans" onclick="logCount(${i.id})">Save</button></td>
  </tr>`;
  $('invBoard').innerHTML = Object.keys(cats).map(cat=>`<div class="card"><h3>${esc(cat)}</h3>
    <table class="tbl"><tr><th>Item</th><th>Status</th><th style="width:240px">Count on hand</th></tr>${cats[cat].map(row).join('')}</table>
    <div class="toolbar" style="justify-content:flex-start;margin-top:8px"><button class="btn btn-ghost btn-sm sans" onclick="logCategory('${cat.replace(/'/g,"\\'")}')">Save all in ${esc(cat)}</button></div></div>`).join('');
}
async function logCount(id){
  const q=$('invq_'+id); if(!q||q.value===''){ return; }
  const body={item_id:id, qty:parseInt(q.value,10)||0};
  const ed=$('inve_'+id); if(ed&&ed.value) body.expiry=ed.value;
  try{ const r=await api('/inventory/count',{method:'POST',body:JSON.stringify(body)}); loadInventory(); }catch(e){ alert(e.message); }
}
async function logCategory(cat){
  const dd=(INV_DATA.departments||[]).find(x=>x.name===INV_DEPT); if(!dd) return;
  const counts=dd.items.filter(i=>(i.category||'Other')===cat).map(i=>{ const q=$('invq_'+i.id); if(!q||q.value==='') return null; const o={item_id:i.id,qty:parseInt(q.value,10)||0}; const ed=$('inve_'+i.id); if(ed&&ed.value)o.expiry=ed.value; return o; }).filter(Boolean);
  if(!counts.length){ return; }
  try{ const r=await api('/inventory/count',{method:'POST',body:JSON.stringify({counts})}); loadInventory(); }catch(e){ alert(e.message); }
}
async function loadReorders(){
  let d; try{ d=await api('/inventory/reorders'); }catch(e){ return; }
  const open=d.reorders.filter(r=>r.status==='open');
  $('invReorderCard').style.display = d.reorders.length?'block':'none';
  $('invReorders').innerHTML = d.reorders.length ? `<table class="tbl"><tr><th>Item</th><th>Dept</th><th>On hand</th><th>Suggest</th><th>Status</th><th></th></tr>${d.reorders.map(r=>`<tr>
    <td><strong>${esc(r.item)}</strong>${r.critical?' <span class="badge badge-danger">critical</span>':''} ${r.level==='out'?'<span class="risk risk-high">OUT</span>':'<span class="risk risk-warn">low</span>'}</td>
    <td class="hint">${esc(r.department)}</td><td>${r.onHand} ${esc(r.unit)}</td><td>${r.suggest} ${esc(r.unit)}</td>
    <td>${r.status==='open'?(r.emailed?'sent to corporate':'queued'):r.status}</td>
    <td style="white-space:nowrap">${r.status==='open'?`<button class="btn btn-sm btn-ghost sans" onclick="markReorder(${r.id},'ordered')">Ordered</button> `:''}${r.status!=='received'?`<button class="btn btn-sm btn-gold sans" onclick="markReorder(${r.id},'received')">Received</button>`:'✓ received'}</td>
  </tr>`).join('')}</table>` : '<div class="hint">Nothing on order.</div>';
}
async function markReorder(id,status){
  try{
    const r=await api('/inventory/reorders/'+id,{method:'POST',body:JSON.stringify({status})});
    if(status==='received' && r.restock){ const m=$('inv_corp_msg'); if(m){ m.textContent=`✓ Received — on-hand updated ${r.restock.from} → ${r.restock.to}.`; setTimeout(()=>{ if(m.textContent.startsWith('✓ Received'))m.textContent=''; },4000); } }
    loadInventory();
  }catch(e){ alert(e.message); }
}
async function saveInvSettings(){
  const corp=($('inv_corp_email')||{}).value||''; const pollak=($('inv_pollak_email')||{}).value||'';
  try{ await api('/inventory/settings',{method:'POST',body:JSON.stringify({corporate_email:corp.trim(),pollak_email:pollak.trim()})});
    if($('inv_corp_msg')) $('inv_corp_msg').textContent='✓ Saved'; if($('inv_pollak_msg')) $('inv_pollak_msg').textContent='✓ Saved'; }
  catch(e){ if($('inv_corp_msg')) $('inv_corp_msg').textContent=e.message; }
}
async function sendOrderList(){ $('inv_corp_msg').textContent='Sending…'; try{ const r=await api('/inventory/reorders/send',{method:'POST'}); $('inv_corp_msg').textContent = r.sent?('✓ Sent '+r.count+' item(s) to '+r.to):('Not sent — '+(r.reason||'')); }catch(e){ $('inv_corp_msg').textContent=e.message; } }
function setPollakMsg(t){ ['inv_pollak_msg','inv_pollak_msg_hero'].forEach(id=>{ if($(id)) $(id).textContent=t; }); }
async function sendPollakOrderNow(){ setPollakMsg('Sending order to Pollak…'); try{ const r=await api('/inventory/pollak-order/send',{method:'POST'}); setPollakMsg(r.sent?('✓ Sent — '+(r.items||0)+' items to order (you are CC’d)'):('Not sent — '+(r.reason||''))); }catch(e){ setPollakMsg(e.message); } }
let INV_EDIT_ID=null;
async function loadInvCatalog(){
  if(!$('invCatalog')) return;
  let d; try{ d=await api('/inventory/catalog'); }catch(e){ return; }
  $('invCatalog').innerHTML = `<table class="tbl"><tr><th>Item</th><th>Dept</th><th>Par</th><th>Reorder</th><th>Flags</th><th></th></tr>${d.items.map(i=>`<tr ${i.active?'':'style="opacity:.5"'}>
    <td><strong>${esc(i.name)}</strong> <span class="hint">${esc(i.unit)}${i.category?' · '+esc(i.category):''}</span></td>
    <td class="hint">${esc(i.department)}</td><td>${i.par_level}</td><td>${i.reorder_point}</td>
    <td>${i.critical?'⚠ critical ':''}${i.track_expiry?'📅 expiry':''}${i.active?'':' · inactive'}</td>
    <td><button class="btn btn-sm btn-ghost sans" onclick='editInvItem(${JSON.stringify(i)})'>Edit</button></td>
  </tr>`).join('')}</table>`;
}
function editInvItem(i){ INV_EDIT_ID=i.id; $('inv_i_name').value=i.name; $('inv_i_dept').value=i.department; $('inv_i_cat').value=i.category||''; $('inv_i_unit').value=i.unit; $('inv_i_par').value=i.par_level; $('inv_i_re').value=i.reorder_point; $('inv_i_crit').checked=!!i.critical; $('inv_i_exp').checked=!!i.track_expiry; $('inv_i_msg').textContent='Editing '+i.name; window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'}); }
function resetInvItem(){ INV_EDIT_ID=null; ['inv_i_name','inv_i_cat'].forEach(x=>$(x).value=''); $('inv_i_unit').value='each'; $('inv_i_par').value='4'; $('inv_i_re').value='2'; $('inv_i_crit').checked=false; $('inv_i_exp').checked=false; $('inv_i_msg').textContent=''; }
async function saveInvItem(){
  const body={ id:INV_EDIT_ID, name:$('inv_i_name').value.trim(), department:$('inv_i_dept').value, category:$('inv_i_cat').value.trim(), unit:$('inv_i_unit').value.trim()||'each', par_level:$('inv_i_par').value, reorder_point:$('inv_i_re').value, critical:$('inv_i_crit').checked, track_expiry:$('inv_i_exp').checked };
  if(!body.name){ $('inv_i_msg').textContent='Name required'; return; }
  try{ await api('/inventory/items',{method:'POST',body:JSON.stringify(body)}); $('inv_i_msg').textContent='✓ Saved'; resetInvItem(); loadInvCatalog(); }catch(e){ $('inv_i_msg').textContent=e.message; }
}

/* ---- Operations: environment, handoff, CEO rescues, projects (DOO systems) ---- */
let OPS=null;
const ENV_AREAS=[['beds','Beds made'],['rooms','Rooms clean'],['common','Common areas'],['kitchen','Kitchen reset']];
const HO_AREAS=[['stock','Stock at par'],['beds','Beds made'],['kitchen','Kitchen reset'],['smokes','Smokes prepped']];
async function loadOps(){
  loadPlanMorning();
  let d; try{ d=await api('/ops'); }catch(e){ $('opsKpis').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  OPS=d; const x=d.extras;
  // Today's recurring tasks — the operational workflow
  const rt=d.routines;
  if($('opsTasks')&&rt){
    if($('opsTaskCount')) $('opsTaskCount').textContent = `${rt.done}/${rt.total} done`;
    const cadLabel={daily:'Daily',weekly:'This week',monthly:'This month'};
    const groups={}; rt.today.forEach(t=>{ (groups[t.cadence]=groups[t.cadence]||[]).push(t); });
    $('opsTasks').innerHTML = rt.total ? ['daily','weekly','monthly'].filter(c=>groups[c]).map(c=>`<div style="margin-bottom:8px"><div class="hint" style="text-transform:uppercase;letter-spacing:.5px">${cadLabel[c]}</div>
      ${groups[c].map(t=>`<label class="trg" style="display:flex;gap:8px;align-items:flex-start;padding:6px 0"><input type="checkbox" ${t.done?'checked':''} onchange="toggleRoutine(${t.id},this.checked)"/>
        <span style="flex:1;${t.done?'color:var(--muted);text-decoration:line-through':''}">${esc(t.title)}${t.done&&t.by?` <span class="hint">✓ ${esc(t.by)} ${esc(t.at)}</span>`:''}</span>
        ${t.link?`<button class="btn btn-ghost btn-sm sans" onclick="show('${t.link}')">Open →</button>`:''}</label>`).join('')}</div>`).join('') : '<div class="hint">No tasks scheduled today.</div>';
    // 7-day routine consistency strip
    const wk=d.routineWeek;
    if(wk){ const day=s=>new Date(s.date+'T12:00').toLocaleDateString('en-US',{weekday:'narrow'});
      $('opsTasks').innerHTML += `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px"><div class="hint">Routine run — last 7 days: <strong>${wk.pct!=null?wk.pct+'%':'—'}</strong> (${wk.done}/${wk.due})</div>
        <div style="display:flex;gap:4px;margin-top:5px">${wk.series.map(s=>`<div title="${s.date}: ${s.done}/${s.due}" style="flex:1;text-align:center"><div style="height:24px;display:flex;align-items:flex-end;justify-content:center"><div style="width:14px;background:${s.pct==null?'var(--line)':s.pct>=90?'var(--good)':s.pct>=60?'var(--gold)':'var(--danger)'};height:${s.pct==null?3:Math.max(3,Math.round(s.pct/100*24))}px;border-radius:2px"></div></div><div class="hint" style="font-size:10px">${day(s)}</div></div>`).join('')}</div></div>`;
    }
  }
  if($('opsScorecard')) $('opsScorecard').innerHTML = `<p class="sub sans">${d.passing}/${d.total} systems holding.</p>`+(d.scorecard||[]).map(o=>`<div class="todo"><div class="txt"><span class="risk ${o.ok?'risk-low':'risk-high'}">${o.ok?'PASS':'MISS'}</span> <strong>${esc(o.name)}</strong><div class="hint">${esc(o.sub)}</div></div>${o.view?`<button class="btn btn-ghost btn-sm sans" onclick="show('${o.view}')">Open →</button>`:''}</div>`).join('');
  const wkPct=d.routineWeek?d.routineWeek.pct:null;
  $('opsKpis').innerHTML = `
    <div class="ret-card ${wkPct!=null&&wkPct<90?'rc-warn':''}"><div class="n">${wkPct!=null?wkPct+'%':'—'}</div><div class="l">Routine run (7d)</div></div>
    <div class="ret-card ${!x.env.pass?'rc-warn':''}"><div class="n">${x.env.logged}</div><div class="l">Env checks today ${x.env.pass?'✓':''}</div></div>
    <div class="ret-card ${!x.handoff.pass?'rc-warn':''}"><div class="n">${x.handoff.logged}</div><div class="l">Handoffs today ${x.handoff.pass?'✓':''}</div></div>
    <div class="ret-card ${x.rescues.week?'rc-high':''}"><div class="n">${x.rescues.week}</div><div class="l">CEO rescues (wk)</div></div>
    <div class="ret-card ${x.projects.overdue?'rc-high':''}"><div class="n">${x.projects.overdue}</div><div class="l">Projects overdue</div></div>`;
  // shift selects
  if($('env_shift')&&!$('env_shift').options.length){ $('env_shift').innerHTML=d.shifts.map(s=>`<option ${s===d.current?'selected':''}>${esc(s)}</option>`).join(''); }
  if($('ho_shift')&&!$('ho_shift').options.length){ $('ho_shift').innerHTML=d.shifts.map(s=>`<option ${s===d.current?'selected':''}>${esc(s)}</option>`).join(''); }
  renderEnvChecks(); renderHoChecks();
  // today's logs
  $('env_today').innerHTML = d.shifts.filter(s=>d.env[s]).map(s=>{const e=d.env[s];const all=e.beds&&e.rooms&&e.common&&e.kitchen;return `<div class="pc-note">${all?'✓':'⚠'} <strong>${esc(s)}</strong> ${ENV_AREAS.map(a=>e[a[0]]?'':'✗'+a[1]).filter(Boolean).join(' ')||'all clear'}${e.defects?' · '+esc(e.defects):''} <span class="hint">${esc(e.by_name||'')}</span></div>`;}).join('')||'<div class="hint">No environment checks logged today.</div>';
  $('ho_today').innerHTML = d.shifts.filter(s=>d.ho[s]).map(s=>{const h=d.ho[s];const all=h.stock&&h.beds&&h.kitchen&&h.smokes;return `<div class="pc-note">${all?'✓':'⚠'} <strong>${esc(s)}</strong> ${HO_AREAS.map(a=>h[a[0]]?'':'✗'+a[1]).filter(Boolean).join(' ')||'complete'} <span class="hint">${esc(h.by_name||'')}</span></div>`;}).join('')||'<div class="hint">No handoffs logged today.</div>';
  // rescues
  $('rescue_list').innerHTML = d.rescues.length ? d.rescues.map(r=>`<div class="todo"><div class="txt">🆘 ${esc(r.what)} <span class="hint">${esc(r.by)} · ${esc(r.at)}</span></div>${ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" onclick="delRescue(${r.id})">✕</button>`:''}</div>`).join('') : '<div class="hint">No CEO rescues logged. 🎉 That\'s the goal.</div>';
  // projects
  $('pj_list').innerHTML = d.projects.length ? d.projects.map(p=>projectCard(p)).join('') : '<div class="hint">No projects yet — add one above.</div>';
}
async function toggleRoutine(id, done){ try{ await api('/ops/routine/done',{method:'POST',body:JSON.stringify({id,done})}); loadOps(); }catch(e){ alert(e.message); } }
function renderEnvChecks(){ const sh=$('env_shift').value; const e=(OPS&&OPS.env[sh])||{}; $('env_checks').innerHTML=ENV_AREAS.map(a=>`<button type="button" class="meal-grp ${e[a[0]]?'on':''}" data-k="${a[0]}" onclick="this.classList.toggle('on')">${esc(a[1])}</button>`).join(''); $('env_defects').value=e.defects||''; }
function renderHoChecks(){ const sh=$('ho_shift').value; const h=(OPS&&OPS.ho[sh])||{}; $('ho_checks').innerHTML=HO_AREAS.map(a=>`<button type="button" class="meal-grp ${h[a[0]]?'on':''}" data-k="${a[0]}" onclick="this.classList.toggle('on')">${esc(a[1])}</button>`).join(''); $('ho_note').value=h.note||''; }
async function saveEnv(){ const body={shift:$('env_shift').value,defects:$('env_defects').value}; document.querySelectorAll('#env_checks .meal-grp.on').forEach(b=>body[b.dataset.k]=1); $('env_msg').textContent='Saving…'; try{ await api('/ops/environment',{method:'POST',body:JSON.stringify(body)}); $('env_msg').textContent='✓ Saved'; loadOps(); }catch(e){ $('env_msg').textContent=e.message; } }
async function saveHandoff(){ const body={shift:$('ho_shift').value,note:$('ho_note').value}; document.querySelectorAll('#ho_checks .meal-grp.on').forEach(b=>body[b.dataset.k]=1); $('ho_msg').textContent='Saving…'; try{ await api('/ops/handoff',{method:'POST',body:JSON.stringify(body)}); $('ho_msg').textContent='✓ Saved'; loadOps(); }catch(e){ $('ho_msg').textContent=e.message; } }
async function logRescue(){ const what=$('rescue_what').value.trim(); if(!what)return; try{ await api('/ops/rescue',{method:'POST',body:JSON.stringify({what})}); $('rescue_what').value=''; loadOps(); }catch(e){ alert(e.message); } }
async function delRescue(id){ try{ await api('/ops/rescue/'+id,{method:'DELETE'}); loadOps(); }catch(e){ alert(e.message); } }
function projectCard(p){
  const stColor=p.status==='Done'?'risk-low':p.status==='Blocked'?'risk-high':'risk-warn';
  return `<details class="card" style="margin:8px 0;${p.overdue?'border-left:4px solid var(--danger)':''}"><summary class="sans" style="cursor:pointer;font-weight:600">${esc(p.name)} <span class="risk ${stColor}">${esc(p.status)}</span>${p.overdue?' <span class="badge badge-danger">overdue</span>':''} <span class="hint">${p.owner?esc(p.owner)+' · ':''}${p.due?'due '+esc(p.due):'no date'}${p.pct!=null?' · '+p.pct+'%':''}</span></summary>
    <div style="margin-top:10px">
      <div class="grid3">
        <div class="field"><label>Owner</label><input id="pj_o_${p.id}" value="${esc(p.owner)}"/></div>
        <div class="field"><label>Due</label><input id="pj_d_${p.id}" type="date" value="${esc(p.due)}"/></div>
        <div class="field"><label>Status</label><select id="pj_s_${p.id}">${['Planned','In progress','Blocked','Done'].map(s=>`<option ${s===p.status?'selected':''}>${s}</option>`).join('')}</select></div>
      </div>
      <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-ghost btn-sm sans" onclick="saveProject(${p.id})">Save</button>${ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" onclick="delProject(${p.id})">Delete</button>`:''}</div>
      <div style="margin-top:8px"><strong class="sans" style="font-size:13px">Checklist</strong>
        ${(p.checklist||[]).map((c,i)=>`<label class="trg" style="display:flex;gap:8px"><input type="checkbox" ${c.done?'checked':''} onchange="toggleProjItem(${p.id},${i})"/> <span style="${c.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(c.t)}</span> <a href="#" class="hint" onclick="rmProjItem(${p.id},${i});return false" style="margin-left:auto">✕</a></label>`).join('')||'<div class="hint">No items yet.</div>'}
        <div class="handoff-add" style="margin-top:6px"><input id="pj_ci_${p.id}" placeholder="Add a checklist item…"/><button class="btn btn-ghost btn-sm sans" onclick="addProjItem(${p.id})">+ Add</button></div>
      </div>
    </div></details>`;
}
async function addProject(){ const name=$('pj_name').value.trim(); if(!name){ $('pj_msg').textContent='Name required'; return; } try{ await api('/projects',{method:'POST',body:JSON.stringify({name,owner:$('pj_owner').value,due_date:$('pj_due').value})}); ['pj_name','pj_owner','pj_due'].forEach(x=>$(x).value=''); $('pj_msg').textContent='✓ Added'; loadOps(); }catch(e){ $('pj_msg').textContent=e.message; } }
async function saveProject(id){ try{ await api('/projects',{method:'POST',body:JSON.stringify({id,owner:$('pj_o_'+id).value,due_date:$('pj_d_'+id).value,status:$('pj_s_'+id).value})}); loadOps(); }catch(e){ alert(e.message); } }
async function delProject(id){ if(!confirm('Delete this project?'))return; try{ await api('/projects/'+id,{method:'DELETE'}); loadOps(); }catch(e){ alert(e.message); } }
async function addProjItem(id){ const inp=$('pj_ci_'+id); const t=inp?inp.value.trim():''; if(!t)return; try{ await api('/projects/'+id+'/checklist',{method:'POST',body:JSON.stringify({add:t})}); loadOps(); }catch(e){ alert(e.message); } }
async function toggleProjItem(id,i){ try{ await api('/projects/'+id+'/checklist',{method:'POST',body:JSON.stringify({toggle:i})}); loadOps(); }catch(e){ alert(e.message); } }
async function rmProjItem(id,i){ try{ await api('/projects/'+id+'/checklist',{method:'POST',body:JSON.stringify({remove:i})}); loadOps(); }catch(e){ alert(e.message); } }

/* ---- Maintenance / work orders + who's on shift ---- */
let MAINT_DATA=null;
async function loadMaintenance(){
  let d; try{ d=await api('/maintenance'); }catch(e){ $('maintBoard').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  MAINT_DATA=d;
  const s=d.stats;
  $('maintKpis').innerHTML = `
    <div class="ret-card ${s.urgentOpen?'rc-high':''}"><div class="n">${s.urgentOpen}</div><div class="l">Urgent / high open</div></div>
    <div class="ret-card ${s.open?'rc-warn':''}"><div class="n">${s.open}</div><div class="l">Open</div></div>
    <div class="ret-card"><div class="n">${s.inProgress}</div><div class="l">In progress</div></div>
    <div class="ret-card ${s.overdue?'rc-high':''}"><div class="n">${s.overdue}</div><div class="l">Past SLA</div></div>
    <div class="ret-card"><div class="n">${s.resolvedWeek}</div><div class="l">Fixed this week</div></div>`;
  // fill selects once
  if($('mt_cat')&&!$('mt_cat').options.length) $('mt_cat').innerHTML = d.categories.map(c=>`<option>${esc(c)}</option>`).join('');
  if($('mt_pri')&&!$('mt_pri').options.length){ $('mt_pri').innerHTML = d.priorities.map(p=>`<option ${p==='Normal'?'selected':''}>${esc(p)}</option>`).join(''); }
  if($('mt_owner_email')) $('mt_owner_email').placeholder = d.maintenanceEmail || 'maintenance@armadarecovery.com';
  renderMaintBoard();
}
function priPill(p){ const c=p==='Urgent'?'var(--danger)':p==='High'?'#c98a14':p==='Low'?'var(--muted)':'var(--navy)'; return `<span class="risk" style="background:${c}1a;color:${c};border:1px solid ${c}55">${esc(p)}</span>`; }
function renderMaintBoard(){
  if(!MAINT_DATA) return;
  const act=MAINT_DATA.requests.filter(r=>r.status==='open'||r.status==='in_progress');
  if(!act.length){ $('maintBoard').innerHTML='<div class="hint">Nothing open — all caught up. 🎉</div>'; return; }
  $('maintBoard').innerHTML = act.map(r=>{
    const overdue = r.status==='open' && r.ageH > (r.priority==='Urgent'?4:r.priority==='High'?24:72);
    return `<div class="card" style="margin:8px 0;${overdue?'border-left:4px solid var(--danger)':r.priority==='Urgent'?'border-left:4px solid var(--danger)':''}">
      <div class="cmd-hero-row">
        <div><strong>${esc(r.title)}</strong> ${priPill(r.priority)} <span class="badge">${esc(r.category)}</span>${overdue?' <span class="badge badge-danger">past SLA</span>':''}
          <div class="hint">${r.location?esc(r.location)+' · ':''}reported by ${esc(r.reportedBy)||'staff'} · ${r.ageH}h ago${r.assignedTo?' · assigned: '+esc(r.assignedTo):''}</div>
          ${r.description?`<div class="sans" style="margin-top:4px">${esc(r.description)}</div>`:''}
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${(r.photos||[]).map(p=>`<span style="position:relative;display:inline-block"><img src="${p.photo}" alt="" style="height:60px;border-radius:8px;cursor:pointer;border:1px solid var(--line)" onclick='maintLightbox(this.src)'/>${p.pid?`<a href="#" onclick="delMaintPhoto(${r.id},${p.pid});return false" style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border-radius:50%;width:16px;height:16px;line-height:16px;text-align:center;font-size:11px;text-decoration:none">×</a>`:''}</span>`).join('')}
            ${(r.photos||[]).length<6?`<label class="hint" style="cursor:pointer;border:1px dashed var(--line);border-radius:8px;padding:6px 9px">＋ photo<input type="file" accept="image/*" capture="environment" style="display:none" onchange="addMaintPhoto(${r.id}, this)"/></label>`:''}
          </div></div>
        <div style="text-align:right">${r.status==='open'?`<button class="btn btn-sm btn-ghost sans" onclick="maintStatus(${r.id},'in_progress')">Start</button>`:''} <button class="btn btn-sm btn-gold sans" onclick="maintResolve(${r.id})">Resolve</button></div>
      </div>
    </div>`;
  }).join('');
}
let MAINT_PHOTOS=[];
async function maintPhotoPick(input){
  const files=Array.from(input.files||[]); if(!files.length){ return; }
  $('mt_msg').textContent='Processing photo…';
  for(const f of files){ if(MAINT_PHOTOS.length>=6){ break; } try{ MAINT_PHOTOS.push(await resizeImage(f, 900, 0.7)); }catch(e){} }
  renderMaintPhotoThumbs(); $('mt_msg').textContent = MAINT_PHOTOS.length>=6?'Max 6 photos':''; input.value='';
}
function renderMaintPhotoThumbs(){
  $('mt_photoThumb').innerHTML = MAINT_PHOTOS.map((p,i)=>`<span style="position:relative;display:inline-block"><img src="${p}" alt="" style="height:40px;border-radius:6px;cursor:pointer" onclick="maintLightbox('${'i'+i}')"/><a href="#" onclick="removeMaintPhoto(${i});return false" style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border-radius:50%;width:16px;height:16px;line-height:16px;text-align:center;font-size:11px;text-decoration:none">×</a></span>`).join('');
}
function removeMaintPhoto(i){ MAINT_PHOTOS.splice(i,1); renderMaintPhotoThumbs(); }
function clearMaintPhoto(){ MAINT_PHOTOS=[]; $('mt_photoThumb').innerHTML=''; }
function maintLightbox(src){ if(typeof src==='string'&&src.startsWith('i')) src=MAINT_PHOTOS[+src.slice(1)]; let o=$('maintLb'); if(!o){ o=document.createElement('div'); o.id='maintLb'; o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out'; o.onclick=()=>o.remove(); document.body.appendChild(o); } o.innerHTML=`<img src="${src}" style="max-width:92%;max-height:92%;border-radius:8px"/>`; }
async function submitMaintenance(){
  const title=$('mt_title').value.trim(); if(!title){ $('mt_msg').textContent='Add a short title'; return; }
  const body={ title, location:$('mt_loc').value.trim(), category:$('mt_cat').value, priority:$('mt_pri').value, description:$('mt_desc').value.trim() };
  if(MAINT_PHOTOS.length) body.photos=MAINT_PHOTOS;
  $('mt_msg').textContent='Submitting…';
  try{ await api('/maintenance',{method:'POST',body:JSON.stringify(body)}); $('mt_msg').textContent='✓ Logged & routed'; ['mt_title','mt_loc','mt_desc'].forEach(x=>$(x).value=''); clearMaintPhoto(); loadMaintenance(); }
  catch(e){ $('mt_msg').textContent=e.message; }
}
async function addMaintPhoto(id, input){
  const file=input.files && input.files[0]; if(!file){ return; }
  try{ const photo=await resizeImage(file, 900, 0.7); await api('/maintenance/'+id+'/photo',{method:'POST',body:JSON.stringify({photo})}); loadMaintenance(); }
  catch(e){ alert(e.message); }
  input.value='';
}
async function delMaintPhoto(id, pid){ if(!confirm('Remove this photo?')) return; try{ await api('/maintenance/'+id+'/photo/'+pid,{method:'DELETE'}); loadMaintenance(); }catch(e){ alert(e.message); } }
async function loadMaintHistory(){
  let d; try{ d=await api('/maintenance/history'); }catch(e){ $('maintHistory').innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  if(!d.history.length){ $('maintHistory').innerHTML='<div class="hint">Nothing resolved in the last 30 days.</div>'; return; }
  $('maintHistory').innerHTML = `<table class="tbl"><tr><th>Item</th><th>Resolved</th><th>By</th><th>Notes</th></tr>${d.history.map(r=>`<tr>
    <td><strong>${esc(r.title)}</strong> ${priPill(r.priority)}<div class="hint">${r.location?esc(r.location)+' · ':''}${esc(r.category)} · reported by ${esc(r.reportedBy)||'staff'}</div>${r.photos&&r.photos.length?`<div style="margin-top:4px;display:flex;gap:4px">${r.photos.map(p=>`<img src="${p.photo}" style="height:34px;border-radius:5px;cursor:pointer" onclick='maintLightbox(this.src)'/>`).join('')}</div>`:''}</td>
    <td class="hint">${esc(r.resolvedAt)}</td><td class="hint">${esc(r.resolvedBy)||'—'}</td><td>${r.resolution?esc(r.resolution):'<span class="hint">—</span>'}</td>
  </tr>`).join('')}</table>`;
}
async function maintStatus(id,status){ try{ await api('/maintenance/'+id,{method:'POST',body:JSON.stringify({status})}); loadMaintenance(); }catch(e){ alert(e.message); } }
async function maintResolve(id){ const r=prompt('What was done? (optional)','')||''; try{ await api('/maintenance/'+id,{method:'POST',body:JSON.stringify({status:'resolved',resolution:r})}); loadMaintenance(); }catch(e){ alert(e.message); } }
async function saveMaintEmail(){ const v=$('mt_owner_email').value.trim(); try{ await api('/maintenance/settings',{method:'POST',body:JSON.stringify({maintenance_email:v})}); $('mt_owner_msg').textContent='✓ Saved'; }catch(e){ $('mt_owner_msg').textContent=e.message; } }
async function loadOnShiftToday(){
  const box=$('schOnShift'); if(!box) return;
  let d; try{ d=await api('/staffing'); }catch(e){ box.innerHTML='<div class="hint">Shift schedule unavailable.</div>'; return; }
  const parts=['Morning','Day','Evening','Night'];
  const byPart={}; (d.slots||[]).forEach(s=>{ (byPart[s.part]=byPart[s.part]||[]).push(s); });
  const has=parts.some(p=>byPart[p]);
  if(!has){ box.innerHTML='<div class="hint">No shifts scheduled for today yet — build today\'s schedule below.</div>'; return; }
  box.innerHTML = parts.filter(p=>byPart[p]).map(p=>{
    const slots=byPart[p];
    const rows=slots.map(s=>{
      const on=s.assignments.filter(a=>a.status==='scheduled');
      const off=s.assignments.filter(a=>a.status==='called_off');
      const names = on.map(a=>esc(a.user_name)).join(', ')||'<span class="hint">unfilled</span>';
      const offTxt = off.length?` <span class="risk risk-warn" title="called off">✗ ${off.map(a=>esc(a.user_name)+(a.calloff_reason?' ('+esc(a.calloff_reason)+')':'')).join(', ')}</span>`:'';
      const gap = !s.covered?` <span class="badge badge-danger">short ${s.needed-on.length}</span>`:'';
      return `<tr><td><strong>${esc(s.role)}</strong></td><td>${names}${offTxt}${gap}</td></tr>`;
    }).join('');
    return `<div style="margin-bottom:10px"><div class="sans" style="font-weight:600;color:var(--navy)">${p}</div><table class="tbl">${rows}</table></div>`;
  }).join('');
}

/* ---- Client Record search ---- */
let REC_TIMER=null;
function loadRecords(){ if($('rec_q')&&!$('rec_q').value){ $('recResults').innerHTML='<div class="hint">Start typing a name or room above.</div>'; $('recDetail').innerHTML=''; } }
function recSearch(){ clearTimeout(REC_TIMER); REC_TIMER=setTimeout(doRecSearch, 220); }
async function doRecSearch(){
  const q=$('rec_q').value.trim();
  if(q.length<2){ $('recResults').innerHTML='<div class="hint">Type at least 2 characters.</div>'; return; }
  let d; try{ d=await api('/records/search?q='+encodeURIComponent(q)); }catch(e){ $('recResults').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if(!d.results.length){ $('recResults').innerHTML='<div class="hint">No clients match “'+esc(q)+'”.</div>'; return; }
  $('recResults').innerHTML = d.results.map(r=>`<button class="kbtn" style="margin:4px 0" onclick="openRecord(${r.id})">
    <strong>${esc(r.name)}</strong>${r.room?' · '+esc(r.room):''} <span class="risk ${r.discharged?'risk-warn':'risk-low'}">${esc(r.status)}</span>
    <div class="hint">${r.full&&r.full!==r.name?esc(r.full)+' · ':''}${r.program?esc(r.program)+' · ':''}admit ${esc(r.admit)||'—'}${r.dischargeDate?' · discharged '+esc(r.dischargeDate):''}</div></button>`).join('');
}
async function openRecord(id){
  $('recDetail').innerHTML='<div class="card"><div class="hint">Loading record…</div></div>';
  let d; try{ d=(await api('/clients/'+id+'/record')).record; }catch(e){ $('recDetail').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const c=d.client;
  const feed=(title, rows, render, empty)=>`<details class="card" ${rows.length?'open':''}><summary class="sans" style="cursor:pointer;font-weight:600">${title} <span class="badge">${rows.length}</span></summary>${rows.length?'<div style="margin-top:10px">'+rows.map(render).join('')+'</div>':'<div class="hint" style="margin-top:8px">'+empty+'</div>'}</details>`;
  const line=(at,body)=>`<div class="pc-note" style="border-left:3px solid var(--line);padding-left:10px;margin:8px 0">${body}${at?`<div class="hint">${esc(at)}</div>`:''}</div>`;
  const sev=s=>`<span class="risk ${/critical|high/i.test(s)?'risk-high':/moderate|medium|elev/i.test(s)?'risk-warn':'risk-low'}">${esc(s)}</span>`;
  const discharge = c.discharge_status ? `<div class="card" style="border-left:4px solid var(--danger)">
      <h3 style="margin-top:0">Discharge</h3>
      <div><strong>Status:</strong> ${esc(c.discharge_status)}${c.discharge_date?' · '+esc(c.discharge_date):''}${c.los!=null?' · LOS '+c.los+' days':''}</div>
      ${c.discharge_reason?`<div style="margin-top:6px"><strong>Reason:</strong> ${esc(c.discharge_reason)}</div>`:''}
      ${c.discharge_destination?`<div><strong>Went to:</strong> ${esc(c.discharge_destination)}</div>`:''}
      ${c.discharge_improve?`<div style="margin-top:6px"><strong>What we could've done better:</strong> ${esc(c.discharge_improve)}</div>`:''}
      ${c.discharge_followthrough?`<div><strong>Follow-through:</strong> ${esc(c.discharge_followthrough)}</div>`:''}
      ${c.discharged_by_kipu?`<div class="hint">Discharged in Kipu by: ${esc(c.discharged_by_kipu)}</div>`:''}
    </div>` : '';
  $('recDetail').innerHTML = `
    <div class="card">
      <div class="cmd-hero-row"><div>
        <h3 style="margin:0">${esc(c.name)} ${c.active?'<span class="risk risk-low">Active</span>':'<span class="risk risk-warn">Discharged</span>'}</h3>
        ${c.allergies&&c.allergies.trim()?`<div class="allergy-banner">⚠ ALLERGIES: ${esc(c.allergies)}</div>`:''}
        <div class="hint">${c.full&&c.full!==c.name?esc(c.full)+' · ':''}${c.room?'Room '+esc(c.room)+' · ':''}${c.program?esc(c.program)+' · ':''}${c.loc?esc(c.loc)+' · ':''}admit ${esc(c.admit)||'—'}${c.los!=null?' · LOS '+c.los+'d':''}</div>
        <div class="hint">${c.case_manager?'CM: '+esc(c.case_manager)+' · ':''}${c.therapist?'Therapist: '+esc(c.therapist):''}</div>
      </div><button class="btn btn-ghost btn-sm sans" onclick="openJourney(${c.id})">Open Client 360 ↗</button></div>
    </div>
    <div class="card" style="border-left:4px solid var(--gold)">
      <details id="recIncForm"><summary class="sans" style="cursor:pointer;font-weight:600">🚩 File an incident on ${esc(c.name)}</summary>
        <div style="margin-top:12px">
          <div class="grid2">
            <div class="field"><label>Type</label><select id="rec_in_type"><option>Behavioral</option><option>Conflict</option><option>Property</option><option>Elopement/AMA</option><option>Medical</option><option>Medication error</option><option>Fall</option><option>Other</option></select></div>
            <div class="field"><label>Severity</label><select id="rec_in_sev"><option>Low</option><option>Moderate</option><option selected>High</option><option>Critical</option></select></div>
          </div>
          <div class="field"><label>What happened</label><textarea id="rec_in_desc" rows="3" placeholder="Describe the incident factually — who, what, when, where, who else was involved."></textarea></div>
          <div class="field"><label>Action taken (optional)</label><textarea id="rec_in_action" rows="2" placeholder="How it was handled — separation, 1:1, notifications, etc."></textarea></div>
          <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-gold sans" onclick="recFileIncident(${c.id})">File incident</button><span id="rec_in_msg" class="hint" style="align-self:center"></span></div>
          <p class="sub sans" style="margin-top:4px">High/Critical incidents alert the on-call leader. This is the formal record — keep it factual.</p>
        </div>
      </details>
    </div>
    <div class="card" style="border-left:4px solid var(--aqua,#5fb0c2)">
      <details id="recSessForm"><summary class="sans" style="cursor:pointer;font-weight:600">🗣️ Log a 1:1 / group session with ${esc(c.name)}</summary>
        <div style="margin-top:12px">
          <div class="grid2">
            <div class="field"><label>Type</label><select id="rec_s_type"><option>1:1</option><option>Group</option></select></div>
            <div class="field"><label>Topic</label><input id="rec_s_topic" placeholder="e.g. coping skills, Step 4, triggers"/></div>
          </div>
          <div class="field"><label>Session note</label><textarea id="rec_s_note" rows="3" placeholder="What you covered, how they're doing, follow-ups."></textarea></div>
          <div class="field"><label>Material / homework for next session (optional)</label><textarea id="rec_s_hw" rows="2" placeholder="e.g. complete the relapse-prevention worksheet, write 3 triggers"></textarea></div>
          <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-gold sans" onclick="recLogSession(${c.id})">Save session</button><span id="rec_s_msg" class="hint" style="align-self:center"></span></div>
        </div>
      </details>
    </div>
    ${discharge}
    <details class="card" ${(d.sessions&&d.sessions.length)?'open':''}><summary class="sans" style="cursor:pointer;font-weight:600">🗣️ Sessions &amp; homework <span class="badge">${(d.sessions||[]).length}</span></summary>
      ${(d.sessions&&d.sessions.length)?'<div style="margin-top:10px">'+d.sessions.map(s=>`<div class="pc-note" style="border-left:3px solid var(--line);padding-left:10px;margin:8px 0">
        <strong>${esc(s.type)}</strong>${s.topic?' · '+esc(s.topic):''} <span class="hint">${esc(s.at)}${s.by?' · '+esc(s.by):''}</span>
        ${s.note?`<div>${esc(s.note)}</div>`:''}
        ${s.homework?`<div style="margin-top:4px">📚 <strong>Homework:</strong> ${esc(s.homework)} ${s.homeworkDone?'<span class="risk risk-low">done</span>':`<button class="btn btn-ghost btn-sm sans" onclick="markHomework(${s.id},${c.id})">Mark done</button>`}</div>`:''}
      </div>`).join('')+'</div>':'<div class="hint" style="margin-top:8px">No sessions logged yet.</div>'}
    </details>
    ${feed('🚩 Incidents', d.incidents, x=>line(x.at+(x.by?' · '+x.by:''), `${sev(x.severity)} <strong>${esc(x.type)}</strong> — ${esc(x.description)}${x.action?`<div class="hint">Action: ${esc(x.action)}</div>`:''}<div class="hint">${esc(x.status)}</div>`), 'No incidents logged.')}
    ${feed('💓 Pulse notes', d.pulses, p=>line(p.date+' '+p.shift, `${sev(p.concern)} ${p.engagement?'<span class="badge">'+esc(p.engagement)+'</span> ':''}${p.triggers&&p.triggers.length?'<span class="hint">'+p.triggers.map(esc).join(', ')+'</span>':''}${p.statements?`<div>“${esc(p.statements)}”</div>`:''}${p.note?`<div>${esc(p.note)}</div>`:''}`), 'No pulse notes.')}
    ${feed('📝 Documentation notes', d.notes, n=>line(n.at+(n.author?' · '+n.author:'')+(n.source?' · '+n.source:''), `${n.flagged?sev(n.level||'flag')+' ':''}${esc(n.text)}${n.summary?`<div class="hint">⚠ ${esc(n.summary)}</div>`:''}`), 'No documentation notes.')}
    ${feed('🤝 Shift handoffs', d.handoffs, h=>line((h.date||'')+' '+(h.shift||''), esc(h.note)), 'No handoff notes.')}
    ${feed('🗣️ Check-ins (rounds)', d.checkins, x=>line(x.at+(x.by?' · '+x.by:''), `${x.question?'<span class="hint">'+esc(x.question)+'</span><br>':''}${esc(x.answer)}`), 'No check-ins.')}
    ${feed('🛎️ Requests', d.requests, r=>line(r.at, `${esc(r.text)} <span class="hint">${esc(r.dept)} · ${esc(r.status)}</span>`), 'No requests.')}
    ${feed('⚠️ Concerns', d.concerns, x=>line(x.at, `${esc(x.text)} <span class="hint">${esc(x.status)}</span>`), 'No concerns.')}
    ${feed('🚪 Saves (de-escalation)', d.saves, s=>line(s.at, `<strong>${esc(s.outcome)}</strong>${s.trigger?' · '+esc(s.trigger):''}${s.note?`<div>${esc(s.note)}</div>`:''}`), 'No save attempts.')}
    ${feed('📈 AMA risk reads', d.amaReads, a=>line(a.at, `${sev(a.level)} ${esc(a.summary)}`), 'No AMA reads.')}
    ${feed('🎯 Activities', d.activities, a=>line(a.at+(a.by?' · '+a.by:''), `${esc(a.type)}${a.note?' — '+esc(a.note):''}`), 'No activities logged.')}
    ${feed('📞 Follow-ups', d.followups, f=>line('', `${esc(f.type)} · due ${esc(f.due)} · ${esc(f.status)}`), 'No follow-ups.')}`;
  $('recDetail').scrollIntoView({behavior:'smooth',block:'start'});
}
async function recFileIncident(id){
  const desc=$('rec_in_desc').value.trim();
  if(!desc){ $('rec_in_msg').textContent='Describe what happened first.'; return; }
  $('rec_in_msg').textContent='Filing…';
  try{
    await api('/incidents',{method:'POST',body:JSON.stringify({client_id:id, type:$('rec_in_type').value, severity:$('rec_in_sev').value, description:desc, action_taken:$('rec_in_action').value.trim()||null})});
    openRecord(id);   // reload — the new incident shows in the Incidents section
  }catch(e){ $('rec_in_msg').textContent=e.message; }
}
async function recLogSession(id){
  const note=$('rec_s_note').value.trim(), topic=$('rec_s_topic').value.trim(), hw=$('rec_s_hw').value.trim();
  if(!note&&!topic&&!hw){ $('rec_s_msg').textContent='Add a topic, note, or homework.'; return; }
  $('rec_s_msg').textContent='Saving…';
  try{ await api('/clients/'+id+'/session',{method:'POST',body:JSON.stringify({type:$('rec_s_type').value, topic, note, homework:hw})}); openRecord(id); }
  catch(e){ $('rec_s_msg').textContent=e.message; }
}
async function markHomework(sid, cid){ try{ await api('/sessions/'+sid+'/homework',{method:'POST',body:JSON.stringify({done:true})}); openRecord(cid); }catch(e){ alert(e.message); } }

/* ---- My Shift: role-tailored employee dashboard ---- */
function dashScrollTo(key){ const el=$('dash-'+key); if(!el) return; el.scrollIntoView({behavior:'smooth',block:'start'}); el.style.transition='box-shadow .3s'; el.style.boxShadow='0 0 0 2px var(--gold)'; setTimeout(()=>{el.style.boxShadow='';},1300); }
let DASH_PREVIEW=null;
function setDashPreview(role){ DASH_PREVIEW=role||null; loadDashboard(); }
async function loadDashboard(){
  if($('dashSendLineup')) $('dashSendLineup').style.display = canSendLineup() ? '' : 'none';
  const qs = DASH_PREVIEW ? '?as='+encodeURIComponent(DASH_PREVIEW) : '';
  let d; try{ d=await api('/dashboard'+qs); }catch(e){ $('dashSections').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  $('dashGreeting').textContent = `${d.greeting} · ${d.jobRole}`;
  // Admin role-preview switcher — review any role's dashboard.
  if(d.canPreview){
    let bar=$('dashPreview'); if(!bar){ bar=document.createElement('div'); bar.id='dashPreview'; bar.className='card no-print'; bar.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap'; const host=$('dashGreeting').closest('.view')||$('dashSections').parentNode; host.insertBefore(bar, host.firstChild); }
    bar.innerHTML = `<span class="hint">👁 Preview dashboard as role:</span><select id="dashAsSel" class="sans" onchange="setDashPreview(this.value)"><option value="">My role (${esc(ME.job_role||'Team')})</option>${(d.roles||[]).map(r=>`<option value="${esc(r)}" ${r===DASH_PREVIEW?'selected':''}>${esc(r)}</option>`).join('')}</select>${d.previewing?`<span class="risk risk-warn">previewing ${esc(d.previewing)}</span>`:''}`;
  }
  $('dashSubtitle').textContent = d.subtitle||'';
  renderClock();
  renderFacility(d.facility);
  renderCrew();
  renderBContracts();
  renderShiftReport();
  renderShiftChecklist();
  renderDashTasks();
  renderDashRole();
  if(d.lean){ renderLeanDashboard(d); return; }
  if($('dashActions')) $('dashActions').style.display='';
  const ns=d.northStar;
  $('dashNorthStar').innerHTML = ns ? `<div class="card" style="text-align:center;border-left:4px solid var(--gold)">
    <div class="hint" style="text-transform:uppercase;letter-spacing:.6px">${esc(ns.label)}</div>
    <div style="font-size:42px;font-weight:700;line-height:1.1;color:${ns.sev==='high'?'var(--danger)':ns.sev==='warn'?'#9a6a1f':'var(--good)'}">${esc(String(ns.value))}</div></div>` : '';
  $('dashTiles').innerHTML = (d.tiles||[]).map(t=>{
    const cls=t.sev==='high'?'rc-high':t.sev==='warn'?'rc-warn':'';
    const onclick = t.view?`onclick="show('${t.view}')"`:`onclick="dashScrollTo('${t.key}')"`;
    return `<div class="ret-card ${cls}" style="cursor:pointer" ${onclick}><div class="n">${t.n}</div><div class="l">${esc(t.label)} ›</div></div>`;
  }).join('');
  // Today at Armada — the handbook opens every day: principle, focus, safety.
  const fc=d.focus, pr=d.principle;
  $('dashStandard').innerHTML = (pr || (fc&&fc.topic)) ? `<div class="card" style="background:#faf6ee;border-left:4px solid var(--gold)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          ${pr?`<div class="hint" style="text-transform:uppercase;letter-spacing:.6px;color:var(--gold)">Today's Principle · ${pr.n} of 10</div>
          <h3 style="margin:2px 0 0">${esc(pr.title)}</h3><p class="sub sans" style="margin:2px 0 0">${esc(pr.line)}</p>`:''}
          ${fc&&fc.topic?`<div class="hint" style="text-transform:uppercase;letter-spacing:.6px;color:var(--gold);margin-top:8px">Today's Focus — the whole house stresses this</div>
          <div style="font-weight:600">${esc(fc.topic)}</div>${fc.goal?`<p class="sub sans" style="margin:2px 0 0">${esc(fc.goal)}</p>`:''}`:''}
          ${d.safety?`<div class="hint" style="margin-top:8px">🛡 ${esc(d.safety)}</div>`:''}</div>
        <div class="toolbar" style="gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm sans" onclick="startHuddle()">▶ Run the lineup</button><button class="btn btn-gold btn-sm sans" onclick="dashJoinFocus(this)">I'm on it ✋</button><button class="btn btn-ghost btn-sm sans" onclick="recognizeExcellence()">🌟 Recognize</button></div>
      </div></div>` : '';
  // Proactive alerts — the automations reach the floor
  const al=(d.alerts||[]);
  $('dashAlerts').innerHTML = al.length ? `<div class="card" style="border-left:4px solid var(--danger)">
      <h3 style="margin:0 0 6px">⚡ Alerts <span class="badge">${al.length}</span></h3>
      ${al.map(a=>`<div class="todo"><div class="txt">${a.level==='High'?'🔴 ':''}${esc(a.message)}</div><button class="btn btn-ghost btn-sm sans" onclick="ackAlert(${a.id})">Got it ✓</button></div>`).join('')}
    </div>` : '';
  // Your week — healthy pride
  const st=d.stats||{};
  $('dashStats').innerHTML = `<div class="ret-cards" style="margin-top:0">
      <div class="ret-card"><div class="n">${st.standardStreak||0}</div><div class="l">Day Standard streak${(st.standardStreak||0)>=3?' 🔥':''}</div></div>
      <div class="ret-card"><div class="n">${st.wowsWeek||0}</div><div class="l">Wows this week</div></div>
      <div class="ret-card"><div class="n">${st.delightsWeek||0}</div><div class="l">Touches delivered this week</div></div>
      <div class="ret-card"><div class="n">${st.saveRate!=null?st.saveRate+'%':'—'}</div><div class="l">Saves kept (90d)</div></div>
    </div>`;
  // Celebrate — sobriety milestones landing today/tomorrow
  const miles=(d.milestones||[]);
  $('dashMiles').innerHTML = miles.length ? `<div class="card" style="border-left:4px solid var(--gold);background:#faf6ee">
      <h3 style="margin:0 0 6px">🎉 Celebrate today</h3>
      ${miles.map(m=>`<div class="todo"><div class="txt">🎉 <strong>${esc(m.name)}</strong> — ${esc(m.label)} ${m.today?'<span class="risk risk-low">today</span>':'<span class="hint">tomorrow</span>'}</div><button class="btn btn-gold btn-sm sans" onclick="celebrate(${m.id}, ${JSON.stringify(m.label).replace(/"/g,'&quot;')}, this)">Celebrated 🎉</button></div>`).join('')}
    </div>` : '';
  // Anticipation — deliver these without being asked (the unexpressed need)
  const nudges=(d.nudges||[]);
  $('dashNudges').innerHTML = nudges.length ? `<div class="card" style="border-left:4px solid var(--aqua);background:#f4fafb">
      <div class="cmd-hero-row"><div><h3 style="margin:0">Anticipate now <span class="hint" style="font-weight:400">— deliver these without being asked</span></h3></div></div>
      ${nudges.map((n,i)=>`<div class="todo"><div class="txt">✨ ${esc(n.text)}</div><button class="btn btn-gold btn-sm sans" onclick="markDelivered(${n.id}, ${JSON.stringify(n.text).replace(/"/g,'&quot;')}, this)">✓ Delivered</button></div>`).join('')}
    </div>` : '';
  $('dashSections').innerHTML = (d.sections||[]).map(s=>{
    const items = (s.items&&s.items.length) ? s.items.map(it=>`<div class="todo" ${it.id&&!it.act?`onclick="openJourney(${it.id})" style="cursor:pointer"`:''}>
        <div class="txt">${it.badge?`<span class="risk ${/high|ama|allergy|no-show|out/i.test(it.badge)?'risk-high':'risk-elev'}">${esc(it.badge)}</span> `:''}<strong>${esc(it.name)}</strong>${it.room?' <span class="hint">· '+esc(it.room)+'</span>':''}${it.sub?'<div class="hint">'+esc(it.sub)+'</div>':''}</div>
        ${it.act?`<button class="btn btn-gold btn-sm sans" onclick="dashLogActivity(${it.id}, ${JSON.stringify(it.name).replace(/"/g,'&quot;')})">Log activity</button>`:(it.id?'<span class="hint">›</span>':'')}</div>`).join('') : '<div class="pc-note">✓ Nothing here right now.</div>';
    const cta = s.cta?`<div class="toolbar" style="margin-top:8px;justify-content:flex-start"><button class="btn btn-ghost btn-sm sans" onclick="show('${s.cta.view}')">${esc(s.cta.label)}</button></div>`:'';
    return `<div class="card" id="dash-${esc(s.key)}"><h3>${esc(s.title)}</h3>${items}${cta}</div>`;
  }).join('');
  // Recognition — catch people doing it right
  const wins=(d.wins||[]);
  $('dashWins').innerHTML = `<div class="card"><div class="cmd-hero-row"><h3 style="margin:0">Recent Wows 👏</h3><button class="btn btn-ghost btn-sm sans" onclick="logWow()">✨ Log a Wow</button></div>`+
    (wins.length?wins.map(w=>`<div class="pc-note">👏 ${esc(w.text)}${w.by?' <span class="hint">— '+esc(w.by)+'</span>':''}${w.client?' <span class="hint">('+esc(w.client)+')</span>':''}</div>`).join(''):'<div class="pc-note">Be the first today — when you deliver something special or solve it on the spot, log it.</div>')+`</div>`;
}
async function dashJoinFocus(btn){
  try{ await api('/focus',{method:'POST',body:JSON.stringify({})}); if(btn){ btn.textContent='✓ On it'; btn.disabled=true; } }catch(e){ alert(e.message); }
}
async function dashLogActivity(id, name){
  const list = AMENITIES.map((a,i)=>`${i+1}. ${a}`).join('\n');
  const pick = prompt(`Log an activity for ${name}:\n\n${list}\n\nEnter a number or type the activity:`); if(pick===null) return;
  const idx = parseInt(pick,10);
  const type = (!isNaN(idx) && AMENITIES[idx-1]) ? AMENITIES[idx-1] : pick.trim();
  if(!type) return;
  try{ await api('/activities',{method:'POST',body:JSON.stringify({client_id:id, type})});
    const act=(v)=>$(v)&&$(v).classList.contains('active');
    if(act('dashboard')) loadDashboard(); else if(act('engagement')) loadEngagement(); else if(act('journey')) loadJourney(); }
  catch(e){ alert(e.message); }
}
async function celebrate(id, label, btn){
  try{ await api('/delights',{method:'POST',body:JSON.stringify({client_id:id, text:'Celebrated their '+label+' milestone 🎉'})});
    if(btn){ btn.textContent='✓ Celebrated'; btn.disabled=true; const row=btn.closest('.todo'); if(row) row.style.opacity='.6'; } }
  catch(e){ alert(e.message); }
}
async function markDelivered(id, text, btn){
  try{ await api('/delights',{method:'POST',body:JSON.stringify({client_id:id, text})});
    if(btn){ btn.textContent='✓ Done'; btn.disabled=true; const row=btn.closest('.todo'); if(row) row.style.opacity='.5'; } }
  catch(e){ alert(e.message); }
}
async function dashLogSave(){
  const trigger = prompt('What triggered it? (e.g. day-4 cravings, family call)','')||'';
  if(trigger===null) return;
  const stayed = confirm('Outcome?\n\nOK = they STAYED (great work) · Cancel = they left');
  const note = prompt('What you did / what worked (optional):','')||'';
  try{ await api('/saves',{method:'POST',body:JSON.stringify({trigger:trigger.trim()||null, outcome: stayed?'Stayed':'Left', note})});
    if($('dashboard')&&$('dashboard').classList.contains('active')) loadDashboard(); else alert(stayed?'✓ Save logged — they stayed. 🛟':'Logged. Run the Second Save call in 24–72h.'); }
  catch(e){ alert(e.message); }
}
async function logWow(){
  const text = prompt('What did you do? A personal touch you delivered, a problem you solved on the spot, or a teammate worth recognizing:');
  if(!text||!text.trim()) return;
  try{ await api('/wows',{method:'POST',body:JSON.stringify({text:text.trim(),recognize:1})}); if($('dashboard')&&$('dashboard').classList.contains('active')) loadDashboard(); else alert('✓ Logged. Thank you.'); }
  catch(e){ alert(e.message); }
}
async function loadToday(){
  const [t, alertsData, cc] = await Promise.all([
    api('/today'),
    api('/alerts').catch(()=>({alerts:[],newCount:0})),
    api('/carecards').catch(()=>({incomplete:[],overdue:0})),
  ]);
  if(META.kioskCode) $('kioskCodeHint').innerHTML = 'kiosk code: <strong>'+esc(META.kioskCode)+'</strong>';
  if(META.kioskCode && $('kioskCodeHint2')) $('kioskCodeHint2').innerHTML = 'Kiosk code: <strong>'+esc(META.kioskCode)+'</strong> — staff enter this to begin (change it in Settings → Kiosk &amp; display code).';
  if(t.claude) $('todayBriefBtn').style.display='inline-block';
  const m=t.metrics;
  // Populate the (collapsed) detail panels
  renderAlertsList(alertsData);
  renderCareCardsList(cc);
  renderAttentionList(t);
  // ACTION TILES — red/amber when outstanding, click to expand
  const alertN=alertsData.newCount||0, ccInc=(cc.incomplete||[]).length, ccOver=cc.overdue||0, attN=(t.attention||[]).length, incN=m.openIncidents||0;
  const tiles=[
    {k:'alerts', n:alertN, label:'Proactive alerts', sev:alertN?'high':'ok'},
    {k:'carecards', n:ccInc, label:'Care cards to fill', sev:ccOver?'high':(ccInc?'warn':'ok'), sub:ccOver?ccOver+' overdue':''},
    {k:'attention', n:attN, label:'Needs attention', sev:attN?'warn':'ok'},
    {k:'incidents', n:incN, label:'Open incidents', sev:incN?'high':'ok', nav:'incidents'},
  ];
  $('todayActionTiles').innerHTML = tiles.map(x=>{
    const cls=x.sev==='high'?'rc-high':x.sev==='warn'?'rc-warn':'';
    const clickable=x.n>0;
    const target=x.nav?('nav:'+x.nav):x.k;
    return `<div class="ret-card ${cls}" data-tile="${x.k}" ${clickable?`style="cursor:pointer" onclick="todayPanel('${target}')"`:''}>
      <div class="n">${x.n}</div><div class="l">${x.label}${x.sub?'<br><span class="hint">'+esc(x.sub)+'</span>':''}${clickable?' <span class="hint">›</span>':' <span style="color:var(--good)">✓</span>'}</div></div>`;
  }).join('');
  $('todayAllClear').style.display = tiles.some(x=>x.n>0) ? 'none':'block';
  // INFO TILES — glance only
  $('todayInfoTiles').innerHTML = `
    <div class="ret-card"><div class="n">${m.active}</div><div class="l">Active clients</div></div>
    <div class="ret-card"><div class="n">${m.highRisk}</div><div class="l">At risk</div></div>
    <div class="ret-card"><div class="n">${m.callsDue}</div><div class="l">Aftercare calls due</div></div>
    <div class="ret-card"><div class="n">${m.openRequests}</div><div class="l">Open requests</div></div>
    <div class="ret-card"><div class="n">${m.openConcerns}</div><div class="l">Open concerns</div></div>
    <div class="ret-card"><div class="n">${m.surveysDue}</div><div class="l">Surveys due</div></div>
    <div class="ret-card"><div class="n">${m.refreshersDue}</div><div class="l">Refreshers due</div></div>
    <div class="ret-card"><div class="n">${m.visitsToday}</div><div class="l">Visits today</div></div>
    <div class="ret-card"><div class="n">${m.bedsOpen}</div><div class="l">Open beds</div></div>
    <div class="ret-card"><div class="n">${m.pipeline}</div><div class="l">In pipeline</div></div>`;
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
async function loadAlertScore(){
  const card=$('alertScoreCard'), body=$('alertScoreBody'); if(!card||!body) return;
  let d; try{ d=await api('/alerts/scorecard'); }catch(e){ card.style.display='none'; return; }
  card.style.display='';
  const pc=p=>p==null?'var(--muted)':p>=90?'var(--good)':p>=70?'var(--gold)':'var(--danger)';
  const cardFor=(lbl,s)=>`<div class="ret-card"><div class="n" style="color:${pc(s.pct)}">${s.pct!=null?s.pct+'%':'—'}</div><div class="l">${lbl} · ${s.done}/${s.total}${s.missed?' · '+s.missed+' missed':''}</div></div>`;
  const staff=(d.byStaff||[]).map((s,i)=>`<tr><td>${['🥇','🥈','🥉'][i]||(i+1)+'.'} ${esc(s.name)}</td><td>${s.done} handled</td></tr>`).join('');
  const missed=(d.recentMissed||[]).map(m=>`<div class="pc-note">${m.level==='High'||m.level==='Critical'?'🔴 ':''}${esc(m.message)} <span class="hint">— ${esc(m.pref||'house')} · ${esc(m.shift||'')} ${esc(m.shift_date||'')}</span></div>`).join('')||'<div class="hint">Nothing missed in the last 3 days. 👏</div>';
  body.innerHTML=`<div class="ret-cards">${cardFor('This '+esc(d.shift)+' shift',d.thisShift)}${cardFor('Today',d.today)}${cardFor('This week',d.week)}</div>
    <div class="grid2" style="margin-top:14px">
      <div><strong class="sans">Most responsive (7 days)</strong>${staff?`<table class="tbl" style="margin-top:6px">${staff}</table>`:'<div class="hint" style="margin-top:6px">No alerts handled yet.</div>'}</div>
      <div><strong class="sans">Recently missed</strong><div style="margin-top:6px">${missed}</div></div>
    </div>`;
}
// "How I'm doing" — % of what you were supposed to do, per track, with shout-outs.
function statCol(p){ return p==null?'var(--muted)':p>=90?'var(--good)':p>=70?'#9a6a1f':'var(--danger)'; }
function trendStr(t){ if(t==null) return ''; if(t>0) return ` · <span style="color:var(--good)">▲ +${t} vs last week</span>`; if(t<0) return ` · <span style="color:var(--danger)">▼ ${t} vs last week</span>`; return ` · <span class="hint">– even vs last week</span>`; }
async function loadMyStats(){
  const host=$('myStatsBody'); if(!host) return;
  host.innerHTML='<div class="card"><div class="empty">Loading…</div></div>';
  let d; try{ d=await api('/my-stats'); }catch(e){ host.innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const bar=r=>`<div style="margin:11px 0"><div style="display:flex;justify-content:space-between;font-size:14px"><span>${r.care?'💛 ':''}${esc(r.label)}</span><strong style="color:${statCol(r.pct)}">${r.pct==null?'—':r.pct+'%'} <span class="hint" style="font-weight:400">${r.done}/${r.target}</span></strong></div><div class="res-track" style="height:9px;margin-top:4px"><div class="res-fill" style="width:${r.pct||0}%;background:${statCol(r.pct)}"></div></div></div>`;
  const strong=(d.required||[]).filter(r=>r.pct!=null&&r.pct>=90).map(r=>r.label);
  const improve=(d.required||[]).filter(r=>r.pct!=null&&r.pct<70).map(r=>r.label);
  const extras=(d.extras||[]).map(x=>`<div class="ret-card"><div class="n">${x.value}</div><div class="l">${x.care?'💛 ':''}${esc(x.label)} (7d)</div></div>`).join('');
  const wows=(d.wowsForMe||[]);
  host.innerHTML=`
    <div class="card" style="text-align:center;border-left:4px solid var(--gold)">
      <div class="hint" style="text-transform:uppercase;letter-spacing:.6px">Overall this week</div>
      <div style="font-size:48px;font-weight:700;line-height:1.1;color:${statCol(d.overall)}">${d.overall==null?'—':d.overall+'%'}</div>
      <div class="hint">${d.shifts7} shift${d.shifts7===1?'':'s'}${d.hours?' · '+d.hours+' hrs':''} this week${d.flagged7?' · <span style="color:var(--danger)">⚠ '+d.flagged7+' rounds flagged</span>':''}${trendStr(d.trend)}</div>
    </div>
    <div class="card"><h3>Caring for clients comes first 💛</h3>
      ${(d.required||[]).length?(d.required||[]).map(bar).join(''):'<div class="hint">No required duties tracked yet — clock in and run a shift and this fills in.</div>'}
      <p class="hint" style="margin-top:6px">💛 = client-care. The numbers serve the people — a 100% means nothing if a client didn’t feel seen.</p>
      ${strong.length?`<div class="pc-note" style="margin-top:10px;color:var(--good)">💪 Crushing it: ${strong.map(esc).join(', ')} — nice work!</div>`:''}
      ${improve.length?`<div class="pc-note" style="margin-top:6px;color:var(--danger)">🎯 Focus here: ${improve.map(esc).join(', ')}</div>`:''}</div>
    <div class="card"><h3>Care &amp; extras you delivered</h3><div class="ret-cards">${extras}</div></div>
    ${(()=>{ const ex=d.excellence||{}; const rec=[...(ex.recognized30||[]).map(r=>({t:r.text,p:r.principle,by:r.by_name,at:r.at})),...wows.map(w=>({t:w.text,p:null,by:w.by_name,at:w.at}))];
      return `<div class="card" style="border-left:4px solid var(--gold)"><h3>🌟 My Excellence</h3>
      <div class="ret-cards" style="margin-top:8px">
        <div class="ret-card"><div class="n">${rec.length}</div><div class="l">Recognition received (30d)</div></div>
        <div class="ret-card"><div class="n">${ex.given30||0}</div><div class="l">Recognition you gave (30d)</div></div>
        <div class="ret-card" style="cursor:pointer" onclick="show('team')"><div class="n">${ex.reflectionDone?'✓':'—'}</div><div class="l">Friday reflection ${ex.reflectionDone?'in':'(Team page)'}</div></div>
        <div class="ret-card" style="cursor:pointer" onclick="show('team')"><div class="n">${ex.exsurveyDone?'✓':'—'}</div><div class="l">Monthly survey ${ex.exsurveyDone?'in':'(Team page)'}</div></div>
      </div>
      ${rec.length?rec.slice(0,8).map(r=>`<div class="pc-note">👏 ${esc(r.t)}${r.p?` <span class="badge" style="background:#faf6ee;border:1px solid #e7d9b6;color:#8a6d1f">${esc(r.p)}</span>`:''} <span class="hint">— ${esc(r.by||'')}, ${esc(r.at||'')}</span></div>`).join(''):'<div class="hint" style="margin-top:8px">No recognition logged yet this month — go be the reason someone else gets some. 🌟</div>'}
      </div>`; })()}
    <div id="teamStats"></div>`;
  if(d.canManage) loadTeamStats();
}
// Leadership: every employee at a glance — excelling / needs work / trend.
async function loadEmployees(){
  const host=$('empBody'); if(!host) return;
  host.innerHTML='<div class="card"><div class="empty">Loading…</div></div>';
  let d; try{ d=await api('/team-stats'); }catch(e){ host.innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  if(!d.team.length){ host.innerHTML='<div class="card"><div class="empty">No staff activity yet this week.</div></div>'; return; }
  const arrow=t=> t==null?'<span class="hint">–</span>':t>0?`<span style="color:var(--good)">▲ ${t}</span>`:t<0?`<span style="color:var(--danger)">▼ ${-t}</span>`:'<span class="hint">– even</span>';
  host.innerHTML=`<div class="card"><div style="overflow-x:auto"><table class="tbl" style="width:100%">
    <tr><th>Employee</th><th>Role</th><th>Overall</th><th>Trend</th><th>💪 Excelling</th><th>🎯 Needs work</th><th>Shifts</th></tr>
    ${d.team.map(t=>`<tr style="cursor:pointer" onclick="openEmployeeProfile(${t.id}, ${JSON.stringify(t.name).replace(/"/g,'&quot;')})">
      <td><strong>${esc(t.name)}</strong></td><td class="hint">${esc(t.role||'')}</td>
      <td><strong style="color:${statCol(t.overall)}">${t.overall==null?'—':t.overall+'%'}</strong>${t.flagged7?' <span class="hint" title="rounds flagged">⚠'+t.flagged7+'</span>':''}</td>
      <td>${arrow(t.trend)}</td>
      <td style="color:var(--good);font-size:13px">${(t.strong||[]).join(', ')||'—'}</td>
      <td style="color:var(--danger);font-size:13px">${(t.improve||[]).join(', ')||'—'}</td>
      <td>${t.shifts7} ›</td></tr>`).join('')}</table></div>
    <p class="hint" style="margin-top:8px">Tap anyone for their profile, coaching log &amp; how Horst would lead them. For developing people — celebrate the top, support the bottom.</p></div>`;
}
let EMP_CUR=null;
async function openEmployeeProfile(id, name){
  EMP_CUR={id,name};
  let d; try{ d=await api('/employee/'+id+'/profile'); }catch(e){ alert(e.message); return; }
  EMP_CUR.questions=d.discQuestions||[]; EMP_CUR.big5Blocks=d.big5Blocks||[]; EMP_CUR.sjtQuestions=d.sjtQuestions||[]; EMP_CUR.sjtComps=d.sjtComps||{};
  const s=d.stats||{}, p=d.profile||{};
  const b5=d.bigfive, bg=d.big5Guide||{};
  const trait=k=>{ const v=b5[k]; const g=bg[k]||{}; const read=v>=70?g.high:v<=40?g.low:''; return `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${esc(g.name||k)}</span><strong>${v}</strong></div><div class="res-track" style="height:7px;margin:3px 0"><div class="res-fill" style="width:${v}%"></div></div>${read?`<div class="hint" style="font-size:12.5px">${esc(read)}</div>`:''}</div>`; };
  const big5Html = b5
    ? `<div class="card" style="margin:10px 0 0"><div class="cmd-hero-row"><div><h3 style="margin:0">🔬 Personality (Big Five + Integrity)</h3><p class="sub sans" style="margin:0">Forced-choice read — can't be gamed. For development &amp; recognition.</p></div><button class="btn btn-ghost btn-sm sans" onclick="big5Assess(${id})">Retake</button></div>${['C','ES','A','E','O','H'].map(trait).join('')}</div>`
    : `<div class="card" style="margin:10px 0 0;background:#f4f8f4;border-left:4px solid var(--good)"><div class="cmd-hero-row"><div><h3 style="margin:0">🔬 Personality (Big Five + Integrity)</h3><p class="sub sans" style="margin:0">Forced-choice ("most / least like them") so it can't be gamed — reliability, stability, warmth, openness, extraversion &amp; integrity.</p></div><button class="btn btn-gold btn-sm sans" onclick="big5Assess(${id})">Take assessment</button></div></div>`;
  const sjt=d.sjt, sc=d.sjtComps||{};
  const sjtRow=k=>{ const v=sjt[k]; if(v==null) return ''; const col=v>=80?'var(--good)':v>=50?'var(--gold)':'var(--danger)'; return `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${esc(sc[k]||k)}</span><strong style="color:${col}">${v}</strong></div><div class="res-track" style="height:7px;margin:3px 0"><div class="res-fill" style="width:${v}%;background:${col}"></div></div></div>`; };
  const sjtHtml = sjt
    ? `<div class="card" style="margin:10px 0 0"><div class="cmd-hero-row"><div><h3 style="margin:0">⚖️ Judgment on the job</h3><p class="sub sans" style="margin:0">Real scenarios — integrity, de-escalation, reliability, care. Low = develop, never a verdict.</p></div><button class="btn btn-ghost btn-sm sans" onclick="sjtAssess(${id})">Retake</button></div>${Object.keys(sc).map(sjtRow).join('')}</div>`
    : `<div class="card" style="margin:10px 0 0;background:#fbf7f0;border-left:4px solid var(--gold)"><div class="cmd-hero-row"><div><h3 style="margin:0">⚖️ Judgment on the job</h3><p class="sub sans" style="margin:0">Hard-to-fake scenarios that reveal how they'd actually handle integrity, an escalating client, a 2am round &amp; a struggling admit.</p></div><button class="btn btn-gold btn-sm sans" onclick="sjtAssess(${id})">Take assessment</button></div></div>`;
  const disc=d.disc, gg=d.discGuide;
  const discHtml = (disc&&gg)
    ? `<div class="card" style="margin:10px 0 0"><div class="cmd-hero-row"><div><h3 style="margin:0">🧭 Personality — ${esc(gg.name)}</h3><p class="sub sans" style="margin:0">${esc(gg.blurb)}</p></div><button class="btn btn-ghost btn-sm sans" onclick="discAssess(${id})">Retake</button></div>
       <div style="display:flex;gap:10px;margin:10px 0">${['D','I','S','C'].map(k=>`<div style="flex:1;text-align:center"><div style="font-weight:700;color:${k===disc.primary?'var(--gold)':'var(--muted)'}">${k}</div><div class="res-track" style="height:6px"><div class="res-fill" style="width:${disc[k]}%"></div></div><div class="hint">${disc[k]}%</div></div>`).join('')}</div>
       <div style="font-size:13.5px;line-height:1.6"><b style="color:var(--good)">Appreciate:</b> ${esc(gg.appreciate)}<br><b>Strengths:</b> ${esc(gg.strengths)}<br><b style="color:var(--danger)">Watch:</b> ${esc(gg.watch)}<br><b>Lead them:</b> ${esc(gg.lead)}</div></div>`
    : `<div class="card" style="margin:10px 0 0;background:#f4fafb;border-left:4px solid var(--aqua)"><div class="cmd-hero-row"><div><h3 style="margin:0">🧭 Personality read</h3><p class="sub sans" style="margin:0">A quick DISC-style read — how to lead &amp; appreciate them.</p></div><button class="btn btn-gold btn-sm sans" onclick="discAssess(${id})">Take assessment</button></div></div>`;
  const strong=(s.required||[]).filter(r=>r.pct!=null&&r.pct>=90).map(r=>r.label);
  const improve=(s.required||[]).filter(r=>r.pct!=null&&r.pct<70).map(r=>r.label);
  const notes=(d.notes||[]).map(n=>`<div class="pc-note">📝 ${esc(n.note)} <span class="hint">— ${esc(n.by_name||'')}, ${esc(n.at)}</span></div>`).join('')||'<div class="hint">No coaching notes yet.</div>';
  const fld=(fid,lbl,val,ph)=>`<label>${lbl}</label><textarea id="${fid}" rows="2" placeholder="${esc(ph)}">${esc(val||'')}</textarea>`;
  const first=esc((name||'').split(' ')[0]||'them');
  hmodalPlain(`<h3>${esc(name)} <span class="hint" style="font-weight:400">· ${esc(d.user.role||'')}</span></h3>
   <div style="max-height:72vh;overflow:auto;padding-right:4px">
    <div style="text-align:center;margin:4px 0 8px"><div style="font-size:30px;font-weight:700;color:${statCol(s.overall)}">${s.overall==null?'—':s.overall+'%'}</div><div class="hint">${s.shifts7||0} shift${s.shifts7===1?'':'s'} this week${s.trend!=null?trendStr(s.trend):''} · ${d.wows90||0} Wows (90d)</div>
      ${strong.length?`<div class="pc-note" style="color:var(--good);margin-top:6px">💪 ${strong.map(esc).join(', ')}</div>`:''}${improve.length?`<div class="pc-note" style="color:var(--danger);margin-top:4px">🎯 ${improve.map(esc).join(', ')}</div>`:''}</div>
    <div class="card" style="background:#faf6ee;border-left:4px solid var(--gold);margin:0"><div class="cmd-hero-row"><div><h3 style="margin:0">✦ How Horst would lead ${first}</h3></div>${d.aiReady?`<button class="btn btn-gold btn-sm sans" onclick="coachEmployee(${id})">Generate</button>`:''}</div><div id="empCoach" class="sans" style="margin-top:8px;font-size:14px;line-height:1.5">${d.aiReady?'<span class="hint">Tap Generate for personalized coaching from their profile + numbers.</span>':'<span class="hint">AI not configured.</span>'}</div></div>
    ${big5Html}
    ${sjtHtml}
    ${discHtml}
    <div id="epGrowth"></div>
    <h3 style="font-size:13px;margin-top:14px">Their profile <span class="hint" style="font-weight:400">— only leadership sees this</span></h3>
    ${fld('ep_likes','What they like / interests',p.likes,'coffee black, their dog Max, weekend fisherman…')}
    ${fld('ep_personality','Personality & style',p.personality,'quiet; takes feedback hard; leads by example…')}
    ${fld('ep_motivators','What motivates them',p.motivators,'public praise, more responsibility, schedule flexibility…')}
    ${fld('ep_recognition','How they like to be recognized',p.recognition,'private thank-you vs. shout-out at lineup…')}
    ${fld('ep_notes','Notes',p.notes,'anything to remember')}
    <div class="toolbar" style="justify-content:flex-start;margin-top:4px"><button class="btn btn-gold btn-sm sans" onclick="saveEmployeeProfile(${id})">Save profile</button><span id="ep_msg" class="hint" style="align-self:center"></span></div>
    <h3 style="font-size:13px;margin-top:14px">Coaching log</h3>
    <div class="handoff-add" style="gap:6px"><input id="ep_note" placeholder="Log a conversation or observation…"/><button class="btn btn-ghost btn-sm sans" onclick="addEmployeeNote(${id})">Add</button></div>
    <div style="margin-top:8px">${notes}</div>
   </div>
   <div class="toolbar" style="margin-top:12px"><button class="btn btn-ghost sans" onclick="closeHModal()">Close</button></div>`);
  renderEmpGrowth(id);
}
async function renderEmpGrowth(id){
  const host=$('epGrowth'); if(!host) return;
  let d; try{ d=await api('/growth/'+id); }catch(e){ host.innerHTML=''; return; }
  const p=d.plan||{};
  const goal=(lbl,val)=>val?`<div style="margin:4px 0;font-size:13.5px"><b>${lbl}:</b> ${esc(val)}</div>`:'';
  const has=p.goal_6m||p.goal_1y||p.goal_5y||p.goal_10y;
  const checks=(d.checkins||[]).slice(0,6).map(c=>`<div class="pc-note" style="margin:5px 0"><div class="hint" style="margin-bottom:2px">${c.self?'🙋 '+esc(EMP_CUR&&EMP_CUR.name||'them'):'👤 '+esc(c.by_name||'')} · ${esc(c.at)}</div>${c.progress?`<div><b>Progress:</b> ${esc(c.progress)}</div>`:''}${c.support?`<div><b>Support:</b> ${esc(c.support)}</div>`:''}</div>`).join('');
  host.innerHTML=`<div class="card" style="margin:10px 0 0;${has?'':'background:#f7f9f7;border-left:4px solid var(--good)'}"><div class="cmd-hero-row"><div><h3 style="margin:0">🌱 Their growth ${d.due?'<span class="badge-danger" style="font-size:11px">check-in due</span>':''}</h3><p class="sub sans" style="margin:0">Their own goals — support them toward where they want to go.</p></div></div>
    ${has?`<div style="margin:6px 0">${goal('6 months',p.goal_6m)}${goal('1 year',p.goal_1y)}${goal('5 years',p.goal_5y)}${goal('10 years',p.goal_10y)}${p.why?`<div class="hint" style="margin-top:4px">💛 ${esc(p.why)}</div>`:''}</div>`:'<div class="hint" style="margin:6px 0">They haven\'t set goals yet — encourage them to open <b>My Growth</b>.</div>'}
    <label style="font-weight:600;font-size:13px">Log a support check-in</label>
    <textarea id="eg_prog" rows="2" placeholder="How are they tracking? (optional)"></textarea>
    <textarea id="eg_sup" rows="2" placeholder="What support did you agree on to get them closer?"></textarea>
    <div class="toolbar" style="justify-content:flex-start;margin-top:4px"><button class="btn btn-gold btn-sm sans" onclick="addEmpCheckin(${id})">Save check-in</button></div>
    ${checks?`<div style="margin-top:8px">${checks}</div>`:''}</div>`;
}
async function addEmpCheckin(id){
  const progress=($('eg_prog')||{}).value||'', support=($('eg_sup')||{}).value||'';
  if(!progress.trim()&&!support.trim()){ alert('Add a note.'); return; }
  try{ await api('/growth/'+id+'/checkin',{method:'POST',body:JSON.stringify({progress,support})}); renderEmpGrowth(id); }catch(e){ alert(e.message); }
}
async function saveEmployeeProfile(id){ try{ await api('/employee/'+id+'/profile',{method:'POST',body:JSON.stringify({likes:$('ep_likes').value,personality:$('ep_personality').value,motivators:$('ep_motivators').value,recognition:$('ep_recognition').value,notes:$('ep_notes').value})}); if($('ep_msg'))$('ep_msg').textContent='✓ Saved'; }catch(e){ alert(e.message); } }
async function addEmployeeNote(id){ const t=($('ep_note')||{}).value||''; if(!t.trim())return; try{ await api('/employee/'+id+'/note',{method:'POST',body:JSON.stringify({note:t.trim()})}); openEmployeeProfile(id, EMP_CUR&&EMP_CUR.name); }catch(e){ alert(e.message); } }
async function coachEmployee(id){ const el=$('empCoach'); if(el)el.innerHTML='<span class="hint">✦ Thinking…</span>'; try{ const r=await api('/employee/'+id+'/coach',{method:'POST'}); if(el) el.innerHTML=esc(r.brief).replace(/\n/g,'<br>'); }catch(e){ if(el) el.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
function discAssess(id){
  const qs=(EMP_CUR&&EMP_CUR.questions)||[];
  if(!qs.length){ alert('Reopen the profile and try again.'); return; }
  const rows=qs.map((q,i)=>`<div style="display:flex;align-items:center;gap:10px;margin:8px 0"><div style="flex:1;font-size:14px">${esc(q.t)}</div><select id="disc_${i}" style="width:auto"><option value="">—</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('')}</select></div>`).join('');
  hmodalPlain(`<h3>Personality read</h3><p class="sub sans">Rate each 1 (not like them) – 5 (very like them). Answer from what you see — or have them self-rate. Takes ~2 minutes.</p><div style="max-height:60vh;overflow:auto">${rows}</div><div class="toolbar" style="margin-top:12px;justify-content:space-between"><button class="btn btn-ghost sans" onclick="openEmployeeProfile(${id}, EMP_CUR&&EMP_CUR.name)">Back</button><button class="btn btn-gold sans" onclick="submitDisc(${id})">See result</button></div>`);
}
async function submitDisc(id){
  const answers={}; let missing=false;
  (EMP_CUR.questions||[]).forEach((q,i)=>{ const v=($('disc_'+i)||{}).value; if(!v) missing=true; answers[i]=v; });
  if(missing){ alert('Please rate every statement.'); return; }
  try{ await api('/employee/'+id+'/disc',{method:'POST',body:JSON.stringify({answers})}); openEmployeeProfile(id, EMP_CUR&&EMP_CUR.name); }catch(e){ alert(e.message); }
}
function big5Pick(bi,kind,oi){
  // enforce that Most and Least can't be the same option within a block
  const other=kind==='most'?'least':'most';
  if((B5_SEL[bi]||{})[other]===oi){ B5_SEL[bi][other]=null; }
  B5_SEL[bi]=B5_SEL[bi]||{}; B5_SEL[bi][kind]=oi;
  big5Paint(bi);
}
function big5Paint(bi){
  const sel=B5_SEL[bi]||{};
  const block=(EMP_CUR&&EMP_CUR.big5Blocks[bi])||[];
  block.forEach((o,oi)=>{
    const m=$('b5_'+bi+'_most_'+oi), l=$('b5_'+bi+'_least_'+oi);
    if(m){ m.className='btn btn-sm sans '+(sel.most===oi?'btn-gold':'btn-ghost'); }
    if(l){ l.className='btn btn-sm sans '+(sel.least===oi?'btn-gold':'btn-ghost'); }
  });
}
let B5_SEL={};
function big5Assess(id){
  const blocks=(EMP_CUR&&EMP_CUR.big5Blocks)||[];
  if(!blocks.length){ alert('Reopen the profile and try again.'); return; }
  B5_SEL={};
  const rows=blocks.map((block,bi)=>`<div class="card" style="margin:8px 0;padding:10px"><div class="hint" style="margin-bottom:6px">Block ${bi+1} of ${blocks.length} — pick the <b style="color:var(--gold)">MOST</b> and the <b>LEAST</b> like them</div>${block.map((o,oi)=>`<div style="display:flex;align-items:center;gap:8px;margin:5px 0"><div style="flex:1;font-size:13.5px">${esc(o.t)}</div><button id="b5_${bi}_most_${oi}" class="btn btn-ghost btn-sm sans" onclick="big5Pick(${bi},'most',${oi})">Most</button><button id="b5_${bi}_least_${oi}" class="btn btn-ghost btn-sm sans" onclick="big5Pick(${bi},'least',${oi})">Least</button></div>`).join('')}</div>`).join('');
  hmodalPlain(`<h3>Personality read — Big Five + Integrity</h3><p class="sub sans">In each block, pick the one statement that's <b>most</b> like them and the one that's <b>least</b> like them. Every option is a good trait — that's what keeps it honest. ~2 minutes.</p><div style="max-height:60vh;overflow:auto">${rows}</div><div class="toolbar" style="margin-top:12px;justify-content:space-between"><button class="btn btn-ghost sans" onclick="openEmployeeProfile(${id}, EMP_CUR&&EMP_CUR.name)">Back</button><button class="btn btn-gold sans" onclick="submitBig5(${id})">See result</button></div>`);
}
async function submitBig5(id){
  const blocks=(EMP_CUR&&EMP_CUR.big5Blocks)||[]; const answers={}; let missing=false;
  blocks.forEach((b,bi)=>{ const s=B5_SEL[bi]||{}; if(s.most==null||s.least==null){ missing=true; } answers[bi]={most:s.most,least:s.least}; });
  if(missing){ alert('Pick a Most and a Least in every block.'); return; }
  try{ await api('/employee/'+id+'/bigfive',{method:'POST',body:JSON.stringify({answers})}); openEmployeeProfile(id, EMP_CUR&&EMP_CUR.name); }catch(e){ alert(e.message); }
}
let SJT_SEL={};
function sjtPick(qi,oi){ SJT_SEL[qi]=oi; const q=(EMP_CUR&&EMP_CUR.sjtQuestions[qi])||{}; (q.o||[]).forEach((o,j)=>{ const b=$('sjt_'+qi+'_'+j); if(b) b.className='btn btn-sm sans '+(oi===j?'btn-gold':'btn-ghost'); }); }
function sjtAssess(id){
  const qs=(EMP_CUR&&EMP_CUR.sjtQuestions)||[];
  if(!qs.length){ alert('Reopen the profile and try again.'); return; }
  SJT_SEL={};
  const rows=qs.map((q,qi)=>`<div class="card" style="margin:8px 0;padding:10px"><div style="font-size:14px;font-weight:600;margin-bottom:6px">${qi+1}. ${esc(q.s)}</div>${q.o.map((o,j)=>`<button id="sjt_${qi}_${j}" class="btn btn-ghost btn-sm sans" style="display:block;width:100%;text-align:left;margin:4px 0" onclick="sjtPick(${qi},${j})">${esc(o.t)}</button>`).join('')}</div>`).join('');
  hmodalPlain(`<h3>Judgment on the job</h3><p class="sub sans">For each situation, pick what this person would most likely do. Best answered from what you've actually seen them do — or have them answer themselves. There isn't always an obvious "right" answer.</p><div style="max-height:60vh;overflow:auto">${rows}</div><div class="toolbar" style="margin-top:12px;justify-content:space-between"><button class="btn btn-ghost sans" onclick="openEmployeeProfile(${id}, EMP_CUR&&EMP_CUR.name)">Back</button><button class="btn btn-gold sans" onclick="submitSjt(${id})">See result</button></div>`);
}
async function submitSjt(id){
  const qs=(EMP_CUR&&EMP_CUR.sjtQuestions)||[]; const answers={}; let missing=false;
  qs.forEach((q,qi)=>{ if(SJT_SEL[qi]==null) missing=true; answers[qi]=SJT_SEL[qi]; });
  if(missing){ alert('Answer every scenario.'); return; }
  try{ await api('/employee/'+id+'/sjt',{method:'POST',body:JSON.stringify({answers})}); openEmployeeProfile(id, EMP_CUR&&EMP_CUR.name); }catch(e){ alert(e.message); }
}
/* ───────── LEADERSHIP MIRROR — the executive-coach read (CEO + every leader) ───────── */
let LM_CUR=null;
async function loadLeadMirror(){
  const host=$('leadmirror'); if(!host) return;
  host.innerHTML='<div class="hint">Loading…</div>';
  // The owner gets a roster of every leader (incl. themselves); a leader lands straight on their own mirror.
  if(ME && ME.role==='admin'){
    let d; try{ d=await api('/leadership/leaders'); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
    host.innerHTML=`<div class="card"><h3>🪞 Leadership Mirror</h3><p class="sub sans">The highest-level read — what a world-class executive coach would tell you. Real org data + a read of leadership style &amp; judgment, then Horst's honest take on where each leader strives, struggles, and leads best. Start with yourself.</p>
      <table class="tbl"><tr><th>Leader</th><th>Seat</th><th>Status</th><th></th></tr>
      ${d.leaders.map(l=>`<tr style="cursor:pointer" onclick="openLeadMirror(${l.id}, ${JSON.stringify(l.name).replace(/"/g,'&quot;')})"><td><strong>${esc(l.name)}</strong>${l.id===ME.id?' <span class="hint">(you)</span>':''}</td><td class="hint">${esc(l.role)}</td><td>${l.taken?'<span style="color:var(--good)">✓ Complete</span>':'<span class="hint">Not started</span>'}</td><td>›</td></tr>`).join('')}</table>
      <p class="hint" style="margin-top:8px">For development, not punishment. Be honest with your leaders the way you'd want a great mentor to be honest with you.</p></div>`;
  } else {
    openLeadMirror(ME.id, ME.name);
    host.innerHTML='<div class="hint">Opening your mirror…</div>';
  }
}
async function openLeadMirror(id, name){
  LM_CUR={id,name};
  let d; try{ d=await api('/leadership/mirror/'+id); }catch(e){ alert(e.message); return; }
  LM_CUR.styleBlocks=d.styleBlocks||[]; LM_CUR.judgmentQuestions=d.judgmentQuestions||[]; LM_CUR.comps=d.comps||{};
  const c=d.comps||{}, lead=d.lead||{}, org=d.org||{}, own=d.own||{};
  const self=ME&&ME.id===id;
  const who=self?'you':esc((name||'').split(' ')[0]||'them');
  const bar=(v,lbl)=>{ const col=v>=70?'var(--good)':v>=45?'var(--gold)':'var(--danger)'; return `<div style="margin:7px 0"><div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${esc(lbl)}</span><strong style="color:${col}">${v}</strong></div><div class="res-track" style="height:7px;margin:3px 0"><div class="res-fill" style="width:${v}%;background:${col}"></div></div></div>`; };
  const compRows=(obj)=>obj?Object.keys(c).map(k=>obj[k]!=null?bar(obj[k],c[k]):'').join(''):'';
  // Real-data card
  const tt=org.teamTrend; const ttStr=tt==null?'':(tt>0?`<span style="color:var(--good)">▲${tt}</span>`:tt<0?`<span style="color:var(--danger)">▼${-tt}</span>`:'<span class="hint">flat</span>');
  const dataCard=`<div class="card" style="margin:0 0 10px;background:#f4f8f4;border-left:4px solid var(--good)"><h3 style="margin:0 0 6px">📊 The real data</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:120px;text-align:center"><div style="font-size:26px;font-weight:700;color:${org.teamAvg==null?'var(--muted)':statCol(org.teamAvg)}">${org.teamAvg==null?'—':org.teamAvg+'%'}</div><div class="hint">Team performance${ttStr?' '+ttStr:''}<br>(${org.teamN||0} staff)</div></div>
      <div style="flex:1;min-width:120px;text-align:center"><div style="font-size:26px;font-weight:700">${own.recognitionGiven||0}</div><div class="hint">Recognition given<br>(30 days)</div></div>
      <div style="flex:1;min-width:120px;text-align:center"><div style="font-size:26px;font-weight:700">${own.coachingNotes||0}</div><div class="hint">Coaching logged<br>(30 days)</div></div>
    </div><p class="hint" style="margin:8px 0 0">The engine ${who} ${self?'help':'helps'} lead — are the people getting better, and ${self?'are you':'is ' + who} catching them doing right?</p></div>`;
  // Style card
  const styleCard=lead.style
    ? `<div class="card" style="margin:0 0 10px"><div class="cmd-hero-row"><div><h3 style="margin:0">🧭 Leadership style</h3><p class="sub sans" style="margin:0">Forced-choice — can't be gamed.</p></div><button class="btn btn-ghost btn-sm sans" onclick="lmStyle(${id})">Retake</button></div>${compRows(lead.style)}</div>`
    : `<div class="card" style="margin:0 0 10px;background:#f4fafb;border-left:4px solid var(--aqua)"><div class="cmd-hero-row"><div><h3 style="margin:0">🧭 Leadership style</h3><p class="sub sans" style="margin:0">A hard-to-fake read of how ${who} ${self?'lead':'leads'} — vision, developing people, accountability, composure, integrity, decisiveness, listening.</p></div><button class="btn btn-gold btn-sm sans" onclick="lmStyle(${id})">Take it</button></div></div>`;
  // Judgment card
  const judgeCard=lead.judgment
    ? `<div class="card" style="margin:0 0 10px"><div class="cmd-hero-row"><div><h3 style="margin:0">⚖️ Leadership judgment</h3><p class="sub sans" style="margin:0">Real executive dilemmas.</p></div><button class="btn btn-ghost btn-sm sans" onclick="lmJudge(${id})">Retake</button></div>${compRows(lead.judgment)}</div>`
    : `<div class="card" style="margin:0 0 10px;background:#fbf7f0;border-left:4px solid var(--gold)"><div class="cmd-hero-row"><div><h3 style="margin:0">⚖️ Leadership judgment</h3><p class="sub sans" style="margin:0">Real dilemmas a leader here actually faces — a star who broke a rule, a failing direct report, a crisis, a hard truth from the front line.</p></div><button class="btn btn-gold btn-sm sans" onclick="lmJudge(${id})">Take it</button></div></div>`;
  const readBtn=d.aiReady?`<button class="btn btn-gold btn-sm sans" onclick="lmCoach(${id})">Generate</button>`:'';
  hmodalPlain(`<h3>🪞 ${esc(name)} <span class="hint" style="font-weight:400">· ${esc(d.user.role||'')}</span></h3>
   <div style="max-height:74vh;overflow:auto;padding-right:4px">
    ${dataCard}${styleCard}${judgeCard}
    <div class="card" style="background:#faf6ee;border-left:4px solid var(--gold);margin:0"><div class="cmd-hero-row"><div><h3 style="margin:0">✦ Horst's honest read</h3><p class="sub sans" style="margin:0">Where ${who} ${self?'strive':'strives'}, struggle, the blind spot &amp; one move.</p></div>${readBtn}</div><div id="lmCoach" class="sans" style="margin-top:8px;font-size:14px;line-height:1.55">${d.aiReady?'<span class="hint">Tap Generate once style + judgment are done for the fullest read.</span>':'<span class="hint">AI not configured.</span>'}</div></div>
   </div>
   <div class="toolbar" style="margin-top:12px"><button class="btn btn-ghost sans" onclick="closeHModal();${ME&&ME.role==='admin'?'loadLeadMirror()':''}">Close</button></div>`);
}
let LM_SEL={};
function lmStylePick(bi,kind,oi){ const other=kind==='most'?'least':'most'; LM_SEL[bi]=LM_SEL[bi]||{}; if(LM_SEL[bi][other]===oi) LM_SEL[bi][other]=null; LM_SEL[bi][kind]=oi; const block=(LM_CUR&&LM_CUR.styleBlocks[bi])||[]; block.forEach((o,j)=>{ const m=$('lm_'+bi+'_most_'+j), l=$('lm_'+bi+'_least_'+j); const s=LM_SEL[bi]||{}; if(m)m.className='btn btn-sm sans '+(s.most===j?'btn-gold':'btn-ghost'); if(l)l.className='btn btn-sm sans '+(s.least===j?'btn-gold':'btn-ghost'); }); }
function lmStyle(id){
  const blocks=(LM_CUR&&LM_CUR.styleBlocks)||[]; if(!blocks.length){ alert('Reopen and try again.'); return; }
  LM_SEL={};
  const rows=blocks.map((block,bi)=>`<div class="card" style="margin:8px 0;padding:10px"><div class="hint" style="margin-bottom:6px">Block ${bi+1} of ${blocks.length} — pick the <b style="color:var(--gold)">MOST</b> and <b>LEAST</b> like ${id===(ME&&ME.id)?'you':'them'}</div>${block.map((o,j)=>`<div style="display:flex;align-items:center;gap:8px;margin:5px 0"><div style="flex:1;font-size:13.5px">${esc(o.t)}</div><button id="lm_${bi}_most_${j}" class="btn btn-ghost btn-sm sans" onclick="lmStylePick(${bi},'most',${j})">Most</button><button id="lm_${bi}_least_${j}" class="btn btn-ghost btn-sm sans" onclick="lmStylePick(${bi},'least',${j})">Least</button></div>`).join('')}</div>`).join('');
  hmodalPlain(`<h3>Leadership style</h3><p class="sub sans">In each block, pick the one <b>most</b> like ${id===(ME&&ME.id)?'you':'them'} and the one <b>least</b>. Every option is a real strength — that's what keeps it honest.</p><div style="max-height:60vh;overflow:auto">${rows}</div><div class="toolbar" style="margin-top:12px;justify-content:space-between"><button class="btn btn-ghost sans" onclick="openLeadMirror(${id}, LM_CUR&&LM_CUR.name)">Back</button><button class="btn btn-gold sans" onclick="lmSubmitStyle(${id})">See result</button></div>`);
}
async function lmSubmitStyle(id){
  const blocks=(LM_CUR&&LM_CUR.styleBlocks)||[]; const answers={}; let missing=false;
  blocks.forEach((b,bi)=>{ const s=LM_SEL[bi]||{}; if(s.most==null||s.least==null) missing=true; answers[bi]={most:s.most,least:s.least}; });
  if(missing){ alert('Pick a Most and a Least in every block.'); return; }
  try{ await api('/leadership/mirror/'+id+'/style',{method:'POST',body:JSON.stringify({answers})}); openLeadMirror(id, LM_CUR&&LM_CUR.name); }catch(e){ alert(e.message); }
}
let LMJ_SEL={};
function lmJudgePick(qi,oi){ LMJ_SEL[qi]=oi; const q=(LM_CUR&&LM_CUR.judgmentQuestions[qi])||{}; (q.o||[]).forEach((o,j)=>{ const b=$('lmj_'+qi+'_'+j); if(b)b.className='btn btn-sm sans '+(oi===j?'btn-gold':'btn-ghost'); }); }
function lmJudge(id){
  const qs=(LM_CUR&&LM_CUR.judgmentQuestions)||[]; if(!qs.length){ alert('Reopen and try again.'); return; }
  LMJ_SEL={};
  const rows=qs.map((q,qi)=>`<div class="card" style="margin:8px 0;padding:10px"><div style="font-size:14px;font-weight:600;margin-bottom:6px">${qi+1}. ${esc(q.s)}</div>${q.o.map((o,j)=>`<button id="lmj_${qi}_${j}" class="btn btn-ghost btn-sm sans" style="display:block;width:100%;text-align:left;margin:4px 0" onclick="lmJudgePick(${qi},${j})">${esc(o.t)}</button>`).join('')}</div>`).join('');
  hmodalPlain(`<h3>Leadership judgment</h3><p class="sub sans">For each dilemma, pick what ${id===(ME&&ME.id)?'you':'they'} would most likely do. There isn't always an obvious right answer.</p><div style="max-height:60vh;overflow:auto">${rows}</div><div class="toolbar" style="margin-top:12px;justify-content:space-between"><button class="btn btn-ghost sans" onclick="openLeadMirror(${id}, LM_CUR&&LM_CUR.name)">Back</button><button class="btn btn-gold sans" onclick="lmSubmitJudge(${id})">See result</button></div>`);
}
async function lmSubmitJudge(id){
  const qs=(LM_CUR&&LM_CUR.judgmentQuestions)||[]; const answers={}; let missing=false;
  qs.forEach((q,qi)=>{ if(LMJ_SEL[qi]==null) missing=true; answers[qi]=LMJ_SEL[qi]; });
  if(missing){ alert('Answer every scenario.'); return; }
  try{ await api('/leadership/mirror/'+id+'/judgment',{method:'POST',body:JSON.stringify({answers})}); openLeadMirror(id, LM_CUR&&LM_CUR.name); }catch(e){ alert(e.message); }
}
async function lmCoach(id){ const el=$('lmCoach'); if(el)el.innerHTML='<span class="hint">✦ Thinking…</span>'; try{ const r=await api('/leadership/mirror/'+id+'/coach',{method:'POST'}); if(el)el.innerHTML=esc(r.brief).replace(/\n/g,'<br>'); }catch(e){ if(el)el.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } }
/* ───────── STAFF SIGN-INS — last time each person signed in (admin) ───────── */
function sinceStr(iso){
  if(!iso) return null;
  const t=new Date(iso.replace(' ','T')+'Z').getTime(); if(isNaN(t)) return null;
  const m=Math.floor((Date.now()-t)/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  const d=Math.floor(h/24); if(d<30) return d+'d ago';
  const mo=Math.floor(d/30); return mo+'mo ago';
}
function fmtDT(iso){ if(!iso) return ''; const dt=new Date(iso.replace(' ','T')+'Z'); if(isNaN(dt)) return esc(iso); return dt.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
async function loadStaffSignins(){
  const host=$('staffsignins'); if(!host) return;
  host.innerHTML='<div class="hint">Loading…</div>';
  let d; try{ d=await api('/staff-activity'); }catch(e){ host.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const staff=d.staff||[];
  const row=u=>{ const s=sinceStr(u.lastLogin); const stale=u.lastLogin&&((Date.now()-new Date(u.lastLogin.replace(' ','T')+'Z').getTime())/86400000)>=14;
    const last=u.lastLogin?`<span title="${esc(fmtDT(u.lastLogin))}">${esc(fmtDT(u.lastLogin))} <span class="hint">· ${esc(s||'')}</span></span>`:'<span class="hint">Never signed in</span>';
    return `<tr${u.active?'':' style="opacity:.5"'}><td><strong>${esc(u.name)}</strong>${u.active?'':' <span class="hint">(inactive)</span>'}</td><td class="hint">${esc(u.role||'')}</td><td style="${(!u.lastLogin||stale)?'color:var(--danger)':''}">${last}</td></tr>`; };
  host.innerHTML=`<div class="card"><h3>Staff sign-ins</h3><p class="sub sans">The last time each person signed in. Sorted by most recent; never-signed-in and 2+ weeks stale are flagged in red.</p>
    <table class="tbl"><tr><th>Staff</th><th>Role</th><th>Last sign-in</th></tr>${staff.map(row).join('')}</table></div>`;
}
/* ───────── ADMIT / DISCHARGE diagnostic (admin) — see the stored dates directly ───────── */
async function loadAdmitCheck(){
  const host=$('admitcheck'); if(!host) return;
  host.innerHTML='<div class="hint">Loading…</div>';
  let d; try{ d=await api('/diag/admit-discharge'); }catch(e){ host.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const f=d.facility||{};
  const box=(n,l)=>`<div class="ret-card"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const flag=ok=>ok?'<span style="color:var(--good)">✓ today</span>':'<span class="hint">—</span>';
  const admitRows=(d.admits||[]).map(a=>`<tr><td><strong>${esc(a.name)}</strong>${a.room?' · '+esc(a.room):''}</td><td>${esc(a.admit)}${a.time?' <span class="hint">'+esc(a.time)+'</span>':''}</td><td class="hint">${esc(a.source)}</td><td>${a.active?'here':'<span class="hint">discharged</span>'}</td><td>${flag(a.isToday)}</td></tr>`).join('')||'<tr><td colspan="5" class="hint">No admits in the last few days.</td></tr>';
  const dischRows=(d.discharges||[]).map(a=>`<tr><td><strong>${esc(a.name)}</strong>${a.referredOut?' <span class="hint" style="color:#a60">↪ referred out / no intake</span>':''}</td><td>${esc(a.date)}</td><td class="hint">${esc(a.status)}</td><td class="hint">${esc(a.source)}</td><td>${flag(a.isToday)}</td></tr>`).join('')||'<tr><td colspan="5" class="hint">No discharges in the last few days.</td></tr>';
  const schedRows=(d.scheduled||[]).map(a=>`<tr><td><strong>${esc(a.name)}</strong></td><td>${esc(a.date)}</td><td class="hint">${esc(a.status)}</td><td>${flag(a.isToday)}</td></tr>`).join('')||'<tr><td colspan="4" class="hint">No scheduled arrivals in range.</td></tr>';
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3>Admit / Discharge check <span class="hint" style="font-weight:400">· detox</span></h3><p class="sub sans">Today is <strong>${esc(d.today)}</strong> (Eastern). These are the exact dates stored per patient — if an admit's date doesn't match the day they actually arrived, that's the glitch. Read-only.</p></div><button class="btn btn-ghost btn-sm sans" onclick="loadAdmitCheck()">Refresh</button></div>
    <div class="ret-cards">${box(f.census,'Patients here')}${box(f.scheduledToday,'Scheduled today')}${box(f.admittedToday,'Admitted today')}${box(f.dischargedToday,'Discharged today')}</div></div>
    <div class="card"><h3 style="margin-top:0">Admits — last 3 days</h3><table class="tbl"><tr><th>Patient</th><th>Stored admit date</th><th>Source</th><th>Status</th><th>Counts today?</th></tr>${admitRows}</table></div>
    <div class="card"><h3 style="margin-top:0">Discharges — last 3 days</h3><table class="tbl"><tr><th>Patient</th><th>Stored discharge date</th><th>Status</th><th>Source</th><th>Counts today?</th></tr>${dischRows}</table></div>
    <div class="card"><h3 style="margin-top:0">Scheduled arrivals</h3><table class="tbl"><tr><th>Name</th><th>Scheduled date</th><th>Status</th><th>Is today?</th></tr>${schedRows}</table></div>
    <div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🧾 Reconcile a window <span class="hint" style="font-weight:400">· app vs Salesforce, name by name</span></h3><p class="sub sans" style="margin:0">The exact admits the app counted, each flagged with why the two systems can disagree: readmissions (second casefile = second admit here, often one opportunity there), same-day discharges, duplicates, manual rows.</p></div></div>
      <div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:6px">
        <label class="hint">From <input type="date" id="rec_since" value="${today().slice(0,8)}01"/></label>
        <label class="hint">To <input type="date" id="rec_end" value="${today()}"/></label>
        <button class="btn btn-gold btn-sm sans" onclick="loadAdmitRecon()">Show the exact list</button></div>
      <div id="reconBody"></div></div>`;
}
async function loadAdmitRecon(){
  const host=$('reconBody'); if(!host) return;
  host.innerHTML='<div class="skel" style="height:60px;margin-top:8px"></div>';
  const since=($('rec_since')||{}).value||'', end=($('rec_end')||{}).value||'';
  let d; try{ d=await api('/diag/admits?since='+encodeURIComponent(since)+'&end='+encodeURIComponent(end)+facQ('&')); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const fpill=(f)=>`<span class="badge-${f==='readmit'?'warn':f==='same-day discharge'?'info':f.startsWith('duplicate')?'crit':'idle'}">${esc(f)}</span>`;
  const rows=(d.admits||[]).map(a=>`<tr><td><strong>${esc(a.name)}</strong>${a.referral?`<div class="hint">${esc(a.referral)}</div>`:''}</td><td>${esc(a.admit)}${a.time?' <span class="hint">'+esc(a.time)+'</span>':''}</td><td>${a.discharged?esc(a.discharged)+(a.status?' <span class="hint">'+esc(a.status)+'</span>':''):'<span class="badge-ok">still here</span>'}</td><td class="hint">${esc(a.source)}</td><td>${a.flags.map(fpill).join(' ')||''}</td></tr>`).join('');
  host.innerHTML=`<div class="ret-cards" style="margin-top:8px">
      ${box(d.total,'Admit rows (this list)')}${box(d.commandCenterCount,'Command Center counts')}${box(d.distinctPeople,'Distinct people',(d.distinctPeople<d.total?'rc-elev':''))}${box(d.readmits,'Readmissions',(d.readmits?'rc-warn':''))}${box(d.sameDay,'Same-day discharges')}${box(d.manual,'Manual rows')}</div>
    <div class="hint" style="margin:6px 0">Compare <strong>Distinct people</strong> to Salesforce — readmissions and duplicates are the usual gap. ${d.total-d.distinctPeople?`<strong>${d.total-d.distinctPeople}</strong> of the difference is people appearing more than once in this window.`:''}</div>
    <table class="tbl"><tr><th>Patient</th><th>Admit</th><th>Discharged</th><th>Source</th><th>Why counts differ</th></tr>${rows}</table>`;
}
/* ───────── AKRON OUTPATIENT (owner-only, separate Kipu location) ───────── */
let OP_DATA=null, OP_PERIOD=null;
function opDefaultPeriod(){ const e=today(); const d=new Date(e+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-6); return {since:d.toISOString().slice(0,10), end:e}; }
let OWN_PERIOD=null;
async function loadOwnership(){
  const host=$('ownership'); if(!host) return;
  if(!OWN_PERIOD) OWN_PERIOD={since:today().slice(0,8)+'01', end:today()};
  host.innerHTML='<div class="hint">Loading all locations…</div>';
  let d; try{ d=await api('/ownership?since='+encodeURIComponent(OWN_PERIOD.since)+'&end='+encodeURIComponent(OWN_PERIOD.end)); }catch(e){ host.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const t=d.totals||{};
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const facRow=(f)=>{
    if(f.pending) return `<tr style="opacity:.6"><td><strong>${esc(f.label)}</strong><div class="hint">${esc(f.brand)} · ${esc(f.type)}</div></td><td colspan="4" class="hint">⏳ ${esc(f.note||'pending')}</td></tr>`;
    const occ=(f.beds!=null)?`${f.census.total}/${f.beds}`:`${f.census.total}`;
    return `<tr><td><strong>${esc(f.label)}</strong><div class="hint">${esc(f.brand)} · ${esc(f.type)}${f.locationName?' · '+esc(f.locationName):''}</div></td><td><strong>${f.census.total}</strong></td><td>${f.admits}</td><td>${f.discharges}</td><td class="hint">${f.beds!=null?occ:'—'}</td></tr>`;
  };
  const armada=(d.facilities||[]).filter(f=>f.connection==='armada');
  const spark=(d.facilities||[]).filter(f=>f.connection==='spark');
  const tbl=(rows)=>`<table class="tbl"><tr><th>Facility</th><th>Census</th><th>Admits</th><th>Discharges</th><th>Occupancy</th></tr>${rows.map(facRow).join('')}</table>`;
  const mods=[['📊 Executive','ownership',''],['👥 HR OS','hcos','show(\'hcos\')'],['🗂️ Corporate Hub','corphub','show(\'corphub\')'],['🏥 Outpatient','outpatient','show(\'outpatient\')'],['🧲 Hiring','hiring','show(\'hiring\')'],['🏥 Facility (Detox)','command','show(\'command\')']];
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🏢 Corporate Command Center</h3><p class="sub sans" style="margin:0">The parent-company view — census, movement, people &amp; money across every facility. Owner &amp; corporate only.</p></div>
      <div class="toolbar" style="gap:6px;margin:0"><div class="itabs"><button class="itab" onclick="ownPreset('mtd')">MTD</button><button class="itab" onclick="ownPreset(7)">7d</button><button class="itab" onclick="ownPreset(30)">30d</button></div></div></div>
      <div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><label class="hint">From <input type="date" id="own_since" value="${esc(OWN_PERIOD.since)}" onchange="ownPeriodChange()"/></label><label class="hint">To <input type="date" id="own_end" value="${esc(OWN_PERIOD.end)}" onchange="ownPeriodChange()"/></label></div>
      <div class="ret-cards" style="margin-top:8px">${box(t.census||0,'Total census',(t.census?'rc-elev':''))}${box(t.admits||0,'Admits in window')}${box(t.discharges||0,'Discharges')}${box(t.facilities||0,'Live facilities')}</div>
      ${(d.byBrand||[]).length>1?`<div class="hint" style="margin-top:6px">${(d.byBrand||[]).map(b=>`<strong>${esc(b.brand)}</strong>: ${b.census} census · ${b.admits} admits · ${b.discharges} disch.`).join(' &nbsp;|&nbsp; ')}</div>`:''}</div>
    <div id="ownPortfolio"></div>
    <div class="corp-tabs" style="margin:2px 0 0">${mods.map(m=>`<button ${m[1]==='ownership'?'class="active"':''} onclick="${m[2]||'void(0)'}">${m[0]}</button>`).join('')}</div>
    <div class="card"><h3 style="margin-top:0">Armada — Kipu <span class="hint" style="font-weight:400">· live</span></h3>${tbl(armada)}</div>
    <div class="card"><h3 style="margin-top:0">Spark${d.sparkPending?' <span class="hint" style="font-weight:400;color:#a60">· connection pending</span>':''}</h3>${d.sparkPending?'<div class="pc-note" style="color:#a60;margin-bottom:6px">These come online the moment you give me the Spark Kipu credentials — the rows are already wired.</div>':''}${tbl(spark)}</div>
    ${ME.role==='admin'?`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">👥 Employees — by location</h3><p class="sub sans" style="margin:0">Everyone across every entity, with job title &amp; salary. Owner-only.</p></div></div><div id="ownHr"><div class="hint">Loading roster…</div></div></div>`:''}
    ${ME.role==='admin'?`<div class="card"><h3 style="margin-top:0">🏢 Facilities registry <span class="hint" style="font-weight:400">— canonical (BHOS spine)</span></h3><p class="sub sans" style="margin:0 0 6px">The official facility list every module keys on going forward. Holdings (CGSS/SZS/Propco) are corporate entities, not facilities.</p><div id="orgFacs"><div class="hint">Loading…</div></div></div>`:''}
    ${ME.role==='admin'?`<div class="card"><h3 style="margin-top:0">🔐 Permission matrix <span class="hint" style="font-weight:400">— live: a check here opens that module for the role, instantly</span></h3><p class="sub sans" style="margin:0 0 6px">Roles × modules. Corporate &amp; HR enforce from this matrix today; other modules light up as Phase 2 rolls on (clinical last). Every change is audited.</p><div id="orgPerms"><div class="hint">Loading…</div></div></div>`:''}
    ${ME.role==='admin'?`<div class="card" style="background:#faf6ee;border-left:4px solid var(--gold)"><h3 style="margin-top:0">⚙️ Kipu facility mapping <span class="hint" style="font-weight:400">— owner only (legacy; converges into the registry)</span></h3><p class="sub sans">If a facility shows no data, its Kipu location name here may not match Kipu. Use “List locations” in Akron Outpatient settings to see exact names, then fix them here.</p><div id="ownFacilities" class="hint">Loading…</div></div>`:''}`;
  if(ME.role==='admin'){ loadFacilityEditor(); loadHrRoster(); loadOrgFacs('orgFacs'); loadOrgPerms(); }
  loadPortfolio();
}
/* Portfolio — every building side by side, straight from the org registry
   (local data, no Kipu round-trips; complements the live-Kipu tables below). */
async function loadPortfolio(){
  const host=$('ownPortfolio'); if(!host) return;
  let d; try{ d=await api('/org/portfolio'); }catch(_e){ return; }   // leadership-only — hide quietly otherwise
  const TICON={'detox':'🏥','outpatient':'🧠','sober-living':'🏠'};
  const card=(f)=>`<div class="facpick-card" style="cursor:default">
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px">${TICON[f.type]||'🏢'}</span>
        <div><div style="font-weight:600">${esc(f.name)}</div><div class="hint">${esc(f.brand||'')}${f.region?' · '+esc(f.region):''}</div></div></div>
      <div style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap">
        <div><div style="font-size:20px;font-weight:700">${f.census}${f.capacity?`<span class="hint" style="font-size:12px">/${f.capacity}</span>`:''}</div><div class="hint">census${f.occupancy!=null?' · '+f.occupancy+'%':''}</div></div>
        <div><div style="font-size:20px;font-weight:700">${f.ins7}</div><div class="hint">in · 7d</div></div>
        <div><div style="font-size:20px;font-weight:700">${f.outs7}</div><div class="hint">out · 7d</div></div>
        ${f.incidents?`<div><div style="font-size:20px;font-weight:700;color:#b3382f">${f.incidents}</div><div class="hint">open incidents</div></div>`:''}
      </div>
      ${f.census===0&&f.ins7===0&&f.outs7===0?'<div class="hint" style="margin-top:6px">No data yet — honest empty until this building goes live.</div>':''}
    </div>`;
  host.innerHTML=`<div class="card"><h3 style="margin-top:0">🗺️ Portfolio — every building <span class="hint" style="font-weight:400">· last 7 days · local records</span></h3>
    <div class="toolbar no-print" style="justify-content:flex-start;margin:0 0 8px"><input id="ppl_q" placeholder="🧭 Find a person across all programs… (Enter)" style="min-width:260px" onkeydown="if(event.key==='Enter')pplSearch()"/><button class="btn btn-ghost btn-sm sans" onclick="pplSearch()">Search</button></div>
    <div id="pplOut"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">${(d.facilities||[]).map(card).join('')}</div>
    ${(d.byRegion||[]).length>1?`<div class="hint" style="margin-top:8px">${d.byRegion.map(r=>`<strong>${esc(r.region)}</strong>: ${r.census} census · ${r.ins7} in · ${r.outs7} out`).join(' &nbsp;|&nbsp; ')}</div>`:''}</div>
  <div id="ownContinuum"></div>`;
  loadStepdown();
}
/* Continuum — the step-down capture read: does the journey continue with us? */
let CONT_RANGE=90;
async function loadStepdown(){
  const host=$('ownContinuum'); if(!host) return;
  let d; try{ d=await api('/org/continuum?range='+CONT_RANGE); }catch(_e){ return; }
  const r=d.residential||{}, o=d.outpatient||{};
  const pctChip=(p)=>p==null?'<span class="hint">n/a</span>':`<strong style="font-size:22px;color:${p>=50?'#2f7a4f':p>=25?'#9a6a1f':'#b3382f'}">${p}%</strong>`;
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🔗 Continuum — does the journey continue?</h3>
      <p class="sub sans" style="margin:0">Of everyone discharged from detox/residential, who reached PHP/IOP or sober living <strong>with us</strong> within ${d.captureWindowDays} days. Powered by One Journey identity matching.</p></div>
      <div class="itabs">${[30,90,180,365].map(n=>`<button class="itab ${CONT_RANGE===n?'active':''}" onclick="CONT_RANGE=${n};loadStepdown()">${n}d</button>`).join('')}</div></div>
    <div class="ret-cards" style="margin-top:8px">
      <div class="ret-card"><div class="n">${r.discharges||0}</div><div class="l">Residential discharges</div></div>
      <div class="ret-card"><div class="n">${pctChip(r.capturePct)}</div><div class="l">Stepped down with us</div></div>
      <div class="ret-card"><div class="n">${r.toOutpatient||0}</div><div class="l">→ PHP/IOP</div></div>
      <div class="ret-card"><div class="n">${r.toHousing||0}</div><div class="l">→ Sober living</div></div>
      <div class="ret-card"><div class="n">${o.discharges||0} → ${o.toHousing||0}</div><div class="l">Outpatient → housing</div></div></div>
    ${(r.continued||[]).length?`<details style="margin-top:8px"><summary style="cursor:pointer"><strong>Continued with us</strong> <span class="hint">· ${r.toEither}</span></summary>${r.continued.map(x=>`<div class="pc-note">✓ ${esc(x.name)} <span class="hint">· discharged ${esc(x.dd)} → ${esc(x.to)}</span></div>`).join('')}</details>`:''}
    ${(r.lostSample||[]).length?`<details style="margin-top:4px"><summary style="cursor:pointer"><strong>Left the continuum</strong> <span class="hint">· sample of ${(r.discharges||0)-(r.toEither||0)}</span></summary>${r.lostSample.map(x=>`<div class="pc-note">○ ${esc(x.name)} <span class="hint">· ${esc(x.dd)}${x.status?' · '+esc(x.status):''}</span></div>`).join('')}<div class="hint" style="margin-top:4px">Every one of these is a warm-handoff opportunity for the aftercare call list.</div></details>`:''}
    ${!(r.discharges||o.discharges)?'<div class="hint" style="margin-top:6px">No discharges in this window yet — the read fills in as programs sync.</div>':''}</div>`;
}
async function pplSearch(){
  const q=($('ppl_q')||{}).value||'', out=$('pplOut'); if(!out) return;
  if(q.trim().length<2){ out.innerHTML=''; return; }
  out.innerHTML='<div class="hint">Searching…</div>';
  let d; try{ d=await api('/people/search?q='+encodeURIComponent(q)); }catch(e){ out.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  const ICON={residential:'🏥',outpatient:'🧠',housing:'🏠'};
  if(!(d.people||[]).length){ out.innerHTML='<div class="hint" style="margin-bottom:8px">No one found by that name in any program.</div>'; return; }
  out.innerHTML=d.people.map(j=>`<div class="pc-note" style="padding:8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px">
      <strong>${esc(j.person.name)}</strong>${j.person.dob?` <span class="hint">· DOB ${esc(j.person.dob)}</span>`:''}
      ${j.episodes.map(e=>`<div style="margin-top:3px">${ICON[e.world]||'•'} ${esc(e.start||'?')}${e.end?' → '+esc(e.end):(e.active?' → now':'')} · ${esc(e.facility)} <span class="hint">${esc(e.status)}</span>
        ${e.ref&&e.ref.kind==='client'?`<button class="btn btn-ghost btn-sm sans" style="padding:0 8px" onclick="openJourney(${e.ref.id})">open</button>`:''}
        ${e.ref&&e.ref.kind==='resident'&&typeof openResident==='function'?`<button class="btn btn-ghost btn-sm sans" style="padding:0 8px" onclick="openResident(${e.ref.id})">open</button>`:''}</div>`).join('')}
    </div>`).join('');
}
let HR_SHOW_SAL=false;
async function loadHrRoster(){
  const host=$('ownHr'); if(!host) return;
  let d; try{ d=await api('/hr/employees'); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  HR_DATA=d; renderHr();
}
let HR_DATA=null, HR_FILTER={location:'',position:'',search:'',groupBy:'location',sort:'name'};
function hrFilterChange(){ HR_FILTER={location:($('hrfLoc')||{}).value||'',position:($('hrfPos')||{}).value||'',search:(($('hrfSearch')||{}).value||'').toLowerCase(),groupBy:($('hrfGroup')||{}).value||'location',sort:($('hrfSort')||{}).value||'name'}; renderHr(true); }
function renderHr(keepControls){
  const host=$('ownHr'); if(!host||!HR_DATA) return;
  const money=(n)=>n==null?'':'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
  const all=[]; for(const g of (HR_DATA.groups||[])) for(const p of g.people) all.push({...p, entity:g.entity});
  const locations=[...new Set(all.map(p=>p.entity))].sort();
  const positions=[...new Set(all.map(p=>(p.job_title||'').trim()).filter(Boolean))].sort();
  const f=HR_FILTER;
  let rows=all.filter(p=>
    (!f.location||p.entity===f.location) &&
    (!f.position||(p.job_title||'')===f.position) &&
    (!f.search||((p.first_name+' '+p.last_name).toLowerCase().includes(f.search)||(p.job_title||'').toLowerCase().includes(f.search))));
  const salOf=(p)=>p.salary==null?null:(p.pay_type==='hourly'?p.salary*2080:p.salary);
  rows.sort((a,b)=> f.sort==='salary' ? ((salOf(b)||0)-(salOf(a)||0)) : f.sort==='position' ? (a.job_title||'~').localeCompare(b.job_title||'~') : ((a.last_name||'').localeCompare(b.last_name||'')));
  const rowHtml=(p,showLoc)=>`<tr>
      <td><strong>${esc((p.first_name||'')+' '+(p.last_name||''))}</strong>${showLoc?`<div class="hint">${esc(p.entity)}</div>`:''}</td>
      <td><input class="hrTitle" data-id="${p.id}" value="${esc(p.job_title||'')}" placeholder="job title" style="min-width:150px"/></td>
      <td><input class="hrSal" data-id="${p.id}" type="${HR_SHOW_SAL?'number':'password'}" value="${p.salary!=null?p.salary:''}" placeholder="salary" style="width:110px"/></td>
      <td><select class="hrPay" data-id="${p.id}"><option value="annual" ${p.pay_type!=='hourly'?'selected':''}>annual</option><option value="hourly" ${p.pay_type==='hourly'?'selected':''}>hourly</option></select></td>
      <td><button class="btn btn-ghost btn-sm sans" onclick="saveHr(${p.id})">Save</button></td></tr>`;
  const tableFor=(list,showLoc)=>`<table class="tbl" style="margin-top:4px"><tr><th>Name</th><th>Job title</th><th>Salary</th><th>Type</th><th></th></tr>${list.map(p=>rowHtml(p,showLoc)).join('')}</table>`;
  const groupSum=(list)=>{ const ann=list.reduce((a,p)=>a+(salOf(p)||0),0); const withSal=list.filter(p=>p.salary>0).length; return `${list.length} people${ann?' · payroll '+money(ann)+'/yr'+(withSal<list.length?' ('+withSal+'/'+list.length+' entered)':''):''}`; };
  let listHtml='';
  if(f.groupBy==='none'){ listHtml=tableFor(rows,true); }
  else{ const key=f.groupBy==='position'?(p=>p.job_title||'(no title)'):(p=>p.entity); const gm={}; for(const p of rows)(gm[key(p)]=gm[key(p)]||[]).push(p);
    listHtml=Object.keys(gm).sort().map(k=>`<details ${f.location||f.position||f.search?'open':''} style="margin:6px 0"><summary style="cursor:pointer"><strong>${esc(k)}</strong> <span class="hint">· ${groupSum(gm[k])}</span></summary>${tableFor(gm[k], f.groupBy==='position')}</details>`).join(''); }
  const filteredAnnual=rows.reduce((a,p)=>a+(salOf(p)||0),0);
  const opt=(v,cur)=>`<option value="${esc(v)}" ${v===cur?'selected':''}>${esc(v||'')}</option>`;
  host.innerHTML=`<div class="ret-cards" style="margin-top:4px">
      <div class="ret-card"><div class="n">${rows.length}${rows.length!==all.length?'<span class="hint" style="font-size:12px">/'+all.length+'</span>':''}</div><div class="l">Headcount${rows.length!==all.length?' (filtered)':''}</div></div>
      <div class="ret-card"><div class="n">${HR_SHOW_SAL?money(filteredAnnual):'•••'}</div><div class="l">Annual payroll</div></div>
      <div class="ret-card"><div class="n">${locations.length}</div><div class="l">Locations</div></div>
      <div class="ret-card"><div class="n">${positions.length}</div><div class="l">Distinct titles</div></div></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin:6px 0">
      <label class="hint">Location <select id="hrfLoc" onchange="hrFilterChange()"><option value="">All</option>${locations.map(l=>opt(l,f.location)).join('')}</select></label>
      <label class="hint">Position <select id="hrfPos" onchange="hrFilterChange()"><option value="">All</option>${positions.map(p=>opt(p,f.position)).join('')}</select></label>
      <input id="hrfSearch" placeholder="Search name or title (Enter)" value="${esc(f.search)}" onchange="hrFilterChange()" style="min-width:150px"/>
      <label class="hint">Group by <select id="hrfGroup" onchange="hrFilterChange()"><option value="location" ${f.groupBy==='location'?'selected':''}>Location</option><option value="position" ${f.groupBy==='position'?'selected':''}>Position</option><option value="none" ${f.groupBy==='none'?'selected':''}>None (flat)</option></select></label>
      <label class="hint">Sort <select id="hrfSort" onchange="hrFilterChange()"><option value="name" ${f.sort==='name'?'selected':''}>Name</option><option value="position" ${f.sort==='position'?'selected':''}>Position</option><option value="salary" ${f.sort==='salary'?'selected':''}>Salary</option></select></label>
      <button class="btn btn-ghost btn-sm sans" onclick="HR_SHOW_SAL=!HR_SHOW_SAL;renderHr()">${HR_SHOW_SAL?'🙈 Hide salaries':'👁 Show salaries'}</button>
      ${(f.location||f.position||f.search)?`<button class="btn btn-ghost btn-sm sans" onclick="HR_FILTER={location:'',position:'',search:'',groupBy:'${f.groupBy}',sort:'${f.sort}'};renderHr()">Clear</button>`:''}</div>
    ${rows.length?listHtml:'<div class="hint">No employees match these filters.</div>'}`;
}
async function saveHr(id){
  const b={ job_title:(document.querySelector('.hrTitle[data-id="'+id+'"]')||{}).value, salary:(document.querySelector('.hrSal[data-id="'+id+'"]')||{}).value, pay_type:(document.querySelector('.hrPay[data-id="'+id+'"]')||{}).value };
  try{ await api('/hr/employees/'+id,{method:'PATCH',body:JSON.stringify(b)}); loadHrRoster(); }catch(e){ alert(e.message); }
}
function ownPreset(p){ const e=today(); if(p==='mtd'){ OWN_PERIOD={since:e.slice(0,8)+'01',end:e}; } else { const d=new Date(e+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-(p-1)); OWN_PERIOD={since:d.toISOString().slice(0,10),end:e}; } loadOwnership(); }
function ownPeriodChange(){ OWN_PERIOD={since:($('own_since')||{}).value||OWN_PERIOD.since, end:($('own_end')||{}).value||OWN_PERIOD.end}; loadOwnership(); }
async function loadOrgFacs(hostId){
  // The registry renders on the Facilities page (orgFacs2) AND inside Ownership
  // (orgFacs) — one at a time, so the onboarding-form ids never duplicate.
  // Refreshes with no argument re-render wherever it was last opened.
  loadOrgFacs._host = hostId || loadOrgFacs._host || 'orgFacs';
  const host=$(loadOrgFacs._host); if(!host) return;
  const other=$(loadOrgFacs._host==='orgFacs2'?'orgFacs':'orgFacs2'); if(other) other.innerHTML='<div class="hint">Open…</div>';
  let d; try{ d=await api('/org/facilities'); }catch(e){ host.textContent=e.message; return; }
  const fs=d.facilities||[];
  host.innerHTML=`<table class="tbl"><tr><th>Facility</th><th>Brand</th><th>Region</th><th>Type</th><th>Beds</th><th>Kipu name</th><th></th></tr>${fs.map(f=>`<tr>
    <td><strong>${esc(f.name)}</strong><div class="hint">${esc(f.fkey)}</div></td>
    <td><input data-of="${f.id}" data-k="brand" value="${esc(f.brand||'')}" style="width:90px"/></td>
    <td><input data-of="${f.id}" data-k="region" value="${esc(f.region||'')}" style="width:80px"/></td>
    <td><input data-of="${f.id}" data-k="type" value="${esc(f.type||'')}" style="width:100px"/></td>
    <td><input data-of="${f.id}" data-k="beds" value="${f.beds!=null?f.beds:''}" style="width:60px"/></td>
    <td><input data-of="${f.id}" data-k="kipu_location_name" value="${esc(f.kipu_location_name||'')}" style="width:130px"/></td>
    <td class="toolbar" style="gap:4px"><button class="btn btn-ghost btn-sm sans" onclick="saveOrgFac(${f.id})">Save</button>
      <button class="btn btn-ghost btn-sm sans" title="Modules this facility gets" onclick="editFacModules(${f.id})">🧩</button>
      <button class="btn btn-ghost btn-sm sans" title="Kipu / integration connection" onclick="editFacIntegration(${f.id})">🔌</button>
      <button class="btn btn-ghost btn-sm sans" title="This building's settings: clock-in geofence, on-call, kiosk code, report emails" onclick="editFacSettings(${f.id})">⚙️</button></td></tr>`).join('')}</table>
  <div class="hint" style="margin-top:4px">Regions: Ohio · Indiana · Corporate. Every new module keys on this list (facility_id), so keep it accurate.</div>
  <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px">
    <strong class="sans" style="font-size:13px">＋ Onboard a facility</strong>
    <div class="hint" style="margin:2px 0 6px">A new facility goes live with configuration alone — it appears in every dropdown, dashboard, and rollup the moment you add it.</div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
      <input id="nf_name" placeholder="Facility name" style="min-width:220px"/>
      <input id="nf_brand" placeholder="Brand (Armada / Spark / …)" style="width:140px"/>
      <input id="nf_region" placeholder="State / region" style="width:110px"/>
      <select id="nf_type"><option value="detox">detox + residential</option><option value="outpatient">outpatient (PHP/IOP/OP)</option><option value="sober-living">sober living</option><option value="corporate">corporate</option></select>
      <input id="nf_beds" type="number" placeholder="Beds" style="width:70px"/>
      <input id="nf_kipu" placeholder="Kipu location name (optional)" style="width:170px"/>
      <select id="nf_tz"><option value="America/New_York">Eastern</option><option value="America/Chicago">Central</option></select>
      <button class="btn btn-gold btn-sm sans" onclick="addOrgFac()">Onboard facility</button><span class="hint" id="nf_msg"></span>
    </div>
  </div>`;
}
async function addOrgFac(){
  const g=id=>($(id)||{}).value||'';
  if(!g('nf_name').trim()){ if($('nf_msg'))$('nf_msg').textContent='Name the facility.'; return; }
  try{ const r=await api('/org/facilities',{method:'POST',body:JSON.stringify({name:g('nf_name'),brand:g('nf_brand'),region:g('nf_region'),type:g('nf_type'),beds:g('nf_beds'),kipu_location_name:g('nf_kipu'),timezone:g('nf_tz')})});
    if($('nf_msg'))$('nf_msg').textContent='✓ Onboarded — key: '+r.fkey; loadOrgFacs(); }
  catch(e){ if($('nf_msg'))$('nf_msg').textContent=e.message; }
}
// 🧩 Which modules a facility gets (defaults by service-line type; editable).
let MODCAT=null;
async function editFacModules(id){
  let d,cat; try{ [d,cat]=await Promise.all([api('/org/facilities'),api('/org/module-catalog')]); }catch(e){ alert(e.message); return; }
  MODCAT=cat; const f=(d.facilities||[]).find(x=>x.id===id); if(!f) return;
  const on=new Set(f.modules||[]);
  const save=hmodal(`<h3>🧩 ${esc(f.name)} — modules</h3>
    <p class="sub sans" style="margin:0 0 8px">Defaults come from the <strong>${esc(f.type)}</strong> service line. Turn modules on or off for this facility — the rest of the app follows.</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;max-height:340px;overflow:auto">${(cat.catalog||[]).map(m=>`<label style="display:flex;align-items:center;gap:5px;background:var(--cream);border:1px solid var(--line);border-radius:6px;padding:4px 8px;text-transform:none;letter-spacing:0"><input type="checkbox" class="fm" value="${esc(m)}" ${on.has(m)?'checked':''}/> ${esc(m)}</label>`).join('')}</div>
    <div class="toolbar" style="justify-content:flex-start;margin-top:8px;gap:6px"><button class="btn btn-ghost btn-sm sans" onclick="fmReset('${esc(f.type)}')">↺ Reset to ${esc(f.type)} defaults</button></div>`);
  save.onclick=async()=>{
    const mods=[...document.querySelectorAll('.fm:checked')].map(c=>c.value);
    try{ await api('/org/facilities/'+id,{method:'POST',body:JSON.stringify({modules:mods})}); closeHModal(); loadOrgFacs(); }catch(e){ alert(e.message); }
  };
}
function fmReset(type){ const def=new Set((MODCAT&&MODCAT.byType&&MODCAT.byType[type])||[]); document.querySelectorAll('.fm').forEach(c=>{ c.checked=def.has(c.value); }); }
// 🔌 Per-facility Kipu connection: enter its own credentials, Test, then sync.
async function editFacIntegration(id){
  let d,st; try{ [d,st]=await Promise.all([api('/org/facilities'),api('/org/facilities/'+id+'/integrations')]); }catch(e){ alert(e.message); return; }
  const f=(d.facilities||[]).find(x=>x.id===id); if(!f) return;
  const k=(st.integrations||{}).kipu||{};
  const save=hmodal(`<h3>🔌 ${esc(f.name)} — Kipu connection</h3>
    <p class="sub sans" style="margin:0 0 8px">${k.configured?'✓ A connection is saved. Leave a field blank to keep the stored secret.':'Enter this facility\'s OWN Kipu API credentials. Leave blank to use the shared credentials.'} Secrets are stored server-side and never shown again.</p>
    <label>Access ID</label><input id="ki_access" placeholder="${k.configured?'•••••• (saved)':'Kipu Access ID'}"/>
    <label>Secret Key</label><input id="ki_secret" type="password" placeholder="${k.configured?'•••••• (saved)':'Kipu Secret Key'}"/>
    <label>App ID (recipient/location id)</label><input id="ki_app" placeholder="${k.configured?'•••••• (saved)':'Kipu App ID'}"/>
    <label>Base URL <span class="hint">(optional)</span></label><input id="ki_base" value="${esc(k.baseUrl||'')}" placeholder="https://api.kipuapi.com"/>
    <label>Location ID <span class="hint">(scopes the census to this site)</span></label><input id="ki_loc" value="${esc(k.locationId||'')}" placeholder="e.g. 12345"/>
    <label style="display:flex;align-items:center;gap:6px;margin-top:8px;text-transform:none;letter-spacing:0"><input type="checkbox" id="ki_auto" ${k.autoSync?'checked':''}/> Auto-sync this facility's roster on the schedule <span class="hint">(turn on only AFTER a manual ▶ sync looked right)</span></label>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;margin-top:8px"><button class="btn btn-ghost btn-sm sans" onclick="testFacKipu(${id})">Test connection</button><button class="btn btn-ghost btn-sm sans" onclick="syncFacKipu(${id})" title="Pull this facility's roster now (manual, stamps this facility)">▶ Sync roster now</button><span class="hint" id="ki_msg"></span></div>`);
  save.textContent='Save connection';
  save.onclick=async()=>{
    const g=x=>($(x)||{}).value||'';
    try{ await api('/org/facilities/'+id+'/integrations',{method:'POST',body:JSON.stringify({kind:'kipu',accessId:g('ki_access'),secretKey:g('ki_secret'),appId:g('ki_app'),baseUrl:g('ki_base'),locationId:g('ki_loc'),autoSync:!!($('ki_auto')||{}).checked})}); if($('ki_msg'))$('ki_msg').textContent='✓ Saved'; }
    catch(e){ if($('ki_msg'))$('ki_msg').textContent=e.message; }
  };
}
async function testFacKipu(id){ const m=$('ki_msg'); if(m)m.textContent='Testing…'; try{ const r=await api('/org/facilities/'+id+'/kipu-test',{method:'POST'}); if(m)m.textContent=`✓ Connected${r.own?' (own credentials)':' (shared credentials)'} — ${r.sampleCount==null?'reachable':r.sampleCount+' on census'}`; }catch(e){ if(m)m.textContent='✗ '+e.message; } }
async function syncFacKipu(id){ const m=$('ki_msg'); if(!confirm('Pull this facility\'s Kipu roster now? New patients will be stamped to THIS facility.'))return; if(m)m.textContent='Syncing…'; try{ const r=await api('/org/facilities/'+id+'/kipu-sync',{method:'POST'}); if(m)m.textContent='✓ Synced: '+JSON.stringify(r.result||{}).slice(0,80); loadOrgFacs(); }catch(e){ if(m)m.textContent='✗ '+e.message; } }
async function saveOrgFac(id){
  const b={}; document.querySelectorAll(`[data-of="${id}"]`).forEach(el=>{ b[el.dataset.k]=el.value; });
  try{ await api('/org/facilities/'+id,{method:'POST',body:JSON.stringify(b)}); loadOrgFacs(); }catch(e){ alert(e.message); }
}
// ⚙️ Per-facility operations settings: each building runs on its own numbers.
async function editFacSettings(id){
  let d,st; try{ [d,st]=await Promise.all([api('/org/facilities'),api('/org/facilities/'+id+'/settings')]); }catch(e){ alert(e.message); return; }
  const f=(d.facilities||[]).find(x=>x.id===id); if(!f) return;
  const s=st.settings||{};
  const save=hmodal(`<h3>⚙️ ${esc(f.name)} — building settings</h3>
    <p class="sub sans" style="margin:0 0 8px">Everything here applies to THIS building only. Blank = fall back to the company-wide setting.</p>
    <strong class="sans" style="font-size:12px">Clock-in geofence</strong>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;margin:4px 0 8px">
      <input id="fs_lat" value="${esc(s.geo_lat||'')}" placeholder="Latitude" style="width:110px"/>
      <input id="fs_lon" value="${esc(s.geo_lon||'')}" placeholder="Longitude" style="width:110px"/>
      <input id="fs_radius" value="${esc(s.geo_radius||'')}" placeholder="Radius (m)" style="width:90px"/>
      <button class="btn btn-ghost btn-sm sans" onclick="fsUseHere()" title="Use this device's current location">📍 Use my location</button>
    </div>
    <strong class="sans" style="font-size:12px">On-call</strong>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;margin:4px 0 8px">
      <input id="fs_phone" value="${esc(s.oncall_phone||'')}" placeholder="On-call phone" style="width:150px"/>
      <input id="fs_oncall" value="${esc(s.oncall_email||'')}" placeholder="On-call email" style="min-width:200px"/>
    </div>
    <strong class="sans" style="font-size:12px">Kiosk</strong>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;margin:4px 0 8px">
      <input id="fs_kiosk" value="${esc(s.kiosk_code||'')}" placeholder="This building's kiosk code" style="width:200px"/>
      <span class="hint">A kiosk signed in with this code lists only this building's clients.</span>
    </div>
    <strong class="sans" style="font-size:12px">Report recipients</strong>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;margin:4px 0 2px">
      <input id="fs_billing" value="${esc(s.billing_email||'')}" placeholder="Billing-readiness email(s)" style="min-width:220px"/>
      <input id="fs_report" value="${esc(s.report_email||'')}" placeholder="Daily report email(s)" style="min-width:220px"/>
    </div>`);
  save.textContent='Save settings';
  save.onclick=async()=>{
    const g=x=>($(x)||{}).value||'';
    try{
      await api('/org/facilities/'+id+'/settings',{method:'POST',body:JSON.stringify({
        geo_lat:g('fs_lat').trim(), geo_lon:g('fs_lon').trim(), geo_radius:g('fs_radius').trim(),
        oncall_phone:g('fs_phone').trim(), oncall_email:g('fs_oncall').trim(),
        kiosk_code:g('fs_kiosk').trim(), billing_email:g('fs_billing').trim(), report_email:g('fs_report').trim(),
      })});
      closeHModal();
    }catch(e){ alert(e.message); }
  };
}
function fsUseHere(){
  if(!navigator.geolocation){ alert('This device cannot share its location.'); return; }
  navigator.geolocation.getCurrentPosition(p=>{
    if($('fs_lat'))$('fs_lat').value=p.coords.latitude.toFixed(6);
    if($('fs_lon'))$('fs_lon').value=p.coords.longitude.toFixed(6);
    if($('fs_radius')&&!$('fs_radius').value)$('fs_radius').value='300';
  },()=>alert('Could not read this device\'s location — enter the coordinates by hand.'),{enableHighAccuracy:true,timeout:8000});
}
// ── Permission matrix editor: roles × modules; a check GRANTS the module live ──
let PERM_DATA=null;
async function loadOrgPerms(){
  const host=$('orgPerms'); if(!host) return;
  let d; try{ d=await api('/org/permissions'); }catch(e){ host.textContent=e.message; return; }
  PERM_DATA=d;
  const has=(role,mod)=> (d.permissions||[]).some(p=>p.role===role&&p.module===mod&&p.action==='view'&&p.allowed);
  const MOD_LABEL={corporate:'Corp Hub',facility_ops:'Facility',admissions:'Admissions',census:'Census',clinical:'Clinical',casemgmt:'Case Mgmt',peer:'Peer',ur:'UR/Auth',billing:'Billing',hr:'HR',finance:'Finance',bd:'BizDev',compliance:'Compliance',scheduling:'Schedule',documents:'Docs',tasks:'Tasks',reports:'Reports',admin:'Admin'};
  const roles=(d.roles||[]).filter(r=>r!=='admin');
  host.innerHTML=`<div style="overflow-x:auto"><table class="tbl nomcard" style="min-width:900px"><tr><th style="position:sticky;left:0;background:var(--paper)">Role</th>${d.modules.map(m=>`<th style="font-size:10px">${esc(MOD_LABEL[m]||m)}</th>`).join('')}</tr>
    ${roles.map(r=>`<tr><td style="position:sticky;left:0;background:var(--paper)"><strong style="font-size:12px">${esc(r)}</strong></td>${d.modules.map(m=>`<td style="text-align:center"><input type="checkbox" ${has(r,m)?'checked':''} onchange="setPerm('${r.replace(/'/g,"\\'")}','${m}',this.checked)"/></td>`).join('')}</tr>`).join('')}</table></div>
  <div class="hint" style="margin-top:4px">The owner (admin) always has everything. Enforced today: <strong>Corp Hub</strong> (incl. Executive view), <strong>HR</strong>, <strong>UR/Auth</strong>, <strong>Billing</strong>, <strong>Finance</strong> (read), <strong>Reports</strong> (team stats). Clinical switches last, per the rebuild order.</div>`;
}
async function setPerm(role,module,allowed){
  try{ await api('/org/permissions',{method:'POST',body:JSON.stringify({role,module,allowed})}); }catch(e){ alert(e.message); loadOrgPerms(); }
}

/* ── AUTHORIZATION REGISTER — the first Operational Intelligence screen ─────────
   Every card: INFORMATION (the auth) · INTELLIGENCE (grounded facts only) ·
   ACTION (renew / deny / close / open the chart). Constitution, Article V. */
let AUTH_DATA=null, AUTH_SHOWFORM=false;
async function loadAuthReg(){
  const host=$('authreg'); if(!host) return;
  host.innerHTML='<div class="card"><div class="skel" style="width:260px;height:22px;margin-bottom:14px"></div><div class="skel" style="height:70px;margin-bottom:8px"></div><div class="skel" style="height:70px"></div></div>';
  let d; try{ d=await api('/auth-register'); }catch(e){ host.innerHTML='<div class="card"><div class="empty"><div class="e-ico">⚠️</div>'+esc(e.message)+'</div></div>'; return; }
  AUTH_DATA=d;
  const flagBadge=(a)=>a.flag==='expired'?'<span class="badge-crit">expired</span>':a.flag==='expiring'?`<span class="badge-warn">${a.daysLeft===0?'today':a.daysLeft+'d left'}</span>`:a.flag==='done'?`<span class="badge-idle">${esc(a.status)}</span>`:(a.daysLeft!=null?`<span class="badge-ok">${a.daysLeft}d left</span>`:'<span class="badge-idle">no end date</span>');
  const card=(a)=>`<div class="card" style="${a.flag==='expired'?'border-left:4px solid var(--crit)':a.flag==='expiring'?'border-left:4px solid var(--warn)':''}">
    <div class="cmd-hero-row"><div><h3 style="margin:0">${esc(a.patient_label||'—')} ${flagBadge(a)} <span class="hint" style="font-weight:400">· ${esc(a.payor||'payor tbd')}${a.level_of_care?' · '+esc(a.level_of_care):''}</span></h3></div>
      ${a.client_id?`<button class="btn btn-ghost btn-sm sans" onclick="openJourney(${a.client_id})">📂 View patient</button>`:''}</div>
    <div class="hint" style="margin-top:4px">${a.auth_number?'Auth #'+esc(a.auth_number)+' · ':''}${a.approved_days?a.approved_days+' approved days · ':''}${a.start_date?esc(a.start_date)+' → ':''}${a.end_date?esc(a.end_date):'open-ended'}${a.reviewer?' · reviewer: '+esc(a.reviewer):''}${a.facility_name?' · '+esc(a.facility_name):''}${a.notes?'<div>'+esc(a.notes)+'</div>':''}</div>
    ${a.intel&&a.intel.length?`<div class="oi-intel"><div class="oi-tag">Armada intelligence</div>${a.intel.map(i=>`<div style="font-size:13px;margin-top:3px">${esc(i)}</div>`).join('')}</div>`:''}
    ${a.flag!=='done'?`<div class="oi-action">
      <button class="btn btn-gold btn-sm sans" onclick="authRenew(${a.id})">↻ Renew…</button>
      <button class="btn btn-ghost btn-sm sans" onclick="authSet(${a.id},'denied')">Denied</button>
      <button class="btn btn-ghost btn-sm sans" onclick="authSet(${a.id},'closed')">Close</button>
      ${ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" onclick="authDel(${a.id})">🗑</button>`:''}
    </div>`:''}</div>`;
  const open=(d.auths||[]).filter(a=>a.flag!=='done'), done=(d.auths||[]).filter(a=>a.flag==='done');
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🛡 Authorization Register</h3><p class="sub sans" style="margin:0">Every payor authorization: what's approved, what's expiring, what to do about it — nothing lapses unseen. Automated watch emails at 7/3/1/0 days and on expiry.</p></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${d.kipu?`<button class="btn btn-ghost btn-sm sans" onclick="authKipuSync(this)" title="Import authorizations from Kipu UR records for every active client">⟳ Pull from Kipu</button>`:''}
      <button class="btn btn-ghost btn-sm sans" onclick="authRunReminders(this)" title="Run the renewal watch now">✉️ Run watch now</button>
      <button class="btn btn-gold btn-sm sans" onclick="AUTH_SHOWFORM=!AUTH_SHOWFORM;renderAuthForm()">＋ Add authorization</button></div></div>
    <div id="authMsg"></div>
    ${ME.role==='admin'?`<div class="toolbar" style="justify-content:flex-start;gap:6px;margin-top:6px"><label class="hint">UR watch emails go to <input id="authEmailSet" value="${esc(d.authEmail||'')}" placeholder="defaults to insurance list" style="min-width:230px"/></label><button class="btn btn-ghost btn-sm sans" onclick="authSaveEmail()">Save</button></div>`:''}
    <div id="authForm"></div></div>
    ${open.length?open.map(card).join(''):'<div class="card"><div class="empty"><div class="e-ico">🛡</div>No open authorizations tracked yet.<div class="e-act"><button class="btn btn-gold btn-sm sans" onclick="AUTH_SHOWFORM=true;renderAuthForm()">Add the first one</button></div></div></div>'}
    ${done.length?`<div class="card"><details><summary style="cursor:pointer"><strong>History</strong> <span class="hint">· ${done.length} closed/denied</span></summary>${done.map(card).join('')}</details></div>`:''}`;
  renderAuthForm();
}
function renderAuthForm(){
  const host=$('authForm'); if(!host) return;
  if(!AUTH_SHOWFORM){ host.innerHTML=''; return; }
  const d=AUTH_DATA||{levels:[],facilities:[]};
  host.innerHTML=`<div class="pc-note" style="margin-top:8px"><div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
    <input id="au_label" placeholder="Patient initials (e.g. JD)" style="width:150px"/>
    <input id="au_payor" placeholder="Payor / insurance" style="width:150px"/>
    <input id="au_num" placeholder="Auth #" style="width:110px"/>
    <select id="au_loc"><option value="">Level…</option>${(d.levels||[]).map(l=>`<option>${l}</option>`).join('')}</select>
    <select id="au_fac"><option value="">Facility…</option>${(d.facilities||[]).map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>
    <input id="au_days" type="number" placeholder="Days" style="width:70px"/>
    <label class="hint">Start <input id="au_start" type="date"/></label>
    <label class="hint">Expires <input id="au_end" type="date"/></label>
    <input id="au_reviewer" placeholder="Reviewer" style="width:120px"/>
    <input id="au_notes" placeholder="Notes" style="min-width:170px"/>
    <button class="btn btn-gold btn-sm sans" onclick="authAdd()">Save</button></div>
    <div class="hint" style="margin-top:4px">Initials only — the register is visible to corporate-scope leadership. Link the full chart later from the patient's page if needed.</div></div>`;
}
async function authAdd(){
  const v=(id)=>($(id)||{}).value||'';
  const b={patient_label:v('au_label'),payor:v('au_payor'),auth_number:v('au_num'),level_of_care:v('au_loc'),facility_id:v('au_fac')||null,approved_days:v('au_days'),start_date:v('au_start'),end_date:v('au_end'),reviewer:v('au_reviewer'),notes:v('au_notes')};
  if(!b.patient_label.trim()) return alert('Patient initials required.');
  try{ await api('/auth-register',{method:'POST',body:JSON.stringify(b)}); AUTH_SHOWFORM=false; loadAuthReg(); }catch(e){ alert(e.message); }
}
async function authRenew(id){
  const days=prompt('Renew for how many days?','7'); if(!days||!+days) return;
  try{ await api('/auth-register/'+id,{method:'PATCH',body:JSON.stringify({renew_days:+days})}); loadAuthReg(); }catch(e){ alert(e.message); }
}
async function authSet(id,status){
  if(status!=='closed'&&!confirm('Mark this authorization '+status+'?')) return;
  try{ await api('/auth-register/'+id,{method:'PATCH',body:JSON.stringify({status})}); loadAuthReg(); }catch(e){ alert(e.message); }
}
async function authDel(id){
  if(!confirm('Delete this authorization row entirely? (Closing is usually right.)')) return;
  try{ await api('/auth-register/'+id,{method:'DELETE'}); loadAuthReg(); }catch(e){ alert(e.message); }
}
/* ── MY DESK v2 — a workflow, not a list. Capture pinned on top; five lenses:
   Focus (work this NOW) · Board (inbox→scheduled→waiting→done) · Buckets ·
   Locations · People (the follow-up machine). ADHD rules: urgency always wins,
   one primary action per card, the system does the remembering. ── */
let DESK_DATA=null, DESK_TAB='focus';
function deskLane(x){ return x.status==='done'?'done':x.status==='waiting'?'waiting':x.due_date?'sched':'inbox'; }
async function loadMyDesk(){
  const host=$('mydesk'); if(!host) return;
  if(!DESK_DATA) host.innerHTML='<div class="card"><div class="skel" style="width:240px;height:22px;margin-bottom:14px"></div><div class="skel-tiles">'+'<div class="skel"></div>'.repeat(4)+'</div></div>';
  let d; try{ d=await api('/desk'); }catch(e){ host.innerHTML='<div class="card"><div class="empty"><div class="e-ico">⚠️</div>'+esc(e.message)+'</div></div>'; return; }
  DESK_DATA=d;
  const items=(d.items||[]);
  const today=d.today;
  const live=items.filter(x=>x.status!=='done'&&(!x.snooze_until||x.snooze_until<=today));
  const n={ overdue:live.filter(x=>x.overdue).length, today:live.filter(x=>x.due_date===today).length,
    waiting:live.filter(x=>x.status==='waiting').length, inbox:live.filter(x=>deskLane(x)==='inbox').length,
    done7:items.filter(x=>x.status==='done').length };
  const stat=(nn,l,tab,sev)=>`<div class="ret-card ${sev||''}" style="cursor:pointer" onclick="DESK_TAB='${tab}';renderDeskTab()"><div class="n">${nn}</div><div class="l">${l}</div></div>`;
  const tabs=[['focus','🎯 Focus'],['board','📋 Board'],['mail','📧 Mail'],['asks','📤 Follow-ups'],['buckets','🗂 Buckets'],['places','📍 Locations'],['people','👥 People'],['setup','⚙️']];
  host.innerHTML=`<div class="card">
    <div class="cmd-hero-row"><div><h3 style="margin:0">My Desk</h3><p class="sub sans" style="margin:0">Say it like a text — dates, people &amp; buckets file themselves.</p></div>
      <button class="btn btn-ghost btn-sm sans" onclick="deskDigestNow(this)">☀️ Digest now</button></div>
    <div class="toolbar" style="gap:8px;margin-top:10px"><input id="deskCap" placeholder="What do you need to remember?" style="flex:1;min-width:200px;font-size:16px;padding:12px" onkeydown="if(event.key==='Enter')deskAdd()"/><button class="btn btn-gold sans" onclick="deskAdd()">Save</button></div>
    <div class="ret-cards" style="margin-top:10px">${stat(n.overdue,'Overdue','focus',n.overdue?'rc-high':'')}${stat(n.today,'Today','focus')}${stat(n.waiting,'Waiting on people','people',n.waiting?'rc-warn':'')}${stat(n.inbox,'Inbox — unsorted','board',n.inbox>5?'rc-elev':'')}${stat(n.done7,'Done (14d)','board')}</div>
    <div class="corp-tabs" style="margin-top:10px" id="deskTabs">${tabs.map(([k,l])=>`<button class="${DESK_TAB===k?'active':''}" onclick="DESK_TAB='${k}';renderDeskTab()">${l}</button>`).join('')}</div>
    <div id="deskBody"></div></div>`;
  renderDeskTab();
  const cap=$('deskCap'); if(cap&&DESK_TAB==='focus') cap.focus();
}
function renderDeskTab(){
  const b=$('deskBody'); if(!b||!DESK_DATA) return;
  document.querySelectorAll('#deskTabs button').forEach(x=>x.classList.toggle('active',x.getAttribute('onclick').includes("'"+DESK_TAB+"'")));
  if(DESK_TAB==='focus') return deskFocus(b);
  if(DESK_TAB==='board') return deskBoard(b);
  if(DESK_TAB==='mail') return deskMail(b);
  if(DESK_TAB==='asks') return deskAsks(b);
  if(DESK_TAB==='buckets') return deskGrouped(b,'bucket','🏷','Unfiled — tap 🏷 to file');
  if(DESK_TAB==='places') return deskGrouped(b,'facility_name','📍','No location');
  if(DESK_TAB==='people') return deskPeople(b);
  if(DESK_TAB==='setup') return deskSetup(b);
}
function deskDaysAgo(ts){ if(!ts) return null; const nn=Math.round((Date.now()-Date.parse(String(ts).replace(' ','T')+'Z'))/864e5); return nn<=0?'today':nn+'d'; }
// One card recipe everywhere: title big, tags small, ONE gold action for its lane.
function deskCard(x,primary){
  const tag=(t)=>t?`<span class="badge-idle" style="margin-right:4px">${t}</span>`:'';
  const lane=deskLane(x);
  const gold = primary!==undefined?primary
    : lane==='waiting'?`<button class="btn btn-gold btn-sm sans" onclick="deskNudge(${x.id})">📣 Nudge</button>`
    : `<button class="btn btn-gold btn-sm sans" onclick="deskDo(${x.id},{status:'done'})">✓ Done</button>`;
  // STACKED layout — title gets the full width, actions live UNDERNEATH. Never
  // let buttons share a row with text inside a narrow kanban column.
  return `<div class="q-row ${x.overdue?'q-overdue':''}" style="cursor:default;display:block" draggable="true" ondragstart="deskDragStart(event,${x.id})" ondragend="this.classList.remove('dragging')">
    <div class="q-title" style="font-size:14.5px;line-height:1.35">${esc(x.title)}</div>
    <div class="q-sub" style="margin-top:3px;line-height:2">${x.due_date?tag('🗓 '+esc(x.due_date)+(x.due_time?' '+esc(x.due_time):'')):''}${x.with_who?tag('👤 '+esc(x.with_who)+(x.nudged_at?' · nudged '+deskDaysAgo(x.nudged_at):'')):''}${x.bucket?tag('🏷 '+esc(x.bucket)):''}${x.facility_name?tag('📍'+esc(x.facility_name)):''}${(!x.with_who&&x.suggested_role)?`<span class="badge-info" style="margin-right:4px;cursor:pointer" title="AI suggests this role — tap to pick the person" onclick="deskAssignRole(${x.id},'${esc(x.suggested_role).replace(/'/g,"\\'")}')">🎯 ${esc(x.suggested_role)} →</span>`:''}${x.source!=='app'?tag('📱'):''}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${x.status!=='done'?`${gold}
      <button class="btn btn-ghost btn-sm sans" title="AI drafts the email that gets this done — you edit, then send" onclick="deskEmail(${x.id},this)">✉️ Email</button>
      <button class="btn btn-ghost btn-sm sans" title="More" onclick="deskMore(${x.id},this)">⋯</button>`
      :`<button class="btn btn-ghost btn-sm sans" onclick="deskDo(${x.id},{status:'open'})">↩︎</button>`}</div></div>`;
}
function deskMore(id,btn){
  const host=btn.closest('.q-row');
  const bar=document.createElement('div');
  bar.className='toolbar'; bar.style.cssText='justify-content:flex-start;gap:4px;flex-wrap:wrap;width:100%;margin-top:6px';
  bar.innerHTML=`<button class="btn btn-ghost btn-sm sans" onclick="deskDo(${id},{status:'done'})">✓ Done</button>
    <button class="btn btn-ghost btn-sm sans" onclick="deskDo(${id},{snooze_days:1})">😴 Tomorrow</button>
    <button class="btn btn-ghost btn-sm sans" onclick="deskDo(${id},{snooze_days:7})">😴 Next week</button>
    <button class="btn btn-ghost btn-sm sans" onclick="deskDate(${id})">🗓 Date</button>
    <button class="btn btn-ghost btn-sm sans" onclick="deskWho(${id})">👤 Person</button>
    <button class="btn btn-ghost btn-sm sans" onclick="deskBucket(${id})">🏷 File</button>
    <button class="btn btn-ghost btn-sm sans" onclick="deskDo(${id},{reclassify:true})">✨ Re-file (AI)</button>
    <button class="btn btn-ghost btn-sm sans" onclick="deskDel(${id})">🗑</button>`;
  btn.disabled=true; host.appendChild(bar);
}
function deskFocus(b){
  const d=DESK_DATA, today=d.today;
  const live=(d.items||[]).filter(x=>x.status!=='done'&&(!x.snooze_until||x.snooze_until<=today));
  const overdue=live.filter(x=>x.overdue);
  const todays=live.filter(x=>x.due_date===today);
  const soon=live.filter(x=>x.due_date&&x.due_date>today&&x.due_date<=addDaysStr(today,2));
  const renudge=live.filter(x=>x.status==='waiting'&&(!x.nudged_at||(Date.now()-Date.parse(String(x.nudged_at).replace(' ','T')+'Z'))/864e5>=3));
  const sec=(ico,label,list,hint)=>list.length?`<h3 style="margin:14px 0 4px">${ico} ${label} <span class="hint" style="font-weight:400">· ${hint}</span></h3>${list.map(x=>deskCard(x)).join('')}`:'';
  b.innerHTML=`${sec('🔥','Overdue',overdue,'these first — or snooze them honestly')}
    ${sec('📅','Today',todays,'the day\'s promises')}
    ${sec('⏰','Next 48 hours',soon,'coming at you')}
    ${sec('📣','Time to re-nudge',renudge,'waiting 3+ days — push or let go')}
    ${(!overdue.length&&!todays.length&&!soon.length&&!renudge.length)?'<div class="empty"><div class="e-ico">🌤</div>Nothing urgent. The Board holds the rest —<br>or capture the next thing on your mind.</div>':''}`;
}
function addDaysStr(dateStr,nn){ const dt=new Date(dateStr+'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate()+nn); return dt.toISOString().slice(0,10); }
/* ---- Trello-style strip: columns side by side, swipe/snap column to column,
   each column scrolls inside itself, cards drag between columns (desktop). ---- */
function deskStrip(b,kind,cols){
  const nav=cols.map((c,i)=>`<button class="btn btn-ghost btn-sm sans" onclick="deskGoCol(${i})">${c.nav||c.label}${c.list.length?` <span class="hint">${c.list.length}</span>`:''}</button>`).join('');
  b.innerHTML=`<div class="trello-nav no-print">${nav}</div>
    <div class="trello">${cols.map((c,i)=>`
      <div class="trello-col" id="tcol-${i}" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="deskDrop(event,'${kind}','${encodeURIComponent(c.key)}')">
        <div class="trello-head"><h3 style="margin:0;font-size:15px">${c.label} <span class="hint" style="font-weight:400">${c.list.length}</span>${c.od?` <span class="badge-crit">${c.od} overdue</span>`:''}</h3>${c.hint?`<div class="hint">${c.hint}</div>`:''}${c.head||''}</div>
        <div class="trello-body">${c.list.length?c.list.map(x=>deskCard(x,c.primary?c.primary(x):undefined)).join(''):'<div class="hint" style="padding:12px 2px">empty — drag a card here</div>'}</div>
      </div>`).join('')}</div>`;
}
function deskGoCol(i){ const el=$('tcol-'+i); if(el) el.scrollIntoView({behavior:'smooth',inline:'start',block:'nearest'}); }
function deskDragStart(e,id){ e.dataTransfer.setData('text/plain',String(id)); e.dataTransfer.effectAllowed='move'; e.target.classList.add('dragging'); }
async function deskDrop(e,kind,rawKey){
  e.preventDefault(); e.currentTarget.classList.remove('dragover');
  const id=+e.dataTransfer.getData('text/plain'); if(!id) return;
  const key=decodeURIComponent(rawKey);
  const item=((DESK_DATA||{}).items||[]).find(x=>x.id===id)||{};
  if(kind==='lane'){
    if(key==='done') return deskDo(id,{status:'done'});
    if(key==='inbox') return deskDo(id,{status:'open',due_date:'',with_who:''});
    if(key==='sched') return (item.due_date&&item.status!=='open')?deskDo(id,{status:'open'}):deskDate(id);
    if(key==='waiting') return item.with_who?deskDo(id,{status:'waiting'}):deskWho(id);
  }
  if(kind==='bucket') return deskDo(id,{bucket:key});
  if(kind==='place'){ const f=((DESK_DATA||{}).facilities||[]).find(x=>x.name===key); return deskDo(id,{facility_id:f?f.id:''}); }
  if(kind==='person'&&key&&key!=='(unassigned)') return deskDo(id,{with_who:key});
}
function deskBoard(b){
  const items=(DESK_DATA.items||[]);
  deskStrip(b,'lane',[
    {key:'inbox',label:'📥 Inbox',nav:'📥 Inbox',hint:'no date, no owner — give it one, or drag it',list:items.filter(x=>deskLane(x)==='inbox'),od:items.filter(x=>deskLane(x)==='inbox'&&x.overdue).length,primary:(x)=>`<button class="btn btn-gold btn-sm sans" onclick="deskDate(${x.id})">🗓 Schedule</button>`},
    {key:'sched',label:'🗓 Scheduled',nav:'🗓 Scheduled',hint:'has its date — surfaces in Focus when due',list:items.filter(x=>deskLane(x)==='sched'),od:items.filter(x=>deskLane(x)==='sched'&&x.overdue).length},
    {key:'waiting',label:'⏳ Waiting on',nav:'⏳ Waiting',hint:'someone owes you — 📣 nudge or ✉️ email',list:items.filter(x=>deskLane(x)==='waiting'),od:items.filter(x=>deskLane(x)==='waiting'&&x.overdue).length},
    {key:'done',label:'✅ Done',nav:'✅ Done',hint:'last 14 days — drag one back out to reopen',list:items.filter(x=>x.status==='done')},
  ]);
}
function deskGrouped(b,key,ico,unfiledLabel){
  const live=(DESK_DATA.items||[]).filter(x=>x.status!=='done');
  const groups={};
  for(const x of live){ const g=x[key]||''; (groups[g]=groups[g]||[]).push(x); }
  const byDue=(a,bb)=>String(a.due_date||'9999').localeCompare(String(bb.due_date||'9999'));
  // Every category is a column — even empty ones — so there's always somewhere to drag a card TO.
  const all=key==='bucket'?(DESK_DATA.buckets||[]):((DESK_DATA.facilities||[]).map(f=>f.name));
  const withItems=Object.keys(groups).filter(Boolean).sort();
  const names=[...withItems, ...all.filter(g=>!withItems.includes(g))];
  const cols=names.map(g=>({key:g,label:ico+' '+esc(g),nav:esc(g),list:(groups[g]||[]).sort(byDue),od:(groups[g]||[]).filter(x=>x.overdue).length}));
  cols.push({key:'',label:ico+' '+esc(unfiledLabel),nav:'…unfiled',list:(groups['']||[]).sort(byDue),od:(groups['']||[]).filter(x=>x.overdue).length});
  deskStrip(b,key==='bucket'?'bucket':'place',cols);
}
function deskPeople(b){
  const waiting=(DESK_DATA.items||[]).filter(x=>x.status==='waiting');
  if(!waiting.length){ b.innerHTML='<div class="empty"><div class="e-ico">🤝</div>You\'re not waiting on anyone.<br>Add "with Josh" to any capture and it lands here.</div>'; return; }
  const by={};
  for(const x of waiting){ const w=x.with_who||'(unassigned)'; (by[w]=by[w]||[]).push(x); }
  const cols=Object.keys(by).sort().map(w=>{
    const list=by[w];
    const oldest=Math.max(...list.map(x=>Math.round((Date.now()-Date.parse(String(x.created_at).replace(' ','T')+'Z'))/864e5)));
    const matched=list.some(x=>x.matched_name);
    return {key:w,label:'👤 '+esc(w),nav:esc(w),list,od:list.filter(x=>x.overdue).length,
      hint:'oldest '+oldest+'d'+(matched?'':' · not matched to an app user'),
      head:matched?`<button class="btn btn-gold btn-sm sans" style="margin-top:4px" onclick="deskNudgeAll(${JSON.stringify(list.map(x=>x.id)).replace(/"/g,'')})">📣 Nudge all</button>`:''};
  });
  deskStrip(b,'person',cols);
}
async function deskNudgeAll(ids){
  for(const id of ids){ try{ await api('/desk/'+id+'/nudge',{method:'POST'}); }catch(_e){} }
  loadMyDesk();
}
/* ── 📧 Mail — the inbox, triaged: AI reads everything, only what needs YOU
   makes the board. Decision needed / Follow-up / Review; the rest is counted
   and ignored. Connect once with a Microsoft code — no password enters the app. */
async function deskMail(b){
  b.innerHTML='<div class="hint" style="margin-top:10px">Checking the mailbox…</div>';
  let st; try{ st=await api('/mail/status'); }catch(e){ b.innerHTML='<div class="hint" style="margin-top:10px">'+esc(e.message)+'</div>'; return; }
  if(!st.configured){
    b.innerHTML=`<div style="margin-top:10px;max-width:680px">
      <h3 style="margin:0 0 4px">📧 Connect your inbox</h3>
      <div class="card" style="background:#faf6ee;border-left:4px solid var(--gold)"><strong class="sans">⚡ Instant setup — try this first, no IT needed</strong>
        <p class="sub sans" style="margin:4px 0 8px">Uses Microsoft's own built-in sign-in app. One tap here, then you enter a short code on Microsoft's site and approve read-only access to your mailbox. If your company tenant allows it (most do), you're done in under a minute.</p>
        <button class="btn btn-gold sans" onclick="mailInstantSetup()">⚡ Set up instantly</button> <span class="hint" id="mg_msg2"></span></div>
      <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">If instant setup is blocked by your tenant — the 5-minute manual way (you or IT)</summary>
      <p class="sub sans" style="margin:6px 0">Sign in at <strong>entra.microsoft.com</strong> (your normal Microsoft login) → App registrations → <em>New registration</em> — name it "Armada OS Mail", single tenant. Then: Authentication → <em>Allow public client flows</em> = Yes → Save. Paste the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong> from its Overview page:</p>
      <label>Application (client) ID</label><input id="mg_client" placeholder="xxxxxxxx-xxxx-…"/>
      <label>Directory (tenant) ID</label><input id="mg_tenant" placeholder="xxxxxxxx-xxxx-…"/>
      <div class="toolbar" style="justify-content:flex-start;margin-top:8px"><button class="btn btn-gold sans" onclick="mailSaveSetup()">Save</button><span class="hint" id="mg_msg"></span></div></details>
      <p class="sub sans" style="margin-top:8px">Either way: read-only. The app can never send or delete mail, and your password never touches it.</p></div>`;
    return;
  }
  if(!st.connected){
    b.innerHTML=`<div style="margin-top:10px;max-width:640px">
      <h3 style="margin:0 0 4px">📧 Sign in to your mailbox</h3>
      <p class="sub sans">Tap the button, then enter the code at Microsoft — that's the whole sign-in.</p>
      <div class="toolbar" style="justify-content:flex-start"><button class="btn btn-gold sans" onclick="mailConnect()">Connect Microsoft 365</button><span class="hint" id="mg_msg"></span></div>
      <div id="mg_code"></div></div>`;
    return;
  }
  let d; try{ d=await api('/mail/board'); }catch(e){ b.innerHTML='<div class="hint" style="margin-top:10px">'+esc(e.message)+'</div>'; return; }
  const card=(m)=>`<div class="q-row" style="display:block;padding:10px 12px">
    <div style="font-weight:600">${esc(m.subject||'(no subject)')}</div>
    <div class="hint">${esc(m.from_name||m.from_email||'')} · ${esc((m.received_at||'').slice(0,16).replace('T',' '))}</div>
    ${m.action?`<div style="color:var(--gold,#a07828);font-size:13px;margin-top:2px">→ ${esc(m.action)}</div>`:''}
    ${m.reason?`<div class="hint" style="font-size:12px;margin-top:2px">${esc(m.reason)}</div>`:''}
    <div class="toolbar" style="gap:4px;margin-top:6px;justify-content:flex-start">
      <button class="btn btn-ghost btn-sm sans" title="Handled" onclick="mailAct(${m.id},'done')">✓</button>
      <button class="btn btn-ghost btn-sm sans" title="Dismiss" onclick="mailAct(${m.id},'dismissed')">✕</button>
      <button class="btn btn-ghost btn-sm sans" title="Never show this sender again" onclick="mailMute('${esc(m.from_email||'')}',${m.id})">🔇</button>
      <button class="btn btn-ghost btn-sm sans" title="Make it a Desk task" onclick="mailToDesk(${m.id})">➕ Desk</button>
      ${m.web_link?`<a class="btn btn-ghost btn-sm sans" href="${esc(m.web_link)}" target="_blank" rel="noopener">↗ Open</a>`:''}
    </div></div>`;
  const col=(title,arr,color)=>`<div class="trello-col"><div class="trello-head" style="border-top:3px solid ${color};border-radius:12px 12px 0 0"><strong class="sans">${title}</strong> <span class="hint">${arr.length}</span></div><div class="trello-body">${arr.map(card).join('')||'<div class="hint" style="padding:8px">Nothing waiting.</div>'}</div></div>`;
  b.innerHTML=`<div style="margin-top:10px">
    <div class="cmd-hero-row"><div><h3 style="margin:0">📧 ${esc(st.user||'Inbox')}</h3>
      <p class="sub sans" style="margin:0">Read &amp; ignored today: <strong>${d.ignoredToday}</strong> · handled today: <strong>${d.doneToday}</strong>${st.lastRun?' · last check '+esc(st.lastRun.slice(11,16)):''} · checks every 10 min${st.running?' · <strong>sorting now…</strong>':''}</p></div>
      <div class="toolbar" style="gap:6px"><button class="btn btn-ghost btn-sm sans" onclick="mailPoll(this)">↻ Check now</button><button class="btn btn-ghost btn-sm sans" onclick="mailDisconnect()" title="Sign this mailbox out">Sign out</button></div></div>
    <div class="trello" style="margin-top:8px">
      ${col('🔴 Decision needed', d.decision, '#c0392b')}
      ${col('🟠 Follow-up', d.followup, '#d29a5e')}
      ${col('🟡 Review', d.review, '#c9a35c')}
    </div>
    <details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Recently ignored (${(d.ignoredRecent||[]).length}) — spot checks welcome</summary>
      ${(d.ignoredRecent||[]).map(m=>`<div class="hint" style="margin-top:4px">• <strong>${esc(m.subject||'')}</strong> — ${esc(m.from_name||m.from_email||'')} <span style="opacity:.7">(${esc(m.reason||'')})</span></div>`).join('')||'<div class="hint">None yet.</div>'}
    </details>
    <details style="margin-top:6px"><summary class="hint" style="cursor:pointer">Muted senders — never triaged, never shown</summary><div id="mailMutedList" class="hint" style="margin-top:4px">Loading…</div></details></div>`;
  api('/mail/muted').then(r=>{ const el=$('mailMutedList'); if(!el) return;
    el.innerHTML=(r.muted||[]).map(x=>`<div style="margin-top:3px">🔇 ${esc(x.from_email)} <span style="opacity:.7">(${esc(x.why||'')})</span> <a href="#" onclick="mailUnmute('${esc(x.from_email)}');return false">unmute</a></div>`).join('')||'No muted senders yet — tap 🔇 on any card, or dismiss the same sender 3 times and it mutes itself.';
  }).catch(()=>{});
}
/* ── 📤 Follow-ups: every ask he emailed, tracked until it's honored ────────── */
let ASK_DRAFTS={};
async function deskAsks(b){
  b.innerHTML='<div class="hint" style="margin-top:10px">Loading follow-ups…</div>';
  let st; try{ st=await api('/mail/status'); }catch(e){ b.innerHTML='<div class="hint" style="margin-top:10px">'+esc(e.message)+'</div>'; return; }
  if(!st.configured||!st.connected){
    b.innerHTML=`<div style="margin-top:10px;max-width:640px"><h3 style="margin:0 0 4px">📤 Follow-ups</h3>
      <p class="sub sans">Reads the email <strong>you send</strong>, spots every request you make (with or without a deadline), and holds it here until it's honored — with a ready-to-send follow-up when someone goes quiet.</p>
      <p class="sub sans">Connect your mailbox on the <strong>📧 Mail</strong> tab first — this uses the same read-only connection.</p></div>`;
    return;
  }
  let d; try{ d=await api('/mail/asks'); }catch(e){ b.innerHTML='<div class="hint" style="margin-top:10px">'+esc(e.message)+'</div>'; return; }
  ASK_DRAFTS={};
  const chip=(a)=>a.replied_at?`<span class="badge-idle" style="background:#e8f3ec;color:#2f7a4f">replied ${esc(String(a.replied_at).slice(5,10))}</span>`
    :a.due_date?`<span class="badge-idle" ${a.due_date<d.today?'style="background:#fdeaea;color:#b3382f"':''}>due ${esc(a.due_date)}</span>`
    :`<span class="badge-idle">no timeline · chase ${esc(a.followup_on||'')}</span>`;
  const row=(a)=>`<div class="q-row" style="display:block;padding:10px 12px">
    <div><strong>${esc(a.to_name||a.to_email||'?')}</strong> — ${esc(a.ask||'')}</div>
    <div class="hint" style="margin-top:2px">${esc(a.subject||'')} · asked ${esc(String(a.sent_at||'').slice(0,10))} ${chip(a)}</div>
    <div class="toolbar" style="gap:4px;margin-top:6px;justify-content:flex-start;flex-wrap:wrap">
      <button class="btn btn-gold btn-sm sans" onclick="askDraft(${a.id})">✉️ Draft follow-up</button>
      <button class="btn btn-ghost btn-sm sans" title="It happened — close it out" onclick="askAct(${a.id},'done')">✅ Done</button>
      <button class="btn btn-ghost btn-sm sans" title="Push the chase date" onclick="askSnooze(${a.id})">📅 Later</button>
      <button class="btn btn-ghost btn-sm sans" title="Not actually a request" onclick="askAct(${a.id},'dismissed')">✕</button>
      ${a.web_link?`<a class="btn btn-ghost btn-sm sans" href="${esc(a.web_link)}" target="_blank" rel="noopener">↗ Original</a>`:''}
    </div><div id="askDraft_${a.id}"></div></div>`;
  const sec=(title,arr,color)=>arr.length?`<div class="card" style="border-left:4px solid ${color};margin-top:10px"><h3 style="margin:0 0 6px">${title} <span class="hint" style="font-weight:400">· ${arr.length}</span></h3>${arr.map(row).join('')}</div>`:'';
  const total=(d.overdue||[]).length+(d.dueToday||[]).length+(d.replied||[]).length+(d.upcoming||[]).length;
  b.innerHTML=`<div style="margin-top:10px">
    <div class="cmd-hero-row"><div><h3 style="margin:0">📤 Follow-ups — the asks you sent</h3>
      <p class="sub sans" style="margin:0">Every request in your sent mail, tracked to its date.${d.lastRun?' Last sweep '+esc(String(d.lastRun).slice(11,16))+'.':''} Sweeps with every mail check.</p></div>
      <button class="btn btn-ghost btn-sm sans" onclick="mailPoll(this)">↻ Check now</button></div>
    ${d.lastError?`<div class="hint" style="color:var(--danger)">Last sweep hiccup: ${esc(d.lastError)}</div>`:''}
    ${sec('💬 They replied — review & close', d.replied||[], '#2f7a4f')}
    ${sec('🔴 Overdue — nudge time', d.overdue||[], '#c0392b')}
    ${sec('🟡 Due today', d.dueToday||[], '#d29a5e')}
    ${sec('⏳ Coming up', d.upcoming||[], '#c9c2b4')}
    ${total?'':'<div class="empty"><div class="e-ico">📤</div>No open asks tracked yet.<br>Send a request by email (or tap ↻ Check now to sweep your recent sent mail) and it lands here.</div>'}
    ${(d.closedRecent||[]).length?`<details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Recently closed (${d.closedRecent.length})</summary>
      ${d.closedRecent.map(x=>`<div class="hint" style="margin-top:4px">${x.status==='done'?'✅':'✕'} <strong>${esc(x.to_name||'')}</strong> — ${esc(x.ask||'')}${x.closed_note?' · <em>'+esc(x.closed_note)+'</em>':''}</div>`).join('')}</details>`:''}
  </div>`;
}
async function askAct(id,status){
  let note='';
  if(status==='done'){ note=prompt('Close-out note (optional) — e.g. "Plan was solid — done."')||''; }
  try{ await api('/mail/asks/'+id,{method:'POST',body:JSON.stringify({status,note})}); }catch(e){ alert(e.message); }
  renderDeskTab();
}
async function askSnooze(id){
  const dte=prompt('Follow up on (YYYY-MM-DD):', new Date(Date.now()+3*864e5).toISOString().slice(0,10));
  if(!dte) return;
  try{ await api('/mail/asks/'+id,{method:'POST',body:JSON.stringify({followup_on:dte})}); }catch(e){ alert(e.message); }
  renderDeskTab();
}
async function askDraft(id){
  const host=$('askDraft_'+id); if(!host) return;
  host.innerHTML='<div class="hint" style="margin-top:6px">Writing the follow-up…</div>';
  try{
    const r=await api('/mail/asks/'+id+'/draft',{method:'POST'});
    ASK_DRAFTS[id]={to:r.to||'',subject:r.subject||''};
    host.innerHTML=`<div style="margin-top:6px"><div class="hint">To: ${esc(r.to||'?')} · ${esc(r.subject||'')}</div>
      <textarea id="askDraftTxt_${id}" rows="7" style="margin-top:4px">${esc(r.body||'')}</textarea>
      <div class="toolbar" style="justify-content:flex-start;gap:6px;margin-top:4px">
        <button class="btn btn-gold btn-sm sans" onclick="askMailto(${id})">✉️ Open in email app</button>
        <button class="btn btn-ghost btn-sm sans" onclick="navigator.clipboard.writeText(document.getElementById('askDraftTxt_${id}').value).then(()=>this.textContent='Copied ✓')">Copy</button>
      </div><div class="hint">Edit freely — nothing sends until you hit send in your own mail app.</div></div>`;
  }catch(e){ host.innerHTML='<div class="hint" style="color:var(--danger);margin-top:6px">'+esc(e.message)+'</div>'; }
}
function askMailto(id){
  const dft=ASK_DRAFTS[id]||{}; const body=($('askDraftTxt_'+id)||{}).value||'';
  location.href='mailto:'+encodeURIComponent(dft.to||'')+'?subject='+encodeURIComponent(dft.subject||'')+'&body='+encodeURIComponent(body);
}
async function mailInstantSetup(){
  const m=$('mg_msg2'); if(m)m.textContent='Setting up…';
  try{
    // Microsoft's first-party public client (the Graph PowerShell app) — made for
    // exactly this device-code sign-in; most work tenants permit it by default.
    await api('/mail/settings',{method:'POST',body:JSON.stringify({client_id:'14d82eec-204b-4c2f-b7e8-296a70dab67e',tenant:'organizations',enabled:true})});
    renderDeskTab();
  }catch(e){ if(m)m.textContent=e.message; }
}
async function mailSaveSetup(){
  const m=$('mg_msg');
  try{ await api('/mail/settings',{method:'POST',body:JSON.stringify({client_id:($('mg_client')||{}).value||'',tenant:($('mg_tenant')||{}).value||'',enabled:true})}); if(m)m.textContent='✓ Saved'; renderDeskTab(); }
  catch(e){ if(m)m.textContent=e.message; }
}
async function mailConnect(){
  const m=$('mg_msg'), c=$('mg_code');
  try{
    const r=await api('/mail/connect',{method:'POST'});
    if(c)c.innerHTML=`<div class="card" style="margin-top:10px;text-align:center"><div class="hint">Go to</div><div style="font-size:18px;font-weight:700">${esc(r.verification_uri)}</div><div class="hint" style="margin-top:6px">and enter this code:</div><div style="font-size:30px;font-weight:800;letter-spacing:4px;margin:6px 0">${esc(r.user_code)}</div><div class="hint">This page updates by itself once you're signed in.</div></div>`;
    let tries=0;
    const iv=setInterval(async()=>{
      tries++;
      try{ const s=await api('/mail/status'); if(s.connected){ clearInterval(iv); renderDeskTab(); mailPoll(); } }catch(_e){}
      if(tries>60) clearInterval(iv);
    },5000);
  }catch(e){ if(m)m.textContent=e.message; }
}
async function mailPoll(btn){
  if(btn){ btn.disabled=true; btn.textContent='Checking…'; }
  try{ await api('/mail/poll',{method:'POST'}); }catch(e){ if(btn) alert(e.message); }
  if(btn){ btn.disabled=false; btn.textContent='↻ Check now'; }
  // The check runs in the background (a big backlog is paced over minutes) —
  // refresh the board a few times so results appear as they land.
  let n=0; const iv=setInterval(()=>{ n++; if(n>8||DESK_TAB!=='mail'){ clearInterval(iv); return; } renderDeskTab(); },15000);
  renderDeskTab();
}
async function mailAct(id,status){
  try{ const r=await api('/mail/'+id,{method:'POST',body:JSON.stringify({status})});
    if(r.autoMuted) alert('Got it — that\'s the third dismissal from '+r.autoMuted+', so they\'re muted from now on. Unmute anytime under "Muted senders."');
  }catch(_e){}
  renderDeskTab();
}
async function mailMute(email,id){
  if(!email){ alert('No sender address on this one.'); return; }
  try{ await api('/mail/mute',{method:'POST',body:JSON.stringify({from_email:email})}); if(id) await api('/mail/'+id,{method:'POST',body:JSON.stringify({status:'dismissed'})}); }catch(e){ alert(e.message); }
  renderDeskTab();
}
async function mailUnmute(email){ try{ await api('/mail/mute',{method:'POST',body:JSON.stringify({from_email:email,unmute:true})}); }catch(_e){} renderDeskTab(); }
async function mailToDesk(id){ try{ await api('/mail/'+id+'/to-desk',{method:'POST'}); }catch(e){ alert(e.message); } renderDeskTab(); }
async function mailDisconnect(){ if(!confirm('Sign this mailbox out? Triage stops until you reconnect.'))return; try{ await api('/mail/disconnect',{method:'POST'}); }catch(_e){} renderDeskTab(); }
function deskSetup(b){
  const d=DESK_DATA;
  b.innerHTML=`<div style="margin-top:10px">
    <h3 style="margin:0 0 4px">📱 Capture by voice / text</h3>
    <div class="hint" style="margin:4px 0"><strong>Siri (works now):</strong> Shortcuts app → your "Desk It" shortcut: Dictate Text → Get Contents of URL (POST, JSON field <code>text</code> = Dictated Text) → URL below. Say "Hey Siri, Desk It".</div>
    <div class="hint" style="margin:4px 0"><strong>Real texting number:</strong> Twilio number (~$2/mo) → Messaging webhook POST → same URL. It texts back "✓ Saved".</div>
    <div class="pc-note" style="word-break:break-all;font-family:monospace;font-size:12px">${esc((d.settings||{}).noteUrl||'')}</div>
    <h3 style="margin:14px 0 4px">☀️ Morning digest</h3>
    <div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">
      <label class="hint">At <input type="number" id="deskHour" min="0" max="23" value="${(d.settings||{}).digestHour??7}" style="width:60px"/>:00</label>
      <label class="hint">to <input id="deskEmail" value="${esc((d.settings||{}).email||'')}" placeholder="you@armadarecovery.com" style="min-width:210px"/></label></div>
    <h3 style="margin:14px 0 4px">🏷 Buckets <span class="hint" style="font-weight:400">· one per line — the AI files into exactly these</span></h3>
    <textarea id="deskBuckets" rows="6" style="width:100%;max-width:340px">${esc((d.buckets||[]).join('\n'))}</textarea>
    <div class="toolbar" style="justify-content:flex-start;margin-top:8px"><button class="btn btn-gold btn-sm sans" onclick="deskSaveSettings()">Save settings</button></div></div>`;
}
async function deskAdd(){
  const cap=$('deskCap'); const text=(cap&&cap.value||'').trim(); if(!text) return;
  try{ await api('/desk',{method:'POST',body:JSON.stringify({text})}); cap.value=''; loadMyDesk(); }catch(e){ alert(e.message); }
}
async function deskDo(id,body){ try{ await api('/desk/'+id,{method:'PATCH',body:JSON.stringify(body)}); }catch(e){ alert(e.message);} loadMyDesk(); }
async function deskDate(id){ const dt=prompt('Due date (YYYY-MM-DD), blank to clear:'); if(dt==null) return; const tm=dt?prompt('Time (HH:MM, optional):','')||'':''; deskDo(id,{due_date:dt,due_time:tm}); }
async function deskBucket(id){
  const d=DESK_DATA||{}; const buckets=d.buckets||[]; const facs=d.facilities||[];
  const b=prompt('Bucket — one of:\n'+buckets.join(' · ')+'\n(blank to clear)');
  if(b==null) return;
  const match=buckets.find(x=>x.toLowerCase()===b.toLowerCase().trim())||b.trim();
  const f=prompt('Location (optional) — one of:\n'+facs.map(x=>x.name).join(' · '));
  const fac=f?facs.find(x=>x.name.toLowerCase().includes(f.toLowerCase().trim())):null;
  deskDo(id,{bucket:match,facility_id:fac?fac.id:(f===''?null:undefined)});
}
async function deskAssignRole(id,role){
  const staff=((DESK_DATA||{}).staffByRole||{})[role]||[];
  if(!staff.length){ if(confirm('No active app users with the role "'+role+'". Assign someone by name instead?')) deskWho(id); return; }
  const pick=prompt('AI suggests a '+role+'. Who?\n'+staff.map((n,i)=>(i+1)+'. '+n).join('\n')+'\n\nType a number or a name:');
  if(pick==null) return;
  const name=/^\d+$/.test(pick.trim())?staff[+pick.trim()-1]:pick.trim();
  if(name) deskDo(id,{with_who:name});
}
async function deskWho(id){ const w=prompt('Who has to help close this? (name — matches app users automatically)'); if(w==null) return; deskDo(id,{with_who:w}); }
async function deskNudge(id){ try{ const r=await api('/desk/'+id+'/nudge',{method:'POST'}); alert('📣 '+(r.how||'nudged')); }catch(e){ alert(e.message);} loadMyDesk(); }
// ✉️ Email from the board — AI writes the first draft, you own the send.
async function deskEmail(id,btn){
  const label=btn?btn.textContent:''; if(btn){ btn.disabled=true; btn.textContent='✦ drafting…'; }
  let d; try{ d=await api('/desk/'+id+'/draft',{method:'POST'}); }
  catch(e){ alert(e.message); if(btn){ btn.disabled=false; btn.textContent=label; } return; }
  if(btn){ btn.disabled=false; btn.textContent=label; }
  const save=hmodal(`<h3>✉️ Send it${d.recipient?' — '+esc(d.recipient):''}</h3>
    <p class="sub sans" style="margin:0 0 8px">${d.ai?'✦ Drafted by AI from the task — read it, make it yours, send.':'AI is off — here\'s an honest skeleton to fill in.'}</p>
    <label>To</label><input id="de_to" type="email" value="${esc(d.to||'')}" placeholder="who@armadarecovery.com"/>
    <label>Subject</label><input id="de_subject" value="${esc(d.subject||'')}"/>
    <label>Body</label><textarea id="de_body" rows="10">${esc(d.body||'')}</textarea>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;margin-top:4px">${d.ai?`<button class="btn btn-ghost btn-sm sans" onclick="deskRedraft(${id})">↻ Redraft</button>`:''}<span class="hint" id="de_msg"></span></div>`);
  save.textContent='Send email';
  save.onclick=async()=>{
    save.disabled=true; save.textContent='Sending…';
    try{ const r=await api('/desk/'+id+'/email',{method:'POST',body:JSON.stringify({to:$('de_to').value.trim(),subject:$('de_subject').value,body:$('de_body').value})});
      closeHModal(); alert('✉️ Sent to '+r.sent+' — the item now shows who you\'re waiting on.'); loadMyDesk(); }
    catch(e){ save.disabled=false; save.textContent='Send email'; if($('de_msg'))$('de_msg').textContent=e.message; }
  };
}
async function deskRedraft(id){
  const m=$('de_msg'); if(m)m.textContent='✦ redrafting…';
  try{ const d=await api('/desk/'+id+'/draft',{method:'POST'}); $('de_subject').value=d.subject||''; $('de_body').value=d.body||''; if(m)m.textContent=''; }
  catch(e){ if(m)m.textContent=e.message; }
}
async function deskDel(id){ if(!confirm('Delete this item?')) return; try{ await api('/desk/'+id,{method:'DELETE'}); }catch(e){ alert(e.message);} loadMyDesk(); }
async function deskSaveSettings(){ try{ await api('/desk/settings',{method:'POST',body:JSON.stringify({digestHour:+(($('deskHour')||{}).value||7),email:($('deskEmail')||{}).value||'',buckets:(($('deskBuckets')||{}).value||'').split('\n').map(x=>x.trim()).filter(Boolean)})}); loadMyDesk(); }catch(e){ alert(e.message); } }
async function deskDigestNow(btn){ btn.disabled=true; try{ const r=await api('/desk/digest-now',{method:'POST'}); alert(r.sent?'☀️ Digest sent.':'Not sent: '+(r.reason||'')); }catch(e){ alert(e.message);} btn.disabled=false; }

/* ── SCHEDULING & THE SERVICE PROMISE — queue + calendar + one-minute notes.
   Excellence Wins: consistency (same flow every time), reliability (promises
   visible + enforced), accountability (supervisor lens), respect (honest waits,
   proactive reschedules — nothing evaporates on the client). ── */
let AP_TAB='queue', AP_DATE='', AP_DATA=null;
async function loadAppts(){
  const host=$('appts'); if(!host) return;
  if(!AP_DATE) AP_DATE=today();
  host.innerHTML='<div class="card"><div class="skel" style="width:240px;height:22px;margin-bottom:14px"></div><div class="skel" style="height:70px"></div></div>';
  let d; try{ d=await api('/appts?date='+AP_DATE); }catch(e){ host.innerHTML='<div class="card"><div class="empty"><div class="e-ico">⚠️</div>'+esc(e.message)+'</div></div>'; return; }
  AP_DATA=d;
  const tabs=[['queue','🛎 Queue'+(d.queue.length?' ('+d.queue.length+')':'')],['cal','📅 Calendar'],['myday','📥 My follow-ups'+((d.pending.length+d.missed.length)?' ('+(d.pending.length+d.missed.length)+')':'')],['avail','🕐 Availability']];
  if(d.leadership) tabs.push(['sup','📊 Supervisor']);
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">Scheduling &amp; Queue</h3><p class="sub sans" style="margin:0">Every request gets a promise; every meeting gets a note before it closes; every miss gets rescheduled — predictable service, not interruptions.${d.estWaitMin!=null?' Typical response lately: <strong>~'+d.estWaitMin+' min</strong>.':''}</p></div></div>
    <div class="corp-tabs" style="margin-top:8px">${tabs.map(([k,l])=>`<button class="${AP_TAB===k?'active':''}" onclick="AP_TAB='${k}';renderAppts()">${l}</button>`).join('')}</div>
    <div id="apBody"></div></div><div id="apModalHost"></div>`;
  renderAppts();
}
function renderAppts(){
  const b=$('apBody'); if(!b||!AP_DATA) return;
  document.querySelectorAll('#appts .corp-tabs button').forEach(x=>x.classList.toggle('active',x.getAttribute('onclick').includes("'"+AP_TAB+"'")));
  if(AP_TAB==='queue') return apQueue(b);
  if(AP_TAB==='cal') return apCal(b);
  if(AP_TAB==='myday') return apMyDay(b);
  if(AP_TAB==='avail') return apAvail(b);
  if(AP_TAB==='sup') return apSup(b);
}
function apQueue(b){
  const q=AP_DATA.queue||[];
  const assigned=(r)=>/therap/i.test(r.department)?(r.therapist||''):(r.case_manager||'');
  const row=(r)=>`<div class="q-row ${r.promiseBreached?'q-overdue':''}" style="cursor:default">
    <div class="q-main"><div class="q-title">${esc(r.client)}${r.room?' · '+esc(r.room):''} — ${esc(r.text)}</div>
      <div class="q-sub">${esc(r.department)}${assigned(r)?' · assigned: <strong>'+esc(assigned(r))+'</strong>':''} · waiting ${r.waitMin} min${r.claimed_by?' · '+esc(r.claimed_by)+' on it':''}${r.promise_at?' · <strong>promised by '+esc(r.promise_at.slice(11,16))+'</strong>'+(r.promiseBreached?' <span class="badge-crit">promise at risk — see them now or re-promise</span>':''):''}${r.ready?' · <span class="badge-ok">client notified — ready</span>':''}</div></div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      ${!r.promise_at?`<button class="btn btn-ghost btn-sm sans" onclick="apPromise(${r.id})" title="Commit a response time — the kiosk shows it to the client">⏱ Promise…</button>`:`<button class="btn btn-ghost btn-sm sans" onclick="apPromise(${r.id})">⏱ Re-promise</button>`}
      ${!r.claimed_by?`<button class="btn btn-ghost btn-sm sans" onclick="apQAct(${r.id},'claim')">✋ I've got it</button>`:''}
      ${r.client_id?`<button class="btn btn-ghost btn-sm sans" onclick="apBookFromReq(${r.client_id})" title="Turn this request into a scheduled appointment">📅 Book</button>`:''}
      ${!r.ready?`<button class="btn btn-ghost btn-sm sans" onclick="apQAct(${r.id},'ready')" title="Flashes 'we're ready for you' on the kiosk">📣 Ready</button>`:''}
      <button class="btn btn-gold btn-sm sans" onclick="apNoteModal('queue',${r.id})">✓ Met — note</button></div></div>`;
  b.innerHTML=q.length?`<div style="margin-top:8px">${q.map(row).join('')}</div>`
    :'<div class="empty"><div class="e-ico">🤝</div>No meeting requests waiting — every ask for the care team is handled.<br>(Blankets &amp; comforts live in <a href="#" onclick="show(\'concierge\');return false">Concierge</a>.)</div>';
}
function apBookFromReq(clientId){
  AP_TAB='cal'; renderAppts(); apBookForm();
  const sel=$('apC'); if(sel) sel.value=String(clientId);
}
async function apPromise(id){
  const mins=prompt('Promise a response within how many minutes? (the kiosk will show the client the committed time)','20');
  if(!mins||!+mins) return;
  try{ await api('/appts/queue/'+id,{method:'POST',body:JSON.stringify({action:'promise',minutes:+mins})}); }catch(e){ alert(e.message); }
  loadAppts();
}
async function apQAct(id,action){ try{ await api('/appts/queue/'+id,{method:'POST',body:JSON.stringify({action})}); }catch(e){ alert(e.message);} loadAppts(); }
function apCal(b){
  const d=AP_DATA;
  const stPill=(a)=>({scheduled:'<span class="badge-info">scheduled</span>',checked_in:'<span class="badge-warn">checked in</span>',in_session:'<span class="badge-warn">in session</span>',completed:'<span class="badge-ok">completed ✓ documented</span>',missed:'<span class="badge-crit">missed</span>',cancelled:'<span class="badge-idle">cancelled</span>'}[a.status]||a.status);
  const row=(a)=>`<tr class="${a.overdue?'q-overdue':''}"><td><strong>${esc(a.time)}</strong> <span class="hint">${a.duration_min}m</span></td>
    <td><strong>${esc(a.client)}</strong>${a.room?' <span class="hint">· '+esc(a.room)+'</span>':''}</td>
    <td>${esc(a.kind)}<div class="hint">${esc(a.staff_name||'')}</div></td>
    <td>${stPill(a)}${a.overdue?' <span class="badge-crit">running late — keep the promise</span>':''}</td>
    <td><div style="display:flex;gap:4px;flex-wrap:wrap">
      ${a.status==='scheduled'?`<button class="btn btn-ghost btn-sm sans" onclick="apAct(${a.id},'checkin')">Check in</button>`:''}
      ${['scheduled','checked_in'].includes(a.status)?`<button class="btn btn-ghost btn-sm sans" onclick="apAct(${a.id},'start')">▶ Start</button>`:''}
      ${['scheduled','checked_in','in_session'].includes(a.status)?`<button class="btn btn-gold btn-sm sans" onclick="apNoteModal('appt',${a.id})">✓ Complete + note</button>`:''}
      ${['scheduled','checked_in'].includes(a.status)?`<button class="btn btn-ghost btn-sm sans" onclick="apMiss(${a.id})">Missed…</button>`:''}
    </div></td></tr>`;
  b.innerHTML=`<div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:8px">
      <label class="hint">Day <input type="date" value="${esc(AP_DATE)}" onchange="AP_DATE=this.value;loadAppts()"/></label>
      <button class="btn btn-gold btn-sm sans" onclick="apBookForm()">＋ Book appointment</button></div>
    <div id="apBook"></div>
    ${d.appts.length?`<table class="tbl" style="margin-top:8px"><tr><th>Time</th><th>Client</th><th>With</th><th>Status</th><th></th></tr>${d.appts.map(row).join('')}</table>`
      :'<div class="empty"><div class="e-ico">📅</div>No appointments this day yet.<div class="e-act"><button class="btn btn-gold btn-sm sans" onclick="apBookForm()">Book the first one</button></div></div>'}`;
}
function apBookForm(){
  const h=$('apBook'); if(!h) return; const d=AP_DATA;
  h.innerHTML=`<div class="pc-note" style="margin-top:8px"><div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
    <select id="apC">${d.clients.map(c=>`<option value="${c.id}">${esc(c.label)}${c.room?' · '+esc(c.room):''}</option>`).join('')}</select>
    <select id="apK">${d.kinds.map(k=>`<option>${k}</option>`).join('')}</select>
    <select id="apS" onchange="apAvailHint()">${[ME.name,...d.staff.filter(s=>s!==ME.name)].map(s=>`<option>${esc(s)}</option>`).join('')}</select>
    <input type="date" id="apD" value="${esc(AP_DATE)}" onchange="apAvailHint()"/><input type="time" id="apT" value="10:00"/>
    <select id="apDur"><option value="15">15m</option><option value="30" selected>30m</option><option value="45">45m</option><option value="60">60m</option></select>
    <button class="btn btn-gold btn-sm sans" onclick="apBook(false)">Book &amp; promise</button></div>
    <div class="hint" id="apAvailLine" style="margin-top:4px"></div>
    <div class="hint" style="margin-top:2px">Booking = a promise to the client. Misses must be rescheduled — that's the deal.</div></div>`;
  apAvailHint();
}
async function apAvailHint(){
  const el=$('apAvailLine'); if(!el) return;
  const staff=($('apS')||{}).value, date=($('apD')||{}).value;
  if(!staff||!date){ el.textContent=''; return; }
  try{ const d=await api('/appts/availability?staff='+encodeURIComponent(staff)+'&date='+encodeURIComponent(date)); el.innerHTML='🕐 <strong>'+esc(staff)+'</strong> that day: '+esc(d.line||'—'); }
  catch(_e){ el.textContent=''; }
}
async function apBook(force){
  const v=(id)=>($(id)||{}).value;
  try{
    await api('/appts',{method:'POST',body:JSON.stringify({client_id:+v('apC'),kind:v('apK'),staff_name:v('apS'),date:v('apD'),time:v('apT'),duration_min:+v('apDur'),force})});
    AP_DATE=v('apD'); loadAppts();
  }catch(e){
    if(/Book anyway/.test(e.message)&&confirm(e.message)) return apBook(true);
    alert(e.message);
  }
}
async function apAct(id,action){ try{ await api('/appts/'+id,{method:'PATCH',body:JSON.stringify({action})}); }catch(e){ alert(e.message);} loadAppts(); }
async function apMiss(id){
  const move=confirm('Keep the promise: reschedule it now?\n\nOK = pick a new time · Cancel = record a reason instead');
  if(move){
    const date=prompt('New date (YYYY-MM-DD):', today()); if(!date) return;
    const time=prompt('New time (HH:MM):','10:00'); if(!time) return;
    try{ await api('/appts/'+id,{method:'PATCH',body:JSON.stringify({action:'missed',reschedule:{date,time}})}); }catch(e){ alert(e.message); }
  } else {
    const reason=prompt('Why was it missed? (the client deserves a reason — logged)'); if(!reason) return;
    try{ await api('/appts/'+id,{method:'PATCH',body:JSON.stringify({action:'missed',reason})}); }catch(e){ alert(e.message); }
  }
  loadAppts();
}
// The one-minute note: 2 taps + optional line. Required before anything closes.
const AP_TOPICS=['Housing','Employment','Family','Cravings/urges','Medication','Legal','Transport','Discharge plan','Peer support','Other'];
function apNoteModal(mode,id){
  const h=$('apModalHost'); if(!h) return;
  h.innerHTML=`<div class="card" id="apModal" style="border-left:4px solid var(--gold)">
    <div class="cmd-hero-row"><div><h3 style="margin:0">One-minute note <span class="hint" style="font-weight:400">· required to close — protects the client AND the billing day</span></h3></div><button class="iconbtn" onclick="$('apModalHost').innerHTML=''">✕</button></div>
    <div class="hint" style="margin:6px 0 2px">How are they doing?</div>
    <div class="oi-action" id="apDisp">${['stable','improving','struggling','crisis'].map(x=>`<button class="btn btn-ghost btn-sm sans" data-v="${x}" onclick="document.querySelectorAll('#apDisp button').forEach(b=>b.classList.remove('btn-gold'));this.classList.add('btn-gold')">${x==='crisis'?'🔴 ':''}${x}</button>`).join('')}</div>
    <div class="hint" style="margin:8px 0 2px">What did you cover? (tap all that apply)</div>
    <div class="oi-action" id="apTop">${AP_TOPICS.map(t=>`<button class="btn btn-ghost btn-sm sans" data-v="${t}" onclick="this.classList.toggle('btn-gold')">${t}</button>`).join('')}</div>
    <textarea id="apBody2" placeholder="One line if it helps (or use your keyboard's 🎤 dictation)…" style="width:100%;margin-top:8px" rows="2"></textarea>
    <div class="toolbar" style="justify-content:flex-start;gap:10px;margin-top:6px;flex-wrap:wrap">
      <label class="hint"><input type="checkbox" id="apExpand"/> Needs a full note later (goes on my follow-ups)</label>
      ${AP_DATA&&AP_DATA.cmPush?`<label class="hint"><input type="checkbox" id="apKipu" checked/> 📤 Also chart to Kipu (Case Management note)</label>`:''}
      ${AP_DATA&&!AP_DATA.cmPush&&AP_DATA.cmPushUnavailable?`<button class="btn btn-ghost btn-sm sans" onclick="apCopyForKipu()" title="Kipu's API doesn't accept note writes yet — copy the composed note and paste it into the Case Management Progress Note in Kipu">📋 Copy note for Kipu</button>`:''}
      <button class="btn btn-gold btn-sm sans" onclick="apNoteSave('${mode}',${id})">Save &amp; close</button></div></div>`;
  h.scrollIntoView({behavior:'smooth',block:'nearest'});
}
// Kipu won't accept note writes over its API (Patient data only) — so compose the
// same chart note and put it on the clipboard for a two-tap paste into Kipu.
async function apCopyForKipu(){
  const dispBtn=document.querySelector('#apDisp .btn-gold');
  const topics=[...document.querySelectorAll('#apTop .btn-gold')].map(b=>b.dataset.v);
  const lines=['Case management session — '+today()+'.'];
  if(dispBtn) lines.push('Client presentation: '+dispBtn.dataset.v+'.');
  if(topics.length) lines.push('Areas addressed: '+topics.join(', ')+'.');
  const body=($('apBody2')||{}).value||''; if(body.trim()) lines.push(body.trim());
  lines.push('— '+(ME&&ME.name||''));
  try{ await navigator.clipboard.writeText(lines.join('\n\n')); alert('📋 Copied — open the client in Kipu → Case Management Progress Note → paste.'); }
  catch(e){ prompt('Copy the note:', lines.join(' | ')); }
}
async function apNoteSave(mode,id){
  const dispBtn=document.querySelector('#apDisp .btn-gold');
  const disp=dispBtn?dispBtn.dataset.v:'';
  const topics=[...document.querySelectorAll('#apTop .btn-gold')].map(b=>b.dataset.v);
  const body=($('apBody2')||{}).value||'';
  const payload={disposition:disp,topics,body,needs_expansion:($('apExpand')||{}).checked,push_kipu:!!($('apKipu')&&$('apKipu').checked)};
  try{
    let r;
    if(mode==='appt') r=await api('/appts/'+id+'/complete',{method:'POST',body:JSON.stringify(payload)});
    else r=await api('/appts/queue/'+id,{method:'POST',body:JSON.stringify({action:'done',...payload})});
    $('apModalHost').innerHTML=''; loadAppts();
    // The note is ALWAYS saved here first — report the Kipu push honestly either way.
    if(payload.push_kipu&&r&&r.kipu) alert(r.kipu.ok?'✓ Saved — and charted to Kipu.':'Saved here ✓ — but the Kipu push failed: '+(r.kipu.error||'unknown')+'\n\nThe note is safe in Armada; chart it in Kipu manually or fix the template config and try again.');
  }catch(e){ alert(e.message); }
}
function apMyDay(b){
  const d=AP_DATA;
  b.innerHTML=`${d.missed.length?`<h3 style="margin:12px 0 4px">Missed — keep the promise</h3>${d.missed.map(m=>`<div class="q-row q-overdue" style="cursor:default"><div class="q-main"><div class="q-title">${esc(m.client)} · ${esc(m.kind)} · was ${esc(m.date)} ${esc(m.time)}</div><div class="q-sub">${esc(m.staff_name||'')}</div></div><button class="btn btn-gold btn-sm sans" onclick="apMiss(${m.id})">Reschedule / reason</button></div>`).join('')}`:''}
    ${d.pending.length?`<h3 style="margin:12px 0 4px">Notes to expand</h3>${d.pending.map(p=>`<div class="q-row" style="cursor:default"><div class="q-main"><div class="q-title">${esc(p.client)} · ${esc(p.kind||'note')}</div><div class="q-sub">${esc(p.by)} · ${esc(p.at)}</div></div><button class="btn btn-ghost btn-sm sans" onclick="apExpandNote(${p.id})">Write full note</button></div>`).join('')}`:''}
    ${(!d.missed.length&&!d.pending.length)?'<div class="empty"><div class="e-ico">🌤</div>Nothing pending — every meeting documented, every miss handled.</div>':''}`;
}
async function apExpandNote(id){
  const body=prompt('Full case note (replaces the quick note body):'); if(body==null) return;
  try{ await api('/quicknotes/'+id,{method:'PATCH',body:JSON.stringify({body})}); }catch(e){ alert(e.message); }
  loadAppts();
}
const AP_DOWS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let AV_STAFF='';
function apAvail(b){
  const d=AP_DATA;
  const who=AV_STAFF||ME.name;
  b.innerHTML=`<div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:8px">
      <label class="hint">Staff <select id="avWho" onchange="AV_STAFF=this.value;apAvail($('apBody'))">${[ME.name,...d.staff.filter(s=>s!==ME.name)].map(s=>`<option ${s===who?'selected':''}>${esc(s)}</option>`).join('')}</select></label>
      <span class="hint">Working hours + the groups they run. Booking outside these warns before it promises.</span></div>
    <div id="avBody"><div class="skel" style="height:60px;margin-top:8px"></div></div>`;
  apAvailLoad(who);
}
async function apAvailLoad(who){
  const host=$('avBody'); if(!host) return;
  let d; try{ d=await api('/appts/staffsetup?staff='+encodeURIComponent(who)); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  const hrs={}; (d.hours||[]).forEach(h=>{ hrs[h.dow]={s:h.start_time,e:h.end_time}; });
  host.innerHTML=`<h3 style="margin:10px 0 4px">Working hours</h3>
    <table class="tbl nomcard" style="max-width:430px">${AP_DOWS.map((nm,i)=>`<tr><td style="width:60px"><label class="hint"><input type="checkbox" class="avOn" data-dow="${i}" ${hrs[i]?'checked':''}/> ${nm}</label></td>
      <td><input type="time" class="avS" data-dow="${i}" value="${hrs[i]?hrs[i].s:'08:00'}" style="width:105px"/></td>
      <td><input type="time" class="avE" data-dow="${i}" value="${hrs[i]?hrs[i].e:'16:00'}" style="width:105px"/></td></tr>`).join('')}</table>
    <h3 style="margin:14px 0 4px">Groups &amp; standing blocks</h3>
    <div id="avBlocks">${(d.blocks||[]).map(k=>apBlockRow(k)).join('')}</div>
    <button class="btn btn-ghost btn-sm sans" onclick="document.getElementById('avBlocks').insertAdjacentHTML('beforeend',apBlockRow({}))">＋ Add a block</button>
    <div class="toolbar" style="justify-content:flex-start;margin-top:10px"><button class="btn btn-gold btn-sm sans" onclick="apAvailSave('${who.replace(/'/g,"\\'")}')">Save availability</button><span id="avMsg" class="hint" style="align-self:center"></span></div>`;
}
function apBlockRow(k){
  return `<div class="toolbar avBlock" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin:4px 0">
    <select class="bDow"><option value="">One date…</option>${AP_DOWS.map((nm,i)=>`<option value="${i}" ${k.dow===i?'selected':''}>Every ${nm}</option>`).join('')}</select>
    <input type="date" class="bDate" value="${esc(k.date||'')}" style="width:140px"/>
    <input type="time" class="bS" value="${esc(k.start_time||'10:00')}" style="width:100px"/>
    <input type="time" class="bE" value="${esc(k.end_time||'11:00')}" style="width:100px"/>
    <input class="bL" placeholder="e.g. Men's Process Group" value="${esc(k.label||'')}" style="min-width:170px"/>
    <button class="btn btn-ghost btn-sm sans" onclick="this.closest('.avBlock').remove()">🗑</button></div>`;
}
async function apAvailSave(who){
  const hours=[];
  document.querySelectorAll('.avOn').forEach(c=>{ if(c.checked){ const dow=+c.dataset.dow; hours.push({dow,start_time:document.querySelector('.avS[data-dow="'+dow+'"]').value,end_time:document.querySelector('.avE[data-dow="'+dow+'"]').value}); } });
  const blocks=[...document.querySelectorAll('.avBlock')].map(r=>({dow:r.querySelector('.bDow').value===''?null:+r.querySelector('.bDow').value,date:r.querySelector('.bDate').value||null,start_time:r.querySelector('.bS').value,end_time:r.querySelector('.bE').value,label:r.querySelector('.bL').value})).filter(k=>(k.dow!=null||k.date)&&k.start_time&&k.end_time);
  try{ await api('/appts/staffsetup',{method:'POST',body:JSON.stringify({staff_name:who,hours,blocks})}); const m=$('avMsg'); if(m) m.textContent='✓ Saved — bookings now enforce this.'; }
  catch(e){ alert(e.message); }
}
function apSup(b){
  const s=(AP_DATA||{}).supervisor; if(!s){ b.innerHTML='<div class="hint">Leadership only.</div>'; return; }
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const best=s.staff.filter(x=>x.staff!=='(unassigned)' && (x.completed+x.notes)>0)[0];
  b.innerHTML=`<div class="ret-cards" style="margin-top:8px">
      ${box(s.promiseRate!=null?s.promiseRate+'%':'—','Promises kept (30d)',(s.promiseRate!=null&&s.promiseRate<90?'rc-elev':''))}
      ${box(s.docCompliance!=null?s.docCompliance+'%':'—','Meetings documented')}
      ${box(s.promisesMade,'Promises made')}
    </div>
    ${best?`<div class="oi-intel"><div class="oi-tag">Recognition</div><div style="font-size:13px;margin-top:3px">🏆 <strong>${esc(best.staff)}</strong> — ${best.completed} meetings kept, ${best.notes} notes${best.avgResponseMin!=null?', ~'+best.avgResponseMin+' min average response':''}. Consistency is the excellence — say it out loud at lineup.</div></div>`:''}
    <table class="tbl" style="margin-top:8px"><tr><th>Staff</th><th>Meetings kept</th><th>Missed</th><th>Notes</th><th>Notes on time</th><th>Avg response</th></tr>
    ${s.staff.map(x=>`<tr><td><strong>${esc(x.staff)}</strong></td><td>${x.completed}</td><td>${x.missed?`<span style="color:var(--crit)">${x.missed}</span>`:0}</td><td>${x.notes}</td><td>${x.notes?Math.round(x.notesFast/x.notes*100)+'%':'—'}</td><td>${x.avgResponseMin!=null?x.avgResponseMin+' min':'—'}</td></tr>`).join('')}</table>
    <div class="hint" style="margin-top:6px">Schulze's rule: excellence is a reliable SYSTEM, not heroics. These numbers coach process — a slow average response means the queue needs coverage, not that someone needs blame.</div>`;
}

/* ── BILLING READINESS — every client day needs one qualifying encounter.
   Dashboard + 4 PM alert workflow + admin mapping. Kipu is read-only here. ── */
let BR_DATE='', BR_FILTER='all', BR_DATA=null, BR_OPEN=null;
async function loadBillingReady(){
  const host=$('billingready'); if(!host) return;
  if(!BR_DATE) BR_DATE=today();
  host.innerHTML='<div class="card"><div class="skel" style="width:260px;height:22px;margin-bottom:14px"></div><div class="skel-tiles">'+'<div class="skel"></div>'.repeat(5)+'</div></div>';
  let d; try{ d=await api('/billingready?date='+BR_DATE); }catch(e){ host.innerHTML='<div class="card"><div class="empty"><div class="e-ico">⚠️</div>'+esc(e.message)+'</div></div>'; return; }
  BR_DATA=d;
  const s=d.summary||{};
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const stBadge=(r)=>({complete:'<span class="badge-ok">complete</span>',missing:'<span class="badge-crit">missing</span>',needs_review:'<span class="badge-warn">needs review</span>',exception:'<span class="badge-info">exception</span>',sync_error:'<span class="badge-crit">sync error</span>'}[r.status]||esc(r.status));
  const alBadge=(a)=>a?({open:'<span class="badge-crit">alert open</span>',ack:'<span class="badge-warn">acknowledged</span>',in_progress:'<span class="badge-info">in progress</span>',resolved:'<span class="badge-ok">resolved</span>',exception:'<span class="badge-idle">exception</span>'}[a]||''):'';
  const filters=[['all','All'],['missing','Missing'],['needs_review','Needs review'],['complete','Complete'],['sync_error','Sync errors'],['alerts','Open alerts']];
  let rows=d.rows||[];
  if(BR_FILTER==='alerts') rows=rows.filter(r=>r.alert&&!['resolved','exception'].includes(r.alert));
  else if(BR_FILTER!=='all') rows=rows.filter(r=>r.status===BR_FILTER);
  const rowH=(r)=>`<tr style="cursor:pointer" onclick="brOpen(${r.id})">
    <td><strong>${esc(r.client)}</strong>${r.admittedToday?' <span class="badge-info">admitted today</span>':''}${r.dischargedToday?' <span class="badge-idle">discharged today</span>':''}<div class="hint">${esc(r.kipu?('#'+r.kipu):'no chart')}${r.loc?' · '+esc(r.loc):''}${r.program?' · '+esc(r.program):''}</div></td>
    <td>${r.loc?'<span class="badge-info">'+esc(r.loc)+'</span> ':''}${stBadge(r)} ${alBadge(r.alert)}</td>
    <td>${r.status==='complete'?`<strong>${esc(r.type||'')}</strong><div class="hint">${esc(r.title||'')}${r.time?' · '+esc(r.time):''}${r.staff?' · '+esc(r.staff):''}</div>`:`<span class="hint">${esc(r.detail||r.exception||'')}</span>`}</td>
    <td class="hint">${esc(r.therapist||'')}</td><td class="hint">${esc(r.case_manager||'')}</td>
    <td>${r.notes?`💬${r.notes}`:''}${ME.role==='admin'&&r.status!=='complete'?` <button class="btn btn-ghost btn-sm sans" style="padding:2px 8px" title="Show exactly what Kipu has for this client today" onclick="event.stopPropagation();brWhy(${r.client_id},'${esc(r.client).replace(/'/g,"\\'")}')">🔬</button>`:''}</td></tr>`;
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">Billing Readiness</h3><p class="sub sans" style="margin:0">Every client day needs one qualifying encounter documented in Kipu. The check runs at ${(d.cfg&&d.cfg.checkHour)||16}:00 facility time — anything missing alerts the evening team. Kipu is read-only; notes live here.</p></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <label class="hint">Day <input type="date" id="brDate" value="${esc(BR_DATE)}" onchange="BR_DATE=this.value;loadBillingReady()"/></label>
        ${d.leadership?`<button class="btn btn-gold btn-sm sans" onclick="brRun(this)">▶ Run check now</button>`:''}
        ${d.leadership?`<a class="btn btn-ghost btn-sm sans" href="/api/billingready/export?since=${esc(BR_DATE)}&end=${esc(BR_DATE)}">⬇ CSV</a>`:''}
        ${ME.role==='admin'?`<button class="btn btn-ghost btn-sm sans" title="Check what Kipu returns for group sessions today" onclick="brGroupDiag(this)">🔬 Group diag</button>`:''}
      </div></div>
      <div id="brDiagOut"></div>
      ${!d.kipu?'<div class="banner-warn" style="margin-top:8px">⚠️ Kipu is not connected — every client shows as a sync error rather than silently complete.</div>':''}
      <div class="ret-cards" style="margin-top:8px">${box(s.active||0,'Active clients')}${box(s.complete||0,'Complete')}${box(s.missing||0,'Missing',(s.missing?'rc-high':''))}${box(s.review||0,'Needs review',(s.review?'rc-elev':''))}${box(s.pct!=null?s.pct+'%':'—','Completion')}${box(s.openAlerts||0,'Open alerts',(s.openAlerts?'rc-elev':''))}</div>
      <div class="hint" style="margin-top:6px">${d.lastRun?`Last checked ${esc(d.lastRun.at)} by ${esc(d.lastRun.by||'scheduler')}.`:'No check has run for this day yet.'}${s.errors?` <span style="color:var(--crit)">· ${s.errors} sync error${s.errors===1?'':'s'} — those clients are NOT confirmed complete.</span>`:''}</div>
    </div>
    <div class="card"><div class="chip-row" style="display:flex;gap:6px;flex-wrap:wrap">${filters.map(([k,l])=>`<button class="btn ${BR_FILTER===k?'btn-gold':'btn-ghost'} btn-sm sans" onclick="BR_FILTER='${k}';loadBillingReady()">${l}</button>`).join('')}</div>
      ${rows.length?`<table class="tbl" style="margin-top:8px"><tr><th>Client</th><th>Status</th><th>Today's encounter / why not</th><th>Therapist</th><th>Case manager</th><th></th></tr>${rows.map(rowH).join('')}</table>`
        :`<div class="empty"><div class="e-ico">${(d.rows||[]).length?'🔍':'📋'}</div>${(d.rows||[]).length?'Nothing matches this filter.':'No status rows for this day yet.'}${d.leadership&&!(d.rows||[]).length?'<div class="e-act"><button class="btn btn-gold btn-sm sans" onclick="brRun(this)">Run the check</button></div>':''}</div>`}</div>
    <div id="brDrawerHost"></div>
    ${d.runs&&d.runs.length?`<div class="card"><details><summary style="cursor:pointer"><strong>Check history</strong> <span class="hint">· audit trail</span></summary><table class="tbl" style="margin-top:6px"><tr><th>Date</th><th>Ran at</th><th>By</th><th>Active</th><th>Complete</th><th>Missing</th><th>Review</th><th>Errors</th></tr>${d.runs.map(r=>`<tr><td>${esc(r.date)}</td><td class="hint">${esc(r.ran_at)}</td><td class="hint">${esc(r.by_name||'')}</td><td>${r.active_n}</td><td>${r.complete_n}</td><td>${r.missing_n}</td><td>${r.review_n}</td><td>${r.error_n||0}</td></tr>`).join('')}</table></details></div>`:''}
    ${d.cfg?brSettingsCard(d.cfg):''}`;
}
/* Per-client "why": show exactly what Kipu has on this client's chart today —
   raw timestamps vs the Eastern day, group notes, and same-name twin rows. */
async function brWhy(clientId,label){
  const host=$('brDiagOut'); if(!host) return;
  host.innerHTML='<div class="card"><div class="hint">Reading '+esc(label||'client')+'’s chart from Kipu…</div></div>';
  try{
    const d=await api('/diag/client-day?client_id='+clientId+'&date='+encodeURIComponent(BR_DATE));
    const ch=d.chartNotes||{};
    const noteRow=(n)=>`<tr${n.onDate?' style="background:#e8f3ec"':''}><td>${esc(n.name)}</td><td class="hint">${esc(n.status||'')}</td><td class="hint">${esc(n.created_at||'')}</td><td>${esc(n.easternDay||'')} ${n.onDate?'✓ today':''}</td></tr>`;
    host.innerHTML=`<div class="card" style="border-left:4px solid var(--gold)"><h3 style="margin:0 0 4px">🔬 ${esc(d.client.name)} — what Kipu has for ${esc(d.day)}</h3>
      <div class="hint">Chart ${esc(d.client.kipu_id||'—')}${d.client.loc?' · '+esc(d.client.loc):''}</div>
      ${ch.ok?`<div style="overflow-x:auto"><table class="tbl" style="margin-top:8px"><tr><th>Note</th><th>Status</th><th>Kipu timestamp (UTC)</th><th>Counts toward</th></tr>${(ch.recent||[]).map(noteRow).join('')||'<tr><td colspan="4" class="hint">No notes on this chart at all.</td></tr>'}</table></div>`
        :`<div style="color:var(--danger);margin-top:6px">${esc(ch.error||'Chart read failed')}</div>`}
      ${(d.groupNotesToday||[]).length?`<div style="margin-top:6px"><strong class="sans" style="font-size:13px">Group sessions today:</strong> ${d.groupNotesToday.map(g=>esc(g.name)).join(' · ')}</div>`:'<div class="hint" style="margin-top:6px">No group sessions matched this client today.</div>'}
      ${(d.sameNameRows||[]).length?`<div style="margin-top:6px;color:#a35a23"><strong class="sans" style="font-size:13px">⚠ Same name on the roster:</strong> ${d.sameNameRows.map(t=>`row #${t.id} (chart ${esc((t.kipu_id||'none').split(':')[0])}${t.active?', active':t.discharged?', discharged '+esc(t.discharged):''})${(t.notesToday||[]).length?` — <strong style="color:#b3382f">HAS today's notes: ${t.notesToday.map(esc).join(', ')}</strong> ← the documentation landed on THIS chart`:''}`).join(' · ')}</div>`:''}
      <div class="hint" style="margin-top:8px">${esc(d.readThisWay||'')}</div></div>`;
  }catch(e){ host.innerHTML='<div class="card"><div style="color:var(--danger)">'+esc(e.message)+'</div></div>'; }
}
/* Group-notes diagnostic: shows plainly whether Kipu returned today's group
   sessions and whether the people in them match our roster ids. */
async function brGroupDiag(btn){
  const host=$('brDiagOut'); if(!host) return;
  if(btn){ btn.disabled=true; btn.textContent='Checking Kipu…'; }
  host.innerHTML='<div class="card"><div class="hint">Asking Kipu about group sessions for '+esc(BR_DATE)+'… (can take ~30 seconds)</div></div>';
  try{
    const d=await api('/diag/group-notes?date='+encodeURIComponent(BR_DATE));
    const k=d.whatKipuReturned||{}, m=d.merge||{}, r=d.roster||{};
    const verdict = k.error||m.error ? `<div style="color:var(--danger)"><strong>Kipu call failed:</strong> ${esc(k.error||m.error)}</div>`
      : !m.sessionsOnDate ? `<div style="color:#b3382f"><strong>Kipu returned NO group sessions for ${esc(d.day)}.</strong> It sent back ${k.totalReturned||0} session(s) across dates: ${esc((k.datesSeen||[]).join(', ')||'none')} — if today isn't in that list, Kipu is ignoring our date filter and I'll switch to a different query.</div>`
      : !r.matched ? `<div style="color:#b3382f"><strong>Kipu HAS ${m.sessionsOnDate} group session(s) today crediting ${m.patientsCredited} people — but none match our roster ids.</strong> Group records use different patient ids than the chart. Compare: group ids ${esc((m.attendeeIdSample||[]).join(', '))} vs roster ids in the sample below — send me a screenshot of this box.</div>`
      : `<div style="color:#2f7a4f"><strong>Working:</strong> ${m.sessionsOnDate} session(s) today · ${r.matched}/${r.active} active clients have a group note. Hit ▶ Run check now to re-judge the day.</div>`;
    host.innerHTML=`<div class="card" style="border-left:4px solid var(--gold)"><h3 style="margin:0 0 6px">🔬 Group-notes diagnostic — ${esc(d.day)}</h3>${verdict}
      <details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Full detail (for Claude)</summary><pre style="font-size:11px;overflow-x:auto;white-space:pre-wrap">${esc(JSON.stringify(d,null,2))}</pre></details></div>`;
  }catch(e){ host.innerHTML='<div class="card"><div style="color:var(--danger)">'+esc(e.message)+'</div></div>'; }
  if(btn){ btn.disabled=false; btn.textContent='🔬 Group diag'; }
}
function brSettingsCard(c){
  return `<div class="card"><details><summary style="cursor:pointer"><strong>⚙️ Qualifying-encounter mapping</strong> <span class="hint">· admin — how Kipu note types are judged</span></summary>
    <div class="hint" style="margin:6px 0">Case-insensitive contains-match on the Kipu note type name. Judged in order: Needs-review → Qualifying → Nursing (toggle) → Non-qualifying. <strong>Anything unmatched lands in Needs Review</strong> — nothing unknown ever counts as billable.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
      <label class="hint">Qualifying<textarea id="brQ" rows="5" style="width:100%">${esc((c.qualify||[]).join('\n'))}</textarea></label>
      <label class="hint">Non-qualifying<textarea id="brD" rows="5" style="width:100%">${esc((c.disqualify||[]).join('\n'))}</textarea></label>
      <label class="hint">Needs review<textarea id="brR" rows="5" style="width:100%">${esc((c.review||[]).join('\n'))}</textarea></label>
      <label class="hint">Nursing patterns<textarea id="brN" rows="5" style="width:100%">${esc((c.nursing||[]).join('\n'))}</textarea></label></div>
    <h4 style="margin:12px 0 2px">Per-level-of-care rules <span class="hint" style="font-weight:400">— the payor rulebook; a day bills only if a note matches the client's LOC list</span></h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
      ${Object.keys(c.locRules||{}).map(k=>`<label class="hint">${esc(k)}<textarea class="brLoc" data-loc="${esc(k)}" rows="4" style="width:100%">${esc((c.locRules[k]||[]).join('\n'))}</textarea></label>`).join('')}</div>
    <div class="toolbar" style="justify-content:flex-start;gap:10px;flex-wrap:wrap;margin-top:8px">
      <label class="hint"><input type="checkbox" id="brIA" ${c.intakeAssessment?'checked':''}/> Intake day requires Nurse Assessment + Action Order</label>
      <label class="hint"><input type="checkbox" id="brNQ" ${c.nursingQualifies?'checked':''}/> Nursing qualifies in the GLOBAL fallback (no-LOC charts)</label>
      <label class="hint"><input type="checkbox" id="brRC" ${c.requireCompleted?'checked':''}/> Note must be completed/signed</label>
      <label class="hint">Check hour <input type="number" id="brHour" value="${c.checkHour}" min="0" max="23" style="width:60px"/>:00</label>
      <label class="hint">Alert email <input id="brEmail" value="${esc(c.email||'')}" placeholder="defaults to ops list" style="min-width:200px"/></label>
      <button class="btn btn-gold btn-sm sans" onclick="brSaveCfg()">Save mapping</button></div></details></div>`;
}
async function brSaveCfg(){
  const lines=(id)=>(($(id)||{}).value||'').split('\n').map(x=>x.trim()).filter(Boolean);
  try{
    const locRules={};
    document.querySelectorAll('.brLoc').forEach(t=>{ locRules[t.dataset.loc]=t.value.split('\n').map(x=>x.trim()).filter(Boolean); });
    await api('/billingready/settings',{method:'POST',body:JSON.stringify({qualify:lines('brQ'),disqualify:lines('brD'),review:lines('brR'),nursing:lines('brN'),nursingQualifies:($('brNQ')||{}).checked,requireCompleted:($('brRC')||{}).checked,intakeAssessment:($('brIA')||{}).checked,checkHour:+(($('brHour')||{}).value||16),email:($('brEmail')||{}).value||'',locRules})});
    loadBillingReady();
  }catch(e){ alert(e.message); }
}
async function brRun(btn){
  btn.disabled=true; btn.textContent='Checking every chart…';
  try{ const r=await api('/billingready/run',{method:'POST',body:JSON.stringify({date:BR_DATE})}); if(r.error) alert(r.error); }catch(e){ alert(e.message); }
  loadBillingReady();
}
function brClose(){ const el=document.getElementById('brDrawer'); if(el) el.remove(); BR_OPEN=null; }
async function brOpen(id){
  brClose(); BR_OPEN=id;
  const r=(BR_DATA.rows||[]).find(x=>x.id===id); if(!r) return;
  let notes=[]; try{ notes=(await api('/billingready/notes/'+id)).notes||[]; }catch(_e){}
  const host=document.getElementById('brDrawerHost'); if(!host) return;
  const quick=['Therapist notified','Group note pending','Client absent / on pass','Evening staff assigned'];
  host.innerHTML=`<div class="card" id="brDrawer" style="border-left:4px solid var(--gold)">
    <div class="cmd-hero-row"><div><h3 style="margin:0">${esc(r.client)} <span class="hint" style="font-weight:400">· ${esc(BR_DATA.date)}${r.loc?' · '+esc(r.loc):''}</span></h3>
      <div class="hint">${r.therapist?'Therapist: '+esc(r.therapist)+' · ':''}${r.case_manager?'CM: '+esc(r.case_manager)+' · ':''}${r.status==='complete'?esc(r.type+' · '+(r.title||'')+(r.time?' · '+r.time:'')+(r.staff?' · '+r.staff:'')):esc(r.detail||'')}</div></div>
      <button class="iconbtn" onclick="brClose()">✕</button></div>
    <div class="oi-action">
      <button class="btn btn-ghost btn-sm sans" onclick="brSet(${id},'ack')">👁 Acknowledge</button>
      <button class="btn btn-ghost btn-sm sans" onclick="brSet(${id},'in_progress')">⏳ In progress</button>
      <button class="btn btn-gold btn-sm sans" onclick="brSet(${id},'resolved')">✓ Resolved</button>
      <button class="btn btn-ghost btn-sm sans" onclick="brException(${id})">Exception…</button></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${quick.map(q=>`<button class="btn btn-ghost btn-sm sans" onclick="brNote(${id},'${q.replace(/'/g,"\\'")}')">${q}</button>`).join('')}
      <input id="brNoteText" placeholder="Add a note…" style="min-width:180px"/><button class="btn btn-ghost btn-sm sans" onclick="brNote(${id},($('brNoteText')||{}).value)">Add</button></div>
    ${notes.length?`<div class="ops-feed" style="margin-top:8px">${notes.map(n=>`<div class="q-row"><div class="q-main"><div class="q-title">${esc(n.note)}</div><div class="q-sub">${esc(n.by_name||'')} · ${esc(n.at)}</div></div></div>`).join('')}</div>`:''}</div>`;
  host.scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function brSet(id,state){ try{ await api('/billingready/alert/'+id,{method:'POST',body:JSON.stringify({state})}); }catch(e){ alert(e.message);} loadBillingReady(); }
async function brException(id){ const reason=prompt('Exception reason (e.g. client on pass, admitted 11pm):'); if(!reason) return; try{ await api('/billingready/alert/'+id,{method:'POST',body:JSON.stringify({state:'exception',note:reason})}); }catch(e){ alert(e.message);} loadBillingReady(); }
async function brNote(id,text){ if(!String(text||'').trim()) return; try{ await api('/billingready/alert/'+id,{method:'POST',body:JSON.stringify({note:text})}); }catch(e){ alert(e.message);} brOpen(id); }

function authNote(html){ const m=$('authMsg'); if(m) m.innerHTML='<div class="pc-note" style="margin-top:6px">'+html+'</div>'; }
async function authKipuSync(btn){
  btn.disabled=true; btn.textContent='⟳ Pulling…';
  try{
    const r=await api('/auth-register/sync-kipu',{method:'POST'});
    authNote(`Kipu UR pull: <strong>${r.created} new</strong>, ${r.updated} updated · ${r.checked}/${r.clients} charts read${r.skipped?` · ${r.skipped} rows skipped (unrecognized shape)`:''}${(r.errors&&r.errors.length)?`<div class="hint">${r.errors.map(esc).join('<br>')}</div>`:''}`);
    if(r.created||r.updated) loadAuthReg(); else { btn.disabled=false; btn.textContent='⟳ Pull from Kipu'; }
  }catch(e){ authNote('⚠️ '+esc(e.message)); btn.disabled=false; btn.textContent='⟳ Pull from Kipu'; }
}
async function authRunReminders(btn){
  btn.disabled=true;
  try{
    const r=await api('/auth-register/run-reminders',{method:'POST'});
    authNote(r.sent?`✉️ Watch email sent — ${r.expired||0} expired, ${r.dueSoon||0} in the window.`:`Watch ran: ${esc(r.reason||'nothing newly due')}.`);
  }catch(e){ authNote('⚠️ '+esc(e.message)); }
  btn.disabled=false;
}
async function authSaveEmail(){
  try{ await api('/auth-register/settings',{method:'POST',body:JSON.stringify({email:($('authEmailSet')||{}).value||''})}); authNote('✓ UR watch recipients saved.'); }catch(e){ alert(e.message); }
}
async function loadFacilityEditor(){
  const host=$('ownFacilities'); if(!host) return;
  let d; try{ d=await api('/facilities'); }catch(e){ host.textContent=e.message; return; }
  const fs=d.facilities||[];
  host.innerHTML=fs.map((f,i)=>`<div class="pc-note" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><strong style="min-width:180px">${esc(f.label)}</strong><span class="hint">${esc(f.connection)}·${esc(f.type)}</span> <label class="hint">Kipu location <input data-fi="${i}" class="ownLoc" value="${esc(f.locationName||'')}" placeholder="exact Kipu name" style="min-width:180px"/></label></div>`).join('')
    +`<div class="toolbar" style="justify-content:flex-start;margin-top:6px"><button class="btn btn-gold btn-sm sans" onclick="saveFacilities()">Save mapping</button><span id="ownFacMsg" class="hint" style="align-self:center"></span></div>`;
  host._facs=fs;
}
async function saveFacilities(){
  const host=$('ownFacilities'); const fs=(host._facs||[]).map((f,i)=>({...f, locationName:(document.querySelector('.ownLoc[data-fi="'+i+'"]')||{}).value||''}));
  const m=$('ownFacMsg'); if(m)m.textContent='Saving…';
  try{ await api('/facilities',{method:'POST',body:JSON.stringify({facilities:fs})}); if(m)m.textContent='✓ Saved'; loadOwnership(); }
  catch(e){ if(m)m.textContent=e.message; }
}
function previewAsRole(role){
  if(!ROLE_MENU[role]){ alert('No focused menu defined for '+role+' yet.'); return; }
  PREVIEW_ROLE=role;
  showPreviewBanner(role);
  renderGroups();
  show(ROLE_MENU[role][0]);
}
function previewAsChava(){ previewAsRole('Executive Assistant'); }
function exitPreview(){
  PREVIEW_ROLE=null;
  const b=document.getElementById('previewBanner'); if(b) b.remove();
  const sel=document.getElementById('previewSel'); if(sel) sel.value='';
  renderGroups();
  show(ME&&ME.role==='admin'?'opscenter':'dashboard');
}
function showPreviewBanner(role){
  let b=document.getElementById('previewBanner');
  if(!b){ b=document.createElement('div'); b.id='previewBanner'; b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#5b3fa0;color:#fff;padding:9px 14px;text-align:center;font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 -2px 10px rgba(0,0,0,.25)'; document.body.appendChild(b); }
  b.innerHTML='👁 Previewing as <strong>'+esc(role||'Executive Assistant')+'</strong> — exactly what they see, in their order. <button onclick="exitPreview()" style="margin-left:10px;background:#fff;color:#5b3fa0;border:none;border-radius:5px;padding:5px 12px;cursor:pointer;font-weight:700">Exit preview</button>';
}
/* ───────── HCOS — Human Capital Operating System (HR command center) ───────── */
let HCOS_TAB='dashboard', HCOS_PERSON=null, HCOS_PEOPLE=[];
async function loadHcos(){
  const host=$('hcos'); if(!host) return;
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">👥 HR — People OS</h3><p class="sub sans" style="margin:0">The whole employee lifecycle — hiring to onboarding to reviews, coaching, relations, certifications, and leave — in one command center.</p></div></div>
    <div class="corp-tabs" id="hcosTabs">
      ${['dashboard|📊 Dashboard','people|👤 People','reviews|📝 Reviews','relations|⚖️ Relations','certs|🎓 Certifications','leave|🌴 Leave','ask|🤖 Ask AI'].map(t=>{const[k,l]=t.split('|');return `<button class="${HCOS_TAB===k?'active':''}" onclick="hcosTab('${k}')">${l}</button>`;}).join('')}
    </div></div>
    <div id="hcosBody"><div class="hint">Loading…</div></div>`;
  if(!loadHcos._obs){ let t=null; loadHcos._obs=new MutationObserver(()=>{ clearTimeout(t); t=setTimeout(corpDecorateTables,60); }); loadHcos._obs.observe(host,{childList:true,subtree:true}); }
  renderHcosTab();
}
function hcosTab(k){ HCOS_TAB=k; HCOS_PERSON=null; document.querySelectorAll('#hcosTabs button').forEach(b=>b.classList.toggle('active', b.getAttribute('onclick').includes("'"+k+"'"))); renderHcosTab(); }
async function renderHcosTab(){
  const body=$('hcosBody'); if(!body) return; body.innerHTML='<div class="hint">Loading…</div>';
  if(HCOS_TAB==='dashboard') return renderHcosDash(body);
  if(HCOS_TAB==='people') return renderHcosPeople(body);
  if(HCOS_TAB==='reviews') return renderHcosReviews(body);
  if(HCOS_TAB==='relations') return renderHcosRelations(body);
  if(HCOS_TAB==='certs') return renderHcosCerts(body);
  if(HCOS_TAB==='leave') return renderHcosLeave(body);
  if(HCOS_TAB==='ask') return renderHcosAsk(body);
}
async function renderHcosDash(body){
  let d; try{ d=await api('/hcos/overview'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const box=(n,l,tab,col)=>`<div class="ret-card" ${tab?`style="cursor:pointer" onclick="hcosTab('${tab}')"`:''}><div class="n"${col?` style="color:${col}"`:''}>${n}</div><div class="l">${l}</div></div>`;
  const taskRow=(t)=>`<div class="pc-note">☐ <strong>${esc(t.task)}</strong> — ${esc(t.first_name+' '+t.last_name)} <span class="hint">· due ${esc(t.due_date||'')}</span></div>`;
  body.innerHTML=`
    <div class="ret-cards" style="margin-top:4px">
      ${box(d.headcount,'Employees','people')}${box(d.pipelineTotal,'In hiring pipeline')}${box(d.newHires,'New hires this month','people')}${box(d.onboarding.length,'In onboarding','people',(d.onboarding.length?'#a60':''))}
      ${box(d.reviewsOverdue,'Reviews overdue','reviews',(d.reviewsOverdue?'var(--danger)':'var(--good)'))}${box(d.certsExpiring.length,'Certs expiring ≤60d','certs',(d.certsExpiring.length?'#a60':'var(--good)'))}${box(d.openCases,'Open HR cases','relations',(d.openCases?'#a60':''))}${box(d.onLeave,'On leave today','leave')}
      ${box(d.leaveRequests,'Leave requests','leave',(d.leaveRequests?'#a60':''))}${box(d.coachingMonth,'Coaching notes this month')}</div>
    ${d.tasksToday.length?`<div class="card" style="border-left:4px solid var(--gold)"><h3 style="margin-top:0">📥 HR inbox — due now <span class="hint" style="font-weight:400">· ${d.tasksToday.length}</span></h3>${d.tasksToday.slice(0,12).map(taskRow).join('')}<div class="hint" style="margin-top:4px">Open the person in 👤 People to check items off.</div></div>`:''}
    ${d.reviewsDue.length?`<div class="card"><h3 style="margin-top:0">📝 Reviews due in 14 days</h3><table class="tbl"><tr><th>Employee</th><th>Review</th><th>Due</th></tr>${d.reviewsDue.map(r=>`<tr><td><strong>${esc(r.first_name+' '+r.last_name)}</strong><div class="hint">${esc(r.entity)}</div></td><td>${esc(r.type)}</td><td style="color:${r.due_date<d.today?'var(--danger)':'inherit'}">${esc(r.due_date)}</td></tr>`).join('')}</table></div>`:''}
    ${d.certsExpiring.length?`<div class="card"><h3 style="margin-top:0">🎓 Certifications expiring</h3><table class="tbl"><tr><th>Employee</th><th>Certification</th><th>Expires</th></tr>${d.certsExpiring.map(c=>`<tr><td><strong>${esc(c.first_name+' '+c.last_name)}</strong><div class="hint">${esc(c.entity)}</div></td><td>${esc(c.name)}</td><td style="color:${c.expires<d.today?'var(--danger)':'#a60'}">${esc(c.expires)}</td></tr>`).join('')}</table></div>`:''}
    ${d.onboarding.length?`<div class="card"><h3 style="margin-top:0">🚀 Onboarding in progress</h3>${d.onboarding.map(o=>{const pct=o.total?Math.round(o.done/o.total*100):0;return `<div class="pc-note" style="cursor:pointer" onclick="openHcosPerson(${o.id})"><strong>${esc(o.first_name+' '+o.last_name)}</strong> <span class="hint">· ${esc(o.entity)}${o.hire_date?' · hired '+esc(o.hire_date):''}</span><div style="background:var(--line);border-radius:6px;height:8px;margin-top:5px"><div style="width:${pct}%;background:var(--good);height:8px;border-radius:6px"></div></div><span class="hint">${o.done}/${o.total} · ${pct}%</span></div>`;}).join('')}</div>`:''}
    ${(d.pipeline||[]).length?`<div class="card"><h3 style="margin-top:0">🧲 Hiring pipeline <span class="hint" style="font-weight:400">· <a href="#" onclick="show('hiring');return false">open Hiring ↗</a></span></h3><div class="hint">${d.pipeline.map(p=>`<strong>${esc(p.stage)}</strong>: ${p.n}`).join(' &nbsp;·&nbsp; ')}</div></div>`:''}`;
}
async function renderHcosPeople(body){
  let d; try{ d=await api('/hcos/people'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  HCOS_PEOPLE=d.people||[];
  const q=(window._hcosQ||'').toLowerCase(); const loc=window._hcosLoc||'';
  let rows=HCOS_PEOPLE.filter(p=>(!q||((p.first_name+' '+p.last_name+' '+(p.job_title||'')).toLowerCase().includes(q)))&&(!loc||p.entity===loc));
  body.innerHTML=`<div class="card"><div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
      <input placeholder="Search name or title (Enter)" value="${esc(window._hcosQ||'')}" onchange="window._hcosQ=this.value;renderHcosTab()" style="min-width:180px"/>
      <select onchange="window._hcosLoc=this.value;renderHcosTab()"><option value="">All locations</option>${(d.locations||[]).map(l=>`<option ${loc===l?'selected':''}>${esc(l)}</option>`).join('')}</select></div>
    <table class="tbl"><tr><th>Employee</th><th>Title</th><th>Hired</th><th></th></tr>${rows.map(p=>`<tr><td><strong>${esc(p.first_name+' '+p.last_name)}</strong><div class="hint">${esc(p.entity)}</div></td><td class="hint">${esc(p.job_title||'')}</td><td class="hint">${esc(p.hire_date||'—')}</td><td><button class="btn btn-gold btn-sm sans" onclick="openHcosPerson(${p.id})">Open</button></td></tr>`).join('')}</table></div>`;
}
async function openHcosPerson(id){
  HCOS_PERSON=id; const body=$('hcosBody'); if(!body) return;
  body.innerHTML='<div class="hint">Loading profile…</div>';
  let d; try{ d=await api('/hcos/person/'+id); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const e=d.employee;
  const name=esc((e.first_name||'')+' '+(e.last_name||''));
  const obDone=d.onboard.filter(t=>t.done).length, obPct=d.onboard.length?Math.round(obDone/d.onboard.length*100):null;
  const certRow=(c)=>{const days=c.expires?Math.round((Date.parse(c.expires)-Date.now())/864e5):null;return `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.expires||'—')}${days!=null?` <span style="color:${days<0?'var(--danger)':days<=30?'#a60':'var(--good)'}">(${days<0?Math.abs(days)+'d over':days+'d'})</span>`:''}</td><td>${c.doc_url?`<a href="${esc(c.doc_url)}" target="_blank" rel="noopener">📄</a>`:''}</td><td><button class="btn btn-ghost btn-sm sans" onclick="delHcosCert(${c.id},${e.id})">🗑</button></td></tr>`;};
  const evIcon={onboarding:'🚀',review:'📝',coaching:'💬','case':'⚖️',leave:'🌴',certification:'🎓'};
  body.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">${name}</h3><p class="sub sans" style="margin:0">${esc(e.job_title||'no title')} · ${esc(e.entity)}${e.hire_date?' · hired '+esc(e.hire_date):''}${e.manager?' · mgr '+esc(e.manager):''}</p></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm sans" onclick="hcosTab('people')">← People</button>${!d.onboard.length?`<button class="btn btn-gold btn-sm sans" onclick="startOnboarding(${e.id})">🚀 Start onboarding</button>`:''}</div></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px">
      <label class="hint">Hire date<br><input id="hpHire" type="date" value="${esc((e.hire_date||'').slice(0,10))}"/></label>
      <label class="hint">Title<br><input id="hpTitle" value="${esc(e.job_title||'')}"/></label>
      <label class="hint">Department<br><input id="hpDept" value="${esc(e.department||'')}"/></label>
      <label class="hint">Manager<br><input id="hpMgr" value="${esc(e.manager||'')}"/></label>
      <label class="hint">Email<br><input id="hpEmail" value="${esc(e.email||'')}"/></label>
      <label class="hint">Phone<br><input id="hpPhone" value="${esc(e.phone||'')}"/></label>
      <button class="btn btn-gold btn-sm sans" onclick="saveHcosPerson(${e.id})">Save</button><span id="hpMsg" class="hint" style="align-self:center"></span></div></div>
  ${d.onboard.length?`<div class="card"><h3 style="margin-top:0">🚀 Onboarding <span class="hint" style="font-weight:400">· ${obDone}/${d.onboard.length} (${obPct}%)</span></h3>${d.onboard.map(t=>`<div class="pc-note" style="cursor:pointer;${t.done?'opacity:.55':''}" onclick="toggleObTask(${t.id},${e.id})">${t.done?'✅':'☐'} ${esc(t.task)} <span class="hint">· due ${esc(t.due_date||'')}</span></div>`).join('')}</div>`:''}
  <div class="card"><h3 style="margin-top:0">📝 Reviews</h3>
    ${d.reviews.length?`<table class="tbl"><tr><th>Review</th><th>Due</th><th>Status</th><th></th></tr>${d.reviews.map(r=>`<tr><td><strong>${esc(r.type)}</strong>${r.summary?`<div class="hint">${esc(r.summary.slice(0,140))}</div>`:''}</td><td>${esc(r.due_date||'')}</td><td>${r.status==='done'?`<span style="color:var(--good)">✓ done${r.rating?' · '+r.rating+'/10':''}</span>`:'<span class="hint">open</span>'}</td><td>${r.status==='open'?`<button class="btn btn-gold btn-sm sans" onclick="completeReview(${r.id},${e.id})">Complete</button>`:''}</td></tr>`).join('')}</table>`:'<div class="hint">No reviews scheduled — Start onboarding schedules the 30/60/90/6-month/annual cadence.</div>'}</div>
  <div class="card"><h3 style="margin-top:0">💬 Coaching log</h3>
    <p class="sub sans" style="margin:0 0 6px">Coach from the written standard, never by mood — pick the principle or the “What Excellence Is Not” line the conversation points at.</p>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"><select id="hcKind"><option>positive</option><option>corrective</option><option>observation</option></select><select id="hcStd" style="max-width:320px"><option value="">Standard (optional)</option></select><input id="hcNote" placeholder="What happened / what was coached" style="min-width:220px"/><label class="hint">Follow up <input id="hcFollow" type="date"/></label><button class="btn btn-gold btn-sm sans" onclick="addCoaching(${e.id})">Log</button></div>
    ${d.coaching.map(c=>`<div class="pc-note">${c.kind==='positive'?'🌟':c.kind==='corrective'?'🔧':'👁'} ${esc(c.note)}${c.standard?` <span class="badge" style="background:#faf6ee;border:1px solid #e7d9b6;color:#8a6d1f">${esc(c.standard.slice(0,70))}</span>`:''} <span class="hint">· ${esc(c.by_name||'')} · ${esc((c.created_at||'').slice(0,10))}</span>${c.follow_up&&!c.followed_up_at?` <span class="risk risk-elev">follow up ${esc(c.follow_up)}</span> <button class="btn btn-ghost btn-sm sans" onclick="coachingFollowedUp(${c.id},${e.id})">✓ Circled back</button>`:c.follow_up?` <span class="hint">✓ followed up</span>`:''}</div>`).join('')||'<div class="hint">No coaching notes yet — great managers log the positive ones too.</div>'}</div>
  <div class="card"><h3 style="margin-top:0">🎓 Certifications</h3>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"><input id="hcCertName" placeholder="e.g. CPR, HIPAA, RN license" style="min-width:160px"/><label class="hint">Expires <input id="hcCertExp" type="date"/></label><input id="hcCertUrl" placeholder="Link to copy (optional)" style="min-width:140px"/><button class="btn btn-gold btn-sm sans" onclick="addHcosCert(${e.id})">Add</button></div>
    ${d.certs.length?`<table class="tbl"><tr><th>Certification</th><th>Expires</th><th>Copy</th><th></th></tr>${d.certs.map(certRow).join('')}</table>`:'<div class="hint">None on file.</div>'}</div>
  <div class="card"><h3 style="margin-top:0">⚖️ Cases ${d.cases.length?`<span class="hint" style="font-weight:400">· ${d.cases.filter(c=>c.status==='open').length} open</span>`:''}</h3>
    ${d.cases.map(c=>`<div class="pc-note"><strong>${esc(c.kind)}</strong>: ${esc(c.title)} ${c.status==='open'?'<span class="risk risk-elev">open</span>':'<span style="color:var(--good)">resolved</span>'}${c.detail?`<div class="hint">${esc(c.detail.slice(0,200))}</div>`:''}${c.status==='open'?`<div style="margin-top:4px"><button class="btn btn-ghost btn-sm sans" onclick="resolveCase(${c.id},${e.id})">Resolve</button></div>`:''}</div>`).join('')||'<div class="hint">No cases — as it should be.</div>'}
    <div class="hint" style="margin-top:4px">New write-up / PIP: use the ⚖️ Relations tab.</div></div>
  <div class="card"><h3 style="margin-top:0">🕐 Timeline</h3>${d.events.map(v=>`<div class="hint" style="padding:3px 0">${evIcon[v.kind]||'•'} ${esc(v.detail||v.kind)} <span style="color:var(--muted)">· ${esc(v.by_name||'')} · ${esc((v.created_at||'').slice(0,16))}</span></div>`).join('')||'<div class="hint">Nothing logged yet.</div>'}</div>`;
  fillStdSelect('hcStd', e.job_title);   // coach from the written standard — their chapter's lines first
}
async function saveHcosPerson(id){ const g=x=>($(x)||{}).value; try{ await api('/hcos/person/'+id,{method:'POST',body:JSON.stringify({hire_date:g('hpHire'),job_title:g('hpTitle'),department:g('hpDept'),manager:g('hpMgr'),email:g('hpEmail'),phone:g('hpPhone')})}); if($('hpMsg'))$('hpMsg').textContent='✓ Saved'; }catch(e){ if($('hpMsg'))$('hpMsg').textContent=e.message; } }
async function startOnboarding(id){ const hd=($('hpHire')||{}).value||''; try{ await api('/hcos/person/'+id+'/start-onboarding',{method:'POST',body:JSON.stringify({hire_date:hd})}); openHcosPerson(id); }catch(e){ alert(e.message); } }
async function toggleObTask(tid,eid){ try{ await api('/hcos/onboard/task/'+tid+'/toggle',{method:'POST'}); openHcosPerson(eid); }catch(e){ alert(e.message); } }
async function completeReview(rid,eid){ const rating=prompt('Rating 1–10 (optional):')||''; const summary=prompt('Summary (what was discussed / plan):')||''; try{ await api('/hcos/review/'+rid+'/complete',{method:'POST',body:JSON.stringify({rating,summary})}); if(eid)openHcosPerson(eid); }catch(e){ alert(e.message); } }
async function addCoaching(eid){ const note=($('hcNote')||{}).value||''; if(!note.trim())return; try{ await api('/hcos/coaching',{method:'POST',body:JSON.stringify({employee_id:eid,kind:($('hcKind')||{}).value,note,standard:($('hcStd')||{}).value||'',follow_up:($('hcFollow')||{}).value||''})}); openHcosPerson(eid); }catch(e){ alert(e.message); } }
async function coachingFollowedUp(cid,eid){ try{ await api('/hcos/coaching/'+cid+'/followup',{method:'POST'}); openHcosPerson(eid); }catch(e){ alert(e.message); } }
async function addHcosCert(eid){ const name=($('hcCertName')||{}).value||''; if(!name.trim())return; try{ await api('/hcos/cert',{method:'POST',body:JSON.stringify({employee_id:eid,name,expires:($('hcCertExp')||{}).value||'',doc_url:($('hcCertUrl')||{}).value||''})}); openHcosPerson(eid); }catch(e){ alert(e.message); } }
async function delHcosCert(cid,eid){ if(!confirm('Remove this certification?'))return; try{ await api('/hcos/cert/'+cid,{method:'DELETE'}); openHcosPerson(eid); }catch(e){ alert(e.message); } }
async function resolveCase(cid,eid){ const resolution=prompt('Resolution / outcome:')||''; try{ await api('/hcos/case/'+cid+'/resolve',{method:'POST',body:JSON.stringify({resolution})}); if(eid)openHcosPerson(eid);else renderHcosTab(); }catch(e){ alert(e.message); } }
async function renderHcosReviews(body){
  let d; try{ d=await api('/hcos/overview'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  body.innerHTML=`<div class="card"><h3 style="margin-top:0">📝 Reviews due <span class="hint" style="font-weight:400">· next 14 days${d.reviewsOverdue?` · <span style="color:var(--danger)">${d.reviewsOverdue} overdue</span>`:''}</span></h3>
    ${d.reviewsDue.length?`<table class="tbl"><tr><th>Employee</th><th>Review</th><th>Due</th><th></th></tr>${d.reviewsDue.map(r=>`<tr><td><strong>${esc(r.first_name+' '+r.last_name)}</strong><div class="hint">${esc(r.entity)}</div></td><td>${esc(r.type)}</td><td style="color:${r.due_date<d.today?'var(--danger)':'inherit'}">${esc(r.due_date)}</td><td><button class="btn btn-gold btn-sm sans" onclick="completeReview(${r.id},0);setTimeout(renderHcosTab,400)">Complete</button></td></tr>`).join('')}</table>`:'<div class="hint">Nothing due in the next two weeks. 🎉</div>'}
    <div class="hint" style="margin-top:6px">Reviews are scheduled automatically (30/60/90/6-month/annual) when onboarding starts. Open a person in 👤 People to see their full cadence.</div></div>`;
}
async function renderHcosRelations(body){
  let d; try{ d=await api('/hcos/cases'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  if(!HCOS_PEOPLE.length){ try{ const p=await api('/hcos/people'); HCOS_PEOPLE=p.people||[]; }catch(_e){} }
  const kinds=['Verbal','Written','Final Written','Suspension','Termination','PIP','Complaint','Investigation'];
  const cases=d.cases||[];
  body.innerHTML=`<div class="card"><h3 style="margin-top:0">⚖️ New case <span class="hint" style="font-weight:400">— progressive discipline: Verbal → Written → Final → Suspension → Termination</span></h3>
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
        <select id="caseEmp">${HCOS_PEOPLE.map(p=>`<option value="${p.id}">${esc(p.first_name+' '+p.last_name)} — ${esc(p.entity)}</option>`).join('')}</select>
        <select id="caseKind">${kinds.map(k=>`<option>${k}</option>`).join('')}</select>
        <input id="caseTitle" placeholder="Title (e.g. Attendance — 3rd no-call)" style="min-width:200px"/>
        <input id="caseDetail" placeholder="Details — facts, dates, witnesses, expectations" style="width:100%"/>
        <button class="btn btn-gold sans" onclick="addHcosCase()">Create case</button></div><span id="caseMsg" class="hint"></span></div>
    <div class="card"><h3 style="margin-top:0">Cases <span class="hint" style="font-weight:400">· ${cases.filter(c=>c.status==='open').length} open</span></h3>
      ${cases.length?`<table class="tbl"><tr><th>Employee</th><th>Type</th><th>Case</th><th>Status</th><th></th></tr>${cases.map(c=>`<tr><td><strong>${esc(c.first_name+' '+c.last_name)}</strong><div class="hint">${esc(c.entity)}</div></td><td>${esc(c.kind)}</td><td>${esc(c.title)}${c.detail?`<div class="hint">${esc(c.detail.slice(0,120))}</div>`:''}</td><td>${c.status==='open'?'<span class="risk risk-elev">open</span>':'<span style="color:var(--good)">resolved</span>'}</td><td>${c.status==='open'?`<button class="btn btn-ghost btn-sm sans" onclick="resolveCase(${c.id},0);setTimeout(renderHcosTab,400)">Resolve</button>`:''}</td></tr>`).join('')}</table>`:'<div class="hint">No cases on record.</div>'}</div>`;
}
async function addHcosCase(){ const b={employee_id:($('caseEmp')||{}).value,kind:($('caseKind')||{}).value,title:($('caseTitle')||{}).value||'',detail:($('caseDetail')||{}).value||''}; if(!b.title.trim()){ if($('caseMsg'))$('caseMsg').textContent='Add a title.'; return; } try{ await api('/hcos/case',{method:'POST',body:JSON.stringify(b)}); renderHcosTab(); }catch(e){ if($('caseMsg'))$('caseMsg').textContent=e.message; } }
async function renderHcosCerts(body){
  let d; try{ d=await api('/hcos/overview'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  body.innerHTML=`<div class="card"><h3 style="margin-top:0">🎓 Certifications expiring ≤60 days <span class="hint" style="font-weight:400">· auto-emails HR at 60/30/14/7/1 days</span></h3>
    ${d.certsExpiring.length?`<table class="tbl"><tr><th>Employee</th><th>Certification</th><th>Expires</th></tr>${d.certsExpiring.map(c=>`<tr><td><strong>${esc(c.first_name+' '+c.last_name)}</strong><div class="hint">${esc(c.entity)}</div></td><td>${esc(c.name)}</td><td style="color:${c.expires<d.today?'var(--danger)':'#a60'};font-weight:600">${esc(c.expires)}</td></tr>`).join('')}</table>`:'<div class="hint">Nothing expiring in 60 days. Add certifications on each person’s profile (👤 People → open → Certifications) and the watch takes over.</div>'}</div>`;
}
async function renderHcosLeave(body){
  let d; try{ d=await api('/hcos/leave'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  if(!HCOS_PEOPLE.length){ try{ const p=await api('/hcos/people'); HCOS_PEOPLE=p.people||[]; }catch(_e){} }
  const kinds=['PTO','Vacation','Sick','FMLA','Bereavement','Jury Duty','Parental','Military'];
  const lv=d.leave||[];
  const pill=(s)=>s==='requested'?'<span class="risk risk-elev">requested</span>':s==='approved'?'<span style="color:var(--good)">✓ approved</span>':'<span class="hint">denied</span>';
  body.innerHTML=`<div class="card"><details ${lv.length?'':'open'}><summary><strong>＋ Log a leave request</strong></summary><div style="margin-top:8px">
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
        <select id="lvEmp">${HCOS_PEOPLE.map(p=>`<option value="${p.id}">${esc(p.first_name+' '+p.last_name)} — ${esc(p.entity)}</option>`).join('')}</select>
        <select id="lvKind">${kinds.map(k=>`<option>${k}</option>`).join('')}</select>
        <label class="hint">From <input id="lvStart" type="date"/></label>
        <label class="hint">To <input id="lvEnd" type="date"/></label>
        <input id="lvNotes" placeholder="Notes" style="min-width:140px"/>
        <button class="btn btn-gold btn-sm sans" onclick="addHcosLeave()">Add</button></div></div></details></div>
    <div class="card"><h3 style="margin-top:0">🌴 Leave</h3>
      ${lv.length?`<table class="tbl"><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Status</th><th></th></tr>${lv.map(l=>`<tr><td><strong>${esc(l.first_name+' '+l.last_name)}</strong><div class="hint">${esc(l.entity)}</div></td><td>${esc(l.kind)}</td><td>${esc(l.start_date)} → ${esc(l.end_date)}</td><td>${pill(l.status)}</td><td>${l.status==='requested'?`<button class="btn btn-gold btn-sm sans" onclick="decideLeave(${l.id},'approved')">Approve</button> <button class="btn btn-ghost btn-sm sans" onclick="decideLeave(${l.id},'denied')">Deny</button>`:''}</td></tr>`).join('')}</table>`:'<div class="hint">No leave on record.</div>'}</div>`;
}
async function addHcosLeave(){ const b={employee_id:($('lvEmp')||{}).value,kind:($('lvKind')||{}).value,start_date:($('lvStart')||{}).value,end_date:($('lvEnd')||{}).value,notes:($('lvNotes')||{}).value||''}; try{ await api('/hcos/leave',{method:'POST',body:JSON.stringify(b)}); renderHcosTab(); }catch(e){ alert(e.message); } }
async function decideLeave(id,status){ try{ await api('/hcos/leave/'+id+'/decide',{method:'POST',body:JSON.stringify({status})}); renderHcosTab(); }catch(e){ alert(e.message); } }
async function renderHcosAsk(body){
  body.innerHTML=`<div class="card" style="background:#faf6ee;border-left:4px solid var(--gold)"><h3 style="margin-top:0">🤖 HR copilot</h3>
    <p class="sub sans" style="margin:0 0 6px">Ask anything about your people — answers come from the live HR data.</p>
    <div class="toolbar" style="justify-content:flex-start;gap:6px"><input id="hrQ" placeholder="Who needs reviews this week?" style="flex:1;min-width:200px" onkeydown="if(event.key==='Enter')askHcos()"/><button class="btn btn-gold btn-sm sans" onclick="askHcos()">Ask</button></div>
    <div class="toolbar chip-row" style="justify-content:flex-start;gap:4px;margin-top:4px">${['Who needs reviews this week?','Whose certifications expire soon?','Who is on leave right now?','Summarize open HR cases','Who was hired in the last 60 days?','Draft a PIP for attendance issues'].map(s=>`<button class="btn btn-ghost btn-sm sans" style="font-size:11px" onclick="$('hrQ').value=this.textContent;askHcos()">${esc(s)}</button>`).join('')}</div>
    <div id="hrAns"></div></div>`;
}
async function askHcos(){
  const q=($('hrQ')||{}).value||''; if(!q.trim())return;
  const el=$('hrAns'); if(el)el.innerHTML='<div class="hint" style="margin-top:8px">Reading the HR data…</div>';
  try{ const r=await api('/hcos/ask',{method:'POST',body:JSON.stringify({question:q})}); if(el)el.innerHTML=`<div class="pc-note" style="margin-top:8px;white-space:pre-wrap;background:#fff">${esc(r.answer)}</div>`; }
  catch(e){ if(el)el.innerHTML='<div class="hint" style="margin-top:8px;color:var(--danger)">'+esc(e.message)+'</div>'; }
}

/* ═══ D2 SHELL — always know where you are, what's yours, what's burning ═══ */
function renderShellContext(){
  const pill=$('rolePill');
  if(pill){
    const prev=!!PREVIEW_ROLE;
    pill.textContent = prev ? ('Previewing: '+PREVIEW_ROLE) : (ME.role==='admin' ? 'Owner · Admin' : (ME.job_role||'Team'));
    pill.classList.toggle('previewing', prev);
    pill.style.display='';
  }
  renderFacChip();
  if($('todayBtn')){ $('todayBtn').style.display=''; refreshTodayBadge(); setInterval(refreshTodayBadge, 120000); }
  if((ME.opsAccess||ME.role==='admin') && $('opsBell')){ $('opsBell').style.display=''; refreshOpsBadge(); setInterval(refreshOpsBadge, 90000); }
  if(!renderShellContext._keys){
    renderShellContext._keys=true;
    document.addEventListener('keydown',(e)=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); openSearch(); }
      if(e.key==='Escape'){ closeSearch(); closeToday(); }
    });
  }
}
// Facility scope — THE global selector. Every scoped screen reads FAC_SCOPE; it
// persists across sessions and DEFAULTS TO DETOX (per the owner: everything
// defaults to detox; "All facilities" is the roll-up view, chosen deliberately).
// Screens wire in as their per-facility data comes online — the scope is already
// live on the Operations Center and the admit reconciliation.
let FAC_SCOPE=null;   // facility id as string, '' = all facilities
function facScopeInit(){
  if(FAC_SCOPE!==null) return;
  const mine=(ME.facilities||[]).map(f=>String(f.id));
  const saved=localStorage.getItem('facScope');
  // Only trust a saved scope the CURRENT user can actually see — a shared floor
  // workstation must never leak one user's facility scope to the next.
  if(saved!==null&&(saved===''||mine.includes(saved))){ FAC_SCOPE=saved; return; }
  const detox=(ME.facilities||[]).find(f=>f.fkey==='detox-akron');
  FAC_SCOPE = detox ? String(detox.id) : '';
}
function renderFacChip(){
  const chip=$('facChip'); if(!chip) return;
  facScopeInit();
  const facs=ME.facilities||[];
  if(facs.length>1){
    // A REAL button, not a buried dropdown: the building you're in is the app's
    // most important setting, so it reads like one — tap it, pick a building,
    // and the whole app becomes that facility's dashboard.
    const cur=facs.find(f=>String(f.id)===String(FAC_SCOPE));
    const label=FAC_SCOPE===''?`All facilities (${facs.length})`:(cur?cur.name:'Pick a facility');
    chip.classList.add('fac-btn');
    chip.innerHTML=`🏥 <strong>${esc(label)}</strong><span class="fac-caret">▾</span>`;
    chip.title='Switch building — the whole app becomes that facility';
    chip.onclick=openFacPicker;
    chip.style.display='';
    return;
  }
  // Exactly one building — a plain label; there's nothing to switch.
  if($('facChipName')) $('facChipName').textContent = facs.length ? facs[0].name : 'Armada';
  else chip.innerHTML='🏥 '+esc(facs.length?facs[0].name:'Armada');
  if(facs.length) FAC_SCOPE=String(facs[0].id);
  chip.classList.remove('fac-btn'); chip.onclick=null;
  chip.style.display='';
}
// The building picker — big tappable cards grouped by service line, so switching
// facilities is a first-class action on any screen size (not a buried dropdown).
function openFacPicker(){
  const facs=ME.facilities||[];
  const TYPE_LABEL={ 'detox':'Detox & Residential', 'residential':'Detox & Residential', 'outpatient':'Outpatient — PHP · IOP · OP', 'sober-living':'Sober Living', 'corporate':'Corporate' };
  const TYPE_ICON={ 'detox':'🛏️','residential':'🛏️','outpatient':'🩺','sober-living':'⛰️','corporate':'🏢' };
  const TYPE_ORDER=['detox','residential','outpatient','sober-living','corporate'];
  const byType={};
  for(const f of facs){ const k=TYPE_LABEL[f.type]||'Other'; (byType[k]=byType[k]||[]).push(f); }
  const groups=[...new Set(TYPE_ORDER.map(t=>TYPE_LABEL[t]))].filter(k=>byType[k]);
  if(byType['Other']) groups.push('Other');
  const card=f=>`<button type="button" class="facpick-card ${String(FAC_SCOPE)===String(f.id)?'on':''}" onclick="pickFac('${f.id}')">
      <span class="facpick-ico">${TYPE_ICON[f.type]||'🏥'}</span><span class="facpick-name">${esc(f.name)}</span>
      ${String(FAC_SCOPE)===String(f.id)?'<span class="facpick-now sans">you’re here</span>':''}</button>`;
  hmodalPlain(`<h3 style="margin-top:0">🏥 Pick a building</h3>
    <p class="sub sans" style="margin:.2em 0 12px">The whole app becomes that facility — its census, its tools, its numbers. Nothing else mixes in.</p>
    <button type="button" class="facpick-card facpick-all ${FAC_SCOPE===''?'on':''}" onclick="pickFac('')">
      <span class="facpick-ico">🌐</span><span class="facpick-name">All facilities — the company roll-up</span>
      ${FAC_SCOPE===''?'<span class="facpick-now sans">you’re here</span>':''}</button>
    ${groups.map(g=>`<div class="facpick-group sans">${esc(g)}</div>${byType[g].map(card).join('')}`).join('')}
    <div class="toolbar" style="margin-top:14px"><button class="btn btn-ghost sans" onclick="closeHModal()">Close</button></div>`);
}
function pickFac(v){ try{ closeHModal(); }catch(_e){ /* modal already gone */ } facScopeChange(v); }
function facScopeChange(v){
  FAC_SCOPE=v||'';
  localStorage.setItem('facScope', FAC_SCOPE);
  renderFacChip();
  refreshOpsBadge();
  // The sidebar becomes THIS facility's toolset (its service-line modules).
  try{ applyNavVisibility(); }catch(_e){ /* flat menus have no sections */ }
  const active=document.querySelector('.view.active');
  const fac=curFacility();
  const prevType=window.PREV_FAC_TYPE||null;
  window.PREV_FAC_TYPE=fac?fac.type:'all';
  // Switching to a DIFFERENT KIND of facility lands on its natural home — pick
  // Hilltop and you're on the Housing HQ, pick Corporate and you're in the hub.
  // Same-type switches (Akron detox → Wheatfield) keep your place, re-scoped.
  if(fac && (fac.type!==prevType || (active && !moduleVisible(active.id)))){
    const home=TYPE_HOME[fac.type];
    show(home && canSeeView(home) && moduleVisible(home) ? home : 'dashboard');
    return;
  }
  if(active) show(active.id);
  if(active&&active.id==='admitcheck' && $('reconBody') && $('reconBody').innerHTML) loadAdmitRecon();
}
function facQ(prefix){ return FAC_SCOPE ? prefix+'facility='+encodeURIComponent(FAC_SCOPE) : ''; }
let TODAY_ITEMS=[];
async function refreshTodayBadge(){
  try{ const d=await api('/my/today'); TODAY_ITEMS=d.items||[]; const b=$('todayBadge'); if(b){ const n=TODAY_ITEMS.length; b.textContent=n; b.style.display=n?'':'none'; } }catch(_e){}
}
async function refreshOpsBadge(){
  try{ const d=await api('/opscenter'); const n=(d.tiles||[]).filter(t=>t.alert).length; const b=$('opsBadge'); if(b){ b.textContent=n; b.style.display=n?'':'none'; } }catch(_e){}
}
// Today drawer — the personal inbox: everything waiting on ME, overdue first.
function closeToday(){ const d=document.getElementById('todayDrawer'); if(d) d.remove(); }
function toggleToday(){
  if(document.getElementById('todayDrawer')) return closeToday();
  const d=document.createElement('div'); d.id='todayDrawer'; d.className='today-drawer sans';
  const row=(t,i)=>`<div class="q-row ${t.overdue?'q-overdue':''}" onclick="todayGo(${i})"><div class="q-main"><div class="q-title">${esc(t.label)}</div><div class="q-sub">${esc(t.sub||'')}</div></div><div>›</div></div>`;
  d.innerHTML=`<div class="td-head"><strong>📥 Today${TODAY_ITEMS.length?` · ${TODAY_ITEMS.length}`:''}</strong><button class="iconbtn" onclick="closeToday()">✕</button></div>
    <div class="td-body">${TODAY_ITEMS.length?TODAY_ITEMS.map(row).join(''):'<div class="empty"><div class="e-ico">🌤</div>Nothing waiting on you right now.<br>Enjoy the calm — it’s earned.</div>'}</div>`;
  document.body.appendChild(d);
  refreshTodayBadge();
}
function todayGo(i){ const t=TODAY_ITEMS[i]; if(!t) return; closeToday(); opsDrill(t.view, t.tab||''); }
// Global search (Ctrl/⌘K) — people, work, vendors, pages; walls respected server-side.
function closeSearch(){ const o=document.getElementById('ksearch'); if(o) o.remove(); }
function openSearch(){
  if(document.getElementById('ksearch')) return;
  const o=document.createElement('div'); o.id='ksearch'; o.className='ksearch';
  o.onclick=(e)=>{ if(e.target===o) closeSearch(); };
  o.innerHTML=`<div class="ksearch-box"><input id="ksearchInput" placeholder="Search clients, employees, orders, vendors, pages…" autocomplete="off"/><div class="ksearch-list" id="ksearchList"></div></div>`;
  document.body.appendChild(o);
  const inp=document.getElementById('ksearchInput'); inp.focus();
  let t=null;
  inp.oninput=()=>{ clearTimeout(t); t=setTimeout(()=>runSearch(inp.value),180); };
}
let KSEARCH_HITS=[];
async function runSearch(q){
  const list=document.getElementById('ksearchList'); if(!list) return;
  q=String(q||'').trim();
  // Pages match locally — the nav already knows what this user may see.
  const pages=[...document.querySelectorAll('#nav button')].map(b=>({view:b.dataset.view,label:b.textContent.trim()}))
    .filter(p=>q.length>=2 && p.label.toLowerCase().includes(q.toLowerCase()) && canSeeView(p.view)).slice(0,4);
  let data={results:[]};
  if(q.length>=2){ try{ data=await api('/search?q='+encodeURIComponent(q)); }catch(_e){} }
  KSEARCH_HITS=[...data.results.map(r=>({...r})), ...pages.map(p=>({type:'page',icon:'▸',label:p.label,view:p.view,sub:'Go to page'}))];
  if(!KSEARCH_HITS.length){ list.innerHTML=q.length>=2?'<div class="empty" style="padding:18px">No matches. Try a name, an item, or a page.</div>':''; return; }
  list.innerHTML=KSEARCH_HITS.map((r,i)=>`<div class="q-row" onclick="ksearchGo(${i})"><div>${r.icon||'•'}</div><div class="q-main"><div class="q-title">${esc(r.label)}</div><div class="q-sub">${esc(r.sub||'')}</div></div><div>›</div></div>`).join('');
}
function ksearchGo(i){
  const r=KSEARCH_HITS[i]; if(!r) return;
  closeSearch();
  if(r.type==='client') return openJourney(r.id);
  if(r.type==='employee'){ show('hcos'); return setTimeout(()=>openHcosPerson(r.id),250); }
  if(r.type==='order') return opsDrill('corphub','orders');
  if(r.type==='vendor') return opsDrill('corphub','vendors');
  if(r.type==='page') return show(r.view);
}

// ── OPERATIONS CENTER — "what's happening right now"; every tile drills into work ──
async function loadOpsCenter(){
  const host=$('opscenter'); if(!host) return;
  host.innerHTML='<div class="card"><div class="skel" style="width:220px;height:22px;margin-bottom:14px"></div><div class="skel-tiles">'+'<div class="skel"></div>'.repeat(5)+'</div></div><div class="card"><div class="skel-tiles">'+'<div class="skel"></div>'.repeat(5)+'</div></div>';
  let d; try{ d=await api('/opscenter'+facQ('?')); }catch(e){ host.innerHTML='<div class="card"><div class="empty"><div class="e-ico">⚠️</div>'+esc(e.message)+'<div class="e-act"><button class="btn btn-gold btn-sm sans" onclick="loadOpsCenter()">Retry</button></div></div></div>'; return; }
  const tiles=d.tiles||[];
  const groups=[
    ['now','🟢 Right now','the facility pulse this minute'],
    ['queues','📋 Work queues','what’s waiting on someone'],
    ['people','👥 People & compliance','the team and its deadlines'],
  ];
  const tile=(t)=>`<div class="ret-card ${t.alert?'rc-elev':''}" style="cursor:pointer" onclick="opsDrill('${t.view}','${t.tab||''}')" title="Open ${esc(t.label)}"><div class="n">${t.n}</div><div class="l">${esc(t.label)}${t.sub?`<div class="hint">${esc(t.sub)}</div>`:''}</div></div>`;
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🎛️ Operations Center</h3><p class="sub sans" style="margin:0">What’s happening right now, across the operation. Tap any tile to jump straight into that work queue — no hunting through menus.</p></div><div class="hint" style="white-space:nowrap">${esc(d.today||'')} · <a href="#" onclick="loadOpsCenter();return false">↻ refresh</a></div></div></div>
    ${groups.map(([g,label,sub])=>{
      const ts=tiles.filter(t=>t.group===g); if(!ts.length) return '';
      return `<div class="card"><h3 style="margin-top:0">${label} <span class="hint" style="font-weight:400">· ${sub}</span></h3><div class="ret-cards">${ts.map(tile).join('')}</div></div>`;
    }).join('')}
    ${(d.events&&d.events.length)?`<div class="card"><details><summary style="cursor:pointer"><h3 style="margin:0;display:inline">🕐 Activity <span class="hint" style="font-weight:400">· the last ${d.events.length} business moments, newest first</span></h3></summary>
      <div class="ops-feed">${d.events.map(ev=>`<div class="q-row"><div class="q-main"><div class="q-title">${esc(ev.summary||ev.event)}</div><div class="q-sub">${esc(ev.event)} · ${esc((ev.at||'').slice(0,16).replace('T',' '))}${ev.actor?' · '+esc(ev.actor):''}</div></div></div>`).join('')}</div></details></div>`:''}`;
}
// Drill-through: land on the exact tab that holds the work, not just the page.
function opsDrill(view,tab){
  if(tab){ if(view==='corphub') CORP_TAB=tab; if(view==='hcos'){ HCOS_TAB=tab; HCOS_PERSON=null; } }
  show(view);
}
let CORP_TAB='dashboard', CORP_FAC='', CORP_LOCS=[];
async function loadCorpHub(){
  const host=$('corphub'); if(!host) return;
  if(!CORP_LOCS.length){ try{ const o=await api('/corp/overview'); CORP_LOCS=o.locations||[]; }catch(_e){} }
  const facSel=`<label class="hint">Facility <select id="corpFac" onchange="CORP_FAC=this.value;renderCorpTab()"><option value="">🏢 All facilities</option>${CORP_LOCS.map(l=>`<option ${CORP_FAC===l?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🗂️ Corporate Hub</h3><p class="sub sans" style="margin:0">Ordering &amp; maintenance at a glance, your project board, vendors, and every facility document — one place to run corporate.</p></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${facSel}${(ME&&ME.role==='admin'&&!PREVIEW_ROLE)?'<button class="btn btn-ghost btn-sm sans" onclick="previewAsChava()">👁 Preview corporate view</button>':''}</div></div>
    ${CORP_FAC?`<div class="pc-note" style="margin-top:6px">Viewing <strong>${esc(CORP_FAC)}</strong> only. <a href="#" onclick="CORP_FAC='';loadCorpHub();return false">← all facilities</a></div>`:''}
    <div class="corp-tabs" id="corpTabs">
      ${['dashboard|📊 Dashboard','orders|🛒 Orders','projects|✅ Projects','insurance|🛡️ Insurance','leases|🏢 Leases','entities|🏛️ Entities','vendors|📇 Vendors','accounts|💳 Accounts','docs|📁 Documents','role|⭐ My Role'].map(t=>{const[k,l]=t.split('|');return `<button class="${CORP_TAB===k?'active':''}" onclick="corpTab('${k}')">${l}</button>`;}).join('')}
    </div></div>
    <div id="corpBody"><div class="hint">Loading…</div></div>`;
  // Mobile: restack hub tables into cards after every re-render (see corpDecorateTables).
  if(!loadCorpHub._obs){ let t=null; loadCorpHub._obs=new MutationObserver(()=>{ clearTimeout(t); t=setTimeout(corpDecorateTables,60); }); loadCorpHub._obs.observe(host,{childList:true,subtree:true}); }
  renderCorpTab();
}
// Stamp each hub table cell with its column header (data-th) so the mobile CSS can
// turn rows into labeled, tap-friendly cards. Tables that must stay grids (e.g. the
// insurance coverage matrix) opt out with class="nomcard".
function corpDecorateTables(){
  document.querySelectorAll('.mhub table.tbl:not(.nomcard)').forEach(t=>{
    const ths=[...t.querySelectorAll('tr th')].map(th=>th.textContent.trim());
    if(!ths.length) return;
    t.classList.add('m-cards');
    t.querySelectorAll('tr').forEach(tr=>{[...tr.children].forEach((td,i)=>{ if(td.tagName==='TD'&&!td.hasAttribute('data-th')) td.setAttribute('data-th',ths[i]||''); });});
  });
}
function corpTab(k){ CORP_TAB=k; document.querySelectorAll('#corpTabs button').forEach(b=>b.classList.toggle('active', b.getAttribute('onclick').includes("'"+k+"'"))); renderCorpTab(); }
async function renderCorpTab(){
  const body=$('corpBody'); if(!body) return; body.innerHTML='<div class="hint">Loading…</div>';
  if(CORP_TAB==='dashboard') return renderCorpDashboard(body);
  if(CORP_TAB==='orders') return renderCorpOrders(body);
  if(CORP_TAB==='projects') return renderCorpProjects(body);
  if(CORP_TAB==='insurance') return renderCorpInsurance(body);
  if(CORP_TAB==='leases') return renderCorpLeases(body);
  if(CORP_TAB==='entities') return renderCorpEntities(body);
  if(CORP_TAB==='vendors') return renderCorpVendors(body);
  if(CORP_TAB==='accounts') return renderCorpPayments(body);
  if(CORP_TAB==='docs') return renderCorpDocs(body);
  if(CORP_TAB==='role') return renderCorpRole(body);
}
async function renderCorpDashboard(body){
  let d; try{ d=await api('/corp/overview?facility='+encodeURIComponent(CORP_FAC)); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  if(d.locations&&d.locations.length) CORP_LOCS=d.locations;
  const o=d.ordering||{}, m=d.maintenance||{}, tc=d.taskCounts||{};
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const byLoc=CORP_FAC?[]:(o.byLocation||[]);
  const scopeNote=CORP_FAC?` <span class="hint" style="font-weight:400">· ${esc(CORP_FAC)}</span>`:` <span class="hint" style="font-weight:400">· ${o.locationsRequesting||0} location${o.locationsRequesting===1?'':'s'} requesting</span>`;
  const toOrder=(o.toOrder||[]);
  const priDot=(p)=>p==='Urgent'?'🔴':p==='High'?'🟠':'';
  const toOrderHtml=toOrder.length?`<div class="card" style="border-left:4px solid var(--gold)"><h3 style="margin-top:0">🛒 To order — ${toOrder.length} item${toOrder.length===1?'':'s'} <span class="hint" style="font-weight:400">· tap ✓ once you've placed it</span></h3>
      <table class="tbl"><tr><th>Item</th><th>Location</th><th>Vendor</th><th></th></tr>${toOrder.map(t=>`<tr><td>${priDot(t.priority)} <strong>${esc(t.item_name)}</strong>${t.qty?` <span class="hint">· ${esc(t.qty)}</span>`:''}${t.link?` <a href="${esc(t.link)}" target="_blank" rel="noopener">🔗</a>`:''}${t.last_note?`<div class="hint">💬 ${esc(t.last_note)}</div>`:''}</td><td class="hint">${esc(t.facility)}</td><td class="hint">${esc(t.vendor||'')}</td><td style="white-space:nowrap"><button class="btn btn-gold btn-sm sans" onclick="setOrder(${t.id},'ordered');setTimeout(()=>renderCorpDashboard($('corpBody')),300)">✓ Ordered</button> <button class="btn btn-ghost btn-sm sans" onclick="orderNotes(${t.id})" title="Chase log — dated notes on this order">💬${t.note_count?t.note_count:''}</button></td></tr><tr id="onotesRow_${t.id}" style="display:none"><td colspan="4" style="background:#faf8f3"><div id="onotes_${t.id}"></div></td></tr>`).join('')}</table>
      <div class="hint" style="margin-top:4px">New orders default to <strong>Armada Detox of Akron</strong>. Add for any location in the <a href="#" onclick="corpTab('orders');return false">Orders tab ↗</a>.</div></div>`:'<div class="card" style="border-left:4px solid var(--good)"><h3 style="margin-top:0">🛒 To order</h3><div class="hint">Nothing waiting to be ordered right now. 🎉</div></div>';
  body.innerHTML=`
    ${toOrderHtml}
    <div class="card"><h3 style="margin-top:0">📈 Ordering${scopeNote}</h3>
      <div class="ret-cards">${box(o.open||0,'Open to order',(o.open?'rc-elev':''))}${box(o.ordered||0,'Ordered · awaiting')}${box(o.completed||0,'Received (30d)')}${box(o.avgToReceiveDays!=null?o.avgToReceiveDays+'d':'—','Avg order→receive')}</div>
      ${byLoc.length?`<div style="margin-top:8px"><div class="hint">Where it's being requested right now — tap a location to focus:</div><table class="tbl" style="margin-top:4px"><tr><th>Location</th><th>Requested</th><th>Ordered</th></tr>${byLoc.map(l=>`<tr style="cursor:pointer" onclick="CORP_FAC='${l.facility.replace(/'/g,"\\'")}';loadCorpHub()"><td><strong>${esc(l.facility)}</strong></td><td>${l.requested||0}</td><td>${l.ordered||0}</td></tr>`).join('')}</table></div>`:(CORP_FAC?'':'<div class="hint" style="margin-top:6px">No open requests. As locations flag items, they appear here by location.</div>')}
      <div class="hint" style="margin-top:6px">Avg flag→ordered: <strong>${o.avgToOrderDays!=null?o.avgToOrderDays+'d':'—'}</strong>. <a href="#" onclick="corpTab('orders');return false">Work the order queue ↗</a></div></div>
    <div class="card"><h3 style="margin-top:0">🔧 Maintenance</h3>
      <div class="ret-cards">${box(m.open||0,'Open',(m.open?'rc-elev':''))}${box(m.inProgress||0,'In progress')}${box(m.completed||0,'Resolved (30d)')}${box(m.avgResolveDays!=null?m.avgResolveDays+'d':'—','Avg time to resolve')}</div>
      <div class="hint" style="margin-top:6px"><a href="#" onclick="show('maintenance');return false">Open Maintenance ↗</a></div></div>
    <div class="card"><h3 style="margin-top:0">✅ Projects</h3>
      <div class="ret-cards">${box(tc.todo||0,'To do')}${box(tc.doing||0,'In progress')}${box(tc.blocked||0,'Blocked',(tc.blocked?'rc-elev':''))}${box(tc.done||0,'Done')}</div>
      <div class="hint" style="margin-top:6px"><a href="#" onclick="corpTab('projects');return false">Open the board ↗</a></div></div>`;
}
async function renderCorpOrders(body){
  let d; try{ d=await api('/corp/orders'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const locs=d.locations||[]; if(locs.length) CORP_LOCS=locs; let orders=d.orders||[];
  if(CORP_FAC) orders=orders.filter(o=>o.facility===CORP_FAC);
  const pris=['Low','Normal','High','Urgent'];
  const priColor=(p)=>p==='Urgent'?'var(--danger)':p==='High'?'#a60':'';
  const trackBit=(o)=>o.tracking?`<div class="hint">📦 ${/^https?:\/\//i.test(o.tracking)?`<a href="${esc(o.tracking)}" target="_blank" rel="noopener">tracking ↗</a>`:esc(o.tracking)}</div>`:'';
  // The board: drag a card between lanes on desktop; the buttons do the same on a phone.
  const LANES=[
    ['requested','📥 Requested','#c9a35c'],
    ['needs_info','❓ Questions needed','#b3762f'],
    ['approval','✋ Approval needed','#9a5aa3'],
    ['ordered','🛒 Ordered','#4f7fa8'],
    ['received','✅ Received','#2f7a4f'],
  ];
  const moves=(o)=>{
    const btn=(st,label,gold)=>`<button class="btn ${gold?'btn-gold':'btn-ghost'} btn-sm sans" style="padding:3px 8px" onclick="setOrder(${o.id},'${st}')">${label}</button>`;
    let b='';
    if(o.status==='requested'){ b+=btn('ordered','✓ Ordered',1)+btn('needs_info','❓')+btn('approval','✋'); }
    else if(o.status==='needs_info'){ b+=btn('ordered','✓ Ordered',1)+btn('requested','📥 Back')+btn('approval','✋'); }
    else if(o.status==='approval'){ b+=btn('ordered','✓ Approve & order',1)+btn('requested','📥 Back'); }
    else if(o.status==='ordered'){ b+=btn('received','📬 Received',1)+`<button class="btn btn-ghost btn-sm sans" style="padding:3px 8px" onclick="orderTracking(${o.id})" title="Add carrier tracking">📦</button>`; }
    if(!['received','cancelled'].includes(o.status)) b+=btn('cancelled','✕');
    b+=`<button class="btn btn-ghost btn-sm sans" style="padding:3px 8px" onclick="orderNotes(${o.id})" title="Chase log — dated notes">💬${o.note_count?o.note_count:''}</button>`;
    b+=`<button class="btn btn-ghost btn-sm sans" style="padding:3px 8px" onclick="delOrder(${o.id})">🗑</button>`;
    return b;
  };
  const card=(o)=>`<div class="q-row" draggable="true" ondragstart="ordDragStart(event,${o.id})" style="display:block;padding:10px 12px;cursor:grab">
    <div><strong>${esc(o.item_name)}</strong>${o.qty?` <span class="hint">· ${esc(o.qty)}</span>`:''}${o.link?` <a href="${esc(o.link)}" target="_blank" rel="noopener">🔗</a>`:''}${o.priority!=='Normal'?` <span style="color:${priColor(o.priority)};font-size:11px;font-weight:700">${esc(o.priority.toUpperCase())}</span>`:''}</div>
    <div class="hint">${esc(o.facility)}${o.vendor?' · '+esc(o.vendor):''}${o.est_cost?' · '+esc(o.est_cost):''}${o.requested_by?' · by '+esc(o.requested_by):''}</div>
    ${o.notes?`<div class="hint">${esc(o.notes)}</div>`:''}${o.last_note?`<div class="hint">💬 ${esc(o.last_note)}</div>`:''}${trackBit(o)}
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${moves(o)}</div>
    <div id="onotesRow_${o.id}" style="display:none"><div id="onotes_${o.id}"></div></div>
  </div>`;
  const cutoff=new Date(Date.now()-14*864e5).toISOString().slice(0,10);
  const laneItems=(k)=>k==='received'
    ? orders.filter(o=>o.status==='received'&&String(o.received_at||o.updated_at||'').slice(0,10)>=cutoff).slice(0,15)
    : orders.filter(o=>o.status===k);
  const col=([k,label,color])=>{const items=laneItems(k);return `<div class="trello-col" data-lane="${k}" ondragover="ordDragOver(event)" ondragleave="this.classList.remove('dragover')" ondrop="ordDrop(event,'${k}')">
    <div class="trello-head" style="border-top:3px solid ${color};border-radius:12px 12px 0 0"><strong class="sans">${label}</strong> <span class="hint">${items.length}${k==='received'?' · 14d':''}</span></div>
    <div class="trello-body">${items.map(card).join('')||'<div class="hint" style="padding:8px">Empty.</div>'}</div></div>`;};
  const openN=orders.filter(o=>['requested','needs_info','approval','ordered'].includes(o.status)).length;
  const doneList=orders.filter(o=>o.status==='cancelled'||(o.status==='received'&&String(o.received_at||o.updated_at||'').slice(0,10)<cutoff)).slice(0,30);
  body.innerHTML=`
    <div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🛒 Order board <span class="hint" style="font-weight:400">· ${openN} open · drag cards between lanes (or use the buttons)</span></h3></div>
      <label class="hint">Location <select onchange="CORP_FAC=this.value;renderCorpOrders($('corpBody'))"><option value="">All</option>${locs.map(l=>`<option ${CORP_FAC===l?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div>
      <div class="trello" style="margin-top:8px">${LANES.map(col).join('')}</div></div>
    <div class="card"><details><summary><strong>＋ Add an order request</strong> <span class="hint">any location — defaults to Detox</span></summary><div style="margin-top:8px">
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
        <select id="oFac">${locs.map(l=>`<option ${(CORP_FAC||'Armada Detox of Akron')===l?'selected':''}>${esc(l)}</option>`).join('')}</select>
        <input id="oItem" placeholder="What to order" style="min-width:170px"/>
        <select id="oCat">${['Supplies','Housekeeping','Medical','Office','Marketing Materials','Swag / Merch','Maintenance / Repair','Other'].map(c=>`<option>${c}</option>`).join('')}</select>
        <input id="oQty" placeholder="Qty" style="width:80px"/>
        <input id="oVendor" placeholder="Vendor" style="width:110px"/>
        <select id="oPri">${pris.map(p=>`<option ${p==='Normal'?'selected':''}>${p}</option>`).join('')}</select>
        <input id="oCost" placeholder="Est. $" style="width:80px"/>
        <input id="oLink" placeholder="Amazon / supplier link (optional)" style="width:100%"/>
        <button class="btn btn-gold sans" onclick="addOrder()">Add order</button></div>
      <span id="oMsg" class="hint"></span></div></details></div>
    ${doneList.length?`<div class="card"><details><summary><strong>Older received &amp; cancelled</strong> <span class="hint">· ${doneList.length}</span></summary>${doneList.map(o=>`<div class="pc-note">${o.status==='received'?'✅':'✕'} <strong>${esc(o.item_name)}</strong> <span class="hint">· ${esc(o.facility)}${o.vendor?' · '+esc(o.vendor):''} · ${esc(String(o.received_at||o.updated_at||'').slice(0,10))}</span></div>`).join('')}</details></div>`:''}
    <div id="intakePanel"></div>`;
  loadIntakePanel();
}
async function loadIntakePanel(){
  const host=$('intakePanel'); if(!host) return;
  let d; try{ d=await api('/corp/intake'); }catch(e){ host.innerHTML=''; return; }
  const routes=d.routes||[], recent=d.recent||[], locs=d.locations||[];
  const senders=routes.filter(r=>r.kind==='sender'), addrs=routes.filter(r=>r.kind==='address');
  const isAdmin=ME.role==='admin';
  host.innerHTML=`<div class="card" style="border-left:4px solid var(--aqua)"><details ${recent.length?'':''}><summary style="cursor:pointer"><strong>📧 Email-in ordering</strong> <span class="hint">· office managers email an order → it lands here automatically${recent.length?` · ${recent.length} recent`:''}</span></summary>
    <div style="padding:8px 0 2px">
      <p class="sub sans" style="margin:0 0 6px">An office manager emails an order (a list, bullets, whatever) to your intake address; the app reads it and creates the orders on this queue, tagged to their location.</p>
      ${isAdmin?`<div class="pc-note" style="font-family:monospace;font-size:11px;word-break:break-all"><strong>Webhook URL</strong> (give this to your email provider's inbound/route):<br>${esc(d.webhookUrl||'')}</div>
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px"><label class="hint" title="Auto-detected — only change if the address shown in the Webhook URL above looks wrong">App URL (auto) <input id="inBase" placeholder="auto-detected" value="${esc((d.webhookUrl||'').split('/api/')[0]||'')}" style="min-width:180px"/></label><label class="hint">Default location <select id="inDef">${locs.map(l=>`<option ${d.defaultEntity===l?'selected':''}>${esc(l)}</option>`).join('')}</select></label><label class="hint" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="inConfirm" ${d.confirmOn?'checked':''}/> Reply "✓ Got it" to sender</label><button class="btn btn-ghost btn-sm sans" onclick="saveIntakeSettings()">Save</button><span id="inMsg" class="hint" style="align-self:center"></span></div>
      <div class="pc-note" style="background:#faf6ee;border-left:4px solid var(--gold);margin-top:6px"><strong>📨 One-tap IT setup:</strong> emails your IT company the full Power Automate instructions with the webhook link already filled in.
        <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:4px"><input id="inItEmail" placeholder="it-company@example.com" style="min-width:190px"/><button class="btn btn-gold btn-sm sans" onclick="sendItInstructions(this)">Email IT the setup</button><span id="inItMsg" class="hint" style="align-self:center"></span></div></div>`:''}
      <h3 style="font-size:13px;margin:10px 0 4px">Who can email orders (sender → location)</h3>
      ${isAdmin?`<div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"><input id="inSender" placeholder="manager@…" style="min-width:150px"/><select id="inSenderEnt">${locs.map(l=>`<option>${esc(l)}</option>`).join('')}</select><button class="btn btn-gold btn-sm sans" onclick="addRoute('sender')">Add</button></div>`:''}
      ${senders.length?senders.map(r=>`<div class="pc-note" style="font-size:12px">✉️ <strong>${esc(r.value)}</strong> → ${esc(r.entity)}${isAdmin?` <button class="btn btn-ghost btn-sm sans" onclick="delRoute(${r.id})">🗑</button>`:''}</div>`).join(''):'<div class="hint">No senders yet — add each office manager\'s email so their orders route to the right location.</div>'}
      ${isAdmin?`<h3 style="font-size:13px;margin:10px 0 4px">Or per-location address / +tag</h3><div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"><input id="inAddr" placeholder="e.g. dayton  (for orders+dayton@ or dayton-orders@)" style="min-width:180px"/><select id="inAddrEnt">${locs.map(l=>`<option>${esc(l)}</option>`).join('')}</select><button class="btn btn-gold btn-sm sans" onclick="addRoute('address')">Add</button></div>
      ${addrs.map(r=>`<div class="pc-note" style="font-size:12px">🏷️ <strong>${esc(r.value)}</strong> → ${esc(r.entity)} <button class="btn btn-ghost btn-sm sans" onclick="delRoute(${r.id})">🗑</button></div>`).join('')}`:''}
      <div class="toolbar" style="justify-content:flex-start;gap:6px;margin-top:8px"><button class="btn btn-ghost btn-sm sans" onclick="testIntake()">✎ Test with a sample email</button><span id="inTestMsg" class="hint" style="align-self:center"></span></div>
      ${recent.length?`<h3 style="font-size:13px;margin:10px 0 4px">Recent email orders</h3>${recent.map(r=>`<div class="hint">• ${esc(r.item_name)} <span style="color:var(--muted)">· ${esc(r.facility)} · from ${esc(r.requested_by||'')} · ${esc((r.created_at||'').slice(0,16))}</span></div>`).join('')}`:''}
    </div></details></div>`;
}
async function saveIntakeSettings(){ const b={baseUrl:($('inBase')||{}).value||'',defaultEntity:($('inDef')||{}).value||'',confirm:!!(($('inConfirm')||{}).checked)}; try{ await api('/corp/intake/settings',{method:'POST',body:JSON.stringify(b)}); if($('inMsg'))$('inMsg').textContent='✓ Saved'; loadIntakePanel(); }catch(e){ if($('inMsg'))$('inMsg').textContent=e.message; } }
async function addRoute(kind){ const val=(kind==='sender'?($('inSender')||{}).value:($('inAddr')||{}).value)||''; const ent=(kind==='sender'?($('inSenderEnt')||{}).value:($('inAddrEnt')||{}).value)||''; if(!val.trim())return; try{ await api('/corp/intake/route',{method:'POST',body:JSON.stringify({kind,value:val,entity:ent})}); loadIntakePanel(); }catch(e){ alert(e.message); } }
async function delRoute(id){ try{ await api('/corp/intake/route/'+id,{method:'DELETE'}); loadIntakePanel(); }catch(e){ alert(e.message); } }
async function testIntake(){ const text=prompt('Paste a sample order email body (e.g. "Please order 2 cases of gloves and a box of pens for Dayton"):'); if(!text)return; if($('inTestMsg'))$('inTestMsg').textContent='Parsing…'; try{ const r=await api('/corp/intake/test',{method:'POST',body:JSON.stringify({text})}); if($('inTestMsg'))$('inTestMsg').textContent=`✓ Created ${r.created} order(s) for ${r.entity}.`; renderCorpOrders($('corpBody')); }catch(e){ if($('inTestMsg'))$('inTestMsg').textContent=e.message; } }
async function addOrder(){
  const b={facility:($('oFac')||{}).value,item_name:($('oItem')||{}).value||'',category:($('oCat')||{}).value||'',qty:($('oQty')||{}).value||'',vendor:($('oVendor')||{}).value||'',priority:($('oPri')||{}).value,est_cost:($('oCost')||{}).value||'',link:($('oLink')||{}).value||''};
  if(!b.item_name.trim()){ if($('oMsg'))$('oMsg').textContent='What are we ordering?'; return; }
  try{ await api('/corp/orders',{method:'POST',body:JSON.stringify(b)}); renderCorpOrders($('corpBody')); }catch(e){ if($('oMsg'))$('oMsg').textContent=e.message; }
}
async function setOrder(id,status){ try{ await api('/corp/orders/'+id,{method:'PATCH',body:JSON.stringify({status})}); renderCorpOrders($('corpBody')); }catch(e){ alert(e.message); } }
async function emailLandlord(id,btn){ if(btn)btn.disabled=true; try{ const r=await api('/corp/orders/'+id+'/email-landlord',{method:'POST'}); alert(r.sent?('✓ Emailed the landlord ('+r.to+').'):('Could not email landlord: '+(r.reason||'no landlord on file for this facility — add it on the lease.'))); }catch(e){ alert(e.message); } if(btn)btn.disabled=false; }
async function sendItInstructions(btn){
  const to=(($('inItEmail')||{}).value||'').trim();
  if(!/@/.test(to)){ const m=$('inItMsg'); if(m) m.textContent='Enter the IT company\'s email first.'; return; }
  btn.disabled=true;
  try{ await api('/corp/intake/send-instructions',{method:'POST',body:JSON.stringify({to})}); const m=$('inItMsg'); if(m) m.textContent='✓ Sent — the setup instructions are on their way.'; }
  catch(e){ const m=$('inItMsg'); if(m) m.textContent='⚠️ '+e.message; }
  btn.disabled=false;
}
async function orderTracking(id){
  const t=prompt('Tracking number or carrier link (the office manager sees this on their status page):');
  if(t==null) return;
  try{ await api('/corp/orders/'+id,{method:'PATCH',body:JSON.stringify({tracking:t})}); renderCorpOrders($('corpBody')); }catch(e){ alert(e.message); }
}
async function delOrder(id){ if(!confirm('Delete this order request?'))return; try{ await api('/corp/orders/'+id,{method:'DELETE'}); renderCorpOrders($('corpBody')); }catch(e){ alert(e.message); } }
/* Drag & drop between board lanes (desktop); the card buttons cover mobile. */
function ordDragStart(ev,id){ ev.dataTransfer.setData('text/plain',String(id)); ev.dataTransfer.effectAllowed='move'; }
function ordDragOver(ev){ ev.preventDefault(); ev.dataTransfer.dropEffect='move'; ev.currentTarget.classList.add('dragover'); }
function ordDrop(ev,lane){ ev.preventDefault(); ev.currentTarget.classList.remove('dragover'); const id=+ev.dataTransfer.getData('text/plain'); if(id) setOrder(id,lane); }
/* The chase log: dated, signed notes on one order — "called vendor", "backordered 7/15". */
async function orderNotes(id){
  const tr=$('onotesRow_'+id); if(!tr) return;
  if(tr.style.display!=='none'){ tr.style.display='none'; return; }
  tr.style.display='';
  const host=$('onotes_'+id); host.innerHTML='<div class="hint">Loading…</div>';
  try{
    const d=await api('/corp/orders/'+id+'/notes');
    host.innerHTML=`${(d.notes||[]).map(n=>`<div class="pc-note">💬 ${esc(n.note)} <span class="hint">— ${esc(n.by_name||'')} · ${esc((n.created||'').slice(0,16))}</span></div>`).join('')||'<div class="hint">No notes yet — the first one starts the story.</div>'}
      <div class="toolbar" style="justify-content:flex-start;gap:6px;margin-top:6px"><input id="onoteIn_${id}" placeholder="Add a note — e.g. called vendor, backordered until 7/15" style="flex:1;min-width:180px" onkeydown="if(event.key==='Enter')orderNoteAdd(${id})"/><button class="btn btn-gold btn-sm sans" onclick="orderNoteAdd(${id})">Add note</button></div>`;
    const inp=$('onoteIn_'+id); if(inp) inp.focus();
  }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; }
}
async function orderNoteAdd(id){
  const el=$('onoteIn_'+id); const t=((el&&el.value)||'').trim(); if(!t) return;
  try{
    await api('/corp/orders/'+id+'/notes',{method:'POST',body:JSON.stringify({note:t})});
    const tr=$('onotesRow_'+id); if(tr) tr.style.display='none';
    orderNotes(id);   // reopen fresh with the new note in the list
  }catch(e){ alert(e.message); }
}
let PAY_SHOW=false;
async function renderCorpPayments(body){
  let d; try{ d=await api('/corp/payments'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const ps=d.payments||[], locs=d.locations||[];
  const kinds=['Card','ACH/Bank','Vendor account','Net terms'];
  const mask=(v)=>PAY_SHOW?esc(v||''):(v?'••••':'');
  const row=(p)=>`<tr><td><strong>${esc(p.label)}</strong><div class="hint">${esc(p.kind)}${p.brand?' · '+esc(p.brand):''}${p.cardholder?' · '+esc(p.cardholder):''}</div></td>
    <td>${p.last4?'····'+esc(p.last4):''}${p.exp?` <span class="hint">${mask(p.exp)}</span>`:''}${p.billing_zip?`<div class="hint">zip ${mask(p.billing_zip)}</div>`:''}</td>
    <td class="hint">${p.account_number?mask(p.account_number):''}</td><td class="hint">${esc(p.vendor||'')}</td><td class="hint">${esc(p.facility||'')}</td><td class="hint">${esc(p.notes||'')}</td>
    <td><button class="btn btn-ghost btn-sm sans" onclick="delPayment(${p.id})">🗑</button></td></tr>`;
  body.innerHTML=`<div class="pc-note" style="color:#a60;margin-bottom:8px">🔒 Store <strong>reference info only</strong> — last 4, which card, billing zip, account #. Never the full card number or CVV (that's a security/PCI risk). Full card numbers live in the 🏛️ Entities vault.</div>
    <div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">💳 Cards &amp; accounts <span class="hint" style="font-weight:400">· ${ps.length}</span></h3></div><button class="btn btn-ghost btn-sm sans" onclick="PAY_SHOW=!PAY_SHOW;renderCorpPayments($('corpBody'))">${PAY_SHOW?'🙈 Hide':'👁 Show'} details</button></div>
      ${ps.length?`<table class="tbl"><tr><th>Method</th><th>Card</th><th>Account #</th><th>Vendor</th><th>Facility</th><th>Notes</th><th></th></tr>${ps.map(row).join('')}</table>`:'<div class="hint">No payment methods yet.</div>'}</div>
    <div class="card"><details ${ps.length?'':'open'}><summary><strong>＋ Add a payment method / account</strong></summary><div style="margin-top:8px">
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
        <input id="pLabel" placeholder="Label (e.g. Amex — Akron ops)" style="min-width:170px"/>
        <select id="pKind">${kinds.map(k=>`<option>${k}</option>`).join('')}</select>
        <input id="pBrand" placeholder="Brand" style="width:90px"/>
        <input id="pLast4" placeholder="Last 4" maxlength="4" style="width:70px"/>
        <input id="pExp" placeholder="MM/YY" style="width:70px"/>
        <input id="pZip" placeholder="Billing zip" style="width:90px"/>
        <input id="pAcct" placeholder="Account # (vendor/ACH)" style="width:140px"/>
        <input id="pVendor" placeholder="Vendor" style="width:110px"/>
        <select id="pFac"><option value="">Facility (any)</option>${locs.map(l=>`<option>${esc(l)}</option>`).join('')}</select>
        <input id="pNotes" placeholder="Notes (which vendors it's for, limits, etc.)" style="width:100%"/>
        <button class="btn btn-gold sans" onclick="savePayment()">Add</button></div>
      <span id="pMsg" class="hint"></span></div></details></div>`;
}
async function savePayment(){
  const b={label:($('pLabel')||{}).value||'',kind:($('pKind')||{}).value,brand:($('pBrand')||{}).value||'',last4:($('pLast4')||{}).value||'',exp:($('pExp')||{}).value||'',billing_zip:($('pZip')||{}).value||'',account_number:($('pAcct')||{}).value||'',vendor:($('pVendor')||{}).value||'',facility:($('pFac')||{}).value||'',notes:($('pNotes')||{}).value||''};
  if(!b.label.trim()){ if($('pMsg'))$('pMsg').textContent='Add a label.'; return; }
  try{ await api('/corp/payments',{method:'POST',body:JSON.stringify(b)}); renderCorpPayments($('corpBody')); }catch(e){ if($('pMsg'))$('pMsg').textContent=e.message; }
}
async function delPayment(id){ if(!confirm('Remove this payment method?'))return; try{ await api('/corp/payments/'+id,{method:'DELETE'}); renderCorpPayments($('corpBody')); }catch(e){ alert(e.message); } }
async function renderCorpProjects(body){
  let d; try{ d=await api('/corp/tasks'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  let ts=d.tasks||[];
  if(CORP_FAC) ts=ts.filter(t=>t.facility===CORP_FAC);
  const cats=['Project','Errand','Ordering','Maintenance','Admin','Morale'], pris=['Low','Normal','High','Urgent'];
  const cols=[['todo','To do'],['doing','In progress'],['blocked','Blocked'],['done','Done']];
  const priColor=(p)=>p==='Urgent'?'var(--danger)':p==='High'?'#a60':'';
  const nextBtns=(t)=>['todo','doing','blocked','done'].filter(s=>s!==t.status).map(s=>`<button class="btn btn-ghost btn-sm sans" onclick="setCorpTask(${t.id},'${s}')">${s==='doing'?'▶ Start':s==='done'?'✓ Done':s==='blocked'?'⛔ Block':'↩ To-do'}</button>`).join('');
  const card=(t)=>`<div class="pc-note" style="border-left:3px solid ${priColor(t.priority)||'var(--line)'}"><div style="display:flex;justify-content:space-between;gap:6px"><strong>${esc(t.title)}</strong><span class="hint">${esc(t.category)}</span></div>
    ${t.detail?`<div class="hint">${esc(t.detail)}</div>`:''}
    <div class="hint" style="margin-top:2px">${t.priority!=='Normal'?`<span style="color:${priColor(t.priority)}">${esc(t.priority)}</span> · `:''}${t.assignee?'👤 '+esc(t.assignee)+' · ':''}${t.due_date?'📅 '+esc(t.due_date)+' · ':''}from ${esc(t.requested_by||'—')}${t.facility?' · '+esc(t.facility):''}</div>
    <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${nextBtns(t)}<button class="btn btn-ghost btn-sm sans" onclick="delCorpTask(${t.id})">🗑</button></div></div>`;
  body.innerHTML=`<div class="card"><details open><summary><strong>＋ Add a task</strong> <span class="hint">anyone can drop one — corporate works it</span></summary><div style="margin-top:8px">
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
        <input id="ctTitle" placeholder="What needs doing?" style="min-width:220px"/>
        <select id="ctCat">${cats.map(c=>`<option>${c}</option>`).join('')}</select>
        <select id="ctPri">${pris.map(p=>`<option ${p==='Normal'?'selected':''}>${p}</option>`).join('')}</select>
        <input id="ctAssignee" placeholder="Assignee (optional)" style="min-width:120px"/>
        <input id="ctDue" type="date"/>
        <input id="ctDetail" placeholder="Details / notes (optional)" style="width:100%"/>
        <button class="btn btn-gold sans" onclick="addCorpTask()">Add task</button></div>
      <span id="ctMsg" class="hint"></span></div></details></div>
    <div class="hint" style="margin:2px 0 6px" data-mobile-only>Swipe sideways for the other columns →</div>
    <div class="corp-kanban">
      ${cols.map(([k,l])=>`<div class="card"><h3 style="margin-top:0;font-size:14px">${l} <span class="hint" style="font-weight:400">· ${ts.filter(t=>t.status===k).length}</span></h3>${ts.filter(t=>t.status===k).map(card).join('')||'<div class="hint">—</div>'}</div>`).join('')}
    </div>`;
}
let ENT_SHOW=false, ENT_DATA=null;
async function renderCorpEntities(body){
  let d; try{ d=await api('/corp/entities'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  ENT_DATA=d;
  const mask=(v)=>!v?'':(ENT_SHOW?esc(v):'••••'+(String(v).length>4&&ENT_SHOW?'':''));
  const recs=d.records||[], banks=d.banks||[], cards=d.cards||[], portals=d.portals||[];
  // Normalize names so "Akron House Recovery LLC" / "Akron House Recovery, LLC" merge.
  const entKey=(s)=>String(s||'').toLowerCase().replace(/[.,]/g,'').replace(/\b(llc|inc|l l c|home|of|the|recovery propco)\b/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
  // Build one canonical entity per key — records (legal data) win as the anchor.
  const byKey=new Map();
  for(const r of recs){ const k=entKey(r.entity); if(!k)continue; if(!byKey.has(k)) byKey.set(k,{name:r.entity,key:k,rec:r,status:r.status||'active'}); else if(!byKey.get(k).rec) byKey.get(k).rec=r; }
  for(const loc of (d.locations||[])){ const k=entKey(loc); if(k&&!byKey.has(k)) byKey.set(k,{name:loc,key:k,rec:null,status:'active'}); }
  const canon=[...byKey.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const known=new Set(canon.map(e=>e.key));
  const orphanBanks=banks.filter(b=>!known.has(entKey(b.entity)));
  const orphanCards=cards.filter(c=>!known.has(entKey(c.entity)));
  let active=canon.filter(e=>e.status!=='closed'), closed=canon.filter(e=>e.status==='closed');
  if(CORP_FAC){ const ck=entKey(CORP_FAC); active=active.filter(e=>e.key===ck); closed=closed.filter(e=>e.key===ck); }
  const kv=(k,v,sensitive)=>v?`<div class="hint"><span style="color:var(--muted)">${esc(k)}:</span> ${sensitive?mask(v):esc(v)}</div>`:'';
  const cardBlock=(cd)=>cd.map(c=>`<div class="pc-note" style="font-size:12px">${esc(c.name_on_card||'')}<div class="hint">${mask(c.card_number)} · exp ${esc(c.exp||'')} · CVV ${mask(c.back_code)}${c.front_code?' · '+mask(c.front_code):''}${c.entity?' · '+esc(c.entity):''}</div></div>`).join('');
  const bankBlock=(bk)=>bk.map(b=>`<div class="pc-note" style="font-size:12px">${esc(b.bank||'')} ${b.acct_type?'· '+esc(b.acct_type):''}<div class="hint">routing ${mask(b.routing)} · acct ${mask(b.account_number)}</div></div>`).join('');
  const entCard=(e)=>{
    const r=e.rec||{};
    const bk=banks.filter(x=>entKey(x.entity)===e.key), cd=cards.filter(x=>entKey(x.entity)===e.key);
    return `<details style="margin:6px 0"><summary style="cursor:pointer"><strong>${esc(e.name)}</strong>${r.tax_id?` <span class="hint">· EIN ${mask(r.tax_id)}</span>`:''}${r.npi?` <span class="hint">· NPI ${esc(String(r.npi).split(' ')[0])}</span>`:''}</summary>
      <div style="padding:6px 0 2px">
        ${kv('Legal name',r.legal_name)}${kv('EIN / Tax ID',r.tax_id,true)}${kv('NPI',r.npi)}${kv('Taxonomy',r.taxonomy)}${kv('Medicaid ID',r.medicaid_id)}${kv('DUNS',r.duns)}${kv('Address',r.address)}${kv('Incorporated',r.incorp_date)}
        <div style="margin-top:6px"><strong style="font-size:13px">🏦 Bank accounts</strong>${bk.length?bankBlock(bk):'<div class="hint">none on file</div>'}</div>
        <div style="margin-top:6px"><strong style="font-size:13px">💳 Cards</strong>${cd.length?cardBlock(cd):'<div class="hint">none on file</div>'}</div>
      </div></details>`;
  };
  body.innerHTML=`<div class="pc-note" style="color:#a60;margin-bottom:8px">🔒 <strong>Sensitive vault</strong> — EINs, bank accounts, full card numbers/CVV, and logins. Owner + Executive Assistant only. Values are hidden until you tap “Show”. Treat this like a password manager.</div>
    <div class="toolbar" style="justify-content:flex-start;gap:8px;margin-bottom:6px"><button class="btn btn-gold btn-sm sans" onclick="ENT_SHOW=!ENT_SHOW;renderCorpEntities($('corpBody'))">${ENT_SHOW?'🙈 Hide values':'👁 Show values'}</button>${ME.role==='admin'?'<button class="btn btn-ghost btn-sm sans" onclick="importEntities()">⤓ Import the Excel sheet</button>':''}<span id="entMsg" class="hint" style="align-self:center"></span></div>
    <div class="card"><h3 style="margin-top:0">🏛️ Entities <span class="hint" style="font-weight:400">· ${active.length} active</span></h3>${active.length?active.map(entCard).join(''):'<div class="hint">No entities yet — admin can Import from file.</div>'}</div>
    ${closed.length?`<div class="card" style="opacity:.85"><details><summary style="cursor:pointer"><strong>🗄️ Archived — closed / sold entities</strong> <span class="hint">· ${closed.length}</span></summary><div style="margin-top:6px">${closed.map(entCard).join('')}</div></details></div>`:''}
    ${(orphanCards.length||orphanBanks.length)?`<div class="card"><details><summary style="cursor:pointer"><strong>💳 Cards / accounts not tied to an entity</strong> <span class="hint">· ${orphanCards.length+orphanBanks.length}</span></summary><div style="margin-top:6px">${bankBlock(orphanBanks)}${cardBlock(orphanCards)}</div></details></div>`:''}
    <div class="card"><h3 style="margin-top:0">🔑 Portals &amp; logins <span class="hint" style="font-weight:400">· ${portals.length}</span></h3>
      ${portals.length?`<table class="tbl"><tr><th>Portal</th><th>Username</th><th>Password</th><th>Info</th><th>Entity</th></tr>${portals.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td class="hint">${esc(p.username||'')}</td><td>${mask(p.password)}</td><td class="hint">${esc(p.info||'')}</td><td class="hint">${esc(p.entity||'')}</td></tr>`).join('')}</table>`:'<div class="hint">No logins yet.</div>'}</div>`;
}
async function importEntities(){
  const inp=document.createElement('input'); inp.type='file';
  inp.accept='.xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f)return;
    const isXlsx=/\.xlsx$/i.test(f.name);
    if(!confirm('Import the entity vault from "'+f.name+'"? This replaces the current entity data.'))return;
    if($('entMsg'))$('entMsg').textContent=isXlsx?'Reading the Excel sheet…':'Importing…';
    const done=(resp)=>{ if($('entMsg'))$('entMsg').textContent=`✓ Imported ${resp.imported.records} entities, ${resp.imported.banks} bank accts, ${resp.imported.cards} cards, ${resp.imported.portals} logins.`; renderCorpEntities($('corpBody')); };
    const fail=(e)=>{ if($('entMsg'))$('entMsg').textContent=e.message; };
    const r=new FileReader();
    if(isXlsx){
      r.onload=async()=>{ const data=String(r.result).replace(/^data:[^;]+;base64,/,'');
        try{ done(await api('/corp/entities/import-xlsx',{method:'POST',body:JSON.stringify({data})})); }catch(e){ fail(e); } };
      r.readAsDataURL(f);
    } else {
      r.onload=async()=>{ let payload; try{ payload=JSON.parse(r.result); }catch(e){ fail(new Error('That file isn’t valid JSON — upload the Excel sheet (.xlsx) instead.')); return; }
        try{ done(await api('/corp/entities/import',{method:'POST',body:JSON.stringify(payload)})); }catch(e){ fail(e); } };
      r.readAsText(f);
    }
  };
  inp.click();
}
let LEASE_DATA=null, LEASE_OPEN=null, LEASE_FILE=null;
async function renderCorpLeases(body){
  let d; try{ d=await api('/corp/leases'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  LEASE_DATA=d;
  let leases=(d.leases||[]); if(CORP_FAC) leases=leases.filter(l=>l.entity===CORP_FAC);
  const soon=(dt)=>{ if(!dt)return''; const days=Math.round((Date.parse(dt)-Date.now())/864e5); return days<=90?` <span style="color:${days<0?'var(--danger)':'#a60'};font-weight:600">${days<0?'expired':days+'d'}</span>`:''; };
  const rows=leases.map(l=>`<tr>
      <td><strong>${esc(l.entity)}</strong><div class="hint">${esc(l.property_address||'')}</div></td>
      <td class="hint">${esc(l.landlord||'')}</td>
      <td class="hint">${esc(l.monthly_rent||'')}</td>
      <td>${esc((l.term_end||'').slice(0,10)||'—')}${soon(l.term_end)}</td>
      <td>${l.has_text?'<span style="color:var(--good)">✓ text on file</span>':'<span class="hint">no text</span>'}${l.doc_url?` · <a href="${esc(l.doc_url)}" target="_blank" rel="noopener">📄</a>`:''}</td>
      <td><button class="btn btn-gold btn-sm sans" onclick="openLease(${l.id})">Open / Ask</button> <button class="btn btn-ghost btn-sm sans" onclick="editLease(${l.id})">Edit</button></td></tr>`).join('')||'<tr><td colspan="6" class="hint">No leases yet — add one below.</td></tr>';
  body.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🏢 Facility leases</h3><p class="sub sans" style="margin:0">Every lease with its key terms — and an AI assistant that answers questions from the lease text (e.g. “is the roof the landlord’s responsibility?”).</p></div><button class="btn btn-gold btn-sm sans" onclick="newLease()">+ Add lease</button></div>
      <div style="overflow-x:auto"><table class="tbl"><tr><th>Entity / property</th><th>Landlord</th><th>Rent</th><th>Term ends</th><th>Lease text</th><th></th></tr>${rows}</table></div></div>
    <div id="leaseEditor"></div>
    <div id="leasePanel"></div>`;
  if(LEASE_OPEN) openLease(LEASE_OPEN);
}
function newLease(){ editLease(0); }
async function editLease(id){
  const host=$('leaseEditor'); if(!host) return;
  let l={entity:CORP_FAC||'',property_address:'',landlord:'',landlord_contact:'',monthly_rent:'',security_deposit:'',term_start:'',term_end:'',renewal_terms:'',responsibilities:'',doc_url:'',lease_text:'',notes:''};
  if(id){ try{ const r=await api('/corp/leases/'+id); l=r.lease; }catch(e){ alert(e.message); return; } }
  const locs=(LEASE_DATA&&LEASE_DATA.locations)||[];
  LEASE_FILE=l.file_id||null;
  host.innerHTML=`<div class="card" style="background:#f4fafb;border-left:4px solid var(--aqua)"><h3 style="margin-top:0">${id?'Edit':'Add'} lease</h3>
    <div class="pc-note" style="background:#faf6ee;border-left:4px solid var(--gold)"><strong>📎 Upload the lease — AI reads &amp; fills it in</strong>, and powers the Q&amp;A. <button class="btn btn-gold btn-sm sans" onclick="corpPickFile('leases',$('leaseUpStatus'),applyLeaseExtract)">Upload lease (PDF/photo)</button> <span id="leaseUpStatus" class="hint"></span></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px">
      <label class="hint">Entity<br><select id="lEntity"><option value="">—</option>${locs.map(x=>`<option ${x===l.entity?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="hint">Property address<br><input id="lAddr" value="${esc(l.property_address||'')}" style="min-width:200px"/></label>
      <label class="hint">Landlord<br><input id="lLandlord" value="${esc(l.landlord||'')}" style="min-width:140px"/></label>
      <label class="hint">Landlord contact<br><input id="lLandContact" value="${esc(l.landlord_contact||'')}" style="min-width:150px"/></label></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px">
      <label class="hint">Monthly rent<br><input id="lRent" value="${esc(l.monthly_rent||'')}" style="width:100px"/></label>
      <label class="hint">Security deposit<br><input id="lDep" value="${esc(l.security_deposit||'')}" style="width:100px"/></label>
      <label class="hint">Term start<br><input id="lStart" type="date" value="${esc((l.term_start||'').slice(0,10))}"/></label>
      <label class="hint">Term end<br><input id="lEnd" type="date" value="${esc((l.term_end||'').slice(0,10))}"/></label>
      <label class="hint">Lease PDF link<br><input id="lDoc" value="${esc(l.doc_url||'')}" placeholder="Drive/OneDrive" style="min-width:150px"/></label></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px">
      <label class="hint">Landlord email <span style="color:var(--aqua)">(for auto-routing)</span><br><input id="lLandEmail" value="${esc(l.landlord_email||'')}" placeholder="landlord@…" style="min-width:170px"/></label>
      <label class="hint">Landlord-responsible categories<br><input id="lLandCats" value="${esc(l.landlord_categories||'')}" placeholder="Plumbing, HVAC, Roof, Structural, Electrical" style="min-width:260px"/></label></div>
    <label class="hint" style="display:block;margin-top:6px">Renewal terms</label><input id="lRenew" value="${esc(l.renewal_terms||'')}" style="width:100%"/>
    <label class="hint" style="display:block;margin-top:6px">Full lease text <span style="color:var(--aqua)">— paste the whole lease here so the AI can answer questions from it</span></label>
    <textarea id="lText" rows="7" style="width:100%;font-family:inherit" placeholder="Paste the lease text (or the key clauses)…">${esc(l.lease_text||'')}</textarea>
    <div class="toolbar" style="justify-content:flex-start;margin-top:8px"><button class="btn btn-gold btn-sm sans" onclick="saveLease(${id||0})">Save lease</button><button class="btn btn-ghost btn-sm sans" onclick="$('leaseEditor').innerHTML=''">Cancel</button>${id?`<button class="btn btn-ghost btn-sm sans" style="color:var(--danger)" onclick="delLease(${id})">Delete</button>`:''}<span id="lMsg" class="hint" style="align-self:center"></span></div></div>`;
}
function applyLeaseExtract(f,fileId){
  LEASE_FILE=fileId||LEASE_FILE;
  setVal('lAddr',f.property_address); setVal('lLandlord',f.landlord); setVal('lLandEmail',f.landlord_email); setVal('lLandContact',f.landlord_contact);
  setVal('lRent',f.monthly_rent); setVal('lDep',f.security_deposit); setVal('lStart',(f.term_start||'').slice(0,10)); setVal('lEnd',(f.term_end||'').slice(0,10));
  setVal('lRenew',f.renewal_terms); setVal('lLandCats',f.landlord_categories);
}
async function saveLease(id){
  const g=x=>($(x)||{}).value||'';
  const b={id:id||undefined,entity:g('lEntity'),property_address:g('lAddr'),landlord:g('lLandlord'),landlord_contact:g('lLandContact'),monthly_rent:g('lRent'),security_deposit:g('lDep'),term_start:g('lStart'),term_end:g('lEnd'),renewal_terms:g('lRenew'),doc_url:g('lDoc'),lease_text:g('lText'),landlord_email:g('lLandEmail'),landlord_categories:g('lLandCats'),file_id:LEASE_FILE};
  if(!b.entity){ if($('lMsg'))$('lMsg').textContent='Pick an entity.'; return; }
  try{ await api('/corp/leases',{method:'POST',body:JSON.stringify(b)}); $('leaseEditor').innerHTML=''; renderCorpLeases($('corpBody')); }catch(e){ if($('lMsg'))$('lMsg').textContent=e.message; }
}
async function delLease(id){ if(!confirm('Delete this lease?'))return; try{ await api('/corp/leases/'+id,{method:'DELETE'}); LEASE_OPEN=null; $('leaseEditor').innerHTML=''; renderCorpLeases($('corpBody')); }catch(e){ alert(e.message); } }
async function openLease(id){
  LEASE_OPEN=id; const host=$('leasePanel'); if(!host) return;
  host.innerHTML='<div class="card"><div class="hint">Loading lease…</div></div>';
  let r; try{ r=await api('/corp/leases/'+id); }catch(e){ host.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const l=r.lease, qs=r.questions||[];
  const term=[l.term_start?('starts '+l.term_start.slice(0,10)):'',l.term_end?('ends '+l.term_end.slice(0,10)):''].filter(Boolean).join(' · ');
  const hist=qs.map(q=>`<div class="pc-note"><strong>Q:</strong> ${esc(q.question)}<div style="margin-top:4px;white-space:pre-wrap">${esc(q.answer||'')}</div><div class="hint" style="margin-top:2px">${esc(q.asked_by||'')} · ${esc((q.created_at||'').slice(0,16))}</div></div>`).join('');
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">${esc(l.entity)} — lease</h3><p class="sub sans" style="margin:0">${esc(l.property_address||'')}${l.landlord?' · Landlord: '+esc(l.landlord):''}${term?' · '+esc(term):''}${l.monthly_rent?' · '+esc(l.monthly_rent)+'/mo':''}</p></div>${l.doc_url?`<a class="btn btn-ghost btn-sm sans" href="${esc(l.doc_url)}" target="_blank" rel="noopener">📄 Open PDF</a>`:''}</div>
    <div style="background:#faf6ee;border-left:4px solid var(--gold);padding:10px;border-radius:6px;margin-top:8px">
      <h3 style="margin:0 0 4px">🤖 Ask about this lease</h3>
      <p class="sub sans" style="margin:0 0 6px">${l.file_id||(l.lease_text&&l.lease_text.length>40)?'Ask anything — e.g. “Is the HVAC repair the landlord’s responsibility?” Answers come only from this lease document.':'<span style="color:#a60">No lease on file yet. Tap Edit and <strong>upload the lease</strong> (or paste its text) so the assistant can read it.</span>'}</p>
      <div class="toolbar" style="justify-content:flex-start;gap:6px"><input id="leaseQ" placeholder="Is ___ covered by the landlord?" style="flex:1;min-width:200px" onkeydown="if(event.key==='Enter')askLeaseQ(${l.id})"/><button class="btn btn-gold btn-sm sans" onclick="askLeaseQ(${l.id})">Ask</button></div>
      <div class="toolbar chip-row" style="justify-content:flex-start;gap:4px;margin-top:4px">${['Who pays for roof repairs?','Is HVAC the landlord’s responsibility?','What are my renewal options?','Who handles snow removal & landscaping?','Can I sublease or assign?'].map(s=>`<button class="btn btn-ghost btn-sm sans" onclick="$('leaseQ').value=this.textContent;askLeaseQ(${l.id})" style="font-size:11px">${esc(s)}</button>`).join('')}</div>
      <div id="leaseAns"></div></div>
    ${hist?`<h3 style="font-size:14px;margin:12px 0 4px">Earlier questions</h3>${hist}`:''}</div>`;
}
async function askLeaseQ(id){
  const q=($('leaseQ')||{}).value||''; if(!q.trim())return;
  const ans=$('leaseAns'); if(ans)ans.innerHTML='<div class="hint" style="margin-top:8px">Reading the lease…</div>';
  try{ const r=await api('/corp/leases/'+id+'/ask',{method:'POST',body:JSON.stringify({question:q})});
    if(ans)ans.innerHTML=`<div class="pc-note" style="margin-top:8px;white-space:pre-wrap;background:#fff">${esc(r.answer)}</div><div class="hint" style="margin-top:2px">Guidance from the document — confirm anything ambiguous with counsel or the broker.</div>`;
  }catch(e){ if(ans)ans.innerHTML='<div class="hint" style="margin-top:8px;color:var(--danger)">'+esc(e.message)+'</div>'; }
}
// Upload a document → AI reads it → prefill a form. kind: 'insurance' | 'leases'.
function corpPickFile(kind, statusEl, onDone){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.pdf,image/*';
  inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f)return; if(statusEl)statusEl.innerHTML='⏳ Reading <strong>'+esc(f.name)+'</strong> with AI…';
    const r=new FileReader(); r.onload=async()=>{ const data=String(r.result).replace(/^data:[^;]+;base64,/,'');
      try{ const resp=await api('/corp/'+kind+'/extract',{method:'POST',body:JSON.stringify({data,media_type:f.type||'application/pdf',name:f.name})});
        if(statusEl)statusEl.innerHTML='✓ Read <strong>'+esc(f.name)+'</strong> — review the fields below and Save.'; onDone(resp.fields||{}, resp.fileId, resp.fileUrl); }
      catch(e){ if(statusEl)statusEl.innerHTML='<span style="color:var(--danger)">'+esc(e.message)+'</span>'; } };
    r.readAsDataURL(f);
  };
  inp.click();
}
let INS_DATA=null, INS_EDIT=null, INS_FILE=null;
async function renderCorpInsurance(body){
  let d; try{ d=await api('/corp/insurance'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  INS_DATA=d;
  const s=d.summary||{}, locs=(CORP_FAC?[CORP_FAC]:d.locations||[]), types=d.coverageTypes||[], req=d.required||[];
  const money=(n)=>'$'+Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0});
  const box=(n,l,col)=>`<div class="ret-card"><div class="n"${col?' style="color:'+col+'"':''}>${n}</div><div class="l">${l}</div></div>`;
  // Coverage matrix
  const cellHtml=(loc,ct)=>{ const c=(d.matrix[loc]||{})[ct]||{status:'missing'}; const isReq=req.includes(ct);
    if(c.status==='missing') return `<td style="text-align:center;background:${isReq?'#fdecea':'#fafafa'}" title="${isReq?'REQUIRED — missing':'not carried'}">${isReq?'<span style="color:var(--danger);font-weight:700">✗</span>':'<span class="hint">—</span>'}</td>`;
    const col=c.status==='expired'?'var(--danger)':c.status==='expiring'?'#a60':'var(--good)';
    const sym=c.status==='expired'?'⚠':c.status==='expiring'?'●':'✓';
    return `<td style="text-align:center;cursor:pointer" title="${esc(ct)} · ${esc(c.carrier||'')} · exp ${esc(c.exp||'')}${c.daysLeft!=null?' ('+c.daysLeft+'d)':''}" onclick="editInsurance(${c.id})"><span style="color:${col};font-weight:700">${sym}</span>${c.status!=='active'&&c.daysLeft!=null?`<div class="hint" style="font-size:10px">${c.daysLeft<0?Math.abs(c.daysLeft)+'d over':c.daysLeft+'d'}</div>`:''}</td>`;
  };
  const matrixHtml=`<div style="overflow-x:auto"><table class="tbl nomcard" style="font-size:12px"><tr><th>Entity</th>${types.map(ct=>`<th style="writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;height:110px;${req.includes(ct)?'':'opacity:.6'}">${esc(ct)}${req.includes(ct)?' *':''}</th>`).join('')}</tr>
    ${locs.map(loc=>`<tr><td style="white-space:nowrap"><strong>${esc(loc)}</strong></td>${types.map(ct=>cellHtml(loc,ct)).join('')}</tr>`).join('')}</table></div>
    <div class="hint" style="margin-top:4px">✓ active · <span style="color:#a60">●</span> renewing ≤60d · <span style="color:var(--danger)">⚠</span> expired · <span style="color:var(--danger)">✗</span> required &amp; missing · * = required. Tap a cell to open the policy.</div>`;
  // Gaps
  const gaps=(d.gaps||[]).filter(g=>!CORP_FAC||g.entity===CORP_FAC);
  const gapHtml=gaps.length?`<div class="card" style="border-left:4px solid var(--danger)"><h3 style="margin-top:0;color:var(--danger)">⚠ Coverage gaps — ${gaps.length}</h3><p class="sub sans" style="margin:0 0 6px">Required coverage that's missing or expired. Close these so every entity is fully covered.</p>${gaps.map(g=>`<div class="pc-note">• <strong>${esc(g.entity)}</strong> — ${esc(g.coverage)} <span style="color:var(--danger)">${g.status==='expired'?'EXPIRED':'MISSING'}</span> <button class="btn btn-ghost btn-sm sans" onclick="newInsurance('${g.entity.replace(/'/g,"\\'")}','${g.coverage.replace(/'/g,"\\'")}')">Add policy</button></div>`).join('')}</div>`:'<div class="card" style="border-left:4px solid var(--good)"><h3 style="margin-top:0;color:var(--good)">✓ No coverage gaps</h3><p class="sub sans" style="margin:0">Every entity carries all required coverage. Keep it that way — renewals are watched automatically.</p></div>';
  // Expiring soon
  let pols=(d.policies||[]).slice();
  if(CORP_FAC) pols=pols.filter(p=>p.entity===CORP_FAC);
  const soon=pols.filter(p=>p.daysLeft!=null&&p.status!=='cancelled'&&p.daysLeft<=90).sort((a,b)=>a.daysLeft-b.daysLeft);
  const soonHtml=soon.length?`<div class="card"><h3 style="margin-top:0">⏰ Renewing soon &amp; overdue</h3><table class="tbl"><tr><th>Entity</th><th>Coverage</th><th>Carrier</th><th>Expires</th><th>Days</th><th>Broker</th><th></th></tr>${soon.map(p=>`<tr><td><strong>${esc(p.entity)}</strong></td><td>${esc(p.coverage_type)}</td><td class="hint">${esc(p.carrier||'')}</td><td>${esc((p.expiration_date||'').slice(0,10))}</td><td style="color:${p.daysLeft<0?'var(--danger)':p.daysLeft<=14?'var(--danger)':p.daysLeft<=30?'#a60':'inherit'};font-weight:600">${p.daysLeft<0?Math.abs(p.daysLeft)+'d over':p.daysLeft+'d'}</td><td class="hint">${esc(p.brokerName||'')}</td><td><button class="btn btn-ghost btn-sm sans" onclick="editInsurance(${p.id})">Open</button></td></tr>`).join('')}</table></div>`:'';
  // Full policy list
  const polRows=pols.sort((a,b)=>(a.entity+a.coverage_type).localeCompare(b.entity+b.coverage_type)).map(p=>`<tr><td><strong>${esc(p.entity)}</strong></td><td>${esc(p.coverage_type)}</td><td class="hint">${esc(p.carrier||'')}<div>${esc(p.policy_number||'')}</div></td><td class="hint">${p.premium?money(p.premium)+'/yr':''}</td><td>${esc((p.expiration_date||'').slice(0,10))}</td><td>${insStatusPill(p.liveStatus)}</td><td class="hint">${p.doc_url?`<a href="${esc(p.doc_url)}" target="_blank" rel="noopener">policy 📄</a>`:''}</td><td><button class="btn btn-ghost btn-sm sans" onclick="editInsurance(${p.id})">Edit</button></td></tr>`).join('')||'<tr><td colspan="8" class="hint">No policies yet — add them below or from a gap above.</td></tr>';
  body.innerHTML=`<div class="ret-cards" style="margin-top:4px">${box(s.activeCovers||0,'Active policies')}${box(s.expiring60||0,'Renewing ≤60d',(s.expiring60?'#a60':''))}${box(s.expired||0,'Expired',(s.expired?'var(--danger)':''))}${box(s.gaps||0,'Coverage gaps',(s.gaps?'var(--danger)':'var(--good)'))}${box(money(s.totalPremium),'Annual premium')}</div>
    <div class="toolbar" style="justify-content:flex-start;gap:8px;margin:6px 0"><button class="btn btn-gold btn-sm sans" onclick="newInsurance()">+ Add policy</button><button class="btn btn-ghost btn-sm sans" onclick="runInsReminders(this)">Send renewal check now</button><span id="insMsg" class="hint" style="align-self:center"></span></div>
    <div id="insEditor"></div>
    ${gapHtml}
    <div class="card"><h3 style="margin-top:0">🗺️ Coverage matrix ${CORP_FAC?'· '+esc(CORP_FAC):'· every entity × every line'}</h3>${matrixHtml}</div>
    ${soonHtml}
    <div class="card"><h3 style="margin-top:0">All policies <span class="hint" style="font-weight:400">· ${pols.length}</span></h3><div style="overflow-x:auto"><table class="tbl"><tr><th>Entity</th><th>Coverage</th><th>Carrier / policy #</th><th>Premium</th><th>Expires</th><th>Status</th><th>Copy</th><th></th></tr>${polRows}</table></div></div>
    <div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">🧑‍💼 Brokers</h3></div></div><div id="insBrokers"></div></div>`;
  if(INS_EDIT!==null) openInsuranceEditor(INS_EDIT);
  renderInsBrokers();
}
function insStatusPill(s){ return ({active:'<span class="risk" style="background:#e6f4ea;color:#137333">active</span>',expiring:'<span class="risk risk-elev">renewing</span>',expired:'<span class="risk risk-high">expired</span>',pending:'<span class="hint">pending</span>',cancelled:'<span class="hint">cancelled</span>'}[s]||s); }
function newInsurance(entity,coverage){ INS_EDIT={entity:entity||'',coverage_type:coverage||''}; openInsuranceEditor(INS_EDIT); }
function editInsurance(id){ const p=(INS_DATA.policies||[]).find(x=>x.id===id); if(p){ INS_EDIT=p; openInsuranceEditor(p); } }
function openInsuranceEditor(p){
  const host=$('insEditor'); if(!host) return; INS_EDIT=p;
  const d=INS_DATA||{}; const locs=d.locations||[], types=d.coverageTypes||[], brokers=d.brokers||[];
  const opt=(arr,cur)=>arr.map(x=>`<option ${x===cur?'selected':''}>${esc(x)}</option>`).join('');
  INS_FILE=p.file_id||null;
  host.innerHTML=`<div class="card" style="background:#f4fafb;border-left:4px solid var(--aqua)"><h3 style="margin-top:0">${p.id?'Edit':'Add'} policy</h3>
    <div class="pc-note" style="background:#faf6ee;border-left:4px solid var(--gold)"><strong>📎 Upload the policy — AI fills it in.</strong> No manual typing. <button class="btn btn-gold btn-sm sans" onclick="corpPickFile('insurance',$('insUpStatus'),applyInsExtract)">Upload contract (PDF/photo)</button> <span id="insUpStatus" class="hint"></span></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px">
      <label class="hint">Entity<br><select id="iEntity"><option value="">—</option>${opt(locs,p.entity)}</select></label>
      <label class="hint">Coverage<br><select id="iType"><option value="">—</option>${opt(types,p.coverage_type)}</select></label>
      <label class="hint">Carrier<br><input id="iCarrier" value="${esc(p.carrier||'')}" style="min-width:130px"/></label>
      <label class="hint">Policy #<br><input id="iPolNum" value="${esc(p.policy_number||'')}" style="min-width:110px"/></label>
      <label class="hint">Broker<br><select id="iBroker"><option value="">—</option>${brokers.map(b=>`<option value="${b.id}" ${p.broker_id===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label></div>
    <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px">
      <label class="hint">Effective<br><input id="iEff" type="date" value="${esc((p.effective_date||'').slice(0,10))}"/></label>
      <label class="hint">Expiration<br><input id="iExp" type="date" value="${esc((p.expiration_date||'').slice(0,10))}"/></label>
      <label class="hint">Premium/yr<br><input id="iPrem" value="${p.premium!=null?p.premium:''}" placeholder="$" style="width:90px"/></label>
      <label class="hint">Limit each<br><input id="iLimE" value="${esc(p.limit_each||'')}" placeholder="$1M" style="width:90px"/></label>
      <label class="hint">Aggregate<br><input id="iLimA" value="${esc(p.limit_aggregate||'')}" placeholder="$3M" style="width:90px"/></label>
      <label class="hint">Deductible<br><input id="iDed" value="${esc(p.deductible||'')}" style="width:90px"/></label>
      <label class="hint">Status<br><select id="iStatus">${opt(['active','pending','expired','cancelled'],p.status||'active')}</select></label></div>
    <label class="hint" style="display:block;margin-top:6px">Policy copy (link to file)</label><input id="iDoc" value="${esc(p.doc_url||'')}" placeholder="Drive/OneDrive link to the policy PDF" style="width:100%"/>
    <label class="hint" style="display:block;margin-top:6px">Notes</label><input id="iNotes" value="${esc(p.notes||'')}" style="width:100%"/>
    <div class="toolbar" style="justify-content:flex-start;margin-top:8px"><button class="btn btn-gold btn-sm sans" onclick="saveInsurance()">Save policy</button><button class="btn btn-ghost btn-sm sans" onclick="INS_EDIT=null;$('insEditor').innerHTML=''">Cancel</button>${p.id?`<button class="btn btn-ghost btn-sm sans" style="color:var(--danger)" onclick="delInsurance(${p.id})">Delete</button>`:''}<span id="iMsg" class="hint" style="align-self:center"></span></div></div>`;
}
function setVal(id,v){ const el=$(id); if(el&&v!=null&&v!=='') el.value=v; }
function applyInsExtract(f,fileId){
  INS_FILE=fileId||INS_FILE;
  // entity: try to match named insured to a known location
  if(f.named_insured){ const locs=(INS_DATA&&INS_DATA.locations)||[]; const hit=locs.find(l=>l.toLowerCase().includes(String(f.named_insured).toLowerCase().split(',')[0].slice(0,10))||String(f.named_insured).toLowerCase().includes(l.toLowerCase().split(',')[0].slice(0,10))); if(hit&&$('iEntity'))$('iEntity').value=hit; }
  if(f.coverage_type){ const types=(INS_DATA&&INS_DATA.coverageTypes)||[]; const m=types.find(t=>t.toLowerCase()===String(f.coverage_type).toLowerCase())||types.find(t=>String(f.coverage_type).toLowerCase().includes(t.toLowerCase().split(' ')[0])); if(m&&$('iType'))$('iType').value=m; }
  setVal('iCarrier',f.carrier); setVal('iPolNum',f.policy_number); setVal('iEff',(f.effective_date||'').slice(0,10)); setVal('iExp',(f.expiration_date||'').slice(0,10));
  setVal('iPrem',f.premium); setVal('iLimE',f.limit_each); setVal('iLimA',f.limit_aggregate); setVal('iDed',f.deductible); setVal('iNotes',f.notes);
}
async function saveInsurance(){
  const g=id=>($(id)||{}).value||'';
  const b={id:INS_EDIT&&INS_EDIT.id,entity:g('iEntity'),coverage_type:g('iType'),carrier:g('iCarrier'),policy_number:g('iPolNum'),broker_id:g('iBroker')||null,broker_name:'',effective_date:g('iEff'),expiration_date:g('iExp'),premium:g('iPrem'),limit_each:g('iLimE'),limit_aggregate:g('iLimA'),deductible:g('iDed'),status:g('iStatus'),doc_url:g('iDoc'),notes:g('iNotes'),file_id:INS_FILE};
  const bk=(INS_DATA.brokers||[]).find(x=>String(x.id)===String(b.broker_id)); if(bk) b.broker_name=bk.name;
  if(!b.entity||!b.coverage_type){ if($('iMsg'))$('iMsg').textContent='Entity and coverage are required.'; return; }
  try{ await api('/corp/insurance',{method:'POST',body:JSON.stringify(b)}); INS_EDIT=null; renderCorpInsurance($('corpBody')); }catch(e){ if($('iMsg'))$('iMsg').textContent=e.message; }
}
async function delInsurance(id){ if(!confirm('Delete this policy record?'))return; try{ await api('/corp/insurance/'+id,{method:'DELETE'}); INS_EDIT=null; renderCorpInsurance($('corpBody')); }catch(e){ alert(e.message); } }
async function runInsReminders(btn){ if(btn)btn.disabled=true; if($('insMsg'))$('insMsg').textContent='Checking renewals…'; try{ const r=await api('/corp/insurance/run-reminders',{method:'POST'}); if($('insMsg'))$('insMsg').textContent=r.sent?`✓ Sent — ${r.dueSoon} renewing, ${r.expired} expired.`:'Nothing due right now — all clear.'; }catch(e){ if($('insMsg'))$('insMsg').textContent=e.message; } if(btn)btn.disabled=false; }
function renderInsBrokers(){
  const host=$('insBrokers'); if(!host) return; const bs=(INS_DATA&&INS_DATA.brokers)||[];
  host.innerHTML=`<div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"><input id="bkName" placeholder="Broker / agent" style="min-width:130px"/><input id="bkAgency" placeholder="Agency" style="min-width:120px"/><input id="bkPhone" placeholder="Phone" style="width:110px"/><input id="bkEmail" placeholder="Email" style="min-width:140px"/><button class="btn btn-gold btn-sm sans" onclick="saveBroker()">Add</button></div>
    ${bs.length?`<table class="tbl" style="margin-top:6px"><tr><th>Broker</th><th>Agency</th><th>Contact</th><th></th></tr>${bs.map(b=>`<tr><td><strong>${esc(b.name)}</strong></td><td class="hint">${esc(b.agency||'')}</td><td class="hint">${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:''}${b.email?' · '+esc(b.email):''}</td><td><button class="btn btn-ghost btn-sm sans" onclick="delBroker(${b.id})">🗑</button></td></tr>`).join('')}</table>`:'<div class="hint" style="margin-top:6px">No brokers yet.</div>'}`;
}
async function saveBroker(){ const b={name:($('bkName')||{}).value||'',agency:($('bkAgency')||{}).value||'',phone:($('bkPhone')||{}).value||'',email:($('bkEmail')||{}).value||''}; if(!b.name.trim())return; try{ await api('/corp/insurance/brokers',{method:'POST',body:JSON.stringify(b)}); renderCorpInsurance($('corpBody')); }catch(e){ alert(e.message); } }
async function delBroker(id){ if(!confirm('Remove broker?'))return; try{ await api('/corp/insurance/brokers/'+id,{method:'DELETE'}); renderCorpInsurance($('corpBody')); }catch(e){ alert(e.message); } }
async function addCorpTask(){
  const b={title:($('ctTitle')||{}).value||'',category:($('ctCat')||{}).value,priority:($('ctPri')||{}).value,assignee:($('ctAssignee')||{}).value||'',due_date:($('ctDue')||{}).value||'',detail:($('ctDetail')||{}).value||'',facility:CORP_FAC||''};
  if(!b.title.trim()){ if($('ctMsg'))$('ctMsg').textContent='Add a title.'; return; }
  try{ await api('/corp/tasks',{method:'POST',body:JSON.stringify(b)}); renderCorpProjects($('corpBody')); }catch(e){ if($('ctMsg'))$('ctMsg').textContent=e.message; }
}
async function setCorpTask(id,status){ try{ await api('/corp/tasks/'+id,{method:'PATCH',body:JSON.stringify({status})}); renderCorpProjects($('corpBody')); }catch(e){ alert(e.message); } }
async function delCorpTask(id){ if(!confirm('Delete this task?'))return; try{ await api('/corp/tasks/'+id,{method:'DELETE'}); renderCorpProjects($('corpBody')); }catch(e){ alert(e.message); } }
async function renderCorpVendors(body){
  let d; try{ d=await api('/corp/vendors'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const vs=d.vendors||[];
  const cats=['Supplies','Plumbing','Electrical','HVAC','IT','Landscaping','Utilities','Appliance','Cleaning','Other'];
  const row=(v)=>`<tr><td><strong>${esc(v.name)}</strong>${v.account_number?`<div class="hint">acct ${esc(v.account_number)}</div>`:''}</td><td class="hint">${esc(v.category||'')}</td><td>${esc(v.contact_name||'')}${v.phone?`<div><a href="tel:${esc(v.phone)}">${esc(v.phone)}</a></div>`:''}${v.email?`<div class="hint">${esc(v.email)}</div>`:''}</td><td class="hint">${esc(v.facility||'')}</td><td class="hint">${esc(v.notes||'')}</td><td><button class="btn btn-ghost btn-sm sans" onclick="delVendor(${v.id})">🗑</button></td></tr>`;
  body.innerHTML=`<div class="card"><h3 style="margin-top:0">📇 Vendors <span class="hint" style="font-weight:400">· ${vs.length}</span></h3>
      ${vs.length?`<table class="tbl"><tr><th>Vendor</th><th>Category</th><th>Contact</th><th>Facility</th><th>Notes</th><th></th></tr>${vs.map(row).join('')}</table>`:'<div class="hint">No vendors yet — add the ones you call.</div>'}</div>
    <div class="card"><details ${vs.length?'':'open'}><summary><strong>＋ Add a vendor</strong></summary><div style="margin-top:8px">
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
        <input id="vName" placeholder="Vendor name" style="min-width:160px"/>
        <select id="vCat">${cats.map(c=>`<option>${c}</option>`).join('')}</select>
        <input id="vContact" placeholder="Contact" style="min-width:120px"/>
        <input id="vPhone" placeholder="Phone" style="min-width:110px"/>
        <input id="vEmail" placeholder="Email" style="min-width:140px"/>
        <input id="vAcct" placeholder="Account #" style="min-width:100px"/>
        <input id="vFac" placeholder="Facility" style="min-width:110px"/>
        <input id="vNotes" placeholder="Notes (what they do, hours, etc.)" style="width:100%"/>
        <button class="btn btn-gold sans" onclick="saveVendor()">Add vendor</button></div>
      <span id="vMsg" class="hint"></span></div></details></div>`;
}
async function saveVendor(){
  const b={name:($('vName')||{}).value||'',category:($('vCat')||{}).value,contact_name:($('vContact')||{}).value||'',phone:($('vPhone')||{}).value||'',email:($('vEmail')||{}).value||'',account_number:($('vAcct')||{}).value||'',facility:($('vFac')||{}).value||'',notes:($('vNotes')||{}).value||''};
  if(!b.name.trim()){ if($('vMsg'))$('vMsg').textContent='Add a name.'; return; }
  try{ await api('/corp/vendors',{method:'POST',body:JSON.stringify(b)}); renderCorpVendors($('corpBody')); }catch(e){ if($('vMsg'))$('vMsg').textContent=e.message; }
}
async function delVendor(id){ if(!confirm('Remove this vendor?'))return; try{ await api('/corp/vendors/'+id,{method:'DELETE'}); renderCorpVendors($('corpBody')); }catch(e){ alert(e.message); } }
async function renderCorpDocs(body){
  let d; try{ d=await api('/corp/docs'); }catch(e){ body.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  const ds=d.docs||[];
  const types=['Lease','Utility','Insurance','Permit/License','Internet/Phone','Contract','Other'];
  const soon=(dt)=>{ if(!dt)return false; const days=(Date.parse(dt)-Date.now())/864e5; return days<=45; };
  const row=(x)=>`<tr><td><strong>${esc(x.title)}</strong>${x.url?` <a href="${esc(x.url)}" target="_blank" rel="noopener">↗</a>`:''}<div class="hint">${esc(x.doc_type)}${x.provider?' · '+esc(x.provider):''}</div></td><td class="hint">${esc(x.facility||'')}</td><td class="hint">${esc(x.account_number||'')}</td><td class="hint">${esc(x.amount||'')}</td><td>${x.renewal_date?`<span ${soon(x.renewal_date)?'style="color:var(--danger);font-weight:600"':''}>${esc(x.renewal_date)}</span>`:'<span class="hint">—</span>'}</td><td class="hint">${esc(x.notes||'')}</td><td><button class="btn btn-ghost btn-sm sans" onclick="corpDelDoc(${x.id})">🗑</button></td></tr>`;
  body.innerHTML=`<div class="card"><h3 style="margin-top:0">📁 Facility documents <span class="hint" style="font-weight:400">· ${ds.length}</span></h3>
      <p class="sub sans" style="margin:0 0 6px">Leases, utilities, insurance, permits, internet/phone — the recurring facts. Renewal dates within 45 days show in red.</p>
      ${ds.length?`<table class="tbl"><tr><th>Document</th><th>Facility</th><th>Account</th><th>Amount</th><th>Renews</th><th>Notes</th><th></th></tr>${ds.map(row).join('')}</table>`:'<div class="hint">Nothing stored yet — start with leases and utilities.</div>'}</div>
    <div class="card"><details ${ds.length?'':'open'}><summary><strong>＋ Add a document / recurring bill</strong></summary><div style="margin-top:8px">
      <div class="toolbar" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">
        <select id="dType">${types.map(t=>`<option>${t}</option>`).join('')}</select>
        <input id="dTitle" placeholder="Title (e.g. Akron lease)" style="min-width:170px"/>
        <input id="dProvider" placeholder="Provider / landlord" style="min-width:140px"/>
        <input id="dFac" placeholder="Facility" style="min-width:110px"/>
        <input id="dAcct" placeholder="Account #" style="min-width:100px"/>
        <input id="dAmount" placeholder="Amount (e.g. $2,400/mo)" style="min-width:120px"/>
        <label class="hint">Renews <input id="dRenew" type="date"/></label>
        <input id="dUrl" placeholder="Link to file (Drive/OneDrive) — optional" style="width:100%"/>
        <input id="dNotes" placeholder="Notes" style="width:100%"/>
        <button class="btn btn-gold sans" onclick="corpSaveDoc()">Add document</button></div>
      <span id="dMsg" class="hint"></span></div></details></div>`;
}
async function corpSaveDoc(){
  const b={doc_type:($('dType')||{}).value,title:($('dTitle')||{}).value||'',provider:($('dProvider')||{}).value||'',facility:($('dFac')||{}).value||'',account_number:($('dAcct')||{}).value||'',amount:($('dAmount')||{}).value||'',renewal_date:($('dRenew')||{}).value||'',url:($('dUrl')||{}).value||'',notes:($('dNotes')||{}).value||''};
  if(!b.title.trim()){ if($('dMsg'))$('dMsg').textContent='Add a title.'; return; }
  try{ await api("/corp/docs",{method:"POST",body:JSON.stringify(b)}); renderCorpDocs($('corpBody')); }catch(e){ if($('dMsg'))$('dMsg').textContent=e.message; }
}
async function corpDelDoc(id){ if(!confirm("Delete this document record?"))return; try{ await api("/corp/docs/"+id,{method:'DELETE'}); renderCorpDocs($('corpBody')); }catch(e){ alert(e.message); } }
function renderCorpRole(body){
  body.innerHTML=`<div class="card"><h3 style="margin-top:0">⭐ Corporate Operations — the role</h3>
    <p class="sub sans">The corporate team keeps the facilities running so the care teams can focus on people — the owner's right hand on everything operational, administrative, and vendor-facing across all locations. (Chava — Executive Assistant.)</p>
    <h3 style="font-size:14px;margin:10px 0 4px">What good looks like</h3>
    <ul class="sans" style="margin:0;padding-left:18px;line-height:1.7">
      <li><strong>Nothing runs out, nothing stays broken.</strong> Open orders and maintenance are cleared fast — you watch the Dashboard and drive both cycle times down.</li>
      <li><strong>Every project moves.</strong> Anything the owner or team drops on your board gets a status, an owner, and a next step within the day. Nothing sits in “to-do” silently.</li>
      <li><strong>One source of truth.</strong> Leases, utilities, insurance, permits, and the vendor list are all current here — anyone can find a document or a phone number in seconds.</li>
      <li><strong>Ahead of renewals.</strong> No lease or policy ever lapses — you act on the red renewal dates before they arrive.</li>
      <li><strong>You make it easy.</strong> The facility confirms; you don't chase. Orders and work orders flow to you and update themselves — your job is oversight and follow-through, not data entry.</li>
    </ul>
    <h3 style="font-size:14px;margin:12px 0 4px">Your responsibilities</h3>
    <ul class="sans" style="margin:0;padding-left:18px;line-height:1.7">
      <li>Ordering &amp; supply flow across facilities (with automation doing the heavy lifting).</li>
      <li>Maintenance coordination — dispatch, follow-up, and closeout with vendors.</li>
      <li>Project &amp; task management for the owner (executive-assistant work).</li>
      <li>Facility records: leases, utilities, insurance, permits, vendor directory.</li>
      <li>Employee-morale items you and the facility partner on.</li>
    </ul></div>`;
}
async function loadOutpatient(){
  const host=$('outpatient'); if(!host) return;
  host.innerHTML='<div class="hint">Loading…</div>';
  let d; try{ d=await api('/outpatient'); }catch(e){ host.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  OP_DATA=d; if(!OP_PERIOD) OP_PERIOD=opDefaultPeriod();
  const c=d.counts||{};
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const asOf=d.asOf?('Kipu · as of '+esc(d.asOf)):'Not pulled yet';
  const roster=(d.roster||[]);
  const group=(lc)=>{ const r=roster.filter(x=>x.locClass===lc); if(!r.length) return ''; return `<div class="card"><h3 style="margin-top:0">${lc==='PHP'?'PHP — Partial Hospitalization':lc==='IOP'?'IOP — Intensive Outpatient':lc} <span class="hint" style="font-weight:400">· ${r.length}</span></h3>
    <table class="tbl"><tr><th>Client</th><th>Payer</th><th>Level</th><th>Admit</th><th>Therapist</th></tr>${r.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td class="hint">${esc(x.payer||'—')}</td><td class="hint">${esc(x.level||'')}</td><td>${esc(x.admit||'—')}</td><td class="hint">${esc(x.therapist||'')}</td></tr>`).join('')}</table></div>`; };
  const other=roster.filter(x=>!['PHP','IOP'].includes(x.locClass));
  const lb=d.levelBreakdown||{};
  const lbHtml=Object.keys(lb).length?`<details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Level-of-care breakdown — what Kipu returned per person (tap to diagnose counts)</summary><div style="margin-top:4px">${Object.entries(lb).map(([k,n])=>`<div class="hint" style="font-family:monospace;font-size:12px">${esc(k)} — <strong>${n}</strong></div>`).join('')}</div></details>`:'';
  const opFacName=((ME.facilities||[]).find(f=>String(f.id)===String(FAC_SCOPE))||{}).name;
  host.innerHTML=`<div class="card"><div class="cmd-hero-row"><div><h3>🏥 ${esc(opFacName||'Outpatient — PHP · IOP · OP')}${opFacName?'':` <span class="hint" style="font-weight:400">· ${esc(d.location||'')}</span>`}</h3><p class="sub sans">Live from Kipu — your outpatient census &amp; movement, by level of care and payer. ${esc(asOf)} · auto-refreshes daily.</p></div>
      <button class="btn btn-gold btn-sm sans" onclick="refreshOutpatient(this)">↻ Refresh from Kipu</button></div>
      ${d.kipuReady?'':'<div class="pc-note" style="color:var(--danger)">Kipu isn’t connected — set it up in Settings → Integrations.</div>'}
      <div class="ret-cards" style="margin-top:8px">${box(c.PHP||0,'In PHP now','rc-elev')}${box(c.IOP||0,'In IOP now')}${box(c.OP||0,'OP')}${box(c.total||0,'Total enrolled')}</div>
      ${lbHtml}
      <span id="opMsg" class="hint"></span></div>
    ${d.isAdmin?`<div class="card" style="background:#f4fafb;border-left:4px solid var(--aqua)"><div class="cmd-hero-row"><div><h3 style="margin:0">🔍 Find the right level &amp; authorization fields</h3><p class="sub sans" style="margin:0">OP shows as IOP because OP has no UR auth (UR LOC = last authorized level). This dumps each chart's level/UR/auth fields so I can read the <b>actual current level</b> and the <b>PHP authorization period</b> (for PHP length of stay).</p></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-gold btn-sm sans" onclick="inspectOpFields(this)">Inspect Kipu fields</button><button class="btn btn-ghost btn-sm sans" onclick="probeUr(this)">Probe UR history</button><button class="btn btn-ghost btn-sm sans" onclick="probeAdt(this)">Probe admit history</button></div></div>
      <div id="opFieldInspect" class="hint">Tap “Inspect Kipu fields,” then send me what it shows — I’ll wire OP/IOP correctly and compute PHP→IOP length of stay from the authorization dates.</div>
      <div id="opUrProbe" class="hint" style="margin-top:6px"></div>
      <div id="opAdtProbe" class="hint" style="margin-top:6px"></div></div>`:''}
    <div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">👥 Group attendance today</h3><p class="sub sans" style="margin:0">Of the people enrolled at each level, the share who attended at least one group today — live from Kipu group sessions.</p></div>
      <div class="toolbar" style="gap:6px;margin:0"><label class="hint">Date <input type="date" id="op_grpdate" value="${esc(today())}" onchange="loadOutpatientGroups()"/></label>${d.isAdmin?'<button class="btn btn-ghost btn-sm sans" onclick="probeGroups(this)">Probe Kipu</button>':''}</div></div>
      <div id="opGroups"><div class="hint">Loading attendance…</div></div>
      <div id="opGroupProbe"></div></div>
    <div class="card" style="border-left:4px solid var(--gold)"><div class="cmd-hero-row"><div><h3 style="margin:0">🎯 PHP completion</h3><p class="sub sans" style="margin:0">Of everyone admitted in the window, who discharged <b>without ever reaching IOP</b> — they didn’t complete PHP. Split into “right away” (≤3 days, usually a referral-out) and “left during PHP.”</p></div>
      <div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin:0"><label class="hint">From <input type="date" id="op_php_since" value="${esc(today().slice(0,8)+'01')}" onchange="loadOutpatientPhp()"/></label><label class="hint">To <input type="date" id="op_php_end" value="${esc(today())}" onchange="loadOutpatientPhp()"/></label></div></div>
      <div id="opPhp"><div class="hint">Reading program histories from Kipu…</div></div></div>
    <div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">📊 Movement &amp; length of stay</h3><p class="sub sans" style="margin:0">Adjust the window — admits, discharges, PHP→IOP moves, and LOS per level.</p></div>
      <div class="toolbar" style="gap:6px;margin:0"><div class="itabs" id="opPresets"><button class="itab" onclick="opPreset(7)">7d</button><button class="itab" onclick="opPreset(30)">30d</button><button class="itab" onclick="opPreset(90)">90d</button></div></div></div>
      <div class="toolbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><label class="hint">From <input type="date" id="op_since" value="${esc(OP_PERIOD.since)}" onchange="opPeriodChange()"/></label><label class="hint">To <input type="date" id="op_end" value="${esc(OP_PERIOD.end)}" onchange="opPeriodChange()"/></label></div>
      <div id="opAnalytics"><div class="hint">Loading…</div></div></div>
    ${roster.length?group('PHP')+group('IOP')+(other.length?`<div class="card"><h3 style="margin-top:0">Other / unclassified <span class="hint" style="font-weight:400">· ${other.length}</span></h3><table class="tbl"><tr><th>Client</th><th>Payer</th><th>Level (raw)</th><th>Admit</th></tr>${other.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td class="hint">${esc(x.payer||'—')}</td><td class="hint">${esc(x.level||'(blank)')}</td><td>${esc(x.admit||'—')}</td></tr>`).join('')}</table></div>`:''):'<div class="card"><div class="hint">No outpatient census yet — tap “Refresh from Kipu” to pull from '+esc(d.location||'your outpatient location')+'.</div></div>'}
    ${d.isAdmin?opSettingsHtml(d):''}`;
  loadOutpatientAnalytics();
  loadOutpatientGroups();
  loadOutpatientPhp();
}
async function loadOutpatientPhp(){
  const host=$('opPhp'); if(!host) return;
  const since=($('op_php_since')||{}).value||today().slice(0,8)+'01';
  const end=($('op_php_end')||{}).value||today();
  host.innerHTML='<div class="hint">Reading program histories from Kipu…</div>';
  let a; try{ a=await api('/outpatient/php-outcomes?since='+encodeURIComponent(since)+'&end='+encodeURIComponent(end)); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  if(a.error){ host.innerHTML='<div class="hint">'+esc(a.error)+'</div>'; return; }
  const box=(n,l,col)=>`<div class="ret-card"><div class="n"${col?' style="color:'+col+'"':''}>${n}</div><div class="l">${l}</div></div>`;
  const lst=(a.list||[]);
  const detail=lst.length?`<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">See the ${lst.length} who didn’t complete PHP — by name</summary>
    <table class="tbl" style="margin-top:4px"><tr><th>Client</th><th>Payer</th><th>Admit</th><th>Discharged</th><th>Days in PHP</th><th></th></tr>${lst.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td class="hint">${esc(x.payer||'—')}</td><td class="hint">${esc(x.admit||'—')}</td><td>${esc(x.discharged||'—')}</td><td><strong>${x.los!=null?x.los+'d':'—'}</strong></td><td class="hint">${x.bucket==='right away'?'<span style="color:var(--danger)">right away</span>':'left during PHP'}</td></tr>`).join('')}</table></details>`:'<div class="hint" style="margin-top:6px">🎉 Everyone admitted in this window either reached IOP or is still in PHP — no early PHP drop-offs.</div>';
  host.innerHTML=`<div class="ret-cards" style="margin-top:8px">
      ${box(a.didNotCompletePhp||0,'Didn’t complete PHP',a.didNotCompletePhp?'var(--danger)':'')}${box(a.rightAway||0,'…left right away (≤'+(a.rightAwayDays||3)+'d)')}${box(a.leftDuringPhp||0,'…left during PHP')}${box(a.reachedIop||0,'Reached IOP',a.reachedIop?'var(--good)':'')}</div>
    <div class="hint" style="margin-top:6px">${a.admitted||0} admitted in window · ${a.stillIn||0} still in PHP · completion rate (of those with an outcome): <strong>${a.completionRate!=null?a.completionRate+'%':'—'}</strong></div>
    ${detail}`;
}
async function loadOutpatientGroups(){
  const host=$('opGroups'); if(!host) return;
  const date=($('op_grpdate')||{}).value||today();
  host.innerHTML='<div class="hint">Loading attendance…</div>';
  let a; try{ a=await api('/outpatient/group-attendance?date='+encodeURIComponent(date)); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  if(a.error){ host.innerHTML='<div class="hint">'+esc(a.error)+'</div>'; return; }
  const by=a.byLevel||{};
  const card=(lv,label)=>{ const r=by[lv]||{}; if(!r.enrolled) return ''; const pct=r.pct; const col=pct==null?'':pct>=80?'var(--good)':pct>=50?'var(--gold)':'var(--danger)'; return `<div class="ret-card"><div class="n"${col?' style="color:'+col+'"':''}>${pct!=null?pct+'%':'—'}</div><div class="l">${label}<br><span class="hint">${r.attended}/${r.enrolled}</span></div></div>`; };
  const cards=card('PHP','PHP attended')+card('IOP','IOP attended')+card('OP','OP attended');
  host.innerHTML=`<div class="ret-cards" style="margin-top:8px">${cards||'<div class="hint">No one enrolled at PHP/IOP to measure.</div>'}</div>
    <div class="hint" style="margin-top:6px">${a.sessions||0} group session${a.sessions===1?'':'s'} on ${esc(a.date)}.${a.attendanceIsPresence?'':' <b>Note:</b> Kipu returned group enrollment but not a present/absent flag for this date, so this counts who was <i>scheduled</i> in a group, not confirmed present. '+(ME.role==='admin'?'Tap “Probe Kipu” to see the attendee fields so I can wire true present/absent.':'')}</div>`;
}
async function loadOutpatientAnalytics(){
  const host=$('opAnalytics'); if(!host) return;
  let a; try{ a=await api('/outpatient/analytics?since='+encodeURIComponent(OP_PERIOD.since)+'&end='+encodeURIComponent(OP_PERIOD.end)); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const arrow=(cur,prev)=>{ if(cur==null||prev==null) return ''; const d=+(cur-prev).toFixed(1); return d>0?` <span style="color:var(--danger)">▲${d}</span>`:d<0?` <span style="color:var(--good)">▼${-d}</span>`:' <span class="hint">→</span>'; };
  const l=a.los||{};
  const payerRows=(a.payers||[]).map(p=>`<tr><td><strong>${esc(p.payer)}</strong></td><td>${p.total}</td><td>${p.php}</td><td>${p.iop}</td><td>${p.avgPhpLos!=null?p.avgPhpLos+'d':'—'}</td><td>${p.avgIopLos!=null?p.avgIopLos+'d':'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="hint">No payer data yet.</td></tr>';
  const quick=(a.quick||[]);
  const al=(a.admitList||[]);
  const liveSrc=a.source==='kipu-admissions';
  const srcNote=liveSrc?'<span class="hint" style="color:var(--good)">✓ live from Kipu admissions (includes people already discharged)</span>':'<span class="hint" style="color:#a60">⚠ from census snapshots — Kipu admissions unreachable, fast in-and-out people may be missed</span>';
  const stillHere=(a.admitsStillHere!=null?a.admitsStillHere:al.filter(x=>x.active).length);
  const admitDetail=al.length?`<details style="margin:6px 0 4px"><summary class="hint" style="cursor:pointer"><strong>${stillHere} of ${al.length}</strong> admits in this window are still enrolled — tap for the by-name list</summary>
    <table class="tbl" style="margin-top:4px"><tr><th>Client</th><th>Admit</th><th>Status</th><th>Level</th></tr>${al.map(x=>`<tr><td><strong>${esc(x.name)}</strong>${x.sameDay?' <span class="hint" style="color:#a60">same-day</span>':''}</td><td>${esc(x.admit||'—')}</td><td>${x.active?'<span style="color:var(--good)">✓ still here</span>':'<span class="hint">discharged '+esc(x.discharged||'')+'</span>'}</td><td class="hint">${esc(x.level||'')}</td></tr>`).join('')}</table>
    <div class="hint" style="margin-top:4px">${liveSrc?'Pulled straight from Kipu’s admissions record for this window — including anyone admitted and discharged the same week. If a name you expected is missing, check the From/To dates match the exact week.':'Kipu admissions couldn’t be reached, so this is the census-snapshot count, which can miss fast in-and-out people. Try again in a moment.'}</div></details>`:'';
  const dl=(a.dischargeList||[]);
  const dischDetail=dl.length?`<details style="margin:2px 0 4px"><summary class="hint" style="cursor:pointer">See the ${dl.length} discharge${dl.length===1?'':'s'} in this window — by name, with length of stay</summary>
    <table class="tbl" style="margin-top:4px"><tr><th>Client</th><th>Admit</th><th>Discharged</th><th>Length of stay</th><th>Level</th></tr>${dl.map(x=>`<tr><td><strong>${esc(x.name)}</strong>${x.sameDay?' <span class="hint" style="color:#a60">same-day</span>':''}</td><td class="hint">${esc(x.admit||'—')}</td><td>${esc(x.discharged||'—')}</td><td>${x.los!=null?'<strong>'+x.los+'d</strong>':'—'}</td><td class="hint">${esc(x.level||'')}</td></tr>`).join('')}</table></details>`:'';
  host.innerHTML=`<div class="ret-cards" style="margin-top:8px">
      ${box(a.admits||0,'Admits in window')}${box(a.perWeek!=null?a.perWeek:'—','Admits / week')}${box(a.movedToIop||0,'Moved PHP→IOP')}${box(a.discharges||0,'Discharges')}</div>
    <div style="margin:4px 0 0">${srcNote}</div>
    ${admitDetail}${dischDetail}
    <div class="ret-cards" style="margin-top:6px">
      ${box((l.php!=null?l.php+'d':'—'),'Avg PHP length of stay'+'')}${box((l.iop!=null?l.iop+'d':'—'),'Avg IOP length of stay')}${box((l.curPhpDays!=null?l.curPhpDays+'d':'—'),'Avg days in PHP (current)')}${box((l.curIopDays!=null?l.curIopDays+'d':'—'),'Avg days in IOP (current)')}</div>
    <div class="hint" style="margin:4px 0 10px">PHP LOS${arrow(l.php,l.phpPrev)} · IOP LOS${arrow(l.iop,l.iopPrev)} <span style="margin-left:6px">vs the previous ${a.spanDays} days</span></div>
    <h3 style="font-size:14px;margin:10px 0 4px">By payer</h3>
    <table class="tbl"><tr><th>Payer</th><th>Total</th><th>PHP</th><th>IOP</th><th>Avg PHP LOS</th><th>Avg IOP LOS</th></tr>${payerRows}</table>
    <h3 style="font-size:14px;margin:14px 0 4px">⚡ Quick movers <span class="hint" style="font-weight:400">— PHP→IOP in ≤ ${a.quickThresh} days (short authorizations to look into)</span></h3>
    ${quick.length?`<table class="tbl"><tr><th>Client</th><th>Payer</th><th>Days in PHP</th><th>Admit</th><th>Moved to IOP</th></tr>${quick.map(q=>`<tr><td><strong>${esc(q.name)}</strong>${q.active?'':' <span class="hint">(disch.)</span>'}</td><td class="hint">${esc(q.payer||'—')}</td><td><strong style="color:var(--danger)">${q.phpDays}d</strong></td><td>${esc(q.admit||'—')}</td><td>${esc(q.iopStart||'—')}</td></tr>`).join('')}</table>`:'<div class="hint">None yet — quick movers appear here as people transition to IOP.</div>'}
    ${a.tracking?'':'<div class="pc-note" style="margin-top:10px;color:#a60">⏳ Tap “↻ Refresh from Kipu” to pull the census and each person’s program history — PHP→IOP length of stay is reconstructed from past step-downs, so it’s accurate retroactively, not just from today forward.</div>'}`;
}
async function inspectOpFields(btn){
  const el=$('opFieldInspect'); if(btn)btn.disabled=true; if(el)el.innerHTML='Reading a few charts from Kipu…';
  try{ const r=await api('/outpatient/field-inspect');
    if(r.error){ if(el)el.textContent=r.error; }
    else if(el) el.innerHTML=(r.sample||[]).map(s=>`<div style="margin:8px 0;border-top:1px solid var(--line);padding-top:6px"><strong>${esc(s.name)}</strong>${Object.keys(s.fields||{}).length?Object.entries(s.fields).map(([k,v])=>`<div class="hint" style="font-family:monospace;font-size:11px">${esc(k)} = ${esc(v)}</div>`).join(''):'<div class="hint">no level/auth fields found</div>'}</div>`).join('')+'<div class="hint" style="margin-top:6px">Send me these — I’ll pick the real current-level field and the PHP auth dates.</div>';
  }catch(e){ if(el)el.textContent=e.message; }
  if(btn)btn.disabled=false;
}
async function probeAdt(btn){
  const el=$('opAdtProbe'); if(btn)btn.disabled=true; if(el)el.innerHTML='Probing Kipu for an admissions-by-date endpoint (incl. discharged)…';
  try{ const r=await api('/outpatient/adt-probe?days=30');
    if(r.error){ if(el)el.textContent=r.error; if(btn)btn.disabled=false; return; }
    const w=r.window||{};
    const rows=(r.probes||[]).map(p=>`<tr><td class="hint" style="font-family:monospace;font-size:11px">${esc(p.path)}</td><td>${p.ok?('<span style="color:var(--good)">✓ '+p.count+' rows</span>'):('<span class="hint">'+esc(p.error||'—')+'</span>')}</td><td>${p.ok?p.withDischarge:''}</td><td>${p.ok?('<strong>'+p.admitsInWindow+'</strong>'):''}</td><td class="hint" style="font-size:10px">${esc((p.sampleKeys||[]).join(', '))}</td></tr>`).join('');
    if(el)el.innerHTML=`<div class="hint">Window: ${esc(w.start||'')} → ${esc(w.end||'')} (${w.days}d). “Has discharge” &gt; 0 means the endpoint returns discharged people too — that’s the one we want.</div><table class="tbl"><tr><th>Endpoint</th><th>Rows</th><th>Has discharge</th><th>Admits in window</th><th>Fields</th></tr>${rows}</table><div class="hint" style="margin-top:6px">Send me the table — I’ll switch admit/discharge counts to whichever endpoint returns discharged patients, so fast in-and-out people stop getting missed.</div>`;
  }catch(e){ if(el)el.textContent=e.message; }
  if(btn)btn.disabled=false;
}
async function probeUr(btn){
  const el=$('opUrProbe'); if(btn)btn.disabled=true; if(el)el.innerHTML='Probing Kipu UR / authorization endpoints…';
  try{ const r=await api('/outpatient/ur-probe');
    if(r.error){ if(el)el.textContent=r.error; if(btn)btn.disabled=false; return; }
    const rows=(r.probes||[]).map(p=>{ const f=p.fields&&Object.keys(p.fields).length?Object.entries(p.fields).slice(0,12).map(([k,v])=>esc(k)+'='+esc(v)).join(' · '):''; return `<tr><td class="hint" style="font-family:monospace;font-size:11px">${esc(p.path)}</td><td>${p.ok?('<span style="color:var(--good)">✓ '+(p.count!=null?p.count+' rows':'ok')+'</span>'):('<span class="hint">'+esc(p.error||'—')+'</span>')}</td><td class="hint" style="font-size:11px">${f}</td></tr>`; }).join('');
    if(el)el.innerHTML=`<div class="hint">Probed against <strong>${esc(r.sampleName||r.sampleCasefile||'')}</strong>:</div><table class="tbl"><tr><th>Endpoint</th><th>Result</th><th>Level / date fields found</th></tr>${rows}</table><div class="hint" style="margin-top:6px">Send me which row has authorization periods (a level + start/end date) and I’ll reconstruct past PHP→IOP step-downs from it.</div>`;
  }catch(e){ if(el)el.textContent=e.message; }
  if(btn)btn.disabled=false;
}
async function probeGroups(btn){
  const el=$('opGroupProbe'); if(btn)btn.disabled=true; if(el)el.innerHTML='Probing Kipu…';
  try{ const r=await api('/outpatient/group-probe');
    let attSample=''; try{ const g=await api('/outpatient/group-attendance?date='+encodeURIComponent(today())); if(g&&g.sample){ attSample='<div style="margin-top:8px"><div class="hint">Attendee fields on a group session (for present/absent):</div><div class="hint" style="font-family:monospace;font-size:11px">'+esc((g.sample.patientKeys||[]).join(', '))+'</div></div>'; } }catch(_e){}
    if(el)el.innerHTML='<table class="tbl"><tr><th>Endpoint</th><th>Result</th><th>Sample fields</th></tr>'+(r.probes||[]).map(p=>`<tr><td class="hint" style="font-family:monospace;font-size:12px">${esc(p.path)}</td><td>${p.ok?('<span style="color:var(--good)">✓ '+(p.count!=null?p.count+' rows':'ok')+'</span>'):('<span class="hint">'+esc(p.error||'—')+'</span>')}</td><td class="hint" style="font-size:11px">${esc((p.sampleKeys||[]).join(', '))}</td></tr>`).join('')+'</table>'+attSample;
  }catch(e){ if(el)el.textContent=e.message; }
  if(btn)btn.disabled=false;
}
function opPreset(days){ const e=today(); const d=new Date(e+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-(days-1)); OP_PERIOD={since:d.toISOString().slice(0,10),end:e}; if($('op_since'))$('op_since').value=OP_PERIOD.since; if($('op_end'))$('op_end').value=OP_PERIOD.end; loadOutpatientAnalytics(); }
function opPeriodChange(){ OP_PERIOD={since:($('op_since')||{}).value||OP_PERIOD.since, end:($('op_end')||{}).value||OP_PERIOD.end}; loadOutpatientAnalytics(); }
function opSettingsHtml(d){
  const acc=(d.access||[]);
  const staff=(d.staff||[]);
  return `<div class="card" style="background:#faf6ee;border-left:4px solid var(--gold)"><h3 style="margin-top:0">⚙️ Outpatient settings <span class="hint" style="font-weight:400">— owner only</span></h3>
    <label>Kipu location name</label><input id="op_loc" value="${esc(d.location||'')}" placeholder="Akron House Recovery"/>
    <label style="margin-top:8px">Who else can see this (besides you)</label>
    <div id="op_access" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0">${staff.map(s=>{ const on=acc.find(a=>a.id===s.id); return `<button type="button" class="btn btn-sm sans ${on?'btn-gold':'btn-ghost'}" data-uid="${s.id}" onclick="this.classList.toggle('btn-gold');this.classList.toggle('btn-ghost')">${esc(s.name)}</button>`; }).join('')||'<span class="hint">No other staff yet.</span>'}</div>
    <div class="toolbar" style="justify-content:flex-start;margin-top:6px"><button class="btn btn-gold btn-sm sans" onclick="saveOutpatientSettings()">Save</button><span id="opSetMsg" class="hint" style="align-self:center"></span></div>
    <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><div class="cmd-hero-row"><div><strong>All Kipu locations</strong><p class="sub sans" style="margin:0">Every facility reachable with the current Kipu login — the basis for the consolidated ownership view across all 6 locations.</p></div><button class="btn btn-ghost btn-sm sans" onclick="listKipuLocations(this)">List locations</button></div>
    <div id="opKipuLocs" class="hint"></div></div></div>`;
}
async function listKipuLocations(btn){
  const el=$('opKipuLocs'); if(btn)btn.disabled=true; if(el)el.textContent='Reading locations from Kipu…';
  try{ const r=await api('/kipu/locations');
    if(r.error){ if(el)el.textContent=r.error; }
    else if(el) el.innerHTML=`<div style="margin-top:4px">${(r.locations||[]).map(l=>`<div class="pc-note" style="font-family:monospace;font-size:12px">id ${esc(String(l.id))} · <strong>${esc(l.name)}</strong>${l.enabled?'':' <span style="color:#a60">(disabled)</span>'}</div>`).join('')}</div><div class="hint" style="margin-top:4px">${r.count} location${r.count===1?'':'s'} in this Kipu account. Send me this list and I’ll wire the consolidated ownership view.</div>`;
  }catch(e){ if(el)el.textContent=e.message; }
  if(btn)btn.disabled=false;
}
async function refreshOutpatient(btn){
  const m=$('opMsg'); if(btn)btn.disabled=true; if(m)m.textContent='Pulling from Kipu…';
  try{ const r=await api('/outpatient/refresh',{method:'POST'}); if(m)m.textContent=`✓ ${r.counts.total} enrolled at ${r.location} — PHP ${r.counts.PHP}, IOP ${r.counts.IOP}.`; loadOutpatient(); }
  catch(e){ if(m)m.textContent=e.message; if(btn)btn.disabled=false; }
}
async function saveOutpatientSettings(){
  const loc=($('op_loc')||{}).value||'';
  const access=[...document.querySelectorAll('#op_access button.btn-gold')].map(b=>+b.dataset.uid);
  const m=$('opSetMsg');
  try{ await api('/outpatient/settings',{method:'POST',body:JSON.stringify({location:loc,access})}); if(m)m.textContent='✓ Saved'; loadOutpatient(); }
  catch(e){ if(m)m.textContent=e.message; }
}
/* ───────── MERGE DUPLICATES (admin) — review-then-confirm, reversible ───────── */
let DUPES=[];
async function loadDupes(){
  const host=$('dupes'); if(!host) return;
  host.innerHTML='<div class="hint">Scanning for duplicate patient records…</div>';
  let d; try{ d=await api('/diag/duplicates'); }catch(e){ host.innerHTML='<div class="card"><div class="hint">'+esc(e.message)+'</div></div>'; return; }
  DUPES=d.groups||[];
  const intro=`<div class="card"><h3>Merge Duplicates</h3><p class="sub sans">Suspected duplicate patient records — the same person showing up as more than one record. Pick the record to <strong>keep</strong> (the most complete one is pre-selected ✓), check the ones to merge into it, then Merge. Nothing is deleted: merged records are retired and kept for reversibility, and any linked notes, tasks &amp; history move to the record you keep. Uncheck any row that's actually a different person.</p>
    <div class="toolbar" style="justify-content:flex-start;gap:8px;margin-top:6px"><button class="btn btn-gold btn-sm sans" onclick="runCleanup(this)">🧹 Clean up phantom records now</button><span id="cleanupMsg" class="hint" style="align-self:center"></span></div>
    <p class="hint" style="margin-top:4px">Auto-retires the census-churn phantoms (same person by Kipu ID, with no real activity) in one pass. Safe &amp; reversible.</p></div>`;
  if(!DUPES.length){ host.innerHTML=intro.replace('Suspected duplicate patient records','✓ No duplicate patient records found. Each person appears once. The check below'); return; }
  host.innerHTML=intro + DUPES.map((g,gi)=>{
    const rows=g.rows.map(r=>`<tr>
      <td style="text-align:center"><input type="radio" name="keep_${gi}" value="${r.id}" ${r.id===g.suggestKeep?'checked':''} onchange="dupeKeepChanged(${gi})"/></td>
      <td style="text-align:center"><input type="checkbox" class="dupe_chk_${gi}" data-id="${r.id}" ${r.id===g.suggestKeep?'disabled':'checked'}/></td>
      <td><strong>${esc(r.name)}</strong>${r.room?' · '+esc(r.room):''}${r.id===g.suggestKeep?' <span class="hint">(suggested keep)</span>':''}</td>
      <td>${esc(r.admit||'—')}</td><td>${esc(r.discharge_date||'—')}${r.discharge_status?' <span class="hint">'+esc(r.discharge_status)+'</span>':''}</td>
      <td class="hint">${esc(r.source)}</td><td>${r.active?'here':'<span class="hint">disch.</span>'}</td><td>${r.children} linked</td></tr>`).join('');
    return `<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">${esc(g.name)} <span class="hint" style="font-weight:400">· ${g.rows.length} records</span></h3></div><button class="btn btn-gold btn-sm sans" onclick="mergeDupes(${gi})">Merge selected →</button></div>
      <table class="tbl"><tr><th>Keep</th><th>Merge</th><th>Patient</th><th>Admit</th><th>Discharge</th><th>Source</th><th>Status</th><th>Records</th></tr>${rows}</table></div>`;
  }).join('');
}
function dupeKeepChanged(gi){
  const keep=document.querySelector(`input[name="keep_${gi}"]:checked`); const keepId=keep?keep.value:null;
  document.querySelectorAll('.dupe_chk_'+gi).forEach(chk=>{ if(chk.dataset.id===keepId){ chk.checked=false; chk.disabled=true; } else { chk.disabled=false; } });
}
async function runCleanup(btn){
  const m=$('cleanupMsg'); if(btn) btn.disabled=true; if(m) m.textContent='Cleaning…';
  try{ const r=await api('/diag/cleanup',{method:'POST'}); if(m) m.textContent=`✓ Retired ${r.merged} phantom/duplicate record${r.merged===1?'':'s'}.`; loadDupes(); }
  catch(e){ if(m) m.textContent=e.message; if(btn) btn.disabled=false; }
}
async function mergeDupes(gi){
  const keep=document.querySelector(`input[name="keep_${gi}"]:checked`); if(!keep){ alert('Pick a record to keep.'); return; }
  const keepId=+keep.value;
  const dupes=[...document.querySelectorAll('.dupe_chk_'+gi)].filter(c=>c.checked&&+c.dataset.id!==keepId).map(c=>+c.dataset.id);
  if(!dupes.length){ alert('Check at least one record to merge into the kept one.'); return; }
  const g=DUPES[gi];
  if(!confirm(`Merge ${dupes.length} record(s) into "${g.name}"?\n\nLinked notes, tasks & history move to the kept record. The others are retired (recoverable, not deleted).`)) return;
  try{ const r=await api('/diag/merge',{method:'POST',body:JSON.stringify({keep:keepId,dupes})}); loadDupes(); }catch(e){ alert(e.message); }
}
/* ───────── MY GROWTH — every employee's own goals + monthly check-in ───────── */
async function loadMyGrowth(){
  const host=$('mygrowth'); if(!host) return;
  host.innerHTML='<div class="hint">Loading…</div>';
  let d; try{ d=await api('/growth/me'); }catch(e){ host.innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  const p=d.plan||{};
  const ta=(fid,lbl,val,ph)=>`<label style="font-weight:600">${lbl}</label><textarea id="${fid}" rows="2" placeholder="${esc(ph)}">${esc(val||'')}</textarea>`;
  const dueBanner=d.due?`<div class="card" style="background:#fbf7f0;border-left:4px solid var(--gold);margin:0 0 10px"><b>🗓 Time for your monthly check-in.</b> <span class="sans">Take two minutes below — how are you tracking, and what would help?</span></div>`:'';
  const checks=(d.checkins||[]).map(c=>`<div class="pc-note" style="margin:6px 0"><div class="hint" style="margin-bottom:2px">${c.self?'🙋 You':'👤 '+esc(c.by_name||'Leadership')} · ${esc(c.at)}</div>${c.progress?`<div><b>Progress:</b> ${esc(c.progress)}</div>`:''}${c.support?`<div><b>Support that would help:</b> ${esc(c.support)}</div>`:''}</div>`).join('')||'<div class="hint">No check-ins yet — your first one is below.</div>';
  host.innerHTML=`<div class="card"><h3>🌱 My Growth</h3><p class="sub sans">This is yours. Where do you want to be — and every month, how are we helping you get there? Dream big; we're in your corner.</p></div>
    ${dueBanner}
    <div class="card"><h3 style="margin-top:0">My goals</h3>
      ${ta('g_6m','📍 6-month goal',p.goal_6m,'e.g. get fully confident running intake on my own')}
      ${ta('g_1y','🎯 1-year professional goal',p.goal_1y,'e.g. become a lead BHT / start my CDCA')}
      ${ta('g_5y','🚀 5-year goal',p.goal_5y,'e.g. be a licensed counselor here')}
      ${ta('g_10y','🌟 10-year goal',p.goal_10y,'e.g. run my own program / lead a team')}
      ${ta('g_why','💛 Why it matters to me',p.why,'what this means for you and the people you love')}
      <div class="toolbar" style="justify-content:flex-start;margin-top:6px"><button class="btn btn-gold sans" onclick="saveMyGrowth()">Save my goals</button><span id="g_msg" class="hint" style="align-self:center"></span></div>
      ${p.updated?`<div class="hint" style="margin-top:4px">Last updated ${esc(p.updated.slice(0,10))}</div>`:''}</div>
    <div class="card"><h3 style="margin-top:0">Monthly check-in</h3><p class="sub sans">A quick, honest pulse — for you and the people supporting you.</p>
      ${ta('g_prog','How am I tracking toward my goals?','','what\'s going well, what\'s been hard')}
      ${ta('g_sup','What support would help me get closer?','','training, a mentor, a shift change, a stretch project…')}
      <div class="toolbar" style="justify-content:flex-start;margin-top:6px"><button class="btn btn-gold sans" onclick="addMyCheckin()">Add check-in</button></div></div>
    <div class="card"><h3 style="margin-top:0">My check-in history</h3>${checks}</div>`;
}
async function saveMyGrowth(){
  try{ await api('/growth/me',{method:'POST',body:JSON.stringify({goal_6m:$('g_6m').value,goal_1y:$('g_1y').value,goal_5y:$('g_5y').value,goal_10y:$('g_10y').value,why:$('g_why').value})}); if($('g_msg'))$('g_msg').textContent='✓ Saved'; }catch(e){ alert(e.message); }
}
async function addMyCheckin(){
  const progress=($('g_prog')||{}).value||'', support=($('g_sup')||{}).value||'';
  if(!progress.trim()&&!support.trim()){ alert('Add your progress or what would help.'); return; }
  try{ await api('/growth/me/checkin',{method:'POST',body:JSON.stringify({progress,support})}); loadMyGrowth(); }catch(e){ alert(e.message); }
}
async function loadTeamStats(){
  const host=$('teamStats'); if(!host) return;
  let d; try{ d=await api('/team-stats'); }catch(e){ host.innerHTML=''; return; }
  if(!d.team.length){ host.innerHTML=''; return; }
  const medal=i=>['🥇','🥈','🥉'][i]||'';
  const arrow=t=> t==null?'':t>0?`<span style="color:var(--good)">▲${t}</span>`:t<0?`<span style="color:var(--danger)">▼${-t}</span>`:'<span class="hint">–</span>';
  host.innerHTML=`<div class="card"><h3>Team — how everyone's doing (7 days)</h3><p class="sub sans">Overall % across required duties, best to worst. Tap a person to coach with specifics — this is for developing people, not punishing them.</p>
    <table class="tbl"><tr><th>Staff</th><th>Role</th><th>Overall</th><th>Trend</th><th>Shifts</th></tr>
    ${d.team.map((t,i)=>`<tr style="cursor:pointer" onclick="openUserStats(${t.id}, ${JSON.stringify(t.name).replace(/"/g,'&quot;')})"><td>${medal(i)} <strong>${esc(t.name)}</strong></td><td class="hint">${esc(t.role||'')}</td><td><strong style="color:${statCol(t.overall)}">${t.overall==null?'—':t.overall+'%'}</strong>${t.flagged7?' <span class="hint" title="rounds flagged">⚠'+t.flagged7+'</span>':''}</td><td>${arrow(t.trend)}</td><td>${t.shifts7} ›</td></tr>`).join('')}</table></div>`;
}
async function openUserStats(id, name){
  let d; try{ d=await api('/user-stats/'+id); }catch(e){ alert(e.message); return; }
  const bar=r=>`<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:14px"><span>${r.care?'💛 ':''}${esc(r.label)}</span><strong style="color:${statCol(r.pct)}">${r.pct==null?'—':r.pct+'%'} <span class="hint" style="font-weight:400">${r.done}/${r.target}</span></strong></div><div class="res-track" style="height:8px;margin-top:4px"><div class="res-fill" style="width:${r.pct||0}%;background:${statCol(r.pct)}"></div></div></div>`;
  const extras=(d.extras||[]).map(x=>`<span class="chip" style="margin:2px">${x.care?'💛 ':''}${esc(x.label)}: <strong>${x.value}</strong></span>`).join('');
  hmodalPlain(`<h3>${esc(name)} <span class="hint" style="font-weight:400">· ${esc(d.role||'')}</span></h3>
    <div style="text-align:center;margin:6px 0 10px"><div style="font-size:36px;font-weight:700;color:${statCol(d.overall)}">${d.overall==null?'—':d.overall+'%'}</div><div class="hint">${d.shifts7} shift${d.shifts7===1?'':'s'}${d.hours?' · '+d.hours+' hrs':''} this week${d.flagged7?' · ⚠ '+d.flagged7+' rounds flagged':''}${trendStr(d.trend)}</div></div>
    ${(d.required||[]).length?(d.required||[]).map(bar).join(''):'<div class="hint">No required duties tracked this week.</div>'}
    <div style="margin-top:10px">${extras}</div>
    <div class="toolbar" style="margin-top:14px"><button class="btn btn-ghost sans" onclick="closeHModal()">Close</button></div>`);
}
// My Role, folded into the bottom of My Shift (no separate tab) — collapsible so the
// live shift stays on top: what I do, not my lane, how my shift flows, what great is.
async function renderDashRole(){
  const host=$('dashRole'); if(!host) return;
  let p; try{ p=await api('/my-role'); }catch(e){ host.innerHTML=''; return; }
  const role=p.role||(ME&&ME.job_role)||'';
  if(!role){ host.innerHTML=''; return; }
  const resp=(p.responsibilities||[]).map(r=>`<li>${esc(r)}</li>`).join('');
  const lim=(p.limitations||[]).map(r=>`<li>${esc(r)}</li>`).join('');
  const qual=(p.qualities||[]).map(q=>`<div class="kv"><span class="k" style="min-width:150px">${esc(q.name)}</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted);max-width:62%">${esc(q.desc||'')}</span></div>`).join('');
  const label=v=>{ const b=document.querySelector(`#nav button[data-view="${v}"]`); return b?(b.firstChild?b.firstChild.textContent.trim():b.textContent.trim()):v; };
  const flow=(SHIFT_FLOW[role]||[]).map((s,i)=>`<div class="flow-step"><div class="flow-num">${i+1}</div><div class="flow-body"><div class="flow-t">${esc(s.t)}</div><div class="flow-d">${esc(s.d)}</div>${s.v&&canSeeView(s.v)?`<button class="btn btn-ghost btn-sm sans" style="margin-top:6px" onclick="show('${s.v}')">Open ${esc(label(s.v))} ›</button>`:''}</div></div>`).join('');
  host.innerHTML=`<details class="card"><summary style="cursor:pointer;font-weight:700;color:var(--navy);font-size:15px">📋 My role — ${esc(role)} · what I do, not my lane &amp; how my shift flows</summary>
    <div style="margin-top:12px">
      ${p.purpose?`<p class="sub sans" style="margin:0 0 10px">${esc(p.purpose)}</p>`:''}
      ${flow?`<h3 style="font-size:13px;margin:6px 0 6px">How my shift flows</h3><div class="flow">${flow}</div>`:''}
      <div class="cmd-grid" style="margin-top:12px">
        <div><h3 style="font-size:13px;margin:0 0 4px">What I do</h3><ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6">${resp||'<li>—</li>'}</ul></div>
        ${lim?`<div><h3 style="font-size:13px;margin:0 0 4px;color:#b3382f">Not my lane</h3><ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6">${lim}</ul></div>`:''}
      </div>
      ${qual?`<h3 style="font-size:13px;margin:14px 0 6px">What great looks like</h3>${qual}`:''}
    </div></details>`;
}
/* ---- Client Voice — all kiosk feedback in one place ---- */
let CV_RANGE='7';
function cvSetRange(r){ CV_RANGE=r; document.querySelectorAll('#cvRange .itab').forEach(b=>b.classList.toggle('active', b.dataset.r===r)); loadClientVoice(); }
async function loadClientVoice(){
  let d; try{ d=await api('/client-voice?range='+CV_RANGE); }catch(e){ if($('cvBody'))$('cvBody').innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  updateCvBadge(0);   // opening it clears the "new" badge
  const k=d.kpi||{};
  if($('cvKpis')) $('cvKpis').innerHTML=`<div class="ret-card ${k.openReach?'rc-warn':''}"><div class="n">${k.openReach}</div><div class="l">Open reach-outs</div></div>
    <div class="ret-card"><div class="n">${k.expScore!=null?k.expScore+'/10':'—'}</div><div class="l">Experience (30d)</div></div>
    <div class="ret-card"><div class="n">${k.mealLiked!=null?k.mealLiked+'%':'—'}</div><div class="l">Liked meals (14d)</div></div>`;
  const reach=(d.reachouts||[]).map(r=>`<div class="todo ${r.status==='Done'?'done':''}"><div class="txt">${r.priority==='Urgent'?'🔴 ':'🗣 '}<strong>${esc(r.pref||r.name||'A client')}</strong> — ${esc(r.text)}<div class="hint">${esc(r.at)} · ${esc(r.status)}</div></div>${r.status!=='Done'?`<button class="btn btn-ghost btn-sm sans" onclick="show('concierge')">Open</button>`:''}</div>`).join('')||'<div class="hint">No kiosk reach-outs.</div>';
  const sugg=(d.suggestions||[]).map(s=>`<div class="pc-note">💡 ${esc(s.text)} <span class="hint">— ${esc(s.pref||'anonymous')}, ${esc(s.at)}</span></div>`).join('')||'<div class="hint">No suggestions yet.</div>';
  const surv=(d.surveys||[]).map(s=>`<div class="pc-note">${s.score!=null?'⭐ <strong>'+s.score+'/10</strong> ':''}${s.comments?'“'+esc(s.comments)+'”':'<span class="hint">(no comment)</span>'} <span class="hint">— ${esc(s.pref||s.name||'a client')}, ${esc(s.at)}</span></div>`).join('')||'<div class="hint">No survey responses in 30 days.</div>';
  const meals=(d.meals||[]).map(m=>`<div class="pc-note">🍽 “${esc(m.comment)}” <span class="hint">— ${esc(m.pref||'a resident')} · ${esc(m.meal)} ${esc(m.meal_date)}${m.dish?' ('+esc(m.dish)+')':''}</span></div>`).join('')||'<div class="hint">No meal comments in 14 days.</div>';
  if($('cvBody')) $('cvBody').innerHTML=`<div class="card"><h3>🗣 Reach-outs &amp; requests</h3>${reach}</div>
    <div class="card"><h3>💡 Suggestions</h3>${sugg}</div>
    <div class="card"><h3>⭐ Experience surveys (30d)</h3>${surv}</div>
    <div class="card"><h3>🍽 Meal feedback (14d)</h3>${meals}</div>`;
}
/* ---- Laundry board ---- */
async function loadLaundry(){
  let d; try{ d=await api('/laundry'); }catch(e){ if($('laundryActive'))$('laundryActive').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const c=k=>d.active.filter(x=>x.status===k).length;
  if($('laundryKpis')) $('laundryKpis').innerHTML = `<div class="ret-card ${c('Washing')?'rc-warn':''}"><div class="n">${c('Washing')}</div><div class="l">Washing</div></div>
    <div class="ret-card ${c('Drying')?'rc-warn':''}"><div class="n">${c('Drying')}</div><div class="l">Drying</div></div>
    <div class="ret-card ${c('Folding')?'rc-high':''}"><div class="n">${c('Folding')}</div><div class="l">To fold</div></div>
    <div class="ret-card"><div class="n">${d.active.length}</div><div class="l">Open loads</div></div>`;
  if($('ln_client')) fillClientSelect($('ln_client'),'No client');
  const next={Washing:'Drying',Drying:'Folding',Folding:'Done'};
  const pill=s=>`<span class="risk ${s==='Folding'?'risk-high':'risk-elev'}">${esc(s)}</span>`;
  if($('laundryActive')) $('laundryActive').innerHTML = d.active.length? d.active.map(l=>`<div class="todo"><div class="txt">${pill(l.status)} <strong>${esc(l.label)}</strong>${l.kind?' <span class="hint">· '+esc(l.kind)+'</span>':''}<div class="hint">${esc(l.started_by_name||'')}${l.created_at?' · '+esc(l.created_at):''}</div></div>
      ${next[l.status]?`<button class="btn btn-gold btn-sm sans" onclick="advLaundry(${l.id},'${next[l.status]}')">→ ${next[l.status]}</button>`:''}
      <button class="btn btn-ghost btn-sm sans" onclick="advLaundry(${l.id},'Done')">✓ Done</button>
      <button class="btn btn-ghost btn-sm sans" onclick="delLaundry(${l.id})" title="Remove">✕</button></div>`).join('') : '<div class="pc-note">No loads in progress.</div>';
  if($('laundryDone')) $('laundryDone').innerHTML = d.done.length? d.done.map(l=>`<div class="pc-note">✅ ${esc(l.label)} <span class="hint">· ${esc(l.started_by_name||'')}${l.updated_at?' · '+esc(l.updated_at):''}</span></div>`).join('') : '<div class="hint">Nothing finished in the last 24 hours.</div>';
}
async function addLaundry(){ const label=($('ln_label').value.trim())||$('ln_kind').value; try{ await api('/laundry',{method:'POST',body:JSON.stringify({kind:$('ln_kind').value,label,client_id:$('ln_client').value||null})}); $('ln_label').value=''; if($('ln_msg'))$('ln_msg').textContent='✓ Started'; loadLaundry(); }catch(e){ if($('ln_msg'))$('ln_msg').textContent=e.message; } }
async function advLaundry(id,status){ try{ await api('/laundry/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadLaundry(); }catch(e){ alert(e.message); } }
async function delLaundry(id){ if(!confirm('Remove this load?'))return; try{ await api('/laundry/'+id,{method:'DELETE'}); loadLaundry(); }catch(e){ alert(e.message); } }
// Simple per-shift walk-around checklist — tap to confirm, resets each shift.
async function renderShiftChecklist(){
  const host=$('dashChecklist'); if(!host) return;
  let d; try{ d=await api('/shift-checklist'); }catch(e){ host.innerHTML=''; return; }
  const rows=(d.items||[]).map(i=>`<label style="display:flex;gap:11px;align-items:center;padding:11px 12px;border:1px solid var(--line);border-radius:11px;margin:7px 0;cursor:pointer;background:${i.done?'#f3f8f4':'#fff'}">
      <input type="checkbox" ${i.done?'checked':''} onchange="toggleShiftTask(${i.id},this.checked)" style="width:21px;height:21px;flex:none;accent-color:var(--gold)"/>
      <span style="font-size:15px;${i.done?'color:#2d7a4f':''}">${esc(i.label)}${i.done&&i.by?` <span class="hint">✓ ${esc(i.by)}</span>`:''}</span>
      ${d.canEdit?`<button class="btn btn-ghost btn-sm sans no-print" style="margin-left:auto" onclick="event.preventDefault();delShiftTask(${i.id})" title="Remove">✕</button>`:''}</label>`).join('');
  host.innerHTML=`<div class="card">
    <div class="cmd-hero-row"><div><h3 style="margin:0">✅ Shift checklist <span class="hint" style="font-weight:400">— ${d.done}/${d.total} done this ${esc((d.shift||'').toLowerCase())} shift</span></h3></div>
      ${d.canEdit?`<button class="btn btn-ghost btn-sm sans" onclick="addShiftTask()">+ Add</button>`:''}</div>
    <div class="res-track" style="height:6px;margin:8px 0 4px"><div class="res-fill" style="width:${d.pct}%"></div></div>
    ${rows||'<div class="pc-note">No checklist items.</div>'}</div>`;
}
async function toggleShiftTask(id,done){ try{ await api('/shift-checklist/'+id,{method:'POST',body:JSON.stringify({done})}); renderShiftChecklist(); }catch(e){ alert(e.message); renderShiftChecklist(); } }
async function addShiftTask(){ const label=prompt('Add a shift-checklist item:'); if(!label||!label.trim())return; try{ await api('/shift-checklist/template/edit',{method:'POST',body:JSON.stringify({add:label.trim()})}); renderShiftChecklist(); }catch(e){ alert(e.message); } }
async function delShiftTask(id){ if(!confirm('Remove this checklist item?'))return; try{ await api('/shift-checklist/template/edit',{method:'POST',body:JSON.stringify({remove:id})}); renderShiftChecklist(); }catch(e){ alert(e.message); } }
// Behavioral contracts — a prominent flag on My Shift + a per-shift check-in so we
// actually track whether they're turning it around.
async function renderBContracts(){
  const host=$('dashBContracts'); if(!host) return;
  let d; try{ d=await api('/behavior-contracts/active'); }catch(e){ host.innerHTML=''; return; }
  const cs=d.contracts||[];
  if(!cs.length){ host.innerHTML=''; return; }
  const rows=cs.map(c=>`<div class="todo" style="align-items:center;flex-wrap:wrap">
      <div class="txt"><strong>${esc(c.name)}</strong>${c.room?' <span class="hint">· '+esc(c.room)+'</span>':''} — behavioral contract${c.reason?`<div class="hint">${esc(c.reason)}</div>`:''}
        ${c.checked?`<div class="hint" style="color:var(--good)">✓ checked this shift — ${esc(c.rating||'')}</div>`:'<div class="hint" style="color:var(--danger)">Check-in needed this shift</div>'}</div>
      ${c.checked?'':`<div style="display:flex;gap:5px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm sans" onclick="bCheckin(${c.id},'Better')">😊 Better</button>
        <button class="btn btn-ghost btn-sm sans" onclick="bCheckin(${c.id},'Holding')">😐 Holding</button>
        <button class="btn btn-ghost btn-sm sans" onclick="bCheckin(${c.id},'Worse')">⚠️ Worse</button></div>`}
      <button class="btn btn-ghost btn-sm sans" onclick="openBContract(${c.id})">Notes</button></div>`).join('');
  host.innerHTML=`<div class="card" style="border-left:4px solid var(--danger);background:#fff8f7">
    <h3 style="margin:0 0 4px;color:#b3382f">⚠️ On a behavioral contract <span class="badge">${cs.length}</span></h3>
    <p class="sub sans" style="margin:0 0 8px">Active contract — check in <b>every shift</b> and log how they're doing. Worse alerts the lead.</p>${rows}</div>`;
}
async function bCheckin(id,rating){ let note=''; if(rating==='Worse') note=prompt('What happened? (optional — this alerts the lead)')||''; try{ await api('/behavior-contracts/'+id+'/checkin',{method:'POST',body:JSON.stringify({rating,note})}); renderBContracts(); }catch(e){ alert(e.message); } }
// Clock in/out — front and center on My Shift. Clocking in puts you on shift.
let CLOCK_GEO=false;
async function renderClock(){
  const host=$('dashClock'); if(!host) return;
  let s; try{ s=await api('/clock/status'); }catch(e){ host.innerHTML=''; return; }
  CLOCK_GEO=!!s.geofenceOn;
  const t = s.since ? new Date(String(s.since).replace(' ','T')+'Z').toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
  host.innerHTML = s.clockedIn
    ? `<div class="card" style="border-left:4px solid var(--good);background:#f3f8f4;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:22px">🟢</span><div style="flex:1;min-width:160px"><strong>You're on the clock</strong>${t?` <span class="hint">· since ${esc(t)}</span>`:''}<div class="hint">You're counted on shift while clocked in.</div></div>
        <button class="btn btn-ghost sans" onclick="clockOut()">Clock out</button></div>`
    : `<div class="card" style="border-left:4px solid var(--gold);background:#faf6ee;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:22px">🕐</span><div style="flex:1;min-width:160px"><strong>You're not clocked in</strong><div class="hint">Clock in when you arrive — it puts you on shift.</div></div>
        <button class="btn btn-gold sans" onclick="clockIn()">Clock in</button></div>`;
}
function clockPos(){ return new Promise(r=>{ if(!navigator.geolocation) return r(null); navigator.geolocation.getCurrentPosition(p=>r(p), ()=>r(null), {enableHighAccuracy:true,timeout:8000,maximumAge:60000}); }); }
async function clockPunch(dir){
  let body={};
  if(CLOCK_GEO){ const p=await clockPos(); if(p) body={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy}; }
  try{ await api('/clock/'+dir,{method:'POST',body:JSON.stringify(body)}); renderClock(); renderCrew(); }catch(e){ alert(e.message); }
}
function clockIn(){ clockPunch('in'); }
function clockOut(){ if(!confirm('Clock out now?'))return; clockPunch('out'); }
// Who's on shift + the lead in charge — with a one-tap Call button for emergencies.
async function renderCrew(){
  const host=$('dashCrew'); if(!host) return;
  let d; try{ d=await api('/shift-crew'); }catch(e){ host.innerHTML=''; return; }
  const t=d.team||{};
  const tel=(p)=>String(p).replace(/[^0-9+]/g,'');
  const person=p=>`${esc(p.name)}${p.phone?` <a href="tel:${esc(tel(p.phone))}" style="text-decoration:none" title="Call ${esc(p.name)}">📞</a>`:''}`;
  const grp=(label,arr)=> (arr&&arr.length)?`<div style="margin-top:4px"><b>${label}:</b> ${arr.map(person).join(', ')}</div>`:'';
  const team=[grp('Nurses',t.nurses),grp('Techs',t.rts),grp('Case mgmt',t.caseManagers),grp('Therapists',t.therapists)].filter(Boolean).join('');
  const l=d.lead;
  const leadHtml = (l&&l.name)
    ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:20px">👤</span>
        <div style="flex:1;min-width:160px"><div style="font-weight:700">${esc(l.name)}${l.role?` <span class="hint" style="font-weight:400">· ${esc(l.role)}</span>`:''}${l.isDefault?' <span class="hint">(default)</span>':''}</div><div class="hint">Lead in charge — behavioral-contract calls & emergencies</div></div>
        ${l.phone?`<a class="btn btn-gold btn-sm sans" href="tel:${esc(tel(l.phone))}">📞 Call lead</a>`:''}
        ${d.canSetLead?`<button class="btn btn-ghost btn-sm sans" onclick="setShiftLead()">Change</button>`:''}</div>`
    : `<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap"><span class="hint">No shift lead set.</span>${d.canSetLead?`<button class="btn btn-gold btn-sm sans" onclick="setShiftLead()">Set lead</button>`:''}</div>`;
  host.innerHTML=`<div class="card" style="border-left:4px solid var(--gold)">${leadHtml}
    <div class="hint" style="margin-top:10px;line-height:1.7">${team?('🩺 On shift now'+team):'No one marked on shift yet.'}</div></div>`;
}
function setShiftLead(){
  api('/shift-crew').then(d=>{
    const l=d.lead||{};
    const save=hmodal(`<h3>Set the shift lead</h3><p class="sub sans">The person in charge right now — behavioral-contract calls, decisions, emergencies. Shown to everyone on My Shift.</p>
      <label>Name</label><input id="sl_name" value="${esc(l.name||'')}"/>
      <label>Role / title</label><input id="sl_role" value="${esc(l.role||'')}" placeholder="e.g. Charge Nurse, Shift Lead"/>
      <label>Phone (for the Call button)</label><input id="sl_phone" value="${esc(l.phone||'')}" placeholder="e.g. 555-123-4567"/>
      <label class="pi-toggle" style="margin-top:8px"><input type="checkbox" id="sl_default"/> <span>Also make this the default lead (used when no one is assigned)</span></label>`);
    save.onclick=async()=>{ try{ await api('/shift-lead',{method:'POST',body:JSON.stringify({name:$('sl_name').value,role:$('sl_role').value,phone:$('sl_phone').value,asDefault:$('sl_default').checked})}); closeHModal(); renderCrew(); }catch(e){ alert(e.message); } };
  }).catch(e=>alert(e.message));
}
// Facility at a glance — the first thing on My Shift: who's here, coming, and going.
function renderFacility(f){
  const host=$('dashFacility'); if(!host) return;
  if(!f){ host.innerHTML=''; return; }
  const box=(n,l,sev)=>`<div class="ret-card ${sev||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  host.innerHTML = box(f.census,'Patients here')
    + box(f.scheduled,'Scheduled today', f.scheduled?'rc-warn':'')
    + box(f.admitted,'Admitted today')
    + box(f.discharged,'Discharged today')
    + (f.referredOut?box(f.referredOut,'Referred out (didn\'t complete intake)'):'');
}
// My Tasks, folded onto My Shift (no separate tab): your aftercare calls + anything
// a teammate assigned you. Hidden when there's nothing, so the screen stays clean.
async function renderDashTasks(){
  const host=$('dashMyTasks'); if(!host) return;
  let d; try{ d=await api('/my-tasks'); }catch(e){ host.innerHTML=''; return; }
  const today=d.today;
  const calls=(d.calls||[]).map(c=>`<div class="todo"><div class="txt">🤝 <strong>${esc(c.pref||c.name)}</strong> — ${esc(c.type)} aftercare call · due ${esc(c.due_date)} ${c.due_date<=today?'<span class="risk risk-high">due</span>':''}</div>
    <button class="btn btn-ghost btn-sm sans" onclick="doneCall(${c.id},'Done')">Done</button><button class="btn btn-ghost btn-sm sans" onclick="doneCall(${c.id},'Unreachable')">No answer</button></div>`).join('');
  const tasks=(d.tasks||[]).map(t=>taskCard(t,'mine')).join('');
  if(!calls && !tasks){ host.innerHTML=''; return; }
  host.innerHTML=`<div class="card"><h3 style="margin:0 0 6px">✅ My tasks</h3>${calls}${tasks}</div>`;
  document.querySelectorAll('#dashMyTasks details.todo').forEach(dd=>{
    const id=(dd.querySelector('[id^="thread_"]')||{}).id; if(!id) return; const tid=id.split('_')[1];
    dd.addEventListener('toggle', ()=>{ if(dd.open) loadTaskThread(tid); });
  });
}
// Shift pass-down — a guided questionnaire (mostly yes/no taps + short prompts) so
// it's quick AND gets filled out properly. The next shift reads it first on My Shift.
const SR_SECTIONS=[
  {h:'Unit & flow', fields:[
    {k:'census',t:'Clients on the unit now',type:'num'},
    {k:'admits',t:'New admits this shift',type:'num'},
    {k:'discharges',t:'Discharges / AMA this shift',type:'num'},
  ]},
  {h:'Safety & rounds', fields:[
    {k:'rounds_ok',t:'All safety rounds done on time',type:'bool'},
    {k:'safety',t:'Safety concerns? (who / what)',type:'text'},
  ]},
  {h:'Watch list', fields:[
    {k:'watch',t:'Who to watch next shift & why',type:'text'},
  ]},
  {h:'Incidents', fields:[
    {k:'incidents_any',t:'Any incidents this shift',type:'bool'},
    {k:'incidents',t:'If yes — what happened',type:'text'},
  ]},
  {h:'Meals & comfort', fields:[
    {k:'meals_ok',t:'Meals served on time',type:'bool'},
    {k:'snacks_ok',t:'Snack station stocked',type:'bool'},
  ]},
  {h:'Belongings & valuables', fields:[
    {k:'belongings',t:'Intakes / returns / anything pending',type:'text'},
  ]},
  {h:'Environment', fields:[
    {k:'rooms_ok',t:'Rooms flipped & clean',type:'bool'},
    {k:'laundry_ok',t:'Laundry done',type:'bool'},
  ]},
  {h:'For the next shift', fields:[
    {k:'followups',t:'Left to do / follow-ups',type:'text'},
    {k:'notes',t:'Anything else',type:'text'},
  ]},
];
function srRender(dataStr){
  let d={}; try{ d=JSON.parse(dataStr||'{}')||{}; }catch{ d={}; }
  let html='';
  SR_SECTIONS.forEach(sec=>{
    const parts=[];
    sec.fields.forEach(f=>{
      const v=d[f.k];
      if(f.type==='bool'){ if(v===true||v===false) parts.push(`${esc(f.t)} — <b style="color:${v?'var(--good)':'var(--danger)'}">${v?'Yes':'No'}</b>`); }
      else if(v!=null && String(v).trim()!=='') parts.push(`${esc(f.t)}: <b>${esc(String(v))}</b>`);
    });
    if(parts.length) html+=`<div style="margin-top:7px"><span class="hint" style="text-transform:uppercase;letter-spacing:.5px;font-size:11px">${esc(sec.h)}</span><div style="line-height:1.6">${parts.join('<br>')}</div></div>`;
  });
  return html;
}
async function renderShiftReport(){
  const host=$('dashShiftReport'); if(!host) return;
  let d; try{ d=await api('/shift-report'); }catch(e){ host.innerHTML=''; return; }
  const p=d.previous;
  let prevHtml;
  if(p){
    const head=`<div class="hint">${esc(p.shift)} shift · ${esc(p.shift_date)}${p.by_name?' · '+esc(p.by_name):''}</div>`;
    let bodyHtml = p.data ? srRender(p.data) : '';
    if(!bodyHtml){ // legacy free-text report
      const line=(lbl,val)=> val?`<div style="margin-top:6px"><span class="hint" style="text-transform:uppercase;letter-spacing:.5px;font-size:11px">${lbl}</span><div>${esc(val).replace(/\n/g,'<br>')}</div></div>`:'';
      bodyHtml = line('What you need to know',p.summary)+line('Watch list',p.watch)+line('Left to do',p.followups);
    }
    prevHtml = head + (bodyHtml || '<div class="pc-note" style="margin-top:6px">No details were left.</div>');
  } else prevHtml = `<div class="pc-note">No prior shift report yet — you'll set the first one.</div>`;
  const cur=d.current;
  host.innerHTML=`<div class="card" style="border-left:4px solid var(--aqua);background:#f4fafb">
    <div class="cmd-hero-row"><div><h3 style="margin:0">📋 Last shift's report — read before you start</h3></div>
      <div class="toolbar" style="gap:6px"><button class="btn btn-ghost btn-sm sans" onclick="shiftReportHistory()">Earlier</button><button class="btn btn-gold btn-sm sans" onclick="writeShiftReport()">${cur?'Update my report':'Write my shift report'}</button></div></div>
    <div style="margin-top:8px">${prevHtml}</div>
    ${cur?`<div class="pc-note" style="margin-top:10px">✓ Your ${esc(d.shift)} report is saved${cur.by_name?' ('+esc(cur.by_name)+')':''} — tap “Update my report” to add more.</div>`:''}
  </div>`;
}
async function writeShiftReport(){
  let ctx; try{ ctx=await api('/shift-report'); }catch(e){ alert(e.message); return; }
  let cur={}; try{ cur=ctx.current&&ctx.current.data?JSON.parse(ctx.current.data):{}; }catch{ cur={}; }
  const sug=ctx.suggest||{};
  const val=k=> cur[k]!=null?cur[k]:(sug[k]!=null?sug[k]:'');
  const field=f=>{
    if(f.type==='bool') return `<label class="pi-toggle"><input type="checkbox" id="sr_${f.k}" ${cur[f.k]?'checked':''}/> <span>${esc(f.t)}</span></label>`;
    if(f.type==='num') return `<label>${esc(f.t)}</label><input type="number" id="sr_${f.k}" min="0" value="${esc(String(val(f.k)))}"/>`;
    return `<label>${esc(f.t)}</label><textarea id="sr_${f.k}" rows="2">${esc(cur[f.k]||'')}</textarea>`;
  };
  const body=SR_SECTIONS.map(sec=>`<h4 style="margin:16px 0 4px;color:var(--navy)">${esc(sec.h)}</h4>${sec.fields.map(field).join('')}`).join('');
  const save=hmodal(`<h3>${ctx.current?'Update':'Write'} the ${esc(ctx.shift)} shift report</h3><p class="sub sans">Quick taps — yes/no plus a few notes. The next shift reads this first.</p>${body}`);
  save.onclick=async()=>{
    const data={};
    SR_SECTIONS.forEach(sec=>sec.fields.forEach(f=>{ const el=$('sr_'+f.k); if(!el)return; data[f.k]= f.type==='bool'?el.checked:el.value.trim(); }));
    try{ await api('/shift-report',{method:'POST',body:JSON.stringify({data})}); closeHModal(); renderShiftReport(); }catch(e){ alert(e.message); }
  };
}
async function shiftReportHistory(){
  let d; try{ d=await api('/shift-report/history'); }catch(e){ alert(e.message); return; }
  const rows=(d.reports||[]).map(r=>{
    let bodyHtml = r.data ? srRender(r.data) : '';
    if(!bodyHtml) bodyHtml = [r.summary&&esc(r.summary), r.watch&&('👁 '+esc(r.watch)), r.followups&&('☑ '+esc(r.followups))].filter(Boolean).join('<br>');
    return `<div class="card" style="margin-bottom:8px"><div class="hint">${esc(r.shift)} shift · ${esc(r.shift_date)}${r.by_name?' · '+esc(r.by_name):''}</div><div style="margin-top:4px">${bodyHtml||'<span class="hint">No details.</span>'}</div></div>`;
  }).join('')||'<div class="empty">No reports yet.</div>';
  hmodalPlain(`<h3>Shift reports — recent</h3><div style="max-height:60vh;overflow:auto;margin-top:8px">${rows}</div><div class="toolbar" style="margin-top:12px"><button class="btn btn-ghost sans" onclick="closeHModal()">Close</button></div>`);
}
// Lean shift screen (frontline roles): greeting + critical alerts + ONE ranked
// "needs you now" list. Everything else is intentionally hidden to cut the noise.
function renderLeanDashboard(d){
  ['dashStandard','dashMiles','dashStats','dashNorthStar','dashNudges','dashTiles','dashWins'].forEach(id=>{ if($(id)) $(id).innerHTML=''; });
  if($('dashActions')) $('dashActions').style.display='none';
  const al=(d.alerts||[]);
  $('dashAlerts').innerHTML = al.length ? `<div class="card" style="border-left:4px solid var(--danger)">
      <h3 style="margin:0 0 6px">⚡ Needs attention now <span class="badge">${al.length}</span></h3>
      ${al.map(a=>`<div class="todo"><div class="txt">${a.level==='High'?'🔴 ':''}${esc(a.message)}</div><button class="btn btn-ghost btn-sm sans" onclick="ackAlert(${a.id})">Got it ✓</button></div>`).join('')}
    </div>` : '';
  const P=d.priority||[];
  const sevColor=s=>s==='high'?'var(--danger)':s==='warn'?'#9a6a1f':'var(--aqua)';
  $('dashSections').innerHTML = P.length
    ? `<div class="card"><h3 style="margin:0 0 2px">Needs you now</h3><p class="sub sans" style="margin:0 0 12px">Work the list top to bottom. Tap one, do it, come back.</p>
        ${P.map(p=>`<div class="lean-row" onclick="show('${p.view}')" style="border-left:4px solid ${sevColor(p.sev)}">
          <div class="lean-ic">${p.icon}</div>
          <div class="lean-main"><div class="lean-t">${esc(p.label)}</div>${p.sub?`<div class="hint">${esc(p.sub)}</div>`:''}</div>
          <div class="lean-go">›</div></div>`).join('')}</div>`
    : `<div class="card" style="text-align:center;padding:34px 20px"><div style="font-size:44px;line-height:1">✅</div>
        <h3 style="margin:8px 0 0">You're all caught up</h3>
        <p class="sub sans" style="margin:4px 0 0">Nothing needs you this minute. Do a round, check on someone, keep the place calm.</p>
        <button class="btn btn-gold sans" style="margin-top:12px" onclick="show('roundscan')">Start a round ›</button></div>`;
}
function renderAlertsList(d){
  if(!$('alertsList')) return;
  $('alertCount').textContent = d.newCount || '';
  const ss=d.shiftStats;
  const head = ss&&ss.total ? `<div class="hint" style="margin-bottom:7px">${esc(ss.shift)} shift — <strong>${ss.done}/${ss.total} handled${ss.pct!=null?' ('+ss.pct+'%)':''}</strong> · alerts clear at shift change</div>` : '';
  $('alertsList').innerHTML = head + ((d.alerts||[]).length ? d.alerts.map(a=>`<div class="todo">
      <div class="txt">⚡ ${esc(a.message)} <span class="hint">· ${esc(a.created_at)}</span></div>
      ${a.client_id?`<button class="btn btn-ghost btn-sm sans" onclick="openJourney(${a.client_id})">Open</button>`:''}
      <button class="btn btn-ghost btn-sm sans" onclick="ackAlert(${a.id})">Got it ✓</button></div>`).join('') : '<div class="pc-note">✓ No open alerts this shift.</div>');
}
async function ackAlert(id){
  await api('/alerts/'+id+'/ack',{method:'POST'});
  if($('dashboard')&&$('dashboard').classList.contains('active')){ loadDashboard(); return; }
  await loadToday(); todayPanel('alerts');
}

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
    <button class="btn btn-gold btn-sm sans" style="margin-top:8px" onclick="recognizeChampion('${esc(d.champion.name).replace(/'/g,"\\'")}')">Recognize publicly</button></div>` : '';
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
      <div class="txt"><span class="risk ${sev[i.severity]||''}">${esc(i.severity)}</span> <strong>${esc(i.type)}</strong>${i.pref?' · '+esc(i.pref):''} ${i.needs_contract?'<span class="risk risk-high">needs behavioral contract</span>':''} — ${esc(i.description)}
        ${i.action_taken?'<div class="hint">Action: '+esc(i.action_taken)+'</div>':''}<div class="hint">${esc(i.created_at)} · ${esc(i.reported_by_name||'')} · ${esc(i.status)}</div></div>
      ${i.needs_contract?`<button class="btn btn-gold btn-sm sans" onclick="startContract(${i.client_id||'null'},${i.id})">Start contract</button>`:''}
      ${i.status!=='Closed'?`<button class="btn btn-ghost btn-sm sans" onclick="setIncident(${i.id},'Reviewed')">Reviewed</button><button class="btn btn-ghost btn-sm sans" onclick="setIncident(${i.id},'Closed')">Close</button>`:''}</div>`).join('') : '<div class="empty">No incidents reported.</div>';
  loadBContracts();
}
async function addIncident(){
  if(!$('in_desc').value.trim()) return;
  await api('/incidents',{method:'POST',body:JSON.stringify({client_id:$('in_client').value||null,type:$('in_type').value,severity:$('in_sev').value,description:$('in_desc').value,action_taken:$('in_action').value,needs_contract:$('in_needs_contract')&&$('in_needs_contract').checked})});
  $('in_desc').value=''; $('in_action').value=''; if($('in_needs_contract'))$('in_needs_contract').checked=false; loadIncidents();
}
async function setIncident(id,status){ await api('/incidents/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadIncidents(); }

/* ---- Behavioral contracts ---- */
async function loadBContracts(){
  const el=$('bcList'); if(!el) return;
  let d; try{ d=await api('/behavior-contracts'); }catch(e){ el.innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  el.innerHTML = d.contracts.length ? d.contracts.map(bc=>`<div class="todo ${bc.status==='Closed'?'done':''}">
      <div class="txt"><strong>${esc(bc.pref||'Client')}</strong> <span class="risk ${bc.status==='Active'?'risk-elev':'risk-low'}">${esc(bc.status)}</span>
        ${bc.reason?'<div class="hint">Reason: '+esc(bc.reason)+'</div>':''}
        ${bc.terms?'<div class="hint">Terms: '+esc(bc.terms)+'</div>':''}
        ${bc.lastNote?'<div class="hint">📝 '+esc(bc.lastNote)+'</div>':''}
        <div class="hint">${bc.noteCount} note(s)${bc.started_by_name?' · started by '+esc(bc.started_by_name):''}</div></div>
      <button class="btn btn-gold btn-sm sans" onclick="openBContract(${bc.id})">Add / view notes</button>
      ${bc.status==='Active'?`<button class="btn btn-ghost btn-sm sans" onclick="setBContract(${bc.id},'Closed')">Close</button>`:`<button class="btn btn-ghost btn-sm sans" onclick="setBContract(${bc.id},'Active')">Reopen</button>`}
    </div>`).join('') : '<div class="empty">No behavioral contracts yet.</div>';
}
function newBContract(){ startContract(null,null); }
async function startContract(clientId, incidentId){
  const save=hmodal(`<h3>New behavioral contract</h3>
    <label>Client</label><select id="bc_client"></select>
    <label>Reason — what prompted it</label><textarea id="bc_reason" rows="2" placeholder="e.g. repeated curfew/boundary issue; conflict on the unit"></textarea>
    <label>Terms / expectations agreed</label><textarea id="bc_terms" rows="3" placeholder="What the client agrees to going forward"></textarea>`);
  await fillClientSelect($('bc_client'),'Select client'); if(clientId) $('bc_client').value=clientId;
  save.onclick=async()=>{ if(!$('bc_client').value){ alert('Pick a client.'); return; }
    try{ await api('/behavior-contracts',{method:'POST',body:JSON.stringify({client_id:$('bc_client').value,reason:$('bc_reason').value,terms:$('bc_terms').value,incident_id:incidentId})}); closeHModal(); loadIncidents(); }catch(e){ alert(e.message); } };
}
async function openBContract(id){
  let bc; try{ bc=await api('/behavior-contracts/'+id); }catch(e){ alert(e.message); return; }
  const notes=(bc.notes||[]).map(n=>`<div class="pc-note">📝 ${esc(n.note)} <span class="hint">— ${esc(n.by_name||'')}, ${esc(n.created_at)}</span></div>`).join('')||'<div class="hint">No notes yet.</div>';
  const save=hmodal(`<h3>Behavioral contract — ${esc(bc.pref||'Client')}</h3>
    ${bc.reason?`<p class="sub sans"><b>Reason:</b> ${esc(bc.reason)}</p>`:''}
    ${bc.terms?`<p class="sub sans"><b>Terms:</b> ${esc(bc.terms)}</p>`:''}
    <label>Add information / observation</label><textarea id="bc_note" rows="3" placeholder="What you observed, a step taken, how the client is doing against the contract…"></textarea>
    <div style="max-height:240px;overflow:auto;margin-top:12px">${notes}</div>`);
  save.onclick=async()=>{ const note=$('bc_note').value.trim(); if(!note){ alert('Write a note.'); return; }
    try{ await api('/behavior-contracts/'+id+'/note',{method:'POST',body:JSON.stringify({note})}); closeHModal(); loadIncidents(); }catch(e){ alert(e.message); } };
}
async function setBContract(id,status){ try{ await api('/behavior-contracts/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadIncidents(); }catch(e){ alert(e.message); } }

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

/* ---- Staff Voice + Best Place to Work ---- */
function isLeadershipUser(){ return !!(ME && (ME.role==='admin' || ['Executive Director','Director of Operations','Clinical Director'].includes(ME.job_role))); }
async function loadStaffVoice(){
  const feed=$('voiceFeed'); if(!feed) return;
  let d; try{ d=await api('/staff-voice'); }catch(e){ return; }
  feed.innerHTML = d.rows.length ? d.rows.map(v=>`<div class="pc-note" style="border-left:3px solid ${v.status==='done'?'#3f8c5a':'#c8a44d'}">
    <div>${esc(v.text)}</div>
    <div class="hint" style="margin-top:2px">${esc(v.by_name||'')} · ${esc(v.at||'')}${v.status==='done'?'':' · <span style="color:#a60">awaiting response</span>'}</div>
    ${v.response?`<div style="margin-top:6px;background:#f4f8f4;border-radius:6px;padding:8px"><b style="color:#2f6b44">✓ We heard you — ${esc(v.responded_by||'')}:</b> ${esc(v.response)}</div>`:''}
    ${d.canRespond&&v.status!=='done'?`<button class="btn btn-ghost btn-sm sans" style="margin-top:6px" onclick="respondVoice(${v.id})">Respond &amp; close the loop</button>`:''}
  </div>`).join('') : '<div class="hint">No staff voice yet — be the first to share what would make this better.</div>';
}
async function submitVoice(){
  const text=$('voice_text')?$('voice_text').value.trim():''; if(!text){ if($('voice_msg'))$('voice_msg').textContent='Share something first.'; return; }
  try{ await api('/staff-voice',{method:'POST',body:JSON.stringify({text,anonymous:$('voice_anon')?$('voice_anon').checked:false})}); $('voice_text').value=''; if($('voice_anon'))$('voice_anon').checked=false; if($('voice_msg'))$('voice_msg').textContent='✓ Thank you — we read every one.'; setTimeout(()=>{if($('voice_msg'))$('voice_msg').textContent='';},2500); loadStaffVoice(); }
  catch(e){ if($("voice_msg"))$('voice_msg').textContent=e.message; }
}
async function respondVoice(id){
  const response=prompt('How are we responding / what did we do about it? (this is shown to the team)'); if(response===null) return;
  try{ await api('/staff-voice/'+id+'/respond',{method:'POST',body:JSON.stringify({response})}); loadStaffVoice(); if(typeof pollWpBadge==='function') pollWpBadge(); if($('wpVoice')&&$('workplace')&&$('workplace').classList.contains('active')) loadWorkplace(); }catch(e){ alert(e.message); }
}
async function loadWorkplace(){
  // staff pickers
  try{ const {staff}=await api('/staff'); const opts='<option value="">— teammate —</option>'+staff.filter(s=>s.active!==0).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join(''); if($('wp_rec_to'))$('wp_rec_to').innerHTML=opts; if($('wp_growth_to'))$('wp_growth_to').innerHTML=opts; }catch(e){}
  let d; try{ d=await api('/workplace'); }catch(e){ $('wpKpis').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const moraleLabel = d.morale==null?'—':(d.morale>=80?'Strong':d.morale>=60?'Okay':d.morale>=40?'Stretched':'At risk');
  const bl=d.belonging||{};
  const blArrow = (bl.avg!=null&&bl.prevAvg!=null) ? (bl.avg>bl.prevAvg?' ↑':bl.avg<bl.prevAvg?' ↓':'') : '';
  $('wpKpis').innerHTML=`
    <div class="ret-card ${bl.avg!=null&&bl.avg<7?'rc-high':''}"><div class="n">${bl.avg==null?'—':bl.avg+'/10'}${blArrow}</div><div class="l">Belonging${bl.n?' ('+bl.n+')':''}</div></div>
    <div class="ret-card ${d.morale!=null&&d.morale<60?'rc-high':''}"><div class="n">${d.morale==null?'—':d.morale}</div><div class="l">Morale ${d.morale!=null?'('+moraleLabel+')':''}</div></div>
    <div class="ret-card"><div class="n">${d.recognitionsWeek}</div><div class="l">Recognitions this week</div></div>
    <div class="ret-card ${d.callOffsWeek?'rc-warn':''}"><div class="n">${d.callOffsWeek}</div><div class="l">Call-offs this week</div></div>
    <div class="ret-card ${d.openVoice?'rc-warn':''}"><div class="n">${d.openVoice}</div><div class="l">Open staff voice</div></div>
    <div class="ret-card"><div class="n">${d.voiceClosedWeek}</div><div class="l">Loops closed this week</div></div>`;
  $('wpMostRecognized').innerHTML = (d.mostRecognized||[]).length ? d.mostRecognized.map(r=>`<div class="pc-note">🏅 <strong>${esc(r.name)}</strong> <span class="hint">· ${r.n}×</span></div>`).join('') : '<div class="hint">No recognitions logged this week yet.</div>';
  renderExcellenceScoreboard(d.excellence);
  loadVoiceInto('wpVoice');
  loadGrowth();
}
// Excellence Scoreboard (Phase 2) — is the operating rhythm actually running?
function renderExcellenceScoreboard(x){
  const host=$('wpExcellence'); if(!host) return;
  if(!x){ host.innerHTML=''; return; }
  const pctStaff=n=>x.staffCount?` <span class="hint">of ${x.staffCount}</span>`:'';
  const turn = x.headcount ? Math.round(x.termed90/(x.headcount+x.termed90)*100) : null;
  const bar=(q,a)=>a==null?'':`<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(q)}</span><strong style="color:${a>=4?'var(--good)':a>=3?'#9a6a1f':'var(--danger)'}">${a}/5</strong></div><div class="res-track" style="height:8px;margin-top:3px"><div class="res-fill" style="width:${a/5*100}%;background:${a>=4?'var(--good)':a>=3?'#c8a44d':'var(--danger)'}"></div></div></div>`;
  host.innerHTML=`
    <div class="cmd-hero-row"><div><h3 style="margin:0">📐 Excellence Scoreboard</h3><p class="sub sans" style="margin:0">The operating rhythm, measured — line-ups run, recognition tied to principles, coaching circled back, every voice heard.</p></div></div>
    <div class="ret-cards" style="margin-top:10px">
      <div class="ret-card ${x.lineups7<7?'rc-warn':''}"><div class="n">${x.lineups7}</div><div class="l">Line-ups logged (7d)</div></div>
      <div class="ret-card"><div class="n">${x.coachingMonth}</div><div class="l">Coaching notes this month</div></div>
      <div class="ret-card ${x.followupsOverdue?'rc-high':''}"><div class="n">${x.followupsOverdue}</div><div class="l">Coaching follow-ups overdue</div></div>
      <div class="ret-card"><div class="n">${x.trainingWeek}${pctStaff()}</div><div class="l">Reviewed the standard (7d)</div></div>
      <div class="ret-card"><div class="n">${x.reflectionsWeek}${pctStaff()}</div><div class="l">Friday reflections this week</div></div>
      <div class="ret-card ${turn!=null&&turn>15?'rc-high':''}"><div class="n">${turn==null?'—':turn+'%'}</div><div class="l">Turnover (90d)${x.termed90?' · '+x.termed90+' left':''}</div></div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div><strong class="sans">📊 Monthly excellence survey · ${esc(x.month)} ${x.surveyN?`(${x.surveyN} response${x.surveyN===1?'':'s'}, anonymous)`:''}</strong>
        ${x.surveyAvgs?x.surveyQuestions.map((q,i)=>bar(q,x.surveyAvgs[i])).join(''):'<div class="hint" style="margin-top:6px">No responses yet this month — it\'s on everyone\'s Today list until they answer. Mention it at the line-up.</div>'}
        ${x.surveyN?`<button class="btn btn-ghost btn-sm sans" style="margin-top:4px" onclick="showExsResults()">Trend + by role + comments ›</button>`:''}</div>
      <div><strong class="sans">🌟 Recognition by principle (30d)</strong>
        ${(x.recogByPrinciple||[]).length?x.recogByPrinciple.map(r=>`<div class="pc-note">${esc(r.principle)} <span class="hint">· ${r.n}×</span></div>`).join(''):'<div class="hint" style="margin-top:6px">No principle-tagged recognition yet — the 🌟 Recognize button asks which principle they lived.</div>'}
        <div class="hint" style="margin-top:6px">The principles nobody is recognizing are the ones nobody is seeing lived. Coach there.</div></div>
    </div>`;
}
// Survey drill-down: month-over-month trend, by-role slice, anonymous comments.
async function showExsResults(){
  let d; try{ d=await api('/exsurvey/results'); }catch(e){ alert(e.message); return; }
  const months=d.months.map(m=>`<tr><td>${esc(m.month)}</td><td>${m.n}</td>${m.avgs.map(a=>`<td style="color:${a==null?'var(--muted)':a>=4?'var(--good)':a>=3?'#9a6a1f':'var(--danger)'}">${a==null?'—':a}</td>`).join('')}</tr>`).join('');
  hmodalPlain(`<h3>📊 Excellence survey — results</h3>
    <p class="sub sans">Q1–Q6: ${d.questions.map((q,i)=>`<strong>Q${i+1}</strong> ${esc(q)}`).join(' · ')}</p>
    <div style="overflow-x:auto"><table class="tbl"><tr><th>Month</th><th>n</th>${d.questions.map((_,i)=>`<th>Q${i+1}</th>`).join('')}</tr>${months}</table></div>
    ${d.byRole.length?`<div class="cmd-sub">By role · ${esc(d.month)} <span class="hint">(lowest first — that's where the system is breaking)</span></div>${d.byRole.map(r=>`<div class="pc-note">${esc(r.role)} <span class="hint">· ${r.avg==null?'—':r.avg+'/5'} · ${r.n} response${r.n===1?'':'s'}</span></div>`).join('')}`:''}
    ${d.comments.length?`<div class="cmd-sub">Comments · ${esc(d.month)} (anonymous)</div>${d.comments.map(c=>`<div class="pc-note">“${esc(c)}”</div>`).join('')}`:''}
    <div class="toolbar" style="margin-top:14px"><button class="btn btn-ghost sans" onclick="closeHModal()">Close</button></div>`);
}
async function loadVoiceInto(elId){
  const feed=$(elId); if(!feed) return;
  let d; try{ d=await api('/staff-voice'); }catch(e){ return; }
  feed.innerHTML = d.rows.length ? d.rows.map(v=>`<div class="pc-note" style="border-left:3px solid ${v.status==='done'?'#3f8c5a':'#c8a44d'};display:flex;justify-content:space-between;gap:8px"><span><div>${esc(v.text)}</div><div class="hint">${esc(v.by_name||'')} · ${esc(v.at||'')}</div>${v.response?`<div style="margin-top:4px;font-style:italic;color:#555">✓ ${esc(v.response)}</div>`:''}</span>${v.status!=='done'?`<button class="btn btn-gold btn-sm sans" style="white-space:nowrap" onclick="respondVoice(${v.id})">Respond</button>`:''}</div>`).join('') : '<div class="hint">No staff voice yet.</div>';
}
async function leaderRecognize(){
  const to=$('wp_rec_to')?$('wp_rec_to').value:''; const text=$('wp_rec_text')?$('wp_rec_text').value.trim():'';
  if(!text){ alert('Say what they did.'); return; }
  try{ await api('/kudos',{method:'POST',body:JSON.stringify({to_user_id:to||null,text:'🙌 '+text})}); $('wp_rec_text').value=''; loadWorkplace(); }catch(e){ alert(e.message); }
}
async function loadGrowth(){
  const box=$('wpGrowthFeed'); if(!box) return;
  let d; try{ d=await api('/growth'); }catch(e){ return; }
  box.innerHTML = d.rows.length ? d.rows.map(g=>`<div class="pc-note"><strong>${esc(g.staff_name)}</strong>${g.goal?' <span class="hint">· goal: '+esc(g.goal)+'</span>':''}${g.note?'<div>'+esc(g.note)+'</div>':''}<div class="hint">${esc(g.by_name||'')} · ${esc(g.at||'')}</div></div>`).join('') : '<div class="hint">No growth check-ins yet.</div>';
}
async function addGrowth(){
  const sel=$('wp_growth_to'); const staff_id=sel?sel.value:''; const goal=($('wp_growth_goal')||{}).value||''; const note=($('wp_growth_note')||{}).value||'';
  if(!staff_id){ alert('Pick a teammate.'); return; }
  try{ await api('/growth',{method:'POST',body:JSON.stringify({staff_id,staff_name:sel.options[sel.selectedIndex].text,goal,note})}); $('wp_growth_goal').value='';$('wp_growth_note').value=''; loadGrowth(); }catch(e){ alert(e.message); }
}
async function extractKudos(P='kx'){
  const text=$(P+'_text')?$(P+'_text').value.trim():''; const msg=$(P+'_msg');
  if(!text){ if(msg)msg.textContent='Paste the replies first.'; return; }
  if(msg)msg.textContent='Reading…';
  let d; try{ d=await api('/kudos/extract',{method:'POST',body:JSON.stringify({text})}); }catch(e){ if(msg)msg.textContent=e.message; return; }
  const items=d.items||[], moments=d.moments||[];
  if(msg)msg.textContent = (items.length||moments.length)?`Found ${items.length} shout-out(s) + ${moments.length} extra-mile moment(s) — review, edit, then create:`:'Nothing found in that text.';
  const kudosHtml = items.length ? `<div class="cmd-sub">🙌 Shout-outs → Kudos</div>`+items.map((it,i)=>`<div class="pc-note kx-row" data-i="${i}" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
    <input class="kx-on" type="checkbox" checked title="Include"/>
    <input class="kx-to sans" style="width:120px" value="${esc(it.to||'')}" placeholder="to"/>
    <input class="kx-from sans" style="width:120px" value="${esc(it.from||'')}" placeholder="from"/>
    <input class="kx-reason sans" style="flex:1;min-width:180px" value="${esc(it.reason||'')}" placeholder="what they did"/>
  </div>`).join('') : '';
  const momHtml = moments.length ? `<div class="cmd-sub">✨ Extra-mile moments → Extra Mile wall</div>`+moments.map((m,i)=>`<div class="pc-note km-row" data-i="${i}" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
    <input class="km-on" type="checkbox" checked title="Include"/>
    <input class="km-person sans" style="width:120px" value="${esc(m.person||'')}" placeholder="who"/>
    <input class="km-by sans" style="width:120px" value="${esc(m.by||'')}" placeholder="noted by"/>
    <input class="km-story sans" style="flex:1;min-width:180px" value="${esc(m.story||'')}" placeholder="what they did"/>
  </div>`).join('') : '';
  $(P+'_preview').innerHTML = kudosHtml + momHtml + ((items.length||moments.length)?`<div class="toolbar" style="justify-content:flex-start;margin-top:8px"><button class="btn btn-gold sans" onclick="saveExtractedKudos('${P}')">Create</button></div>`:'');
}
async function saveExtractedKudos(P='kx'){
  const items=[...document.querySelectorAll('#'+P+'_preview .kx-row')].filter(r=>r.querySelector('.kx-on').checked)
    .map(r=>({to:r.querySelector('.kx-to').value.trim(),from:r.querySelector('.kx-from').value.trim(),reason:r.querySelector('.kx-reason').value.trim()})).filter(x=>x.to);
  const moments=[...document.querySelectorAll('#'+P+'_preview .km-row')].filter(r=>r.querySelector('.km-on').checked)
    .map(r=>({person:r.querySelector('.km-person').value.trim(),by:r.querySelector('.km-by').value.trim(),story:r.querySelector('.km-story').value.trim()})).filter(x=>x.person&&x.story);
  const msg=$(P+'_msg');
  if(!items.length&&!moments.length){ if(msg)msg.textContent='Tick at least one.'; return; }
  try{ const r=await api('/kudos/bulk',{method:'POST',body:JSON.stringify({items,moments})}); if(msg)msg.innerHTML=`✓ ${r.saved} kudos + ${r.wall} on the wall — they'll appear in the next lineup's "Caught being great."`; if($(P+'_text'))$(P+'_text').value=''; if($(P+'_preview'))$(P+'_preview').innerHTML=''; if(P==='kx')loadWorkplace(); if(P==='lx'&&typeof loadLineupRecog==='function')loadLineupRecog(); }
  catch(e){ if(msg)msg.textContent=e.message; }
}

async function loadExtraMile(){
  const box=$('extraMileFeed'); if(!box) return;
  // Recognition names the standard it reflects — fill the principle picker once.
  try{ const hb=await handbook(); const sel=$('em_principle');
    if(sel&&sel.options.length<=1) sel.innerHTML='<option value="">Which principle did they live? (optional)</option>'+hb.principles.map(p=>`<option>${esc(p.title)}</option>`).join('');
  }catch(e){}
  let d; try{ d=await api('/extra-mile'); }catch(e){ return; }
  box.innerHTML = (d.rows&&d.rows.length) ? d.rows.map(m=>`<div class="pc-note" style="border-left:3px solid #c8a44d">
    <div>✨ <strong>${esc(m.person)}</strong> — ${esc(m.story)}${m.principle?` <span class="badge" style="background:#faf6ee;border:1px solid #e7d9b6;color:#8a6d1f">${esc(m.principle)}</span>`:''}</div>
    <div class="hint" style="margin-top:2px">${m.by_name&&m.by_name!==m.person?'noted by '+esc(m.by_name)+' · ':''}${esc(m.at||'')}${!m.principle&&m.value_text?' · '+esc(m.value_text):''}</div>
  </div>`).join('') : '<div class="hint">No moments yet today — be the first to celebrate a teammate.</div>';
}
async function addExtraMile(){
  const person=$('em_person')?$('em_person').value.trim():''; const story=$('em_story')?$('em_story').value.trim():'';
  if(!person||!story){ if($('em_msg'))$('em_msg').textContent='Add who and what they did.'; return; }
  try{ await api('/extra-mile',{method:'POST',body:JSON.stringify({person,story,principle:($('em_principle')||{}).value||''})}); $('em_person').value='';$('em_story').value=''; if($('em_principle'))$('em_principle').value=''; if($('em_msg'))$('em_msg').textContent='✓ Added'; setTimeout(()=>{if($('em_msg'))$('em_msg').textContent='';},2000); loadExtraMile(); }
  catch(e){ if($('em_msg'))$('em_msg').textContent=e.message; }
}

/* ---- THE ARMADA EXCELLENCE STANDARDS — the handbook, live in the app ----
   Recognition ties to a named principle; My Role carries the chapter; the
   Friday reflection closes the week. "A standard used every day becomes who
   we are." */
let HB=null;
async function handbook(){ if(!HB) HB=await api('/handbook'); return HB; }
// 🌟 Recognize — anyone recognizes anyone, tied to a principle. The recognized
// person sees it in their Today drawer; it flows onto tomorrow's 8am lineup.
async function recognizeExcellence(){
  let hb; try{ hb=await handbook(); }catch(e){ alert(e.message); return; }
  let names=[]; try{ const {staff}=await api('/staff'); names=(staff||[]).map(s=>s.name); }catch(e){}
  const save=hmodal(`<h3>🌟 Recognize excellence</h3>
    <p class="sub sans" style="margin:0 0 8px">Good recognition names three things: the behavior, why it mattered, and which standard it reflected. “Nice job” builds nothing.</p>
    <label>Who</label><input id="rx_who" list="rx_names" placeholder="Teammate's name"/><datalist id="rx_names">${names.map(n=>`<option>${esc(n)}</option>`).join('')}</datalist>
    <label>Which Armada Principle did they live?</label><select id="rx_principle"><option value="">—</option>${hb.principles.map(p=>`<option value="${esc(p.title)}">${p.n}. ${esc(p.title)} — ${esc(p.line)}</option>`).join('')}</select>
    <label>What exactly did they do?</label><textarea id="rx_what" rows="2" placeholder="The specific behavior (no client names)"></textarea>
    <label>Why did it matter — for a client or a teammate?</label><textarea id="rx_why" rows="2" placeholder="The difference it made"></textarea>`);
  save.textContent='Recognize';
  save.onclick=async()=>{
    const who=$('rx_who').value.trim(), what=$('rx_what').value.trim(), why=$('rx_why').value.trim();
    if(!who||!what){ alert('Who, and what they did?'); return; }
    try{ await api('/extra-mile',{method:'POST',body:JSON.stringify({person:who,story:why?what+' — '+why:what,principle:$('rx_principle').value||''})}); closeHModal(); alert('🌟 Recognized — they\'ll see it, and it goes on tomorrow\'s lineup.'); }
    catch(e){ alert(e.message); }
  };
}
// 🪞 Friday reflection — four questions, two minutes.
async function submitReflection(){
  const g=id=>($(id)||{}).value||'';
  try{ await api('/reflection',{method:'POST',body:JSON.stringify({proud:g('rf_proud'),barrier:g('rf_barrier'),lived:g('rf_lived'),improve:g('rf_improve')})});
    ['rf_proud','rf_barrier','rf_lived','rf_improve'].forEach(id=>{ if($(id))$(id).value=''; });
    if($('rf_msg'))$('rf_msg').textContent='✓ Thank you — leadership reads every one.'; setTimeout(()=>{if($('rf_msg'))$('rf_msg').textContent='';},4000);
  }catch(e){ if($('rf_msg'))$('rf_msg').textContent=e.message; }
}
// The full handbook browser — every chapter, browsable by anyone.
async function loadHandbook(){
  const host=$('handbookBody'); if(!host) return;
  host.innerHTML='<div class="card"><div class="empty">Loading…</div></div>';
  let hb; try{ hb=await handbook(); }catch(e){ host.innerHTML='<div class="card"><div class="empty">'+esc(e.message)+'</div></div>'; return; }
  const chapterCard=(c,open)=>`<details class="card" style="margin-bottom:12px" ${open?'open':''}>
    <summary style="cursor:pointer;font-weight:700;font-size:16px">Chapter ${c.chapter} · ${esc(c.title)}${hb.myChapter===c.title?' <span class="badge" style="background:#faf6ee;border:1px solid #e7d9b6;color:#8a6d1f">my chapter</span>':''}</summary>
    <div style="margin-top:10px">${hbChapterHtml(c)}</div></details>`;
  host.innerHTML=`
    <div class="card" style="background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;text-align:center">
      <div class="sans" style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--gold)">The Armada Excellence Standards</div>
      <div style="font-family:Georgia,serif;font-size:20px;line-height:1.5;margin-top:8px">What excellence looks like in every role</div>
      <div class="sans" style="margin-top:6px;color:var(--gold)">${esc(hb.allBehindYou)}</div>
    </div>
    <div class="card" style="border-left:4px solid var(--gold)">
      <div class="hint" style="text-transform:uppercase;letter-spacing:.6px;color:var(--gold)">Today's Principle · ${hb.todays.principle.n} of 10</div>
      <h3 style="margin:2px 0 0">${esc(hb.todays.principle.title)}</h3><p class="sub sans" style="margin:2px 0 0">${esc(hb.todays.principle.line)}</p>
      <div class="hint" style="margin-top:8px">🛡 ${esc(hb.todays.safety)}</div>
    </div>
    <details class="card" style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:700;font-size:16px">A note before you begin — ${esc(hb.intro.note.title)}</summary>
      <div style="margin-top:10px;font-size:14px;line-height:1.65">${hb.intro.note.body.map(p=>`<p>${esc(p)}</p>`).join('')}<p class="hint">${esc(hb.intro.note.sign)}</p></div></details>
    <div class="card">
      <h3>The Armada Principles</h3><p class="sub sans">The same for every role, in every building. Learn them, coach from them, live them.</p>
      <div style="margin-top:8px">${hb.principles.map(p=>`<div class="kv"><span class="k" style="min-width:250px">${p.n}. ${esc(p.title)}</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted)">${esc(p.line)}</span></div>`).join('')}</div>
    </div>
    <div class="card">
      <h3>How to use this handbook — three layers</h3>
      <div style="margin-top:8px">${hb.intro.layers.map(l=>`<div class="kv"><span class="k" style="min-width:200px">${esc(l.k)}</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted)">${esc(l.v)}</span></div>`).join('')}</div>
      <p class="sub sans" style="margin-top:8px">The “What Excellence Is Not” section in each chapter is your fastest coaching tool — contrast teaches faster than aspiration.</p>
    </div>
    ${hb.chapters.map(c=>chapterCard(c, hb.myChapter===c.title)).join('')}
    <div class="card">
      <h3>How the standard stays alive</h3>
      <p class="sub sans">${esc(hb.intro.lineup.body)}</p>
      <ul style="margin:8px 0;padding-left:18px;font-size:14px;line-height:1.65">${hb.intro.lineup.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>
      <div style="margin-top:8px">${hb.intro.rhythm.map(r=>`<div class="kv"><span class="k" style="min-width:170px">${esc(r.k)}</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted)">${esc(r.v)}</span></div>`).join('')}</div>
    </div>
    <div class="card" style="text-align:center;background:#faf6ee;border-left:4px solid var(--gold)">
      <p style="font-size:14px;line-height:1.65;margin:0">${esc(hb.standard)}</p>
      <div class="sans" style="margin-top:8px;font-weight:700;color:#8a6d1f">${esc(hb.allBehindYou)}</div>
    </div>`;
}
// One chapter, in the handbook's three layers — shared by the browser and My Role.
function hbChapterHtml(c){
  return `
    <p style="font-size:14px;line-height:1.65">${c.purpose.map(esc).join('</p><p style="font-size:14px;line-height:1.65">')}</p>
    <div class="kv"><span class="k" style="min-width:170px">Those outside our walls</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted)">${esc(c.serve.outside)}</span></div>
    <div class="kv"><span class="k" style="min-width:170px">Your teammates inside</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted)">${esc(c.serve.inside)}</span></div>
    <div class="cmd-grid" style="margin-top:10px">
      <div><h4 style="margin:0 0 4px">Excellence looks like</h4><ul style="margin:4px 0;padding-left:18px;font-size:13px;line-height:1.6">${c.looks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h4 style="margin:0 0 4px">Daily standards</h4><ul style="margin:4px 0;padding-left:18px;font-size:13px;line-height:1.6">${c.daily.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
    </div>
    <div style="border:1px solid #e3b3ac;background:#fff8f7;border-radius:8px;padding:10px 14px;margin-top:10px">
      <h4 style="margin:0 0 4px;color:#b3382f">What excellence is not</h4><ul style="margin:4px 0;padding-left:18px;font-size:13px;line-height:1.6">${c.not.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
    <div style="margin-top:10px"><h4 style="margin:0 0 4px">Behaviors that define excellence</h4><div style="display:flex;flex-wrap:wrap;gap:6px">${c.behaviors.map(b=>`<span class="badge" style="background:#eef5f0;border:1px solid #bcd8c6">✓ ${esc(b)}</span>`).join('')}</div></div>
    <div style="margin-top:10px"><h4 style="margin:0 0 4px">How excellence is measured</h4>${c.measures.map(m=>`<div class="kv"><span class="k" style="min-width:140px">${esc(m.k)}</span><span class="v" style="text-align:left;font-weight:400;color:var(--muted)">${esc(m.v)}</span></div>`).join('')}</div>
    <div style="margin-top:10px"><h4 style="margin:0 0 4px">Ask yourself every day</h4><ul style="margin:4px 0;padding-left:18px;font-size:13px;line-height:1.6">${c.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul></div>
    <p class="sub sans" style="margin-top:10px;font-style:italic">${esc(c.closing)}</p>`;
}
// 📊 Monthly Excellence Survey (Phase 2) — the handbook's six employee questions,
// 1-5 agree, anonymous (answers carry role only; the done-marker is separate).
let EXS={};
async function loadExSurvey(){
  const card=$('exSurveyCard'), box=$('exSurveyQs'); if(!card||!box) return;
  let d; try{ d=await api('/exsurvey'); }catch(e){ return; }
  if(d.done){ card.innerHTML='<h3>📊 Monthly excellence survey</h3><p class="sub sans" style="margin:0">✓ Thank you — this month\'s survey is in (anonymously). See you next month.</p>'; return; }
  EXS={};
  box.innerHTML=d.questions.map((q,i)=>{ const qi='q'+(i+1);
    return `<div style="margin:8px 0"><div class="sans" style="font-size:13px;margin-bottom:4px">${esc(q)}</div>
      <div data-q="${qi}" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${[1,2,3,4,5].map(n=>`<button type="button" class="btn btn-ghost btn-sm sans exs-b" onclick="pickExs('${qi}',${n},this)">${n}</button>`).join('')}<span class="hint" style="margin-left:6px">1 = strongly disagree · 5 = strongly agree</span></div></div>`;
  }).join('');
}
function pickExs(q,n,btn){ EXS[q]=n; btn.parentElement.querySelectorAll('.exs-b').forEach(b=>{ b.classList.toggle('btn-gold',b===btn); b.classList.toggle('btn-ghost',b!==btn); }); }
async function submitExSurvey(){
  if(!Object.keys(EXS).length){ if($('exs_msg'))$('exs_msg').textContent='Pick at least one answer.'; return; }
  try{ await api('/exsurvey',{method:'POST',body:JSON.stringify({...EXS,comment:($('exs_comment')||{}).value||''})}); loadExSurvey(); }
  catch(e){ if($('exs_msg'))$('exs_msg').textContent=e.message; }
}
// Coaching-from-the-standard picker: the ten principles + every chapter's
// "What Excellence Is Not" lines — point at the written line, never coach by mood.
async function fillStdSelect(id, preferTitle){
  const sel=$(id); if(!sel) return;
  let hb; try{ hb=await handbook(); }catch(e){ return; }
  const chapters=[...hb.chapters].sort((a,b)=>(a.title===preferTitle?-1:0)-(b.title===preferTitle?-1:0));
  sel.innerHTML='<option value="">Standard (optional — coach from the written line)</option>'
    +'<optgroup label="Armada Principles">'+hb.principles.map(p=>`<option value="${esc(p.title)}">${p.n}. ${esc(p.title)}</option>`).join('')+'</optgroup>'
    +chapters.map(c=>`<optgroup label="${esc(c.title)} — What Excellence Is Not">${c.not.map(n=>`<option value="${esc(c.title)}: ${esc(n)}">${esc(n.slice(0,80))}</option>`).join('')}</optgroup>`).join('');
}

/* ---- belonging pulse (anonymous, the plan's leading indicator) ---- */
const BELONG_Q = ['I feel part of something here', 'My input is heard', "I'm treated with respect"];
let BELONG = {};
function renderBelonging(){
  const card=$('belongCard'); const box=$('belongQs'); if(!card||!box) return;
  if(localStorage.getItem('belong_date')===today()){ card.innerHTML='<h3>💜 Belonging check-in</h3><p class="sub sans" style="margin:0">✓ Thanks — your check-in is in (anonymously). Come back tomorrow.</p>'; return; }
  BELONG={};
  box.innerHTML = BELONG_Q.map((q,i)=>{ const qi='q'+(i+1);
    return `<div style="margin:8px 0"><div class="sans" style="font-size:13px;margin-bottom:4px">${esc(q)}</div>
      <div data-q="${qi}" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button type="button" class="btn btn-ghost btn-sm sans bl-b" onclick="pickBelong('${qi}',${n},this)">${n}</button>`).join('')}<span class="hint" style="margin-left:6px">1 = strongly disagree · 10 = strongly agree</span></div></div>`;
  }).join('');
}
function pickBelong(q,n,btn){ BELONG[q]=n; [...btn.parentElement.querySelectorAll('.bl-b')].forEach(b=>b.classList.remove('btn-gold')); btn.classList.add('btn-gold'); }
async function submitBelonging(){
  if(BELONG.q1==null||BELONG.q2==null||BELONG.q3==null){ if($('belong_msg'))$('belong_msg').textContent='Please answer all three.'; return; }
  try{ await api('/belonging-pulse',{method:'POST',body:JSON.stringify({q1:BELONG.q1,q2:BELONG.q2,q3:BELONG.q3,note:($('belong_note')||{}).value||''})});
    localStorage.setItem('belong_date',today()); renderBelonging();
  }catch(e){ if($('belong_msg'))$('belong_msg').textContent=e.message; }
}

/* ---- team ---- */
async function loadTeam(){
  if($('workplaceLink')) $('workplaceLink').style.display = isLeadershipUser() ? '' : 'none';
  loadStaffVoice();
  loadExtraMile();
  renderBelonging();
  loadExSurvey();
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
const SURVEY_TARGET=92;
function pct10(avg){ return avg==null?null:Math.round(avg*10); }          // 0-10 avg → %
function survCls(pct){ return pct==null?'':pct>=SURVEY_TARGET?'':pct>=75?'rc-warn':'rc-high'; }
async function loadSurveys(){
  const { surveys } = await api('/surveys'); SURVEYS = surveys;
  if($('sv_select')) $('sv_select').innerHTML = surveys.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('');
  try { const { clients } = await api('/clients');
    if($('sv_client')) $('sv_client').innerHTML = '<option value="">Anonymous</option>' + clients.map(c=>`<option value="${c.id}">${esc(c.pref||c.name)}</option>`).join('');
  } catch(e){}
  if($('surveyGiveArea')) $('surveyGiveArea').innerHTML = '<div class="empty">Pick a survey and press Start.</div>';
  if($('surveyArea')) $('surveyArea').innerHTML = '';
  try {
    const { due } = await api('/surveys/due');
    $('surveyDue').innerHTML = due.length ? `<div class="card"><h3>Surveys to offer</h3>
      <p class="sub sans">The app auto-offers the Experience survey weekly and the Discharge survey after discharge.</p>
      ${due.map(d=>`<div class="todo"><div class="txt"><strong>${esc(d.client)}</strong> — ${esc(d.title)} <span class="hint">· ${esc(d.reason)}</span></div>
        <button class="btn btn-gold btn-sm sans" onclick="startDue(${d.survey_id},${d.client_id})">Offer now</button></div>`).join('')}</div>` : '';
  } catch(e){ $('surveyDue').innerHTML=''; }
  const isAdmin = ME && ME.role==='admin';
  if(isAdmin) await loadSurveyOverview();
  surveyTab(isAdmin?'results':'give');
  if(isAdmin && PENDING_SURVEY){ const id=PENDING_SURVEY; PENDING_SURVEY=null; showSurveyResults(id); }
}
function surveyTab(which){
  const res = which==='results' && ME && ME.role==='admin';
  if($('svResultsPanel')) $('svResultsPanel').style.display = res?'':'none';
  if($('svGivePanel')) $('svGivePanel').style.display = res?'none':'';
  if($('svTabResults')) $('svTabResults').classList.toggle('active',res);
  if($('svTabGive')) $('svTabGive').classList.toggle('active',!res);
}
function sparkSvg(series, w, h){
  w=w||120; h=h||26;
  const pts=[];
  (series||[]).forEach((p,i)=>{ if(p.avg==null) return; const n=series.length; const x=n>1?(i/(n-1))*(w-4)+2:w/2; const y=h-3-(p.avg/10)*(h-6); pts.push([x,y]); });
  if(!pts.length) return '<span class="hint">no trend yet</span>';
  const line=pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const dots=pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="1.7" fill="var(--gold)"/>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="6-month trend">${pts.length>1?`<polyline points="${line}" fill="none" stroke="var(--gold)" stroke-width="1.6"/>`:''}${dots}</svg>`;
}
function surveyTrendBadge(s){
  if(s.dir==null) return s.recentN?'<span class="hint">new</span>':'';
  const c = s.dir==='up'?'#2d7a4f':s.dir==='down'?'var(--danger)':'var(--muted)';
  const arrow = s.dir==='up'?'▲':s.dir==='down'?'▼':'→';
  const pts = Math.round((s.trend||0)*10);   // 0-10 avg diff → % points
  const sign = pts>0?'+':'';
  return `<span style="color:${c};font-weight:700" title="last 30 days vs the prior 30">${arrow} ${sign}${pts}</span>`;
}
async function loadCmdSurveys(){
  if(!$('cmdSurveys')) return;
  let d; try{ d=await api('/surveys/overview'); }catch(e){ $('cmdSurveys').innerHTML='<div class="hint">'+esc(e.message)+'</div>'; return; }
  const any = d.surveys.some(s=>s.responses);
  $('cmdSurveys').innerHTML = any ? `<div class="ret-cards">${d.surveys.map(s=>{
      const sc = pct10(s.recentAvg!=null?s.recentAvg:s.avg);
      return `<div class="ret-card ${survCls(sc)}" style="cursor:pointer" onclick="openSurveyResults(${s.id})"><div class="n">${sc!=null?sc+'<span style="font-size:14px">%</span>':'—'} ${surveyTrendBadge(s)}</div><div style="margin:2px 0">${sparkSvg(s.spark,110,22)}</div><div class="l">${esc(s.title)} · ${s.responses} ›</div></div>`;
    }).join('')}</div><p class="hint" style="margin-top:6px">Score = last 30 days, shown as a %. ▲▼ vs the prior 30 days. Line = 6-month trend. Target ${SURVEY_TARGET}%.</p>` : '<div class="hint">No survey responses yet. Put the kiosk on the unit to start gathering them.</div>';
}
let PENDING_SURVEY=null;
function openSurveyResults(id){ PENDING_SURVEY=id; show('surveys'); }
async function sendScorecard(){ if($('scorecardMsg'))$('scorecardMsg').textContent='Sending…'; try{ const r=await api('/command/scorecard/send',{method:'POST'}); if($('scorecardMsg'))$('scorecardMsg').textContent = r.sent?('✓ Scorecard emailed to '+r.to):('Not sent — '+(r.reason||'')); }catch(e){ if($('scorecardMsg'))$('scorecardMsg').textContent=e.message; } }
async function loadSurveyOverview(){
  if(!$('surveyOverview')) return;
  let d; try{ d=await api('/surveys/overview'); }catch(e){ return; }
  $('surveyOverview').innerHTML = `<div class="card"><h3>Survey results</h3>
    <p class="sub sans">Tap <strong>View</strong> to see scores and comments. <strong>Clear</strong> erases trial/test data.</p>
    ${d.surveys.map(s=>`<div class="todo"><div class="txt"><strong>${esc(s.title)}</strong> ${surveyTrendBadge(s)} <span style="margin-left:8px">${sparkSvg(s.spark,90,20)}</span> <span class="hint">· ${s.responses} response${s.responses===1?'':'s'}${s.avg!=null?' · all-time '+pct10(s.avg)+'%':''}${s.recentAvg!=null?' · 30d '+pct10(s.recentAvg)+'%':''}${s.last?' · last '+esc(s.last):''}</span></div>
      <div style="display:flex;gap:6px">${s.responses?`<button class="btn btn-gold btn-sm sans" onclick="showSurveyResults(${s.id})">View</button><button class="btn btn-ghost btn-sm sans" onclick="clearSurveyResponses(${s.id},${s.responses})">Clear</button>`:'<span class="hint" style="align-self:center">no responses yet</span>'}</div></div>`).join('')}</div>`;
}
function startDue(surveyId, clientId){
  surveyTab('give');
  $('sv_select').value = surveyId;
  $('sv_client').value = clientId || '';
  startSurvey();
  if($('surveyGiveArea')) $('surveyGiveArea').scrollIntoView({behavior:'smooth'});
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
  // scale / rating: 0..10 → each point = 10%, average × 10 = the % score
  return `<div class="sv-opts">${[0,1,2,3,4,5,6,7,8,9,10].map(n=>`<button type="button" class="sv-opt" data-v="${n}" onclick="pickOpt(this)">${n}</button>`).join('')}
    <span class="hint" style="margin-left:6px">${q.type==='rating'?'0 = poor · 10 = excellent':'0 = strongly disagree · 10 = strongly agree'} (shown as a %)</span></div>`;
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
  $('surveyGiveArea').innerHTML = `<div class="card"><h3>${esc(s.title)}</h3>
    <p class="sub sans">${esc(s.description||'')}</p>${html}
    <div class="toolbar" style="margin-top:16px"><button class="btn btn-primary sans" onclick="submitSurvey(${s.id})">Submit survey</button></div>
    <div id="svMsg" class="hint"></div></div>`;
}
async function submitSurvey(id){
  const answers = [];
  document.querySelectorAll('#surveyGiveArea .sq').forEach(sq=>{
    const qid = +sq.dataset.qid, type = sq.dataset.type;
    if(type==='text'){ const t=sq.querySelector('.sq-text').value.trim(); if(t) answers.push({question_id:qid, text:t}); }
    else { const opts=sq.querySelector('.sv-opts'); if(opts && opts.dataset.val!=null) answers.push({question_id:qid, num:+opts.dataset.val}); }
  });
  if(!answers.length){ $('svMsg').textContent='Please answer at least one question.'; return; }
  await api('/surveys/'+id+'/respond',{method:'POST',body:JSON.stringify({client_id:$('sv_client').value||null, answers})});
  $('surveyGiveArea').innerHTML = '<div class="card"><h3>Thank you 💚</h3><p class="sans">Your responses were recorded. They help us care for everyone better.</p><button class="btn btn-ghost sans" onclick="loadSurveys()">Done</button></div>';
}
async function showSurveyResults(id){
  if(!id) return;
  let data;
  try { data = await api('/surveys/'+id+'/results'); } catch(e){ $('surveyArea').innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  const { survey, responses, questions, submissions } = data;
  let cat='', html='';
  questions.forEach(q=>{
    if(q.category && q.category!==cat){ cat=q.category; html+=`<div class="sv-cat">${esc(cat)}</div>`; }
    if(q.type==='text'){
      html += `<div class="sq"><div class="sq-q">${esc(q.text)}</div>${q.comments&&q.comments.length?'<ul class="ama-list">'+q.comments.map(c=>`<li>${esc(c)}</li>`).join('')+'</ul>':'<div class="hint">No comments yet.</div>'}</div>`;
    } else if(q.type==='yesno'){
      html += `<div class="sq res"><div class="sq-q">${esc(q.text)}</div><div class="res-val">${q.yesPct!=null?q.yesPct+'% yes <span class="hint">('+q.count+')</span>':'<span class="hint">no responses</span>'}</div></div>`;
    } else {
      const pct = pct10(q.avg);
      const low = pct!=null && pct<SURVEY_TARGET;
      html += `<div class="sq res"><div class="sq-q">${esc(q.text)}</div>
        <div class="res-bar"><div class="res-track"><div class="res-fill ${low?'low':''}" style="width:${pct||0}%"></div></div>
        <div class="res-num ${low?'low':''}">${pct!=null?pct+'%':'—'} <span class="hint">(${q.count})</span></div></div></div>`;
    }
  });
  $('surveyArea').innerHTML = `<div class="card"><div class="cmd-hero-row"><div><h3 style="margin:0">${esc(survey.title)} — results</h3>
    <p class="sub sans">${responses} response${responses===1?'':'s'}. Scores under ${SURVEY_TARGET}% are flagged. Low "feel cared for" scores are an early AMA signal.</p></div>
    ${responses?`<button class="btn btn-ghost btn-sm sans" onclick="clearSurveyResponses(${survey.id}, ${responses})" title="Erase all responses (e.g. trial data)">🗑 Clear ${responses} response${responses===1?'':'s'}</button>`:''}</div>${html}</div>
    ${submissions&&submissions.length?`<div class="card"><h3>Who responded</h3>
      <p class="sub sans">Named when the client chose their name; otherwise Anonymous. Tap a named one to read their answers.</p>
      ${submissions.map(r=>{const sp=pct10(r.avg);return `<div class="todo"><div class="txt"><strong>${esc(r.who)}</strong> ${sp!=null?`<span class="risk ${sp<SURVEY_TARGET?'risk-high':'risk-low'}">${sp}%</span>`:''} <span class="hint">· ${esc(r.at)}${r.by?' · entered by '+esc(r.by):''}</span></div>${r.named?`<button class="btn btn-ghost btn-sm sans" onclick="viewResponse(${r.id})">View</button>`:''}</div>`;}).join('')}</div>`:''}`;
  $('surveyArea').scrollIntoView({behavior:'smooth',block:'start'});
}
async function viewResponse(rid){
  let d; try{ d=await api('/surveys/response/'+rid); }catch(e){ alert(e.message); return; }
  alert(d.who+' · '+d.at+'\n\n'+d.answers.map(a=>'• '+a.q+'\n   '+(a.val||'—')).join('\n\n'));
}
async function clearSurveyResponses(id, n){
  if(!confirm(`Erase all ${n} response(s) for this survey? This permanently deletes the trial/test data and can't be undone.`)) return;
  try{ const r=await api('/surveys/'+id+'/clear',{method:'POST'}); if($('surveyArea')) $('surveyArea').innerHTML=''; loadSurveyOverview(); alert('✓ Cleared '+r.cleared+' response(s).'); }
  catch(e){ alert(e.message); }
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
