-- FamilyOS Phase 1 schema (SPEC-PHASE1.md section 4)
-- Money is integer cents. Financial events are DATEs. TZ fixed America/New_York.

CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  pw_hash     TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recovery_codes (
  id        SERIAL PRIMARY KEY,
  user_id   INT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  used_at   TIMESTAMPTZ
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  reauth_at  TIMESTAMPTZ NOT NULL DEFAULT now()   -- last full auth, for sensitive actions
);

CREATE TABLE people (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'child',        -- owner|child|future
  born_on    DATE,
  notes_json JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE accounts (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,                   -- checking|savings|credit|loan|brokerage|retirement|realestate|business|cash
  owner_person_id INT REFERENCES people(id),
  is_manual       BOOLEAN NOT NULL DEFAULT TRUE,
  valuation       BIGINT NOT NULL DEFAULT 0,       -- cents; negative for debts
  valued_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  liquidity_flag  BOOLEAN NOT NULL DEFAULT TRUE,   -- false = illiquid (home, business)
  archived        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_snapshots (
  id         SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id),
  value      BIGINT NOT NULL,
  as_of      DATE NOT NULL,
  UNIQUE (account_id, as_of)
);

CREATE TABLE missions (                             -- user-facing name: Goal
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  person_id      INT REFERENCES people(id),
  bucket         TEXT NOT NULL DEFAULT 'save',     -- fixed|invest|save|fun|give
  target_amount  BIGINT,
  target_date    DATE,
  balance        BIGINT NOT NULL DEFAULT 0,
  sort_order     INT NOT NULL DEFAULT 100,
  opened_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_at      DATE
);

CREATE TABLE waterfall_profiles (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE waterfall_steps (
  id            SERIAL PRIMARY KEY,
  profile_id    INT NOT NULL REFERENCES waterfall_profiles(id),
  mission_id    INT NOT NULL REFERENCES missions(id),
  rule_kind     TEXT NOT NULL,                     -- fixed|percent|remainder|fill_to_target
  amount_or_pct BIGINT NOT NULL DEFAULT 0,         -- cents for fixed/fill, basis points for percent
  sort_order    INT NOT NULL
);

CREATE TABLE income_sources (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'salary',  -- salary|distribution|rent|irregular
  waterfall_profile_id INT REFERENCES waterfall_profiles(id)
);

CREATE TABLE income_events (
  id          SERIAL PRIMARY KEY,
  source_id   INT REFERENCES income_sources(id),
  amount      BIGINT NOT NULL,
  received_on DATE NOT NULL,
  logged_by   INT NOT NULL REFERENCES users(id),
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at TIMESTAMPTZ                          -- K2: within 48h of logged_at
);

CREATE TABLE mission_deposits (
  id              SERIAL PRIMARY KEY,
  mission_id      INT NOT NULL REFERENCES missions(id),
  amount          BIGINT NOT NULL,
  on_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  income_event_id INT REFERENCES income_events(id)
);

CREATE TABLE import_batches (
  id          SERIAL PRIMARY KEY,
  account_id  INT NOT NULL REFERENCES accounts(id),
  filename    TEXT,
  row_count   INT NOT NULL DEFAULT 0,
  imported_by INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id              SERIAL PRIMARY KEY,
  account_id      INT NOT NULL REFERENCES accounts(id),
  amount          BIGINT NOT NULL,                 -- negative = spend
  occurred_on     DATE NOT NULL,
  merchant        TEXT NOT NULL DEFAULT '',
  memo            TEXT NOT NULL DEFAULT '',
  bucket          TEXT,                            -- fixed|invest|save|fun|give (null = uncategorized)
  mission_id      INT REFERENCES missions(id),
  import_batch_id INT REFERENCES import_batches(id),
  dedupe_hash     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ok'       -- ok|suspect_dupe|dismissed
);
CREATE INDEX transactions_hash_idx ON transactions (dedupe_hash);
CREATE INDEX transactions_month_idx ON transactions (occurred_on);

CREATE TABLE rules (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,                 -- R1..R15
  title      TEXT NOT NULL,
  value_text TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'value'
);

CREATE TABLE rule_changes (
  id              SERIAL PRIMARY KEY,
  rule_id         INT NOT NULL REFERENCES rules(id),
  old_value       TEXT NOT NULL,
  new_value       TEXT NOT NULL,
  proposed_by     INT NOT NULL REFERENCES users(id),
  direction       TEXT NOT NULL,                   -- tighten|loosen
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_at    TIMESTAMPTZ NOT NULL,            -- loosen: +72h
  applied_at      TIMESTAMPTZ,
  acknowledged_by INT REFERENCES users(id)
);

CREATE TABLE constitution (
  id               SERIAL PRIMARY KEY,
  question         TEXT NOT NULL,
  answer           TEXT NOT NULL DEFAULT '',
  sort_order       INT NOT NULL,
  updated_at       TIMESTAMPTZ
);

CREATE TABLE constitution_signatures (
  id        SERIAL PRIMARY KEY,
  user_id   INT NOT NULL REFERENCES users(id),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE decisions (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  amount        BIGINT,
  asked_by      INT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'open',      -- open|decided
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  outcome       TEXT,                              -- proceed|wait|decline
  outcome_notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE decision_lenses (
  id          SERIAL PRIMARY KEY,
  decision_id INT NOT NULL REFERENCES decisions(id),
  lens        TEXT NOT NULL,                       -- rulebook|constitution|cashflow|opportunity|recommendation
  content     TEXT NOT NULL DEFAULT '',
  UNIQUE (decision_id, lens)
);

CREATE TABLE checkins (
  id             SERIAL PRIMARY KEY,
  week_of        DATE UNIQUE NOT NULL,             -- the Sunday
  kind           TEXT NOT NULL DEFAULT 'weekly',   -- weekly|monthly
  completed_by_1 INT REFERENCES users(id),
  completed_by_2 INT REFERENCES users(id),
  notes          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE books (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL,
  blurb      TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL,
  done_at    DATE,
  notes      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail_json JSONB NOT NULL DEFAULT '{}',
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only: no UPDATE or DELETE, ever, regardless of connection role.
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
