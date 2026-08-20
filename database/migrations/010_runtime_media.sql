create table if not exists commerce.runtime_media (
  id text primary key,
  owner_id text not null references identity.accounts(id) on delete cascade,
  safe_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  bytes bytea not null,
  byte_size integer not null check (byte_size between 100 and 1500000),
  width integer not null check (width between 160 and 4096),
  height integer not null check (height between 160 and 4096),
  scan_status text not null check (scan_status in ('development_validated','scanner_approved')),
  attached_listing_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists runtime_media_owner_idx on commerce.runtime_media(owner_id, created_at desc);
