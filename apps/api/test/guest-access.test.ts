import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../src/auth.js';
import { settings } from '../src/data.js';
import { publicTranslationBundle, translationEntries } from '../src/translations.js';

test('GUEST is an access state and is never persisted as an account role', () => {
  assert.deepEqual(ROLES, ['ADMIN', 'FARMER_SELLER', 'BUYER']);
  assert.equal(ROLES.includes('GUEST' as never), false);
});

test('every required guest capability and per-mode limit is server-configured', () => {
  const guest = settings.guestAccess;
  for (const capability of ['marketplace', 'ai', 'imageAnalysis', 'voice', 'articles', 'productViewing', 'farmerProfiles', 'search', 'cart'] as const) {
    assert.equal(typeof guest[capability], 'boolean', `${capability} must be a server setting`);
  }
  assert.equal(Number.isInteger(guest.aiDailyLimit), true);
  assert.equal(Number.isInteger(guest.imageDailyLimit), true);
  assert.ok(guest.aiDailyLimit >= 0);
  assert.ok(guest.imageDailyLimit >= 0);
});

test('AI modality, account and short-window limits are server-configured', () => {
  assert.equal(typeof settings.aiEnabled, 'boolean');
  assert.equal(typeof settings.aiImageEnabled, 'boolean');
  assert.equal(typeof settings.aiVoiceEnabled, 'boolean');
  assert.equal(Number.isInteger(settings.aiAuthenticatedDailyLimit), true);
  assert.equal(Number.isInteger(settings.aiRateLimitPerFiveMinutes), true);
  assert.ok(settings.aiAuthenticatedDailyLimit >= 1 && settings.aiAuthenticatedDailyLimit <= 1000);
  assert.ok(settings.aiRateLimitPerFiveMinutes >= 1 && settings.aiRateLimitPerFiveMinutes <= 20);
});

test('Luganda catalogue covers every extracted platform phrase as a reviewable draft', () => {
  const ids = new Set(translationEntries.map(entry => entry.id));
  const sources = new Set(translationEntries.map(entry => entry.source));
  assert.equal(ids.size, translationEntries.length, 'translation ids must be unique');
  assert.equal(sources.size, translationEntries.length, 'source phrases must be unique');
  assert.ok(translationEntries.length > 1_100, 'the current whole-platform catalogue should remain comprehensive');
  assert.ok(translationEntries.every(entry => entry.language === 'lg' && entry.text.trim().length > 0));
  const bundle = publicTranslationBundle('lg');
  assert.equal(bundle.counts.total, translationEntries.length);
  assert.equal(bundle.publicationStatus, 'draft');
  assert.equal(bundle.messages['View farmer'], 'Laba omulimi');
});

test('only reviewed-ready languages are enabled in the selector', () => {
  const languages = Object.fromEntries(settings.supportedLanguages.map(language => [language.code, language]));
  assert.equal(languages.en.enabled, true);
  assert.equal(languages.lg.enabled, true);
  assert.equal(languages.nyn.enabled, false);
  assert.equal(languages.ach.enabled, false);
});
