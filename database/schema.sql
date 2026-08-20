-- PostgreSQL 16 logical baseline. Apply through reviewed migrations in production.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS market;
CREATE SCHEMA IF NOT EXISTS trade;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS comm;
CREATE SCHEMA IF NOT EXISTS farm;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TYPE iam.user_status AS ENUM ('pending','active','suspended','deleted');
CREATE TYPE iam.primary_role AS ENUM ('ADMIN','FARMER_SELLER','BUYER');
CREATE TYPE market.listing_status AS ENUM ('draft','pending_review','published','paused','sold','expired','rejected','archived');
CREATE TYPE content.workflow_status AS ENUM ('draft','pending_review','approved','published','rejected','archived');
CREATE TYPE trade.order_status AS ENUM ('created','payment_pending','payment_verified','processing','ready_for_delivery','delivered','completed','cancelled','refund_pending','refunded','disputed');
CREATE TYPE finance.payment_status AS ENUM ('created','provider_pending','verified','settled','failed','cancelled','expired','partially_refunded','refunded');
CREATE TYPE finance.payout_status AS ENUM ('created','review_required','submitted','paid','failed','cancelled');
CREATE TYPE comm.report_status AS ENUM ('open','triaged','investigating','resolved','dismissed');
CREATE TYPE ai.message_role AS ENUM ('user','assistant','system','tool');

CREATE TABLE iam.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text UNIQUE,
  email citext UNIQUE,
  password_hash text,
  display_name text NOT NULL,
  role iam.primary_role NOT NULL,
  account_profile_type text CHECK (account_profile_type IN ('individual_farmer','cooperative','farm_business','individual_buyer','business_buyer','platform_admin')),
  status iam.user_status NOT NULL DEFAULT 'pending',
  preferred_language text NOT NULL DEFAULT 'en',
  country_code char(2) NOT NULL DEFAULT 'UG',
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT user_identity_present CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE iam.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false
);
CREATE TABLE iam.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL
);
CREATE TABLE iam.user_roles (
  user_id uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES iam.roles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES iam.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE iam.role_permissions (
  role_id uuid NOT NULL REFERENCES iam.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES iam.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE iam.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  device_name text,
  ip_hash bytea,
  user_agent_hash bytea,
  mfa_level smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  rotated_from uuid REFERENCES iam.sessions(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active_idx ON iam.sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE iam.mfa_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('totp','webauthn','email','sms')),
  secret_ciphertext bytea,
  credential_json jsonb,
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE iam.verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id),
  level text NOT NULL CHECK (level IN ('basic','verified_farmer','trusted_seller','expert')),
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','expired')),
  evidence_object_key text,
  reviewed_by uuid REFERENCES iam.users(id),
  review_note text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE iam.farmer_profiles (
  user_id uuid PRIMARY KEY REFERENCES iam.users(id),
  public_slug text NOT NULL UNIQUE,
  bio text,
  district text,
  sub_county text,
  public_location_label text,
  years_farming smallint CHECK (years_farming BETWEEN 0 AND 100),
  cooperative_name text,
  phone_visibility text NOT NULL DEFAULT 'contacts_only' CHECK (phone_visibility IN ('hidden','contacts_only','public')),
  location_visibility text NOT NULL DEFAULT 'district' CHECK (location_visibility IN ('hidden','district','approximate')),
  profile_image_key text,
  rating_average numeric(3,2) NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  completed_transactions integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE iam.buyer_profiles (
  user_id uuid PRIMARY KEY REFERENCES iam.users(id),
  organization_name text,
  buyer_type text,
  district text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES market.categories(id),
  slug text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('coffee','crop','animal','input','equipment','service','other')),
  name_i18n_key text NOT NULL,
  icon text,
  listing_schema jsonb NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market.listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES iam.users(id),
  category_id uuid NOT NULL REFERENCES market.categories(id),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  available_quantity numeric(14,3) NOT NULL CHECK (available_quantity >= 0),
  unit text NOT NULL,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'UGX',
  negotiable boolean NOT NULL DEFAULT false,
  district text NOT NULL,
  sub_county text,
  availability_date date,
  harvest_date date,
  quality_grade text,
  delivery_options text[] NOT NULL DEFAULT '{}',
  contact_methods text[] NOT NULL DEFAULT '{in_app}',
  status market.listing_status NOT NULL DEFAULT 'draft',
  is_featured boolean NOT NULL DEFAULT false,
  moderation_note text,
  view_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_discovery_idx ON market.listings(status, category_id, district, created_at DESC);
CREATE INDEX listings_price_idx ON market.listings(status, unit_price_minor);
CREATE INDEX listings_title_trgm_idx ON market.listings USING gin(title gin_trgm_ops);

CREATE TABLE market.listing_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES market.listings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video')),
  object_key text NOT NULL,
  thumbnail_key text,
  width integer,
  height integer,
  size_bytes bigint NOT NULL,
  mime_type text NOT NULL,
  alt_text text,
  sort_order smallint NOT NULL DEFAULT 0,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market.coffee_details (
  listing_id uuid PRIMARY KEY REFERENCES market.listings(id) ON DELETE CASCADE,
  species text CHECK (species IN ('arabica','robusta','blend','other')),
  variety text,
  processing_method text,
  processing_stage text,
  grade text,
  moisture_percent numeric(4,2) CHECK (moisture_percent BETWEEN 0 AND 100),
  harvest_season text,
  packaging text,
  farm_or_cooperative text,
  certification text
);
CREATE TABLE market.buyer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES iam.users(id),
  category_id uuid REFERENCES market.categories(id),
  product_name text NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  quality text,
  district text NOT NULL,
  required_by date,
  min_price_minor bigint,
  max_price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'UGX',
  delivery_requirements text,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','matched','closed','expired')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE farm.farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES iam.users(id),
  name text NOT NULL,
  district text NOT NULL,
  sub_county text,
  village_ciphertext bytea,
  area_hectares numeric(12,3),
  public_visibility text NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE farm.farm_crops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES farm.farms(id) ON DELETE CASCADE,
  category_id uuid REFERENCES market.categories(id),
  variety text,
  planted_on date,
  expected_harvest_on date,
  area_hectares numeric(12,3),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE farm.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES farm.farms(id) ON DELETE CASCADE,
  crop_id uuid REFERENCES farm.farm_crops(id),
  kind text NOT NULL,
  occurred_on date NOT NULL,
  notes text,
  cost_minor bigint CHECK (cost_minor >= 0),
  currency char(3) DEFAULT 'UGX',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trade.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE,
  buyer_id uuid NOT NULL REFERENCES iam.users(id),
  seller_id uuid NOT NULL REFERENCES iam.users(id),
  status trade.order_status NOT NULL DEFAULT 'created',
  currency char(3) NOT NULL,
  item_subtotal_minor bigint NOT NULL CHECK (item_subtotal_minor >= 0),
  platform_fee_minor bigint NOT NULL CHECK (platform_fee_minor >= 0),
  payment_fee_minor bigint NOT NULL CHECK (payment_fee_minor >= 0),
  delivery_fee_minor bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  seller_net_minor bigint NOT NULL,
  delivery_method text,
  delivery_address_ciphertext bytea,
  idempotency_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, idempotency_key),
  CHECK (total_minor = item_subtotal_minor + payment_fee_minor + delivery_fee_minor),
  CHECK (seller_net_minor <= item_subtotal_minor)
);
CREATE INDEX orders_buyer_idx ON trade.orders(buyer_id, created_at DESC);
CREATE INDEX orders_seller_idx ON trade.orders(seller_id, created_at DESC);

CREATE TABLE trade.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES trade.orders(id) ON DELETE RESTRICT,
  listing_id uuid REFERENCES market.listings(id) ON DELETE SET NULL,
  title_snapshot text NOT NULL,
  category_snapshot jsonb NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  seller_snapshot jsonb NOT NULL,
  product_snapshot jsonb NOT NULL
);
CREATE TABLE trade.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES trade.orders(id),
  from_status trade.order_status,
  to_status trade.order_status NOT NULL,
  actor_id uuid REFERENCES iam.users(id),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trade.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES trade.orders(id),
  reviewer_id uuid NOT NULL REFERENCES iam.users(id),
  reviewee_id uuid NOT NULL REFERENCES iam.users(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  moderation_status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, reviewer_id, reviewee_id)
);
CREATE TABLE trade.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES trade.orders(id),
  opened_by uuid NOT NULL REFERENCES iam.users(id),
  reason_code text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolved_by uuid REFERENCES iam.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE finance.commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('global','category','listing','seller','promotion')),
  scope_id uuid,
  basis_points integer CHECK (basis_points BETWEEN 0 AND 10000),
  fixed_minor bigint CHECK (fixed_minor >= 0),
  currency char(3),
  min_minor bigint,
  max_minor bigint,
  priority integer NOT NULL DEFAULT 0,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES iam.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (basis_points IS NOT NULL OR fixed_minor IS NOT NULL)
);
CREATE TABLE finance.commission_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES trade.orders(id),
  order_item_id uuid REFERENCES trade.order_items(id),
  rule_id uuid REFERENCES finance.commission_rules(id),
  rule_snapshot jsonb NOT NULL,
  gross_minor bigint NOT NULL,
  commission_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE finance.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES trade.orders(id),
  provider text NOT NULL,
  provider_reference text UNIQUE,
  idempotency_key text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  status finance.payment_status NOT NULL DEFAULT 'created',
  provider_status text,
  expires_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, idempotency_key)
);
CREATE TABLE finance.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payment_intent_id uuid REFERENCES finance.payment_intents(id),
  signature_valid boolean NOT NULL,
  amount_minor bigint,
  currency char(3),
  raw_payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider, provider_event_id)
);
CREATE TABLE finance.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid,
  account_type text NOT NULL,
  currency char(3) NOT NULL,
  normal_side char(1) NOT NULL CHECK (normal_side IN ('D','C')),
  status text NOT NULL DEFAULT 'active',
  UNIQUE(owner_type, owner_id, account_type, currency)
);
CREATE TABLE finance.ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  description text NOT NULL,
  reverses_transaction_id uuid REFERENCES finance.ledger_transactions(id),
  created_by uuid REFERENCES iam.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE finance.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES finance.ledger_transactions(id),
  account_id uuid NOT NULL REFERENCES finance.ledger_accounts(id),
  side char(1) NOT NULL CHECK (side IN ('D','C')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON finance.ledger_entries(account_id, created_at);
CREATE TABLE finance.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES trade.orders(id),
  payment_intent_id uuid NOT NULL REFERENCES finance.payment_intents(id),
  provider_reference text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'created',
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES iam.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE finance.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES iam.users(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  provider text NOT NULL,
  destination_token text NOT NULL,
  provider_reference text UNIQUE,
  status finance.payout_status NOT NULL DEFAULT 'created',
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE content.languages (
  code text PRIMARY KEY,
  name text NOT NULL,
  native_name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT false,
  text_direction text NOT NULL DEFAULT 'ltr',
  voice_capability jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE content.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  value_type text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('public','server','secret_reference')),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES iam.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content.ui_translations (
  language_code text NOT NULL REFERENCES content.languages(code),
  message_key text NOT NULL,
  value text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  source_revision integer NOT NULL DEFAULT 1,
  reviewed_by uuid REFERENCES iam.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(language_code, message_key)
);
CREATE TABLE content.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  category text NOT NULL,
  author_id uuid NOT NULL REFERENCES iam.users(id),
  source_language text NOT NULL REFERENCES content.languages(code),
  title text NOT NULL,
  summary text NOT NULL,
  body_json jsonb NOT NULL,
  hero_object_key text,
  status content.workflow_status NOT NULL DEFAULT 'draft',
  source_revision integer NOT NULL DEFAULT 1,
  reviewed_by uuid REFERENCES iam.users(id),
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content.article_translations (
  article_id uuid NOT NULL REFERENCES content.articles(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES content.languages(code),
  title text NOT NULL,
  summary text NOT NULL,
  body_json jsonb NOT NULL,
  workflow_status text NOT NULL DEFAULT 'draft',
  source_revision integer NOT NULL,
  reviewed_by uuid REFERENCES iam.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(article_id, language_code)
);
CREATE TABLE content.market_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES market.categories(id),
  product_name text NOT NULL,
  grade text,
  district text NOT NULL,
  unit text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'UGX',
  source_name text NOT NULL,
  source_url text,
  observed_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX market_prices_latest_idx ON content.market_prices(product_name, district, observed_at DESC);
CREATE TABLE content.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','urgent')),
  title text NOT NULL,
  body text NOT NULL,
  districts text[] NOT NULL DEFAULT '{}',
  categories uuid[] NOT NULL DEFAULT '{}',
  status content.workflow_status NOT NULL DEFAULT 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid NOT NULL REFERENCES iam.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id),
  title text NOT NULL,
  language_code text NOT NULL,
  topic text,
  memory_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE ai.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai.conversations(id) ON DELETE CASCADE,
  role ai.message_role NOT NULL,
  content_json jsonb NOT NULL,
  model_name text,
  prompt_tokens integer,
  completion_tokens integer,
  safety_labels jsonb NOT NULL DEFAULT '{}',
  confidence text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai.image_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES ai.messages(id),
  object_key text NOT NULL,
  analysis_type text NOT NULL CHECK (analysis_type IN ('crop','animal','market_listing')),
  result_json jsonb,
  model_name text,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  publisher text,
  source_url text,
  language_code text NOT NULL,
  object_key text NOT NULL,
  authority_level smallint NOT NULL DEFAULT 1,
  published_on date,
  reviewed_on date,
  permission_scope text NOT NULL DEFAULT 'public_ai',
  ingestion_status text NOT NULL DEFAULT 'uploaded',
  approved_by uuid REFERENCES iam.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ai.knowledge_documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  page_number integer,
  content text NOT NULL,
  content_hash bytea NOT NULL,
  tags jsonb NOT NULL DEFAULT '{}',
  -- embedding vector(1536),
  UNIQUE(document_id, ordinal)
);
CREATE TABLE ai.user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id),
  memory_key text NOT NULL,
  value_json jsonb NOT NULL,
  consented_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, memory_key)
);

CREATE TABLE comm.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid REFERENCES market.listings(id),
  order_id uuid REFERENCES trade.orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comm.conversation_members (
  conversation_id uuid NOT NULL REFERENCES comm.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.users(id),
  last_read_at timestamptz,
  blocked_at timestamptz,
  PRIMARY KEY(conversation_id, user_id)
);
CREATE TABLE comm.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES comm.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES iam.users(id),
  body text,
  media_object_key text,
  moderation_labels jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK(body IS NOT NULL OR media_object_key IS NOT NULL)
);
CREATE TABLE comm.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  action_url text,
  metadata jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON comm.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE TABLE comm.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES iam.users(id),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason_code text NOT NULL,
  details text,
  status comm.report_status NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES iam.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE audit.logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES iam.users(id),
  actor_type text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  request_id text,
  ip_hash bytea,
  before_hash bytea,
  after_hash bytea,
  metadata jsonb NOT NULL DEFAULT '{}',
  previous_record_hash bytea,
  record_hash bytea NOT NULL
);
CREATE INDEX audit_actor_idx ON audit.logs(actor_id, occurred_at DESC);
CREATE INDEX audit_target_idx ON audit.logs(target_type, target_id, occurred_at DESC);

-- CMS-owned live configuration. Guest access remains configuration, never a user role.
CREATE TABLE content.system_settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES iam.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Abuse-resistant anonymous quotas use a rotating opaque subject hash, not a fake user.
CREATE TABLE public.guest_daily_usage (
  subject_hash bytea NOT NULL,
  usage_day date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('text','voice','image')),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(subject_hash, usage_day, mode)
);
CREATE INDEX guest_daily_usage_expiry_idx ON public.guest_daily_usage(expires_at);

-- A device-local guest cart is merged into this account cart only after authentication.
CREATE TABLE trade.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL UNIQUE REFERENCES iam.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trade.cart_items (
  cart_id uuid NOT NULL REFERENCES trade.carts(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES market.listings(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(cart_id, listing_id)
);

-- Transactional outbox: commits domain changes and integration events atomically.
CREATE TABLE public.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished_idx ON public.outbox_events(created_at) WHERE published_at IS NULL;

-- Idempotency store for client commands.
CREATE TABLE public.idempotency_keys (
  actor_id uuid NOT NULL REFERENCES iam.users(id),
  route text NOT NULL,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, route, key)
);
