# OWASP Top 10 (2021) Security Code Review

**Application:** Jetty Planning System (JPS)  
**Review date:** 2026-04-27  
**Reviewer role:** Senior Security Engineer (static analysis)  
**Scope:** Backend (Express/PostgreSQL), Frontend (React/Vite), Docker/Compose, dependencies, secrets hygiene  
**Method:** Source review, route/middleware mapping, grep for dangerous patterns, `npm audit` on Backend and Frontend lockfiles  

**Related prior work:** [SECURITY-ASSESSMENT-REPORT.md](./SECURITY-ASSESSMENT-REPORT.md), [SECURITY-REASSESSMENT-REPORT-2026-04-23.md](./SECURITY-REASSESSMENT-REPORT.md), [SECURITY-ROUTE-BY-ROUTE-FIX-MATRIX.md](./SECURITY-ROUTE-BY-ROUTE-FIX-MATRIX.md)

---

## Executive summary

JPS has improved materially since the initial assessment: cookie-based sessions with CSRF, login rate limiting, magic-byte upload validation, SI lookup authentication, and port-scoped operation access are in place. **No exploitable SQL injection or React XSS sinks (`dangerouslySetInnerHTML`, `eval`) were found.**

The **highest remaining risk** is **Broken Access Control**: uploaded files are served from **`GET /uploads/*` without authentication**, and several mutation endpoints lack RBAC or port-scope checks. Dependency audits report **High** issues in transitive packages (`nodemailer`, `path-to-regexp`, `tmp`). Docker production stacks are reasonably configured, but dev compose defaults and container hardening gaps remain.

| Severity | Count (this review) |
|----------|---------------------|
| Critical | 1 |
| High     | 8 |
| Medium   | 14 |
| Low      | 10 |

---

## OWASP Top 10 (2021) mapping

| OWASP category | Primary findings in JPS |
|----------------|-------------------------|
| **A01 Broken Access Control** | Unauthenticated `/uploads`; SI delete IDOR; missing RBAC on SI/operation mutations; legacy `port_id IS NULL` bypass |
| **A02 Cryptographic Failures** | JWT verify without explicit `HS256`; optional JWT in login body; dev default secrets in compose examples |
| **A03 Injection** | SQL: parameterized queries dominate (Low residual risk from whitelist dynamic identifiers); no XSS sinks found |
| **A04 Insecure Design** | Public static upload mount; client-supplied document URLs stored without ownership validation |
| **A05 Security Misconfiguration** | Alicloud nginx missing security headers; API bound `0.0.0.0:3000`; dev Postgres on `0.0.0.0:5433`; Backend container runs as root |
| **A06 Vulnerable Components** | `npm audit`: nodemailer (High), path-to-regexp (High), tmp (High), file-type/esbuild/qs (Moderate) |
| **A07 Identification & Authentication Failures** | Login rate-limited (good); OIDC/local coexistence implemented; `optionalAuth` silently skips when `JWT_SECRET` unset |
| **A08 Software & Data Integrity** | Backend Dockerfile uses `npm install` without lockfile — non-reproducible builds |
| **A09 Logging & Monitoring** | Auth event logging added for OIDC/local paths (good); no centralized security alerting documented |
| **A10 SSRF** | RTSP viewer passes URL to FFmpeg (`rtsp-stream-viewer`); SI document extract accepts uploads (bounded) |

---

## Findings (ranked by severity)

### Critical

#### C-01 — Unauthenticated static file access via `/uploads`

| Field | Detail |
|-------|--------|
| **OWASP** | A01 Broken Access Control, A04 Insecure Design |
| **Location** | `Backend/src/index.js` — `app.use('/uploads', express.static(UPLOAD_ROOT))` |
| **Also** | `Frontend/nginx.conf`, `Frontend/nginx.alicloud-app.conf` proxy `/uploads/` to API without auth |
| **Risk** | Anyone who knows or guesses a path (e.g. `operations/{id}/clearance/...`, seed paths in migrations) can download uploaded clearance documents, photos, and operation files without a session. |
| **Evidence** | Predictable path structure in `operation-documents.js`, `operation-sub-processes.js`, `si-document-storage.js`. |

**Remediation (actionable):**

1. **Remove** the public static mount in `Backend/src/index.js`.
2. Serve all files only through authenticated handlers (existing patterns in `send-stored-file.js`, `operation-documents` download routes, SI document routes).
3. Add authorization checks: caller must have port access to the owning operation/SI/plan.
4. Update Frontend to use authenticated download URLs only (`resolveUploadUrl` → API download endpoints, not raw `/uploads/...`).
5. Optionally add short-lived signed URLs if direct streaming performance is required.
6. **Verify:** Unauthenticated `curl http://<host>/uploads/operations/1/clearance/foo.pdf` returns **401/404**; authenticated user with port access succeeds.

---

### High

#### H-01 — Shipping instruction delete without port-scope check (IDOR)

| Field | Detail |
|-------|--------|
| **OWASP** | A01 Broken Access Control |
| **Location** | `Backend/src/routes/shipping-instructions.js` — `DELETE /:id` |
| **Risk** | Authenticated user on Port A can delete an SI belonging to Port B if they know the SI id. GET/PUT enforce `preferred_port_id` vs `req.selectedPortId`; DELETE does not. |

**Remediation:**

```javascript
// Before delete, mirror GET/PUT port check:
if (Number(existing.preferred_port_id) !== Number(req.selectedPortId)) {
  return res.status(403).json({ error: 'Forbidden for selected port' });
}
```

Add `requirePageDelete('shipment-plan')` (or appropriate page key) on the route.

**Verify:** User scoped to Port A receives **403** when deleting Port B SI id.

---

#### H-02 — SI mutations lack RBAC enforcement

| Field | Detail |
|-------|--------|
| **OWASP** | A01 Broken Access Control |
| **Location** | `Backend/src/routes/shipping-instructions.js` — POST/PUT/DELETE |
| **Risk** | `userHasPageApprove` / `userHasPageDelete` are imported but not consistently applied. Any port-scoped authenticated user can create/modify/delete SIs. |

**Remediation:**

- Apply `requirePageEdit('shipment-plan')` on POST/PUT.
- Apply `requirePageDelete('shipment-plan')` on DELETE.
- Apply `requirePageApprove('shipment-plan')` on approve/submit flows.
- Remove unused imports or wire them into middleware chain.

---

#### H-03 — Operation delete without page permission check

| Field | Detail |
|-------|--------|
| **OWASP** | A01 Broken Access Control |
| **Location** | `Backend/src/routes/operations.js` — `DELETE /:id` |
| **Risk** | Port scope is enforced, but any user with port access can soft-delete operations and dependent QC/quantity data regardless of RBAC role. |

**Remediation:** Add `requirePageDelete('loading')` or `requirePageDelete('unloading')` based on operation purpose, or a shared operations admin permission, before delete handler runs.

---

#### H-04 — Exception approve/reject without verification RBAC

| Field | Detail |
|-------|--------|
| **OWASP** | A01 Broken Access Control |
| **Location** | `Backend/src/routes/operations.js` — `POST .../approve-exception`, `.../reject-exception` |
| **Risk** | Port-scoped users can approve/reject clearance exceptions without `can_approve` on verification page. |

**Remediation:** Gate with `userHasPageApprove('verification')` or equivalent before state transition.

---

#### H-05 — JWT verification without explicit algorithm pinning

| Field | Detail |
|-------|--------|
| **OWASP** | A02 Cryptographic Failures |
| **Location** | `Backend/src/middleware/auth.js:51`, `Backend/src/lib/session-cookies.js`, `Backend/src/lib/oidc-flow.js` |
| **Risk** | `jwt.verify(token, JWT_SECRET)` without `{ algorithms: ['HS256'] }` — algorithm confusion class if misconfigured keys/algorithms are introduced. Hub SSO correctly pins `HS256` in `hub-sso.js`. |

**Remediation:**

```javascript
const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
// On sign:
jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });
```

Apply consistently in `auth.js`, `session-cookies.js`, `oidc-flow.js`.

---

#### H-06 — Dependency: nodemailer (High CVEs)

| Field | Detail |
|-------|--------|
| **OWASP** | A06 Vulnerable Components |
| **Location** | `Backend/package.json` — `nodemailer@^6.9.16` |
| **CVEs (npm audit)** | GHSA-mm7p-fcc7-pg87, GHSA-rcmh-qjqh-p98v, GHSA-c7w3-x93f-qmm8, GHSA-vvjj-xcjg-gr5g |
| **Risk** | DoS, unintended recipient domain, SMTP command injection if attacker influences envelope/transport options. |

**Remediation:**

1. Upgrade to `nodemailer@>=8.0.10` (test notification email worker).
2. Sanitize/validate all recipient addresses and envelope fields in `notification-email-worker.js`.
3. Run `npm audit fix` and regression-test email flows.

---

#### H-07 — Dependency: path-to-regexp (High ReDoS)

| Field | Detail |
|-------|--------|
| **OWASP** | A06 Vulnerable Components |
| **Location** | Transitive via `express@^4.21.0` |
| **CVE** | GHSA-37ch-88jc-xwx2 |
| **Risk** | ReDoS via crafted route parameters (exploitable if attacker controls route param patterns at runtime — lower direct risk for fixed routes). |

**Remediation:** Upgrade Express to latest 4.x patch (`npm audit fix`); monitor Express 5 migration path.

---

#### H-08 — Dev Docker compose ships default credentials

| Field | Detail |
|-------|--------|
| **OWASP** | A05 Security Misconfiguration, A02 Cryptographic Failures |
| **Location** | `Backend/docker-compose.yml` — `POSTGRES_PASSWORD: jps_dev_password`, `JWT_SECRET: dev-jwt-secret-change-in-production` |
| **Risk** | If this compose file is used on a network-reachable host without override, credentials are trivially guessable. |

**Remediation:**

1. Never deploy `Backend/docker-compose.yml` to shared/staging/prod hosts.
2. Remove inline defaults; require `${POSTGRES_PASSWORD:?}` and `${JWT_SECRET:?}` even in dev.
3. Document in deployment guide: rotate credentials if defaults were ever exposed.

---

### Medium

#### M-01 — SI lookup master CRUD without RBAC (non-commodity types)

| **Location** | `Backend/src/routes/si-lookups.js` — POST/PUT/DELETE on shippers, agents, trade-terms, etc. |
| **Risk** | Any authenticated user can mutate global master data. |
| **Fix** | Apply `requirePageEdit` / `requirePageDelete` for corresponding `master-si-*` page keys per lookup type. |

#### M-02 — Jetty layout PUT without RBAC

| **Location** | `Backend/src/routes/jetty-layout.js` — `PUT /` |
| **Risk** | Any port-scoped user can change jetty layout. |
| **Fix** | Add `requirePageEdit('master-jetty-layout')` on PUT; mirror in `Frontend/src/pages/MasterJettyLayout.jsx` with `canEdit` guard. |

#### M-03 — Operation state transitions mostly port-scoped only

| **Location** | `Backend/src/routes/operations.js` — status changes, docking, depart, shifting-out, materials CRUD |
| **Risk** | Users without loading/unloading edit permissions can mutate operational state. |
| **Fix** | Apply `userHasPageEdit('loading'|'unloading')` per operation purpose on mutating routes (pattern already used for signoff). |

#### M-04 — Legacy operations with `port_id IS NULL` accessible from any port

| **Location** | `Backend/src/lib/operation-access.js` |
| **Risk** | Cross-port access to unmigrated rows. |
| **Fix** | Backfill `port_id`; treat null as deny-by-default or admin-only. |

#### M-05 — Client-supplied document URLs stored without ownership validation

| **Location** | `operations.js` (clearance/photo URLs on depart), `shipment-plans.js`, `qc-surveys.js` (`fileUrl`) |
| **Risk** | Client can reference `/uploads/...` paths belonging to other operations. |
| **Fix** | Accept only document IDs or paths validated against uploads for that operation/plan; reject external URLs unless allowlisted. |

#### M-06 — Rate limiting only on login

| **Location** | `Backend/src/routes/auth.js` — sole `express-rate-limit` usage |
| **Risk** | Upload, OCR extract, OIDC callback, and enumeration endpoints can be abused for DoS. |
| **Fix** | Add limiters on `/auth/oidc/*`, upload routes, `si-document-extract`; enforce WAF/API gateway throttling in production. |

#### M-07 — Alicloud nginx missing security headers

| **Location** | `Frontend/nginx.alicloud-app.conf` |
| **Risk** | Production Alicloud deployments lack CSP, X-Frame-Options, etc. present in `Frontend/nginx.conf`. |
| **Fix** | Copy `add_header` block from `Frontend/nginx.conf` into Alicloud config; tune CSP for production origins. |

#### M-08 — Backend API container runs as root

| **Location** | `Backend/Dockerfile` — no `USER` directive |
| **Fix** | Add non-root user: `RUN addgroup -S jps && adduser -S jps -G jps` + `USER jps`; ensure `/tmp/jps-uploads` is writable. |

#### M-09 — Backend Dockerfile ignores lockfile (`npm install`)

| **Location** | `Backend/Dockerfile` |
| **Risk** | Non-reproducible builds; supply-chain drift between builds. |
| **Fix** | `COPY package.json package-lock.json ./` + `RUN npm ci --omit=dev`. |

#### M-10 — Dev Postgres exposed on all interfaces

| **Location** | `Backend/docker-compose.yml` — `5433:5432` |
| **Fix** | Bind `127.0.0.1:5433:5432`; firewall host if remote access needed. |

#### M-11 — `optionalAuth` continues without auth when `JWT_SECRET` unset

| **Location** | `Backend/src/middleware/auth.js:27-28` |
| **Risk** | Misconfiguration silently disables optional auth paths. |
| **Fix** | Log error and fail closed in production when `JWT_SECRET` is missing. |

#### M-12 — Legacy SSO bridge enabled by default in production compose

| **Location** | `docker-compose.backend.yml` — `SSO_LEGACY_BRIDGE_ENABLED: ${...:-true}` |
| **Fix** | Default to `false` after OIDC cutover; document transition flag in rollout checklist. |

#### M-13 — Dependency: file-type (Moderate — upload parser DoS)

| **Location** | `Backend/package.json` — `file-type@^18.7.0` |
| **Fix** | Upgrade to `file-type@>=22.0.1`; retest upload validation in operation and SI routes. |

#### M-14 — Root `.gitignore` incomplete for env variants

| **Location** | Root `.gitignore` — missing broad `.env.*` pattern |
| **Fix** | Mirror Backend pattern: `.env.*` with `!.env.example`; add `Frontend/.gitignore`. |

---

### Low

#### L-01 — Optional JWT returned in login JSON body

| **Location** | `Backend/src/routes/auth.js` — `AUTH_RETURN_TOKEN_BODY=true` |
| **Fix** | Ensure `false` in all browser-facing environments; Bearer tokens bypass CSRF. |

#### L-02 — Dynamic SQL table/column names (whitelist-controlled)

| **Location** | `si-lookups.js`, `shipping-instructions.js` — `${cfg.table}` from hardcoded maps |
| **Fix** | Add code comment + unit test that user input never flows into identifier slots; consider enum guard function. |

#### L-03 — Frontend lacks route-level login redirect

| **Location** | `Frontend/src/App.jsx`, `Layout.jsx` |
| **Fix** | Add `ProtectedRoute` wrapper redirecting unauthenticated users to `/login`. |

#### L-04 — Embed route bypasses Layout RBAC UI

| **Location** | `App.jsx` — `/shipping-instruction/view/:siId?embed=1` |
| **Fix** | Ensure API enforces auth + port + page view; add token/embed secret if used in iframes. |

#### L-05 — Activity logs not port-filtered

| **Location** | `Backend/src/routes/activity-logs.js` |
| **Fix** | Filter by `req.selectedPortId` where applicable. |

#### L-06 — CSP allows `style-src 'unsafe-inline'` and broad `connect-src https:`

| **Location** | `Frontend/nginx.conf` |
| **Fix** | Tighten CSP for production; use nonce/hash for inline styles if feasible. |

#### L-07 — Express API lacks Helmet security headers

| **Location** | `Backend/src/index.js` |
| **Fix** | Add `helmet()` with API-appropriate config (or rely on nginx only — document single point of enforcement). |

#### L-08 — Hardcoded dev passwords in seed/scripts/e2e

| **Location** | `Backend/scripts/seed-admin-bcrypt.js`, e2e specs, `002_seed_first_user.sql` |
| **Fix** | Acceptable for local dev; ensure seeds never run in production; use env-based test credentials in CI. |

#### L-09 — Dependency: esbuild/vite dev-only CVE (Moderate)

| **Location** | Frontend devDependencies |
| **Fix** | Dev server exposure only; upgrade Vite when feasible; never expose Vite dev server to untrusted networks. |

#### L-10 — RTSP URL passed to FFmpeg spawn

| **Location** | `rtsp-stream-viewer/lib/mpeg1Muxer.js` |
| **Fix** | Allowlist RTSP host/port; validate URL scheme before spawn. |

---

## Injection & XSS analysis (detailed)

### SQL injection (PostgreSQL)

**Verdict: No exploitable SQLi found.**

- Widespread use of parameterized queries (`$1`, `$2`, …) across routes.
- Dynamic `WHERE` clauses in `operations.js`, `dashboard-v2-weekly.js` bind values via placeholders.
- Dynamic identifiers (`${cfg.table}`) sourced from **hardcoded maps** in `si-lookups.js` — not directly user-controlled; maintain whitelist discipline on future changes.

**Recommendation:** Add ESLint/custom rule or PR checklist: ban string concatenation of `req.*` into SQL.

### XSS (React)

**Verdict: No direct XSS sinks found.**

- No `dangerouslySetInnerHTML`, `eval`, or `innerHTML =` in `Frontend/src`.
- Hub SSO error HTML uses `htmlEscape()` in `hub-sso.js`.
- User content rendered through React text nodes (auto-escaped).

**Residual risk:** Stored URLs in documents/QC fields rendered as links — validate `href` scheme (`https:` only) if link rendering is added.

---

## Cryptographic controls (detailed)

| Control | Status | Location |
|---------|--------|----------|
| Password hashing (bcrypt, cost 10) | ✅ Good | `auth.js`, `users.js`, SSO JIT paths |
| HttpOnly session cookie | ✅ Good | `session-cookies.js` — `jps_at` |
| CSRF double-submit | ✅ Good | `csrf.js`, `client.js` |
| SameSite cookies | ✅ Lax | `auth-cookies.js` |
| Secure cookie flag | ✅ Configurable | `COOKIE_SECURE` env |
| JWT algorithm pinning | ⚠️ Gap | `auth.js` — see H-05 |
| OIDC id_token validation | ✅ Good | `oidc-client.js` — RS256 + JWKS via `jose` |
| Login rate limiting | ✅ Good | `auth.js` — 40/15min default |
| TLS termination | ⚠️ Deployment | HTTP on `:3080`/`:3000` in Alicloud guide — use HTTPS in SIT/PROD |

---

## Dependencies review

Run date: 2026-04-27. Command: `npm audit` in `Backend/` and `Frontend/`.

### Backend (`Backend/package.json`)

| Package | Severity | Issue | Action |
|---------|----------|-------|--------|
| `nodemailer` <=8.0.4 | **High** | Multiple GHSA (DoS, SMTP injection, domain confusion) | Upgrade to >=8.0.10 |
| `path-to-regexp` <0.1.13 | **High** | ReDoS (via express) | `npm audit fix` / Express patch |
| `file-type` 13–21.3.0 | Moderate | ASF parser infinite loop | Upgrade to >=22.0.1 |
| `brace-expansion` | Moderate | Memory exhaustion | `npm audit fix` |
| `qs` / `body-parser` / `express` | Moderate | DoS in stringify | `npm audit fix` |

### Frontend (`Frontend/package.json`)

| Package | Severity | Issue | Action |
|---------|----------|-------|--------|
| `tmp` <0.2.6 | **High** | Path traversal (transitive, likely dev tooling) | `npm audit fix` |
| `esbuild` / `vite` | Moderate | Dev server request leak | Dev-only; upgrade Vite when ready |
| `postcss` | Moderate | XSS in CSS stringify (build-time) | `npm audit fix` |
| `react-router-dom` 6.7–6.30.3 | Moderate | Open redirect via `//` paths | Upgrade to patched 6.x |
| `uuid` / `exceljs` | Moderate | Buffer bounds | `npm audit fix` |

**Process recommendation:**

1. Run `npm audit` in CI weekly.
2. Pin lockfiles; use `npm ci` in all Docker builds (Frontend already does; Backend does not).
3. Enable Dependabot or Renovate for automated PRs.

---

## Docker & Compose review

### Positive patterns

- Production compose requires `POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN` via `${VAR:?}`.
- Postgres admin port on production backend bound to `127.0.0.1:5436` (SSH tunnel only).
- No `privileged`, `cap_add`, or `network_mode: host` in compose files.
- Frontend multi-stage build with `nginx:alpine` and `npm ci`.
- `.dockerignore` excludes `.env` from Backend build context.

### Misconfigurations

| Issue | Severity | File | Remediation |
|-------|----------|------|-------------|
| Backend runs as root | Medium | `Backend/Dockerfile` | Add non-root `USER` |
| Dev image used for prod API | Medium | `Backend/Dockerfile` + compose override | Create production Dockerfile stage with `npm ci --omit=dev` |
| API port `3000:3000` on all interfaces | Medium/High | `docker-compose.backend.yml` | Restrict via security group; bind loopback if nginx on same host |
| Dev Postgres `5433:5432` public | High (dev) | `Backend/docker-compose.yml` | `127.0.0.1:5433:5432` |
| Postgres `ssl=off` on dedicated DB | Medium | `Backend/infra/postgres/postgresql.conf` | Enable SSL for three-server layout |
| `pg_hba.conf` local `trust` | Medium | Inside container only — limit container access |
| Missing `read_only`, `no-new-privileges` | Low | All compose files | Add defense-in-depth |
| Alicloud nginx no security headers | Medium | `Frontend/nginx.alicloud-app.conf` | Align with `Frontend/nginx.conf` |

---

## Secrets & credentials review

### No production secrets in application source

Grep found **no hardcoded API keys, JWT secrets, or cloud tokens** in `Backend/src` or `Frontend/src`.

Secrets correctly loaded from environment:

- `JWT_SECRET` — auth middleware, session cookies
- `SSO_TOKEN_SECRET` — legacy Hub bridge
- `SMTP_PASS` — notification email worker
- OIDC config — `oidc-config.js`

### Items to treat as secrets (ensure not committed)

| File | Notes |
|------|-------|
| `Backend/.env` | Gitignored ✅ |
| Root `.env` | Gitignored ✅; extend pattern for `.env.*` |
| `docker inspect` | `DATABASE_URL` embeds password — restrict host access |

### Dev/test credentials in repo (acceptable with constraints)

- `admin123` in seed scripts, e2e tests, migration `002_seed_first_user.sql`
- **Action:** Never run seeds against production; rotate default admin after first deploy.

---

## Remediated since prior assessments ✅

These were Critical/High in earlier reports and appear **fixed** in current code:

| Previous finding | Current state |
|------------------|---------------|
| Unauthenticated `/users`, `/rbac` admin routes | Gated by `requireAdminPageView` |
| Unauthenticated master routes (ports, jetties, standard-rates) | `requirePageView` at router level |
| Cross-port IDOR on operation modules | `assertOperationInSelectedPort` widely applied |
| JWT in localStorage | Migrated to HttpOnly cookies + CSRF |
| Unauthenticated SI lookups | `requireAuth` on mount |
| Upload MIME trust only | Magic-byte validation via `file-type` |
| Missing nginx security headers (dev image) | Present in `Frontend/nginx.conf` |

---

## Prioritized remediation roadmap

### Phase 1 — Immediate (1–2 sprints)

1. **C-01** — Remove public `/uploads` static mount; authenticated download only.
2. **H-01, H-02** — Fix SI delete IDOR + RBAC on SI mutations.
3. **H-05** — Pin JWT algorithms to HS256.
4. **H-06, H-07** — Patch npm audit High findings (nodemailer, express/path-to-regexp).

### Phase 2 — Short term (2–4 sprints)

5. **H-03, H-04** — RBAC on operation delete and exception approve/reject.
6. **M-01–M-05** — RBAC gaps on lookups, jetty layout, operation transitions, document URL validation.
7. **M-07** — Security headers on Alicloud nginx.
8. **M-08–M-09** — Docker hardening (non-root, `npm ci`).

### Phase 3 — Hardening & sustainment

9. **M-06** — Extended rate limiting / WAF rules.
10. **M-04** — Backfill legacy null `port_id`.
11. CI: `npm audit --audit-level=high`, secret scanning, periodic OWASP re-review.
12. Penetration test focused on IDOR, upload access, and RBAC bypass after Phase 1.

---

## Verification checklist (post-remediation)

- [ ] Unauthenticated request to `/uploads/*` fails
- [ ] Cross-port SI delete returns 403
- [ ] User without `shipment-plan` edit cannot POST/PUT SI
- [ ] User without loading edit cannot change operation status
- [ ] JWT with `alg: none` or wrong algorithm rejected
- [ ] `npm audit` shows no High/Critical in production dependency tree
- [ ] Backend container runs as non-root
- [ ] Alicloud nginx returns CSP, X-Frame-Options, X-Content-Type-Options
- [ ] Local login and OIDC SSO both work after changes

---

*This document is a point-in-time static review. Dynamic testing (DAST), infrastructure review (SG/WAF/TLS), and manual penetration testing are recommended before production go-live.*
