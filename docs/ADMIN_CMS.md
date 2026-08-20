# Administrator CMS implementation contract

**Status:** Active contract  
**Applies to:** The unified application under `/admin/*`  
**Product date:** 16 August 2026

## Operating boundary

Administrators manage, monitor, verify, configure, protect and operate the platform. They do not buy products, publish farmer listings, fulfil seller orders or perform other buyer/farmer marketplace activities. The server is the authority for identity, active status, role, permission and resource policy.

Every administrator module must provide a purpose-specific workflow, not a visual placeholder. Operational collections include server-side search and filters, pagination when needed, details, status and audit history, exports where applicable, responsive loading/empty/error states, and actions that reflect the administrator's permissions.

## Shared administrator capabilities

- Global search covers users, farmers, buyers, products, orders, payments, market prices, reports and advertisements. Search results are privacy-minimised and link to the responsible module.
- The sidebar displays live attention counts for farmer verification, moderation, payouts, reports, failed payments and future actionable queues.
- Mutations require an authenticated active administrator, the module permission, CSRF validation, schema validation and an append-only audit event with actor, target, before/after values, reason, result and time.
- High-risk finance, payout, role and security operations require a clear typed confirmation and current authenticator step-up. Administrative 2FA is mandatory and must not rely only on SMS.
- Financial records are immutable. Successful payment amounts cannot be edited. Corrections use refunds, reversals or separate adjustment records. Seller money, platform revenue and provider fees remain separate.
- Uncertain fraud or AI safety signals enter a human review queue; they do not permanently ban or enforce on their own.
- Exact residential coordinates, full private conversations and unnecessary sensitive fields are never exposed in analytics or operational lists.

## Route responsibilities

1. `/admin/dashboard` — command centre with core statistics, attention queues, revenue trends, marketplace breakdown, operational alerts, live activity and quick links.
2. `/admin/users` — master search and filters, profile detail, verification, status, role, 2FA, activity, reports, listings and orders.
3. `/admin/farmers` — farmer and farm detail, products, orders, revenue, complaints, evidence-led verification, ratings and verified badges.
4. `/admin/buyers` — buyer profile, purchases, saved items, messages, reports, reviews, activity, verification and account controls.
5. `/admin/marketplace` — category and listing moderation, safe correction, approval, suspension/removal, verification, featuring, images, views and linked orders.
6. `/admin/orders` — global lifecycle, immutable financial breakdown, participants, delivery, timeline, messages, disputes, cancellations and refunds.
7. `/admin/payments` — immutable provider transactions, status investigation, provider-supported verification/retry/refund workflows and export.
8. `/admin/commissions` — versioned rules by category, seller, amount, campaign and date. Existing orders retain their original applied rule.
9. `/admin/payouts` — payout totals, review, approval/process/retry/hold/release, history, permissions, high-value confirmation, 2FA and audit.
10. `/admin/finance` — GMV, commission/platform/net revenue, payouts, refunds, fees, trends, category/region summaries and CSV/Excel/PDF export.
11. `/admin/market-prices` — commodity, grade, region, source and effective history; charts; add/schedule/publish/archive/import without overwriting prior prices.
12. `/admin/content` — multilingual agricultural CMS with safe media, tags, rich content, workflow states, scheduling and reviewable AI assistance.
13. `/admin/ai` — privacy-conscious usage/log summaries, knowledge sources, safety, models, limits and guest/image/voice/rate configuration.
14. `/admin/advertisements` — review, placement, schedule, approval/pause/resume/removal, budget and performance analytics.
15. `/admin/reports` — user/content/message/advertisement/fraud investigations, escalation and logged enforcement.
16. `/admin/analytics` — user, retention, marketplace, coffee, category, regional, supply/demand and conversion trends without precise-location exposure.
17. `/admin/notifications` — audiences, channels, drafts, scheduling and delivery/read/failure history.
18. `/admin/moderation` — priority queue, assignment, evidence, approve/reject/remove/suspend/escalate/request-change workflows and human review.
19. `/admin/languages` — enable/default languages, translations, machine-draft → human review → approval → publication, voice/provider/fallback controls.
20. `/admin/settings` — configurable identity/navigation, Uganda/UGX defaults, marketplace, AI, notifications, maintenance, banner and feature flags.
21. `/admin/security` — 2FA, sessions, login failures, suspicious activity, privacy-safe IP controls, alerts, policies, revocation and mandatory administrator MFA.
22. `/admin/audit-logs` — searchable, append-only, tamper-resistant sensitive action history with actor, target, session context, before/after values, result and time. Ordinary administrators cannot delete records.

## Domain invariants

- Commission rules and market-price entries are versioned; published history is never silently overwritten.
- Payment success is accepted only from signed, idempotent, server-verified provider events.
- Payout approvals never create pseudo-escrow claims; compliant providers remain replaceable.
- Agricultural translations and AI-assisted content remain visibly draft until human approval.
- CMS changes flow database/API → live clients with cache invalidation; publication never requires source editing or an application rebuild.
- Uploads are checked by MIME, extension, signature, dimensions and size, receive safe filenames, and remain outside executable paths.

## Delivery gates

A module is complete only when its route, dedicated server operation, permission tests, validation, CSRF protection, audit trail, loading/empty/error states, mobile behavior and relevant export/history requirements pass.

Production completion additionally requires PostgreSQL persistence for all operational records, durable translation publication, production administrator MFA, secure media quarantine, licensed payment integration and independent security, financial, compliance, AI-safety and Luganda agricultural review. This work is approved and deferred until managed PostgreSQL deployment; its ordered checklist and exit criteria are maintained in [`POSTGRESQL_PRODUCTION_BACKLOG.md`](POSTGRESQL_PRODUCTION_BACKLOG.md).
