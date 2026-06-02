# Plan — Detailed At-Berth Executions Log: Start / End / Duration (Pre + Post)

**Status:** fixed (implemented)  
**Last updated:** 2026-05-04  
**Owner:** Engineering

---

## 1. Problem

In **Detailed At-Berth Executions Log** (`OperationActivityTimeline`), **Operational** rows show **Start time**, **End time**, and **Duration** correctly, but **Pre-Checking** and **Post-Checking** rows often show **—** for **End time** and **Duration**, even when data may exist or should be persisted.

---

## 2. Root cause (two layers)

### 2.1 Frontend (display)

**File:** `Frontend/src/components/OperationActivityTimeline.jsx`

`timelineRowSchedule()` for `source === 'sub_process'`:

- Uses only **`occurredAt`** as the displayed start.
- Hard-codes **`end: null`** and **`duration: '—'`**.

It does **not** use **`startAt`** / **`endAt`** returned by the API for sub-process events.

### 2.2 API (already exposes intervals)

**File:** `Backend/src/routes/operation-operational-activities.js` — `GET /operations/:operationId/activity-timeline`

For each `operation_sub_processes` row, events include:

- `startAt` = `start_at ?? occurred_at`
- `endAt` = `end_at`

So the timeline payload can carry end times; the UI branch for `sub_process` ignores them.

### 2.3 Data / saves (conditional)

**File:** `Frontend/src/pages/Loading.jsx` (and related save paths)

`upsertSubProcess` supports `occurredAt`, `startAt`, `endAt`. Not every Pre/Post flow may persist **`endAt`** when marking **Done**. If `end_at` is never written, `endAt` in JSON is `null` and the table should still show **—** for end/duration **after** the display fix—until writes are corrected.

**Semantics (reference):**

- **`occurred_at` / `occurredAt`:** one-shot “recorded at” instant.
- **`start_at` / `startAt`, `end_at` / `endAt`:** interval for duration use cases.

---

## 3. Proposed fix

### 3.1 Frontend — use interval fields for `sub_process`

**File:** `Frontend/src/components/OperationActivityTimeline.jsx`

In `timelineRowSchedule` for `ev.source === 'sub_process'`:

| Display | Source |
|--------|--------|
| **Start** | `ev.startAt ?? ev.occurredAt ?? null` |
| **End** | `ev.endAt ?? null` |
| **Duration** | Same as operational: `formatTimelineDuration(startIso, endIso)` using resolved ISO start/end (both must be valid and end ≥ start). |

**Edge cases:**

| Situation | Behaviour |
|-----------|------------|
| Only `occurredAt`, no `endAt` | Start shown; End **—**; Duration **—** (one-shot). |
| `startAt` + `endAt` | Full interval + duration. |
| `operational_milestone_na` | Unchanged (no duration unless product asks otherwise). |
| `operational_activity` | Unchanged. |

### 3.2 Backend

No change required for the **read** path if `activity-timeline` already maps `start_at` / `end_at` / `occurred_at` correctly.

### 3.3 Frontend — persist `end_at` where missing (follow-up)

**File:** `Frontend/src/pages/Loading.jsx` (and any shared Pre/Post save helpers)

After **3.1** is deployed:

1. Manually verify a few Pre/Post steps that have end times in the UI/DB.
2. For any step that still shows **—** end, trace `upsertSubProcess` payload when status is **Done**.
3. Ensure **`endAt`** is sent whenever the product expects a closed interval (and avoid collapsing end into start unless “instant complete” is intentional).

---

## 4. Rollout order

1. Implement **§3.1** (small, fixes “API has `endAt` but UI hides it”).
2. Test with existing DB rows that have `end_at` populated.
3. If gaps remain, implement **§3.3** per affected sub-process key / section.

---

## 5. Acceptance criteria

- **Operational** rows: unchanged behaviour.
- **Pre-Checking / Post-Checking** rows with **`end_at`** in DB: **Start**, **End**, and **Duration** match the same formatting rules as operational activities.
- Rows with only **`occurred_at`** (no **`end_at`**): **Start** shown; **End** and **Duration** remain **—**.
- No regression to Edit/Delete or `buildActivityLogEditPath` behaviour.

---

## 6. References

- `Frontend/src/components/OperationActivityTimeline.jsx` — `timelineRowSchedule`, table rendering.
- `Backend/src/routes/operation-operational-activities.js` — `GET .../activity-timeline` sub_process event shape.
- `Frontend/src/api/operations.js` — `upsertSubProcess` body (`occurredAt`, `startAt`, `endAt`).
- `Frontend/src/pages/Loading.jsx` — Pre/Post `upsertSubProcess` call sites.

---

## 7. Resolution (implemented)

- **2026-04-09:** **§3.1** applied in `OperationActivityTimeline.jsx`: `sub_process` rows use `startAt ?? occurredAt`, `endAt`, and `formatTimelineDuration` like operational activities. Specs updated: **TECH-SPEC-Jetty-Planning-System.md** §3.4A (columns + `activity-timeline` contract), **FUNCTIONAL-SPEC-Jetty-Schedule-and-Arrival.md** §9 (detailed log row). Follow-up **§3.3** remains optional if some saves still omit `endAt`.
- **2026-05-04:** **Status / Remark / Documents** columns in the same log; `activity-timeline` sub-process events include **`documents`** (see TECH-SPEC §3.4A.3, FUNCTIONAL-SPEC §9 changelog **1.34**).
