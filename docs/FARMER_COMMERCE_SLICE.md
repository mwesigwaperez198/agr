# Farmer/Seller product → sale → earnings slice

**Implementation status:** runnable development repository with protected HTTP/UI integration. PostgreSQL, object storage, malware scanning, production payment webhooks and payout provider are not configured in this workspace. The application must not claim those provider-level states are complete.

## Runtime boundary

`apps/api/src/farmer-commerce.ts` is explicitly development-only and in-memory. It loses mutations when the API restarts. The target production schema is `apps/api/migrations/20260816_001_farmer_commerce.sql`; adapter boundaries are in `apps/api/src/farmer-commerce-repository.ts`.

The HTTP commerce surface also fails closed with `FARMER_COMMERCE_REPOSITORY_NOT_DEPLOYED` when `NODE_ENV=production`; production bootstrap responses do not expose seeded listings. This guard must be replaced—not bypassed—when the PostgreSQL/object-storage/provider adapters are implemented and validated.

Production media upload fails closed if `MEDIA_SCANNER_MODE=configured` is absent. Development performs bounded JPEG/PNG/WebP signature and dimension validation and labels the result `development_validated`, not malware-scanner approval.

Withdrawal requests stop truthfully at `requested`; no payout provider transaction ID is fabricated. A high-value request (UGX 1,000,000 or more in the development policy) requires an account with 2FA plus exact-amount confirmation and a valid current authenticator code.

## Protected farmer endpoints

All mutating endpoints require the session CSRF token. Ownership, role and money are derived server-side.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/farmer/dashboard` | Farmer-scoped listings, order and ledger aggregates |
| GET/POST | `/api/v1/farmer/listing-drafts` | List or create versioned drafts |
| GET/PATCH/DELETE | `/api/v1/farmer/listing-drafts/:id` | Owner-only resume, compare-and-swap autosave and delete |
| POST | `/api/v1/farmer/listing-images` | Bounded multipart image upload |
| DELETE | `/api/v1/farmer/listing-images/:id` | Delete owner media only when unattached |
| POST | `/api/v1/farmer/listing-quote` | Current versioned commission/default-provider estimate |
| POST | `/api/v1/farmer/listing-description-suggestion` | Farmer-approval AI boundary; currently returns truthful provider-not-configured state |
| POST | `/api/v1/farmer/listing-drafts/:id/publish` | Explicit confirmation and atomic draft publication boundary |
| GET | `/api/v1/farmer/listings?status=` | Owner products/drafts with server metrics |
| GET | `/api/v1/farmer/earnings?period=` | Completed-sale portfolio, chart, product performance, balances and withdrawals |
| GET | `/api/v1/farmer/earnings/statement` | Filtered CSV, XLSX or PDF statement |
| GET | `/api/v1/farmer/payout-methods` | Masked, owner payout methods |
| POST | `/api/v1/farmer/withdrawal-quote` | Backend fee, threshold and current-balance quote |
| POST | `/api/v1/farmer/withdrawals` | Verification/balance/2FA-checked withdrawal reservation |

## Marketplace and order endpoints

- `GET /api/v1/listings` supports product text, category, coffee type, farmer verification, price, quantity, approximate location, availability and sort filters. Public output excludes exact residential coordinates and private account details.
- `GET /api/v1/listings/:id/quote` derives buyer totals, commission and provider fee from current backend records.
- Order creation snapshots listing terms, active commission rule version and selected payment-method fees. It reserves inventory and remains `payment_pending` until provider/backend verification.
- Farmer lifecycle: `payment_verified → processing → ready_for_delivery → delivered`. A farmer cannot set payment or completion states.
- Buyer completion: `PATCH /api/v1/orders/:id/complete` only from `delivered`; only then is one immutable seller-ledger entry created.
- Buyer cancellation: `PATCH /api/v1/orders/:id/cancel` only while unpaid; reserved inventory is released.
- Buyer review: `POST /api/v1/orders/:id/review` requires the unique completed transaction, its buyer and a different seller account.

## Buyer opportunities and communications

The development slice now also includes server-owned buyer-request, profile and communication state. These routes share the production fail-closed guard and must not be described as durable until a `FarmerEngagementRepository` adapter is deployed.

- Buyers create requests with product, category, integer quantity/prices, broad district, required date and a separate response expiry. Buyers can list and close only their own requests.
- Expired requests are transitioned truthfully when read; submitted responses become expired. A farmer may have only one non-withdrawn response per request.
- Farmers cannot link another seller's listing. Accept/reject decisions are restricted to the request owner; acceptance fulfils the request and rejects competing submitted responses.
- Conversations cannot accept browser-supplied participant IDs. Participants are derived from an order, published listing or buyer-request response. Message reads/sends and unread counts require participation.
- Account notifications are generated by protected order, opportunity, review and message operations and are owner-scoped. No role-wide seed is presented as personal activity.
- Farmer and buyer profile writes use strict role-specific schemas, authenticated ownership and append-only audit events. Public farmer output retains only broad location and public farm fields.

Focused API coverage includes wrong-role response attempts, duplicate and fulfilled-request rejection, conversation IDOR, notification cross-account denial, profile shape validation, and production fail-closed behavior.

## Accounting invariants

- UGX values are safe integers; commission and provider rates use integer basis points.
- Browser-supplied prices, seller IDs, buyer IDs, commissions, balances and payment states are ignored.
- Listing edits never mutate order, payment, commission or ledger snapshots.
- Only completed orders enter the seller ledger; one ledger entry is allowed per order.
- Available balance is derived from available ledger entries less reserved/completed withdrawal amounts.
- Seller amount, platform commission, provider fees and buyer total remain separate fields. No escrow or banking claim is made.

## Required production work

1. Apply the migration through a guarded deployment job and implement the repository contract with transactions/row locks.
2. Replace API-buffer media with signed object-storage intents, quarantine, metadata stripping and a real scanner.
3. Implement raw-body signed payment webhooks with replay/idempotency controls and licensed provider validation.
4. Add a payout provider adapter, signed payout events, reconciliation and a balanced double-entry posting layer.
5. Replace development OTP handling with enrolled TOTP/WebAuthn and recent step-up sessions.
6. Run PostgreSQL concurrency, provider sandbox, malware corpus, mobile browser and restore tests before marking provider/deployment audit items complete.
