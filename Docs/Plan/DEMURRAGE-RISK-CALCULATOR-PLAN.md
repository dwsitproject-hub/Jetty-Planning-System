# Demurrage Risk Calculator — UX & behaviour plan

**Status:** Living doc — reflects implemented behaviour where noted.  
**Last updated:** 2026-04-04  

## 1. Purpose

The Demurrage Risk Calculator helps planners estimate completion time and (when permitted) persist **estimated completion** on an operation. It is **not** the place to edit master SI fields (commodity, purpose, volume, start time from voyage records); the intended adjustment lever is the **buffer** (throughput multiplier). See §4 for the target layout.

## 2. Candidate list — port scope & sailed exclusion

- Candidates are loaded from **`GET /api/v1/shipping-instructions/candidates`** (port from request context).
- **Port:** Same rules as the main SI list: `COALESCE(si.port_id, preferred_jetty.port)` **or** a non-`SAILED` operation with `operations.port_id` for the selected port.
- **Sailed:** SIs whose **only** operations are `SAILED` are excluded (they must not appear as usable rows).

## 3. Filters — **Incoming** & **Berthed** (aligned with Allocation)

Terminology matches **Allocation → Incoming vessel & berthing plan** (`getBerthingPlanStatus` in `Frontend/src/pages/Allocation.jsx`).

| Filter | Meaning |
|--------|--------|
| **Incoming** | Rows classified as **incoming** on the berthing plan: **no** linked non-`SAILED` operation **or** operation with **`shifting_out`** **or** operation with **no TB** and status **not** `DOCKED` / `IN_PROGRESS` / `COMPLETED` (e.g. `PENDING`, `ALLOCATED`, including **operation exists but no jetty yet**). |
| **Berthed** | Operation exists, **not** `shifting_out`, and (**TB** recorded **or** status is `DOCKED`, `IN_PROGRESS`, or `COMPLETED`). |

**API query params (implemented):**

- `include_incoming` — `'1'` \| `'0'` (default `'1'`)
- `include_berthed` — `'1'` \| `'0'` (default `'1'`)

**Response field:** `berthingPlanStatus`: `'incoming' | 'berthed'` — used for list row labels.

**Note:** This replaces the old **Open SI** / **Has Operation** pair, which keyed only on “operation row present” and did **not** match Allocation’s Incoming/Berthed split.

## 4. Target UI structure (lo-fi summary)

- **Left column**
  - Shipping instruction **filter** (date range, **Incoming** / **Berthed** checkboxes, Apply).
  - Scrollable **list**: `<Vessel> · <SI ref> · Incoming|Berthed · [jetty name when set] · <commodity>` (labels from §3).
  - **VOYAGE CONTEXT** — read-only summary (no “(read-only)” suffix in UI): commodity/line, purpose, volume (MT), start time for calculation (TB/docking/ETA), master rate as text.
  - **SCENARIO** — **Throughput buffer** only (no “(editable)” suffix); optional **Reset to default**; optional collapsed **Advanced** for override rate if product keeps it.
- **Right column:** Result metrics, **Estimate**, **Save as estimation of completion**.

## 5. Implemented UX (2026-04-04)

- **Jetty name** on candidate rows when `operations.jetty_id` is set (`jettyName` from API).
- Read-only **Voyage context** panel: purpose, commodity line (first MT line else line 1), volume MT, start-for-calculation, master rate; link to Shipping Instruction list.
- **Scenario** panel: throughput buffer + **Reset to default**; stale hint when buffer changes after an estimate; **Advanced** toggle for override rate only.
- Left card title: **Choose voyage**.

## 6. Follow-ups

- Tooltips on **Incoming** / **Berthed** filters (one-line definitions).
- Deep link to edit a **specific** SI (if the SI module supports it).

## 7. References

- Allocation status: `getBerthingPlanStatus` — `Frontend/src/pages/Allocation.jsx`
- Candidates route: `Backend/src/routes/shipping-instructions.js` — `GET /candidates`
- Dev seed intent for DEMO-SI-0002: `Backend/scripts/reset-and-seed-dev.sql` (no operation in fresh seed; DB may differ after workflows)
