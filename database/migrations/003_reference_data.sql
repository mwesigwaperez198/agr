-- Reviewed reference data only. User, listing, order, and payment records are
-- intentionally created through protected application workflows or imports.
BEGIN;

INSERT INTO content.languages(code, name, native_name, is_default, is_enabled, voice_capability)
VALUES
  ('en', 'English', 'English', true, true, '{"text":true,"speech":"device"}'::jsonb),
  ('lg', 'Luganda', 'Luganda', false, true, '{"text":true,"speech":"device-dependent"}'::jsonb),
  ('nyn', 'Runyankole', 'Runyankole', false, false, '{"text":false,"speech":false}'::jsonb),
  ('ach', 'Acholi', 'Acholi', false, false, '{"text":false,"speech":false}'::jsonb)
ON CONFLICT (code) DO UPDATE SET name = excluded.name, native_name = excluded.native_name,
  is_default = excluded.is_default, voice_capability = excluded.voice_capability;

INSERT INTO market.categories(id, slug, kind, name_i18n_key, icon, sort_order)
VALUES
  (gen_random_uuid(), 'coffee', 'coffee', 'Coffee', 'coffee', 10),
  (gen_random_uuid(), 'crops', 'crop', 'Food crops', 'sprout', 20),
  (gen_random_uuid(), 'animals', 'animal', 'Animals', 'cow', 30),
  (gen_random_uuid(), 'inputs', 'input', 'Seeds & inputs', 'package', 40),
  (gen_random_uuid(), 'equipment', 'equipment', 'Equipment', 'tractor', 50)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO content.system_settings(key, value_json)
VALUES ('runtime', '{"appName":"HarvestLink","tagline":"Connecting Farmers to Markets","currency":"UGX","defaultLanguage":"en","country":"Uganda","timezone":"Africa/Kampala","marketplaceEnabled":true,"aiEnabled":true,"notificationsEnabled":true,"coffeeHubEnabled":true,"buyerRequestsEnabled":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
