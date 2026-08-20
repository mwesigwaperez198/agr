# HarvestLink foundation

A coffee-first, mobile-first marketplace and agricultural-assistance platform for Uganda. **HarvestLink is the configurable seed brand**, not a hard-coded product decision: app name, tagline, colours, AI name, fees, language and support details are runtime settings.

This repository contains two things:

1. a production architecture baseline (ERD, SQL schema, security/payment/AI/PWA decisions and phased roadmap), and
2. a runnable vertical foundation that demonstrates the farmer home, marketplace/search, listing detail, transparent checkout, server-verified sandbox payment event, coffee centre, structured agriculture AI, voice/photo UI, four-step listing flow, farmer profile and mobile admin CMS.

It is intentionally labelled **foundation**, not falsely presented as a completed regulated payment/AI system. Production integrations require provider credentials, legal/provider approval, migrations, object storage, identity, trained evaluations and operational controls described in the architecture.

## Features in the runnable slice

- Responsive desktop sidebar and mobile bottom navigation
- Config-driven brand and supported languages
- Low-data toggle, photo fallbacks and offline status
- Personalized farmer home with fresh/source-labelled prices
- Marketplace search, category/sort/verified filters and listing detail
- Coffee-specific marketplace/knowledge/buyer-demand centre
- Four-step camera-first “Sell your produce” flow
- Client preview plus validated server listing creation
- Transparent fee and seller-earnings breakdown
- Explicit order states, idempotent order creation and sandbox provider-event verification
- Structured, uncertainty-aware crop/animal AI answers
- Browser voice input/output when a capable device voice exists; honest fallback otherwise
- Crop photo preview and safety constraints
- Farmer profile, wallet projection and privacy cues
- Legitimate unauthenticated `GUEST` access state with `user = null` (never a fake account)
- Public home, safe market/farmer pages, learning, coffee information and administrator-limited AI
- Temporary deduplicated guest cart plus buyer-account merge and optional AI-conversation migration
- Server-owned `ADMIN`, `FARMER_SELLER` and `BUYER` account roles with opaque cookie sessions
- Role-specific dashboards, desktop navigation, mobile navigation, profiles and notifications
- Farmer-only listing ownership, seller orders, product management and ledger-backed earnings views
- Buyer search dashboard, participant-scoped orders, saved products and secure checkout
- Mobile-friendly admin CMS, user/role management, mandatory admin 2FA and audited changes
- Platform-wide English/Luganda localization with a cacheable draft catalogue, visible review status and audited administrator approval queue
- Runyankole and Acholi remain explicitly planned/disabled until reviewed catalogues are available
- Reusable backend role, permission, CSRF and resource-ownership policies
- PWA manifest and conservative service-worker shell

## Architecture

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), which covers all 18 design artifacts requested before implementation:

- system, database/ERD/schema, API, auth, payments, commission
- AI/RAG, translation, voice, CMS and storage
- security, PWA, deployment, UI design system, components and roadmap

Supporting documents:

- [`docs/ERD.md`](docs/ERD.md)
- [`database/schema.sql`](database/schema.sql)
- [`docs/API.md`](docs/API.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/ROLE_BASED_ACCESS.md`](docs/ROLE_BASED_ACCESS.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/ADMIN_CMS.md`](docs/ADMIN_CMS.md)
- [`docs/POSTGRESQL_PRODUCTION_BACKLOG.md`](docs/POSTGRESQL_PRODUCTION_BACKLOG.md) — approved work that begins after managed PostgreSQL deployment

## Requirements

- Node.js 20+
- npm 10+
- For the runnable slice, no database or external API key is required.
- For a production build: PostgreSQL 16, Redis-compatible cache/queue, S3-compatible storage, secrets manager, observability, AI/speech/translation providers and a Uganda-capable licensed payment provider.

## Installation

```bash
cp .env.example .env
npm install
```

The `.env.example` contains placeholders only. Never commit real credentials.

## Development

Run API and web in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8787`, so browser code never needs a localhost backend URL in a hosted preview.

The first screen is the real public agricultural application. Startup checks/restores a session before rendering: unauthenticated visitors remain on `/` as guests, while `/dashboard` resolves to the signed-in role dashboard. Login and registration appear only when explicitly opened or an account-only action requests them. Logout destroys the session and returns to public home.

Development role demos are selectable on the login screen:

```text
Farmer: sarah@example.ug / FarmerDemo!2026
Buyer:  daniel@okellofoods.ug / BuyerDemo!2026
Admin:  admin@harvestlink.ug / AdminDemo!2026 / MFA 246810
```

These fallbacks are disabled as usable credentials in `NODE_ENV=production`; deployment credentials and MFA must be provisioned securely.

## Testing and checks

```bash
npm test
npm run check
npm run build
```

The current automated test proves integer/basis-point commission behavior. Production gates in `docs/SECURITY.md` require a much larger suite: authentication, resource authorization/IDOR, uploads, rate limits, state machines, duplicate/mismatched/delayed payment events, refunds, reconciliation, ledger balance, AI safety/evaluation, accessibility and offline conflicts.

## Environment variables

See [`.env.example`](.env.example). Categories:

- runtime/public brand
- PostgreSQL, Redis and object storage
- session and delivery providers
- AI, embedding, translation and speech
- payment provider and signed webhook secret
- weather/maps
- observability
- development-only admin bootstrap

Secrets belong in a managed secret store. CMS settings store secret references, not secret values.

## Database setup

`database/schema.sql` is the reviewed logical baseline. In the production implementation, convert it to forward-only migration files and run migrations as a guarded deployment job. Do not apply destructive DDL directly to production. Enable PostGIS/pgvector after the deployment image includes the extensions.

## Production build

```bash
npm run build
```

The web output is generated under an excluded `dist` directory and should be deployed to an immutable static host/CDN. The API should be compiled into a minimal, non-root container with health/readiness probes.

## Deployment outline

1. Provision isolated development/staging/production accounts with infrastructure as code.
2. Create managed HA PostgreSQL with PITR, Redis, private object buckets, queue, KMS and observability.
3. Store credentials in a secrets manager; configure WAF/CDN and TLS.
4. Run lint/type/tests/security scans and guarded migrations.
5. Deploy API/workers with a rolling or canary release; deploy immutable web assets.
6. Run smoke tests for register → listing → order and AI safety fallback.
7. Verify dashboards, alerts, reconciliation and rollback.
8. Test restoration. A backup is not trusted until a restore succeeds.

## Admin setup

The role foundation uses server-owned users, scrypt-hashed development passwords, opaque `HttpOnly` sessions, per-session CSRF tokens, mandatory administrator MFA, explicit permissions and audited role changes. The demo session repository is in memory; production replaces it with the PostgreSQL/Redis adapters described in the architecture and uses Argon2id plus real TOTP/WebAuthn verification.

Create initial admin credentials from a secure deployment job using `DEV_ADMIN_PHONE`/`DEV_ADMIN_PASSWORD` only outside production. Production setup should issue an expiring invitation and require MFA enrollment. Public registration accepts only farmer/seller or buyer roles.

## Payment setup

The included sandbox endpoint validates amount and provider-event uniqueness to demonstrate server ownership of status. It moves no real money and is disabled when `NODE_ENV=production`.

Before enabling live payments:

1. complete Ugandan regulatory, tax, settlement and provider-contract review;
2. implement a provider adapter with raw-body signature verification and timestamp/replay limits;
3. certify mobile money/card flows in provider staging;
4. activate immutable fee snapshots and a balanced double-entry ledger;
5. implement refunds, payouts, disputes and daily reconciliation;
6. pass the financial test matrix and incident runbook exercise.

Never call settlement “escrow” unless a licensed provider contract actually supports it.

## AI setup

The foundation API returns safe deterministic examples. Production AI is an orchestrator with provider ports, hybrid RAG, source permissions, document review, structured answers, confidence/uncertainty, chemical/veterinary safety gates, cost budgets and evaluation telemetry.

Knowledge uploads remain quarantined until scan, parse and agricultural-expert approval. Retrieved text is untrusted data, not instructions. Image input is resized/compressed and metadata-stripped before a provider receives it.

## Translation and voice setup

- English is canonical UI source; Luganda is first local-language priority.
- ICU-style message catalogues and an expert-reviewed agriculture glossary replace the small demonstration dictionary.
- Machine translations are drafts and show source revision/review status.
- Voice uses a capability matrix per provider/language. Unsupported speech falls back to text; the product never fakes local-language pronunciation.
- The browser speech API in this slice is opportunistic only.

## Seed data

`apps/api/src/auth.ts` and `apps/api/src/data.ts` contain clearly fictional development users, listings, demand, articles, prices and admin metrics. Images in `apps/web/public/images` are generated demonstration assets. Do not treat demo prices as official live prices.

## Troubleshooting

### Web says it cannot connect

Start the API on port 8787, then reload. Check `http://localhost:8787/health`.

### Voice input does not start

Voice APIs vary by browser and installed language pack. Use HTTPS or localhost, grant microphone permission, and type instead if the browser does not expose a suitable recognizer.

### PWA does not install during development

The service worker registers only in a production build to avoid stale development assets. Build and serve over HTTPS for install testing.

### Images appear as icons

Data Saver deliberately suppresses listing media. Turn it off in the sidebar/profile. Missing uploads also use lightweight semantic placeholders.

### Admin request is forbidden

Sign in with an `ADMIN` account, complete the required MFA step, and ensure the account has the exact permission required by the endpoint. Client headers cannot grant a role.

### Login works but a preview immediately returns to sign-in

The embedded Arena development preview uses a secure partitioned cookie because it runs inside a sandboxed third-party frame. Standard local development uses a same-site cookie. Clear old preview cookies and sign in again after restarting the API because the demonstration session repository is in memory.

## Administrator CMS slice

All 22 administrator routes now use the unified application and server-owned permissions. The operational slice includes tailored module datasets, cross-domain search, live attention badges, responsive filterable tables and record drawers, human moderation queues, versioned commission and market-price workflows, protected payout/refund/security actions, CSV/XLSX/PDF finance export, language review/configuration, global platform controls and searchable append-only runtime audit events. The implementation contract and persistence gates are documented in `docs/ADMIN_CMS.md`.

## Next implementation milestone

The remaining production development is approved and intentionally deferred until managed PostgreSQL is deployed. The ordered backlog is in [`docs/POSTGRESQL_PRODUCTION_BACKLOG.md`](docs/POSTGRESQL_PRODUCTION_BACKLOG.md): durable repositories and translation publication, production TOTP/WebAuthn and revocable sessions, signed media quarantine, licensed payment-provider/ledger activation, observability and independent financial, security, compliance, Luganda and AI-safety reviews.

These are release gates, not capabilities claimed by the current in-memory development runtime.
