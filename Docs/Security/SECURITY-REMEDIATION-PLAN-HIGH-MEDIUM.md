# Remediation plan and impact assessment — High & Medium security findings

**Related document:** [SECURITY-ASSESSMENT-REPORT.md](./SECURITY-ASSESSMENT-REPORT.md)  
**Scope:** Findings **H-1** through **H-6** and **M-1** through **M-4**  
**Status:** Planning only (no implementation assumed)

---

## 1. Purpose

This document provides a **comprehensive remediation plan** and **impact assessment** for the **High** and **Medium** findings from the security assessment. It is intended for engineering leads, product owners, and operations to prioritize work, estimate effort, and manage rollout risk.

**Note:** Several High items (**H-2**, and indirectly **H-1** / file access) **interact with Critical** items (notably **C-1** unauthenticated APIs and **C-5** static uploads). This plan calls out those dependencies so remediation stays coherent.

---

## 2. Summary matrix

| ID | Finding | Primary owner | Relative effort | User-visible impact | Infra / deploy impact |
|----|---------|---------------|-----------------|---------------------|------------------------|
| H-1 | JWT in `localStorage` | Full-stack | **Large** | Session model change; possible re-login | Cookies, CORS, TLS, CSRF |
| H-2 | Unauthenticated SI master reads | Backend (+ FE if login flow) | **Small–Medium**¹ | None if users already log in before forms | None |
| H-3 | Missing security headers | DevOps / FE | **Small** | Rare CSP breakages until tuned | nginx / edge config |
| H-4 | No login throttling | Backend (+ optional WAF) | **Small–Medium** | Legitimate users may see delay / lockout | Redis or in-memory; WAF rules |
| H-5 | Long-lived JWTs | Backend | **Medium** | More frequent re-auth if shortened | Env vars; optional refresh table |
| H-6 | Upload content trust | Backend | **Medium** | Rejected uploads if type not allowlisted | New dependency optional |
| M-1 | Password length 6 | Backend | **Small** | Stricter passwords on create/reset | Migration messaging only |
| M-2 | `optionalAuth` + missing secret | Backend | **Small** | Fail-fast in misconfigured envs | Startup behavior |
| M-3 | Trust proxy | Backend | **Small** | Correct client IP in logs/rate limits | Env: proxy hops count |
| M-4 | Error logging | Backend / SRE | **Small–Medium** | None if done well | Log pipeline, PII policy |

¹ **H-2** is quickest if bundled with **C-1** (require auth on `/si-lookups`); alone it may duplicate routing work.

---

## 3. Phased roadmap (recommended)

Work is grouped to avoid rework and minimize user disruption.

### Phase A — Quick wins, low UX risk (1–2 sprints)

| Order | Items | Rationale |
|-------|--------|-----------|
| A1 | **M-2**, **M-3**, **M-4** | Harden configuration and observability without changing auth UX. |
| A2 | **M-1** | Policy change; communicate before prod. |
| A3 | **H-3** | Add nginx security headers; iterate CSP in staging. |
| A4 | **H-4** | Protect `/auth/login` (in-app and/or WAF). |

### Phase B — API contract and session hygiene (2–4 sprints)

| Order | Items | Rationale |
|-------|--------|-----------|
| B1 | **H-2** (+ **C-1** alignment) | Require auth for sensitive aggregate endpoints; avoids duplicate “who can call si-lookups?” decisions. |
| B2 | **H-5** | Shorter access token TTL; add refresh strategy or accept shorter sessions until H-1. |
| B3 | **H-6** | Validate uploads after Phase B1/B2 stabilizes auth (signed URLs or authenticated download change **H-6** + **C-5** together). |

### Phase C — Architectural auth change (larger program)

| Order | Items | Rationale |
|-------|--------|-----------|
| C1 | **H-1** | HttpOnly cookies + CSRF, or BFF; depends on **H-5** and **C-1**/`C-5` being stable. |

**Dependency diagram (conceptual):**

```
M-2, M-3, M-4 ─┐
M-1, H-3, H-4 ─┼──► H-2 (+ C-1)
               │
H-5 ───────────┼──► H-1 (cookies/BFF need token/refresh story)
H-6 ───────────┴──► best paired with C-5 (authorized download)
```

---

## 4. Per-finding plan and impact assessment

### H-1 — JWT stored in `localStorage`

**Objective:** Reduce impact of XSS by keeping session tokens out of JavaScript-readable storage.

**Remediation options (pick one strategy):**

| Strategy | Description | Pros | Cons |
|----------|-------------|------|------|
| **A. HttpOnly + Secure cookies** | API sets `Set-Cookie` for access (and optionally refresh) token; SPA uses `credentials: 'include'`; CSRF token or SameSite=Lax/Strict | Industry standard pattern | Requires CSRF handling for unsafe methods; cookie domain/path design; cross-origin complexity if API host ≠ SPA host |
| **B. Backend-for-frontend (BFF)** | Thin same-origin Node layer; browser only talks to BFF; BFF holds server-side session | Strong isolation | More services to run and secure |
| **C. Mitigation-only (interim)** | Strict CSP + no inline scripts + dependency audit; keep localStorage | Smallest change | Does not remove XSS token theft fundamentally |

**Recommended path:** **A** if API and SPA can share a cookie domain or use reverse-proxy same origin; else **B** for split hosting.

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | Possible **full re-login** after deploy; session duration tied to cookie TTL; multi-tab behavior must be tested. |
| **Developers** | Refactor `Frontend/src/api/auth.js`, `client.js`, login/logout flows; E2E and CORS updates. |
| **Operations** | TLS required for `Secure` cookies; document cookie names and rotation; load balancer sticky sessions **not** required for JWT but may matter if moving to server sessions. |
| **Breaking changes** | Third-party or mobile clients using `Authorization: Bearer` only must be updated to cookie or alternate auth path. |
| **Residual risk** | XSS with CSP bypass or compromised dependency can still abuse sessions via CSRF if cookies are poorly scoped; pair with **H-3** and **H-5**. |

**Acceptance criteria**

- No long-lived access token in `localStorage` / `sessionStorage` for primary session.
- Logout clears server- and client-side session per chosen model.
- Security review of cookie flags (`HttpOnly`, `Secure`, `SameSite`) and CSRF test coverage for `POST`/`PUT`/`DELETE`.

---

### H-2 — Broad unauthenticated read of master/reference data (`GET /si-lookups` aggregate)

**Objective:** Stop anonymous aggregation of master data (commodities, jetties, agents, etc.) at the API boundary.

**Remediation approach**

1. **Require `requireAuth`** on `/api/v1/si-lookups` router mount (or on the aggregate `GET /` handler only, if public onboarding must stay—unlikely).
2. Optionally **split** endpoints: a minimal **public** bundle for true pre-login needs (e.g. nothing) vs authenticated masters.
3. Align with **C-1**: if all of `si-lookups` becomes authenticated, document **login page** must not depend on that endpoint (today verify in `Login.jsx` / port selection).
4. **Port-scoped subsets** (e.g. jetties for assigned ports only) may replace global jetties list for least privilege.

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | If SPA currently calls aggregate lookup **before** login, that flow **breaks** until the call moves after auth or uses a smaller public API. |
| **Developers** | Frontend audit: all `apiGet('/si-lookups')` timing vs token presence. |
| **Operations** | None beyond deployment coordination. |
| **Breaking changes** | Any script, integration, or cached Swagger client expecting anonymous `GET /si-lookups` will receive **401**. |
| **Residual risk** | Authenticated but low-privilege users may still see all masters unless combined with **page-level RBAC** per resource (future hardening). |

**Acceptance criteria**

- Anonymous `GET /api/v1/si-lookups` returns **401** (or **403** if you prefer “no token” as 401 consistently).
- SPA e2e: login → dashboards → SI forms still load lookups.
- Release notes list API behavior change for integrators.

---

### H-3 — Missing security headers on SPA (nginx)

**Objective:** Add defense-in-depth headers; primarily **CSP** to constrain XSS blast radius.

**Remediation approach**

1. Extend **`nginx.conf`** (or edge CDN) with:
   - `Content-Security-Policy` (start **report-only** in staging, then enforce).
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin` (or stricter)
   - `Permissions-Policy` (minimal features)
   - Frame policy: `X-Frame-Options` and/or `Content-Security-Policy: frame-ancestors`
2. Tune CSP for Vite: allow `'self'`, API origin for `connect-src`, any CDN for fonts/scripts if used.
3. Optionally add **`helmet`** on Express for API responses (separate from SPA).

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | Broken assets or blocked inline scripts if CSP too strict (common during first rollout). |
| **Developers** | Fix violations using browser console CSP reports; may need nonce/hash for any unavoidable inline. |
| **Operations** | Single config change; low rollback risk (revert nginx). |
| **Residual risk** | CSP does not stop all XSS; it **limits** exfiltration and script injection impact. |

**Acceptance criteria**

- Staging runs **CSP-Report-Only** with zero critical violations for core flows.
- Production CSP enforced; no broken login or main workflows.
- Documented policy exceptions (if any) are time-bounded.

---

### H-4 — No application-level login throttling

**Objective:** Limit credential stuffing and online guessing against `POST /auth/login`.

**Remediation approach**

1. **Application-level:** middleware using `express-rate-limit` or custom sliding window keyed by **IP** + optional **username** hash; separate stricter limit for `/auth/login`.
2. **Distributed:** store counters in **Redis** (or Valkey) if API is horizontally scaled; else start with in-memory with documented limitation.
3. **Account lockout:** optional delayed response or temporary lock after N failures (balance with user support burden).
4. **Infrastructure:** WAF rate rules (Alicloud, Cloudflare) as **additional** layer, not sole control.

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | Shared NAT offices may hit **IP limits**; provide clear **429** message and support playbook. |
| **Developers** | New dependency; tests for limit headers (`Retry-After`). |
| **Operations** | Redis if multi-instance; monitor 429 rates. |
| **Residual risk** | Distributed attacks with many IPs still need WAF; targeted attacks need MFA (out of scope here). |

**Acceptance criteria**

- Brute-force script triggers **429** without locking out entire user base under normal load tests.
- **M-3** trusted proxy enabled so limits use **real client IP** behind load balancer.

---

### H-5 — Long-lived JWTs; minimal claims

**Objective:** Shorten exposure window of stolen tokens; optional explicit revocation story.

**Remediation approach**

1. Reduce **access token** TTL (e.g. 15–60 minutes) via `JWT_EXPIRES_IN`.
2. Introduce **refresh token** (HttpOnly cookie recommended) or **silent refresh** endpoint with rotation and reuse detection (more work).
3. Add **`jti`** claim and server-side **blocklist** (Redis) for logout/revoke (optional, ops cost).
4. Document **clock skew** and mobile/long-running tab behavior.

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | More frequent **session expiry** unless refresh UX is smooth. |
| **Developers** | Auth flow changes; coordinate with **H-1** if moving to cookies. |
| **Operations** | Env var changes; if blocklist used, Redis lifecycle. |
| **Residual risk** | Without refresh, short TTL annoys users; with refresh, implementation complexity rises. |

**Acceptance criteria**

- Documented token lifetimes and user experience (refresh vs re-login).
- Stolen token usable only within defined **short** access window.
 penetration test or manual verify: old token rejected after logout **if** revocation implemented.

---

### H-6 — Upload content trust (multer)

**Objective:** Do not trust client `Content-Type`; reduce malware / illegal content storage risk.

**Remediation approach**

1. **Allowlist** extensions: e.g. `.pdf`, `.jpg`, `.png`, `.xlsx` per document kind.
2. Use **`file-type`** (or similar) on first bytes to infer MIME; **reject** mismatch vs allowlist.
3. Optional: antivirus scanning async (queue) for high-assurance environments.
4. Strip **EXIF** / normalize images only if product requires (privacy).

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | **Rejected uploads** with clear errors when type unsupported or spoofed. |
| **Developers** | Shared validation helper for `operation-documents` and sub-process uploads. |
| **Operations** | Slightly higher CPU on upload path; monitor 400 rates. |
| **Residual risk** | Polyglots and novel formats; AV still recommended for highest sensitivity. |

**Acceptance criteria**

- Spoofed extension (e.g. `.pdf` containing executable) rejected by magic-byte check.
- Product owner signs off **allowed types** per workflow.

---

### M-1 — Weak password policy (min 6 characters)

**Objective:** Align with organizational password policy (length, complexity, breach list optional).

**Remediation approach**

1. Raise minimum length (e.g. **12**+) and enforce on `POST /users` and `PUT /users/:id` password change.
2. Optional: integrate **zxcvbn** or Have I Been Pwned k-anonymity API (privacy-preserving).
3. Communicate **grace period** for existing users or force reset on next login (policy decision).

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | Password creation/update **rejects** weak passwords; admin training needed. |
| **Developers** | Validation helper; consistent error messages. |
| **Operations** | Help desk may see more reset requests during transition. |
| **Residual risk** | Users choose repetitive long passwords; MFA is stronger control (separate initiative). |

**Acceptance criteria**

- Documented policy in admin UI / internal wiki.
- Unit tests for boundary lengths and rejection messages.

---

### M-2 — `optionalAuth` when `JWT_SECRET` missing

**Objective:** Fail closed or loud in misconfiguration, not silent continuation.

**Remediation approach**

1. At **process startup**, if any route registers `optionalAuth` and `JWT_SECRET` is missing in production (`NODE_ENV=production`), **exit(1)** with clear message.
2. Alternatively, make `optionalAuth` return **503** for requests that **present** a Bearer token but secret is missing (edge case).
3. Keep development behavior permissive only when `NODE_ENV=development` **and** documented.

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | None if prod always configured correctly; broken deploy **fails fast** instead of partial security. |
| **Developers** | Local `.env` must include `JWT_SECRET` (already required for login). |
| **Operations** | Misconfigured pod will **not** start; alerts on crash loop. |

**Acceptance criteria**

- Production startup fails without `JWT_SECRET`.
- Documented in **ALICLOUD-DEPLOYMENT-GUIDE** (or equivalent).

---

### M-3 — Trust proxy

**Objective:** Correct client IP when behind reverse proxy / load balancer for rate limits and logs.

**Remediation approach**

1. `app.set('trust proxy', <n>)` or subnet list matching Alicloud LB.
2. Use **first public IP** or `X-Forwarded-For` per your LB’s documented behavior.
3. Pair with **H-4** so rate limits are not trivially bypassed.

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | None directly. |
| **Developers** | Verify in staging behind same LB shape as prod. |
| **Operations** | Wrong `trust proxy` can enable **IP spoofing**; use exact hop count from provider docs. |

**Acceptance criteria**

- Access logs show expected client IPs in staging behind LB.
- Rate limit triggers from single client behind shared proxy behave as designed.

---

### M-4 — Error logging (500 handler)

**Objective:** Avoid sensitive data in logs; keep operator usefulness.

**Remediation approach**

1. Structured logging with **PII scrubbing** (passwords, tokens, `Authorization` headers).
2. Log **correlation ID** per request; return generic message to client always.
3. Separate **debug** stack traces: only in non-production or gated by env flag.
4. Document **log retention** and access control (who can read prod logs).

**Impact assessment**

| Dimension | Assessment |
|-----------|------------|
| **End users** | No change if responses stay generic. |
| **Developers** | Small wrapper around `console.error`; may adopt `pino`/`winston`. |
| **Operations** | Log volumemay change; SIEM parsing rules updated. |

**Acceptance criteria**

- Sample production log line contains **no** raw JWT or password fields.
- Runbook for support: how to find correlation ID from user report.

---

## 5. Cross-cutting testing plan

| Area | Tests |
|------|--------|
| **Auth** | Login, logout, token expiry, concurrent sessions, back button after logout |
| **API** | Anonymous `si-lookups`, rate limit 429, upload reject types |
| **Headers** | CSP report in staging; securityheaders.com scan |
| **Regression** | Playwright / critical path: SI create, operation workflow, uploads |
| **Load** | Login endpoint under burst (ensure 429 without starvation) |

---

## 6. Rollback strategy

| Change | Rollback |
|--------|----------|
| nginx CSP | Revert `nginx.conf`; redeploy prior image |
| Rate limit | Feature flag or env to disable limits temporarily |
| Cookie auth (H-1) | Feature flag: dual support Bearer+cookie during migration window |
| Password policy | Temporary higher limit for admins only (not ideal—prefer comms) |

---

## 7. Effort estimates (indicative)

Rough engineering time for a small team familiar with the codebase. Treat as **order-of-magnitude** only.

| Item | Indicative effort |
|------|-------------------|
| H-3, M-1, M-2, M-3, M-4 | **0.5–2 days** each |
| H-4, H-6, H-2 | **1–3 days** each (H-2 + FE audit) |
| H-5 | **2–5 days** (simple TTL) to **2–4 weeks** (full refresh + rotation) |
| H-1 | **1–3 weeks** depending on cookie/CSRF and hosting layout |

---

## 8. Document control

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-04-03 | Initial plan for High & Medium findings |

**Classification:** Internal — security planning.
