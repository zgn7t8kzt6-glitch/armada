-- Phase 2 slice: Plaid bank connections (SPEC-PHASE1.md 6.4 policies apply)
CREATE TABLE plaid_items (
  id             SERIAL PRIMARY KEY,
  item_id        TEXT UNIQUE NOT NULL,
  access_token   TEXT NOT NULL,
  institution    TEXT NOT NULL DEFAULT '',
  cursor         TEXT,
  last_synced_at TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'ok',   -- ok|error|revoked
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts     ADD COLUMN plaid_account_id TEXT UNIQUE;
ALTER TABLE accounts     ADD COLUMN plaid_item_id INT REFERENCES plaid_items(id);
ALTER TABLE transactions ADD COLUMN provider_id TEXT UNIQUE;
