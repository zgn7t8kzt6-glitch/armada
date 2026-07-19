// Plaid bank sync — the Phase 2 slice. Read-only: Transactions + Balances.
// Activates only when PLAID_CLIENT_ID and PLAID_SECRET are set.
// Spec 6.4: stale >48h is loud, never silent; balances show "as of".
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { q, audit } from './db.js';
import { mapPlaidType, plaidAmountToCents } from './core.js';

export const plaidEnabled = () => !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox'; // sandbox | production

let _client = null;
function client() {
  if (!_client) {
    _client = new PlaidApi(new Configuration({
      basePath: PlaidEnvironments[PLAID_ENV],
      baseOptions: { headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      } },
    }));
  }
  return _client;
}

export async function createLinkToken(userId) {
  const r = await client().linkTokenCreate({
    user: { client_user_id: String(userId) },
    client_name: 'FamilyOS',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
  });
  return r.data.link_token;
}

export async function exchangePublicToken(publicToken, institutionName, userId) {
  const r = await client().itemPublicTokenExchange({ public_token: publicToken });
  const { access_token, item_id } = r.data;
  const item = await q(
    `INSERT INTO plaid_items (item_id, access_token, institution) VALUES ($1,$2,$3)
     ON CONFLICT (item_id) DO UPDATE SET access_token = $2, status = 'ok'
     RETURNING id`,
    [item_id, access_token, institutionName || '']);
  await audit(userId, 'plaid.linked', 'plaid_item', item_id, { institution: institutionName });
  await syncItem(item.rows[0].id, userId);
  return item.rows[0].id;
}

async function upsertAccount(itemDbId, a) {
  const cents = plaidAmountToCents(a.balances?.current ?? 0, a.type);
  const existing = await q('SELECT id FROM accounts WHERE plaid_account_id = $1', [a.account_id]);
  if (existing.rows.length) {
    await q(`UPDATE accounts SET valuation = $1, valued_at = CURRENT_DATE WHERE plaid_account_id = $2`,
            [cents, a.account_id]);
    return existing.rows[0].id;
  }
  const r = await q(
    `INSERT INTO accounts (name, type, valuation, valued_at, is_manual, plaid_account_id, plaid_item_id)
     VALUES ($1,$2,$3,CURRENT_DATE,FALSE,$4,$5) RETURNING id`,
    [a.name || a.official_name || 'Account', mapPlaidType(a.type, a.subtype), cents, a.account_id, itemDbId]);
  return r.rows[0].id;
}

export async function syncItem(itemDbId, userId) {
  const item = (await q('SELECT * FROM plaid_items WHERE id = $1', [itemDbId])).rows[0];
  if (!item || item.status === 'revoked') return { added: 0, modified: 0, removed: 0 };
  let cursor = item.cursor || undefined;
  let added = 0, modified = 0, removed = 0, hasMore = true;
  try {
    // refresh balances/accounts
    const acc = await client().accountsGet({ access_token: item.access_token });
    const accMap = {};
    for (const a of acc.data.accounts) accMap[a.account_id] = await upsertAccount(itemDbId, a);

    while (hasMore) {
      const r = await client().transactionsSync({ access_token: item.access_token, cursor });
      const d = r.data;
      for (const t of [...d.added, ...d.modified]) {
        const accountId = accMap[t.account_id];
        if (!accountId) continue;
        const cents = -plaidAmountToCents(t.amount, 'spend'); // Plaid: positive = money out
        const res = await q(
          `INSERT INTO transactions (account_id, amount, occurred_on, merchant, dedupe_hash, status, provider_id)
           VALUES ($1,$2,$3,$4,$5,'ok',$6)
           ON CONFLICT (provider_id) DO UPDATE SET amount = $2, occurred_on = $3, merchant = $4
           RETURNING (xmax = 0) AS inserted`,
          [accountId, cents, t.date, (t.merchant_name || t.name || '').slice(0, 200),
           'plaid', t.transaction_id]);
        if (res.rows[0]?.inserted) added++; else modified++;
      }
      for (const t of d.removed) {
        await q(`UPDATE transactions SET status = 'dismissed' WHERE provider_id = $1`, [t.transaction_id]);
        removed++;
      }
      cursor = d.next_cursor;
      hasMore = d.has_more;
    }
    await q(`UPDATE plaid_items SET cursor = $1, last_synced_at = now(), status = 'ok' WHERE id = $2`,
            [cursor, itemDbId]);
    await audit(userId ?? null, 'plaid.synced', 'plaid_item', item.item_id, { added, modified, removed });
  } catch (e) {
    await q(`UPDATE plaid_items SET status = 'error' WHERE id = $1`, [itemDbId]);
    await audit(userId ?? null, 'plaid.sync_error', 'plaid_item', item.item_id,
                { error: e?.response?.data?.error_code || e.message });
    throw e;
  }
  return { added, modified, removed };
}

export async function syncAll(userId) {
  const items = await q(`SELECT id FROM plaid_items WHERE status <> 'revoked'`);
  const out = [];
  for (const it of items.rows) {
    try { out.push(await syncItem(it.id, userId)); }
    catch { out.push({ error: true }); }
  }
  return out;
}

/** The kill switch (spec section 7): revoke every token at Plaid, then forget them. */
export async function revokeAll(userId) {
  const items = await q(`SELECT * FROM plaid_items WHERE status <> 'revoked'`);
  for (const it of items.rows) {
    try { await client().itemRemove({ access_token: it.access_token }); } catch { /* already dead */ }
    await q(`UPDATE plaid_items SET status = 'revoked', access_token = '' WHERE id = $1`, [it.id]);
  }
  await audit(userId, 'plaid.kill_switch', null, null, { items: items.rows.length });
  return items.rows.length;
}

export async function itemsOverview() {
  const r = await q(`SELECT id, institution, status, last_synced_at,
      (last_synced_at IS NULL OR last_synced_at < now() - interval '48 hours') AS stale
    FROM plaid_items WHERE status <> 'revoked' ORDER BY id`);
  return r.rows;
}
