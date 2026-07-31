-- ============================================================
-- Revital V3 — Supabase agent-side store schema (Wave 2, platform-data)
--
-- Plan §5 / wave2-contract §Agent-side store bridge: Supabase is the
-- Wave-2 TARGET for events / agent_runs / suggestions / fee ledger.
-- Signup is G3 (Eliran's click) — until then this schema runs only
-- against local Supabase (Docker) or the mocked client in
-- src/lib/persistence/mockSupabase.ts, which mirrors these rules.
--
-- Invariants:
--  * events and fee_ledger are APPEND-ONLY — UPDATE/DELETE blocked by
--    trigger, matching the client's append-only StageEvent log.
--  * Supabase is NEVER the card-state writer (single-writer, plan §3):
--    there are deliberately NO persons/deals tables here.
--  * All rows are keyed by access_code (auth stays access-code pre-G3;
--    Supabase Auth deferred). RLS is enabled with no policies — only the
--    service-role key (server) can touch these tables.
--  * `v` mirrors the server-assigned version counter from the Redis v3
--    section; `payload` always carries the full canonical JSON record so
--    no field is ever lost to column-mapping drift.
-- ============================================================

-- ---------- append-only enforcement ----------
create or replace function revital_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'table % is append-only (Revital V3 invariant)', tg_table_name;
end;
$$;

-- ---------- events (append-only stage-event log) ----------
create table if not exists events (
  access_code    text        not null,
  id             text        not null,
  deal_id        text        not null,
  from_stage     text,                              -- null = card creation
  to_stage       text        not null,
  ts             timestamptz not null,
  actor          text        not null check (actor in ('human', 'agent', 'system')),
  skipped_stages jsonb       not null default '[]'::jsonb,
  reason         text,
  v              bigint      not null default 0,
  payload        jsonb       not null,
  imported_at    timestamptz not null default now(),
  primary key (access_code, id)
);

create index if not exists events_deal_idx on events (access_code, deal_id, ts);

drop trigger if exists events_append_only on events;
create trigger events_append_only
  before update or delete on events
  for each row execute function revital_block_mutation();

-- ---------- agent_runs (execution log, rotated client/bridge-side) ----------
create table if not exists agent_runs (
  access_code         text        not null,
  id                  text        not null,
  agent               text        not null,
  trigger_kind        text        not null check (trigger_kind in ('cron', 'app_open', 'manual', 'event')),
  started_at          timestamptz not null,
  finished_at         timestamptz,
  items_processed     integer     not null default 0,
  suggestions_created integer     not null default 0,
  tokens_used         integer,
  outcome             text        not null check (outcome in ('ok', 'error', 'capped')),
  error               text,
  v                   bigint      not null default 0,
  payload             jsonb       not null,
  imported_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (access_code, id)
);

create index if not exists agent_runs_agent_idx on agent_runs (access_code, agent, started_at);

-- ---------- suggestions (agent output — the ONLY agent write, plan §3) ----------
create table if not exists suggestions (
  access_code text        not null,
  id          text        not null,
  agent       text        not null,
  kind        text        not null,
  deal_id     text,
  person_id   text,
  title       text        not null,
  body        text        not null,
  evidence    jsonb       not null default '[]'::jsonb,
  status      text        not null check (status in ('pending', 'accepted', 'dismissed')),
  created_at  timestamptz not null,
  resolved_at timestamptz,
  deleted     boolean     not null default false,   -- tombstone, never hard-delete
  v           bigint      not null default 0,
  payload     jsonb       not null,
  imported_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (access_code, id)
);

create index if not exists suggestions_status_idx on suggestions (access_code, status);

-- ---------- mandate_fees (current fee state per mandate) ----------
create table if not exists mandate_fees (
  access_code     text        not null,
  job_id          text        not null,
  kind            text        not null check (kind in ('percent', 'fixed')),
  percent         numeric,
  expected_salary numeric,
  fixed_amount    numeric,
  currency        text        not null default 'ILS' check (currency = 'ILS'),
  guarantee_days  integer     not null default 0,
  invoice_status  text        not null default 'none' check (invoice_status in ('none', 'due', 'sent', 'paid')),
  invoice_due_at  timestamptz,
  updated_at      timestamptz not null,
  payload         jsonb       not null,
  imported_at     timestamptz not null default now(),
  primary key (access_code, job_id)
);

-- ---------- fee_ledger (append-only fee/invoice change history) ----------
create table if not exists fee_ledger (
  access_code text        not null,
  id          text        not null,               -- deterministic: code:jobId:updatedAt
  job_id      text        not null,
  fee         jsonb       not null,               -- full MandateFee snapshot
  recorded_at timestamptz not null default now(),
  primary key (access_code, id)
);

create index if not exists fee_ledger_job_idx on fee_ledger (access_code, job_id, recorded_at);

drop trigger if exists fee_ledger_append_only on fee_ledger;
create trigger fee_ledger_append_only
  before update or delete on fee_ledger
  for each row execute function revital_block_mutation();

-- ---------- RLS: deny-all (service-role only, pre-G3) ----------
alter table events       enable row level security;
alter table agent_runs   enable row level security;
alter table suggestions  enable row level security;
alter table mandate_fees enable row level security;
alter table fee_ledger   enable row level security;
-- No policies on purpose: anon/authenticated see nothing; the server uses
-- the service-role key. Access-code scoping happens in server code until
-- Supabase Auth lands (post-G3 decision).
