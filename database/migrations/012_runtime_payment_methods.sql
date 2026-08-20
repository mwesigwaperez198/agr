create table if not exists commerce.runtime_payment_methods (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
