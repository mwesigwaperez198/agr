create table if not exists communication.runtime_ai_conversations (
  account_id text primary key references identity.accounts(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
