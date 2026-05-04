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

Recommended claim usage:

- Identity key: `sub`
- Attributes: `email`, `name`

---

## 4) App registration required in Hub

In Hub Admin -> Applications, each app must have:

- `sso_mode = oidc`
- `oauth_client_id` set
- `oidc_redirect_uris` set (exact allowed callback URLs)

If these are missing, Hub blocks launch in strict mode.

---

## 5) Code exchange contract

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

---

## 6) Migration checklist for downstream apps

1. Add OIDC callback endpoint (`redirect_uri`) in your app.
2. Store and verify PKCE `code_verifier` per login attempt.
3. Exchange `code` at Hub token endpoint.
4. Validate `id_token` via Hub JWKS.
5. Use `sub` for user upsert/mapping.
6. Remove dependency on legacy `/auth/hub` bridge POST path.

---

## 7) Security requirements

- Use HTTPS in SIT/PROD for all redirect and token traffic.
- Do not log raw `code`, `id_token`, or secrets.
- Reject any token failing `iss`/`aud`/`exp` checks.
- Keep `state` and PKCE verifier bound to the same browser session.

---

## 8) Troubleshooting

- Error: `SSO OIDC-only enforcement is enabled... sso_mode=oidc`
  - Set app `sso_mode` to `oidc` and configure `oauth_client_id` + `oidc_redirect_uris`.

- `invalid_grant` on token exchange
  - Check `redirect_uri`, `client_id`, and `code_verifier` exactly match authorization request.

- Signature validation fails
  - Refresh JWKS and ensure you validate against current `kid`.

- Chrome console: `Unsafe attempt to load URL http://localhost:3000/auth/oidc/callback ... from frame with URL chrome-error://chromewebdata/`
  - **Cause:** The OIDC redirect chain is running in a **subframe** (e.g. Jetty opened inside Hub in an `<iframe>`), or a **failed navigation** left the active document on Chrome’s error interstitial, and a redirect to the callback URL was blocked.
  - **Jetty UI:** **Sign in with SSO** uses `window.top.location.assign` to `/auth/oidc/start`, and **`GET /auth/oidc/start`** returns a small HTML page that runs `window.top.location.replace(IdP authorize URL)` when `Accept` includes `text/html` (so an iframe-embedded load still promotes the IdP redirect to the top window). Non-browser clients (`Accept` without `text/html`, e.g. curl) still receive `302` to the authorize URL.
  - **Hub / portal:** Configure the Jetty app launcher to open the app in a **new tab** or **top window**, not inside a **sandboxed iframe** that blocks top-level navigation, whenever OIDC redirects to a different origin (e.g. API on `http://localhost:3000`).
  - **Before retest:** Confirm `http://localhost:3000/health` and Hub authorize URL load; use a **fresh tab** if you previously hit a network error.

- Chrome: **`ERR_CONNECTION_RESET`** on `/auth/oidc/callback` (console may still show `chrome-error://chromewebdata/`)
  - Often **oversized request headers** (many or large cookies). The API listens with a larger **max HTTP header size** (default 64 KiB via `http.createServer`; override with env `HTTP_MAX_HEADER_SIZE` in [Backend/src/index.js](../../Backend/src/index.js)). Retest in **Incognito** to rule out cookie bloat; restart `jps-api` after changes.
  - **Docker / Windows:** confirm `jps-api` is running; restart the API container; try `http://127.0.0.1:3000/health` if `localhost` misbehaves.

- **`GET /auth/oidc/callback`** when the OAuth redirect lands in an **iframe** (`Sec-Fetch-Dest: iframe`): Jetty returns HTML that runs `window.top.location.replace(same URL)` so the **top** window loads the callback and runs token exchange. The token request still uses the configured `OIDC_REDIRECT_URI` (no extra query params).

- **`ERR_CONNECTION_RESET`** (full diagnosis, `curl`, `127.0.0.1` vs `localhost`, `/auth/oidc/ready`): see [OIDC-CALLBACK-ERR-CONNECTION-RESET.md](../Troubleshoot/OIDC-CALLBACK-ERR-CONNECTION-RESET.md).

---

## 9) Quick runtime checks

```bash
curl -i http://localhost:4000/api/sso/jwks
curl -i http://localhost:4000/api/sso/.well-known/openid-configuration
```

If strict mode is active:

- `/api/sso/bridge` returns `410`
- OIDC discovery and JWKS endpoints return `200`

---

## 10) Jetty app rollout flags

To support safe coexistence with local username/password login during migration:

- `SSO_OIDC_ENABLED=false` keeps OIDC routes disabled until staging validation is complete.
- `SSO_LEGACY_BRIDGE_ENABLED=true` keeps `/auth/hub` active during transition.
- After strict OIDC cutover is validated, set `SSO_OIDC_ENABLED=true` and `SSO_LEGACY_BRIDGE_ENABLED=false`.

---

## 11) Account linking API profile (self-service + admin + bulk)

Use this profile when implementing account linking UX:

- **Self-service**
  - `GET /api/v1/users/me/sso-status`
  - `POST /api/v1/users/me/sso-connect/start`
- **Admin single-user**
  - `GET /api/v1/admin/users/:id/sso-status`
  - `POST /api/v1/admin/users/:id/sso-link/start`
  - `POST /api/v1/admin/users/:id/sso-unlink`
- **Bulk linking**
  - `POST /api/v1/admin/sso-link/bulk/dry-run`
  - `POST /api/v1/admin/sso-link/bulk/jobs`
  - `GET /api/v1/admin/sso-link/bulk/jobs/:jobId`
  - `GET /api/v1/admin/sso-link/bulk/jobs/:jobId/items`
  - `POST /api/v1/admin/sso-link/bulk/jobs/:jobId/retry`
  - `GET /api/v1/admin/sso-link/bulk/jobs/:jobId/export.csv`

Bulk policy for v1:

- Dry-run first.
- Auto-link only deterministic one-to-one matches with no conflict.
- Ambiguous rows go to review.

---

## 12) Audit requirements for linking

Every link/unlink attempt should emit immutable audit events with:

- actor user id
- target user id
- mode (`self_service`, `admin_prelink`, `bulk`)
- outcome (`linked`, `blocked_*`, `failed_*`, `skipped_already_linked`)
- reason code
- timestamp
- correlation id / job id (for bulk)

Do not log raw `id_token`, `code`, or other secrets.
