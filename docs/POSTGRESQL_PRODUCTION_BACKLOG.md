# Post-PostgreSQL production development backlog

**Status:** Approved and deferred  

**Farmer commerce schema contract added:** `apps/api/migrations/20260816_001_farmer_commerce.sql` and `apps/api/src/farmer-commerce-repository.ts` now define the first production adapter boundary. The migration has not been applied because no PostgreSQL environment is configured; the runnable implementation remains explicitly development-only.
**Start condition:** Managed PostgreSQL has been deployed in the target environment and its connection is available through the secrets manager.  
**Scope decision:** The runnable application continues using development repositories until this start condition is met. The items below are planned production work, not currently active production capabilities.

## 1. Durable PostgreSQL repositories

Replace in-memory operational stores with transactional repository adapters for:

- users, role profiles, account status and verification evidence;
- sessions, MFA enrollment metadata and session revocation;
- listings, orders, reports, moderation assignments and notification campaigns;
- dynamic payment-method definitions, checkout visibility/default state, encrypted provider credentials, connection-test metadata and key-version references;
- payment events, immutable method/fee/configuration snapshots, immutable adjustments, commission versions and applied commission snapshots;
- payouts, market-price observations, advertisements, content and AI knowledge-source metadata;
- global settings, feature flags, language configuration and attention-queue projections;
- per-administrator operational record views with a unique `(admin_id, module, record_id)` key, immutable `first_viewed_at`, mutable `last_viewed_at`, and indexes for unread filters;
- append-only audit events, including actor, target, before/after values, result and session context.

### Required controls

- Apply forward-only migrations through a guarded deployment job.
- Use constraints and transactions for state transitions, ownership and financial invariants.
- Use row locking or compare-and-swap versions for concurrent approvals.
- Preserve idempotency keys and provider event IDs with unique database constraints.
- Keep financial and market-price history append-only; corrections create new records.
- Add indexes for admin search, moderation queues, order participants, audit history and effective-dated rules.
- Add PostgreSQL-backed integration tests, migration rollback/recovery tests and restore drills.

**Exit criteria:** API restarts do not lose state; concurrency tests pass; a point-in-time restore is demonstrated in staging.

## 2. Durable translation publication

Connect translation review APIs to `content.ui_translations` and versioned catalogue publication.

- Persist machine drafts, revisions, reviewer identity and approval time.
- Publish catalogue versions transactionally and invalidate public caches.
- Preserve prior source and translated versions for audit and rollback.
- Require fluent agricultural review for safety-sensitive terminology.
- Keep English fallback available when a reviewed translation is missing.

**Exit criteria:** A reviewed Luganda change survives restart, appears through the public bundle without rebuild and can be traced to its reviewer and prior version.

## 3. Production administrator authentication

Replace the shared development authenticator code with real enrollment and verification.

- Implement TOTP enrollment with encrypted-at-rest secrets and recovery codes.
- Add WebAuthn/passkey support for administrators and privileged operators.
- Store revocable session metadata durably; use Redis only as an optional acceleration layer.
- Require recent step-up verification for roles, payouts, refunds, security and high-impact configuration.
- Add failed-login, lockout, recovery, credential rotation and security-alert workflows.
- Do not use SMS as the only administrative factor.

**Exit criteria:** No development OTP fallback works in production; enrollment, recovery, revocation and step-up security tests pass.

## 4. Secure media and document pipeline

Activate production object storage and quarantine workers.

- Upload through signed, short-lived intents rather than API filesystem paths.
- Validate MIME type, extension, file signature, size and image dimensions.
- Strip metadata, generate safe filenames and create low-data derivatives.
- Virus-scan and quarantine identity evidence, content media and AI knowledge documents.
- Keep private verification evidence outside public buckets and executable paths.
- Record retention, reviewer access and deletion events.

**Exit criteria:** Malicious/polyglot upload tests pass; unscanned files are never public; access-control and retention tests pass.

## 5. Licensed payment-provider activation

Implement provider adapters only after database persistence and provider/legal approval.

- Persist the dynamic server-owned registry and encrypted credential envelopes in PostgreSQL; keep encryption keys in managed KMS/secrets infrastructure, record key versions, support rotation/re-encryption, and never persist plaintext or include secrets/masks in audit data.
- Verify signed raw-body webhooks with replay limits and unique provider event IDs.
- Store money in integer minor units and retain provider payload hashes, not secrets.
- Activate explicit payment, refund, reversal, dispute and payout state machines.
- Apply immutable commission snapshots to orders.
- Use balanced ledger postings that separate seller funds, provider fees and platform revenue.
- Add reconciliation jobs, mismatch queues, retry policy and incident runbooks.
- Never describe the service as escrow unless a licensed contractual arrangement permits it.

**Exit criteria:** Provider certification, webhook replay tests, ledger-balance tests, refund/payout tests and daily reconciliation pass in staging before production enablement.

## 6. Independent production reviews

The following reviews remain release blockers even after code completion:

- financial controls, ledger, settlement and reconciliation review;
- application security, authorization/IDOR, session, upload and infrastructure assessment;
- Uganda legal, tax, privacy and payment-provider compliance review;
- fluent Luganda agricultural, pesticide and veterinary terminology approval;
- AI safety evaluation for diagnosis uncertainty, pesticide use, veterinary escalation and human moderation;
- accessibility, low-end Android, slow-network and data-usage testing.

Findings must be tracked to closure or accepted by an accountable owner with a documented expiry date.

## 7. Deployment and observability

- Provision separate development, staging and production databases with least-privilege roles.
- Store credentials and encryption keys in a managed secrets service.
- Add readiness checks that verify required migrations without leaking connection details.
- Collect structured audit/security events without logging passwords, tokens, MFA secrets or raw private conversations.
- Add queue depth, failed webhook, payout, reconciliation, translation publication and moderation-age alerts.
- Define backup retention, point-in-time recovery, disaster recovery and rollback runbooks.

**Exit criteria:** Canary deployment, rollback, alerting and restore exercises pass in staging.

## Engagement persistence added to the target migration

The forward-only target migration now defines `identity.farmer_profiles`, `identity.buyer_profiles`, `opportunity.buyer_requests`, `opportunity.buyer_request_responses`, `communication.conversations`, `communication.conversation_participants`, `communication.messages`, and `communication.notifications`, including owner/participant foreign keys and active-response/unread indexes. The migration remains unapplied and has not been validated against PostgreSQL in this workspace.

Before enabling these HTTP routes in production:

- implement every `FarmerEngagementRepository` method with transactions and row-level state checks;
- use a database uniqueness constraint for one non-withdrawn farmer response per request and test concurrent submissions;
- expire requests/responses with both request-time checks and an idempotent scheduled job;
- derive conversation participants from persisted order/listing/response context in the same transaction;
- insert transactional notifications with the related operation or an outbox, then test retries without duplicates;
- define message retention/deletion policy, abuse reporting, attachment quarantine and delivery observability;
- run cross-account IDOR, concurrent decision, notification ownership, backup/restore and migration rollback-forward exercises.

## Required implementation order

1. Deploy managed PostgreSQL and guarded migration tooling.
2. Move identity, sessions, settings and append-only audit storage.
3. Move marketplace, moderation, content, translations and notifications.
4. Move order and financial records with immutable snapshots and ledger controls.
5. Activate secure object storage and quarantine workers.
6. Replace development MFA and complete administrator recovery/security workflows.
7. Integrate payment providers in staging and complete certification.
8. Complete independent reviews, restore drills and production release gates.

No item in this document should be marked implemented merely because a UI or in-memory demonstration exists. Completion requires the stated persistence, tests, operational runbooks and review evidence.
