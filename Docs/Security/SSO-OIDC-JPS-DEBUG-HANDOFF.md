# SSO / OIDC Debug Handoff — Jetty Planning System (JPS)

**Date:** 2026-06-18  
**Environment:** `172.28.92.56`  
**Hub frontend:** `:3100`  
**JPS frontend (nginx):** `:3080`  
**JPS backend (likely):** `:3081`  
**Status:** Hub login and OIDC authorization succeed; JPS callback fails with blank page.

Use this document when working with the JPS team (or JPS Cursor agent) to fix the downstream application side of SSO.

---

## Symptom

1. User logs into Downstream Hub successfully.
2. User clicks **Jetty Planning System** on the Hub dashboard.
3. Browser is redirected to:

   ```
   http://172.28.92.56:3080/auth/oidc/callback?code=...&state=...&code_verifier=...
   ```

4. Page is **blank** — no UI, no console errors, no visible loading state.

---

## Hub Application Configuration (confirmed)

| Field | Value |
|---|---|
| App name | Jetty Planning System |
| Target URL | `http://172.28.92.56:3080/` |
| SSO Mode | OIDC (strict) |
| OAuth Client ID | `jps-local` |
| OIDC Redirect URI | `http://172.28.92.56:3080/auth/oidc/callback` |

> **Note:** The Hub codebase in this repo implements the **JWT bridge** flow (`POST /auth/hub`). The deployed Hub at `:3100` also supports **OIDC (strict)** mode for this app. JPS must implement the OIDC consumer endpoints described below.

---

## Expected OIDC Flow

```
User clicks app in Hub dashboard
        │
        ▼
Hub OIDC authorization (user already logged in)
        │
        ▼
Hub redirects browser to JPS callback:
  GET /auth/oidc/callback?code=...&state=...
        │
        ▼
JPS backend exchanges code for tokens with Hub
        │
        ▼
JPS creates local session, redirects to dashboard
```

The authorization step **is working** — the browser receives a valid `code` in the callback URL. The failure happens **after** redirect, on the JPS side.

---

## Root Cause

**Nginx on port 3080 does not proxy `/auth/*` to the JPS backend.**

| Path on `:3080` | Current behavior | Expected behavior |
|---|---|---|
| `GET /auth/oidc/callback` | Returns SPA `index.html` (763 bytes) | Proxy to JPS backend; backend exchanges code and redirects |
| `GET /auth/oidc/start` | Returns SPA `index.html` | Proxy to JPS backend; backend redirects to Hub authorize URL |
| `POST /auth/hub` | `405 Not Allowed` (nginx) | Proxy to JPS backend (needed if using JWT bridge mode) |
| `GET/POST /api/v1/*` | Proxied to Express backend | Already working |

Because nginx serves the React SPA for `/auth/oidc/callback`, and the SPA has **no React route** for that path, the page renders blank with no errors.

---

## Live Diagnostic Evidence

Commands run against the deployed environment on 2026-06-18:

### 1. Callback returns SPA shell (not backend)

```bash
curl -I "http://172.28.92.56:3080/auth/oidc/callback?code=test&state=test"
```

```
HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 763
Server: nginx/1.29.5
```

Body is the JPS React `index.html`, not a redirect or JSON from the backend.

### 2. Auth POST blocked by nginx

```bash
curl -X POST "http://172.28.92.56:3080/auth/hub" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "token=fake"
```

```
HTTP/1.1 405 Not Allowed
Server: nginx/1.29.5
```

### 3. API routes reach backend (for comparison)

```bash
curl "http://172.28.92.56:3080/api/v1/auth/oidc/callback?code=test&state=test"
```

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json
X-Powered-By: Express
{"error":"Authentication required"}
```

This confirms:
- `/api/v1/*` **is** proxied to the Express backend.
- The backend has OIDC-related routes, but `/auth/oidc/callback` under `/api/v1` returns 401 — likely blocked by auth middleware when it should be public.
- The registered Hub redirect URI is `/auth/oidc/callback` (no `/api/v1` prefix), so the nginx proxy fix is required.

### 4. JPS backend likely on port 3081

```bash
curl -I "http://172.28.92.56:3081/auth/oidc/start"
```

```
HTTP/1.1 307 Temporary Redirect
location: /login?message=please-login
```

Port 3081 responds as an application server (not static nginx). Use this as the upstream for the nginx proxy on 3080.

### 5. JPS frontend bundle analysis

From `http://172.28.92.56:3080/assets/index-*.js`:

- OIDC start URL is built as `${window.location.origin}/auth/oidc/start` (root `/auth/`, not `/api/v1/auth/`).
- React routes include `/login`, `/select-port`, `/`, etc.
- **No** React route for `/auth/oidc/callback` — callback must be handled by the **backend**, not the SPA.

---

## Required Fixes (JPS Team)

### Fix 1 — Nginx: proxy `/auth/` to backend

Add to the nginx config serving port **3080** (adjust upstream if backend port differs):

```nginx
# Auth endpoints must hit JPS backend, not SPA fallback
location /auth/ {
    proxy_pass http://127.0.0.1:3081/auth/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# SPA fallback for all other routes
location / {
    try_files $uri $uri/ /index.html;
}
```

Reload nginx after change:

```bash
sudo nginx -t && sudo nginx -s reload
```

### Fix 2 — Backend: ensure callback route is public

`GET /auth/oidc/callback` must **not** require an existing session. It is the entry point that **creates** the session.

Verify the route:
1. Reads `code` and `state` from query params.
2. Exchanges `code` with Hub token endpoint (using stored or configured `code_verifier` if PKCE is used).
3. Maps Hub user (email / sub) to local JPS user.
4. Creates local session / JWT cookie.
5. Redirects to JPS dashboard (`/` or configured `APP_PUBLIC_ORIGIN`).

If auth middleware wraps all `/auth/*` or `/api/v1/auth/*` routes, exclude `/auth/oidc/callback` and `/auth/oidc/start` from it.

### Fix 3 — Environment alignment

Confirm JPS backend env matches Hub admin settings:

| Variable | Expected value |
|---|---|
| OIDC client ID | `jps-local` |
| OIDC redirect URI | `http://172.28.92.56:3080/auth/oidc/callback` |
| Hub issuer / authorize URL | As configured in Hub OIDC provider |
| Hub token URL | As configured in Hub OIDC provider |
| Client secret | Shared with Hub (if confidential client) |

### Fix 4 (optional) — JWT bridge mode alternative

If OIDC proves difficult, Hub also supports **JWT bridge** mode per [SSO-INTEGRATION-GUIDE.md](./SSO-INTEGRATION-GUIDE.md):

- Hub POSTs a short-lived JWT to `POST /auth/hub` on the target app.
- JPS must implement `POST /auth/hub` and share `SSO_TOKEN_SECRET` with Hub.
- The same nginx `/auth/` proxy is still required (`POST /auth/hub` currently returns 405).

---

## Verification Checklist (after JPS fixes)

Run these after nginx reload and backend changes:

```bash
# 1. Callback should NOT return SPA HTML
curl -I "http://172.28.92.56:3080/auth/oidc/callback?code=test&state=test"
# Expect: 302 redirect, 400, or 401 from backend — NOT 200 text/html (763 bytes)

# 2. Auth hub endpoint should reach backend
curl -X POST "http://172.28.92.56:3080/auth/hub" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "token=fake"
# Expect: 400 or 401 from backend — NOT 405 from nginx

# 3. OIDC start should redirect to Hub (not return SPA)
curl -I "http://172.28.92.56:3080/auth/oidc/start"
# Expect: 302 to Hub authorize URL — NOT 200 text/html
```

Then test end-to-end:
1. Log into Hub at `http://172.28.92.56:3100`
2. Click Jetty Planning System on dashboard
3. Should land on JPS dashboard with an active session (not blank callback page)

---

## Secondary Observation — `code_verifier` in callback URL

The live callback URL includes `code_verifier` as a query parameter:

```
/auth/oidc/callback?code=...&state=...&code_verifier=...
```

In standard OAuth2 PKCE, the authorization server returns only `code` and `state`. The `code_verifier` is kept client-side and sent only to the token endpoint. If Hub is echoing `code_verifier` in the redirect, verify whether JPS or Hub put it there. This may need a separate Hub-side review after the nginx fix is in place.

---

## Cursor Handoff Prompt (paste into JPS repo)

```text
Fix Downstream Hub OIDC SSO callback for Jetty Planning System.

Context:
- Hub redirects to GET http://172.28.92.56:3080/auth/oidc/callback?code=...&state=...
- Page is blank because nginx on :3080 serves SPA index.html for /auth/* instead of proxying to backend.
- JPS backend likely runs on :3081. /api/v1/* is already proxied correctly.

Tasks:
1) Update nginx on port 3080 to proxy location /auth/ to the JPS backend (e.g. http://127.0.0.1:3081/auth/).
2) Ensure GET /auth/oidc/callback is a public backend route (no session required) that:
   - exchanges authorization code with Hub token endpoint
   - maps user by email
   - creates local session
   - redirects to dashboard
3) Ensure GET /auth/oidc/start redirects to Hub OIDC authorize URL.
4) Exclude /auth/oidc/callback and /auth/oidc/start from auth middleware.
5) Verify env: client_id=jps-local, redirect_uri=http://172.28.92.56:3080/auth/oidc/callback.

Validation:
- curl -I http://172.28.92.56:3080/auth/oidc/callback?code=test&state=test must NOT return SPA HTML (763 bytes).
- End-to-end: Hub dashboard click → JPS dashboard with session.
```

---

## Related Hub Documentation

- [SSO-INTEGRATION-GUIDE.md](./SSO-INTEGRATION-GUIDE.md) — JWT bridge contract (`POST /auth/hub`)
- [TEST-PLAN.md](./TEST-PLAN.md) — Hub-side SSO test cases
