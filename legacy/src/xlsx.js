// Minimal .xlsx reader — just enough to pull cell grids out of a workbook, plus the
// parser for the "Entity Information" sheet so the owner can upload the original
// Excel file and the app fills the entity vault itself (no JSON middle step).
// Zip parsing (central directory + raw deflate) is done natively so we add no
// dependencies; the XML is handled with targeted regexes (xlsx cell markup is regular).
import zlib from 'node:zlib';

function findEocd(buf) {
  const stop = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('not a zip/xlsx file');
}
function unzip(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), cmtLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    files[name] = { method, raw: buf.subarray(dataStart, dataStart + csize) };
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return (name) => { const f = files[name]; if (!f) return null; return f.method === 8 ? zlib.inflateRawSync(f.raw) : Buffer.from(f.raw); };
}
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function readWorkbook(buf) {
  const read = unzip(buf);
  const shared = [];
  const ss = read('xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.toString('utf8').match(/<si[\s>][\s\S]*?<\/si>/g) || []) {
      shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join(''));
    }
  }
  const wb = read('xl/workbook.xml')?.toString('utf8') || '';
  const rels = read('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  const sheets = {};
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    let t = relMap[m[2]] || '';
    if (t && !t.startsWith('xl/')) t = 'xl/' + t.replace(/^\//, '');
    sheets[unesc(m[1])] = t;
  }
  function grid(sheetName) {
    const path = sheets[sheetName];
    let xml = path ? read(path)?.toString('utf8') : null;
    if (!xml) return null;
    // Drop self-closing (empty) cells FIRST — otherwise the lazy inner match of
    // `<c ...>...</c>` lets an empty `<c .../>` swallow the next real cell.
    xml = xml.replace(/<c[^>]*\/>/g, '');
    const g = {};
    for (const cm of xml.matchAll(/<c([^>]*\br="[A-Z]+\d+"[^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1], inner = cm[2];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)[1];
      let val = '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (v) { val = unesc(v[1]); if (/\bt="s"/.test(attrs)) val = shared[+v[1]] ?? ''; }
      else { const is = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/); if (is) val = unesc(is[1]); }
      g[ref] = String(val).trim();
    }
    return g;
  }
  return { sheetNames: Object.keys(sheets), grid };
}

function serialToDate(s) {
  const n = parseInt(String(s || '').replace(/[^0-9]/g, ''), 10);
  if (n > 20000 && n < 60000 && /^\s*\d+(\.\d+)?\s*$/.test(String(s))) {
    return new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
  }
  return String(s || '');
}

// Parse the org's "Entity Information" workbook into the vault shape
// ({records, banks, cards, portals}). Mirrors the layout of the master sheet:
// entities across columns; rows = ENTITY(1) TAXID(2) NPI(3) TAXONOMY(4),
// three bank blocks (5-8, 9-11, 12-15), card-info rows (16-18), address (19),
// OTHER rows (20-23) carrying Medicaid/DUNS, incorporation date (26).
export function parseEntityWorkbook(buf) {
  const wb = readWorkbook(buf);
  const cols = 'BCDEFGHIJKLMNOPQRSTU'.split('');
  const records = [], banks = [], cards = [], portals = [];
  function extract(sheetName, status) {
    const g = wb.grid(sheetName);
    if (!g) return false;
    const cell = (c, r) => g[c + r] || '';
    for (const col of cols) {
      const ent = cell(col, 1);
      if (!ent) continue;
      const rec = { entity: ent, legal_name: ent, tax_id: cell(col, 2), npi: cell(col, 3), taxonomy: cell(col, 4), address: cell(col, 19), medicaid_id: '', duns: '', incorp_date: serialToDate(cell(col, 26)), notes: '', status };
      for (const r of [20, 21, 22, 23]) {
        const o = cell(col, r);
        if (/MEDICAID/i.test(o)) rec.medicaid_id = o.replace(/.*MEDICAID PROVIDER ID/i, '').trim();
        if (/DUNS/i.test(o)) rec.duns = o.replace(/.*DUNS[:\s#]*/i, '').trim().slice(0, 20);
      }
      records.push(rec);
      const addbank = (br, rr, ars) => {
        const bank = cell(col, br);
        if (!bank) return;
        for (const ar of ars) {
          const acct = cell(col, ar);
          if (!acct) continue;
          const typ = /operat/i.test(acct) ? 'operating' : (/collect/i.test(acct) ? 'collections' : '');
          banks.push({ entity: ent, bank, routing: cell(col, rr), account_number: acct.replace(/\s*\(.*\)/, '').trim(), acct_type: typ, notes: '' });
        }
      };
      addbank(5, 6, [7, 8]); addbank(9, 10, [11]); addbank(12, 13, [14, 15]);
      for (const r of [16, 17, 18]) {
        const ci = cell(col, r);
        if (!ci || !/\d{4}/.test(ci)) continue;
        const num = (ci.match(/(\d[\d ]{10,})/) || [])[1] || '';
        const code = (ci.match(/"(\d{3,4})"/) || [])[1] || '';
        const exp = (ci.match(/(\d{1,2}\/\d{2,4})/) || [])[1] || '';
        cards.push({ entity: ent, name_on_card: ci.split(/\d/)[0].trim().slice(0, 60), card_number: num.trim(), exp, front_code: code, back_code: '', notes: ci.slice(0, 200) });
      }
    }
    return true;
  }
  const names = wb.sheetNames;
  const activeSheet = names.find((n) => /entities info/i.test(n) && !/12\.31|\(/.test(n)) || names.find((n) => /entities info/i.test(n));
  if (!activeSheet || !extract(activeSheet, 'active')) throw new Error('No "Entities Info" sheet found in this workbook.');
  const activeTax = new Set(records.filter((r) => r.tax_id).map((r) => r.tax_id));
  const closedSheet = names.find((n) => /closed_sold/i.test(n)) || names.find((n) => /closed/i.test(n));
  if (closedSheet) {
    const before = records.length;
    extract(closedSheet, 'closed');
    for (let i = records.length - 1; i >= before; i--) {   // drop closed rows that are really the same active entity
      if (records[i].tax_id && activeTax.has(records[i].tax_id)) records.splice(i, 1);
    }
  }
  const ccSheet = names.find((n) => /credit cards/i.test(n));
  if (ccSheet) {
    const g = wb.grid(ccSheet);
    const cell = (c, r) => (g && g[c + r]) || '';
    for (let r = 3; r < 60; r++) {
      const name = cell('A', r);
      if (!name) continue;
      cards.push({ entity: cell('B', r), name_on_card: name, card_number: cell('C', r), exp: cell('D', r), front_code: cell('E', r), back_code: cell('F', r), notes: '' });
    }
  }
  const pSheet = names.find((n) => /portal/i.test(n));
  if (pSheet) {
    const g = wb.grid(pSheet);
    const cell = (c, r) => (g && g[c + r]) || '';
    for (let r = 2; r < 60; r++) {
      const nm = cell('A', r);
      if (!nm) continue;
      portals.push({ name: nm, username: cell('B', r), password: cell('C', r), info: cell('D', r), entity: cell('E', r) });
    }
  }
  return { records, banks, cards, portals };
}

// Flatten a workbook into plain rows of text — the shape the order-email AI
// parser eats. Tab-separated cells, one line per row, sheet headers included.
// Caps keep a runaway sheet from flooding the model (it reads ~12k chars).
export function workbookText(buf, { maxSheets = 3, maxRows = 300 } = {}) {
  const wb = readWorkbook(buf);
  const colNum = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const out = [];
  for (const name of wb.sheetNames.slice(0, maxSheets)) {
    const g = wb.grid(name);
    if (!g) continue;
    const rows = new Map();   // rowNum → Map(colNum → val)
    for (const ref of Object.keys(g)) {
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (!m || !g[ref]) continue;
      const r = +m[2], c = colNum(m[1]);
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r).set(c, g[ref]);
    }
    if (!rows.size) continue;
    const lines = [];
    for (const r of [...rows.keys()].sort((a, b) => a - b).slice(0, maxRows)) {
      const cols = rows.get(r);
      const maxC = Math.max(...cols.keys());
      const cells = [];
      for (let c = 1; c <= maxC; c++) cells.push(cols.get(c) ?? '');
      lines.push(cells.join('\t').replace(/\t+$/, ''));
    }
    out.push((wb.sheetNames.length > 1 ? `--- Sheet: ${name} ---\n` : '') + lines.join('\n'));
  }
  return out.join('\n\n');
}
