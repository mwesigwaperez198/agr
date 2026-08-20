create table if not exists commerce.runtime_finance (
  kind text primary key check (kind in ('ledger','withdrawals','reviews')),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
