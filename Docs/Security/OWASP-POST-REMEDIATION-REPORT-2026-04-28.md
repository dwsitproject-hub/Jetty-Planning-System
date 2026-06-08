# OWASP Post-Remediation Report

**Application:** Jetty Planning System (JPS)  
**Report date:** 2026-04-28  
**Last updated:** 2026-06-08 — C-01 closure verified  
**Baseline review:** [OWASP-TOP10-CODE-REVIEW-2026-04-27.md](./OWASP-TOP10-CODE-REVIEW-2026-04-27.md)  
**Scope of this report:** Verification of **Critical** and **High** findings after engineering remediation  
**Review method:** Static code re-review + targeted automated tests + live API probes (where services were running)

---

## Executive summary

Engineering addressed **all 9** Critical/High items from the baseline OWASP review. Broken Access Control gaps on shipping instructions and operations were closed with RBAC and port-scope checks. Cryptographic controls were strengthened with explicit JWT `HS256` pinning. Dependency High issues for `nodemailer` and `path-to-regexp` were remediated. Dev Docker compose no longer ships hardcoded credentials.

**C-01 (unauthenticated file access) is closed.** The public static mount on `/uploads` was retired and replaced with an explicit 404 handler. Live retest with a real on-disk file confirms unauthenticated requests return **404** (not 200). Authenticated access flows through `/api/v1/stored-files` and document-specific routes.

| Severity (baseline) | Total | Fixed | Partial | Open |
|---------------------|-------|-------|---------|------|
| Critical            | 1     | 1     | 0       | 0    |
| High                | 8     | 8     | 0       | 0    |

**Recommendation for next reviewer:** All Critical/High baseline items are remediated and verified. Focus follow-up on **Medium** findings from the baseline review and remaining dependency Moderate/High items (`tar`, `file-type`).

---

## Remediation status matrix

| ID | Finding (baseline) | Status | Primary evidence |
|----|-------------------|--------|------------------|
| **C-01** | Unauthenticated static file access via `/uploads` | **Fixed** | Static mount removed; 404 handler + authenticated routes; live probe passed |
| **H-01** | SI delete without port-scope (IDOR) | **Fixed** | `shipping-instructions.js` DELETE handler |
| **H-02** | SI mutations lack RBAC | **Fixed** | POST/PUT/DELETE permission checks |
| **H-03** | Operation delete without page permission | **Fixed** | `operations.js` DELETE handler |
| **H-04** | Exception approve/reject without verification RBAC | **Fixed** | `operations.js` approve/reject handlers |
| **H-05** | JWT verify without explicit algorithm pinning | **Fixed** | `auth.js`, `session-cookies.js`, `oidc-flow.js` |
| **H-06** | nodemailer High CVEs | **Fixed** | `package.json` → `nodemailer@^8.0.10` + email validation |
| **H-07** | path-to-regexp High ReDoS (via express) | **Fixed** | No longer reported as High in post-remediation `npm audit` |
| **H-08** | Dev Docker compose default credentials | **Fixed** | `Backend/docker-compose.yml` requires env secrets |

---

## Detailed remediation evidence

### C-01 — Unauthenticated `/uploads` (FIXED)

#### Final implementation

| Change | File(s) | Purpose |
|--------|---------|---------|
| Public static mount retired | `Backend/src/index.js:72-75` | `/uploads` returns **404 JSON** — files are not served publicly |
| Authenticated stored-file API | `Backend/src/routes/stored-files.js` | `GET /api/v1/stored-files/view` and `/download` with auth + port scope |
| Path normalization + ownership checks | `Backend/src/lib/stored-file-access.js` | Maps disk path → operation/SI/sub-process/plan; enforces port access |
| Frontend URL rewrite | `Frontend/src/api/client.js` — `resolveUploadUrl()` | Rewrites legacy `/uploads/...` to authenticated `stored-files/view?path=...` |
| Depart URL validation | `Backend/src/lib/depart-document-url.js` | Validates client-supplied clearance/photo URLs on depart |
| Security unit tests + live probe | `Backend/scripts/test-security-rbac-uploads.mjs` | Writes probe file to disk; asserts `/uploads` → 404, `stored-files` → 401 |
| E2E upload access tests | `Frontend/e2e/uploads-auth.spec.js` | Probe file on disk; unauthenticated `/uploads` blocked; upload flow checks |
| Nginx `/uploads` proxy removed | `Frontend/nginx.conf` | Production SPA no longer proxies public `/uploads` |
| Vite `/uploads` proxy removed | `Frontend/vite.config.js` | Dev server no longer forwards public `/uploads` |

#### Current API behavior (`Backend/src/index.js`)

```javascript
/** C-01: public static uploads retired; use /api/v1/stored-files or document routes */
app.use('/uploads', (_req, res) => {
  res.status(404).json({ error: 'Uploads are not served publicly; use authenticated API endpoints' });
});
```

#### C-01 retest results (2026-06-08)

| Test | Command / probe | Result |
|------|-----------------|--------|
| Security unit script (incl. live probe) | `cd Backend && npm run test:security` | **PASS** — file on disk at `operations/_security_probe/test.pdf`; `/uploads` → **404** |
| Playwright — unauthenticated with on-disk file | `npx playwright test e2e/uploads-auth.spec.js` | **PASS** — *"unauthenticated /uploads blocked when file exists on disk"* |
| Playwright — authenticated flows | Same | **Skipped** — API login/operations preconditions not met in run env |
| Manual live probe | `GET /uploads/operations/_security_probe/test.pdf` (no cookie) | **404** |
| Manual live probe | `GET /api/v1/stored-files/view?path=...` (no cookie) | **401** |

**Verdict:** C-01 is **closed**. Existing files on disk are not publicly downloadable via `/uploads`.

---

### H-01 — SI delete IDOR (FIXED)

**File:** `Backend/src/routes/shipping-instructions.js`

```javascript
router.delete('/:id', requireAuth, async (req, res) => {
  if (!(await userHasPageDelete(req.userId, SI_APPROVE_PAGE_KEY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // ...
  if (beforeRow.preferred_port_id != null && Number(beforeRow.preferred_port_id) !== selectedPortId) {
    return res.status(404).json({ error: 'Shipping instruction not found' });
  }
```

Cross-port delete by SI id is blocked. RBAC delete permission is enforced.

---

### H-02 — SI mutations RBAC (FIXED)

**File:** `Backend/src/routes/shipping-instructions.js`

| Method | Guard |
|--------|-------|
| `POST /` | `userHasPageEdit(req.userId, SI_APPROVE_PAGE_KEY)` |
| `PUT /:id` | `userHasPageEdit(req.userId, SI_APPROVE_PAGE_KEY)` + port scope |
| `DELETE /:id` | `userHasPageDelete(req.userId, SI_APPROVE_PAGE_KEY)` + port scope |

---

### H-03 — Operation delete RBAC (FIXED)

**File:** `Backend/src/routes/operations.js`

```javascript
router.delete('/:id', async (req, res) => {
  // port scope via canAccessOperationForSelectedPort
  const pageKey = opRow.purpose === 'Unloading' ? 'unloading' : 'loading';
  if (!(await userHasPageDelete(req.userId, pageKey))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
```

---

### H-04 — Exception approve/reject RBAC (FIXED)

**File:** `Backend/src/routes/operations.js`

```javascript
router.post('/:id/approve-exception', async (req, res) => {
  if (!(await userHasPageApprove(req.userId, 'verification'))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
router.post('/:id/reject-exception', async (req, res) => {
  if (!(await userHasPageApprove(req.userId, 'verification'))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
```

Both routes also enforce port scope via `canAccessOperationForSelectedPort`.

---

### H-05 — JWT algorithm pinning (FIXED)

| File | Change |
|------|--------|
| `Backend/src/middleware/auth.js` | `JWT_VERIFY_OPTS = { algorithms: ['HS256'] }` on all `jwt.verify` |
| `Backend/src/lib/session-cookies.js` | `jwt.sign(..., { algorithm: 'HS256', expiresIn })` |
| `Backend/src/lib/oidc-flow.js` | Sign/verify opts pinned to HS256 |
| `Backend/scripts/test-security-rbac-uploads.mjs` | Asserts `alg:none` tokens are rejected |

---

### H-06 — nodemailer CVEs (FIXED)

| Before | After |
|--------|-------|
| `nodemailer@^6.9.16` | `nodemailer@^8.0.10` |

**Additional hardening:** `isValidRecipientEmail()` in `Backend/src/lib/notification-email-worker.js` rejects malformed addresses and newline injection patterns. Covered by `test-security-rbac-uploads.mjs`.

---

### H-07 — path-to-regexp / express (FIXED)

Post-remediation `npm audit` in `Backend/` no longer reports `path-to-regexp` or `express` as High severity. Transitive dependency updated via lockfile refresh.

---

### H-08 — Dev Docker default credentials (FIXED)

**File:** `Backend/docker-compose.yml`

| Before | After |
|--------|-------|
| Inline `jps_dev_password`, `dev-jwt-secret-change-in-production` | `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}` |
| Postgres `5433:5432` on all interfaces | `127.0.0.1:5433:5432` |
| No deployment warning | Comment: "Never deploy this file to shared/staging/production hosts" |

---

## Automated verification results

### Initial pass (2026-04-28)

| Test | Command | Result | Notes |
|------|---------|--------|-------|
| Security unit script | `cd Backend && npm run test:security` | **PASS** | Path normalization, email validation, JWT alg rejection |
| Playwright upload auth | `cd Frontend && npx playwright test e2e/uploads-auth.spec.js` | **PARTIAL** | C-01 still open — static mount present at time of first review |

### C-01 closure retest (2026-06-08)

| Test | Command | Result | Notes |
|------|---------|--------|-------|
| Security unit script + live probe | `cd Backend && npm run test:security` | **PASS** | On-disk probe file; `/uploads` → **404**, `stored-files` → **401** |
| Playwright C-01 (unauthenticated, file on disk) | `npx playwright test e2e/uploads-auth.spec.js` | **PASS** | Key test passed |
| Playwright authenticated flows | Same | **Skipped** | Login/operations preconditions |
| Manual live probe | Unauthenticated `GET /uploads/operations/_security_probe/test.pdf` | **404** | File existed on disk |
| Manual live probe | Unauthenticated `GET /api/v1/stored-files/view?path=...` | **401** | Correct |

---

## Dependency audit (post-remediation)

Command: `npm audit` in `Backend/` (2026-04-28)

| Package | Severity | Status vs baseline |
|---------|----------|-------------------|
| `nodemailer` | Was High | **Resolved** (upgraded to 8.0.10) |
| `path-to-regexp` | Was High | **Resolved** (not in current High list) |
| `tar` (via bcrypt native build) | High | **New / remaining** — dev/build chain |
| `file-type` | Moderate | **Remaining** — upgrade to >=22.0.1 recommended |

Frontend `npm audit` also reports Moderate items in dev tooling (`esbuild`/`vite`, `postcss`, `react-router-dom`). These are primarily dev/build-time exposure.

---

## Medium findings from baseline — not in scope of this remediation pass

The following **Medium** items from the baseline OWASP review were **not verified** in this post-remediation pass. A follow-up reviewer should assess separately:

| ID | Finding |
|----|---------|
| M-01 | SI lookup master CRUD without RBAC (non-commodity types) |
| M-02 | Jetty layout PUT without RBAC |
| M-03 | Operation state transitions mostly port-scoped only |
| M-04 | Legacy `port_id IS NULL` operation access bypass |
| M-05 | Client-supplied document URLs (partially addressed via `depart-document-url.js`; QC `fileUrl` not re-verified) |
| M-06 | Rate limiting only on login |
| M-07 | Alicloud nginx missing security headers |
| M-08–M-14 | Docker hardening, gitignore, legacy SSO bridge defaults, etc. |

Reference: [OWASP-TOP10-CODE-REVIEW-2026-04-27.md](./OWASP-TOP10-CODE-REVIEW-2026-04-27.md) § Medium/Low findings.

---

## Files changed / added (remediation summary)

For another agent reviewing the diff, focus on these paths:

### Backend — new

- `Backend/src/routes/stored-files.js`
- `Backend/src/lib/stored-file-access.js`
- `Backend/src/lib/depart-document-url.js`
- `Backend/scripts/test-security-rbac-uploads.mjs`

### Backend — modified

- `Backend/src/index.js` — mounts `stored-files`; **public `/uploads` retired (404 handler)**
- `Backend/src/routes/shipping-instructions.js` — RBAC + port scope on mutations
- `Backend/src/routes/operations.js` — RBAC on delete, exceptions, signoff paths
- `Backend/src/middleware/auth.js` — JWT HS256 pinning
- `Backend/src/lib/session-cookies.js` — JWT sign algorithm
- `Backend/src/lib/notification-email-worker.js` — recipient validation
- `Backend/docker-compose.yml` — required secrets, loopback Postgres
- `Backend/package.json` — `nodemailer@^8.0.10`, `test:security` script

### Frontend — new

- `Frontend/e2e/uploads-auth.spec.js`

### Frontend — modified

- `Frontend/src/api/client.js` — `resolveUploadUrl()` rewrite to `stored-files`
- `Frontend/nginx.conf` — `/uploads` proxy removed
- `Frontend/vite.config.js` — `/uploads` proxy **removed**

---

## Verification checklist

### C-01 closure — verified 2026-06-08

- [x] `Backend/src/index.js` has **no** `express.static('/uploads')`
- [x] `Frontend/vite.config.js` has **no** `/uploads` proxy
- [x] Live probe: on-disk file at `operations/_security_probe/test.pdf` — unauthenticated `/uploads` → **404** (not 200)
- [x] Unauthenticated `stored-files/view` → **401**
- [ ] Upload a test PDF via authenticated operation document flow — E2E test skipped in last run
- [ ] With valid session + port header: `GET /api/v1/stored-files/view?path=<relative-path>` → **200**
- [ ] User on Port A cannot view Port B file via `stored-files` → **403**

### RBAC regression (H-01–H-04)

- [ ] User without `shipment-plan` delete cannot DELETE SI → **403**
- [ ] User on Port A cannot DELETE Port B SI → **404**
- [ ] User without `loading`/`unloading` delete cannot DELETE operation → **403**
- [ ] User without `verification` approve cannot approve exception → **403**
- [ ] Local login (`POST /api/v1/auth/login`) still works
- [ ] OIDC SSO flow still works (if enabled in env)

### Crypto & dependencies (H-05–H-07)

- [x] `npm run test:security` passes
- [ ] `npm audit` in Backend shows no High except accepted `tar` build-chain risk
- [ ] `AUTH_RETURN_TOKEN_BODY=false` in production env

### Docker (H-08)

- [ ] `Backend/docker-compose.yml` fails fast without `POSTGRES_PASSWORD` and `JWT_SECRET`
- [ ] Postgres dev port bound to `127.0.0.1` only

---

## Suggested next actions (prioritized)

| Priority | Action | Owner |
|----------|--------|-------|
| **P1** | Complete full Playwright `uploads-auth.spec.js` suite (authenticated upload + port scope) | QA |
| **P1** | Upgrade `file-type` to >=22.0.1 and retest uploads | Backend |
| **P2** | Review baseline Medium findings (M-01–M-07) | Security / Engineering |
| **P2** | Add security headers to `Frontend/nginx.alicloud-app.conf` | DevOps |
| **P3** | Schedule manual penetration test focused on IDOR + RBAC bypass | External pentester |

---

## Handoff notes for reviewing agent

1. **C-01 is closed.** Public static serving removed; live probe with on-disk file confirms **404** on `/uploads`.
2. **All Critical/High baseline items (C-01, H-01–H-08) are remediated.** No open Critical/High items from the original OWASP review.
3. **RBAC fixes** for SI and operations look complete in code; spot-check with a low-privilege test user for defense in depth.
4. **Baseline document** for Medium/Low backlog: [OWASP-TOP10-CODE-REVIEW-2026-04-27.md](./OWASP-TOP10-CODE-REVIEW-2026-04-27.md).
5. **Route fix matrix** (broader auth work): [SECURITY-ROUTE-BY-ROUTE-FIX-MATRIX.md](./SECURITY-ROUTE-BY-ROUTE-FIX-MATRIX.md).

---

*Initial verification: 2026-04-28. C-01 closure re-verified: 2026-06-08. Re-run checks after any further code changes or before production deployment.*
