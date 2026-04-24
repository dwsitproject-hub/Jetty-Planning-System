# Security Route-by-Route Fix Matrix

**Related docs:**
- `Docs/Security/SECURITY-ASSESSMENT-REPORT.md`
- `Docs/Security/SECURITY-REASSESSMENT-REPORT-2026-04-23.md`
- `Docs/Security/SECURITY-HIGH-FINDINGS-DETAILED-PLAN.md`

**Purpose:** Practical implementation matrix to close open security findings (especially `C-1`..`C-5`) with clear route ownership, target controls, and verification outcomes.

---

## 1) Guard model (recommended baseline)

Use consistent guard layers for every API route:

1. **Authentication guard**
   - `requireAuth` (cookie or bearer)
2. **Role/permission guard**
   - For admin surfaces: `requirePageView('admin')` or equivalent stricter middleware
   - For page-scoped actions: `userHasPageEdit/Delete/Approve(...)` when needed
3. **Object-level guard**
   - For operation resources: verify `operation.port_id` (or resolved port) matches `req.selectedPortId`
4. **CSRF guard**
   - Already globally applied for unsafe methods under `/api/v1` (except login)

---

## 2) Priority mapping

| Priority | Finding IDs | Focus |
|---|---|---|
| **P0 (must-fix)** | C-1, C-2, C-3, C-4, C-5 | Auth consistency, admin authz, object authz, file retrieval authz |
| **P1 (recommended pre-go-live)** | H-3, H-4, H-5 | Production CSP/header fit, LB-aware rate limit tuning, token lifecycle |
| **P2 (hardening)** | M-1, M-2, M-4 | Password policy, startup fail-fast, redacted structured errors |

---

## 3) Route-by-route matrix

## 3.1 Authentication routes

| Route(s) | Current | Required change | Target response behavior |
|---|---|---|---|
| `POST /api/v1/auth/login` | Auth endpoint + rate limit in place | Keep current; tune `AUTH_LOGIN_MAX_ATTEMPTS` + validate LB `TRUST_PROXY` | Success `200`, brute-force `429` |
| `POST /api/v1/auth/logout` | Implemented, CSRF-protected for cookie sessions | Keep current | Valid session+CSRF -> `204`; missing CSRF for cookie flow -> `403` |
| `POST /auth/hub` | SSO cookie issuance + optional JIT provisioning | Add explicit ops controls (allowlist source, monitoring, provisioning policy); ensure token TTL/claims policy documented | Invalid token `401`; config errors `5xx`; success `302` |

---

## 3.2 Admin / identity surfaces (C-2, C-3)

| Route group | Current | Gap | Required change | Verify |
|---|---|---|---|---|
| `/api/v1/users/*` | `requireAuth` only | Any authenticated user can perform admin user ops | Add admin-level guard middleware to all non-self admin endpoints (`GET /users`, `POST`, `PUT/:id`, `PUT/:id/ports`, `DELETE/:id`, `GET /:id`, `GET /:id/ports`) | Non-admin token => `403`; admin => expected success |
| `/api/v1/rbac/*` | `requireAuth` only | Any authenticated user can mutate roles/permissions/user-role assignments | Add admin-level guard middleware to all admin/rbac routes except `/rbac/me/page-permissions` | Non-admin => `403`; admin => CRUD works |
| `/api/v1/users/me`, `/api/v1/users/me/ports` | `requireAuth` | No critical issue | Keep user-self accessible | Authenticated self => `200`; anonymous => `401` |

**Implementation tip:** define one shared middleware, e.g. `requireAdminPageView`, then compose:
- `router.use('/rbac', requireAuth, requireAdminPageView, rbacRoutes)` (or inside file except `me` route)
- apply route-level exceptions explicitly for self endpoints.

---

## 3.3 Master/config surfaces (C-1)

| Route group | Current runtime | Gap | Required change | Verify (anonymous) |
|---|---|---|---|---|
| `/api/v1/ports` | `200` for `GET` | Publicly readable; mutating routes not auth-gated | At minimum `requireAuth`; ideally admin guard for create/update/delete | `GET`/`POST` -> `401/403` |
| `/api/v1/jetties` | `200` for `GET` | Same as above | At minimum `requireAuth`; admin guard for write/status/delete | `GET`/`POST` -> `401/403` |
| `/api/v1/sla-config` | `200` for `GET` | Sensitive configuration publicly readable | Require auth; admin guard for `PUT` | `GET`/`PUT` -> `401/403` |
| `/api/v1/standard-rates` | `200` for `GET` | Publicly readable and writable path risk | Require auth; admin/page-edit guard for writes | `GET`/`POST` -> `401/403` |
| `/api/v1/master/cargo-handling-methods` | `401` anonymous | Protected by route order indirectly | Make protection explicit in route/mount (avoid incidental protection) | Anonymous `401` (stable) |
| `/api/v1/si-lookups` | `401` anonymous | Mostly fixed | Keep `requireAuth`; keep regression tests | Anonymous `401` |

**Recommended policy split:**
- Read-only master endpoints: authenticated users with relevant page view.
- Mutating master endpoints: admin or explicit page edit permission.

---

## 3.4 Operation-scoped modules (C-4 IDOR closure)

Apply **object-level access check** to every route that accepts `operationId` or mutates entities tied to an operation.

| Module / route group | Current | Gap | Required change |
|---|---|---|---|
| `/api/v1/operations/*` (`operations.js`) | Has `canAccessOperationForSelectedPort` checks | Mostly good | Keep as reference pattern |
| `/api/v1/operations/:id/qc-surveys` + `/api/v1/qc-surveys/:id` | Checks operation existence only | Cross-port IDOR risk | Add operation-port verification before list/create/update/delete |
| `/api/v1/operations/:id/quantity-checks` + `/api/v1/quantity-checks/:id` | Same | Cross-port IDOR risk | Add operation-port verification |
| `/api/v1/operation-documents/*` | Existence checks only | Cross-port IDOR risk | Validate operation ownership for list/upload/delete |
| `/api/v1/operations/:id/sub-processes*` | Existence checks only | Cross-port IDOR risk | Validate operation ownership for all sub-process + docs + nor-details endpoints |
| `/api/v1/operations/:id/operational-activities*` | Existence checks only | Cross-port IDOR risk | Validate operation ownership for list/create/update/delete/timeline |

### Recommended shared helper

Create one helper for reuse across modules:
- `assertOperationInSelectedPort(operationId, selectedPortId)`  
  - Load operation + resolved port
  - Throw `404` or `403` on mismatch (decide and keep consistent)

Then call it in every operation-scoped handler early.

### Verify for each module

1. Login as user assigned only to Port A.
2. Use known `operationId` from Port B.
3. Attempt `GET/POST/PUT/DELETE`.
4. Expect `403` (or `404` by policy), never data disclosure/mutation.

---

## 3.5 Upload retrieval authorization (C-5)

| Surface | Current | Gap | Required change | Verify |
|---|---|---|---|---|
| `GET /uploads/*` | Public static serving | Anyone with URL can fetch files | Replace with authenticated download endpoint or signed URL strategy | Anonymous access should return `401/403` |
| Document response payloads include `url: /uploads/...` | Direct unauthenticated links | Bypasses object authz | Return protected download endpoint path (or time-limited signed URL) | Cross-port and anonymous retrieval blocked |

### Suggested approach (safe incremental)

1. Add API download endpoints:
   - `/api/v1/operation-documents/:id/download`
   - `/api/v1/sub-process-documents/:id/download`
2. For each download request:
   - authenticate
   - resolve linked operation
   - enforce selected-port ownership
3. Update frontend to use new URLs.
4. Remove or lock down static `/uploads` route for sensitive docs.

---

## 3.6 CSRF/session consistency checks

| Check | Expected |
|---|---|
| Cookie session unsafe request without `X-XSRF-TOKEN` | `403` |
| Cookie session unsafe request with correct token | success/normal business response |
| Bearer-based integration call (no CSRF header) | still works by design |
| Login sets `jps_at` + `jps_xsrf` cookies | yes |
| Logout clears both cookies | yes (`204`) |

---

## 3.7 Security headers/CSP (H-3)

| Config file | Current | Action |
|---|---|---|
| `Frontend/nginx.conf` | Has CSP + core headers | Validate with production hostnames / APIs / CDN assets |
| `Frontend/nginx.alicloud-app.conf` | Reverse proxy config; no equivalent header block | Add same header baseline (or enforce at upstream gateway) |

**Verification:** run staging with production-like domain and test full app flows; inspect browser CSP violations.

---

## 4) Test matrix for closure sign-off

## 4.1 Anonymous access matrix

For each sensitive endpoint group, verify:
- `GET` anonymous -> `401/403` unless intentionally public
- unsafe methods anonymous -> `401/403`

## 4.2 Authenticated non-admin matrix

For `/users` and `/rbac` admin routes:
- non-admin token must receive `403`.

## 4.3 Cross-port object authorization matrix

For each operation-scoped module:
- Port A user + Port B operation ID => deny (`403/404`) for all CRUD.

## 4.4 File retrieval matrix

- Anonymous file URL -> deny.
- Authenticated wrong-port user -> deny.
- Correct-port authorized user -> success.

## 4.5 Regression matrix

- Existing business flows still pass after guards:
  - login/logout
  - SI list/edit/approval
  - allocation / at-berth
  - uploads and previews/downloads
  - admin pages for authorized users

---

## 5) Suggested implementation order

1. **P0.1** Add admin guards to `/users` + `/rbac`.
2. **P0.2** Add auth guards to `ports/jetties/sla-config/standard-rates`.
3. **P0.3** Add shared operation ownership check; apply across QC/quantity/docs/sub-process/operational activities.
4. **P0.4** Replace public `/uploads` serving for sensitive docs with authorized download path.
5. **P1** Align CSP/header policy across deployed nginx path and validate in staging.

---

## 6) Definition of done (security closure)

All below must be true:

- `C-1..C-5` all marked **Closed** with test evidence.
- Automated/semiautomated negative tests for unauthorized and cross-port access pass.
- No direct unauthenticated document retrieval path remains for sensitive uploads.
- Staging validation completed with production-like domain/CORS/cookie behavior.
- Security reassessment report updated to reflect closure and residual risk.

