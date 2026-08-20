# API conventions

## Contract

Base path: `/api/v1`; HTTPS only outside local development. All timestamps are RFC 3339 UTC; display conversion is a client concern. IDs are opaque strings. Money is represented as integer UGX units in the currently runnable contracts; clients never submit authoritative prices, fees or balances.

The Farmer/Seller product → sale → earnings contracts, invariants and provider boundaries are detailed in [`FARMER_COMMERCE_SLICE.md`](./FARMER_COMMERCE_SLICE.md). The runnable farmer repository is development-only and in-memory; production durability and provider completion are not claimed.

Successful collection:

```json
{
  "data": [],
  "page": { "nextCursor": null, "hasMore": false },
  "meta": { "requestId": "req_..." }
}
```

Safe error (`application/problem+json`):

```json
{
  "type": "https://docs.example/errors/validation",
  "title": "Please check the highlighted information",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "errors": [{ "field": "quantity", "message": "Enter a quantity greater than zero" }],
  "traceId": "trace_..."
}
```

## Authentication and authorization

Browser clients send an opaque secure session cookie and CSRF token on unsafe methods. Resource handlers authorize both permission and ownership. Public endpoints serialize a public projection rather than stripping fields ad hoc.

## Idempotency

`POST /orders`, payment intents, refunds, payouts and listing publish accept an `Idempotency-Key`. The server stores actor, route, request hash, status and response. Reuse with a different body returns 409. Provider webhooks use the provider event ID as a second idempotency boundary.

## Caching

Public bootstrap, farmer profiles, articles and the dynamic PWA manifest return bounded `Cache-Control` policies with `stale-while-revalidate`. Market prices include source and `observedAt`; clients label stale values. CMS/configuration writes update the live API source immediately, while public caches revalidate within their short maximum age; production CDN adapters must purge the affected public cache keys on publish. Orders, payment paths and administrator endpoints use `private, no-store`.

## Sync

Offline drafts use a client-generated ID and `baseVersion`. `POST /sync/commands` processes commands independently and returns accepted, retryable and conflict results. Upload binaries use signed sessions before the sync command references the media asset.

## Guest/public permission matrix

`GUEST` is an application state, not a persisted user role. An unauthenticated request has no user record; the web client represents it as `user = null`, `role = GUEST`, `authenticated = false`.

| Capability | Guest | Farmer/seller | Buyer | Administrator |
|---|---:|---:|---:|---:|
| Public home, market information and announcements | Configurable | Yes | Yes | Yes |
| Marketplace search and public product detail | Configurable | Yes | Yes | Yes |
| Safe public farmer profile and learning articles | Configurable | Yes | Yes | Yes |
| Temporary device cart | Configurable | N/A | Merged on sign-in | N/A |
| Text, image and voice AI | Configurable daily limits | Yes | General access | Yes |
| Checkout/create order | No | No | Yes | No |
| Publish/manage own listing | No | Own only | No | Moderation only |
| Message, save, post, comment, notifications, profile/settings | No | Own/participant scope | Own/participant scope | Permission-scoped |
| Configure guest capabilities and limits | No | No | No | `settings.manage` |

Guest feature flags and limits are retrieved from the API. Disabling a public capability does not weaken or replace authentication, role, permission, active-account, ownership, participant or CSRF checks on protected APIs.

## Foundation API currently runnable

### Public and session

- `GET /api/v1/public/bootstrap`
- `GET /api/v1/public/manifest.webmanifest`
- `GET /api/v1/public/payment-methods` — only enabled, checkout-visible methods; no connector or credential metadata
- `GET /api/v1/public/farmers/:id`
- `GET /api/v1/public/articles?category=&limit=&cursor=`
- `GET /api/v1/public/articles/:slug`
- `GET /api/v1/public/translations/:language` (versioned, cacheable published catalogue; drafts are labelled)
- `GET /api/v1/listings?q=&category=&district=&sort=&limit=` (guest access configurable)
- `GET /api/v1/listings/:id` (guest access configurable; safe public projection)
- `POST /api/v1/ai/ask` (guest limits are mode-aware and administrator-configured)
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register` (farmer or buyer only)
- `GET /api/v1/me`
- `POST /api/v1/auth/logout`
- `GET /api/v1/bootstrap` (authenticated)

### Authenticated business operations

- `POST /api/v1/cart/merge` and `GET /api/v1/cart` (buyer)
- `POST /api/v1/ai/migrate-guest` (authenticated conversation migration)
- `GET /api/v1/listings/:id/quote` (backend-derived buyer, commission and provider-fee quote)
- `PATCH|DELETE /api/v1/listings/:id` (owner or authorized moderator; historical order snapshots remain immutable)
- `GET /api/v1/farmer/dashboard` (owner aggregates)
- `GET|POST /api/v1/farmer/listing-drafts`; `GET|PATCH|DELETE /api/v1/farmer/listing-drafts/:id` (owner-only versioned drafts)
- `POST|DELETE /api/v1/farmer/listing-images[/:id]` (bounded image upload and unattached-media removal)
- `POST /api/v1/farmer/listing-quote`; `POST /api/v1/farmer/listing-drafts/:id/publish`
- `GET /api/v1/farmer/listings?status=`
- `GET /api/v1/farmer/earnings?period=`; `GET /api/v1/farmer/earnings/statement?format=csv|xlsx|pdf`
- `GET /api/v1/farmer/payout-methods`; `POST /api/v1/farmer/withdrawal-quote`; `POST /api/v1/farmer/withdrawals`
- `GET /api/v1/buyer/saved`
- `GET /api/v1/orders` (role/participant filtered)
- `GET /api/v1/orders/:id` (participant or authorized admin)
- `POST /api/v1/orders` (buyer; requires an enabled `paymentMethodId` and stores immutable method, fee and commission snapshots)
- `PATCH /api/v1/orders/:id/status` (owning seller; fulfilment only)
- `PATCH /api/v1/orders/:id/complete|cancel` (owning buyer; strict state transitions)
- `POST /api/v1/orders/:id/review` (unique owning-buyer review after completion)
- `POST /api/v1/payments/sandbox/verify` (owning buyer; development only)
- `PATCH /api/v1/profile` (own farmer/buyer profile; role-specific strict fields and audited before/after values)
- `GET /api/v1/buyer-requests` (public-safe open/expired request search; authenticated farmers receive their own response state)
- `GET /api/v1/buyer/requests`; `POST /api/v1/buyer-requests`; `PATCH /api/v1/buyer-requests/:id/state` (buyer-owned demand lifecycle)
- `POST /api/v1/buyer-requests/:id/responses`; `PATCH /api/v1/buyer-request-responses/:id/withdraw` (unique active farmer response)
- `PATCH /api/v1/buyer-request-responses/:id/decision` (owning buyer accept/reject; acceptance fulfils the request and rejects competing submitted responses)
- `GET|POST /api/v1/conversations`; `GET|POST /api/v1/conversations/:id/messages`; `POST /api/v1/conversations/:id/read` (participants derived from listing, order or buyer-response context)
- `GET /api/v1/notifications`; `PATCH /api/v1/notifications/:id/read`; `POST /api/v1/notifications/read-all` (account-owned transactional notifications)

Buyer opportunities, conversations, messages, notifications and profile writes use the development in-memory engagement repository in this workspace. In production these routes fail closed with `FARMER_COMMERCE_REPOSITORY_NOT_DEPLOYED` until the `FarmerEngagementRepository` PostgreSQL adapter is deployed. Seeded role notifications are not exposed as account activity.

The current text agriculture assistant is a bounded development guidance implementation. All `/api/v1/ai/*` routes fail closed in production with `AGRICULTURAL_AI_PROVIDER_NOT_DEPLOYED`. Image mode fails in development with `AI_IMAGE_PROVIDER_NOT_CONFIGURED`; the browser does not upload or claim analysis of the selected photo. Production model, safety evaluation and conversation persistence remain release gates.

### Administrator

All administrator mutations require the authenticated active `ADMIN` role, the module permission and CSRF. Role, payout, refund, commission, security-session and high-impact configuration changes additionally require typed confirmation and a current authenticator code.

- `GET /api/v1/admin/dashboard` — command-centre data, attention queues, trends, alerts and recent audit activity
- `GET /api/v1/admin/attention` — current actionable queue counts for sidebar badges
- `GET|PATCH /api/v1/admin/ai-limits` — atomic global modality, guest, account-daily and five-minute AI policy with MFA step-up
- `GET /api/v1/admin/payment-methods` — administrator projection with masked credential metadata only
- `POST /api/v1/admin/payment-methods` — add a dynamic provider; requires `payment-methods.manage`, reason, `SAVE PAYMENT METHOD`, and authenticator OTP
- `PATCH /api/v1/admin/payment-methods/:id` — update method/configuration; blank credential fields retain existing encrypted values
- `POST /api/v1/admin/payment-methods/:id/action` — `enable`, `disable`, `set_default`, or server-side `test_connection`; configuration actions use target-ID/OTP step-up
- `DELETE /api/v1/admin/payment-methods/:id` — soft removal from configuration/checkout with reason and step-up; transaction snapshots remain unchanged
- `GET /api/v1/admin/search?q=` — cross-domain, privacy-minimised operational search
- `GET /api/v1/admin/operations/:module?q=&status=&readState=ALL|READ|UNREAD&cursor=&limit=` — tailored module contract with per-administrator `unread` and `readAt` metadata
- `PATCH /api/v1/admin/operations/:module/:id/read-state` — mark one authorized operational record read or unread for the current administrator only
- `POST /api/v1/admin/operations/:module/read-visible` — mark a bounded list of authorized, visible record IDs as read for the current administrator
- `POST /api/v1/admin/operations/:module/:id/action` — validated status/action workflow with before/after audit
- `POST /api/v1/admin/operations/:module` — supported content, price, campaign, notification and versioned commission creation
- `GET /api/v1/admin/operations/:module/export?format=csv|xlsx|pdf` — permission-scoped export
- `POST /api/v1/admin/operations/market-prices/import` — step-up protected historical price import; never overwrites observations
- `GET|PATCH /api/v1/admin/guest-settings` — high-impact publication uses step-up verification
- `GET /api/v1/admin/translations?language=&status=&domain=&q=&cursor=&limit=`
- `PATCH /api/v1/admin/translations/:id` — draft edit or audited human approval
- `PATCH /api/v1/admin/languages/:code` — enable/default, voice provider and fallback controls
- `GET /api/v1/admin/users`
- `PATCH /api/v1/admin/users/:id/role|status|verification` — role change uses typed confirmation and MFA
- `GET /api/v1/admin/audit-logs?q=&action=&cursor=&limit=` — append-only operational view
- `PATCH /api/v1/admin/settings/:key` — allowlisted setting publication; high-impact keys use step-up
- `POST /api/v1/admin/alerts`
- `GET /health`

## Administrator table read state

Operational table read state is personal viewing metadata, not a workflow decision. An authorized administrator receives `unread: true` and `readAt: null` until that administrator opens or explicitly marks the record read. Another administrator's view does not change it. Read/unread filtering occurs server-side after module permission checks, and record-state writes verify that the target exists in the authorized module to prevent cross-module IDOR. Marking a record read does not approve, verify, resolve, pay, refund, publish, or otherwise change its operational status. The current development repository stores this state in memory; the durable per-administrator table and uniqueness constraint remain part of the PostgreSQL production backlog.

## Payment-method security and lifecycle

Payment methods are records, not frontend constants. Checkout reads the public projection, so disabling or hiding a method removes it from new checkout responses immediately. Order creation resolves the selected ID server-side, validates currency and amount limits, calculates the provider fee from integer basis points, and stores immutable method/fee/commission snapshots. Verified payment records retain the method ID, name and provider snapshot for Payments and Finance reporting even if the current configuration is later disabled or removed.

Credential values are encrypted server-side with AES-256-GCM. Production startup requires `PAYMENT_CONFIG_ENCRYPTION_KEY` containing a base64-encoded 32-byte key. Administrator reads omit ciphertext and plaintext and return masks only. Safe audit projections omit both credential values and masks. The generic HTTPS connection tester requires HTTPS, rejects redirects and local/private destinations, applies a timeout, and executes only from the API.

The current runnable repository keeps this registry in the same development in-memory repository layer as other CMS/financial foundation records. Durable PostgreSQL configuration storage, managed-key rotation, licensed provider adapters, signed raw-body production webhooks, reconciliation and certification remain explicit release gates in `POSTGRESQL_PRODUCTION_BACKLOG.md`; they must not be inferred from the working CMS or sandbox adapter.

The sandbox verifier exists solely to demonstrate server-side amount validation, provider event/reference idempotency and immutable snapshot creation. It returns 404 in production and must never be enabled as a production provider.
