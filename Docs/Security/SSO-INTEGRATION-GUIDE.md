# Downstream Hub SSO Integration Guide (Strict OIDC Mode)

This guide is the current contract for downstream applications.

Legacy bridge POST (`/api/sso/bridge`) and HS256 shared-secret integration are no longer the target path in strict mode.

---

## 1) Required flow

Downstream Hub acts as OIDC provider:

1. User clicks app in Hub dashboard.
2. Hub starts authorization code flow with PKCE.
3. Your app receives `code` (and `state`) on registered redirect URI.
4. Your app calls Hub token endpoint to exchange `code` + `code_verifier`.
5. Your app validates returned `id_token` using Hub JWKS.
6. Your app creates local session and redirects user to app home.

---

## 2) OIDC endpoints

Use these endpoints from Hub:

- Discovery: `GET /api/sso/.well-known/openid-configuration`
- Authorization: `GET /api/sso/authorize`
- Token: `POST /api/sso/token`
- JWKS: `GET /api/sso/jwks`

Example (local):

- `http://localhost:4000/api/sso/.well-known/openid-configuration`

---

## 3) Required token validation

Validate `id_token` with JWKS and enforce:

- `alg` must match provider metadata (currently `RS256`)
- `iss` equals Hub issuer
- `aud` equals your app client id
- `exp` not expired
- `sub` present (primary identity key)
- **`email_verified` (boolean):** if your app implements **SSO v2 silent linking** (see §4), require `email_verified === true` before you auto-bind `sub` to an existing local user by email or before JIT-creating a user from the token. If `email_verified` is `false`, treat the user as not yet cleared for that policy (user may still need to complete Hub magic-link verification).

Recommended claim usage:

- Identity key: `sub` (Hub user UUID, stable)
- Attributes: `email`, `name`
- Trust / linking gate: `email_verified`

`scope` `openid profile email` continues to be used; the Hub includes `email_verified` in the `id_token` payload when applicable (standard OIDC claim).

---

## 4) SSO v2 — Centralized verification and silent account linking

This section is the **developer contract** for the “SSO v2” model: the Hub proves corporate inbox control (magic link); **your application** performs **silent** user resolution so end users do not see separate “link account” screens for normal SSO launches.

### Identity contract (Hub as OIDC provider)

| Claim | Meaning |
| ----- | ------- |
| `sub` | **Hub user id** (UUID). Use this as the stable primary key for the same person across launches. |
| `email` | Primary email on the Hub account. |
| `name` | Display name (may mirror email). |
| `email_verified` | **`true`** only after the user has completed the Hub’s **out-of-band email verification** for SSO (magic link). The Hub sets this when a one-time verification email is consumed (see flows below). **`false`** means the Hub has not recorded that inbox proof yet. |

**Not the same as registration domain policy:** the Hub may restrict **registration** to certain email domains (`allowed_domains`). That is separate from `email_verified`, which asserts **inbox ownership** via magic link, not only “domain looks corporate.”

### When `email_verified` becomes `true` (Hub-side)

Typical Hub flows that set the underlying Hub flag (and therefore `email_verified: true` on the next `id_token`):

- User completes a **magic link** from **Connect SSO** / **Change password** linking flow: e.g. `GET /api/users/sso/verify?token=...`
- **Auto-link** verification: `POST /api/auth/oidc/auto-link/start` then `GET /api/auth/oidc/auto-link/verify?token=...`

Users who **already** had Hub-side OIDC linking completed before this feature may be **backfilled** so their first `id_token` already shows `email_verified: true`.

### Downstream algorithm (silent upsert — implement in **your** app)

Account **binding** for your local user store happens **in the target application**, not in the Hub:

1. **Check 1 — by `sub`:** If a local user row exists with that `sub` (Hub user id), sign them in.
2. **Check 2 — by `email`:** Else if a local user exists with the same **normalized** `email` from the token, **bind** that row: store `sub`, set your app’s notion of SSO identity (e.g. `auth_source = 'sso'`), sign them in. **Only if** your policy allows it — for v2, only when `email_verified === true` (and your domain rules pass; see below).
3. **Check 3 — neither:** **JIT provision** a new local user from `sub` + `email` (+ `name`), with your default role, and sign them in.

This removes friction: no manual “link” UI in the app for the common case, once the Hub has verified the inbox.

### Security requirements (target app)

- **Strict claim check (recommended):** For first-time binding or JIT, reject or defer silent link if `email_verified !== true`.
- **Domain restriction:** Enforce your own allowlist of corporate email domains (e.g. `@yourcompany.com`) when performing email-based match or JIT — the Hub does not enforce your app’s domain rules inside your database.
- **Audit:** Log every automatic link and every JIT create with at least `sub`, timestamp, and outcome.

### Coexistence with Hub “account linking” APIs (§11)

The Hub APIs under **§11** (e.g. connect SSO, admin bulk link) manage **`users.oidc_sub` on the Hub** for **Hub ↔ upstream IdP** coexistence and Hub login behavior.

**Downstream apps** should still implement **§4** using **`id_token.sub`** and **`email_verified`** against **your** application’s user table. You do not need to duplicate Hub’s internal `oidc_sub` linking unless your architecture explicitly requires both.

### Optional Hub environment variable (non-production)

For local/staging convenience only, operators may set `OIDC_EMAIL_VERIFIED_TRUST_ALL=1` so the Hub emits `email_verified: true` without the database flag. **Do not use in production.**

---

## 5) App registration required in Hub

In Hub Admin -> Applications, each app must have:

- `sso_mode = oidc`
- `oauth_client_id` set
- `oidc_redirect_uris` set (exact allowed callback URLs)

If these are missing, Hub blocks launch in strict mode.

---

## 6) Code exchange contract

Token endpoint request:

`POST /api/sso/token` JSON body:

```json
{
  "grant_type": "authorization_code",
  "code": "<authorization-code>",
  "redirect_uri": "https://your-app/callback",
  "client_id": "your-client-id",
  "code_verifier": "<pkce-verifier>"
}
```

Token endpoint response:

```json
{
  "token_type": "Bearer",
  "expires_in": 60,
  "id_token": "<jwt>",
  "scope": "openid profile email"
}
```

The `id_token` JWT includes standard claims such as `sub`, `email`, `name`, and `email_verified` (boolean).

---

## 7) Migration checklist for downstream apps

1. Add OIDC callback endpoint (`redirect_uri`) in your app.
2. Store and verify PKCE `code_verifier` per login attempt.
3. Exchange `code` at Hub token endpoint.
4. Validate `id_token` via Hub JWKS.
5. Use `sub` for user upsert/mapping; enforce **`email_verified`** if you adopt SSO v2 silent linking (§4).
6. Remove dependency on legacy `/auth/hub` bridge POST path.

---

## 8) Security requirements

- Use HTTPS in SIT/PROD for all redirect and token traffic.
- Do not log raw `code`, `id_token`, or secrets.
- Reject any token failing `iss`/`aud`/`exp` checks.
- Keep `state` and PKCE verifier bound to the same browser session.
- For SSO v2: combine `email_verified`, domain policy, and audit as in §4.

---

## 9) Troubleshooting

- Error: `SSO OIDC-only enforcement is enabled... sso_mode=oidc`
  - Set app `sso_mode` to `oidc` and configure `oauth_client_id` + `oidc_redirect_uris`.

- `invalid_grant` on token exchange
  - Check `redirect_uri`, `client_id`, and `code_verifier` exactly match authorization request.

- Signature validation fails
  - Refresh JWKS and ensure you validate against current `kid`.

- `email_verified` is always `false` in your app
  - User must complete Hub magic-link verification (§4). Check Hub user state and that you are not using `OIDC_EMAIL_VERIFIED_TRUST_ALL` in production.

---

## 10) Quick runtime checks

```bash
curl -i http://localhost:4000/api/sso/jwks
curl -i http://localhost:4000/api/sso/.well-known/openid-configuration
```

If strict mode is active:

- `/api/sso/bridge` returns `410`
- OIDC discovery and JWKS endpoints return `200`

---

## 11) Account linking APIs (Hub UX)

The Hub exposes account-linking APIs to support seamless local+SSO coexistence **on the Hub**:

- Self-service:
  - `GET /api/users/me/sso-status`
  - `POST /api/users/me/sso-connect/start`
  - `POST /api/users/me/sso-unlink`
  - `GET /api/users/sso/verify?token=...`
- Admin:
  - `GET /api/users/:id/sso-status`
  - `POST /api/users/:id/sso-link/start`
  - `GET /api/users/:id/sso-events`
  - `POST /api/users/:id/sso-unlink`
- Bulk:
  - `POST /api/users/sso-link/bulk/dry-run`
  - `POST /api/users/sso-link/bulk/jobs`
  - `GET /api/users/sso-link/bulk/jobs/:jobId`
  - `GET /api/users/sso-link/bulk/jobs/:jobId/items`
  - `POST /api/users/sso-link/bulk/jobs/:jobId/retry`
  - `GET /api/users/sso-link/bulk/jobs/:jobId/export.csv`

Auto-link helper endpoints (email verification perimeter):

- `POST /api/auth/oidc/auto-link/start`
- `GET /api/auth/oidc/auto-link/verify?token=...`

See **§4** for how **target applications** should map **`id_token`** claims to local users (silent upsert), separately from these Hub APIs.

---

## 12) Jetty Planning System — downstream implementation (this repo)

### Hub §11 vs Jetty API paths

Section **§11** documents **Hub** URLs (e.g. `GET /api/users/me/sso-status` on the Hub host). The Jetty backend exposes **application** linking and OIDC under **`/api/v1/...`** and **`/auth/oidc/...`** on the Jetty API host. Do not call Hub §11 paths against the Jetty server.

### SSO v2 silent linking (Jetty)

Implemented in `Backend/src/routes/oidc-sso.js` and `Backend/src/lib/oidc-v2-policy.js`.

| `OIDC_V2_SILENT_LINK` | Behavior |
| --------------------- | -------- |
| `false` (default) | Legacy: local user with same email and no `oidc_sub` → **409** `email_collision_local_account`. JIT unchanged (no `email_verified` gate unless you enable v2). |
| `true` | **§4 flow:** after lookup by `sub`, if exactly one active `auth_source = 'local'` user matches token email with `oidc_sub` **null**, and `id_token.email_verified === true`, and optional domain allowlist passes → **UPDATE** `users.oidc_sub`, session, audit `oidc.v2.silent_bind`. JIT requires verified email + allowlist when v2 is on. |

| Variable | Purpose |
| -------- | ------- |
| `OIDC_EMAIL_DOMAIN_ALLOWLIST` | Optional comma-separated suffixes (e.g. `@company.com,partner.org`). Empty = no domain restriction. Applies to silent bind, JIT (when v2 on), and explicit **Connect SSO** / **admin prelink** flows. |

**`auth_source`:** Silent bind updates an existing **local** row and does not force `auth_source` to `sso`; JIT-created users remain `auth_source = 'sso'` as before.
