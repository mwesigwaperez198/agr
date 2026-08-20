-- Durable API order snapshots. Provider settlement records remain in the
-- canonical finance tables once provider IDs are normalized.
create table if not exists commerce.runtime_orders (
  id uuid primary key,
  buyer_id text not null,
  seller_id text not null,
  listing_id uuid not null,
  status text not null,
  reference text not null unique,
  idempotency_key text,
  request_hash text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runtime_orders_idempotency_unique unique (buyer_id, idempotency_key)
);
create index if not exists runtime_orders_buyer_idx on commerce.runtime_orders (buyer_id, created_at desc);
create index if not exists runtime_orders_seller_idx on commerce.runtime_orders (seller_id, created_at desc);
