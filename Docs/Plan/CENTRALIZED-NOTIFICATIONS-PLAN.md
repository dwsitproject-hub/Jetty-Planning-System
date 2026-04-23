# Centralized in-app notifications — plan & specification

**Status:** Draft — for stakeholder review before implementation.  
**Last updated:** 2026-04-04  

## 1. Purpose

This document consolidates requirements, UX (including lo-fi design), data model, backend behavior, and delivery phases for a **centralized notification** capability in the Jetty Planning System. Notifications are created when specific business conditions occur and are delivered **in-app** to users who are eligible by **port assignment** and, where applicable, **RBAC permissions**.

Implementation should begin only after this plan is **approved**.

---

## 2. Goals

- Provide a **single, consistent** way to inform users about time-sensitive or action-required events.
- **Target recipients** using rules that combine:
  - **Port scope** — users assigned to the relevant port via `user_ports` (and active users only).
  - **Capability** — users whose roles/permissions allow the action (e.g. SI approval), matching existing API/UI authorization—not a parallel ad-hoc role name list.
- Support **read vs unread** state **per user**, so the UI can show an accurate **unread counter** and an inbox experience.
- Be **extensible** for additional notification types and optional future channels (email/SMS) without redesigning the core model.

### 2.1 Non-goals (initial phases)

- Browser push notifications, mobile apps (unless later phase explicitly added).
- Email/SMS delivery in **Phase 1** (design should not block adding them later).
- Replacing existing audit logs or activity log panels — notifications complement them but are optimized for **actionable alerts** and **user attention**.

---

## 3. Sample use cases (requirements detail)

These are the anchor scenarios; the architecture should implement them as instances of a **general notification pipeline**.

### 3.1 Use case A — New SI pending approval

| Item | Description |
|------|-------------|
| **Trigger** | A shipping instruction enters a state that **requires approval** (exact state machine to align with existing SI workflow and APIs). |
| **Audience** | Users who **can approve SI** for that workflow **and** are assigned to the **same port** as the SI (via `user_ports`). |
| **Intent** | Draw approvers’ attention to a **specific SI** so they open the approval flow. |
| **Delivery** | Event-driven: emit when the SI transitions into “needs approval” (or equivalent), ideally in the same transaction or immediately after successful persist. |
| **Deep link** | Navigate to SI approval / SI detail route with identifiers already used in the app (`siId` or equivalent). |

### 3.2 Use case B — Berth operation approaching estimated completion (D−1)

| Item | Description |
|------|-------------|
| **Trigger** | A vessel **remains at berth** (operational “still berthing” predicate—must match real data in `operations` or related tables) **and** estimated completion is **one day away** (see §9.1 for definition of “D−1”). |
| **Audience** | **All users** assigned to that **port** (product may later exclude certain read-only roles—decision in §9). |
| **Intent** | **Reminder** to expedite operations before the planned end. |
| **Delivery** | **Scheduled job** — see §10.4 (server-side clock; not the browser). Runs at a configured interval (e.g. 15–60 minutes), queries eligible operations, creates notification rows with **deduplication**. |

### 3.3 Use case C — Missed estimated completion (warning)

| Item | Description |
|------|-------------|
| **Trigger** | Vessel **still at berth** after **estimated completion** time has passed (same “at berth” predicate as B). |
| **Audience** | **All users** assigned to that **port**. |
| **Intent** | **Warning** that the plan was exceeded; prompt coordination. |
| **Delivery** | Same **scheduled job** family as B (§10.4), with distinct notification **type** and severity, and **deduplication** so the same operation does not generate unbounded duplicate warnings. |

### 3.4 Summary: who “sends” what

| Mechanism | Use cases | Where it runs |
|-----------|-----------|----------------|
| **Event-driven** (inline in API after DB commit) | A — SI pending approval; future rules tied to a single HTTP write | API request handler / service layer |
| **Scheduled** (poll DB on an interval) | B — D−1 reminder; C — missed ETC | Cron/worker/scheduler — **always server-side** |

Users never “receive” D−1 or overdue alerts from the client directly; the **browser only displays** rows already written to `notifications` / `notification_recipients` (badge + inbox).

---

## 4. Alignment with current system

- **Port assignment:** `user_ports` associates users with ports (with soft-delete semantics in existing APIs). “Assigned to a specific port” should use the same rules as the rest of the app for “active assignment.”
- **RBAC:** Permissions are stored in `permissions` with `resource_type` / `resource_key` / `can_view` / `can_edit` / `can_delete`, linked via `role_permissions` and `user_roles`. **SI approval** capability must reuse the **same predicates** as the shipping instruction approval APIs and Admin-granted permissions (e.g. `shipping-instruction` and any approval-specific flags introduced in migrations such as approval-related RBAC work).
- **UI shell:** Authenticated app surfaces use `Layout` with a **top bar**. Notifications should integrate there (see §8).

---

## 5. Functional requirements

### 5.1 Notification content

Each notification should include at minimum:

- **Type** — stable string/enum for client styling and routing (e.g. `si_pending_approval`, `operation_etc_reminder_d1`, `operation_etc_overdue`).
- **Severity** — at least `info` vs `warning` (and optionally `critical` later).
- **Title** — short line for list and header.
- **Body** — optional longer text; may be templated from entity fields.
- **Port context** — `port_id` for filtering and display (“Port X”).
- **Entity reference** — `entity_type` + `entity_id` (and optional JSON `metadata`) for deep links.
- **Timestamps** — `created_at` (UTC). Optional `expires_at` or archival policy later.

### 5.2 Read / unread (per user)

- Each user has their own **read state** for each notification they received.
- **Unread:** recipient record exists, `read_at IS NULL` (or equivalent).
- **Read:** user opens list item or navigates via notification link → set `read_at` to current timestamp (or explicit “mark read” API).
- **Unread count:** count of recipient rows for `user_id = current user` with `read_at IS NULL` (and not soft-deleted / dismissed if those flags exist).
- **Mark all read:** optional batch operation for the inbox panel.

### 5.3 Authorization

- Users may **only** list, read, and mark-read **their own** recipient rows.
- Creating notifications is **server-internal** (API routes used by jobs or other services), not public to arbitrary clients.
- Port scope: recipients are precomputed when the notification is created; users who lose port access later might still see historical items—product decision (§9.3).

### 5.4 Performance & retention

- List API should be **paginated** (e.g. cursor or offset with cap).
- Define **retention** (e.g. delete or archive notifications older than N days)—policy TBD in §9.

---

## 6. Data model & database changes

**Yes — new tables are required.** Existing `users`, `roles`, `permissions`, `user_ports` need no structural change for the core feature; they are used to **resolve recipients**.

### 6.1 Table: `notifications`

Stores one logical row per **event** (broadcast payload), not per user.

Suggested columns:

| Column | Type | Notes |
|--------|------|--------|
| `id` | `BIGSERIAL` PK | |
| `type` | `TEXT` NOT NULL | Stable code (`si_pending_approval`, …). |
| `severity` | `TEXT` NOT NULL | e.g. `info`, `warning`. Check constraint. |
| `title` | `TEXT` NOT NULL | |
| `body` | `TEXT` | Nullable. |
| `port_id` | `BIGINT` FK → `ports(id)` | Nullable only if a future global notification type exists; anchor use cases assume NOT NULL. |
| `entity_type` | `TEXT` | e.g. `shipping_instruction`, `operation`. |
| `entity_id` | `BIGINT` | Align with PK type of target table. |
| `metadata` | `JSONB` | Optional extra payload for UI. |
| `dedup_key` | `TEXT` UNIQUE | Nullable; used by scheduled jobs for idempotency (§7). |
| `created_at` | `TIMESTAMPTZ` NOT NULL DEFAULT now() | |

Indexes: `(port_id, created_at DESC)`, `(type, created_at DESC)` as needed for admin/reporting.

### 6.2 Table: `notification_recipients`

One row per **(notification, user)** pair; holds read state.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `BIGSERIAL` PK | Optional if composite PK is preferred. |
| `notification_id` | `BIGINT` NOT NULL FK → `notifications(id)` ON DELETE CASCADE | |
| `user_id` | `BIGINT` NOT NULL FK → `users(id)` ON DELETE CASCADE | |
| `read_at` | `TIMESTAMPTZ` | NULL = unread. |
| `created_at` | `TIMESTAMPTZ` NOT NULL DEFAULT now() | When the row was created (usually equals notification fan-out time). |

Constraints:

- `UNIQUE (notification_id, user_id)` — one recipient row per user per notification.

Indexes:

- `(user_id, read_at)` partial index `WHERE read_at IS NULL` for fast unread counts (optional but valuable).
- `(user_id, notification_id)` for lookups.

### 6.3 Migration

- Add new SQL migration under `Backend/migrations/` (next sequential number) creating the tables, constraints, and indexes.
- No seed data required for core functionality.

---

## 7. Idempotency & deduplication

Scheduled triggers (use cases B and C) rerun on an interval; without dedup, users could receive duplicate reminders.

**Recommended approaches (choose one as standard):**

1. **`notifications.dedup_key`** — e.g. `operation:{id}:etc_reminder:2026-04-04` (calendar bucket) or `operation:{id}:overdue:2026-04-03` (first overdue day). Before insert, check existing row with same key or rely on UNIQUE and catch conflict.
2. **Separate `notification_dispatch_log`** table — `(operation_id, kind, period_key)` UNIQUE.

**Use case A (SI approval):** Typically one notification per transition into pending approval; optional dedup if the same transition could be submitted twice.

---

## 8. UX specification — lo-fi design

### 8.1 Placement

- **Surface:** Main authenticated application shell (`Layout` / top bar).
- **Control:** **Bell icon** in the **top-right cluster** (near port selector, user menu, logout)—**left of** the user block so it stays visible.

### 8.2 Indicator & counter

- **Bell** is always visible after login.
- **Unread badge:** Shown **only** when `unread_count > 0`.
  - Display numeric count; **cap** display at e.g. `9+` if count > 9 to avoid layout breakage.
- **Styling:** Use **brand primary** or a clear accent (consistent with design tokens) for the badge.
- When count is zero: **no badge** on the bell (keep chrome minimal).

### 8.3 Interaction — desktop

1. User clicks **bell** → **dropdown panel** opens, anchored under the bell, width **~320–400px**, max height **~50–60vh**, scroll inside.
2. Panel header: **“Notifications”** + optional **“Mark all as read”**.
3. **List:** Newest first. Each row:
   - **Title** (one line, truncated with ellipsis if needed).
   - **Subtitle** — port name, vessel/SI identifier, relative time (“2h ago”).
   - **Severity** — optional left border or small label (**Info** / **Warning**).
4. **Row click:**
   - Call **mark read** (or mark read on successful navigation).
   - **Navigate** to the mapped route using `entity_type` / `entity_id` (and metadata if needed).
   - Close dropdown.
5. **Footer:** **“View all notifications”** optional link to a full page if inbox history grows beyond dropdown comfort.

### 8.4 Interaction — mobile / narrow screens

- Same **bell** in header.
- Tap opens **full-screen sheet** or a dedicated **`/notifications`** route instead of a small dropdown.

### 8.5 Empty & error states

- **Empty:** “No notifications” with short helper text.
- **Loading:** Skeleton or spinner inside panel.
- **Error:** Inline message with retry; do not block the rest of the app.

### 8.6 Lo-fi wireframe (ASCII)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  [Brand]   Dashboard   Allocation   At-berth   …      [?]  🔔 ③   Port ▼   You ▼   │
└────────────────────────────────────────────────────────────────────────────────┘
                                                           │
                                         ┌─────────────────┴──────────────────┐
                                         │ Notifications      Mark all read     │
                                         ├────────────────────────────────────┤
                                         │ ▌⚠ MVessel ALPHA — past est. compl. │
                                         │ │  Port Muara Jawa · 12m ago         │
                                         ├────────────────────────────────────┤
                                         │ ▌ℹ SI #4521 — pending your approval │
                                         │ │  Port Muara Jawa · 1h ago          │
                                         ├────────────────────────────────────┤
                                         │ ▌ℹ Vessel BETA — completes tomorrow │
                                         │ │  Port Muara Jawa · Today           │
                                         ├────────────────────────────────────┤
                                         │           View all notifications      │
                                         └────────────────────────────────────┘
```

Legend: **③** = unread count; **▌** = optional severity stripe; **⚠/ℹ** = icon shorthand in design.

### 8.7 Accessibility (target)

- Bell is a **button** with `aria-label` e.g. “Notifications, 3 unread”.
- Dropdown/sheet traps focus appropriately; **Esc** closes panel.
- Unread items distinguishable without color alone (icon or text).

---

## 9. Open decisions (to lock before build)

### 9.1 Definition of “D−1” and time zones

- Calendar **date** in **port-local** timezone vs **UTC date** vs **24 hours before ETC**.
- Source of truth for “estimated completion” field on operations (exact column name and semantics).

### 9.2 “Still berthing” predicate

- Exact filter on `operations` (status codes, jetty assignment, cargo complete flags, etc.) must tie to business rules used on Allocation / At-berth screens.

### 9.3 Historical visibility

- If a user loses `user_ports` assignment, should past notifications disappear? (Recommended: **keep history** for audit UX; optional filter “only current ports.”)

### 9.4 “Everyone on port” scope

- Strictly all `user_ports` users vs exclude users without login in N days vs exclude certain roles.

### 9.5 Retention & admin

- How long to keep notifications; whether admins need a purge or export tool.

---

## 10. Backend design (post-approval implementation outline)

### 10.1 Modules

- **`notificationService.create({ type, severity, title, body, portId, entityType, entityId, metadata, dedupKey, recipientUserIds })`** — insert `notifications`, bulk insert `notification_recipients`.
- **`recipientResolver`** — functions:
  - `resolveSiApprovers(portId)` → user ids (join `user_ports` + effective SI approval permission).
  - `resolveAllPortUsers(portId)` → distinct user ids on port.

### 10.2 HTTP API (draft)

All require authenticated JWT; scoped to current user except internal/job callers.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/notifications` | Paginated inbox for current user (join recipient + notification). |
| `GET` | `/api/v1/notifications/unread-count` | Lightweight poll for badge. |
| `POST` | `/api/v1/notifications/recipients/:id/read` | Mark one read (`recipient` row id or composite). |
| `POST` | `/api/v1/notifications/read-all` | Mark all read for user (optional). |

Exact path prefix should follow existing `/api/v1` conventions.

Optional **internal** endpoint (for operators or a cron HTTP caller), not for end users:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/internal/notifications/jobs/operation-etc` (example) | Run D−1 + overdue evaluation once; protect with **shared secret**, **mTLS**, or **localhost-only** binding. |

Prefer **CLI + same DB** if no HTTP surface is desired.

### 10.3 Event-driven triggers (non-scheduled)

- **When:** Immediately after a **successful** persistence of domain state (e.g. SI enters “pending approval”).
- **How:** Request handler (or domain service) calls `recipientResolver` + `notificationService.create` — **no clock** required.
- **Examples:** Use case A; future “assignment changed” or “document uploaded” rules if product adds them.

Failures should be **logged**; policy: fail the HTTP request vs “best-effort notify” is a product/engineering choice (often **non-blocking** notify so core workflow still succeeds).

### 10.4 Scheduled triggers (D−1, missed ETC, and similar)

Time-based rules **cannot** rely on a user opening the app. Something on the **server** must run **periodically**.

**Job flow (each run):**

1. **Query** `operations` (and joins as needed) for rows matching:
   - “Still at berth” predicate (§9.2), and  
   - **D−1:** ETC falls in the “reminder window” for tomorrow / next calendar day / 24h rule (§9.1), and  
   - **Overdue:** `ETC < now()` (with same berth predicate).
2. For each candidate row, compute a **`dedup_key`** (§7) so the **same** operation + day + rule does not insert duplicates on the next cron tick.
3. Call **`notificationService.create`** with `resolveAllPortUsers(port_id)` (or other resolver).
4. Commit; users see new inbox rows on next **poll** or panel open.

**Interval:** Typically **15–60 minutes** — balances timeliness vs DB load. Exact value is configurable per environment.

**Not used for:** SI approval (use §10.3 unless product adds a periodic “nudge” later).

### 10.5 Scheduler implementation options

All of these are valid; pick one (or combine) per deployment. The job body should remain **shared code** (e.g. `Backend/scripts/run-operation-etc-notifications.js` or a service module) so logic is not duplicated.

| Option | Description | Pros | Cons / notes |
|--------|-------------|------|----------------|
| **Host OS `cron` + Node CLI** | `cron` on the **backend** VM/ECS host runs `node .../run-operation-etc-notifications.js` with `DATABASE_URL` | Simple, explicit, easy to audit | Must install/script on each host; ensure `.env` / secrets available |
| **`cron` + `curl` to internal HTTP** | Cron POSTs to §10.2 internal route | No SSH into app to change schedule | Must lock down endpoint (**secret header**, IP allowlist, or localhost-only) |
| **In-process `node-cron` (API process)** | Timer inside `index.js` when `NODE_ENV=production` | Ships with app | If **multiple API replicas**, **each** instance may fire unless you add a **single leader** or rely entirely on **dedup keys** |
| **Dedicated worker container** | Second service in `docker-compose` / second ECS task that only runs schedulers | Clean split; scale API without duplicating jobs | Extra deployable unit |
| **Managed scheduler** | Cloud EventBridge / similar invoking HTTP or Lambda | No server cron maintenance | Vendor-specific; secure the target |
| **PostgreSQL `pg_cron`** | DB runs SQL on schedule | Central | Business logic in SQL is harder; prefer app-layer job if rules are rich |

**Recommendation for Jetty Planning System (pragmatic):** start with **host `cron` + one Node script** (or **internal HTTP + cron**) on the **backend** server documented in `Docs/ALICLOUD-DEPLOYMENT-GUIDE.md` when Phase 2 ships. Move to a **worker** container if API is scaled to **>1** replica without wanting to rely on dedup alone.

### 10.6 Horizontal scaling (multiple API instances)

- **Event-driven** notifications: safe with many replicas (each event handled once per request).
- **In-process cron** on each replica: risk of **duplicate job runs**. Mitigations:
  1. **Postgres advisory lock** for the duration of the job (`pg_try_advisory_lock`), only one winner; or  
  2. Strong **`dedup_key` UNIQUE** on `notifications` so duplicate inserts are harmless (still wastes work); or  
  3. Run the scheduler **only on one** instance / dedicated worker.

Document the chosen approach in the deployment guide when implemented.

---

## 11. Frontend design (post-approval implementation outline)

- **Bell + badge** component in `Layout` top bar.
- **Notification panel** component (dropdown / sheet).
- **Polling** every N seconds or on focus for `unread-count` (Phase 1); optional SSE/WebSocket later.
- **Route map** from `entity_type` / `entity_id` to React Router paths (single module to avoid scattered switches).

---

## 12. Phased rollout

| Phase | Scope |
|-------|--------|
| **Phase 1** | Migrations + create/list/mark-read API + Layout bell + dropdown + **Use case A** (SI approval) only. |
| **Phase 2** | **Scheduled job** (§10.4–10.5) + dedup + **Use cases B & C** (D−1 and overdue); document cron/worker in deployment guide. |
| **Phase 3** | Full notifications page, retention job, optional email hook, real-time updates. |

---

## 13. Testing checklist (high level)

- Recipient resolution respects **port** and **permission** for A; does not notify users on other ports.
- Unread count matches DB for multi-tab simulation (eventual consistency acceptable if polling).
- Dedup: job running twice does not duplicate B/C for same operation/period; with multiple API replicas, scheduler uses lock, single worker, or dedup-only strategy per §10.6.
- Deleting a user or port: FK behavior matches expectations (CASCADE on recipients; careful with `notifications.port_id`).
- Deep links land on authorized screens; unauthorized users never see others’ recipients.

---

## 14. Approval sign-off

| Role | Name | Date | Approved (Y/N) |
|------|------|------|----------------|
| Product / Owner | | | |
| Engineering lead | | | |

**After approval:** implement Phase 1 per §12, then iterate. Update this document when decisions in §9 are finalized.

---

## 15. Related repository areas

- Port scope: `Backend/src/middleware/port-scope.js`, `Backend/migrations/033_user_ports.sql`
- RBAC: `Backend/migrations/001_auth_rbac_tables.sql`, SI-related RBAC migrations (e.g. `025_si_loading_document_and_approve_rbac.sql`)
- App shell: `Frontend/src/components/Layout.jsx`
