-- Primary-role migration for an existing deployment.
-- Run only through the guarded migration pipeline after taking a verified backup.
BEGIN;

DO $$ BEGIN
  CREATE TYPE iam.primary_role AS ENUM ('ADMIN','FARMER_SELLER','BUYER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE iam.users ADD COLUMN IF NOT EXISTS role iam.primary_role;
ALTER TABLE iam.users ADD COLUMN IF NOT EXISTS account_profile_type text;

-- Explicit legacy mapping. Review the unmapped report before enforcing NOT NULL.
UPDATE iam.users SET role = 'ADMIN' WHERE role IS NULL AND user_type = 'admin';
UPDATE iam.users SET role = 'FARMER_SELLER' WHERE role IS NULL AND user_type = 'farmer';
UPDATE iam.users SET role = 'BUYER' WHERE role IS NULL AND user_type IN ('buyer','general');

-- Agricultural professionals are deliberately not guessed. They require an approved
-- migration mapping because they may become AGRICULTURAL_EXPERT in a future release.
DO $$
DECLARE unresolved bigint;
BEGIN
  SELECT count(*) INTO unresolved FROM iam.users WHERE role IS NULL;
  IF unresolved > 0 THEN
    RAISE EXCEPTION 'Primary-role migration stopped: % users require explicit mapping', unresolved;
  END IF;
END $$;

ALTER TABLE iam.users ALTER COLUMN role SET NOT NULL;
CREATE INDEX IF NOT EXISTS users_role_status_idx ON iam.users(role, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit.role_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES iam.users(id),
  target_user_id uuid NOT NULL REFERENCES iam.users(id),
  old_role iam.primary_role NOT NULL,
  new_role iam.primary_role NOT NULL,
  reason text NOT NULL CHECK (length(reason) >= 3),
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_id <> target_user_id),
  CHECK (old_role <> new_role)
);
CREATE INDEX IF NOT EXISTS role_changes_target_idx ON audit.role_changes(target_user_id, occurred_at DESC);

-- Keep user_roles for future permission groups; iam.users.role remains the single
-- authoritative primary product role used for post-login routing.
COMMIT;
