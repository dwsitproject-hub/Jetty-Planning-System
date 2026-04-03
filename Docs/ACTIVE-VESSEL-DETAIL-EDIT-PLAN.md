# Active Vessel Detail — edit & metadata (implementation plan)

Consolidated plan for **Allocation & Berthing** → **Active Vessel Detail** modal: editable **Times & status**, RBAC, save behaviour, and **last updated** metadata.

---

## 1. Goals

- Allow users with **Allocation & Berthing → edit** to correct **Times & status** from the detail modal (today read-only by design).
- Keep **view / edit / delete** meaningful: only editors see **Edit**; server enforces the same permission on mutations.
- Rely on existing **activity log** for audit where writes already log changes.
- **Derived fields** (**Time Since Berthing**, **Est. Time Remaining**) reflect **saved** data only; refresh after successful save (no live draft recalculation).
- Show **operation-level** freshness: **Last updated on [date/time] by [name]** between **Current Phase** and **Times & status**.

---

## 2. UX — modal layout

| Area | Behaviour |
|------|-----------|
| **Vessel info**, **Current Phase** | Unchanged (read-only in v1 unless scope expands). |
| **Last updated** (new) | Single muted line **between** **Current Phase** and **Times & status**. See §5. |
| **Times & status** | Header row: title left; **Edit** icon button right (`title` / tooltip **Edit**, `aria-label="Edit"`). Hidden if user lacks allocation **edit**. |
| **Edit mode (Times & status)** | Same rows; editable fields use **`datetime-local`** + `berthing-modal__input` / `berthing-modal__label` (match **Log arrival update** & **Confirm Berthing**). **Time Since Berthing** & **Est. Time Remaining** stay **read-only** and show **last saved** values until save + refresh. |
| **Helper note (edit mode)** | Small text under header or above rows: **Changes apply to calculated fields after saving.** |
| **Arrival documents**, **Photos**, **Remarks** | Read-only in v1 (remarks edit can be a follow-up). |
| **Footer** | View: **Close** only. Edit: **Cancel** (discard draft), **Save changes** (primary). Optional: warn on **Close** if dirty. |

---

## 3. Data & API

- **Save:** Reuse **`PUT /api/v1/allocation/arrival`** with the same field set the backend already accepts for the operation (ETA, TA, ETB, TB, POB, SOB, estimated completion, actual completion, etc.). Confirm payload parity with **Log arrival update**.
- **After save:** `fetchAllocationOverview()` (or equivalent) so list + modal row refresh; **derived** lines then match new saved times.
- **Server hardening:** Enforce **`can_edit`** for page **`allocation`** on this route (and related allocation mutators) so UI and API align.
- **Concurrency (phase 2 optional):** compare-and-set on `operations.updated_at` to avoid silent overwrites.

---

## 4. RBAC

- **Frontend:** Show **Edit** only when the session has **allocation → edit** (wire from existing `/me` / permissions if not already on `Allocation.jsx`).
- **Backend:** Require the same permission for **`PUT /allocation/arrival`** (not only `requireAuth` + port scope).

---

## 5. Last updated — date & name

**Placement:** Between **Current Phase** and **Times & status** (dedicated thin strip, secondary typography).

**Copy:** `Last updated on [localized date/time] by [display name]`

**Date source**

- Rows backed by **`operations`:** use **`operations.updated_at`** (any update to that row bumps it — allocation, loading, clearance, etc.). Label is honestly **operation last updated**, not “allocation-only” unless we narrow the source later.
- **Incoming SI rows** (no operation yet): use **`shipping_instructions.updated_at`**, or **—** if product prefers to show metadata only when an operation exists.

**Name source (not on `operations` today)**

- **`operations` has `updated_at` but no `updated_by`.** Pick one:
  - **Preferred long-term:** migration **`operations.updated_by`** → `users.id`, set on every writer that updates `operations`; overview query joins `users.username` (or display name).
  - **Alternative:** derive **latest** `activity_logs` row for `entity_type` = operation / matching `entity_id` and use `actor_username` (heavier; may skew toward “last logged action” only if not all paths log).

**Empty states:** If date missing, show **—**; if user unknown, show **Unknown** or omit “by …”.

---

## 6. Activity log

- No change required if **`PUT /arrival`** already calls `writeActivityLog` with `changes`.
- Optional later: `meta.source: 'active_vessel_detail'` to filter allocation-modal edits in reports.

---

## 7. Testing checklist

- Editor: open berthed vessel → **Last updated** shows expected timestamp/name after prior save.
- **Edit** → change TB / est. completion → **Time Since Berthing** / **Est. Time Remaining** **unchanged** until **Save** → after save + refresh, values update.
- Helper note visible in **edit** mode only (or always under Times & status — match build).
- Non-editor: no **Edit**; API returns **403** if forced.
- Incoming SI (no op): **Last updated** behaviour matches §5 decision.

---

## 8. Implementation order

1. **Backend:** `updated_by` migration + set on `PUT /arrival` (and other `operations` updates if feasible) **or** activity-log-based name; extend **`GET /allocation/overview`** (and `formatListRow`) with `operationUpdatedAt`, `operationUpdatedByUsername` (names as needed).
2. **Backend:** **`can_edit` allocation** on **`PUT /arrival`**.
3. **Frontend:** **Last updated** strip + overview field wiring.
4. **Frontend:** **Times & status** edit mode, note, save/cancel, overview refresh.
5. **QA** against §7; tighten copy if “operation” vs “allocation” confusion appears in UAT.

---

## 9. Out of scope (v1)

- Live ticking clock for duration fields.
- Editing **Remarks** / **Arrival documents** / **jetty** inside this modal (jetty can follow same patterns as Log arrival if added later).
- Field-level RBAC (page-level **allocation edit** only).
