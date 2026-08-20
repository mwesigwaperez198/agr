# Security and privacy baseline

## Primary abuse cases

1. An attacker enumerates order/listing IDs to access another user's data (IDOR).
2. A buyer or seller changes price, fee, amount or payment status in a client request.
3. A fake provider callback marks an unpaid order paid or repeats a valid callback.
4. A privileged user changes commission or payout destination without strong authentication.
5. A media upload executes code, carries malware, abuses decompression or exposes GPS metadata.
6. Scam accounts move conversations off-platform or solicit advance payments.
7. Prompt injection in a document or user image changes AI policy or leaks private knowledge.
8. A stale market price is presented as current and causes harmful decisions.
9. Offline sync overwrites a seller's newer listing or duplicates an order.
10. Logs/backups expose passwords, tokens, identity evidence, precise locations or AI conversations.

## Required controls

- Deny-by-default server RBAC plus resource policies; automated negative access tests.
- Server-side price lookup and immutable order snapshot; client totals are display-only.
- Provider SDK/signature verification over raw body, timestamp/replay window, event uniqueness, amount/currency/merchant checks and reconciliation.
- WebAuthn/TOTP and step-up approval for admins; four-eyes workflow for financial configuration.
- Quarantine bucket, magic-byte/dimension/decompression checks, malware scan, metadata strip, generated keys and non-executable delivery.
- Link/phone pattern warnings, velocity limits, risk scores routed to human review, block/report and evidence retention.
- Treat retrieved content as untrusted data; isolate instructions, permission-filter retrieval, cite chunks, run prompt-injection and leakage evaluations.
- Market price freshness threshold, source, observed time and stale badge; no silent fallback to old “current” data.
- Client IDs, idempotency keys, optimistic versions and explicit conflict UI.
- Data classification/redaction; secrets manager; encrypted, access-logged backups; restore exercises.

## Security headers

Production: strict CSP with nonces/hashes, HSTS with preload after validation, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, CSP `frame-ancestors`, and cross-origin policies appropriate to media delivery.

## Release gates

- SAST, secret scan, dependency scan and lockfile review pass.
- Authentication, authorization, CSRF, rate-limit, upload and webhook negative tests pass.
- No critical/high unresolved findings; medium findings have owner and deadline.
- Payment amount mismatch, duplicate callback, delayed callback, partial refund and reconciliation tests pass.
- Privileged audit events are present and cannot be changed through application APIs.
- Backup restore and rollback path have been exercised in the release environment.
- Privacy impact review covers new personal data, retention, consent and deletion behavior.

## Incident priorities

Payment integrity, admin compromise and private identity-media exposure are severity 1. Runbooks rotate affected credentials, stop risky operations with feature flags, preserve evidence, reconcile financial state, notify responsible parties and document corrective actions.
