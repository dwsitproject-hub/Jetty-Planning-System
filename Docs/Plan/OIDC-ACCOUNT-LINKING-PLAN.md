# OIDC account linking — plan (admin + self-service)

**Status:** Draft — for review before implementation.  
**Last updated:** 2026-04-27  

## 0) Sequencing: troubleshooting first

Current SSO rollout should **finish stabilization and troubleshooting** (Docker/env, IdP discovery, callback, cookies, `invalid_grant`, `email_collision_local_account`, etc.) before building the features in this document.

- **Now:** Use manual DB update or IdP admin to link `users.oidc_sub` where needed; see `Docs/Troubleshoot/REBUILD-RESTART-CONTAINERS.md` and `Docs/Security/SSO-INTEGRATION-GUIDE.md`.
- **After:** Implement phases below in order.

---

## 1) Purpose

Enable **intentional coexistence** of local username/password and OIDC SSO for the **same Jetty user**, without guessing `sub` in SQL.

Two complementary flows:

| Flow | Actor | Outcome |
|------|--------|---------|
| **Admin — link user to SSO** | Privileged admin | Binds a chosen Jetty user to the IdP `sub` derived from a validated `id_token`, with audit trail. |
| **Self-service — Connect SSO** | End user (already authenticated locally) | Same binding, initiated from Settings after password/session proof. |

Authoritative identity for OIDC remains **`id_token.sub`** (stored as `users.oidc_sub`). Jetty `users.id` must never be used as `oidc_sub`.

---

## 2) Goals

- **G1:** Admins can link an existing user (including `auth_source = 'local'`) to SSO using **only** values from a validated OIDC token.
- **G2:** Logged-in local users can run **Connect SSO** once and have `oidc_sub` set if rules pass.
- **G3:** Preserve current safety rules: no silent takeover; unique `oidc_sub` across users (`idx_users_oidc_sub_unique`).
- **G4:** Clear UX for collision (`email_collision_local_account`) — explain next step instead of dead-end HTML only.

### 2.1 Non-goals (initial release)

- End users typing `oidc_sub` manually in a form.
- Bulk CSV import of `sub` (can be a later phase).
- Changing Hub/IdP product code (Jetty-only plan).

---

## 3) Current behavior (baseline)

Relevant logic lives in `Backend/src/routes/oidc-sso.js`:

- Lookup by `users.oidc_sub` first.
- If none and `email` matches a **local** row → **409** `email_collision_local_account` (no session created).
- JIT creates **new** SSO-only users when enabled; it does not merge into local.

Migration `057_users_auth_source_oidc_sub.sql` adds `auth_source` (`local` | `sso`) and unique partial index on `oidc_sub`.

**Product intent:** Keep `auth_source = 'local'` when the user should still use password login; set `oidc_sub` so SSO login resolves the same row.

---

## 4) Feature A — Admin-only “Link user to SSO”

### 4.1 UX and security constraint

An admin must **not** paste a guessed `sub`, and must **not** complete OIDC as themselves to attach **another** person’s identity to a Jetty user.

**Safe in-app pattern for “link employee X”:**

1. Admin selects target Jetty user (email visible, `oidc_sub` empty).
2. Admin clicks **“Generate SSO link”** — backend creates a **short-lived signed URL** (or token) that starts OIDC with `mode=admin_prelink` and encodes `targetUserId` + admin id in signed state (§6).
3. **Employee** opens that URL on their machine (or admin hands them a kiosk session), completes Hub login. Callback applies `id_token.sub` to `targetUserId` **only if** `lower(id_token.email) = lower(target.email)` and uniqueness checks pass.

**Same person (admin linking own Jetty user):** reuse **Connect SSO** (§5) or the same prelink flow with target = self.

**MVP without email delivery:** show **copyable link** + short TTL + instruction: *“Send to the user; they must open it while signed into Hub as themselves.”*

Optional later: email the link from Jetty or from Hub.

### 4.2 Authorization

- New permission e.g. `users:sso_link` or reuse existing user admin permission.
- Audit: `logAuthEvent('admin.oidc_link.success', { adminUserId, targetUserId, subHash })` — avoid logging full `sub` if policy requires minimization; at minimum log target user id + admin id.

### 4.3 Rules (server)

- Target user exists, `deleted_at IS NULL`, `is_active`.
- `id_token` validates (`iss`, `aud`, `exp`, `sub`).
- `lower(id_token.email) = lower(target.email)` (mandatory if using pre-selected user id).
- `oidc_sub` not already used by another row.
- Optional: `auth_source` remains `local` unless product wants `sso` after link.

---

## 5) Feature B — Self-service “Connect SSO”

### 5.1 UX

1. User logs in with **local** password (existing flow).
2. **Settings / Security** → **Connect corporate SSO** button.
3. Same `/auth/oidc/start` with **linking intent** in signed state (no admin).
4. Callback: if valid `id_token` and session user is logged in:
   - Match `id_token.email` to session user’s email (normalized).
   - Set `users.oidc_sub = claims.sub` where `id = session user`.
5. Success message: “SSO connected. You can sign in with SSO or password.”

### 5.2 Rules

- Require authenticated session (cookie) at start; bind `link_user_id` into signed OIDC state so callback cannot attach `sub` to wrong account.
- Same uniqueness and email checks as admin flow.
- If already linked: idempotent success or “already connected”.

### 5.3 Logout / CSRF

- Reuse existing CSRF patterns for any POST under `/api/v1`.
- GET start + GET callback remain outside `/api/v1` CSRF if today’s pattern is kept; signing state JWT is mandatory.

---

## 6) Callback modes (technical)

Single callback URL `OIDC_REDIRECT_URI` (IdP allowlist constraint). Encode mode in **signed state JWT** payload:

| Field | Example |
|--------|---------|
| `type` | `oidc_state` (existing) |
| `mode` | `login` \| `connect_sso` \| `admin_prelink` |
| `verifier` | PKCE verifier |
| `targetUserId` | UUID — only for `admin_prelink` + permission check |
| `adminActorId` | optional, for audit |

**Login (default):** current behavior.  
**connect_sso:** after token validation, update `oidc_sub` for session user (must match state).  
**admin_prelink:** after token validation, admin session must match; update target user if email matches `id_token.email`.

---

## 7) API surface (draft)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/auth/oidc/start` | Query: `?intent=login|connect|admin&userId=…` (validate + sign state) |
| `GET` | `/auth/oidc/callback` | Unchanged path; branch on state `mode` |

Optional JSON APIs for SPA:

| `GET` | `/api/v1/users/me/sso-status` | `{ linked: boolean, oidcSubLast4?: … }` |
| `POST` | `/api/v1/users/me/sso-connect/start` | Returns 302 URL or `{ url }` for SPA to navigate |

(Exact shape to align with existing `users` routes and `requireAuth`.)

### 7.1 Proposed API contract (v1 with bulk)

#### Self-service

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/users/me/sso-status` | User | Read linking status shown in Settings card. |
| `POST` | `/api/v1/users/me/sso-connect/start` | User | Create signed OIDC start URL with `mode=connect_sso`. |
| `POST` | `/api/v1/users/me/sso-unlink` | User (optional policy) | Unlink own SSO identity when policy allows. |

`GET /users/me/sso-status` response (suggested):

```json
{
  "linked": true,
  "authSource": "local",
  "linkedAt": "2026-04-28T06:30:00.000Z",
  "linkedByMode": "self_service",
  "subjectFingerprint": "…11d5d8"
}
```

#### Admin single-user

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/admin/users/:id/sso-status` | Admin (`users:sso_link`) | Status card data in Admin Users detail. |
| `POST` | `/api/v1/admin/users/:id/sso-link/start` | Admin | Generate one-time link for target user completion (`mode=admin_prelink`). |
| `POST` | `/api/v1/admin/users/:id/sso-unlink` | Admin | Policy-gated unlink with audit reason. |
| `GET` | `/api/v1/admin/users/:id/sso-events` | Admin | Timeline for link/unlink attempts and outcomes. |

#### Bulk linking

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/v1/admin/sso-link/bulk/dry-run` | Admin (`users:sso_link_bulk`) | Validate rows and return match outcomes; no writes. |
| `POST` | `/api/v1/admin/sso-link/bulk/jobs` | Admin (`users:sso_link_bulk`) | Create execution job from approved dry-run rows. |
| `GET` | `/api/v1/admin/sso-link/bulk/jobs/:jobId` | Admin | Job summary, progress, counters. |
| `GET` | `/api/v1/admin/sso-link/bulk/jobs/:jobId/items` | Admin | Row-level result list with status/reason. |
| `POST` | `/api/v1/admin/sso-link/bulk/jobs/:jobId/retry` | Admin | Retry only `failed_retryable` rows. |
| `GET` | `/api/v1/admin/sso-link/bulk/jobs/:jobId/export.csv` | Admin | Download audit/report CSV. |

---

## 8) Frontend (draft)

### 8.1 Self-service UX (Settings)

Location: **Settings -> Sign-in methods**

Card content:

- Status chip: `Not linked` / `Linked` / `Needs attention`
- Primary action: `Connect SSO`
- Secondary action (optional policy): `Unlink SSO`
- Metadata block:
  - Linked at (`linkedAt`)
  - Linked by (`Self-service` / `Admin invite`)
  - Subject fingerprint (masked, e.g. `…11d5d8`)

Flow:

1. User clicks `Connect SSO`.
2. SPA calls `POST /users/me/sso-connect/start`.
3. Browser navigates to returned URL.
4. Callback finishes in `mode=connect_sso`.
5. User is redirected back to Settings with explicit result banner.

Result copy:

- Success: `SSO linked. You can sign in with password or SSO.`
- Already linked: `This account is already linked to SSO.`
- Email mismatch: `Hub account email does not match your Jetty account. Contact support.`
- Collision: `This Hub identity is already linked to another Jetty user.`

### 8.2 Admin single-user UX (Admin -> Users -> Detail)

SSO Link card:

- Current status (`Linked` / `Not linked`)
- Last event (time + actor + mode)
- Actions:
  - `Generate user link` (one-time prelink URL)
  - `Copy link`
  - `Unlink` (policy-gated + reason required)
  - `View history`

`Generate user link` modal:

- Shows target user identity (username/email)
- TTL selector (default 15m)
- Copyable URL + expiration timestamp
- Warning text:
  - `Open this link while signed into Hub as the target user.`

### 8.3 Bulk linking UX (Admin wizard)

Use 4-step wizard:

1. **Input**
   - Source: CSV upload OR filtered user scope
   - Required columns: `email`; optional `username`, `userId`, `notes`
2. **Dry-run preview**
   - Counters + table by status
   - Filter chips: `Ready`, `Needs review`, `Blocked`
3. **Approval**
   - Select rows to execute
   - Mandatory confirm: `I reviewed blocked and ambiguous matches`
4. **Execute**
   - Background progress + live counters
   - Downloadable result CSV
   - `Retry failed` for retryable rows

Terminal row statuses:

- `linked`
- `skipped_already_linked`
- `blocked_collision`
- `blocked_email_mismatch`
- `blocked_inactive_user`
- `failed_retryable`
- `failed_terminal`

### 8.4 UX copy standards

- Always separate:
  - **Auth success** (user signed in)
  - **Linking status** (linked/not linked)
  - **Authorization** (RBAC/port)
- Avoid generic `SSO failed`.
- Provide one next action on every error state:
  - `Retry`
  - `Request support`
  - `Open linking queue`
  - `Download error report`

### 8.5 Login page SSO errors

When callback fails, prefer redirecting to SPA with `?sso_error=<code>` and map to user-friendly messages:

- `email_collision_local_account`
- `invalid_state`
- `missing_flow_cookie`
- `token_exchange_failed`
- `id_token_validation_failed`

Keep plain HTML fallback for non-SPA flows.

## 8.6 Deterministic bulk matching rules (v1)

A row is **Ready to link** only when all are true:

1. Exactly one active Jetty user matched by input key.
2. Exactly one IdP user match from trusted source.
3. Normalized email matches exactly.
4. Target user has no `oidc_sub`, or same `oidc_sub` (idempotent).
5. IdP `sub` not linked to another active user.
6. User is active (`is_active=true`, `deleted_at IS NULL`).

Otherwise:

- `Needs review` for ambiguous non-conflicting matches.
- `Blocked` for any collision/policy violation.

### 8.7 Bulk job/result model + retry semantics

Conceptual tables:

- `sso_link_jobs`
  - `id`, `created_by`, `source_type` (`csv`|`filtered`), `status` (`draft`|`running`|`completed`|`failed`), `created_at`, `started_at`, `finished_at`
  - counters: `total_rows`, `ready_rows`, `linked_rows`, `blocked_rows`, `failed_rows`
- `sso_link_job_items`
  - `id`, `job_id`, `user_id`, `email`, `idp_subject`, `match_status`, `final_status`, `reason_code`, `reason_detail`, `attempt_count`, `last_attempt_at`
- `sso_link_events`
  - immutable audit timeline for row-level and job-level actions

Retry semantics:

- `failed_retryable` rows can be retried up to `N` attempts (default 3).
- Retries are idempotent:
  - if row became linked since last attempt -> mark `skipped_already_linked`
  - if collision still exists -> remain blocked with updated timestamp
- `failed_terminal` rows are never retried automatically.
- Re-run dry-run is required after source data changes (email/role/user state changes).

---

## 9) Follow-ups to current troubleshooting / tech debt

- Replace opaque HTML error pages for callback with **redirect to** `JPS_PUBLIC_ORIGIN/login?sso_error=...` for better UX (optional env flag).
- Document operational flags: `OIDC_ALLOW_QUERY_CODE_VERIFIER`, `COOKIE_SECURE`, compose env passthrough (`docker-compose.backend.yml`).
- Re-evaluate Hub `state` / `code_verifier` behavior once IdP is fixed to echo `state` correctly; then tighten or remove query verifier fallback.

---

## 10) Delivery phases

| Phase | Scope |
|-------|--------|
| **P0** | Close troubleshooting checklist; confirm token exchange and collision behavior in staging. |
| **P1** | Self-service Connect SSO (state `mode=connect_sso`, Settings UI, `/users/me/sso-status`). |
| **P2** | Admin prelink + email match + RBAC + audit + admin UI. |
| **P3** | Polish: SPA error redirects, optional `sso_sub` display for support (masked). |
| **P4** | Bulk linking wizard (dry-run -> approve -> execute -> export), retry queue, and operational playbook. |

---

## 11) Open questions

- Does Hub guarantee `email` in `id_token` for all relevant clients? If not, fallback claim or deny link with clear message.
- Should linking **disable** local password or remain optional forever? (Default: keep both.)
- Exact RBAC permission name and which roles receive it.

---

## 12) References

- `Backend/src/routes/oidc-sso.js` — callback and collision logic.
- `Backend/migrations/057_users_auth_source_oidc_sub.sql` — `oidc_sub` uniqueness.
- `Docs/Security/SSO-INTEGRATION-GUIDE.md` — OIDC contract.
- `Docs/Troubleshoot/REBUILD-RESTART-CONTAINERS.md` — local Docker lifecycle.
