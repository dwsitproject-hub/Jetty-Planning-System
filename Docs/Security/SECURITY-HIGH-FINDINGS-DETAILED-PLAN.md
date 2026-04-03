# Detailed remediation plan — High findings (H-1–H-6)

**Parent:** [SECURITY-REMEDIATION-PLAN-HIGH-MEDIUM.md](./SECURITY-REMEDIATION-PLAN-HIGH-MEDIUM.md)  
**Assessment:** [SECURITY-ASSESSMENT-REPORT.md](./SECURITY-ASSESSMENT-REPORT.md)  

This document expands **only** the **High** findings: ordered work packages, concrete steps, dependencies, test focus, and **which changes carry elevated “fix risk”** (operational breakage or new vulnerability class if done wrong).

---

## 1. Executive view

| ID | Finding | Fix complexity | Typical fix risk to production |
|----|---------|----------------|----------------------------------|
| **H-1** | JWT in `localStorage` | **High** | **High** if cookies/CSRF/cross-origin mishandled |
| **H-2** | Anonymous `GET /si-lookups` | **Low–Medium** | **Low–Medium** (depends on pre-login API usage) |
| **H-3** | Missing security headers | **Low** | **Medium** when CSP moves from Report-Only to **Enforce** |
| **H-4** | No login throttling | **Low–Medium** | **High** if limits + `trust proxy` wrong (false lockouts / bypass) |
| **H-5** | Long-lived JWTs | **Medium–High** | **Medium** (TTL only) to **High** (refresh rotation bugs) |
| **H-6** | Upload content trust | **Medium** | **Medium** (legitimate files rejected; workflow disruption) |

**“Fix risk”** here means: risk introduced **by the remediation itself**, not the original vulnerability.

---

## 1a. Implementation status (as of repo state after remediation)

Use this table to see what is **done in code** versus what you should still **validate manually** (environment-specific behavior, edge cases, production URLs).

| ID | Status in codebase | Your manual / staging checks |
|----|-------------------|------------------------------|
| **H-1** | **Done.** HttpOnly session cookie `jps_at`, readable `jps_xsrf`, double-submit CSRF on unsafe methods when the session cookie is present (Bearer-only calls skip CSRF). `POST /api/v1/auth/logout` clears cookies. Frontend uses `credentials: 'include'` and `X-XSRF-TOKEN`; legacy `localStorage` token cleared on load/login. Optional `AUTH_RETURN_TOKEN_BODY=true` for scripts. | **You should:** Confirm **production** layout: if SPA and API are on different **sites** (not just ports), cookie `SameSite` / `Secure` and CORS must match your real hostnames. Test **Safari** / mobile if you support them. **Optional:** run `npm run test:e2e` from repo root (Vite + API up) — covers login, cookies, CSRF logout. |
| **H-2** | **Done.** `/api/v1/si-lookups` is mounted with `requireAuth` in `Backend/src/index.js`; anonymous aggregate GET returns **401**. | **You should:** With **no** cookies / session, `curl` or browser to `GET http://localhost:3000/api/v1/si-lookups` → **401**. After login, SI / master screens still load lookups. If any **external integration** called this URL anonymously, update or document the break. |
| **H-3** | **Partially done.** `nginx.conf` (production Docker **frontend** image) adds `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, and an **enforced** `Content-Security-Policy`. **Not applied** to Vite dev (`npm run dev`) — the dev server does not use that nginx file. Optional API `helmet()` not added. | **You should:** Run a **production-like** build (`npm run build` + nginx or your Alicloud static hosting) and click through **login, dashboard, SI, uploads, any Excel/PDF UX**. Adjust CSP `connect-src` / `img-src` if your real API or CDN host differs from the template. Watch browser console for CSP violations. Plan mentioned Report-Only first — you may still want a **Report-Only** pass in staging before tightening. |
| **H-4** | **Done.** `express-rate-limit` on `POST /api/v1/auth/login` (`Backend/src/routes/auth.js`). `trust proxy` set in `Backend/src/index.js` (default `1`; override with `TRUST_PROXY`). Tunable via `AUTH_LOGIN_MAX_ATTEMPTS`. | **You should:** From one client, send many bad logins → **429**. Behind your real **load balancer**, confirm client IP is correct (no whole-office lockout). Adjust `max` / `windowMs` if needed. |
| **H-5** | **Partially done.** Default **`JWT_EXPIRES_IN`** shortened to **8h** in code and `.env.example` (was 7d). Cookie `maxAge` follows the same TTL. **No** refresh-token rotation, **no** server-side `jti` revocation list (logout clears cookies only; stolen JWT valid until expiry if someone copied it). | **You should:** Leave a tab idle past **8h** (or lower `JWT_EXPIRES_IN` temporarily) and confirm the app handles **401** gracefully (redirect / re-login). Decide if you need refresh tokens later. |
| **H-6** | **Done.** After multer writes files, **`file-type`** magic-byte check against an allowlist on **operation documents** and **sub-process document** uploads (`Backend/src/lib/upload-mime.js`). Mismatch → files removed, **400**. | **You should:** Upload real **PDF / PNG / JPEG / XLSX** from your workflows; try renaming a **non-allowed** file to `.pdf` → expect rejection. If a **valid** business file is rejected, expand the allowlist or document the limitation. |

**Automated check already in repo (H-1-focused):** from project root, with frontend on **5173** and API on **3000**, run `npm run test:e2e` (Playwright). This does **not** replace full manual regression or production verification.

---

## 2. Recommended sequence

1. **H-3** — Report-Only CSP first (builds safety net for later XSS-sensitive work).
2. **H-4** — Rate limit login, **after** `trust proxy` is correct (see Medium **M-3** in parent doc, or bundle here).
3. **H-2** — Require auth on aggregate `/si-lookups` (with frontend audit).
4. **H-6** — Magic-byte + allowlist on uploads (before or in parallel with Critical **C-5** if you add auth’d downloads).
5. **H-5** — Shorten access token; add refresh **only** when ready (or accept re-login until H-1).
6. **H-1** — Move session to HttpOnly cookies or BFF **last**, when H-5 story is clear.

**Why H-1 last:** It touches every API call, CORS, CSRF, login/logout, and possibly hosting layout. Doing it after headers and rate limiting reduces ambiguity when debugging.

---

## 3. H-1 — JWT in `localStorage`

### Goal

Stop storing bearer tokens where any XSS can read them (`jps_token` today).

### Detailed steps

1. **Choose architecture**
   - **Same-site deployment** (API + SPA behind one origin/path): prefer **HttpOnly `Secure` cookies** for access or refresh token.
   - **Split origins** (e.g. `app.example.com` + `api.example.com`): either **shared parent domain** cookies (`Domain= .example.com`) with strict path, or **BFF** on `app` origin that proxies to API.

2. **Backend**
   - On login: `Set-Cookie` with `HttpOnly`, `Secure`, `SameSite` appropriate to your cross-site needs (`Lax` vs `Strict` vs `None`+`Secure`).
   - For cross-origin SPA + API: `SameSite=None; Secure` often required for credentialed XHR; then **CSRF protection is mandatory** for unsafe methods.
   - Expose CSRF token (double-submit cookie or header token) and validate on `POST`/`PUT`/`DELETE`/`PATCH`.
   - Logout: clear cookie server-side (`Max-Age=0` / same path+domain).

3. **Frontend** (`auth.js`, `client.js`)
   - Remove `localStorage` token read/write for session.
   - Use `credentials: 'include'` on `fetch`.
   - Attach CSRF header from cookie or bootstrap endpoint per pattern chosen.

4. **CORS**
   - Cannot use `credentials: true` with `Access-Control-Allow-Origin: *`. Must echo specific origin.

5. **Integrations**
   - Document: machine-to-machine clients may keep **Bearer** on separate path or API keys (out of scope unless you have them today).

### Testing

- Login, refresh page, API calls work without `Authorization` header.
- Logout clears session; back button does not resurrect authenticated calls.
- CSRF: state-changing request **without** token → **403**.
- Cross-browser: Chrome/Safari ITP behavior with your cookie shape.

### Fix risk: **HIGH** (if implemented carelessly)

| Risk | What goes wrong |
|------|------------------|
| **CSRF** | Cookies sent automatically; attacker’s site triggers state change on your API → **account takeover / data corruption**. |
| **Wrong SameSite** | Silent login failures after deploy; “works on my machine” with different domains. |
| **Over-broad cookie Domain/Path** | Token sent to too many subdomains or paths. |
| **Breaking mobile/scripts** | Anything relying on Bearer header breaks until updated. |

**Mitigation:** Feature-flag dual mode (Bearer + cookie) for one release only in non-prod; external security review of cookie + CSRF design before prod cutover.

---

## 4. H-2 — Unauthenticated `GET /si-lookups`

### Goal

Stop anonymous reads of the full master bundle (commodities, jetties across ports, agents, etc.).

### Detailed steps

1. **Inventory callers**
   - Frontend: `fetchSiLookups()` in `Frontend/src/api/siLookups.js` → used e.g. from `ShippingInstruction.jsx` (post-auth routes).
   - Confirm **no** `fetchSiLookups` or raw `apiGet('/si-lookups')` on Login, SelectPort, or public shell.

2. **Backend**
   - Apply `requireAuth` to `/si-lookups` router mount in `index.js`, **or** only to `GET /` aggregate handler.
   - Optional hardening: replace global jetty list in aggregate with **port-scoped** data using `requirePortScope` (aligns with least privilege; more work).

3. **Release**
   - Communicate API breaking change for any external consumer.

### Testing

- Without token → **401** on `/api/v1/si-lookups`.
- Full SI flow after login still loads dropdowns.
- Regression: multi-port user with header `X-Selected-Port-Id` still gets correct commodities/rates.

### Fix risk: **LOW–MEDIUM**

| Risk | What goes wrong |
|------|------------------|
| **Pre-login usage** | If future UI calls lookups before token exists, login or pages **break**. |
| **Caching/CDN** | Unlikely on API; if any public cache assumed anonymous GET, invalidate behavior. |

**Mitigation:** Grep + E2E for any unauthenticated call to `/si-lookups`; fix order: deploy FE guard first if needed, then enforce BE.

---

## 5. H-3 — Missing security headers (nginx / edge)

### Goal

Add `X-Content-Type-Options`, `Referrer-Policy`, frame controls, and **CSP** to shrink XSS blast radius.

### Detailed steps

1. **Non-CSP headers** (low controversy): add to `nginx.conf` or CDN.
2. **CSP**
   - Phase A: **`Content-Security-Policy-Report-Only`** with `report-uri` / Reporting API endpoint (or browser console in staging).
   - Phase B: Fix violations (often `connect-src` for API, `img-src`, script from Vite assets).
   - Phase C: **Enforce** CSP; keep narrow `script-src` (no `unsafe-inline` unless unavoidable).

3. **API (optional):** `helmet()` on Express for JSON API responses (separate from SPA CSP).

### Testing

- All routes: login, SI pages, **file preview/embed** if any, Excel export, PDF viewers.
- Third-party scripts (analytics): if present, must be allowlisted or removed.

### Fix risk: **MEDIUM** at enforce time

| Risk | What goes wrong |
|------|------------------|
| **Over-strict CSP** | Blank screen, blocked API calls, blocked inline error pages. |
| **`frame-ancestors`** | Embedded apps in iframe break. |

**Mitigation:** Mandatory Report-Only period in staging; canary deploy; fast nginx revert.

---

## 6. H-4 — No login throttling

### Goal

Cap attempts against `POST /auth/login` per IP (and optionally per username).

### Detailed steps

1. Implement **`express-rate-limit`** (or equivalent) **only** on `/api/v1/auth/login`.
2. **Distributed API:** use Redis store; single instance: in-memory with documented caveat.
3. Return **429** + `Retry-After`; log metric `auth_rate_limit_hit`.
4. **Before or with this:** `app.set('trust proxy', …)` so client IP behind LB is correct (else **wrong** limiter behavior).

### Testing

- Brute script: 429 after N tries.
- Same office / NAT: tune window and max so normal retry doesn’t block everyone.
- Spoofed `X-Forwarded-For` in staging: confirm LB strips or overwrites per provider design.

### Fix risk: **HIGH** without correct proxy trust

| Risk | What goes wrong |
|------|------------------|
| **Office-wide lockout** | Whole company shares one public IP → **availability** incident. |
| **Trust proxy too loose** | Attackers spoof IP → **rate limit bypass**. |
| **Trust proxy too strict** | All traffic appears as LB IP → **one bucket**, massive lockouts. |

**Mitigation:** Start with **high** thresholds; monitor 429; pair with WAF; optional per-username limiter to spread load behind NAT.

---

## 7. H-5 — Long-lived JWTs; minimal claims

### Goal

Reduce time window for a stolen token; optionally support logout/revocation.

### Option A — Short TTL only (simpler, higher UX cost)

1. Set `JWT_EXPIRES_IN` to e.g. `15m` or `1h`.
2. Users re-login when token expires unless you add refresh.

### Option B — Access + refresh (recommended long-term)

1. Short-lived **access** JWT (or opaque server token).
2. **Refresh** in HttpOnly cookie; rotation on use; detect reuse → revoke family.
3. Optional: `jti` blocklist in Redis on logout.

### Testing

- Idle tab past expiry: user gets clear **401** handling and redirect to login (or silent refresh if implemented).
- Logout: refresh invalidated if implemented.

### Fix risk: **MEDIUM–HIGH**

| Risk | What goes wrong |
|------|------------------|
| **Short TTL, no refresh** | Frequent logins → **support noise**, perceived outage. |
| **Refresh rotation bugs** | Reuse race → **random logouts** or **token theft** if reuse detection wrong. |
| **Clock skew** | Edge validators reject valid tokens. |

**Mitigation:** Phase 1: modest reduction (e.g. 7d → 24h) with monitoring; Phase 2: refresh with security-reviewed library pattern.

---

## 8. H-6 — Upload content trust (multer)

### Goal

Reject files whose **real** type does not match policy (do not trust browser `Content-Type` or extension alone).

### Detailed steps

1. Define **allowlist** per upload route (e.g. `operation-documents` vs sub-process): extensions + detected MIME family.
2. After multer writes temp file, read first **N** bytes → **`file-type`** (or similar) → compare to allowlist.
3. On mismatch: delete temp file, **400** with safe message.
4. Store server-detected type in DB (optional) alongside client hint.
5. **Performance:** stream-based read to avoid loading full 20MB into memory.

### Testing

- Valid PDF/JPEG/PNG upload still works.
- Rename `.exe` to `.pdf` → rejected.
- Edge: minimal/corrupt PDF handling per product decision.

### Fix risk: **MEDIUM** (business / ops)

| Risk | What goes wrong |
|------|------------------|
| **False negatives** | Unusual but valid files (certain scanners, PDF generators) → **workflow blocked**. |
| **CPU on hot path** | Large concurrent uploads → latency (usually acceptable at your scale). |

**Mitigation:** Product sign-off on allowed types; staged rollout; monitoring of upload **400** rate; escape hatch for admin-only reprocessing if needed.

---

## 9. Summary: which fixes are “high risk”?

| Finding | Fix creates high risk when… |
|---------|------------------------------|
| **H-1** | CSRF not implemented; cookie scope too wide; rushed cross-origin cookie rollout. |
| **H-2** | Enforced without verifying **no pre-login** consumer; undocumented API integrators. |
| **H-3** | CSP enforced **without** Report-Only tuning; breaks embeds or `connect-src`. |
| **H-4** | Rate limit deployed **before** correct `trust proxy`; limits too aggressive for shared IPs. |
| **H-5** | Refresh rotation implemented incorrectly; extremely short TTL without UX handling. |
| **H-6** | Allowlist too narrow for real business files; no playbook for users. |

**None of these should be skipped** for fear of risk; the mitigations are **phased rollout, staging gates, metrics, and rollback** (especially nginx CSP and rate-limit tuning).

---

## 10. Document control

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-04-03 | High findings only: detailed steps + fix-risk matrix |
| 1.1 | 2026-04-03 | Added §1a implementation status: completed vs manual verification |

**Classification:** Internal — security planning.
