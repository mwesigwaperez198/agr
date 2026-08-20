# Role-based access architecture

## Primary role model

`iam.users.role` is the authoritative primary product role:

- `ADMIN` — manages the ecosystem
- `FARMER_SELLER` — grows, learns, lists and fulfils
- `BUYER` — discovers, purchases and tracks

One account has one primary role. `iam.roles`, `permissions` and their mapping tables remain available for future granular permission groups, but they do not make an account silently multi-role. New roles can be added through an enum migration plus permission/dashboard policy without creating separate applications.

`GUEST` is a client/application access state, not a stored account role. It always means `user = null`, `role = GUEST`, `authenticated = false`. No fake guest identity is inserted into `iam.users`; only an opaque, non-account cookie may be used for abuse-resistant daily usage counters.

The guarded migration is [`database/migrations/001_primary_roles.sql`](../database/migrations/001_primary_roles.sql). It maps known legacy values, deliberately stops if any identity is ambiguous and records future role changes. It does not blindly assign all existing users one role.

## Login and session flow

```text
credentials → server password verification → database user/status/role
→ mandatory admin MFA (or user-enabled MFA) → opaque session creation
→ HttpOnly SameSite cookie + in-memory CSRF token → GET /api/v1/me
→ server role/permissions → role dashboard
```

The runnable foundation stores demo records and sessions in process memory so it can run without infrastructure. Production repositories use `iam.users`, `iam.sessions`, Argon2id, encrypted TOTP/WebAuthn credentials and a durable session store. The security boundary and API behavior are the same.

The browser never chooses an authenticated role. Public registration accepts only `FARMER_SELLER` or `BUYER`; `ADMIN` is rejected by the request schema. Administrator promotion requires `users.role.change`, a reason, existing MFA enrollment and an audit record.

## Server middleware

Fastify pre-handlers are composed consistently:

- `requireAuth` — valid session and active account
- `requireRole(...roles)` — authoritative server role
- `requirePermission(permission)` — explicit capability
- `requireCsrf` — per-session token on unsafe cookie-authenticated requests

Domain policies add resource checks:

- `canModifyListing` / `canDeleteListing` — farmer must own listing; authorized moderator is explicit
- `canViewOrder` — buyer, seller or `orders.read.all` administrator only
- conversation policy — participant only

Frontend route guards improve UX but are not the security boundary. A manually crafted request receives 401/403 even if the caller renders or alters UI code.

## Role routes

| Access state / role | Dashboard | Primary mobile navigation |
|---|---|---|
| GUEST | `/` (public application) | Home, Market, Learn, AI, More |
| ADMIN | `/admin/dashboard` | Dashboard, Users, Orders, Finance, More |
| FARMER_SELLER | `/farmer/dashboard` | Home, Market, Sell, AI, Profile |
| BUYER | `/buyer/dashboard` | Home, Market, Orders, Messages, Profile |

`/dashboard` resolves from the server-returned role; guests are redirected to `/`. `/admin/*`, `/farmer/*` and `/buyer/*` are guarded. Guests receive a reusable authentication prompt for account actions, while signed-in unauthorized roles receive a 403 state. Protected APIs independently return 401/403.

## API surface

```text
POST /api/v1/auth/login
POST /api/v1/auth/register
GET  /api/v1/me
POST /api/v1/auth/logout

GET    /api/v1/farmer/listings        FARMER_SELLER
GET    /api/v1/farmer/earnings        FARMER_SELLER + earnings.read.own
PATCH  /api/v1/listings/:id           owner or authorized moderator
DELETE /api/v1/listings/:id           owner or authorized moderator
PATCH  /api/v1/orders/:id/status      owning seller; fulfilment states only

GET  /api/v1/buyer/saved              BUYER
POST /api/v1/orders                    BUYER + orders.create
GET  /api/v1/orders/:id                order participant or authorized admin

GET   /api/v1/admin/dashboard          ADMIN + admin.dashboard.read
GET   /api/v1/admin/users              ADMIN + users.read
PATCH /api/v1/admin/users/:id/role     ADMIN + users.role.change + CSRF + reason
PATCH /api/v1/admin/users/:id/status   ADMIN + users.status.change + CSRF + reason
GET   /api/v1/admin/audit-logs         ADMIN + audit.read
```

Financial status cannot be set through the farmer fulfilment endpoint. Sandbox payment verification checks buyer ownership, locked amount and provider event idempotency. Production payment webhooks use a separate signed provider boundary.

## Role-specific data

- Bootstrap returns the authenticated profile projection, permissions and only that role’s notifications.
- Order queries are filtered in the API by buyer/seller participation.
- Farmer listings and earnings are owner-scoped.
- Buyer saved items are owner-scoped.
- Administrative user/finance data is never included in farmer or buyer bootstrap responses.
- Public marketplace records contain only deliberate public seller projections.

## 2FA

- ADMIN: mandatory; login cannot complete without a valid second factor.
- FARMER_SELLER: available/recommended; step-up is required for production withdrawals.
- BUYER: available.

The live development demo uses a clearly labelled static code only outside production. Production must use verified TOTP/WebAuthn and one-time hashed recovery codes.

## Verification performed

Automated policy tests cover dashboard selection, listing ownership, buyer denial, order participation, administrator permission and suspended accounts. Manual API acceptance checks cover:

- farmer → admin API: 403
- farmer → another farmer listing update: 403
- farmer → own listing update: 200
- buyer → listing creation: 403
- buyer order query returns only buyer-owned records
- admin login without MFA: 428
- admin user API with MFA: 200
- refresh through `/api/me`: role/session retained
- logout: session revoked; subsequent `/api/me`: 401
