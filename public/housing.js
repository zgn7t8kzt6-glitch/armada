/* Armada Recovery Housing — front-end for the sober-living suite.
   Loaded after app.js, so it shares its globals (api, $, esc, today, initials, ME, show). */
const HOUSING = { meta:null, residents:[], resStatus:'active', houses:[], tenure:'all', restr:null };

// Early-tenure milestone buckets — the highest-risk window in recovery housing,
// where the "anticipated stay" needs the most touchpoints.
const TENURE_BUCKETS = [
  ['t30',  'First 30 days',  d => d <= 30],
  ['t60',  '31–60 days',     d => d > 30 && d <= 60],
  ['t90',  '61–90 days',     d => d > 60 && d <= 90],
  ['t90p', '90+ days',       d => d > 90],
];

async function hMeta(){ if(!HOUSING.meta){ try{ HOUSING.meta = await api('/housing/meta'); }catch(e){ HOUSING.meta={reccapDomains:[],phases:[],loc:{},orhStandards:[]}; } } return HOUSING.meta; }

/* ---- shared helpers ---- */
const money = n => '$'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0});
function hLvl(l){ return l==='L3' ? '<span class="lvl lvl-l3">★ Level 3 · Supervised</span>' : '<span class="lvl lvl-l2">Level 2 · Monitored</span>'; }
function hProg(p){ if(!p) return ''; const c={PHP:'#c06a52',IOP:'#d29a5e',Graduate:'#7e9a5e'}[p]||'#5fb0c2'; return `<span class="loc-pill" style="background:${c}">${esc(p)}</span>`; }
function hLocPill(loc){ const m=(HOUSING.meta&&HOUSING.meta.loc)||{}; const c=(m[loc]&&m[loc].color)||'#6f7a75'; return `<span class="loc-pill" style="background:${c}">${esc(loc||'—')}</span>`; }
function hRing(pct, value, label, color){
  color = color || (pct>=70?'#5fb0c2':pct>=40?'#d29a5e':'#c06a52');
  return `<div class="rc-ring" style="--p:${Math.max(0,Math.min(100,pct))};--c:${color}"><div class="rcv"><b>${value}</b><span>${esc(label||'')}</span></div></div>`;
}
function hmodal(html){ const m=$('hModal'); $('hModalBody').innerHTML = html + `<div class="toolbar" style="margin-top:18px"><button class="btn btn-ghost sans" onclick="closeHModal()">Cancel</button><button class="btn btn-primary sans" id="hModalSave">Save</button></div>`; m.style.display='flex'; m.onclick=e=>{ if(e.target===m) closeHModal(); }; return $('hModalSave'); }
function hmodalPlain(html){ const m=$('hModal'); $('hModalBody').innerHTML = html; m.style.display='flex'; m.onclick=e=>{ if(e.target===m) closeHModal(); }; }
function closeHModal(){ $('hModal').style.display='none'; $('hModalBody').innerHTML=''; }
const isAdmin = () => ME && ME.role==='admin';

// Data quality: flag missing / impossible dates of birth (common in the imported
// export — typo'd years, future dates, ages outside a plausible adult range).
function dobCheck(dob){
  if(!dob) return { ok:false, age:null, msg:'No date of birth on file' };
  const d=new Date(dob+'T00:00:00'); if(isNaN(d)) return { ok:false, age:null, msg:'Unreadable date of birth' };
  const now=new Date(); let age=now.getFullYear()-d.getFullYear();
  if(now.getMonth()<d.getMonth()||(now.getMonth()===d.getMonth()&&now.getDate()<d.getDate())) age--;
  if(d>now) return { ok:false, age, msg:'Date of birth is in the future' };
  if(age<18) return { ok:false, age, msg:`Age reads ${age} — under 18 (likely a typo)` };
  if(age>100) return { ok:false, age, msg:`Age reads ${age} — over 100 (likely a typo)` };
  return { ok:true, age, msg:'' };
}
function dqBadge(dob){ const c=dobCheck(dob); return c.ok?'':`<span class="chip" title="${esc(c.msg)}" style="background:#fbe9d8;color:#a35a23;border-color:#f0c9a3;cursor:help">⚠ check DOB</span>`; }
// Restriction chip for the residents list: red when on restriction, green when
// the window has elapsed and they qualify to come off.
function restrChip(r){
  const x=r&&r.restriction; if(!x) return '';
  if(x.eligible) return `<span class="chip" title="${esc(x.type)} — window elapsed" style="background:#e8f3ec;color:#2f7a4f;border-color:#bfe0cb">🔓 eligible to lift</span>`;
  const left=x.daysLeft!=null?` · ${x.daysLeft}d left`:'';
  return `<span class="chip" title="${esc(x.type)}${x.reason?' — '+esc(x.reason):''}" style="background:#fdeaea;color:#b3382f;border-color:#f3c4c0">🔒 ${esc(x.type)}${left}</span>`;
}

/* ============================ HOUSING HQ ============================ */
async function loadHousingHQ(){
  await hMeta();
  let d; try{ d=await api('/housing/overview'); }catch(e){ $('hqKpis').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const k=d.kpis;
  $('hqKpis').innerHTML = `
    <div class="ret-card"><div class="n">${k.occupied}/${k.capacity}</div><div class="l">Beds filled · ${k.occPct}%</div></div>
    <div class="ret-card ${k.open?'':''}"><div class="n">${k.open}</div><div class="l">Open beds</div></div>
    <div class="ret-card"><div class="n">${k.reccapAvg??'—'}</div><div class="l">Avg recovery capital</div></div>
    <div class="ret-card ${k.underDose?'rc-warn':''}"><div class="n">${k.underDose}</div><div class="l">Clinical under-dose</div></div>
    <div class="ret-card ${k.screensDue?'rc-warn':''}"><div class="n">${k.screensDue}</div><div class="l">Screens due</div></div>
    <div class="ret-card ${k.balanceOut>0?'rc-warn':''}"><div class="n">${money(k.balanceOut)}</div><div class="l">Balance outstanding</div></div>
    <div class="ret-card ${k.returnsToUse?'rc-high':''}"><div class="n">${k.returnsToUse}</div><div class="l">Returns to use · mo</div></div>
    <div class="ret-card ${k.orhPct>=90?'':'rc-warn'}"><div class="n">${k.orhPct}%</div><div class="l">ORH compliance</div></div>`;
  // by level of care
  const total = Object.values(d.byLoc).reduce((a,b)=>a+b,0)||1;
  $('hqLoc').innerHTML = Object.keys(d.byLoc).map(loc=>{
    const n=d.byLoc[loc]; const pct=Math.round(n/total*100);
    const m=(HOUSING.meta.loc[loc])||{};
    return `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span>${hLocPill(loc)} <span class="hint">${esc(m.label||'')}</span></span><b>${n}</b></div>
      <div class="dose"><span style="width:${pct}%;background:${m.color||'#5fb0c2'}"></span></div></div>`;
  }).join('');
  // houses
  $('hqHouses').innerHTML = d.houses.map(h=>houseMiniCard(h)).join('') || '<div class="empty">No houses yet.</div>';
  // attention
  const a=[];
  if(k.underDose) a.push(`🩺 <b>${k.underDose}</b> resident(s) below their clinical dose this week — <a onclick="show('coordination')" style="cursor:pointer;color:var(--navy)">coordinate care →</a>`);
  if(k.screensDue) a.push(`🧪 <b>${k.screensDue}</b> resident(s) due for a screen — <a onclick="show('screens')" style="cursor:pointer;color:var(--navy)">screen now →</a>`);
  if(k.returnsToUse) a.push(`⚠️ <b>${k.returnsToUse}</b> return(s) to use this month — recover instantly, keep the door open.`);
  if(k.balanceOut>0) a.push(`💵 <b>${money(k.balanceOut)}</b> in outstanding balances — <a onclick="show('ledger')" style="cursor:pointer;color:var(--navy)">review ledger →</a>`);
  if(k.grievOpen) a.push(`📣 <b>${k.grievOpen}</b> open grievance(s) — a complaint is a gift; <a onclick="show('orh')" style="cursor:pointer;color:var(--navy)">resolve →</a>`);
  if(k.orhPct<90) a.push(`🏛️ ORH compliance at <b>${k.orhPct}%</b> — excellence is non-negotiable; <a onclick="show('orh')" style="cursor:pointer;color:var(--navy)">close the gaps →</a>`);
  $('hqAttention').innerHTML = a.length ? a.map(x=>`<div class="cmd-row"><div class="cmd-row-main">${x}</div></div>`).join('') : '<div class="hint">All clear across housing. 🎉</div>';
}
function houseMiniCard(h){
  const filled=h.occ.occupied||0, cap=h.capacity||0, pct=cap?Math.round(filled/cap*100):0;
  return `<div class="house-card" onclick="show('houses')" style="cursor:pointer">
    <div class="house-top" style="background:linear-gradient(120deg,${esc(h.color||'#235056')},#2d6168)">
      <h4>${esc(h.name)}</h4>
      <div class="meta">${esc(h.gender||'Any')} ${h.mat_friendly?'· MAT-friendly':''}</div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${hProg(h.program)} ${hLvl(h.level)}</div>
    </div>
    <div class="house-body">
      <div style="display:flex;justify-content:space-between;font-size:12px"><span class="hint">Occupancy</span><b>${filled}/${cap}</b></div>
      <div class="occbar ${pct>=100?'full':''}"><span style="width:${pct}%"></span></div>
      <div class="hint">${h.occ.open||0} open · House mgr: ${esc(h.manager||'—')}</div>
    </div></div>`;
}

/* ============================ HOUSES & BEDS ============================ */
async function loadHouses(){
  await hMeta();
  let houses; try{ houses=await api('/housing/houses'); }catch(e){ $('housesBoard').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  HOUSING.houses = houses;
  $('housesBoard').innerHTML = houses.map(h=>{
    const filled=h.occ.occupied||0, cap=h.capacity||h.beds.length, pct=cap?Math.round(filled/cap*100):0;
    const beds = h.beds.map(b=>`
      <button class="bed bed-${b.status}" onclick="bedClick(${b.id})" title="${esc(b.status)}">
        <div class="blab">${esc(b.label||b.room)}</div>
        <div class="bname">${b.resident_name?esc(b.resident_name):'<span style="color:var(--muted)">—</span>'}</div>
        <div class="bstat">${b.status==='occupied'&&b.resident_loc?esc(b.resident_loc):esc(b.status)}</div>
      </button>`).join('');
    return `<div class="card">
      <div class="cmd-hero-row">
        <div><h3 style="font-size:18px">${esc(h.name)} ${hProg(h.program)} ${hLvl(h.level)} ${h.mat_friendly?'<span class="mat-pill">MAT</span>':''} ${h.active?'':'<span class="chip">inactive</span>'}</h3>
          <p class="sub sans" style="margin:2px 0 0">${esc(h.gender||'Any')}${h.address?' · '+esc(h.address):''}${h.city?', '+esc(h.city):''} · House mgr: ${esc(h.manager||'—')}${h.notes?' · '+esc(h.notes):''}</p></div>
        <div style="text-align:right">
          <div style="font-size:13px"><b>${filled}/${cap}</b> filled · ${h.occ.open||0} open</div>
          <div class="occbar ${pct>=100?'full':''}" style="width:160px;margin-left:auto"><span style="width:${pct}%"></span></div>
          <div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">
            <button class="btn btn-ghost btn-sm sans" onclick="addBed(${h.id})">+ Bed</button>
            ${isAdmin()?`<button class="btn btn-ghost btn-sm sans" onclick="openHouseForm(${h.id})">Edit</button>`:''}
          </div>
        </div>
      </div>
      <div class="bed-grid">${beds||'<div class="hint">No beds yet — add one.</div>'}</div>
    </div>`;
  }).join('') || '<div class="card"><div class="empty">No houses yet. Add your first recovery residence.</div></div>';
}
async function bedClick(bedId){
  // find bed
  let bed=null,house=null;
  for(const h of HOUSING.houses){ const b=h.beds.find(x=>x.id===bedId); if(b){ bed=b; house=h; break; } }
  if(!bed) return;
  const openRes = HOUSING.houses.flatMap(h=>h.beds).filter(b=>b.status==='occupied'); // not used directly
  const residents = (await api('/housing/residents?status=all')).filter(r=>r.status!=='discharged');
  const unbedded = residents.filter(r=>!r.bed_id || r.bed_id===bedId);
  const opts = unbedded.map(r=>`<option value="${r.id}" ${r.bed_id===bedId?'selected':''}>${esc(r.name)} · ${esc(r.loc)}${r.house&&r.house.name?' ('+esc(r.house.name)+')':''}</option>`).join('');
  hmodalPlain(`<h3>Bed ${esc(bed.label||bed.room)} · ${esc(house.name)}</h3>
    <p class="sub sans">Currently: <b>${bed.resident_name?esc(bed.resident_name):esc(bed.status)}</b></p>
    <label>Assign / move a resident here</label>
    <select id="bedRes"><option value="">— choose resident —</option>${opts}</select>
    <div class="toolbar" style="justify-content:flex-start;flex-wrap:wrap;margin-top:14px">
      <button class="btn btn-primary btn-sm sans" onclick="doAssignBed(${bedId})">Assign</button>
      ${bed.status==='occupied'?`<button class="btn btn-ghost btn-sm sans" onclick="setBedStatus(${bedId},'open')">↩ Unassign (free bed)</button>`:`<button class="btn btn-ghost btn-sm sans" onclick="setBedStatus(${bedId},'open')">Mark open</button>`}
      <button class="btn btn-ghost btn-sm sans" onclick="setBedStatus(${bedId},'hold')">Hold</button>
      <button class="btn btn-ghost btn-sm sans" onclick="setBedStatus(${bedId},'maintenance')">🛠 Maintenance</button>
      ${isAdmin()?`<button class="btn btn-danger btn-sm sans" onclick="deleteBed(${bedId})">Delete bed</button>`:''}
      <button class="btn btn-ghost btn-sm sans" style="margin-left:auto" onclick="closeHModal()">Close</button>
    </div>`);
}
async function doAssignBed(bedId){ const rid=$('bedRes').value; if(!rid){ alert('Pick a resident.'); return; } try{ await api(`/housing/beds/${bedId}/assign`,{method:'POST',body:JSON.stringify({resident_id:+rid})}); closeHModal(); loadHouses(); }catch(e){ alert(e.message); } }
async function setBedStatus(bedId,status){ try{ await api(`/housing/beds/${bedId}`,{method:'POST',body:JSON.stringify({status})}); closeHModal(); loadHouses(); }catch(e){ alert(e.message); } }
async function deleteBed(bedId){ if(!confirm('Delete this bed?')) return; try{ await api(`/housing/beds/${bedId}`,{method:'DELETE'}); closeHModal(); loadHouses(); }catch(e){ alert(e.message); } }
async function addBed(houseId){ const room=prompt('Room number (e.g. 03):'); if(room===null) return; const label=prompt('Bed label (e.g. 03A):', room+'A'); if(label===null) return; try{ await api(`/housing/houses/${houseId}/beds`,{method:'POST',body:JSON.stringify({room,label})}); loadHouses(); }catch(e){ alert(e.message); } }
function openHouseForm(id){
  const h = id ? HOUSING.houses.find(x=>x.id===id) : {};
  const save = hmodal(`<h3>${id?'Edit house':'Add a recovery residence'}</h3>
    <label>House name</label><input id="hf_name" value="${esc(h.name||'')}"/>
    <div class="grid2">
      <div><label>NARR / ORH level</label><select id="hf_level"><option value="L3" ${h.level==='L3'?'selected':''}>Level 3 — Supervised</option><option value="L2" ${h.level!=='L3'?'selected':''}>Level 2 — Monitored</option></select></div>
      <div><label>ORH certificate #</label><input id="hf_cert" value="${esc(h.orh_cert||'')}"/></div>
      <div><label>Program</label><select id="hf_program"><option value="">—</option>${['PHP','IOP','Graduate'].map(p=>`<option ${h.program===p?'selected':''}>${p}</option>`).join('')}</select></div>
      <div><label>Capacity (beds)</label><input id="hf_cap" type="number" value="${h.capacity||0}"/></div>
      <div><label>Gender</label><select id="hf_gender"><option ${h.gender==='Any'?'selected':''}>Any</option><option ${h.gender==='Men'?'selected':''}>Men</option><option ${h.gender==='Women'?'selected':''}>Women</option></select></div>
      <div><label>House manager</label><input id="hf_mgr" value="${esc(h.manager||'')}"/></div>
    </div>
    <label>Address</label><input id="hf_addr" value="${esc(h.address||'')}"/>
    <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500"><input type="checkbox" id="hf_mat" ${h.mat_friendly!==0?'checked':''} style="width:auto"/> MAT-supportive (no one excluded for prescribed medication)</label>`);
  save.onclick = async () => {
    const body = { name:$('hf_name').value, level:$('hf_level').value, orh_cert:$('hf_cert').value, program:$('hf_program').value, capacity:+$('hf_cap').value, gender:$('hf_gender').value, manager:$('hf_mgr').value, address:$('hf_addr').value, mat_friendly:$('hf_mat').checked };
    try{ await api(id?`/housing/houses/${id}`:'/housing/houses',{method:'POST',body:JSON.stringify(body)}); closeHModal(); loadHouses(); }catch(e){ alert(e.message); }
  };
}

/* ============================ RESIDENTS ============================ */
function setResStatus(st){ HOUSING.resStatus=st; document.querySelectorAll('#resStatusSeg button').forEach(b=>b.classList.toggle('on',b.dataset.st===st)); loadResidents(); }
async function loadResidents(){
  await hMeta();
  const ib=$('resImportBtn'); if(ib) ib.style.display = isAdmin() ? '' : 'none';
  let rows; try{ rows=await api('/housing/residents?status='+HOUSING.resStatus); }catch(e){ $('residentsTable').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  HOUSING.residents = rows; renderResidents();
}

// Bulk import the Akron patient export (admin only). Dayton is excluded server-side
// and residents are tied only to the 10 Akron houses by their room/facility.
function openImportForm(){
  if(!isAdmin()){ alert('Importing the patient export is restricted to the owner/admin.'); return; }
  const save = hmodal(`<h3>Import patients (Akron export)</h3>
    <p class="sub sans" style="margin:.2em 0 1em">Dayton sites are <b>excluded automatically</b> — only people whose room/house matches one of the 10 Akron homes are imported. Current residents are seated in open beds; this clears the placeholder census first. Safe to re-run (duplicates are skipped).</p>
    <label>Option A — upload the CSV file</label>
    <input id="imp_file" type="file" accept=".csv,text/csv,text/plain"/>
    <div class="hint" style="margin:10px 0 4px;text-align:center">— or —</div>
    <label>Option B — paste the spreadsheet text here</label>
    <textarea id="imp_text" rows="6" placeholder="Open the file, select all (Ctrl/Cmd+A), copy, and paste here. The first line should start with first_name,middle_name,last_name…" style="font-family:monospace;font-size:11px;white-space:pre"></textarea>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-weight:500">
      <input id="imp_alumni" type="checkbox"/> Also import past residents as alumni (discharged, no bed)
    </label>
    <div id="imp_status" class="hint" style="margin-top:10px"></div>`);
  // When the data opens as a web page, a copy carries the table's HTML. Capture
  // that on paste and flatten it to tab-separated rows the importer understands.
  const ta = $('imp_text');
  if(ta) ta.addEventListener('paste', (ev)=>{
    const html = ev.clipboardData && ev.clipboardData.getData('text/html');
    if(html && /<t[dr][\s>]/i.test(html)){
      ev.preventDefault();
      try{
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = [...doc.querySelectorAll('tr')].map(tr =>
          [...tr.querySelectorAll('th,td')].map(td => (td.textContent||'').replace(/\s+/g,' ').trim()).join('\t')
        ).filter(r=>r.replace(/\t/g,'').length);
        ta.value = rows.join('\n');
        const s=$('imp_status'); if(s) s.textContent = `Pasted ${rows.length-1} rows from the web page — click Import.`;
      }catch(e){ /* fall back to the browser's default plain-text paste */ }
    }
  });
  save.textContent = 'Import';
  save.onclick = async () => {
    const st=$('imp_status');
    const f = $('imp_file').files[0];
    const pasted = ($('imp_text').value||'').trim();
    let text='';
    if(f){ st.textContent='Reading file…'; try{ text = await f.text(); }catch(e){ st.textContent='Could not read file: '+e.message; return; } }
    else if(pasted){ text = pasted; }
    else { alert('Choose a CSV file or paste the spreadsheet text.'); return; }
    if(!/first_name/i.test(text.slice(0,500))){ st.textContent='That doesn’t look like the patient export — the first line should start with first_name,middle_name,last_name,… Try copying the whole sheet including the header row.'; return; }
    st.textContent='Importing '+(text.length/1024|0)+' KB…'; save.disabled=true;
    try{
      const out = await api('/housing/import', { method:'POST', body: JSON.stringify({ csv:text, includeAlumni: $('imp_alumni').checked }) });
      st.innerHTML = `<b style="color:var(--navy)">Done.</b> ${out.imported} current placed in beds${out.alumni?`, ${out.alumni} alumni`:''}. `
        + `Skipped ${out.dayton} Dayton, ${out.dups} duplicates, ${out.junk} non-resident rows.`;
      setTimeout(()=>{ closeHModal(); loadResidents(); loadHousingHQ&&loadHousingHQ(); }, 1800);
    }catch(e){ st.textContent='Import failed: '+e.message; save.disabled=false; }
  };
}
function setTenure(t){ HOUSING.tenure = (HOUSING.tenure===t ? 'all' : t); renderResidents(); }
function setRestrFilter(f){ HOUSING.restr = (HOUSING.restr===f ? null : f); renderResidents(); }
async function openRestrictionForm(id){
  let meta; try{ meta=await api('/housing/restrictions/meta'); }catch(e){ meta={types:[]}; }
  const opts=meta.types.map(t=>`<option value="${esc(t[0])}" data-days="${t[1]}" data-hint="${esc(t[2])}">${esc(t[0])}</option>`).join('');
  const save=hmodal(`<h3>Place on restriction</h3>
    <p class="sub sans" style="margin:.2em 0 1em">Track the hold and when the resident qualifies to come off it.</p>
    <div class="grid2">
      <div><label>Type</label><select id="rs_type" onchange="(function(s){var o=s.options[s.selectedIndex];document.getElementById('rs_days').value=o.dataset.days||'';document.getElementById('rs_hint').textContent=o.dataset.hint||'';})(this)">${opts}</select></div>
      <div><label>Length (days, blank = open-ended)</label><input id="rs_days" type="number" min="0" value="${meta.types[0]?meta.types[0][1]:''}"/></div>
      <div><label>Start date</label><input id="rs_start" type="date" value="${today()}"/></div>
      <div><label>&nbsp;</label><div id="rs_hint" class="hint">${meta.types[0]?esc(meta.types[0][2]):''}</div></div>
    </div>
    <label>Reason</label><input id="rs_reason" placeholder="What happened / why"/>
    <label>Conditions to come off</label><textarea id="rs_cond" rows="2" placeholder="e.g. 14 clean days, attend all meetings, meet with house manager"></textarea>`);
  save.textContent='Place restriction';
  save.onclick=async()=>{ try{ await api(`/housing/residents/${id}/restriction`,{method:'POST',body:JSON.stringify({type:$('rs_type').value,days:$('rs_days').value,start_date:$('rs_start').value,reason:$('rs_reason').value,conditions:$('rs_cond').value})}); closeHModal(); openResident(id); }catch(e){ alert(e.message); } };
}
async function liftRestriction(restrId, residentId){
  const note=prompt('Note (optional) — how they earned it / met conditions:'); if(note===null) return;
  try{ await api(`/housing/restrictions/${restrId}/lift`,{method:'POST',body:JSON.stringify({note})}); openResident(residentId); }catch(e){ alert(e.message); }
}
function renderResidents(){
  const q=($('resSearch')?.value||'').toLowerCase();
  let rows = HOUSING.residents.filter(r=>!q || (r.name||'').toLowerCase().includes(q));
  // Milestone band — counts across the loaded set, clickable to filter the list.
  const counts = {}; TENURE_BUCKETS.forEach(b=>counts[b[0]] = rows.filter(r=>b[2](r.los||0)).length);
  const band = `<div class="tenure-band">${TENURE_BUCKETS.map(b=>`
    <button class="tenure-pill ${HOUSING.tenure===b[0]?'on':''}" onclick="setTenure('${b[0]}')">
      <span class="tn">${counts[b[0]]}</span><span class="tl">${b[1]}</span></button>`).join('')}
    <button class="tenure-pill ${HOUSING.tenure==='all'?'on':''}" onclick="setTenure('all')"><span class="tn">${rows.length}</span><span class="tl">All</span></button></div>`;
  if(HOUSING.tenure!=='all'){ const f=TENURE_BUCKETS.find(b=>b[0]===HOUSING.tenure); if(f) rows = rows.filter(r=>f[2](r.los||0)); }
  // Restriction filter band
  const onR=rows.filter(r=>r.restriction).length, eligR=rows.filter(r=>r.restriction&&r.restriction.eligible).length;
  const rb = (onR||eligR||HOUSING.restr) ? `<div class="tenure-band" style="margin-bottom:10px">
    <button class="tenure-pill ${HOUSING.restr==='on'?'on':''}" onclick="setRestrFilter('on')"><span class="tn">${onR}</span><span class="tl">🔒 On restriction</span></button>
    <button class="tenure-pill ${HOUSING.restr==='elig'?'on':''}" onclick="setRestrFilter('elig')"><span class="tn">${eligR}</span><span class="tl">🔓 Eligible to lift</span></button></div>` : '';
  if(HOUSING.restr==='on') rows=rows.filter(r=>r.restriction);
  else if(HOUSING.restr==='elig') rows=rows.filter(r=>r.restriction&&r.restriction.eligible);
  if(!rows.length){ $('residentsTable').innerHTML=band+rb+'<div class="empty">No residents in this group.</div>'; return; }
  const dq = rows.filter(r=>!dobCheck(r.dob).ok).length;
  const dqBanner = dq ? `<div class="hint" style="margin:0 0 8px;padding:8px 10px;background:#fbe9d8;border:1px solid #f0c9a3;border-radius:8px;color:#a35a23">⚠ ${dq} resident${dq>1?'s have':' has'} a missing or implausible date of birth (common after import). Open a record and click <b>Fix</b> to correct it.</div>` : '';
  $('residentsTable').innerHTML = band + rb + dqBanner + `<table class="tbl"><thead><tr>
    <th>Resident</th><th>House · bed</th><th>LOC</th><th>Phase</th><th>Days</th><th>Sober</th><th>Recovery capital</th><th>Clinical dose</th><th>Balance</th><th></th>
    </tr></thead><tbody>${rows.map(r=>{
      const phase=(HOUSING.meta.phases.find(p=>p.n===r.phase)||{}).name||r.phase;
      const dosePct=r.clinTarget?Math.round(r.clinHoursWk/r.clinTarget*100):100;
      return `<tr style="cursor:pointer" onclick="openResident(${r.id})">
        <td><span class="res-cell">${r.hasPhoto?`<img class="res-thumb" loading="lazy" src="/api/housing/residents/${r.id}/photo" alt=""/>`:`<span class="res-thumb res-thumb-i">${esc(initials(r.name))}</span>`}<b>${esc(r.name)}</b> ${dqBadge(r.dob)} ${restrChip(r)}</span></td>
        <td>${r.house?esc(r.house.name):'<span class="hint">unassigned</span>'}${r.bed?' · '+esc(r.bed.label):''}</td>
        <td>${hLocPill(r.loc)}</td>
        <td>${esc(phase)}</td>
        <td>${r.los}d</td>
        <td>${r.soberDays?r.soberDays+'d':'—'}</td>
        <td>${r.reccap!=null?`<b style="color:var(--navy)">${r.reccap}</b>/10`:'<span class="hint">—</span>'}</td>
        <td>${r.clinTarget?`<div class="dose ${dosePct<60?'low':''}" style="width:80px"><span style="width:${Math.min(100,dosePct)}%"></span></div><span class="hint">${r.clinHoursWk}/${r.clinTarget}h</span>`:'<span class="hint">housing only</span>'}</td>
        <td>${r.balance>0?`<span style="color:var(--danger);font-weight:600">${money(r.balance)}</span>`:money(r.balance)}</td>
        <td style="text-align:right;white-space:nowrap">${r.status==='active'?`<button class="btn btn-ghost btn-sm sans" onclick="event.stopPropagation();openDischargeForm(${r.id})">Discharge</button>`:`<span class="chip">${esc(r.status)}</span>`}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}
async function openResidentForm(){
  await hMeta();
  const houses = (await api('/housing/houses'));
  const houseOpts = houses.map(h=>`<option value="${h.id}">${esc(h.name)} (${h.occ.open||0} open)</option>`).join('');
  const locOpts = Object.keys(HOUSING.meta.loc).map(k=>`<option value="${k}">${esc(HOUSING.meta.loc[k].label)}</option>`).join('');
  const save = hmodal(`<h3>New resident intake</h3>
    <p class="sub sans">The warm welcome — Step 1 of Service. Lead with the person, then the paperwork.</p>
    <label>Name</label><input id="rf_name"/>
    <div class="grid2">
      <div><label>House</label><select id="rf_house"><option value="">— waitlist (no house yet) —</option>${houseOpts}</select></div>
      <div><label>Level of care</label><select id="rf_loc">${locOpts}</select></div>
      <div><label>Move-in date</label><input id="rf_movein" type="date" value="${today()}"/></div>
      <div><label>Sobriety date</label><input id="rf_sober" type="date"/></div>
      <div><label>Recovery coach</label><input id="rf_coach"/></div>
      <div><label>Payer</label><input id="rf_payer" placeholder="SOR scholarship / Medicaid / Self-pay"/></div>
      <div><label>Phone</label><input id="rf_phone"/></div>
      <div><label>MAT (if any)</label><input id="rf_mat" placeholder="Suboxone / Vivitrol / None"/></div>
    </div>
    <label>Recovery goals</label><textarea id="rf_goals" rows="2" placeholder="What does a good outcome look like for them?"></textarea>`);
  save.onclick = async () => {
    const body={ name:$('rf_name').value, house_id:$('rf_house').value||null, loc:$('rf_loc').value, move_in:$('rf_movein').value, sober_date:$('rf_sober').value||null, recovery_coach:$('rf_coach').value, payer:$('rf_payer').value, phone:$('rf_phone').value, mat:$('rf_mat').value, goals:$('rf_goals').value };
    if(!body.name.trim()){ alert('Name is required.'); return; }
    try{ const {id}=await api('/housing/residents',{method:'POST',body:JSON.stringify(body)}); closeHModal(); openResident(id); }catch(e){ alert(e.message); }
  };
}

// Profile photo — resized client-side, stored on the resident, served as bytes.
// A face photo is PHI, so the first upload requires a consent attestation.
function pickResidentPhoto(id, file){
  if(!file) return;
  const r=HOUSING.current||{};
  if(r.photo_consent){ uploadResidentPhoto(id, file, false); return; } // consent already on file
  const save=hmodal(`<h3>Photo consent</h3>
    <p class="sub sans" style="margin:.2em 0 1em">A photo on file helps staff recognize and warmly welcome each resident. Please confirm the resident has given permission to store their picture in Hilltop Recovery Home.</p>
    <label style="display:flex;gap:8px;align-items:flex-start;font-weight:500"><input id="pc_ok" type="checkbox"/><span>The resident consented to having their photo kept on file.</span></label>`);
  save.textContent='Save photo';
  save.onclick=async()=>{ if(!$('pc_ok').checked){ alert('Please confirm consent, or cancel.'); return; } closeHModal(); await uploadResidentPhoto(id, file, true); };
}
async function uploadResidentPhoto(id, file, consent){
  if(!file) return;
  try{
    const dataUrl = await resizeImage(file, 480, 0.82);
    await api(`/housing/residents/${id}/photo`, { method:'POST', body: JSON.stringify({ photo:dataUrl, consent: !!consent }) });
    if(HOUSING.current && HOUSING.current.id===id){ HOUSING.current.hasPhoto=true; if(consent) HOUSING.current.photo_consent='Consent on file'; }
    openResident(id);
  }catch(e){ alert('Could not save photo: '+(e.message||'error')); }
}
async function removeResidentPhoto(id){
  if(!confirm('Remove this resident’s photo?')) return;
  try{ await api(`/housing/residents/${id}/photo`, { method:'POST', body: JSON.stringify({ photo:null }) }); openResident(id); }
  catch(e){ alert(e.message); }
}

/* ---- Resident 360 ---- */
async function openResident(id){
  await hMeta(); await hFormTemplates();
  let r; try{ r=await api('/housing/residents/'+id); }catch(e){ alert(e.message); return; }
  HOUSING.current=r;
  show('resident');
  const phases=HOUSING.meta.phases;
  const cap=r.capHistory&&r.capHistory.length?r.capHistory[r.capHistory.length-1]:null;
  const capPct=cap?Math.round(cap.total*10):0;
  const dosePct=r.clinTarget?Math.round(r.clinHoursWk/r.clinTarget*100):100;
  const phaseTrack = phases.map(p=>`<div class="phase-step ${r.phase>p.n?'done':''} ${r.phase===p.n?'cur':''}">
      <div class="pn">PHASE ${p.n}</div><div class="pl">${esc(p.name)}</div><div class="hint" style="margin-top:2px;font-size:10px">${esc(p.days)}d</div></div>`).join('');
  // reccap domain bars
  const domBars = HOUSING.meta.reccapDomains.map(d=>{
    const v=cap&&cap.scores?(cap.scores[d[0]]??0):0;
    return `<div class="rcdom"><div class="lab"><span title="${esc(d[2])}">${esc(d[1])}</span><b>${v}/10</b></div><div class="rcbar"><span style="width:${v*10}%"></span></div></div>`;
  }).join('');
  $('residentBody').innerHTML = `
    <div class="toolbar no-print" style="justify-content:flex-start"><button class="btn btn-ghost btn-sm sans" onclick="show('residents')">← All residents</button></div>
    <div class="card">
      <div class="r360-head">
        <div class="r360-av-wrap no-print" title="Click to add or change photo">
          <div onclick="document.getElementById('r360photo').click()" style="cursor:pointer;border-radius:50%">
            ${r.hasPhoto ? `<img class="r360-av-img" src="/api/housing/residents/${r.id}/photo?t=${Date.now()}" alt="" title="${esc(r.photo_consent||'Photo on file')}"/>` : `<div class="r360-av">${esc(initials(r.name))}</div>`}
            <span class="r360-av-cam">📷</span>
          </div>
          ${r.hasPhoto?`<button class="r360-av-x" onclick="removeResidentPhoto(${r.id})" title="Remove photo">✕</button>`:''}
          <input id="r360photo" type="file" accept="image/*" style="display:none" onchange="pickResidentPhoto(${r.id}, this.files[0])"/>
        </div>
        <div style="flex:1;min-width:220px">
          <h3 style="font-size:23px;font-family:var(--serif);margin:0">${esc(r.name)}</h3>
          <div style="margin-top:5px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${r.house?`<span class="chip">${esc(r.house.name)}${r.bed?' · '+esc(r.bed.label):''}</span>`:'<span class="chip">unassigned</span>'}
            ${r.house?hLvl(r.house.level):''} ${hLocPill(r.loc)}
            <span class="chip">${r.los} days in house</span>
            ${r.soberDays?`<span class="chip" style="background:#e8f3ec;color:#2f7a4f;border-color:#bfe0cb">${r.soberDays} days sober</span>`:''}
            ${(()=>{ const c=dobCheck(r.dob); return `<span class="chip"${c.ok?'':' style="background:#fbe9d8;color:#a35a23;border-color:#f0c9a3"'}>DOB ${esc(r.dob||'—')}${c.age!=null?` · ${c.age}y`:''}</span>`; })()}
          </div>
          ${(()=>{ const c=dobCheck(r.dob); return c.ok?'':`<div class="hint" style="margin-top:6px;color:#a35a23">⚠ ${esc(c.msg)} — <button class="btn btn-ghost btn-sm sans" style="padding:1px 8px" onclick="fixDob(${r.id})">Fix</button></div>`; })()}
        </div>
        <div class="toolbar no-print" style="margin:0;flex-wrap:wrap">
          <button class="btn btn-gold btn-sm sans" onclick="openReccapForm(${r.id})">Recovery capital</button>
          <button class="btn btn-ghost btn-sm sans" onclick="openSupportForm(${r.id})">+ Meeting/support</button>
          <button class="btn btn-ghost btn-sm sans" onclick="openScreenForm(${r.id})">+ Screen</button>
          <button class="btn btn-ghost btn-sm sans" onclick="openLedgerForm(${r.id})">+ Charge/pay</button>
          ${r.status==='active'?`<button class="btn btn-ghost btn-sm sans" onclick="openRestrictionForm(${r.id})">${r.restriction?'Change restriction':'🔒 Restrict'}</button>`:''}
          ${r.status==='active'?`<button class="btn btn-danger btn-sm sans" onclick="openDischargeForm(${r.id})">Discharge</button>`:`<span class="chip">${esc(r.status)}${r.discharge_type?' · '+esc(r.discharge_type):''}</span>`}
        </div>
      </div>
      ${r.restriction?(()=>{ const x=r.restriction; const c=x.eligible?'#2f7a4f':'#b3382f'; const bg=x.eligible?'#e8f3ec':'#fdeaea'; const bd=x.eligible?'#bfe0cb':'#f3c4c0';
        return `<div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:${bg};border:1px solid ${bd};color:${c}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div><b>${x.eligible?'🔓 Eligible to come off restriction':'🔒 On restriction'}</b> — ${esc(x.type)}${x.daysLeft!=null&&!x.eligible?` · ${x.daysLeft} day(s) left`:''}
              <div class="hint" style="color:${c}">${x.reason?esc(x.reason)+' · ':''}Since ${esc(x.start_date||'')}${x.end_date?' → '+esc(x.end_date):''} · by ${esc(x.placed_by||'')}${x.conditions?'<br>Conditions: '+esc(x.conditions):''}</div></div>
            <button class="btn ${x.eligible?'btn-primary':'btn-ghost'} btn-sm sans no-print" onclick="liftRestriction(${x.id},${r.id})">Lift restriction</button>
          </div></div>`; })():''}
      <div class="phase-track" style="margin-top:16px">${phaseTrack}</div>
    </div>

    <div class="r360-grid">
      <div class="card">
        <h3>Recovery capital</h3>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          ${hRing(capPct, cap?cap.total:'—', 'of 10')}
          <div style="flex:1;min-width:160px">
            <p class="sub sans" style="margin:0 0 6px">Growth in recovery capital is the best predictor of staying in recovery. ${cap?'Last assessed '+esc(cap.date)+'.':'Not yet assessed.'}</p>
            ${r.capHistory&&r.capHistory.length>1?`<div class="hint">First ${r.capHistory[0].total} → now ${cap.total} (${(cap.total-r.capHistory[0].total>=0?'+':'')}${(cap.total-r.capHistory[0].total).toFixed(1)})</div>`:''}
          </div>
        </div>
        <div style="margin-top:12px">${domBars||'<div class="hint">No domains scored yet.</div>'}</div>
      </div>

      <div class="card">
        <h3>Recovery plan &amp; supports</h3>
        <div class="kv"><span class="k">Goals</span><span class="v" style="max-width:60%">${esc(r.goals||'—')}</span></div>
        <div class="kv"><span class="k">Recovery coach</span><span class="v">${esc(r.recovery_coach||'—')}</span></div>
        <div class="kv"><span class="k">Sponsor</span><span class="v">${esc(r.sponsor||'—')}</span></div>
        <div class="kv"><span class="k">Home group</span><span class="v">${esc(r.home_group||'—')}</span></div>
        <div class="kv"><span class="k">Meetings this week</span><span class="v">${r.meetingsWk} ${r.meetingsWk>=3?'✅':'<span style="color:var(--danger)">below 3</span>'}</span></div>
        <div class="kv"><span class="k">Employment</span><span class="v">${esc(r.employment||'—')}</span></div>
        <div class="kv"><span class="k">Education</span><span class="v">${esc(r.education||'—')}</span></div>
        <div class="kv"><span class="k">MAT</span><span class="v">${esc(r.mat||'None')}</span></div>
        <div class="toolbar no-print" style="margin-top:8px"><button class="btn btn-ghost btn-sm sans" onclick="openResidentEdit(${r.id})">Edit plan</button></div>
      </div>

      <div class="card">
        <h3>Clinical coordination</h3>
        ${r.clinTarget?`<div style="display:flex;gap:14px;align-items:center;margin-bottom:8px">
          ${hRing(Math.min(100,dosePct), r.clinHoursWk, 'hrs/wk')}
          <div><div style="font-size:13px"><b>${hLocPill(r.loc)}</b> · target ${r.clinTarget}h/wk</div>
          <div class="hint">${dosePct>=100?'On dose ✅':dosePct>=60?'Slightly under':'Under-dosed — coordinate with clinical'}</div></div>
        </div>`:'<p class="sub sans">Recovery housing only — no clinical hours target.</p>'}
        ${r.coordination&&r.coordination.length?`<div class="hint" style="margin-top:6px">Recent coordination notes:</div>`+r.coordination.filter(c=>c.note).slice(0,3).map(c=>`<div class="pc-note">📋 <b>${esc(c.date)}</b> · ${esc(c.note)}</div>`).join(''):''}
        <div class="toolbar no-print" style="margin-top:8px"><button class="btn btn-ghost btn-sm sans" onclick="openCoordForm(${r.id},'${esc(r.loc)}')">+ Log hours / note</button></div>
      </div>

      <div class="card">
        <h3>Drug screens</h3>
        ${r.screens&&r.screens.length?`<table class="tbl"><tbody>${r.screens.slice(0,6).map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.panel||'')}</td><td>${screenResultBadge(s.result)}</td><td class="hint">${s.observed?'observed':''}${s.substances?' · '+esc(s.substances):''}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">No screens logged.</div>'}
      </div>

      <div class="card">
        <h3>Ledger <span class="hint" style="font-weight:400">· balance ${r.balance>0?`<b style="color:var(--danger)">${money(r.balance)}</b>`:money(r.balance)}</span></h3>
        ${r.ledger&&r.ledger.length?`<table class="tbl"><tbody>${r.ledger.slice(0,6).map(l=>`<tr><td>${esc(l.date)}</td><td>${l.kind==='payment'?'✅ Payment':l.kind==='charge'?'Charge':'Adj'}</td><td>${l.kind==='payment'?'-':''}${money(l.amount)}</td><td class="hint">${esc(l.payer||'')}${l.memo?' · '+esc(l.memo):''}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">No transactions.</div>'}
      </div>

      <div class="card">
        <h3>Supports &amp; meetings</h3>
        ${r.supports&&r.supports.length?r.supports.slice(0,8).map(s=>`<div class="pc-note">${s.type==='meeting'?'🙏':s.type==='employment'?'💼':'🤝'} <b>${esc(s.date)}</b> · ${esc(s.type)}${s.detail?' — '+esc(s.detail):''}</div>`).join(''):'<div class="hint">None logged yet.</div>'}
      </div>

      <div class="card">
        <h3>Intake packet <span class="hint" style="font-weight:400">· ${r.packet.done}/${r.packet.total} complete</span></h3>
        <div style="display:flex;align-items:center;gap:10px;margin:6px 0 10px"><div class="dose ${r.packet.pct<100?'low':''}" style="flex:1"><span style="width:${r.packet.pct}%"></span></div><b>${r.packet.pct}%</b></div>
        ${(r.forms&&r.forms.length)?r.forms.filter(f=>f.status==='complete').slice(0,4).map(f=>`<div class="pc-note">✅ ${esc((HOUSING.formTemplates&&HOUSING.formTemplates.find(t=>t.type===f.type)||{}).name||f.type)}${f.signed_by?' · '+esc(f.signed_by):''}</div>`).join(''):''}
        <div class="toolbar no-print" style="margin-top:8px"><button class="btn btn-gold btn-sm sans" onclick="openPacket(${r.id})">${r.packet.pct<100?'Complete packet':'View packet'}</button></div>
      </div>

      <div class="card">
        <h3>Payment plan &amp; rent</h3>
        ${r.payplan?`<div class="kv"><span class="k">Weekly</span><span class="v">${money(r.payplan.weekly_amount)} · due ${esc(r.payplan.due_day||'—')}</span></div>
          <div class="kv"><span class="k">Funding</span><span class="v">${esc(r.payplan.source||'—')}</span></div>
          <div class="kv"><span class="k">Balance</span><span class="v">${r.balance>0?`<span style="color:var(--danger)">${money(r.balance)}</span>`:money(r.balance)}</span></div>
          ${r.payplan.arrangement?`<p class="hint" style="margin-top:8px">📝 ${esc(r.payplan.arrangement)}</p>`:''}`:'<div class="hint">No payment plan yet — set one so rent is a documented process.</div>'}
        ${(r.rentlog&&r.rentlog.length)?`<div class="hint" style="margin-top:8px">Recent weeks:</div>`+r.rentlog.slice(0,4).map(l=>`<div class="pc-note">${l.status==='Paid'?'✅':l.status==='Missed'?'❌':'•'} <b>${esc(l.week)}</b> · ${esc(l.status||'')}${l.collected?' · '+money(l.collected):''}${l.note?' — '+esc(l.note):''}</div>`).join(''):''}
        <div class="toolbar no-print" style="margin-top:8px"><button class="btn btn-ghost btn-sm sans" onclick="openPayplanForm(${r.id})">${r.payplan?'Edit plan':'Set plan'}</button></div>
      </div>

      <div class="card">
        <h3>Employment &amp; job search</h3>
        <div class="kv"><span class="k">Status</span><span class="v">${esc((r.employment&&r.employment.status)||'Not assessed')}</span></div>
        ${r.employment&&r.employment.employer?`<div class="kv"><span class="k">Employer</span><span class="v">${esc(r.employment.employer)}${r.employment.position?' · '+esc(r.employment.position):''}</span></div>`:''}
        ${r.employment&&r.employment.goal?`<div class="kv"><span class="k">Goal</span><span class="v" style="max-width:60%">${esc(r.employment.goal)}</span></div>`:''}
        <div class="kv"><span class="k">Job search this week</span><span class="v">${r.jobSearchWk||0}${r.employment&&r.employment.weekly_target?' / '+r.employment.weekly_target:''}</span></div>
        ${(r.jobsearch&&r.jobsearch.length)?r.jobsearch.slice(0,4).map(j=>`<div class="pc-note">💼 <b>${esc(j.date)}</b> · ${esc(j.activity)}${j.employer?' — '+esc(j.employer):''}${j.detail?' ('+esc(j.detail)+')':''}</div>`).join(''):'<div class="hint" style="margin-top:6px">No job-search steps logged.</div>'}
        <div class="toolbar no-print" style="margin-top:8px"><button class="btn btn-gold btn-sm sans" onclick="openJobSearchForm(${r.id})">+ Log step</button><button class="btn btn-ghost btn-sm sans" onclick="openEmploymentForm(${r.id})">Edit status</button></div>
      </div>
    </div>`;
}
function screenResultBadge(r){ const m={negative:'#2f7a4f',positive:'#c06a52',refused:'#c06a52',diluted:'#9a6a1f',pending:'#6f7a75'}; return `<span class="loc-pill" style="background:${m[r]||'#6f7a75'}">${esc(r)}</span>`; }

function openReccapForm(id){
  const dom=HOUSING.meta.reccapDomains;
  const cur=HOUSING.current&&HOUSING.current.capHistory&&HOUSING.current.capHistory.length?HOUSING.current.capHistory[HOUSING.current.capHistory.length-1].scores:{};
  const save=hmodal(`<h3>Recovery capital assessment</h3><p class="sub sans">Score each domain 0–10 with the resident — strengths-based, in their words.</p>
    ${dom.map(d=>{ const v=cur[d[0]]??5; return `<div class="rcdom"><div class="lab"><span title="${esc(d[2])}">${esc(d[1])}</span><b id="rcv_${d[0]}">${v}</b></div>
      <input type="range" min="0" max="10" value="${v}" oninput="document.getElementById('rcv_${d[0]}').textContent=this.value" data-dom="${d[0]}"/></div>`; }).join('')}
    <label>Note (optional)</label><textarea id="rc_note" rows="2"></textarea>`);
  save.onclick=async()=>{ const scores={}; document.querySelectorAll('#hModalBody input[type=range]').forEach(i=>scores[i.dataset.dom]=+i.value); try{ await api(`/housing/residents/${id}/reccap`,{method:'POST',body:JSON.stringify({scores,note:$('rc_note').value})}); closeHModal(); openResident(id); }catch(e){ alert(e.message); } };
}
function openSupportForm(id){
  const save=hmodal(`<h3>Log a support / meeting</h3>
    <div class="grid2"><div><label>Type</label><select id="sp_type"><option value="meeting">12-step / recovery meeting</option><option value="sponsor">Sponsor contact</option><option value="service">Service work</option><option value="employment">Employment / education</option><option value="family">Family</option></select></div>
    <div><label>Date</label><input id="sp_date" type="date" value="${today()}"/></div></div>
    <label>Detail</label><input id="sp_detail" placeholder="e.g. Tuesday Big Book"/>`);
  save.onclick=async()=>{ try{ await api(`/housing/residents/${id}/support`,{method:'POST',body:JSON.stringify({type:$('sp_type').value,date:$('sp_date').value,detail:$('sp_detail').value})}); closeHModal(); openResident(id); }catch(e){ alert(e.message); } };
}
function openCoordForm(id,loc){
  const save=hmodal(`<h3>Clinical coordination</h3><p class="sub sans">Log clinical hours and/or a coordination-of-care note with Armada clinical.</p>
    <div class="grid2"><div><label>Date</label><input id="co_date" type="date" value="${today()}"/></div>
    <div><label>Hours attended</label><input id="co_hours" type="number" step="0.5" value="0"/></div>
    <div><label>Program</label><input id="co_kind" value="${esc(loc||'')}"/></div></div>
    <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500"><input type="checkbox" id="co_roi" style="width:auto"/> ROI on file with clinical</label>
    <label>Coordination note</label><textarea id="co_note" rows="3" placeholder="Coordination with Armada clinical: attendance, progress, step-up/step-down recommendation…"></textarea>`);
  save.onclick=async()=>{ try{ await api('/housing/coordination',{method:'POST',body:JSON.stringify({resident_id:id,date:$('co_date').value,hours:+$('co_hours').value,kind:$('co_kind').value,note:$('co_note').value,with_clinical:1,roi:$('co_roi').checked?1:0})}); closeHModal(); openResident(id); }catch(e){ alert(e.message); } };
}
function openDischargeForm(id){
  const save=hmodal(`<h3>Discharge — the fond farewell</h3><p class="sub sans">Warm, no-shame, door always open. A warm goodbye is what makes someone call us again.</p>
    <div class="grid2"><div><label>Date</label><input id="dc_date" type="date" value="${today()}"/></div>
    <div><label>Disposition</label><select id="dc_type"><option>Completed — graduated</option><option>Transitioned to independent housing</option><option>Stepped up to higher care</option><option>Left against advice</option><option>Asked to leave (rule violation)</option><option>Return to use</option></select></div></div>
    <label>Farewell note</label><textarea id="dc_note" rows="3" placeholder="The door is always open…"></textarea>`);
  save.onclick=async()=>{ try{ await api(`/housing/residents/${id}/discharge`,{method:'POST',body:JSON.stringify({date:$('dc_date').value,type:$('dc_type').value,note:$('dc_note').value})}); closeHModal(); openResident(id); }catch(e){ alert(e.message); } };
}
// Quick fix for a flagged date of birth (from the import data-quality warning).
function fixDob(id){
  const r=HOUSING.current||{};
  const save=hmodal(`<h3>Correct date of birth</h3>
    <p class="sub sans" style="margin:.2em 0 1em">${esc(r.name||'Resident')} — current: <b>${esc(r.dob||'none')}</b>. ${esc((dobCheck(r.dob).msg)||'')}</p>
    <label>Date of birth</label><input id="fd_dob" type="date" value="${esc(r.dob||'')}"/>`);
  save.onclick=async()=>{ const dob=$('fd_dob').value; if(!dob){ alert('Pick a date.'); return; } try{ await api(`/housing/residents/${id}`,{method:'POST',body:JSON.stringify({dob})}); closeHModal(); openResident(id); }catch(e){ alert(e.message); } };
}
function openResidentEdit(id){
  const r=HOUSING.current||{};
  const save=hmodal(`<h3>Edit recovery plan</h3>
    <label>Goals</label><textarea id="re_goals" rows="2">${esc(r.goals||'')}</textarea>
    <div class="grid2">
      <div><label>Recovery coach</label><input id="re_coach" value="${esc(r.recovery_coach||'')}"/></div>
      <div><label>Sponsor</label><input id="re_sponsor" value="${esc(r.sponsor||'')}"/></div>
      <div><label>Home group</label><input id="re_home" value="${esc(r.home_group||'')}"/></div>
      <div><label>Employment</label><input id="re_emp" value="${esc(r.employment||'')}"/></div>
      <div><label>Education</label><input id="re_edu" value="${esc(r.education||'')}"/></div>
      <div><label>MAT</label><input id="re_mat" value="${esc(r.mat||'')}"/></div>
      <div><label>Phase (1–4)</label><input id="re_phase" type="number" min="1" max="4" value="${r.phase||1}"/></div>
      <div><label>Payer</label><input id="re_payer" value="${esc(r.payer||'')}"/></div>
    </div>`);
  save.onclick=async()=>{ const body={goals:$('re_goals').value,recovery_coach:$('re_coach').value,sponsor:$('re_sponsor').value,home_group:$('re_home').value,employment:$('re_emp').value,education:$('re_edu').value,mat:$('re_mat').value,phase:+$('re_phase').value,payer:$('re_payer').value}; try{ await api(`/housing/residents/${id}`,{method:'POST',body:JSON.stringify(body)}); closeHModal(); openResident(id); }catch(e){ alert(e.message); } };
}

/* ============================ DRUG SCREENING ============================ */
async function loadScreens(){
  let d; try{ d=await api('/housing/screens'); }catch(e){ $('screenDue').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('screenKpis').innerHTML=`
    <div class="ret-card"><div class="n">${d.stats.total}</div><div class="l">Screens logged</div></div>
    <div class="ret-card ${d.stats.positivityPct>0?'rc-warn':''}"><div class="n">${d.stats.positivityPct}%</div><div class="l">Positivity rate</div></div>
    <div class="ret-card ${d.stats.refused?'rc-high':''}"><div class="n">${d.stats.refused}</div><div class="l">Refused</div></div>
    <div class="ret-card ${d.due.length?'rc-warn':''}"><div class="n">${d.due.length}</div><div class="l">Due now</div></div>`;
  $('screenDue').innerHTML = d.due.length ? d.due.map(r=>`<div class="cmd-row"><div class="cmd-row-main"><b>${esc(r.name)}</b> <span class="hint">· ${esc(r.house||'')} · last ${r.last?esc(r.last):'never'}</span></div><button class="btn btn-gold btn-sm sans" onclick="openScreenForm(${r.id})">Screen</button></div>`).join('') : '<div class="hint">Everyone screened within the last week. ✅</div>';
  $('screenRecent').innerHTML = d.recent.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Resident</th><th>Panel</th><th>Result</th><th>Detail</th></tr></thead><tbody>${d.recent.map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.resident_name)}</td><td>${esc(s.panel||'')}</td><td>${screenResultBadge(s.result)}</td><td class="hint">${s.observed?'observed ':''}${s.substances?esc(s.substances):''}${s.scheduled?' · random':''}</td></tr>`).join('')}</tbody></table>` : '<div class="hint">No results yet.</div>';
}
async function randomScreens(){
  const n=+$('randN').value||3;
  try{ const {picked}=await api('/housing/screens/random',{method:'POST',body:JSON.stringify({n})});
    $('randPicked').innerHTML = picked.length?`<div class="card" style="margin-top:12px;border-left:3px solid var(--gold)"><h3>🎲 Randomly selected — screen these ${picked.length}</h3>${picked.map(r=>`<div class="cmd-row"><div class="cmd-row-main"><b>${esc(r.name)}</b> <span class="hint">· last ${r.last?esc(r.last):'never'}</span></div><button class="btn btn-gold btn-sm sans" onclick="openScreenForm(${r.id})">Log result</button></div>`).join('')}</div>`:'<div class="hint">No one to select.</div>';
  }catch(e){ alert(e.message); }
}
async function openScreenForm(presetId){
  const residents = await api('/housing/residents?status=active');
  const opts = residents.map(r=>`<option value="${r.id}" ${r.id===presetId?'selected':''}>${esc(r.name)}</option>`).join('');
  const save=hmodal(`<h3>Log a drug/alcohol screen</h3>
    <label>Resident</label><select id="sc_res">${opts}</select>
    <div class="grid2">
      <div><label>Date</label><input id="sc_date" type="date" value="${today()}"/></div>
      <div><label>Panel</label><select id="sc_panel"><option>12-panel</option><option>10-panel</option><option>5-panel</option><option>Breathalyzer</option><option>EtG</option></select></div>
      <div><label>Result</label><select id="sc_result"><option value="negative">Negative</option><option value="positive">Positive</option><option value="refused">Refused</option><option value="diluted">Diluted</option><option value="pending">Pending (sent to lab)</option></select></div>
      <div><label>Substances (if positive)</label><input id="sc_subs"/></div>
    </div>
    <div style="display:flex;gap:18px;margin-top:8px"><label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500"><input type="checkbox" id="sc_obs" style="width:auto"/> Observed</label>
    <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500"><input type="checkbox" id="sc_rand" checked style="width:auto"/> Random/scheduled</label></div>`);
  save.onclick=async()=>{ try{ await api('/housing/screens',{method:'POST',body:JSON.stringify({resident_id:+$('sc_res').value,date:$('sc_date').value,panel:$('sc_panel').value,result:$('sc_result').value,substances:$('sc_subs').value,observed:$('sc_obs').checked?1:0,scheduled:$('sc_rand').checked?1:0})}); closeHModal(); if($('screens').classList.contains('active'))loadScreens(); else if(HOUSING.current)openResident(HOUSING.current.id); }catch(e){ alert(e.message); } };
}

/* ============================ HOUSE LIFE ============================ */
async function loadHouseLife(){
  if(!HOUSING.houses.length){ try{ HOUSING.houses=await api('/housing/houses'); }catch(e){} }
  const sel=$('hlHouse');
  if(sel && !sel.options.length){ sel.innerHTML=HOUSING.houses.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join(''); }
  if($('hlDate') && !$('hlDate').value) $('hlDate').value=today();
  const houseId=sel?sel.value:(HOUSING.houses[0]&&HOUSING.houses[0].id);
  const date=$('hlDate')?$('hlDate').value:today();
  if(!houseId){ $('houseLifeBody').innerHTML='<div class="empty">Add a house first.</div>'; return; }
  let d; try{ d=await api(`/housing/houselife?house_id=${houseId}&date=${date}`); }catch(e){ $('houseLifeBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  if(!d.residents.length){ $('houseLifeBody').innerHTML='<div class="empty">No active residents in this house.</div>'; return; }
  $('houseLifeBody').innerHTML=`<table class="tbl"><thead><tr><th>Resident</th><th>Bed</th><th>Curfew / bed check</th><th>Chore</th><th>Meeting today</th></tr></thead><tbody>${d.residents.map(r=>{
    const cs=r.curfew?r.curfew.status:null;
    const curfewBtns=['in','late','pass','absent'].map(s=>`<button class="btn btn-sm sans ${cs===s?(s==='in'?'btn-gold':'btn-danger'):'btn-ghost'}" onclick="setCurfew(${r.id},${houseId},'${s}')" style="padding:4px 9px">${s==='in'?'✓ In':s[0].toUpperCase()+s.slice(1)}</button>`).join(' ');
    const choreDone=r.chore&&r.chore.done;
    return `<tr>
      <td><b>${esc(r.name)}</b></td>
      <td class="hint">${esc(r.bed||'—')}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">${curfewBtns}</div></td>
      <td><button class="btn btn-sm sans ${choreDone?'btn-gold':'btn-ghost'}" onclick="toggleChore(${r.id},${houseId},${choreDone?0:1})">${choreDone?'✓ Done':'Mark chore done'}</button></td>
      <td>${r.meeting?'🙏 '+r.meeting:'<span class="hint">—</span>'} <button class="btn btn-ghost btn-sm sans" onclick="openSupportForm(${r.id})" style="padding:3px 8px">+</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}
async function setCurfew(rid,houseId,status){ try{ await api('/housing/curfew',{method:'POST',body:JSON.stringify({resident_id:rid,house_id:houseId,status,date:$('hlDate').value})}); loadHouseLife(); }catch(e){ alert(e.message); } }
async function toggleChore(rid,houseId,done){ try{ await api('/housing/chore',{method:'POST',body:JSON.stringify({resident_id:rid,house_id:houseId,done,date:$('hlDate').value})}); loadHouseLife(); }catch(e){ alert(e.message); } }

/* ============================ CLINICAL COORDINATION ============================ */
async function loadCoordination(){
  await hMeta();
  if($('coordWeek') && !$('coordWeek').value) $('coordWeek').value=today();
  let d; try{ d=await api('/housing/coordination?week='+($('coordWeek')?$('coordWeek').value:today())); }catch(e){ $('coordBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const onDose=d.rows.filter(r=>r.pct>=100).length;
  const under=d.rows.filter(r=>r.pct<60).length;
  const noRoi=d.rows.filter(r=>!r.roi).length;
  $('coordKpis').innerHTML=`
    <div class="ret-card"><div class="n">${d.rows.length}</div><div class="l">In clinical care</div></div>
    <div class="ret-card"><div class="n">${onDose}</div><div class="l">On full dose</div></div>
    <div class="ret-card ${under?'rc-high':''}"><div class="n">${under}</div><div class="l">Under-dosed</div></div>
    <div class="ret-card ${noRoi?'rc-warn':''}"><div class="n">${noRoi}</div><div class="l">No ROI on file</div></div>`;
  $('coordBody').innerHTML=`<table class="tbl"><thead><tr><th>Resident</th><th>House</th><th>LOC</th><th>This week</th><th>Dose</th><th>ROI</th><th>Last coordination note</th><th></th></tr></thead><tbody>${d.rows.map(r=>`
    <tr>
      <td><b style="cursor:pointer" onclick="openResident(${r.id})">${esc(r.name)}</b></td>
      <td class="hint">${esc(r.house)}</td>
      <td>${hLocPill(r.loc)}</td>
      <td><b>${r.hours}</b>/${r.target}h</td>
      <td><div class="dose ${r.pct<60?'low':''}" style="width:90px"><span style="width:${Math.min(100,r.pct)}%"></span></div></td>
      <td>${r.roi?'✅':'<span style="color:var(--danger)">missing</span>'}</td>
      <td class="hint" style="max-width:260px">${r.lastCoc?esc(r.lastCoc.date)+' — '+esc(r.lastCoc.note):'—'}</td>
      <td><button class="btn btn-ghost btn-sm sans" onclick="openCoordForm(${r.id},'${esc(r.loc)}')">+ Log</button></td>
    </tr>`).join('')}</tbody></table>`;
}

/* ============================ LEDGER ============================ */
async function loadLedger(){
  let d; try{ d=await api('/housing/ledger'); }catch(e){ $('ledgerResidents').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('ledgerKpis').innerHTML=`
    <div class="ret-card"><div class="n">${money(d.stats.totalCharged)}</div><div class="l">Total charged</div></div>
    <div class="ret-card"><div class="n">${money(d.stats.totalPaid)}</div><div class="l">Total collected</div></div>
    <div class="ret-card ${d.stats.outstanding>0?'rc-warn':''}"><div class="n">${money(d.stats.outstanding)}</div><div class="l">Outstanding</div></div>
    <div class="ret-card"><div class="n">${d.stats.totalCharged?Math.round(d.stats.totalPaid/d.stats.totalCharged*100):0}%</div><div class="l">Collection rate</div></div>`;
  $('ledgerResidents').innerHTML = d.residents.length?`<table class="tbl"><tbody>${d.residents.map(r=>`<tr style="cursor:pointer" onclick="openLedgerForm(${r.id})"><td><b>${esc(r.name)}</b> <span class="hint">· ${esc(r.house||'')}</span></td><td class="hint">${esc(r.payer||'')}</td><td style="text-align:right">${r.balance>0?`<b style="color:var(--danger)">${money(r.balance)}</b>`:money(r.balance)}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">No residents.</div>';
  $('ledgerPayer').innerHTML = d.byPayer.length?d.byPayer.map(p=>{ const pct=p.charged?Math.round(p.paid/p.charged*100):0; return `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(p.payer||'Unspecified')}</span><b>${money(p.paid)} / ${money(p.charged)}</b></div><div class="dose ${pct<70?'low':''}"><span style="width:${pct}%"></span></div></div>`; }).join(''):'<div class="hint">No data.</div>';
  $('ledgerRecent').innerHTML = d.recent.length?`<table class="tbl"><thead><tr><th>Date</th><th>Resident</th><th>Type</th><th>Amount</th><th>Payer / memo</th></tr></thead><tbody>${d.recent.map(l=>`<tr><td>${esc(l.date)}</td><td>${esc(l.resident_name)}</td><td>${l.kind==='payment'?'✅ Payment':l.kind==='charge'?'Charge':'Adjustment'}</td><td>${l.kind==='payment'?'-':''}${money(l.amount)}</td><td class="hint">${esc(l.payer||'')}${l.memo?' · '+esc(l.memo):''}</td></tr>`).join('')}</tbody></table>`:'<div class="hint">No transactions.</div>';
}
async function openLedgerForm(presetId){
  const residents=await api('/housing/residents?status=active');
  const opts=residents.map(r=>`<option value="${r.id}" ${r.id===presetId?'selected':''}>${esc(r.name)}</option>`).join('');
  const save=hmodal(`<h3>Charge or payment</h3>
    <label>Resident</label><select id="lg_res">${opts}</select>
    <div class="grid2">
      <div><label>Type</label><select id="lg_kind"><option value="charge">Charge (bed fee)</option><option value="payment">Payment received</option><option value="adjustment">Adjustment / scholarship</option></select></div>
      <div><label>Amount ($)</label><input id="lg_amt" type="number" step="1" value="175"/></div>
      <div><label>Date</label><input id="lg_date" type="date" value="${today()}"/></div>
      <div><label>Payer</label><input id="lg_payer" placeholder="Self-pay / SOR / Medicaid"/></div>
    </div>
    <label>Memo</label><input id="lg_memo" placeholder="Weekly bed fee"/>`);
  save.onclick=async()=>{ try{ await api('/housing/ledger',{method:'POST',body:JSON.stringify({resident_id:+$('lg_res').value,kind:$('lg_kind').value,amount:+$('lg_amt').value,date:$('lg_date').value,payer:$('lg_payer').value,memo:$('lg_memo').value})}); closeHModal(); if($('ledger').classList.contains('active'))loadLedger(); else if(HOUSING.current)openResident(HOUSING.current.id); }catch(e){ alert(e.message); } };
}

/* ============================ ORH COMPLIANCE ============================ */
async function loadOrh(){
  let d; try{ d=await api('/housing/orh'); }catch(e){ $('orhMatrix').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  HOUSING.orh=d;
  const avg=d.houses.length?Math.round(d.houses.reduce((a,h)=>a+(d.statusByHouse[h.id]?.pct||0),0)/d.houses.length):0;
  const gaps=d.houses.reduce((a,h)=>{const s=d.statusByHouse[h.id]; return a+(s?s.total-s.met-s.partial:0);},0);
  $('orhKpis').innerHTML=`
    <div class="ret-card ${avg>=90?'':'rc-warn'}"><div class="n">${avg}%</div><div class="l">Avg compliance</div></div>
    <div class="ret-card"><div class="n">${d.houses.length}</div><div class="l">Certified houses</div></div>
    <div class="ret-card ${gaps?'rc-high':''}"><div class="n">${gaps}</div><div class="l">Open gaps</div></div>
    <div class="ret-card ${d.grievances.filter(g=>g.status==='open').length?'rc-warn':''}"><div class="n">${d.grievances.filter(g=>g.status==='open').length}</div><div class="l">Open grievances</div></div>`;
  // matrix grouped by domain
  const domains={admin:'Administrative & Operational',recovery:'Recovery Support',physical:'Physical Environment',neighbor:'Good Neighbor'};
  let html=`<table class="orh-matrix"><thead><tr><th style="min-width:280px">Standard</th>${d.houses.map(h=>`<th>${esc(h.name)}<br><span class="hint">${hLvl(h.level)} · ${d.statusByHouse[h.id]?.pct||0}%</span></th>`).join('')}</tr></thead><tbody>`;
  Object.keys(domains).forEach(dom=>{
    html+=`<tr><td colspan="${d.houses.length+1}" style="background:rgba(35,80,86,.05);font-weight:700;color:var(--navy);font-size:12px;text-transform:uppercase;letter-spacing:.5px">${domains[dom]}</td></tr>`;
    d.standards.filter(s=>s[0]===dom).forEach(s=>{
      html+=`<tr><td><b>${s[1]}</b> ${esc(s[2])} ${s[3]===3?'<span class="lvl lvl-l3" style="font-size:9px">L3</span>':''}</td>`;
      d.houses.forEach(h=>{
        const level=h.level==='L3'?3:2;
        if(s[3]>level){ html+=`<td class="hint" style="text-align:center">n/a</td>`; return; }
        const st=(d.statusByHouse[h.id]?.map[s[1]]?.status)||'gap';
        html+=`<td><div class="orh-cell orh-${st}" onclick="cycleOrh(${h.id},'${s[1]}','${st}')" title="Click to change">${st}</div></td>`;
      });
      html+=`</tr>`;
    });
  });
  html+=`</tbody></table>`;
  $('orhMatrix').innerHTML=html;
  $('orhInspections').innerHTML=d.inspections.length?d.inspections.map(i=>`<div class="cmd-row"><div class="cmd-row-main"><b>${esc(i.house_name)}</b> · ${esc(i.type)} <span class="hint">${esc(i.date)}</span><div class="hint">${esc(i.note||'')}</div></div><span class="loc-pill" style="background:${i.result==='Pass'?'#2f7a4f':'#c06a52'}">${esc(i.result)}</span></div>`).join(''):'<div class="hint">No inspections logged.</div>';
  $('orhGrievances').innerHTML=d.grievances.length?d.grievances.map(g=>`<div class="cmd-row"><div class="cmd-row-main">${esc(g.summary)} <span class="hint">· ${esc(g.house_name||'')} · ${esc(g.date)}</span>${g.resolution?`<div class="hint">✅ ${esc(g.resolution)}</div>`:''}</div>${g.status==='open'?`<button class="btn btn-gold btn-sm sans" onclick="resolveGrievance(${g.id})">Resolve</button>`:'<span class="chip">resolved</span>'}</div>`).join(''):'<div class="hint">No grievances — or none logged.</div>';
}
async function cycleOrh(houseId,code,cur){
  if(!isAdmin()){ alert('Only admins can update certification status.'); return; }
  const next={gap:'partial',partial:'met',met:'gap'}[cur]||'partial';
  try{ await api('/housing/orh/status',{method:'POST',body:JSON.stringify({house_id:houseId,code,status:next})}); loadOrh(); }catch(e){ alert(e.message); }
}
async function openInspectionForm(){
  if(!HOUSING.orh){ await loadOrh(); }
  const opts=HOUSING.orh.houses.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const save=hmodal(`<h3>Log an inspection</h3>
    <label>House</label><select id="in_house">${opts}</select>
    <div class="grid2"><div><label>Type</label><select id="in_type"><option>Fire & safety</option><option>House walkthrough</option><option>Health/sanitation</option><option>ORH re-certification</option></select></div>
    <div><label>Result</label><select id="in_result"><option>Pass</option><option>Pass with corrections</option><option>Fail</option></select></div>
    <div><label>Date</label><input id="in_date" type="date" value="${today()}"/></div></div>
    <label>Note</label><textarea id="in_note" rows="2"></textarea>`);
  save.onclick=async()=>{ try{ await api('/housing/inspections',{method:'POST',body:JSON.stringify({house_id:+$('in_house').value,type:$('in_type').value,result:$('in_result').value,date:$('in_date').value,note:$('in_note').value})}); closeHModal(); loadOrh(); }catch(e){ alert(e.message); } };
}
async function openGrievanceForm(){
  if(!HOUSING.orh){ await loadOrh(); }
  const opts=HOUSING.orh.houses.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const save=hmodal(`<h3>Log a grievance</h3><p class="sub sans">A complaint is a gift — capture it, resolve it, fix the system.</p>
    <label>House</label><select id="gr_house">${opts}</select>
    <label>Summary</label><textarea id="gr_sum" rows="3"></textarea>`);
  save.onclick=async()=>{ try{ await api('/housing/grievances',{method:'POST',body:JSON.stringify({house_id:+$('gr_house').value,summary:$('gr_sum').value})}); closeHModal(); loadOrh(); }catch(e){ alert(e.message); } };
}
async function resolveGrievance(id){ const resolution=prompt('How was it resolved?'); if(resolution===null) return; try{ await api('/housing/grievances',{method:'POST',body:JSON.stringify({id,status:'resolved',resolution})}); loadOrh(); }catch(e){ alert(e.message); } }

/* ============================ OUTCOMES ============================ */
async function loadHousingOutcomes(){
  let d; try{ d=await api('/housing/outcomes'); }catch(e){ $('hoKpis').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('hoKpis').innerHTML=`
    <div class="ret-card"><div class="n">${d.avgLos}</div><div class="l">Avg length of stay (days)</div></div>
    <div class="ret-card"><div class="n">${d.active}</div><div class="l">Active residents</div></div>
    <div class="ret-card"><div class="n">${d.emplRate}%</div><div class="l">Employed / in school</div></div>
    <div class="ret-card ${d.reccap.delta>0?'':''}"><div class="n">${d.reccap.delta!=null?(d.reccap.delta>=0?'+':'')+d.reccap.delta:'—'}</div><div class="l">Recovery capital growth</div></div>
    <div class="ret-card ${d.returns?'rc-high':''}"><div class="n">${d.returns}</div><div class="l">Returns to use (all time)</div></div>
    <div class="ret-card"><div class="n">${d.discharged}</div><div class="l">Alumni</div></div>`;
  const ret=d.retention;
  $('hoRetention').innerHTML=[['30-day',ret.d30],['90-day',ret.d90],['180-day',ret.d180]].map(([l,v])=>`<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span>${l} retention</span><b>${v==null?'—':v+'%'}</b></div><div class="dose ${v!=null&&v<70?'low':''}"><span style="width:${v||0}%"></span></div></div>`).join('');
  $('hoReccap').innerHTML = d.reccap.first!=null?`<div style="display:flex;gap:16px;align-items:center">${hRing(Math.round((d.reccap.last||0)*10), d.reccap.last, 'now')}<div><div class="hint">Intake average</div><div style="font-size:20px;font-family:var(--serif);color:var(--navy)">${d.reccap.first} → ${d.reccap.last}</div><div class="hint">${d.reccap.delta>=0?'Growing':'Declining'} by ${Math.abs(d.reccap.delta)} on average</div></div></div>`:'<div class="hint">Not enough assessments yet.</div>';
  const dispo=Object.entries(d.dispo);
  $('hoDispo').innerHTML = dispo.length?dispo.map(([k,v])=>`<div class="cmd-row"><div class="cmd-row-main">${esc(k)}</div><b>${v}</b></div>`).join(''):'<div class="hint">No discharges yet — every warm farewell is a future admission.</div>';
}

/* ============================ INTAKE & FORMS ============================ */
async function hFormTemplates(){ if(!HOUSING.formTemplates){ try{ HOUSING.formTemplates=(await api('/housing/forms/templates')).templates; }catch(e){ HOUSING.formTemplates=[]; } } return HOUSING.formTemplates; }
async function loadIntake(){
  await hFormTemplates();
  let d; try{ d=await api('/housing/intake'); }catch(e){ $('intakeRoster').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('intakeRoster').innerHTML = d.residents.length?`<table class="tbl"><thead><tr><th>Resident</th><th>House</th><th>Status</th><th>Moved in</th><th>Intake packet</th><th></th></tr></thead><tbody>${d.residents.map(r=>`
    <tr><td><b>${esc(r.name)}</b></td><td class="hint">${esc(r.house||'')}</td><td>${esc(r.status)}</td><td class="hint">${esc(r.move_in||'')}</td>
      <td style="min-width:160px"><div style="display:flex;align-items:center;gap:8px"><div class="dose ${r.packet.pct<100?'low':''}" style="flex:1"><span style="width:${r.packet.pct}%"></span></div><b>${r.packet.done}/${r.packet.total}</b></div></td>
      <td><button class="btn ${r.packet.pct<100?'btn-gold':'btn-ghost'} btn-sm sans" onclick="openPacket(${r.id})">${r.packet.pct<100?'Complete packet':'View packet'}</button></td>
    </tr>`).join('')}</tbody></table>`:'<div class="empty">No residents in intake.</div>';
  $('intakePacket').innerHTML='';
}
async function openPacket(rid){
  await hFormTemplates();
  let r; try{ r=await api('/housing/residents/'+rid); }catch(e){ alert(e.message); return; }
  HOUSING.current=r;
  const byType={}; (r.forms||[]).forEach(f=>byType[f.type]=f);
  const cats={};
  HOUSING.formTemplates.forEach(t=>{ (cats[t.cat]=cats[t.cat]||[]).push(t); });
  const sec = Object.keys(cats).map(cat=>`<h3 style="margin:14px 0 6px">${esc(cat)}</h3>${cats[cat].map(t=>{
    const f=byType[t.type]; const done=f&&f.status==='complete';
    return `<div class="cmd-row">
      <div class="cmd-row-main"><b>${esc(t.name)}</b> ${t.orh?`<span class="chip">ORH ${esc(t.orh)}</span>`:''} ${t.sign?'<span class="hint">· e-signature</span>':''}
        ${done?`<div class="hint">✅ ${f.signed_by?'signed by '+esc(f.signed_by)+' · ':''}${esc(f.signed_date||f.updated||'')}</div>`:'<div class="hint">Not completed</div>'}</div>
      <button class="btn ${done?'btn-ghost':'btn-gold'} btn-sm sans" onclick="openFormModal(${rid},'${t.type}')">${done?'View / edit':(t.sign?'Fill & sign':'Fill')}</button>
    </div>`;
  }).join('')}`).join('');
  $('intakePacket').innerHTML = `<div class="card">
    <div class="cmd-hero-row"><div><h3>📋 ${esc(r.name)} — intake packet <span class="hint" style="font-weight:400">· ${r.packet.done}/${r.packet.total} complete</span></h3></div>
      <button class="btn btn-ghost btn-sm sans" onclick="openResident(${rid})">Open Resident 360 →</button></div>
    ${sec}</div>`;
  $('intakePacket').scrollIntoView({behavior:'smooth',block:'start'});
}
async function openFormModal(rid,type){
  await hFormTemplates();
  const t=HOUSING.formTemplates.find(x=>x.type===type); if(!t) return;
  let existing={}; let signedBy='';
  try{ const r=HOUSING.current&&HOUSING.current.id===rid?HOUSING.current:await api('/housing/residents/'+rid); const f=(r.forms||[]).find(x=>x.type===type); if(f){ existing=f.data||{}; signedBy=f.signed_by||''; } }catch(e){}
  const field=(fl)=>{
    const v=existing[fl.k]; const id='ff_'+fl.k;
    if(fl.t==='textarea') return `<label>${esc(fl.l)}</label><textarea id="${id}" rows="2">${esc(v||'')}</textarea>`;
    if(fl.t==='check') return `<label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;margin-top:10px"><input type="checkbox" id="${id}" ${v?'checked':''} style="width:auto"/> ${esc(fl.l)}</label>`;
    if(fl.t==='select') return `<label>${esc(fl.l)}</label><select id="${id}">${fl.o.map(o=>`<option ${v===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
    return `<label>${esc(fl.l)}</label><input id="${id}" type="${fl.t==='number'?'number':fl.t==='date'?'date':'text'}" value="${esc(v||'')}"/>`;
  };
  const sign = t.sign?`<hr><label>Resident signature (type full name)</label><input id="ff_sig" value="${esc(signedBy)}" placeholder="Full legal name"/>
    <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;margin-top:8px"><input type="checkbox" id="ff_signed" style="width:auto"/> Resident has reviewed and agrees to this document (${new Date().toLocaleDateString()})</label>`:'';
  const save=hmodal(`<h3>${esc(t.name)}</h3>${t.orh?`<p class="sub sans">Maps to ORH/NARR standard ${esc(t.orh)}.</p>`:''}${t.fields.map(field).join('')}${sign}`);
  save.onclick=async()=>{
    const data={}; t.fields.forEach(fl=>{ const el=$('ff_'+fl.k); if(!el) return; data[fl.k]=fl.t==='check'?el.checked:el.value; });
    const doSign=t.sign?$('ff_signed').checked:true;
    if(t.sign && doSign && !$('ff_sig').value.trim()){ alert('Type the resident signature to complete.'); return; }
    try{ await api(`/housing/residents/${rid}/forms`,{method:'POST',body:JSON.stringify({type,data,sign:doSign,signed_by:t.sign?$('ff_sig').value:null})}); closeHModal();
      if($('intake').classList.contains('active')){ openPacket(rid); loadIntake(); } else if(HOUSING.current){ openResident(rid); }
    }catch(e){ alert(e.message); }
  };
}

/* ============================ EMPLOYMENT & JOB SEARCH ============================ */
async function loadEmployment(){
  let d; try{ d=await api('/housing/employment'); }catch(e){ $('empBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('empKpis').innerHTML=`
    <div class="ret-card"><div class="n">${d.stats.employed}</div><div class="l">Employed / in school</div></div>
    <div class="ret-card"><div class="n">${d.stats.total?Math.round(d.stats.employed/d.stats.total*100):0}%</div><div class="l">Employment rate</div></div>
    <div class="ret-card ${d.stats.seeking?'rc-warn':''}"><div class="n">${d.stats.seeking}</div><div class="l">Actively seeking</div></div>
    <div class="ret-card ${d.stats.behind?'rc-high':''}"><div class="n">${d.stats.behind}</div><div class="l">Behind on job search</div></div>`;
  $('empBody').innerHTML=`<table class="tbl"><thead><tr><th>Resident</th><th>House</th><th>Status</th><th>Employer / goal</th><th>Job search this week</th><th>Last step</th><th></th></tr></thead><tbody>${d.rows.map(r=>{
    const pct=r.target?Math.round(r.jobSearchWk/r.target*100):100;
    return `<tr>
      <td><b style="cursor:pointer" onclick="openResident(${r.id})">${esc(r.name)}</b></td>
      <td class="hint">${esc(r.house)}</td>
      <td>${esc(r.status)}</td>
      <td>${esc(r.employer||'')}${r.goal?`<div class="hint">🎯 ${esc(r.goal)}</div>`:''}</td>
      <td>${r.seeking?`<div style="display:flex;align-items:center;gap:8px"><div class="dose ${pct<100?'low':''}" style="width:70px"><span style="width:${Math.min(100,pct)}%"></span></div><span class="hint">${r.jobSearchWk}/${r.target}</span></div>`:'<span class="hint">—</span>'}</td>
      <td class="hint">${r.lastActivity?esc(r.lastActivity.date)+' · '+esc(r.lastActivity.activity):'—'}</td>
      <td style="white-space:nowrap"><button class="btn btn-gold btn-sm sans" onclick="openJobSearchForm(${r.id})">+ Step</button> <button class="btn btn-ghost btn-sm sans" onclick="openEmploymentForm(${r.id})">Edit</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}
function openEmploymentForm(rid){
  const e=(HOUSING.current&&HOUSING.current.id===rid&&HOUSING.current.employment)||{};
  const stat=['Employed — full-time','Employed — part-time','Self-employed','Unemployed — actively seeking','In school / training','Unable to work (disability)','Not seeking — early recovery'];
  const save=hmodal(`<h3>Employment status &amp; goal</h3>
    <label>Status</label><select id="ef_status">${stat.map(s=>`<option ${e.status===s?'selected':''}>${esc(s)}</option>`).join('')}</select>
    <div class="grid2"><div><label>Employer</label><input id="ef_employer" value="${esc(e.employer||'')}"/></div>
    <div><label>Position</label><input id="ef_pos" value="${esc(e.position||'')}"/></div>
    <div><label>Wage</label><input id="ef_wage" value="${esc(e.wage||'')}" placeholder="$15/hr"/></div>
    <div><label>Hours/wk</label><input id="ef_hours" value="${esc(e.hours||'')}"/></div>
    <div><label>Weekly job-search target</label><input id="ef_target" type="number" value="${e.weekly_target??5}"/></div></div>
    <label>Employment goal &amp; plan</label><textarea id="ef_goal" rows="2" placeholder="What's the next step, and how will they get there?">${esc(e.goal||'')}</textarea>`);
  save.onclick=async()=>{ try{ await api(`/housing/residents/${rid}/employment`,{method:'POST',body:JSON.stringify({status:$('ef_status').value,employer:$('ef_employer').value,position:$('ef_pos').value,wage:$('ef_wage').value,hours:$('ef_hours').value,weekly_target:+$('ef_target').value,goal:$('ef_goal').value})}); closeHModal(); if($('employment').classList.contains('active'))loadEmployment(); else if(HOUSING.current)openResident(rid); }catch(e){ alert(e.message); } };
}
function openJobSearchForm(rid){
  const acts=['Application submitted','Interview','Resume / cover letter','Job fair / agency','Follow-up call','Offer received','Hired','Lost / left job','Orientation / first day'];
  const save=hmodal(`<h3>Log a job-search step</h3>
    <div class="grid2"><div><label>Activity</label><select id="js_act">${acts.map(a=>`<option>${esc(a)}</option>`).join('')}</select></div>
    <div><label>Date</label><input id="js_date" type="date" value="${today()}"/></div></div>
    <label>Employer / where</label><input id="js_emp"/>
    <label>Detail / outcome</label><input id="js_detail"/>`);
  save.onclick=async()=>{ try{ await api(`/housing/residents/${rid}/jobsearch`,{method:'POST',body:JSON.stringify({activity:$('js_act').value,date:$('js_date').value,employer:$('js_emp').value,detail:$('js_detail').value})}); closeHModal(); if($('employment').classList.contains('active'))loadEmployment(); else if(HOUSING.current)openResident(rid); }catch(e){ alert(e.message); } };
}

/* ============================ RENT RUN ============================ */
async function loadRentRun(){
  if($('rrWeek') && !$('rrWeek').value) $('rrWeek').value=today();
  let d; try{ d=await api('/housing/rentrun?week='+($('rrWeek')?$('rrWeek').value:today())); }catch(e){ $('rrBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const collPct=d.stats.expected?Math.round(d.stats.collected/d.stats.expected*100):0;
  $('rrKpis').innerHTML=`
    <div class="ret-card"><div class="n">${money(d.stats.expected)}</div><div class="l">Expected this week</div></div>
    <div class="ret-card"><div class="n">${money(d.stats.collected)}</div><div class="l">Collected · ${collPct}%</div></div>
    <div class="ret-card ${d.stats.worked<d.stats.total?'rc-warn':''}"><div class="n">${d.stats.worked}/${d.stats.total}</div><div class="l">Residents worked</div></div>
    <div class="ret-card ${d.stats.noPlan?'rc-high':''}"><div class="n">${d.stats.noPlan}</div><div class="l">No payment plan</div></div>`;
  const stOpts=['','Paid','Partial','Promise to pay','Scholarship covered','Waived','Missed'];
  $('rrBody').innerHTML=`<table class="tbl"><thead><tr><th>Resident</th><th>House</th><th>Plan</th><th>Due</th><th>Status</th><th>Collected</th><th>Note</th><th></th></tr></thead><tbody>${d.rows.map(r=>{
    const log=r.log||{};
    return `<tr ${log.status?'style="background:rgba(47,122,79,.04)"':''}>
      <td><b style="cursor:pointer" onclick="openResident(${r.id})">${esc(r.name)}</b></td>
      <td class="hint">${esc(r.house)}</td>
      <td>${r.hasPlan?`<span class="hint" title="${esc(r.arrangement)}">${money(r.due)}/wk · ${esc(r.dueDay||'')}</span>`:`<button class="btn btn-danger btn-sm sans" onclick="openPayplanForm(${r.id})">Set plan</button>`}</td>
      <td><b>${money(r.due)}</b></td>
      <td><select id="rr_status_${r.id}" style="width:auto;padding:6px 8px">${stOpts.map(s=>`<option ${log.status===s?'selected':''}>${esc(s)}</option>`).join('')}</select></td>
      <td><input id="rr_amt_${r.id}" type="number" value="${log.collected!=null?log.collected:''}" placeholder="${r.due}" style="width:90px;padding:6px 8px"/></td>
      <td><input id="rr_note_${r.id}" value="${esc(log.note||'')}" placeholder="promise date, etc." style="min-width:140px;padding:6px 8px"/></td>
      <td><button class="btn btn-gold btn-sm sans" onclick="recordRent(${r.id},${r.due})">Save</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}
async function recordRent(rid,due){
  const status=$('rr_status_'+rid).value; const collected=+($('rr_amt_'+rid).value||0); const note=$('rr_note_'+rid).value;
  if(!status){ alert('Pick a status.'); return; }
  try{ await api('/housing/rentrun',{method:'POST',body:JSON.stringify({resident_id:rid,week:$('rrWeek').value,due,collected,status,note})}); loadRentRun(); }catch(e){ alert(e.message); }
}
function openPayplanForm(rid){
  const p=(HOUSING.current&&HOUSING.current.id===rid&&HOUSING.current.payplan)||{};
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const srcs=['Self-pay (employment)','SOR / STAR scholarship','Family support','Medicaid (clinical)','Mixed / see plan'];
  const save=hmodal(`<h3>Payment plan</h3><p class="sub sans">How &amp; when this resident pays each week — documented and agreed.</p>
    <div class="grid2"><div><label>Weekly amount ($)</label><input id="pp_amt" type="number" value="${p.weekly_amount||175}"/></div>
    <div><label>Due day</label><select id="pp_day">${days.map(dd=>`<option ${p.due_day===dd?'selected':''}>${esc(dd)}</option>`).join('')}</select></div>
    <div><label>Funding source</label><select id="pp_src">${srcs.map(s=>`<option ${p.source===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
    <div><label>Deposit ($)</label><input id="pp_dep" type="number" value="${p.deposit||0}"/></div></div>
    <label>The arrangement — how they will pay</label><textarea id="pp_arr" rows="3" placeholder="e.g. $175 every Friday from paycheck; if short, promise-to-pay with catch-up by the following Tuesday.">${esc(p.arrangement||'')}</textarea>`);
  save.onclick=async()=>{ try{ await api(`/housing/residents/${rid}/payplan`,{method:'POST',body:JSON.stringify({weekly_amount:+$('pp_amt').value,due_day:$('pp_day').value,source:$('pp_src').value,deposit:+$('pp_dep').value,arrangement:$('pp_arr').value})}); closeHModal(); if($('rentrun').classList.contains('active'))loadRentRun(); else if(HOUSING.current)openResident(rid); }catch(e){ alert(e.message); } };
}

/* ============================ STAFFING / COVERAGE ============================ */
async function loadHousingStaff(){
  if($('hsDate') && !$('hsDate').value) $('hsDate').value=today();
  let d; try{ d=await api('/housing/staffing?date='+($('hsDate')?$('hsDate').value:today())); }catch(e){ $('hsBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  HOUSING.staff=d.staff;
  const filled=d.houses.length*d.shifts.length - d.gaps.length;
  $('hsKpis').innerHTML=`
    <div class="ret-card"><div class="n">${d.houses.length}</div><div class="l">Houses</div></div>
    <div class="ret-card"><div class="n">${filled}</div><div class="l">Shifts covered</div></div>
    <div class="ret-card ${d.gaps.length?'rc-high':''}"><div class="n">${d.gaps.length}</div><div class="l">Coverage gaps</div></div>
    <div class="ret-card"><div class="n">${d.staff.length}</div><div class="l">Housing staff</div></div>`;
  const cell=(hid,shift)=>{
    const list=(d.grid[hid]&&d.grid[hid][shift])||[];
    const chips=list.map(a=>`<div class="chip" style="margin:2px 0;display:inline-flex;gap:6px;align-items:center">${a.status==='called_off'?'⚠️ ':''}${esc(a.staff_name)}${a.role?' <span class="hint">'+esc(a.role)+'</span>':''} <a onclick="removeStaffShift(${a.id})" style="cursor:pointer;color:var(--muted)">✕</a></div>`).join('');
    return `<td style="vertical-align:top;min-width:150px">${chips||'<span class="hint">—</span>'}<div><button class="btn btn-ghost btn-sm sans" style="padding:3px 8px;margin-top:4px" onclick="assignStaffShift(${hid},'${shift}')">+ Assign</button></div></td>`;
  };
  $('hsBody').innerHTML=`<table class="tbl"><thead><tr><th>House</th>${d.shifts.map(s=>`<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${d.houses.map(h=>`
    <tr><td><b>${esc(h.name)}</b> ${hProg(h.program)}</td>${d.shifts.map(s=>cell(h.id,s)).join('')}</tr>`).join('')}</tbody></table>`;
}
function assignStaffShift(houseId,shift){
  const opts=(HOUSING.staff||[]).map(s=>`<option value="${s.id}">${esc(s.name)} · ${esc(s.job_role||'')}</option>`).join('');
  const save=hmodal(`<h3>Assign staff — ${esc(shift)} shift</h3>
    <label>Staff member</label><select id="ss_user"><option value="">— choose —</option>${opts}</select>
    <label>Or type a name (e.g. agency / per-diem)</label><input id="ss_name" placeholder="Name"/>
    <label>Status</label><select id="ss_status"><option value="scheduled">Scheduled</option><option value="confirmed">Confirmed</option><option value="called_off">Called off</option></select>`);
  save.onclick=async()=>{ const uid=$('ss_user').value, nm=$('ss_name').value; if(!uid&&!nm){ alert('Pick or type a staff member.'); return; }
    try{ await api('/housing/staffing',{method:'POST',body:JSON.stringify({house_id:houseId,shift,date:$('hsDate').value,user_id:uid||null,staff_name:nm,status:$('ss_status').value})}); closeHModal(); loadHousingStaff(); }catch(e){ alert(e.message); } };
}
async function removeStaffShift(id){ try{ await api('/housing/staffing/'+id,{method:'DELETE'}); loadHousingStaff(); }catch(e){ alert(e.message); } }

/* ============================ SHIFT REPORTS ============================ */
async function loadShiftReports(){
  let d; try{ d=await api('/housing/shiftreports'+($('srHouse')&&$('srHouse').value?'?house_id='+$('srHouse').value:'')); }catch(e){ $('srBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const sel=$('srHouse'); if(sel && !sel.dataset.filled){ sel.innerHTML='<option value="">All houses</option>'+d.houses.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join(''); sel.dataset.filled='1'; }
  $('srMissing').innerHTML = d.missingToday.length?`<div class="cmd-row cmd-row-flag"><div class="cmd-row-main">⏳ <b>${d.missingToday.length}</b> shift report(s) not yet filed today <span class="hint">· ${d.missingToday.slice(0,6).map(esc).join(', ')}${d.missingToday.length>6?'…':''}</span></div></div>`:'<div class="hint">✅ All shift reports filed for today.</div>';
  $('srBody').innerHTML = d.rows.length?d.rows.map(r=>{
    const head=(r.present_count!=null)?`${r.present_count}${r.expected_count!=null?'/'+r.expected_count:''} present`:'';
    return `<div class="card" style="margin-bottom:12px">
      <div class="cmd-hero-row"><div><h3 style="font-size:15px">${esc(r.house_name||'')} · ${esc(r.shift)} <span class="hint" style="font-weight:400">· ${esc(r.date)} · ${esc(r.on_duty||'')}</span> ${r.escalation?'<span class="badge-danger">escalation</span>':''}</h3></div><span class="chip">${esc(head)}</span></div>
      ${r.out_residents?`<div class="kv"><span class="k">Out / passes</span><span class="v">${esc(r.out_residents)}</span></div>`:''}
      ${r.summary?`<p style="margin:8px 0 4px">${esc(r.summary)}</p>`:''}
      ${r.meds_note?`<div class="hint">💊 ${esc(r.meds_note)}</div>`:''}
      ${r.safety&&Object.keys(r.safety).length?`<div class="hint">🛡️ ${Object.entries(r.safety).filter(([k,v])=>v).map(([k])=>esc(k)).join(' · ')||'—'}</div>`:''}
      ${r.handoff?`<div class="pc-note" style="margin-top:6px">➡️ <b>Handoff:</b> ${esc(r.handoff)}</div>`:''}
    </div>`;
  }).join(''):'<div class="empty">No shift reports yet — file the first one.</div>';
}
function openShiftReportForm(){
  const houses=(HOUSING.houses&&HOUSING.houses.length)?HOUSING.houses:null;
  api('/housing/houses').then(hs=>{ HOUSING.houses=hs;
    const opts=hs.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
    const save=hmodal(`<h3>New shift report</h3>
      <div class="grid2"><div><label>House</label><select id="sr_house">${opts}</select></div>
      <div><label>Shift</label><select id="sr_shift"><option>Day</option><option>Evening</option><option>Overnight</option></select></div>
      <div><label>On duty</label><input id="sr_onduty" value="${esc((ME&&ME.name)||'')}"/></div>
      <div><label>Date</label><input id="sr_date" type="date" value="${today()}"/></div>
      <div><label>Present (head count)</label><input id="sr_present" type="number"/></div>
      <div><label>Expected</label><input id="sr_expected" type="number"/></div></div>
      <label>Residents out / on pass</label><input id="sr_out" placeholder="names + return time"/>
      <label>Meds / MAT note</label><input id="sr_meds" placeholder="all observed doses given, exceptions…"/>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500"><input type="checkbox" id="sf_naloxone" checked style="width:auto"/> Naloxone on site</label>
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500"><input type="checkbox" id="sf_doors" checked style="width:auto"/> Doors/locks secure</label>
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500"><input type="checkbox" id="sf_curfew" checked style="width:auto"/> Curfew/bed check done</label>
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500"><input type="checkbox" id="sr_esc" style="width:auto"/> ⚠️ Escalation needed</label>
      </div>
      <label>Shift summary / notable events</label><textarea id="sr_summary" rows="3"></textarea>
      <label>Handoff to next shift</label><textarea id="sr_handoff" rows="2"></textarea>`);
    save.onclick=async()=>{ try{ await api('/housing/shiftreports',{method:'POST',body:JSON.stringify({house_id:+$('sr_house').value,shift:$('sr_shift').value,on_duty:$('sr_onduty').value,date:$('sr_date').value,present_count:$('sr_present').value,expected_count:$('sr_expected').value,out_residents:$('sr_out').value,meds_note:$('sr_meds').value,summary:$('sr_summary').value,handoff:$('sr_handoff').value,escalation:$('sr_esc').checked?1:0,safety:{ 'Naloxone on site':$('sf_naloxone').checked,'Doors secure':$('sf_doors').checked,'Curfew check done':$('sf_curfew').checked }})}); closeHModal(); loadShiftReports(); }catch(e){ alert(e.message); } };
  });
}

/* ============================ INCIDENT REPORTS ============================ */
async function loadHIncidents(){
  let d; try{ d=await api('/housing/incidents?status='+(HOUSING.incStatus||'all')); }catch(e){ $('incBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  HOUSING.incTypes=d.types;
  $('incKpis').innerHTML=`
    <div class="ret-card ${d.stats.open?'rc-warn':''}"><div class="n">${d.stats.open}</div><div class="l">Open</div></div>
    <div class="ret-card ${d.stats.high?'rc-high':''}"><div class="n">${d.stats.high}</div><div class="l">High severity</div></div>
    <div class="ret-card"><div class="n">${d.stats.month}</div><div class="l">This month</div></div>
    <div class="ret-card"><div class="n">${d.stats.total}</div><div class="l">Showing</div></div>`;
  const sevColor=s=>({high:'#c06a52',medium:'#d29a5e',low:'#a7ba86'}[s]||'#6f7a75');
  $('incBody').innerHTML = d.rows.length?d.rows.map(i=>`<div class="card" style="margin-bottom:12px;border-left:4px solid ${sevColor(i.severity)}">
      <div class="cmd-hero-row"><div><h3 style="font-size:15px">${esc(i.type)} <span class="loc-pill" style="background:${sevColor(i.severity)}">${esc(i.severity||'')}</span> ${i.status==='closed'?'<span class="chip">closed</span>':'<span class="badge-danger">open</span>'}</h3>
        <p class="sub sans" style="margin:2px 0 0">${esc(i.house_name||'')}${i.resident_name?' · '+esc(i.resident_name):''} · ${esc(i.date)}${i.time?' '+esc(i.time):''} · by ${esc(i.reported_by||i.by||'')}</p></div>
        ${i.status!=='closed'?`<button class="btn btn-gold btn-sm sans" onclick="closeIncident(${i.id})">Mark closed</button>`:''}</div>
      ${i.summary?`<p style="margin:8px 0 4px">${esc(i.summary)}</p>`:''}
      ${i.action?`<div class="kv"><span class="k">Action taken</span><span class="v" style="max-width:65%">${esc(i.action)}</span></div>`:''}
      ${i.notified?`<div class="kv"><span class="k">Notified</span><span class="v">${esc(i.notified)}</span></div>`:''}
      ${i.follow_up?`<div class="kv"><span class="k">Follow-up</span><span class="v" style="max-width:65%">${esc(i.follow_up)}</span></div>`:''}
    </div>`).join(''):'<div class="empty">No incidents — keep it that way. 🙏</div>';
}
function setIncStatus(st){ HOUSING.incStatus=st; document.querySelectorAll('#incSeg button').forEach(b=>b.classList.toggle('on',b.dataset.st===st)); loadHIncidents(); }
async function openIncidentForm(presetResident){
  const houses=await api('/housing/houses');
  const residents=await api('/housing/residents?status=active');
  const types=HOUSING.incTypes||['Return to use','Overdose','Medical emergency','Behavioral / altercation','Property damage','Rule violation','AWOL / walk-off','Theft','Self-harm','Police / EMS called','Successful intervention','Other'];
  const save=hmodal(`<h3>🚨 Report an incident</h3>
    <div class="grid2"><div><label>House</label><select id="ic_house">${houses.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select></div>
    <div><label>Resident (if any)</label><select id="ic_res"><option value="">— none / multiple —</option>${residents.map(r=>`<option value="${r.id}" ${r.id===presetResident?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div>
    <div><label>Type</label><select id="ic_type">${types.map(t=>`<option>${esc(t)}</option>`).join('')}</select></div>
    <div><label>Severity</label><select id="ic_sev"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
    <div><label>Date</label><input id="ic_date" type="date" value="${today()}"/></div>
    <div><label>Time</label><input id="ic_time" type="time"/></div></div>
    <label>What happened</label><textarea id="ic_sum" rows="3"></textarea>
    <label>Immediate action taken</label><textarea id="ic_action" rows="2"></textarea>
    <label>Who was notified (clinical, ED, family, 911…)</label><input id="ic_notified"/>`);
  save.onclick=async()=>{ if(!$('ic_sum').value.trim()){ alert('Describe what happened.'); return; }
    try{ await api('/housing/incidents',{method:'POST',body:JSON.stringify({house_id:+$('ic_house').value,resident_id:$('ic_res').value||null,type:$('ic_type').value,severity:$('ic_sev').value,date:$('ic_date').value,time:$('ic_time').value,summary:$('ic_sum').value,action:$('ic_action').value,notified:$('ic_notified').value,status:'open'})}); closeHModal(); if($('hincidents').classList.contains('active'))loadHIncidents(); else if(HOUSING.current)openResident(HOUSING.current.id); }catch(e){ alert(e.message); } };
}
async function closeIncident(id){ const follow_up=prompt('Resolution / follow-up note:'); if(follow_up===null) return; try{ await api('/housing/incidents/'+id,{method:'POST',body:JSON.stringify({status:'closed',follow_up})}); loadHIncidents(); }catch(e){ alert(e.message); } }

/* expose to window for inline handlers & app.js show() */
/* ============================ RESIDENT VOICE (kiosk results) ============================ */
async function loadVoice(){
  let d; try{ d=await api('/housing/voice'); }catch(e){ $('voiceBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const k=d.kpis;
  $('voiceKpis').innerHTML=`
    <div class="ret-card ${k.urgent?'rc-high':''}"><div class="n">${k.urgent}</div><div class="l">Urgent requests</div></div>
    <div class="ret-card ${k.openRequests?'rc-warn':''}"><div class="n">${k.openRequests}</div><div class="l">Open requests</div></div>
    <div class="ret-card"><div class="n">${k.checkinsToday}</div><div class="l">Check-ins today</div></div>
    <div class="ret-card ${k.flagged?'rc-high':''}"><div class="n">${k.flagged}</div><div class="l">Flagged today (low mood / high craving)</div></div>`;
  const reqRow=r=>`<div class="cmd-row ${r.priority==='Urgent'&&r.status==='open'?'cmd-row-flag':''}"><div class="cmd-row-main">
    ${r.priority==='Urgent'?'🔴 ':'🛎 '}<b>${esc(r.name||'A resident')}</b> <span class="hint">· ${esc(r.category||'request')} · ${esc((r.created||'').slice(0,16).replace('T',' '))}</span><br>${esc(r.text)}
    ${r.status!=='open'?`<span class="chip" style="margin-left:6px">done · ${esc(r.handled_by||'')}</span>`:''}</div>
    ${r.status==='open'?`<div class="toolbar" style="margin:0;gap:6px"><button class="btn btn-ghost btn-sm sans" onclick="voiceToWorkOrder(${r.id})">→ Work order</button><button class="btn btn-ghost btn-sm sans" onclick="voiceRequestDone(${r.id})">Mark done</button></div>`:''}</div>`;
  const ci=c=>{ const flag=(c.cravings!=null&&c.cravings>=6)||(c.mood!=null&&c.mood<=3);
    return `<div class="cmd-row ${flag?'cmd-row-flag':''}"><div class="cmd-row-main">
      ${flag?'⚠️ ':'🌅 '}<b>${esc(c.name||'A resident')}</b> <span class="hint">· ${esc(c.date)}</span><br>
      <span class="hint">Mood ${c.mood??'—'}/10 · Cravings ${c.cravings??'—'}/10 · Meeting ${c.meeting===1?'✅':c.meeting===0?'—':'?'} · Slept ${c.slept_ok===1?'✅':c.slept_ok===0?'—':'?'}</span>
      ${c.need?`<br>Needs: ${esc(c.need)}`:''}${c.note?`<br>${esc(c.note)}`:''}</div></div>`; };
  $('voiceBody').innerHTML=`
    <div class="r360-grid">
      <div class="card"><h3>Requests</h3>${d.requests.length?d.requests.map(reqRow).join(''):'<div class="hint">No requests yet.</div>'}</div>
      <div class="card"><h3>Daily check-ins</h3>${d.checkins.length?d.checkins.map(ci).join(''):'<div class="hint">No check-ins yet.</div>'}</div>
    </div>
    <div class="r360-grid" style="margin-top:16px">
      <div class="card"><h3>Survey pulse</h3>${d.surveys.map(s=>`<div class="kv"><span class="k">${esc(s.title)}</span><span class="v">${s.avg!=null?`<b style="color:var(--navy)">${s.avg}</b>/10 · ${s.responses} resp`:`${s.responses} resp`}</span></div>`).join('')||'<div class="hint">No surveys.</div>'}
        ${d.recentText.length?'<div style="margin-top:10px"><div class="hint" style="margin-bottom:4px">In their words</div>'+d.recentText.map(t=>`<div class="cmd-row"><div class="cmd-row-main">“${esc(t.text)}”</div></div>`).join('')+'</div>':''}</div>
      <div class="card"><h3>Ideas 💡</h3>${d.suggestions.length?d.suggestions.map(s=>`<div class="cmd-row"><div class="cmd-row-main"><b>${esc(s.name||'Anonymous')}</b> <span class="hint">· ${esc((s.created||'').slice(0,10))}</span><br>${esc(s.text)}</div></div>`).join(''):'<div class="hint">No ideas yet.</div>'}</div>
    </div>`;
}
async function voiceRequestDone(id){ try{ await api('/housing/voice/request/'+id,{method:'POST',body:'{}'}); loadVoice(); }catch(e){ alert(e.message); } }
async function voiceToWorkOrder(id){ if(!confirm('Create a maintenance work order from this request and mark it handled?')) return; try{ await api('/housing/voice/request/'+id+'/to-work-order',{method:'POST',body:'{}'}); alert('Work order created — see Maintenance & Supplies.'); loadVoice(); }catch(e){ alert(e.message); } }
async function openSlKioskCode(){
  let d; try{ d=await api('/housing/kiosk-code'); }catch(e){ alert(e.message); return; }
  const url = location.origin+'/sl-kiosk.html';
  const save=hmodal(`<h3>Hilltop Recovery Home — kiosk setup</h3>
    <p class="sub sans" style="margin:.2em 0 1em">A <b>separate</b> kiosk for Hilltop Recovery Home. Open this on the resident iPad and enter the code once:</p>
    <div class="kv"><span class="k">Kiosk URL</span><span class="v"><a href="${esc(url)}" target="_blank">${esc(url)}</a></span></div>
    <label style="margin-top:10px">Kiosk code ${d.weak?'<span style="color:var(--danger)">(weak — please change it)</span>':''}</label>
    <input id="slk_code" value="${esc(d.code)}" ${isAdmin()?'':'disabled'}/>
    ${isAdmin()?'<div class="hint" style="margin-top:4px">At least 6 characters. Residents never type this — staff enter it once per device.</div>':'<div class="hint">Only the owner/admin can change the code.</div>'}`);
  if(!isAdmin()){ save.textContent='Close'; save.onclick=closeHModal; return; }
  save.textContent='Save code';
  save.onclick=async()=>{ const code=$('slk_code').value.trim(); if(code.length<6){ alert('Use at least 6 characters.'); return; } try{ await api('/housing/kiosk-code',{method:'POST',body:JSON.stringify({code})}); closeHModal(); }catch(e){ alert(e.message); } };
}

/* ============================ MAINTENANCE & SUPPLIES ============================ */
let MAINT_META=null;
async function maintMeta(){ if(!MAINT_META){ try{ MAINT_META=await api('/housing/maintenance/meta'); }catch(e){ MAINT_META={areas:[],categories:[],houses:[]}; } } return MAINT_META; }
function setMaintTab(t){ HOUSING.maintTab=t; document.querySelectorAll('#maintSeg button').forEach(b=>b.classList.toggle('on',b.dataset.t===t)); loadHmaint(); }
async function loadHmaint(){
  await maintMeta();
  const tab=HOUSING.maintTab||'work';
  if(tab==='work') return loadWorkOrders();
  if(tab==='inv') return loadHinventory();
  return loadOrders();
}
async function loadWorkOrders(){
  let d; try{ d=await api('/housing/maintenance?status='+(HOUSING.maintWO||'open')); }catch(e){ $('maintBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('maintKpis').innerHTML=`<div class="ret-card ${d.kpis.urgent?'rc-high':''}"><div class="n">${d.kpis.urgent}</div><div class="l">Urgent</div></div>
    <div class="ret-card ${d.kpis.open?'rc-warn':''}"><div class="n">${d.kpis.open}</div><div class="l">Open work orders</div></div>`;
  const seg=`<span class="seg" style="margin-bottom:10px">${['open','all','done'].map(s=>`<button class="${(HOUSING.maintWO||'open')===s?'on':''}" onclick="HOUSING.maintWO='${s}';loadWorkOrders()">${s[0].toUpperCase()+s.slice(1)}</button>`).join('')}</span>`;
  const row=m=>`<div class="cmd-row ${m.priority==='Urgent'&&m.status!=='done'?'cmd-row-flag':''}"><div class="cmd-row-main">
    ${m.status==='done'?'✅ ':(m.priority==='Urgent'?'🔴 ':'🔧 ')}<b>${esc(m.title)}</b> <span class="hint">· ${esc(m.house||'—')} · ${esc(m.area||'')}${m.assigned_to?' · '+esc(m.assigned_to):''} · ${esc((m.created||'').slice(0,10))}</span>
    ${m.detail?'<br>'+esc(m.detail):''}${m.status==='done'&&m.resolution?'<br><span class="hint">Resolved: '+esc(m.resolution)+(m.cost?' · $'+m.cost:'')+'</span>':''}</div>
    <div class="toolbar" style="margin:0;gap:6px">${m.status!=='done'?`<button class="btn btn-ghost btn-sm sans" onclick="closeWorkOrder(${m.id})">Mark done</button>`:`<span class="chip">done</span>`}</div></div>`;
  $('maintBody').innerHTML=`<div class="toolbar" style="justify-content:space-between"><div>${seg}</div><button class="btn btn-primary sans" onclick="openMaintForm()">+ Work order</button></div>
    ${d.rows.length?d.rows.map(row).join(''):'<div class="hint">No work orders.</div>'}`;
}
async function openMaintForm(){
  await maintMeta();
  const houseOpts=MAINT_META.houses.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const areaOpts=MAINT_META.areas.map(a=>`<option>${esc(a)}</option>`).join('');
  const save=hmodal(`<h3>New work order</h3>
    <label>What needs fixing?</label><input id="wo_title" placeholder="e.g. Leaking faucet in upstairs bath"/>
    <div class="grid2">
      <div><label>House</label><select id="wo_house"><option value="">— pick —</option>${houseOpts}</select></div>
      <div><label>Area</label><select id="wo_area">${areaOpts}</select></div>
      <div><label>Priority</label><select id="wo_pri"><option>Normal</option><option>Urgent</option><option>Low</option></select></div>
      <div><label>Assign to (optional)</label><input id="wo_assign"/></div>
    </div>
    <label>Details</label><textarea id="wo_detail" rows="2"></textarea>`);
  save.onclick=async()=>{ if(!$('wo_title').value.trim()){ alert('Title?'); return; } try{ await api('/housing/maintenance',{method:'POST',body:JSON.stringify({title:$('wo_title').value,house_id:$('wo_house').value||null,area:$('wo_area').value,priority:$('wo_pri').value,assigned_to:$('wo_assign').value,detail:$('wo_detail').value})}); closeHModal(); loadWorkOrders(); }catch(e){ alert(e.message); } };
}
async function closeWorkOrder(id){
  const save=hmodal(`<h3>Complete work order</h3><label>How was it resolved?</label><textarea id="wo_res" rows="2"></textarea><label>Cost (optional)</label><input id="wo_cost" type="number" step="0.01" placeholder="0.00"/>`);
  save.onclick=async()=>{ try{ await api('/housing/maintenance/'+id,{method:'POST',body:JSON.stringify({status:'done',resolution:$('wo_res').value,cost:$('wo_cost').value||null})}); closeHModal(); loadWorkOrders(); }catch(e){ alert(e.message); } };
}
async function loadHinventory(){
  let d; try{ d=await api('/housing/inventory'); }catch(e){ $('maintBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  $('maintKpis').innerHTML=`<div class="ret-card"><div class="n">${d.kpis.items}</div><div class="l">Stock items</div></div>
    <div class="ret-card ${d.kpis.low?'rc-high':''}"><div class="n">${d.kpis.low}</div><div class="l">Low / at par</div></div>
    <div class="ret-card"><div class="n">${money(d.kpis.reorderValue)}</div><div class="l">Reorder value</div></div>`;
  const rows=d.items.map(i=>`<tr class="${i.low?'':''}" style="${i.low?'background:#fdeaea':''}">
    <td><b>${esc(i.name)}</b> <span class="hint">${esc(i.category||'')}${i.vendor?' · '+esc(i.vendor):''}</span></td>
    <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm sans" onclick="adjItem(${i.id},-1)">−</button> <b>${i.qty}</b> <button class="btn btn-ghost btn-sm sans" onclick="adjItem(${i.id},1)">+</button> <span class="hint">${esc(i.unit||'')}</span></td>
    <td>${i.par}</td><td>${i.reorder_qty}</td><td>${money(i.unit_cost)}</td>
    <td>${i.low?'<span class="chip" style="background:#fdeaea;color:#b3382f;border-color:#f3c4c0">LOW</span>':'<span class="chip" style="background:#e8f3ec;color:#2f7a4f;border-color:#bfe0cb">OK</span>'}</td>
    <td style="text-align:right"><button class="btn btn-ghost btn-sm sans" onclick="openInvForm(${i.id})">Edit</button></td></tr>`).join('');
  $('maintBody').innerHTML=`<div class="toolbar" style="justify-content:space-between">
      <div class="hint">At/below par = LOW. Tap −/+ to count stock in or out.</div>
      <div class="toolbar" style="margin:0;gap:8px"><button class="btn btn-gold sans" onclick="suggestReorder()">⚡ Generate reorder</button><button class="btn btn-primary sans" onclick="openInvForm()">+ Item</button></div></div>
    <table class="tbl" style="margin-top:8px"><thead><tr><th>Item</th><th>On hand</th><th>Par</th><th>Reorder qty</th><th>Unit $</th><th>Status</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan=7 class="hint">No items.</td></tr>'}</tbody></table>`;
}
async function adjItem(id,delta){ try{ await api('/housing/inventory/'+id+'/adjust',{method:'POST',body:JSON.stringify({delta})}); loadHinventory(); }catch(e){ alert(e.message); } }
async function openInvForm(id){
  await maintMeta();
  const it=id?(await api('/housing/inventory')).items.find(x=>x.id===id):{};
  const catOpts=MAINT_META.categories.map(c=>`<option ${it.category===c?'selected':''}>${esc(c)}</option>`).join('');
  const save=hmodal(`<h3>${id?'Edit':'New'} stock item</h3>
    <label>Name</label><input id="iv_name" value="${esc(it.name||'')}"/>
    <div class="grid2">
      <div><label>Category</label><select id="iv_cat">${catOpts}</select></div>
      <div><label>Unit</label><input id="iv_unit" value="${esc(it.unit||'each')}"/></div>
      <div><label>On hand</label><input id="iv_qty" type="number" step="0.01" value="${it.qty??0}"/></div>
      <div><label>Par (reorder point)</label><input id="iv_par" type="number" step="0.01" value="${it.par??0}"/></div>
      <div><label>Reorder qty</label><input id="iv_ro" type="number" step="0.01" value="${it.reorder_qty??0}"/></div>
      <div><label>Unit cost</label><input id="iv_cost" type="number" step="0.01" value="${it.unit_cost??0}"/></div>
      <div><label>Vendor</label><input id="iv_vendor" value="${esc(it.vendor||'')}"/></div>
      <div><label>SKU</label><input id="iv_sku" value="${esc(it.sku||'')}"/></div>
    </div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input id="iv_auto" type="checkbox" ${it.auto!==0?'checked':''}/> Include in automated reordering</label>`);
  save.onclick=async()=>{ const body={id:id||undefined,name:$('iv_name').value,category:$('iv_cat').value,unit:$('iv_unit').value,qty:+$('iv_qty').value,par:+$('iv_par').value,reorder_qty:+$('iv_ro').value,unit_cost:+$('iv_cost').value,vendor:$('iv_vendor').value,sku:$('iv_sku').value,auto:$('iv_auto').checked?1:0}; if(!body.name.trim()){ alert('Name?'); return; } try{ await api('/housing/inventory',{method:'POST',body:JSON.stringify(body)}); closeHModal(); loadHinventory(); }catch(e){ alert(e.message); } };
}
async function suggestReorder(){
  try{ const r=await api('/housing/orders/suggest',{method:'POST',body:'{}'}); if(r.empty){ alert('Nothing is at or below par — stock looks good.'); return; } alert(`Built ${r.orders} reorder${r.orders>1?'s':''} covering ${r.items} low item(s). See the Orders tab.`); setMaintTab('orders'); }catch(e){ alert(e.message); }
}
async function loadOrders(){
  let d; try{ d=await api('/housing/orders'); }catch(e){ $('maintBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  const sug=d.orders.filter(o=>o.status==='suggested').length;
  $('maintKpis').innerHTML=`<div class="ret-card ${sug?'rc-warn':''}"><div class="n">${sug}</div><div class="l">Suggested orders</div></div>
    <div class="ret-card"><div class="n">${d.orders.filter(o=>o.status==='ordered').length}</div><div class="l">Placed</div></div>`;
  const card=o=>`<div class="card" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
    <div><b>${esc(o.vendor||'Vendor')}</b> <span class="chip">${esc(o.status)}</span> <span class="hint">· ${esc((o.created||'').slice(0,10))} · ${money(o.total)}</span></div>
    <div class="toolbar" style="margin:0;gap:6px">
      ${o.status==='suggested'?`<button class="btn btn-primary btn-sm sans" onclick="orderStatus(${o.id},'ordered')">Mark ordered</button><button class="btn btn-ghost btn-sm sans" onclick="orderStatus(${o.id},'cancelled')">Cancel</button>`:''}
      ${o.status==='ordered'?`<button class="btn btn-gold btn-sm sans" onclick="orderStatus(${o.id},'received')">Receive → restock</button>`:''}
    </div></div>
    <table class="tbl" style="margin-top:8px"><tbody>${o.lines.map(l=>`<tr><td>${esc(l.name)}</td><td style="text-align:right">${l.qty} × ${money(l.unit_cost)}</td></tr>`).join('')}</tbody></table></div>`;
  $('maintBody').innerHTML=`<div class="toolbar" style="justify-content:flex-end"><button class="btn btn-gold sans" onclick="suggestReorder()">⚡ Generate reorder from low stock</button></div>
    ${d.orders.length?d.orders.map(card).join(''):'<div class="hint">No orders yet. Use “Generate reorder” to build one from low stock.</div>'}`;
}
async function orderStatus(id,status){ if(status==='received'&&!confirm('Receive this order? It will add the quantities back into inventory.')) return; try{ await api('/housing/orders/'+id+'/status',{method:'POST',body:JSON.stringify({status})}); loadOrders(); }catch(e){ alert(e.message); } }

/* ============================ DAILY MOVEMENT ============================ */
let MOVE=null;
async function loadDailyMovement(){
  let d; try{ d=await api('/housing/daily-movement'); }catch(e){ $('movementBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  MOVE=d;
  const k=[['Census',d.census],['Intakes',d.intakes.length],['Discharges',d.discharges.length],['Open beds',d.open],['Occupancy',d.occPct+'%'],['Incidents',d.incidents],['Open work orders',d.openWO]];
  const status = !d.emailReady ? '<span class="chip" style="background:#fdeaea;color:#b3382f;border-color:#f3c4c0">Email not connected</span>'
    : (d.recipients.length ? `<span class="hint">Sends to ${d.recipients.length} recipient(s)${d.auto?` · auto at ${d.hour}:00`:' · auto off'}${d.lastSent?` · last sent ${esc(d.lastSent)}`:''}</span>` : '<span class="chip" style="background:#fbe9d8;color:#a35a23;border-color:#f0c9a3">No recipients set</span>');
  const lst=(a,f)=>a.length?'<ul style="margin:6px 0 0;padding-left:18px">'+a.map(f).join('')+'</ul>':'<div class="hint">None today.</div>';
  $('movementBody').innerHTML=`
    <div class="ret-cards">${k.map(c=>`<div class="ret-card"><div class="n">${c[1]}</div><div class="l">${c[0]}</div></div>`).join('')}</div>
    <div style="margin:10px 0">${status}</div>
    <div class="r360-grid">
      <div class="card"><h3>Intakes today (${d.intakes.length})</h3>${lst(d.intakes,i=>`<li>${esc(i.name)} — ${esc(i.house||'unassigned')}${i.loc?' · '+esc(i.loc):''}</li>`)}</div>
      <div class="card"><h3>Discharges today (${d.discharges.length})</h3>${lst(d.discharges,x=>`<li>${esc(x.name)} — ${esc(x.discharge_type||'discharged')}${x.house?' · '+esc(x.house):''}</li>`)}</div>
      <div class="card"><h3>Incidents today (${d.incidents})</h3>${lst(d.incidentList||[],i=>`<li>${esc(i.type||'Incident')}${i.severity?' ('+esc(i.severity)+')':''} — ${esc(i.house||'')}${i.summary?': '+esc(i.summary):''}</li>`)}</div>
      <div class="card"><h3>Maintenance</h3><p style="margin:6px 0 0">${d.openWO} open work order(s)${(d.urgentWO&&d.urgentWO.length)?` · <b style="color:var(--danger)">${d.urgentWO.length} urgent</b>`:''}${d.lowStock?` · ${d.lowStock} supply item(s) low`:''}.</p>${(d.urgentWO&&d.urgentWO.length)?lst(d.urgentWO,w=>`<li><b style="color:var(--danger)">Urgent:</b> ${esc(w.title)}${w.house?' — '+esc(w.house):''}</li>`):''}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Census by house</h3>
      <table class="tbl"><thead><tr><th>House</th><th>Program</th><th style="text-align:right">Filled</th><th style="text-align:right">Open</th></tr></thead>
      <tbody>${d.byHouse.map(h=>`<tr><td>${esc(h.name)}</td><td>${esc(h.program)}</td><td style="text-align:right">${h.occupied}/${h.capacity}</td><td style="text-align:right">${h.open}</td></tr>`).join('')}
      <tr style="font-weight:700;border-top:2px solid var(--navy)"><td>Total</td><td></td><td style="text-align:right">${d.occupied}/${d.capacity}</td><td style="text-align:right">${d.open}</td></tr></tbody></table></div>`;
}
async function sendDailyMovement(){
  if(MOVE && !MOVE.emailReady){ alert('Email isn’t connected yet — set it up in Settings → Email first.'); return; }
  if(!confirm('Send today’s Daily Movement report to clinical and leadership now?')) return;
  try{ const r=await api('/housing/daily-movement/send',{method:'POST',body:'{}'}); alert(`Sent to ${r.sent}/${r.total} recipient(s).`+(r.failed&&r.failed.length?'\nFailed: '+r.failed.join(', '):'')); }
  catch(e){ alert(e.message); }
}
async function openMovementSettings(){
  const d=MOVE||await api('/housing/daily-movement');
  const save=hmodal(`<h3>Daily Movement — recipients & schedule</h3>
    <p class="sub sans" style="margin:.2em 0 1em">Who gets the morning report, and when it sends automatically. Separate multiple emails with commas.</p>
    <label>Clinical recipients</label><input id="mv_clin" value="${esc(d.clinical||'')}" placeholder="clinical@armadarecovery.com"/>
    <label style="margin-top:8px">Leadership recipients</label><input id="mv_lead" value="${esc(d.leadership||'')}" placeholder="shlomo@armadarecovery.com"/>
    <div class="grid2" style="margin-top:10px">
      <div><label style="display:flex;gap:8px;align-items:center"><input id="mv_auto" type="checkbox" ${d.auto?'checked':''}/> Auto-send daily</label></div>
      <div><label>Hour (0–23, ET)</label><input id="mv_hour" type="number" min="0" max="23" value="${d.hour??8}"/></div>
    </div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="mv_alerts" type="checkbox" ${d.alerts?'checked':''}/> Email these recipients <b>immediately</b> for urgent events (distress kiosk requests &amp; high-severity incidents)</label>
    ${d.emailReady?'':'<div class="hint" style="margin-top:8px;color:var(--danger)">⚠ Email isn’t connected — connect it in Settings → Email or this won’t send.</div>'}`);
  save.onclick=async()=>{ try{ await api('/housing/daily-movement/settings',{method:'POST',body:JSON.stringify({clinical:$('mv_clin').value,leadership:$('mv_lead').value,auto:$('mv_auto').checked,hour:+$('mv_hour').value,alerts:$('mv_alerts').checked})}); closeHModal(); loadDailyMovement(); }catch(e){ alert(e.message); } };
}

Object.assign(window,{loadHousingHQ,loadHouses,loadResidents,renderResidents,setResStatus,loadVoice,voiceRequestDone,voiceToWorkOrder,openSlKioskCode,loadHmaint,setMaintTab,loadWorkOrders,openMaintForm,closeWorkOrder,loadHinventory,adjItem,openInvForm,suggestReorder,loadOrders,orderStatus,loadDailyMovement,sendDailyMovement,openMovementSettings,openResidentForm,openResident,openHouseForm,saveHouse:openHouseForm,bedClick,doAssignBed,setBedStatus,deleteBed,addBed,openReccapForm,openSupportForm,openCoordForm,openDischargeForm,openResidentEdit,loadScreens,randomScreens,openScreenForm,loadHouseLife,setCurfew,toggleChore,loadCoordination,loadLedger,openLedgerForm,loadOrh,cycleOrh,openInspectionForm,openGrievanceForm,resolveGrievance,loadHousingOutcomes,closeHModal,screenResultBadge,loadIntake,openPacket,openFormModal,loadEmployment,openEmploymentForm,openJobSearchForm,loadRentRun,recordRent,openPayplanForm,loadHousingStaff,assignStaffShift,removeStaffShift,loadShiftReports,openShiftReportForm,loadHIncidents,setIncStatus,openIncidentForm,closeIncident,openImportForm,fixDob,setTenure,uploadResidentPhoto,removeResidentPhoto,pickResidentPhoto,setRestrFilter,openRestrictionForm,liftRestriction});
