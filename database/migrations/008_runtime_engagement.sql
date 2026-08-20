create table if not exists communication.runtime_state (
  kind text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
