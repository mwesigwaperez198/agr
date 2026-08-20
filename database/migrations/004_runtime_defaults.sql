BEGIN;
INSERT INTO content.system_settings(key, value_json)
VALUES ('runtime', '{"appName":"HarvestLink","tagline":"Connecting Farmers to Markets","currency":"UGX","defaultLanguage":"en","country":"Uganda","timezone":"Africa/Kampala","marketplaceEnabled":true,"aiEnabled":true,"notificationsEnabled":true,"coffeeHubEnabled":true,"buyerRequestsEnabled":true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value_json = CASE WHEN content.system_settings.value_json = '{}'::jsonb THEN excluded.value_json ELSE content.system_settings.value_json END;
COMMIT;
