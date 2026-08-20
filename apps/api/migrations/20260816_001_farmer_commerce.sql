-- Farmer/Seller product -> sale -> earnings production schema contract.
-- Forward-only migration. It is not applied by the development in-memory repository.
BEGIN;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS finance;
-- The baseline database/schema.sql already owns finance.commission_rules with
-- a different contract. Keep the commerce adapter's versioned rule snapshot
-- isolated until the application switches to this adapter completely.
CREATE SCHEMA IF NOT EXISTS commerce_finance;
CREATE SCHEMA IF NOT EXISTS trust;
CREATE SCHEMA IF NOT EXISTS opportunity;
CREATE SCHEMA IF NOT EXISTS communication;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS identity.accounts (
  id text PRIMARY KEY,
  primary_role text NOT NULL CHECK (primary_role IN ('ADMIN','FARMER_SELLER','BUYER')),
  status text NOT NULL CHECK (status IN ('ACTIVE','PENDING','SUSPENDED','DELETED')),
  verified boolean NOT NULL DEFAULT false,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.farmer_profiles (
  account_id text PRIMARY KEY REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  district text NOT NULL, approximate_location text NOT NULL, farm_type text NOT NULL,
  years_farming smallint NOT NULL DEFAULT 0 CHECK (years_farming BETWEEN 0 AND 80),
  coffee_specialization text, farming_tags text[] NOT NULL DEFAULT '{}', bio text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.buyer_profiles (
  account_id text PRIMARY KEY REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  district text NOT NULL, approximate_location text NOT NULL, business_name text, buyer_type text NOT NULL,
  interests text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.listing_drafts (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  current_step smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  category text NOT NULL,
  title text NOT NULL DEFAULT '', crop text NOT NULL DEFAULT '', coffee_type text, process text, grade text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '', harvest_date_text text NOT NULL DEFAULT '',
  production_method text NOT NULL DEFAULT 'conventional' CHECK (production_method IN ('organic','conventional','transitioning')),
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0), unit text NOT NULL DEFAULT 'kg',
  unit_price_ugx bigint NOT NULL DEFAULT 0 CHECK (unit_price_ugx >= 0),
  pricing_mode text NOT NULL DEFAULT 'fixed' CHECK (pricing_mode IN ('fixed','negotiable')),
  minimum_acceptable_price_ugx bigint CHECK (minimum_acceptable_price_ugx IS NULL OR minimum_acceptable_price_ugx >= 0),
  district text NOT NULL DEFAULT '', sub_region text NOT NULL DEFAULT '', approximate_location text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_acceptable_price_ugx IS NULL OR minimum_acceptable_price_ugx <= unit_price_ugx)
);
CREATE INDEX listing_drafts_owner_updated_idx ON commerce.listing_drafts(owner_id, updated_at DESC);

CREATE TABLE commerce.media_assets (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 100 AND 1500000),
  width integer NOT NULL CHECK (width BETWEEN 160 AND 4096), height integer NOT NULL CHECK (height BETWEEN 160 AND 4096),
  sha256 bytea NOT NULL UNIQUE,
  scan_status text NOT NULL CHECK (scan_status IN ('quarantined','approved','rejected')),
  scanner_reference text,
  created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
  CHECK ((scan_status = 'approved') = (approved_at IS NOT NULL))
);
CREATE INDEX media_assets_owner_created_idx ON commerce.media_assets(owner_id, created_at DESC);

CREATE TABLE commerce.draft_media (
  draft_id uuid NOT NULL REFERENCES commerce.listing_drafts(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES commerce.media_assets(id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
  PRIMARY KEY (draft_id, media_id), UNIQUE (draft_id, position)
);

CREATE TABLE commerce.listings (
  id uuid PRIMARY KEY,
  seller_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  source_draft_id uuid UNIQUE REFERENCES commerce.listing_drafts(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('published','paused','sold_out','archived')),
  category text NOT NULL, title text NOT NULL, crop text NOT NULL, coffee_type text, process text, grade text,
  description text NOT NULL, harvest_date_text text, production_method text NOT NULL,
  available_quantity bigint NOT NULL CHECK (available_quantity >= 0), unit text NOT NULL,
  unit_price_ugx bigint NOT NULL CHECK (unit_price_ugx >= 0), pricing_mode text NOT NULL CHECK (pricing_mode IN ('fixed','negotiable')),
  minimum_acceptable_price_ugx bigint CHECK (minimum_acceptable_price_ugx IS NULL OR minimum_acceptable_price_ugx <= unit_price_ugx),
  district text NOT NULL, sub_region text, approximate_location text NOT NULL,
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0), interested_buyer_count bigint NOT NULL DEFAULT 0 CHECK (interested_buyer_count >= 0),
  published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_public_search_idx ON commerce.listings(status, category, district, unit_price_ugx, available_quantity);
CREATE INDEX listings_seller_status_idx ON commerce.listings(seller_id, status, updated_at DESC);

CREATE TABLE commerce.listing_media (
  listing_id uuid NOT NULL REFERENCES commerce.listings(id) ON DELETE RESTRICT,
  media_id uuid NOT NULL REFERENCES commerce.media_assets(id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
  PRIMARY KEY (listing_id, media_id), UNIQUE (listing_id, position)
);

CREATE TABLE commerce_finance.commission_rules (
  id uuid PRIMARY KEY, version integer NOT NULL CHECK (version > 0),
  category text NOT NULL, seller_id text REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  rate_basis_points integer NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  status text NOT NULL CHECK (status IN ('draft','active','archived')),
  effective_from timestamptz NOT NULL, effective_to timestamptz,
  created_by text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, seller_id, version), CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX commission_rule_resolution_idx ON commerce_finance.commission_rules(category, seller_id, status, effective_from DESC, version DESC);

CREATE TABLE finance.payment_methods (
  id uuid PRIMARY KEY, provider text NOT NULL, display_name text NOT NULL, currency char(3) NOT NULL,
  fee_basis_points integer NOT NULL CHECK (fee_basis_points BETWEEN 0 AND 10000),
  enabled boolean NOT NULL DEFAULT false, checkout_visible boolean NOT NULL DEFAULT false,
  encrypted_credentials bytea NOT NULL, credential_key_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.orders (
  id uuid PRIMARY KEY, reference text NOT NULL UNIQUE,
  idempotency_key_hash bytea NOT NULL, buyer_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  seller_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  listing_id uuid NOT NULL REFERENCES commerce.listings(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('payment_pending','payment_verified','processing','ready_for_delivery','delivered','completed','cancelled','refunded','disputed')),
  listing_snapshot jsonb NOT NULL, seller_snapshot jsonb NOT NULL, buyer_snapshot jsonb NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0), unit text NOT NULL, unit_price_ugx bigint NOT NULL CHECK (unit_price_ugx >= 0),
  gross_ugx bigint NOT NULL CHECK (gross_ugx >= 0), commission_ugx bigint NOT NULL CHECK (commission_ugx >= 0),
  provider_fee_ugx bigint NOT NULL CHECK (provider_fee_ugx >= 0), buyer_total_ugx bigint NOT NULL CHECK (buyer_total_ugx >= 0),
  seller_net_ugx bigint NOT NULL CHECK (seller_net_ugx >= 0), currency char(3) NOT NULL DEFAULT 'UGX',
  commission_rule_id uuid NOT NULL REFERENCES commerce_finance.commission_rules(id) ON DELETE RESTRICT,
  commission_rule_snapshot jsonb NOT NULL, payment_method_id uuid NOT NULL REFERENCES finance.payment_methods(id) ON DELETE RESTRICT,
  payment_method_snapshot jsonb NOT NULL, inventory_reservation_status text NOT NULL CHECK (inventory_reservation_status IN ('reserved','released','consumed')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (buyer_id, idempotency_key_hash), CHECK (buyer_id <> seller_id),
  CHECK (gross_ugx = quantity * unit_price_ugx), CHECK (buyer_total_ugx = gross_ugx + provider_fee_ugx),
  CHECK (seller_net_ugx = gross_ugx - commission_ugx)
);
CREATE INDEX orders_seller_status_created_idx ON commerce.orders(seller_id, status, created_at DESC);
CREATE INDEX orders_buyer_status_created_idx ON commerce.orders(buyer_id, status, created_at DESC);
CREATE INDEX orders_listing_idx ON commerce.orders(listing_id, created_at DESC);

CREATE TABLE commerce_finance.payment_events (
  id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  provider text NOT NULL, provider_event_id text NOT NULL, provider_reference text NOT NULL,
  event_type text NOT NULL, signature_verified boolean NOT NULL, payload_hash bytea NOT NULL,
  amount_ugx bigint NOT NULL CHECK (amount_ugx >= 0), currency char(3) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  UNIQUE (provider, provider_event_id), UNIQUE (provider, provider_reference)
);
CREATE INDEX payment_events_order_idx ON commerce_finance.payment_events(order_id, received_at DESC);

CREATE TABLE finance.seller_ledger (
  id uuid PRIMARY KEY, order_id uuid NOT NULL UNIQUE REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  seller_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT, listing_id uuid NOT NULL REFERENCES commerce.listings(id) ON DELETE RESTRICT,
  order_reference text NOT NULL, product_snapshot text NOT NULL, quantity bigint NOT NULL, unit text NOT NULL, unit_price_ugx bigint NOT NULL,
  gross_ugx bigint NOT NULL, commission_ugx bigint NOT NULL, provider_fee_ugx bigint NOT NULL, net_ugx bigint NOT NULL,
  currency char(3) NOT NULL, commission_rule_snapshot jsonb NOT NULL, payment_method_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('available','withdrawn','reversed')),
  completed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_ledger_statement_idx ON finance.seller_ledger(seller_id, completed_at DESC, status);

CREATE OR REPLACE FUNCTION finance.reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'seller_ledger is append-only; post a separate reversal'; END $$;
CREATE TRIGGER seller_ledger_append_only BEFORE UPDATE OR DELETE ON finance.seller_ledger
FOR EACH ROW EXECUTE FUNCTION finance.reject_ledger_mutation();

CREATE TABLE finance.payout_methods (
  id uuid PRIMARY KEY, farmer_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('mobile_money','bank')), encrypted_identifier bytea NOT NULL,
  masked_identifier text NOT NULL, verified_at timestamptz, enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_methods_farmer_idx ON finance.payout_methods(farmer_id, enabled);

CREATE TABLE finance.withdrawals (
  id uuid PRIMARY KEY, farmer_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  payout_method_id uuid NOT NULL REFERENCES finance.payout_methods(id) ON DELETE RESTRICT,
  idempotency_key_hash bytea NOT NULL, amount_ugx bigint NOT NULL CHECK (amount_ugx > 0), fee_ugx bigint NOT NULL CHECK (fee_ugx >= 0),
  amount_received_ugx bigint NOT NULL CHECK (amount_received_ugx = amount_ugx - fee_ugx),
  payout_method_snapshot jsonb NOT NULL, status text NOT NULL CHECK (status IN ('requested','pending','approved','processing','completed','failed','reversed')),
  provider_transaction_id text, failure_reason text, step_up_session_id text,
  requested_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (farmer_id, idempotency_key_hash)
);
CREATE INDEX withdrawals_farmer_status_idx ON finance.withdrawals(farmer_id, status, requested_at DESC);

CREATE TABLE trust.completed_order_reviews (
  id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES commerce.orders(id) ON DELETE RESTRICT,
  buyer_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  farmer_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5), comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id), UNIQUE (order_id, buyer_id), CHECK (buyer_id <> farmer_id)
);
CREATE INDEX completed_order_reviews_farmer_idx ON trust.completed_order_reviews(farmer_id, created_at DESC);

CREATE TABLE opportunity.buyer_requests (
  id uuid PRIMARY KEY, buyer_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  product text NOT NULL, category text NOT NULL, quantity bigint NOT NULL CHECK (quantity > 0), unit text NOT NULL,
  minimum_unit_price_ugx bigint CHECK (minimum_unit_price_ugx IS NULL OR minimum_unit_price_ugx >= 0),
  maximum_unit_price_ugx bigint CHECK (maximum_unit_price_ugx IS NULL OR maximum_unit_price_ugx > 0),
  district text NOT NULL, description text NOT NULL, required_by date NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('open','closed','fulfilled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (maximum_unit_price_ugx IS NULL OR minimum_unit_price_ugx IS NULL OR maximum_unit_price_ugx >= minimum_unit_price_ugx),
  CHECK (required_by > expires_at::date)
);
CREATE INDEX buyer_requests_open_expiry_idx ON opportunity.buyer_requests(status, expires_at, category, district);
CREATE INDEX buyer_requests_buyer_idx ON opportunity.buyer_requests(buyer_id, created_at DESC);

CREATE TABLE opportunity.buyer_request_responses (
  id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES opportunity.buyer_requests(id) ON DELETE RESTRICT,
  farmer_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  listing_id uuid REFERENCES commerce.listings(id) ON DELETE SET NULL,
  quantity bigint NOT NULL CHECK (quantity > 0), unit_price_ugx bigint NOT NULL CHECK (unit_price_ugx > 0),
  message text NOT NULL, status text NOT NULL CHECK (status IN ('submitted','accepted','rejected','withdrawn','expired')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX buyer_request_one_active_response_idx ON opportunity.buyer_request_responses(request_id, farmer_id) WHERE status <> 'withdrawn';
CREATE INDEX buyer_request_responses_farmer_idx ON opportunity.buyer_request_responses(farmer_id, created_at DESC);

CREATE TABLE communication.conversations (
  id uuid PRIMARY KEY, context_type text NOT NULL CHECK (context_type IN ('listing','order','buyer_request')),
  context_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (context_type, context_id)
);
CREATE TABLE communication.conversation_participants (
  conversation_id uuid NOT NULL REFERENCES communication.conversations(id) ON DELETE RESTRICT,
  account_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(), last_read_at timestamptz,
  PRIMARY KEY (conversation_id, account_id)
);
CREATE INDEX conversation_participants_account_idx ON communication.conversation_participants(account_id, conversation_id);
CREATE TABLE communication.messages (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES communication.conversations(id) ON DELETE RESTRICT,
  sender_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT, body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX messages_conversation_created_idx ON communication.messages(conversation_id, created_at);
CREATE TABLE communication.notifications (
  id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  group_name text NOT NULL CHECK (group_name IN ('orders','market','messages','system')),
  title text NOT NULL, body text NOT NULL, action_url text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_owner_unread_idx ON communication.notifications(owner_id, read_at, created_at DESC);

CREATE TABLE audit.events (
  id uuid PRIMARY KEY, actor_id text REFERENCES identity.accounts(id) ON DELETE RESTRICT,
  action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL,
  before_value jsonb, after_value jsonb, reason text, result text NOT NULL,
  session_id text, device_fingerprint_hash bytea, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_target_idx ON audit.events(target_type, target_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit.events(actor_id, created_at DESC);
CREATE OR REPLACE FUNCTION audit.reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit.events is append-only'; END $$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit.events
FOR EACH ROW EXECUTE FUNCTION audit.reject_event_mutation();

COMMENT ON TABLE commerce.listing_drafts IS 'Owner-scoped, compare-and-swap versioned listing drafts; production API must set owner from the authenticated session.';
COMMENT ON TABLE finance.seller_ledger IS 'One immutable ledger entry per completed order. Reversals are separate append-only postings in the full double-entry ledger.';
COMMENT ON COLUMN commerce.orders.listing_snapshot IS 'Immutable buyer-facing product terms at order creation; never rewritten by listing edits.';
COMMENT ON COLUMN commerce.orders.payment_method_snapshot IS 'Immutable provider/fee configuration without provider credentials.';

COMMIT;
