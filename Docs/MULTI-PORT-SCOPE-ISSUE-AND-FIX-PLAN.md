# Multi-port scope: issue summary and fix plan

This document describes how **selected port** works for users assigned to **more than one port**, where gaps show up, and a **step-by-step plan** to harden the system. A related **Shifting out** API defect is noted for a **follow-up** after this work.

---

## 1. How it works today

### 1.1 Server (`requirePortScope`)

File: `Backend/src/middleware/port-scope.js`

For each authenticated request under scoped routers:

| User’s assigned ports | How `req.selectedPortId` is set |
|----------------------|-----------------------------------|
| **0** | Request fails with **403** (“No port assigned…”). |
| **1** | **Auto-selected** to that port. Header optional. |
| **> 1** | Must send a valid port id via **`X-Selected-Port-Id`** or **`X-Port-Id`**, or **`port_id`** query. Must be in the user’s `user_ports` list; otherwise **403**. If missing/invalid → **400** (“Port selection required”). |

The middleware attaches:

- `req.selectedPortId` — numeric port id for this request  
- `req.assignedPorts` / `req.assignedPortIds` — for UI or extra checks  

There is **no server-side session object** storing the port; scope is **recomputed on every request** from JWT + headers/query + DB assignments.

### 1.2 Browser

- **Persistence:** `sessionStorage` key `jps_selected_port_id` (see `Frontend/src/api/client.js`).
- **API calls:** `authHeaders()` adds **`X-Selected-Port-Id`** when a value is present.
- **Context:** `PortScopeProvider` (`Frontend/src/context/PortScopeContext.jsx`) loads assignments from **`GET /users/me/ports`** (via `fetchMyPorts`), syncs selection with storage, and sets **`requiresSelection`** when `assignedPorts.length > 1` and nothing valid is selected.
- **Gating:** `Layout.jsx` blocks main content until the user picks a port (multi-port) or shows errors for zero ports. Port switch in the header calls **`applyPortSelection`** → updates storage → **full page reload** so lists refetch under the new scope.

---

## 2. Fundamental problem (multi-port)

The **contract** is: *every port-scoped API handler must use the same port the middleware resolved (`req.selectedPortId`) for filters, joins, and `canAccessOperationForSelectedPort`-style checks.*

**What breaks multi-port (and sometimes single-port) reliability:**

1. **Handler bugs**  
   Some routes **reference a local variable `selectedPortId` that was never defined**, even though `req.selectedPortId` was set by middleware. That throws **`ReferenceError`** → **500**.  
   Example observed: `POST /api/v1/operations/:id/shifting-out` in `Backend/src/routes/operations.js` (uses `selectedPortId` without `const selectedPortId = Number(req.selectedPortId)`).  
   **This class of bug does not appear for users with exactly one port** in cases where no port-scoped branch runs the broken line the same way—but it is still a **landmine** for any code path that assumes a local binding exists.

2. **Inconsistent patterns in one file**  
   In `operations.js`, some handlers define `const selectedPortId = Number(req.selectedPortId)` at the top; others pass `req.selectedPortId` directly into helpers; **one route did neither** for the local variable. Inconsistency makes reviews and copy-paste error-prone.

3. **Implicit dependency on headers**  
   Multi-port users **must** have `X-Selected-Port-Id` on every scoped call. The app is designed for that via `client.js`, but **any** new client (mobile, script, Postman without header) gets **400** for multi-port users. That is expected behavior, but it should be **documented** and **tested**.

4. **Optional hardening (frontend)**  
   Most port-scoped pages should only render under `Layout` after selection. Individual pages can still **defensively** use `usePortScope()` (e.g. skip fetches when `requiresSelection`) to avoid transient calls during navigation or future layout changes. Not all pages today import `usePortScope()` (e.g. `AtBerthExecutions.jsx` relies on the layout gate only).

---

## 3. Deferred: Shifting out (`POST .../shifting-out`)

- **Symptom:** **500** on `POST /api/v1/operations/:id/shifting-out`.  
- **Confirmed root cause (logs):** `ReferenceError: selectedPortId is not defined` at `operations.js` (port check line).  
- **Intent:** Treat **shifting out** as a **follow-up fix** after the **multi-port scope audit** below, so the same pattern is applied once systematically rather than as a one-off.

---

## 4. Step-by-step plan to fix the multi-port issue

### Phase A — Inventory (no behavior change yet)

1. **List all routers** mounted with `requirePortScope` in `Backend/src/index.js` (or equivalent).
2. For each route file, **grep** for:
   - `req.selectedPortId`
   - `selectedPortId` (local)
   - `canAccessOperationForSelectedPort`, `COALESCE(o.port_id`, `port_id = $`, etc.
3. Build a **checklist** of handlers that need a port id and note whether they:
   - define `const selectedPortId = Number(req.selectedPortId)` (or use `req.selectedPortId` consistently), or  
   - incorrectly use an **undefined** local `selectedPortId`.

### Phase B — Standardize backend pattern

1. **Pick one convention** per handler, for example at the top of each port-scoped handler:

   ```js
   const selectedPortId = Number(req.selectedPortId);
   ```

   (Only after middleware has run; `req.selectedPortId` is always set when `requirePortScope` succeeds.)

2. **Replace** any stray use of bare `selectedPortId` that is not declared.
3. **Align** `canAccessOperationForSelectedPort(op, x)` calls to pass **`selectedPortId`** or **`Number(req.selectedPortId)`** consistently (avoid mixing raw `req.selectedPortId` with `Number()` in different places unless intentional).

### Phase C — Verify

1. **Manual:** Log in as a user with **two** assigned ports; select port A; exercise Allocation, At-Berth, Operations mutations, Shipping Instructions, Jetty layout, etc. Repeat for port B.
2. **Manual:** Log in as a user with **one** port; confirm no regression (header may not show selector; middleware auto-selects).
3. **Optional:** Add a **smoke script** or minimal integration test that calls a few scoped endpoints with and without `X-Selected-Port-Id` for a multi-port test user.

### Phase D — Documentation and prevention

1. Add a short **“Port scope for API routes”** note to the main backend README or TECH-SPEC: *always read `req.selectedPortId` after `requirePortScope`; never introduce an undeclared local `selectedPortId`.*
2. **Optional:** CI grep or a simple script in `Backend/scripts/` that fails if `canAccessOperationForSelectedPort(op, selectedPortId)` appears in a file where `selectedPortId` is not defined in the same function scope (heuristic; may need tuning).

### Phase E — Revisit Shifting out

1. Apply the **same standardized pattern** to `POST /:id/shifting-out`.
2. Retest shifting out for **multi-port** and **single-port** users.
3. Confirm migration **042** (`shifting_out` / `shifting_out_at`) is applied on target databases (separate from the `ReferenceError`).

---

## 5. Summary

| Topic | Detail |
|--------|--------|
| **Source of truth for “current port”** | `req.selectedPortId` from `requirePortScope`, driven by JWT + `X-Selected-Port-Id` (multi-port) or auto (single port). |
| **Client persistence** | `sessionStorage` + header on each API request. |
| **Core risk** | Route handlers that use **`selectedPortId` without defining it** → **500** for valid requests. |
| **Fix strategy** | Audit all scoped routes → standardize on **`const selectedPortId = Number(req.selectedPortId)`** (or equivalent) → test with multi-port users. |
| **Shifting out** | Known **`ReferenceError`**; fix **after** the multi-port audit so patterns stay consistent. |

---

*Document version: initial — aligns with codebase as of the Jetty Planning System repo (port-scope middleware, Layout gating, `operations` shifting-out defect).*
