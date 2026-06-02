# Jetty Planning System — Security Re-Assessment Report

**Document type:** Follow-up security reassessment (non-intrusive)  
**Assessment date/time:** 2026-04-23 15:26 +07:00  
**Scope:** Backend API, frontend auth/session client, nginx config, safe endpoint checks on local environment  
**Method:** Static code review + low-impact runtime verification (no destructive payloads, no load/fuzz tests)

---

## 1. Executive Summary

Substantial hardening has been implemented since the previous assessment:

- Browser session migrated from `localStorage` bearer token to HttpOnly cookie + CSRF token flow.
- Login endpoint now has application-level rate limiting.
- `si-lookups` aggregate is now authenticated.
- Upload pipeline validates file content type using magic bytes.
- Security headers/CSP are present in production nginx config.

However, **critical go-live blockers remain open**:

1. **Auth consistency gap** for several master/config endpoints (`ports`, `jetties`, `sla-config`, `standard-rates`) still allows anonymous access.
2. **Authorization gap** for `/users` and `/rbac` admin surfaces (authenticated user can perform admin actions).
3. **Object-level authorization (IDOR) gap** for operation-scoped modules outside `operations.js` (QC, quantity, operation documents, sub-processes, operational activities).
4. **Upload retrieval authorization gap** remains because `/uploads` is served as public static files.

**Go-live recommendation:** Do **not** treat this as security-closed yet. Prioritize closure of Critical findings before production release.

---

## 2. Non-Intrusive Validation Performed

### 2.1 Static code review

- Reviewed backend route mounts and middleware in `Backend/src/index.js`.
- Reviewed authentication/session middleware and CSRF enforcement:
  - `Backend/src/middleware/auth.js`
  - `Backend/src/middleware/csrf.js`
  - `Backend/src/routes/auth.js`
  - `Backend/src/lib/session-cookies.js`
- Reviewed sensitive route files (`users`, `rbac`, `ports`, `jetties`, `sla-config`, `standard-rates`, `qc-surveys`, `quantity-checks`, `operation-documents`, `operation-sub-processes`, `operation-operational-activities`).
- Reviewed frontend auth client:
  - `Frontend/src/api/auth.js`
  - `Frontend/src/api/client.js`
- Reviewed frontend nginx headers config:
  - `Frontend/nginx.conf`
  - `Frontend/nginx.alicloud-app.conf`

### 2.2 Safe runtime checks (localhost)

- Anonymous GET status checks:
  - `GET /api/v1/ports` -> `200`
  - `GET /api/v1/jetties` -> `200`
  - `GET /api/v1/sla-config` -> `200`
  - `GET /api/v1/standard-rates` -> `200`
  - `GET /api/v1/si-lookups` -> `401`
  - `GET /api/v1/users` -> `401`
  - `GET /api/v1/rbac/roles` -> `401`
  - `GET /api/v1/operations/1/qc-surveys` -> `401` (due parent auth middleware)
- Anonymous invalid-body write checks (to avoid data mutation):  
  - `POST /api/v1/ports {}` -> `400` (validation reached before auth challenge)
  - `POST /api/v1/jetties {}` -> `400`
  - `POST /api/v1/standard-rates {}` -> `400`
- Public uploads path behavior:
  - `GET /uploads/nonexistent-file.bin` -> `404` (public route path active; no auth challenge)
- Existing auth/CSRF smoke e2e:
  - `npm run test:e2e` -> **1 passed** (login cookie + CSRF logout flow)

---

## 3. Finding Status (Previous IDs)

### 3.1 Critical Findings

| ID | Previous finding | Reassessment status | Evidence |
|---|---|---|---|
| C-1 | Unauthenticated master/config access | **Open** | `apiV1.use('/ports', portsRoutes)` etc. are still mounted without `requireAuth` in `Backend/src/index.js`; route files use `optionalAuth`/none (`Backend/src/routes/ports.js`, `jetties.js`, `standard-rates.js`, `sla-config.js`). Runtime checks show anonymous `200` on these endpoints. |
| C-2 | User admin without role authorization | **Open** | `Backend/src/routes/users.js` uses `requireAuth` only; no admin permission guard (`requirePageView('admin')` or equivalent). |
| C-3 | RBAC mutation without administrative authorization | **Open** | `Backend/src/routes/rbac.js` uses router-level `requireAuth` only; mutation endpoints have no separate admin/system-role authorization guard. |
| C-4 | Cross-port IDOR on operation-scoped modules | **Open** | `operations.js` has `canAccessOperationForSelectedPort` checks, but `qc-surveys.js`, `quantity-checks.js`, `operation-documents.js`, `operation-sub-processes.js`, `operation-operational-activities.js` only verify operation existence, not operation-port ownership. |
| C-5 | Uploads served without authorization | **Open** | `app.use('/uploads', express.static(UPLOAD_ROOT))` in `Backend/src/index.js`; routes return `/uploads/...` URLs. Runtime check confirms public route behavior (404 without auth, not 401). |

### 3.2 High Findings

| ID | Previous finding | Reassessment status | Evidence |
|---|---|---|---|
| H-1 | JWT in `localStorage` | **Closed (implementation)** | Frontend now uses cookies (`credentials: 'include'`), clears legacy token (`Frontend/src/api/auth.js`), and adds CSRF header from cookie (`Frontend/src/api/client.js`). Backend sets/uses session cookies (`routes/auth.js`, `lib/session-cookies.js`, `middleware/auth.js`). |
| H-2 | Unauthenticated `GET /si-lookups` aggregate | **Closed** | `apiV1.use('/si-lookups', requireAuth, siLookupsRoutes)` in `Backend/src/index.js`; runtime check returns `401` anonymously. |
| H-3 | Missing security headers | **Partially closed** | Security headers + CSP present in `Frontend/nginx.conf`; but `Frontend/nginx.alicloud-app.conf` does not include equivalent header block. Production deployment path must be confirmed. |
| H-4 | No login throttling | **Partially closed** | `express-rate-limit` added on `POST /auth/login` in `Backend/src/routes/auth.js`; `trust proxy` configurable in `Backend/src/index.js`. Real LB/NAT behavior still requires staging/prod validation. |
| H-5 | Long-lived JWT / minimal lifecycle controls | **Partially closed** | Default reduced to `8h` (`routes/auth.js`, `lib/session-cookies.js`) but no refresh rotation and no server-side revoke/jti blocklist. |
| H-6 | Upload content trust | **Closed (current upload routes)** | Magic-byte validation (`Backend/src/lib/upload-mime.js`) wired in `operation-documents.js` and `operation-sub-processes.js`. |

### 3.3 Medium Findings

| ID | Previous finding | Reassessment status | Evidence |
|---|---|---|---|
| M-1 | Weak password policy (min 6) | **Open** | `users.js` still accepts min length 6 on create/update. |
| M-2 | `optionalAuth` silent when JWT secret missing | **Open** | `optionalAuth` returns next() when `JWT_SECRET` missing in `middleware/auth.js`. |
| M-3 | Trust proxy not set | **Partially closed** | `app.set('trust proxy', ...)` present in `index.js`; accuracy still environment-dependent and requires LB validation. |
| M-4 | Error logging may leak details | **Open** | Global error handler still logs raw error object (`console.error('Unhandled error:', err)`) in `index.js`; no explicit scrubbing/correlation-id layer observed. |

---

## 4. New/Changed Risk Observations Since Last Assessment

1. **Hub SSO entrypoint introduced** (`/auth/hub` in `Backend/src/routes/hub-sso.js`):
   - Uses signed token validation (`SSO_TOKEN_SECRET`) and sets local session cookies.
   - Supports optional JIT provisioning; can auto-assign first/all ports based on env.
   - This was not part of the original assessment and should be included in production threat modeling and hardening review (token TTL, origin flow expectations, provisioning constraints, audit).

2. **Middleware order side effect**:
   - The route `apiV1.use('/', requireAuth, requirePortScope, ...)` means some later `'/'` mounts may be indirectly protected; avoid relying on incidental order for security controls.
   - Security-critical routes should have explicit, local authorization intent (self-documenting and testable).

---

## 5. Go-Live Blockers and Priority Actions

### P0 — Must close before go-live

1. **Close C-1**: enforce auth/authorization for master/config endpoints:
   - `/ports`, `/jetties`, `/sla-config`, `/standard-rates`
2. **Close C-2/C-3**: enforce admin-level authorization for:
   - `/users` mutation/admin reads
   - `/rbac` mutation/admin reads
3. **Close C-4**: apply operation-port ownership checks to all operation-scoped modules:
   - QC, quantity, operation documents, sub-processes, operational activities
4. **Close C-5**: replace public `/uploads` pattern with authenticated/signed download flow.

### P1 — Strongly recommended before go-live freeze

1. **H-3**: align security headers/CSP across the actual production nginx config used in Alicloud.
2. **H-4/M-3**: validate rate-limit behavior behind real LB/NAT; tune thresholds.
3. **H-5**: decide and document token lifecycle strategy (short TTL only vs refresh/revoke model).

### P2 — Hardening backlog

1. **M-1** stronger password policy.
2. **M-2** fail-fast behavior for missing JWT secret in protected deployments.
3. **M-4** structured and redacted error logging.

---

## 6. Suggested Re-Verification Plan (Post-Fix)

After applying P0 fixes, run a follow-up mini-assessment with:

- Anonymous access matrix for all sensitive endpoints (expect 401/403).
- Non-admin user attempting `/users` and `/rbac` admin actions (expect 403).
- Cross-port operation-ID access attempts on every operation-scoped route (expect 403/404).
- Upload retrieval authorization checks using direct `/uploads/...` links.
- Existing `npm run test:e2e` auth/csrf flow + manual staging checks under production-like domains.

---

## 7. Conclusion

Security posture has improved materially on session handling and upload validation, but **critical authorization gaps remain open**. The current state is **not yet ready for security sign-off for production go-live** until P0 items are closed and re-verified.

