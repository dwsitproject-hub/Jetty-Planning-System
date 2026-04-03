# Jetty Planning System — Security Assessment Report

**Document type:** Security architecture review and code-based assessment  
**Scope:** Application source (backend API, frontend SPA), container/nginx configuration, deployment docs  
**Assessment date:** 3 April 2026  

---

## 1. Executive summary

This report describes the **security posture** of the Jetty Planning System (JPS) based on **static analysis** of the repository: Express API (`Backend/`), React SPA (`Frontend/`), Docker/nginx assets, and technical documentation. It does **not** replace a full external penetration test, cloud control-plane review, or runtime dynamic analysis.

### 1.1 System overview

| Layer | Technology |
|--------|------------|
| Client | React 18, Vite 5, React Router 6 |
| API | Node.js, Express 4, `jsonwebtoken`, `bcrypt`, `multer`, `pg` |
| Data | PostgreSQL |
| Distribution | Docker; SPA served via nginx |

Authentication uses **JWT** in the `Authorization: Bearer` header. Many operational routes combine **JWT** with **port scoping** (`user_ports`, `X-Selected-Port-Id`). A separate **RBAC** model (roles, page permissions) exists in the database and is enforced on **some** routes.

### 1.2 Overall conclusion

**Strengths:** Password hashing with **bcrypt**; widespread use of **parameterized SQL**; core **operations** handlers enforce **port alignment**; activity log **read** API uses page-level RBAC; CORS is configurable to explicit origins.

**Material weaknesses:** **Authentication and authorization are inconsistent** across modules. Several **master-data and configuration endpoints** are reachable **without a valid JWT**. **User administration** and **RBAC mutation** APIs appear to require only **any authenticated user**, not a dedicated admin privilege. **QC, uploads, sub-processes, and quantity checks** largely validate operation existence but not **operation ↔ selected port**, creating **cross-port IDOR** risk. Uploaded files are served under **`/uploads`** as **static content without authorization**.

**Risk summary:** Until gaps are closed, a realistic attacker with network access to the API could achieve **unauthorized data modification**, **privilege escalation**, **cross-port data access** (given operation identifiers), and **unauthorized file retrieval** (given or guessed URLs).

---

## 2. Scope and methodology

### 2.1 In scope

- Backend: `Backend/src` (routes, middleware, libraries, upload paths)
- Frontend: `Frontend/src` (token handling, API client)
- Infrastructure-as-code in repo: `docker-compose*.yml`, `Dockerfile`, `Backend/Dockerfile`, `nginx.conf`
- High-level alignment with `Docs/technical-architecture.md` and deployment guides

### 2.2 Out of scope

- Live Alicloud (or other) environments: IAM, security groups, WAF, TLS certificates, secrets stores
- Dynamic Application Security Testing (DAST), fuzzing, or exploit validation
- Social engineering, physical security, third-party vendor audits
- Database contents, production logs, and incident data

### 2.3 Methodology

- Trace request flow: Express mounting order → global middleware → route-level middleware → handlers
- Review authentication (`requireAuth`, `optionalAuth`), port scoping (`requirePortScope`), and RBAC (`requirePageView`, `userHasPage*`)
- Review data access patterns for SQL injection and IDOR
- Review file upload and static file serving
- Review frontend token storage and API headers

**No remediation was applied** as part of this assessment; findings are descriptive only.

---

## 3. Architecture (security-relevant)

```
Browser (SPA)
    → HTTPS → API (Express)
        → JWT verification (selected routes)
        → Port scope resolution (selected routes)
        → PostgreSQL
        → Local/S3-equivalent upload root exposed as /uploads (static)
```

**Port scope:** `requirePortScope` (`Backend/src/middleware/port-scope.js`) loads the user’s assigned ports from `user_ports`, auto-selects when a single port is assigned, otherwise requires `X-Selected-Port-Id` / `X-Port-Id` / `port_id` query to match an assigned port.

**RBAC:** Permissions are stored in PostgreSQL; `requirePageView(resourceKey)` enforces **page** `can_view` for routes that use it (`Backend/src/middleware/permissions.js`).

---

## 4. Findings

Findings are ranked by **severity** (Critical, High, Medium, Low). IDs are stable for tracking.

### 4.1 Critical

| ID | Title | Description | Affected components |
|----|--------|-------------|---------------------|
| **C-1** | Unauthenticated access to master data and configuration | Routes under `/api/v1/ports`, `/jetties`, `/sla-config`, `/standard-rates`, and much of `/si-lookups` are mounted **without** `requireAuth` in `Backend/src/index.js`. Anonymous callers can read and, for many endpoints, **create, update, or delete** ports, jetties, SLA configuration, standard rates, and SI lookup masters (non-commodity paths on SI lookups do not require `req.userId` for mutations). | `index.js`, `ports.js`, `jetties.js`, `sla-config.js`, `standard-rates.js`, `si-lookups.js` |
| **C-2** | User administration without role-based authorization | `Backend/src/routes/users.js` uses `requireAuth` only. Any authenticated principal can list users, create users, reset passwords, assign ports, and soft-delete other users (subject to “cannot delete self”). There is no `requirePageView` or equivalent admin guard on these handlers. | `users.js` |
| **C-3** | RBAC mutation without administrative authorization | `Backend/src/routes/rbac.js` applies `requireAuth` to the router but mutating endpoints (role permissions, user–role assignments, etc.) do not, in the reviewed code, enforce a **system admin** or high-privilege permission. A standard authenticated user may be able to alter roles and permissions via direct API calls. | `rbac.js` |
| **C-4** | Cross-port IDOR on operation-scoped resources | Core `operations` routes use `canAccessOperationForSelectedPort` (`operations.js`). Other modules validate **operation id exists** but do not consistently enforce that the operation’s **port** matches `req.selectedPortId`. A user restricted to Port A who obtains an operation id for Port B may access or modify QC surveys, quantity checks, operation documents, and sub-process data across ports. | `qc-surveys.js`, `quantity-checks.js`, `operation-documents.js`, `operation-sub-processes.js` (with `requirePortScope` on parent mount but insufficient object-level check) |
| **C-5** | Uploads served without authorization | `app.use('/uploads', express.static(UPLOAD_ROOT))` serves files without JWT checks. API responses expose `/uploads/...` URLs. Possession of the URL implies read access regardless of session. | `index.js`, `operation-documents.js`, sub-process document handlers |

### 4.2 High

| ID | Title | Description |
|----|--------|-------------|
| **H-1** | JWT stored in `localStorage` | `Frontend/src/api/auth.js` persists `jps_token` in `localStorage`. Any XSS in the application or a dependency can steal tokens. |
| **H-2** | Broad unauthenticated read of master/reference data | `GET /api/v1/si-lookups` (aggregate) returns extensive master lists including jetties and port linkage without authentication, aiding reconnaissance and business confidentiality loss. |
| **H-3** | Missing security headers on SPA | `nginx.conf` does not set CSP, `X-Content-Type-Options`, `Referrer-Policy`, or frame controls. CSP is a key defense-in-depth control against XSS impact. |
| **H-4** | No application-level login throttling | `POST /auth/login` has no rate limit or lockout in code; enables credential stuffing / brute-force attempts at scale if not offset by edge controls. |
| **H-5** | Long-lived JWTs; minimal claims | Default expiry **7d** (`JWT_EXPIRES_IN`); payload carries `userId` only. No rotation, `jti`, or server-side revocation observed. |
| **H-6** | Upload content trust | Multer limits size and sanitizes names; stored `mime_type` reflects client input. No magic-byte or strict type allowlist for malware / abuse scenarios. |

### 4.3 Medium

| ID | Title | Description |
|----|--------|-------------|
| **M-1** | Weak password policy for local users | Minimum password length **6** characters on create/update (`users.js`). |
| **M-2** | `optionalAuth` when `JWT_SECRET` missing | If `JWT_SECRET` were unset, `optionalAuth` skips verification silently (`auth.js`); misconfiguration could mask auth failures for optional paths. |
| **M-3** | Trust proxy | Express `trust proxy` is not set; IP-based features or logging behind load balancers may be inaccurate. |
| **M-4** | Error logging | Global handler returns generic 500 to clients but logs full errors server-side; production log access and redaction policies should be explicit. |

### 4.4 Low / informational

| ID | Title | Description |
|----|--------|-------------|
| **L-1** | Dependency and header hardening | No `helmet` or express rate-limit in application code; may be acceptable if fully implemented at gateway/WAF. |
| **L-2** | Public health endpoints | `/health` and `/api/v1/health` expose liveness; low risk; useful for monitoring. |
| **L-3** | Documentation vs runtime | Production compose samples emphasize not exposing PostgreSQL; verify all environments match documentation. |

---

## 5. Positive controls

The following controls reduce risk and should be preserved or extended:

- **Bcrypt** for password verification; login returns a generic message for invalid credentials (user enumeration partially mitigated).
- **Parameterized queries** in reviewed code paths; SI lookup table names constrained by server-side maps.
- **`requirePortScope`** provides a clear multi-tenant port model when applied end-to-end.
- **`canAccessOperationForSelectedPort`** in the operations module aligns access with selected port (including legacy null-port behavior).
- **Activity log read** API gated with `requirePageView('activity-log')`.

---

## 6. Recommendations (planning only)

The following themes are recommended for a future remediation phase (not executed in this assessment):

1. **Authenticate** all non-public API surfaces; treat master data, SLA config, rates, and SI master CRUD as **privileged**.
2. **Authorize** `/users` and `/rbac` mutations behind a **system administrator** (or equivalent) permission, distinct from normal page RBAC.
3. **Centralize** operation-level authorization: reuse port alignment checks in every handler that takes `operationId`.
4. **Serve sensitive uploads** via authenticated routes or **short-lived signed URLs**; avoid anonymous static mapping for confidential documents.
5. **Move tokens** to HttpOnly cookies (with CSRF protection) or adopt a BFF; add **CSP** and other security headers at nginx or edge.
6. **Rate-limit** authentication and enforce **account lockout** or progressive delay (app or WAF).
7. **Secrets:** strong `JWT_SECRET`, no production defaults; rotate keys with a documented process.
8. **SDLC:** dependency scanning, container scanning, and periodic **external penetration testing** after major changes.

---

## 7. Limitations and disclaimer

This assessment is based on **repository analysis at a point in time**. It does not confirm exploitability in production, certify compliance with any standard (PCI, ISO 27001, etc.), or review cloud account configuration. **Residual risk** remains until controls are implemented, tested, and operated.

---

## 8. Document control

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-04-03 | Initial security assessment report |

**Classification:** Internal — security-related; restrict distribution according to organizational policy.
