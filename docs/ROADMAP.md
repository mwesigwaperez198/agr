# Incremental delivery roadmap

## Phase 0 — discovery and safety foundations (2–4 weeks)

- Interview farmers, buyers, cooperatives, agriculture officers and support staff in at least three districts.
- Validate phone/OTP, terminology, Luganda voice and low-data prototypes on representative Android devices.
- Complete payment-provider/legal/tax due diligence before promising holding/settlement behavior.
- Establish threat model, privacy map, data retention, observability, infrastructure and CI gates.

**Exit:** tested task flows; architecture decisions; payment capability matrix; measurable performance/data budgets.

## Phase 1 — trustworthy market foundation (6–10 weeks)

Identity, onboarding, profiles, configurable taxonomy, listing wizard, media pipeline, marketplace/search, buyer account, admin moderation, settings, audit events and PWA offline shell.

**Exit:** a farmer publishes coffee in ≤3 minutes on target devices; a buyer finds it; authorization and upload security tests pass; admin content appears without rebuild.

## Phase 2 — coffee ecosystem (4–6 weeks)

Coffee metadata, dedicated dashboard, buyer requests, price provenance/history, coffee guides, cooperative profiles, harvest/grade terminology and targeted alerts.

**Exit:** price freshness is visible; request-to-farmer response is measured; content is expert reviewed.

## Phase 3 — agricultural AI (6–10 weeks)

Provider-independent AI gateway, RAG ingestion/review, structured answers, history, consented memory, crop/animal image analysis, expert escalation, safety evaluation and cost controls.

**Exit:** golden-set quality thresholds pass; dangerous certainty/pesticide/veterinary red-team cases pass; sources and uncertainty render correctly.

## Phase 4 — Luganda and voice (4–8 weeks)

Reviewed UI catalog, agricultural glossary, content translation workflow, capability-aware STT/TTS, transcript confirmation, audio retention and voice accessibility testing.

**Exit:** field test demonstrates useful Luganda tasks; unsupported voice is honestly surfaced; no fabricated audio support.

## Phase 5 — orders and finance (8–12 weeks)

Provider sandbox then certification, explicit order state machine, verified webhooks, commission engine, double-entry ledger, refunds, payouts, reconciliation, transparent fee UI, disputes and finance admin.

**Exit:** financial test matrix and provider certification pass; ledger always balances; restore/reconciliation drills pass; legal approval complete.

## Phase 6 — communication and growth (6–10 weeks)

Messaging, notifications, transaction-backed reviews, fraud review queue, featured listings, campaigns and measured natural-language market search.

## Phase 7 — farm tools (6–10 weeks)

Farms, fields, crop calendars, expenses, harvests, sales and simple yield/profit insights. Private by default with export/deletion handling.

## Phase 8 — optimization and regional readiness (continuous)

Real-user performance, byte budgets, image tuning, AI routing/caching, accessibility, additional reviewed languages, disaster exercises, localization of geography/regulation, and service extraction only where load/team boundaries justify it.

## PostgreSQL deployment-triggered production work

The following approved work begins after managed PostgreSQL is deployed:

1. Replace all in-memory repositories with transactional PostgreSQL adapters.
2. Persist translation review and versioned catalogue publication in `content.ui_translations`.
3. Replace development MFA with durable TOTP/WebAuthn enrollment, recovery and revocable sessions.
4. Activate signed uploads, private quarantine, scanning and safe media derivatives.
5. Integrate licensed payment providers, immutable ledger postings, refunds, payouts and reconciliation.
6. Complete independent financial, security, Uganda compliance, Luganda agricultural and AI-safety reviews.
7. Add production observability, backup/PITR, restore, rollback and incident exercises.

The implementation order, controls and exit criteria are maintained in [`POSTGRESQL_PRODUCTION_BACKLOG.md`](POSTGRESQL_PRODUCTION_BACKLOG.md). These items are deferred—not represented as deployed production capabilities.

## Definition of done for every slice

Product acceptance + tests + security/privacy + accessible keyboard/screen-reader states + offline/error/empty/loading states + analytics/alerts + support runbook + migration/rollback + documentation. “Looks complete” is not complete.
