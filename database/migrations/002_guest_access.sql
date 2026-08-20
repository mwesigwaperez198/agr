-- Guest access remains an unauthenticated application state. It is deliberately not added to iam.primary_role.
BEGIN;

CREATE TABLE IF NOT EXISTS content.system_settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES iam.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO content.system_settings(key, value_json)
VALUES (
  'guestAccess',
  '{"marketplace":true,"ai":true,"aiDailyLimit":3,"imageAnalysis":true,"imageDailyLimit":1,"voice":true,"articles":true,"productViewing":true,"farmerProfiles":true,"search":true,"cart":true}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.guest_daily_usage (
  subject_hash bytea NOT NULL,
  usage_day date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('text','voice','image')),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(subject_hash, usage_day, mode)
);
CREATE INDEX IF NOT EXISTS guest_daily_usage_expiry_idx ON public.guest_daily_usage(expires_at);

CREATE TABLE IF NOT EXISTS trade.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL UNIQUE REFERENCES iam.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trade.cart_items (
  cart_id uuid NOT NULL REFERENCES trade.carts(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES market.listings(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(cart_id, listing_id)
);

COMMIT;
