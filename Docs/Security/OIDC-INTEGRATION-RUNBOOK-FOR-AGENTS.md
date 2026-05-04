# OIDC Integration Runbook (Agent-Friendly)

Purpose: provide a single, deterministic guide for integrating an app with Downstream Hub OIDC and avoiding the common local-dev failures seen in this project.

Scope: local/dev integration (Hub over HTTP), Jetty app pattern, reusable by other apps/agents.

---

## 1) Required OIDC contract

Provider (Hub) must expose:

- Discovery: `/api/sso/.well-known/openid-configuration`
- Authorization: `/api/sso/authorize`
- Token: `/api/sso/token`
- JWKS: `/api/sso/jwks`

Token validation requirements:

- `iss` matches configured issuer
- `aud` matches configured client id
- signature validates via JWKS
- `sub` exists and is used as stable external identity key

---

## 2) Working baseline (known-good local)

Use this exact host strategy in local:

- Frontend URL: `http://127.0.0.1:5173`
- API URL: `http://127.0.0.1:3000`
- OIDC callback: `http://127.0.0.1:3000/auth/oidc/callback`

Do not mix `localhost` and `127.0.0.1` in the same flow.

Why: in some Windows + Docker environments, `localhost` pathing is unstable (reset/IPv6 quirks), while `127.0.0.1` is stable. Mixed hosts also cause cookie/session inconsistencies.

---

## 3) Hub app configuration (must match exactly)

Set in Hub Admin -> Applications:

- `SSO Mode`: `OIDC (strict)`
- `OAuth Client ID`: e.g. `jps-local`
- `OIDC Redirect URIs`: include exact callback URL
  - `http://127.0.0.1:3000/auth/oidc/callback`

Exact-match rule: `redirect_uri` in token exchange must be byte-for-byte equal to one registered URI.

---

## 4) App configuration checklist

### Backend env

- `OIDC_ISSUER=http://<hub-host>:<hub-port>`
- `OIDC_DISCOVERY_URL=http://<hub-host>:<hub-port>/api/sso/.well-known/openid-configuration`
- `OIDC_CLIENT_ID=<hub-oauth-client-id>`
- `OIDC_REDIRECT_URI=http://127.0.0.1:3000/auth/oidc/callback`
- `SSO_OIDC_ENABLED=true`
- `COOKIE_SECURE=false` (for HTTP local)
- `JPS_PUBLIC_ORIGIN=http://127.0.0.1:5173`
- `CORS_ORIGIN=http://127.0.0.1:5173,http://localhost:5173`
- Optional SSO v2 (see §14): `OIDC_V2_SILENT_LINK=false` (default; set `true` for §4 silent email bind + gated JIT)
- Optional: `OIDC_EMAIL_DOMAIN_ALLOWLIST=@yourcompany.com` (comma-separated; empty = no domain filter)

### Frontend env

- `VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1`

---

## 5) Startup / restart commands

From repo root:

```powershell
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --build jps-api
```

From `Frontend/`:

```powershell
npm run dev
```

If Vite port collision occurs, kill old Vite processes and restart to ensure one active server.

---

## 6) Fast verification sequence (must pass in order)

1. API health:

   - `http://127.0.0.1:3000/health` -> returns JSON `{ status: "ok", ... }`

2. OIDC start:

   - Open `http://127.0.0.1:3000/auth/oidc/start`
   - Browser redirects to Hub authorize URL
   - Authorize URL contains encoded redirect URI with `127.0.0.1:3000`, not `localhost:3000`

3. Callback:

   - Callback reaches `http://127.0.0.1:3000/auth/oidc/callback?...`
   - Backend logs `oidc.callback.success`

4. Session check from app:

   - Frontend can call `/api/v1/users/me` successfully
   - Frontend can call `/api/v1/rbac/me/page-permissions` successfully

---

## 7) Common failures and exact fixes

### A) `ERR_CONNECTION_RESET` / `chrome-error://chromewebdata`

Symptoms:

- Browser cannot load `/auth/oidc/start` or `/auth/oidc/callback`
- Console logs unsafe attempt from `chrome-error://chromewebdata`

Fixes:

- Use `127.0.0.1` consistently
- Confirm API health on `127.0.0.1:3000`
- Rebuild/restart API
- Retry in fresh incognito

### B) `Missing OIDC session flow` / `Invalid OIDC state`

Causes:

- callback arrived without matching flow state/cookie
- provider state behavior differs

Fixes:

- start flow from app button only (no parallel manual start tabs)
- keep single-tab flow
- ensure callback host consistency

### C) `OIDC sign-in failed` + token endpoint 400

Cause:

- IdP rejected code exchange (`invalid_grant`, `redirect_uri_mismatch`, etc.)

Fixes:

- verify `client_id`, `redirect_uri`, `code_verifier`, one-time code usage
- check Hub logs for exact error detail

### D) Login succeeds but app shows `Forbidden`

Cause:

- RBAC permissions for current page key missing in effective grants

Checks:

- user roles in `user_roles`
- effective page permissions via role joins
- confirm `dashboard` is viewable for root path

---

## 8) Identity linking rules (local + SSO coexistence)

- `users.id` is internal app UUID/bigint, not OIDC identity.
- `users.oidc_sub` stores IdP `sub` claim.
- For dual login (local + SSO), keep `auth_source='local'` and set `oidc_sub`.
- `oidc_sub` must be unique across users.

---

## 9) Minimum handoff payload for another AI agent

When delegating, provide:

- Hub base URL
- client id
- registered redirect URI list
- backend env values for OIDC and origins
- frontend API base URL
- latest `docker logs --tail 120 jps-api`
- result of `/health` and `/auth/oidc/start` quick checks

Without these, diagnosis is often ambiguous and slower.

---

## 10) Source references

- `Backend/src/routes/oidc-sso.js`
- `Backend/src/lib/oidc-v2-policy.js`
- `Backend/src/lib/oidc-client.js`
- `Backend/src/lib/oidc-flow.js`
- `Frontend/src/api/client.js`
- `Frontend/src/pages/Login.jsx`
- `Docs/Security/SSO-INTEGRATION-GUIDE.md`
- `Docs/Troubleshoot/OIDC-CALLBACK-ERR-CONNECTION-RESET.md`

---

## 11) Linking feature flags (recommended)

Use explicit flags to control rollout blast radius:

- `sso_link_self_service_enabled`
- `sso_link_admin_enabled`
- `sso_link_bulk_enabled`

Suggested default progression:

1. Enable self-service in staging.
2. Enable admin single-user linking.
3. Enable bulk dry-run only.
4. Enable bulk execute after dry-run quality is acceptable.

---

## 12) Bulk linking rollout checklist

### Pre-rollout

- Verify Hub `sub` and `email` claims are consistently available.
- Verify deterministic matching rules are documented and testable.
- Prepare seed dataset with known outcomes (ready/review/blocked).

### Functional checks

- Dry-run returns correct status buckets and counts.
- Execute links only selected rows.
- Retry only `failed_retryable` rows.
- CSV export includes row-level reason codes.

### Security/audit checks

- All link/unlink actions emit audit entries.
- No token/code secrets appear in logs.
- RBAC permission gates admin and bulk endpoints.

### Ops checks

- Job progress visibility and terminal status are accurate.
- Idempotent rerun behavior for already linked rows.
- Rollback plan documented for accidental mass linking.

---

## 13) Bulk reason codes (normalize for analytics)

Recommended canonical row outcomes:

- `linked`
- `skipped_already_linked`
- `blocked_collision`
- `blocked_email_mismatch`
- `blocked_inactive_user`
- `failed_retryable`
- `failed_terminal`

---

## 14) SSO v2 silent linking (Jetty) — env + staging checks

### Environment

- `OIDC_V2_SILENT_LINK` — set `true` only after Hub emits `email_verified: true` for verified users (magic link / Hub flows in SSO-INTEGRATION-GUIDE §4).
- `OIDC_EMAIL_DOMAIN_ALLOWLIST` — optional; e.g. `@yourcompany.com`. Empty allows any domain (still requires `email_verified` when v2 is on for email-based bind and JIT).

Pass both through Docker Compose when using containers (`docker-compose.backend.yml`).

### Staging verification matrix

| Case | `OIDC_V2_SILENT_LINK` | User / token | Expected |
| ---- | ------------------------ | ------------- | -------- |
| A | `false` | Local user, same email, empty `oidc_sub`, SSO login | **409** `email_collision_local_account` (legacy) |
| B | `true` | Same as A, `email_verified: true`, domain OK | **Silent bind**, login, `oidc.v2.silent_bind` in logs |
| C | `true` | Same as A, `email_verified: false` | **403** HTML, reason `email_not_verified` |
| D | `true` | Allowlist set, email outside list | **403** `domain_not_allowed` |
| E | `true` | JIT on, new email, verified, domain OK | JIT user created |
| F | `true` | JIT on, `email_verified: false` | **403** `jit_email_not_verified` |
| G | `true` | Two local rows same email, both `oidc_sub` null | **409** `ambiguous_email_match` |

Confirm Hub user completed inbox verification so `email_verified` is true before expecting B or E.
