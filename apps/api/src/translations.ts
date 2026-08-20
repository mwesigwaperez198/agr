import { readFileSync } from 'node:fs';
import { hydrateTranslations } from './db.js';

export type TranslationStatus = 'draft' | 'approved';
export type TranslationEntry = {
  id: string;
  language: string;
  source: string;
  text: string;
  status: TranslationStatus;
  domain: string;
  reviewedBy: string | null;
  updatedAt: string;
};

const lugandaDraftUrl = new URL('./l10n/lg.draft.json', import.meta.url);
export const translationEntries: TranslationEntry[] = JSON.parse(readFileSync(lugandaDraftUrl, 'utf8'));
await hydrateTranslations(translationEntries).catch(() => false);
let catalogVersion = Date.now();

export function translationVersion() {
  return catalogVersion;
}

export function publicTranslationBundle(language: string) {
  const entries = translationEntries.filter(entry => entry.language === language);
  return {
    language,
    version: catalogVersion,
    publicationStatus: entries.some(entry => entry.status === 'draft') ? 'draft' : 'approved',
    counts: {
      total: entries.length,
      approved: entries.filter(entry => entry.status === 'approved').length,
      draft: entries.filter(entry => entry.status === 'draft').length,
    },
    messages: Object.fromEntries(entries.map(entry => [entry.source, entry.text])),
  };
}

export function updateTranslationEntry(id: string, input: { text?: string; status?: TranslationStatus }, reviewerId: string) {
  const entry = translationEntries.find(item => item.id === id);
  if (!entry) return null;
  if (input.text !== undefined) entry.text = input.text.trim();
  if (input.status !== undefined) entry.status = input.status;
  entry.reviewedBy = input.status === 'approved' ? reviewerId : null;
  entry.updatedAt = new Date().toISOString();
  catalogVersion = Date.now();
  return entry;
}
