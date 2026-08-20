create table if not exists audit.admin_record_views (
  admin_id text not null references identity.accounts(id) on delete cascade,
  module text not null,
  record_id text not null,
  first_viewed_at timestamptz not null,
  last_viewed_at timestamptz not null,
  unread boolean not null default false,
  primary key (admin_id, module, record_id)
);
create index if not exists admin_record_views_module_idx on audit.admin_record_views(module, unread);
