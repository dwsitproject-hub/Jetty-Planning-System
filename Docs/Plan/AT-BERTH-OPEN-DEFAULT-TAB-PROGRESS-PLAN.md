# Plan — Open vessel to correct phase tab (progress-based)

**Status:** planned  
**Last updated:** 2026-04-08  
**Owner:** Engineering / Product (joint)

---

## 1. Problem

Today, “open vessel” navigation (e.g. **At‑Berth → Open** button, **Dashboard → SLA & schedule risk** item click, and other shortcuts) chooses which sub-page to open using **operation status heuristics** (e.g. `IN_PROGRESS` → Operational).

This is frequently wrong because the desired default tab should be based on **phase progress** (done/total counts), not on the operation status string.

Example expectations:

- **SPOB ANUGERAH BERSAM** — Pre 3/7; Ops 0/4; Post 0/3 → open **Pre‑Checking**
- **BG AS MARINA 10** — Pre 7/7; Ops 4/4; Post 0/3 → open **Post‑Checking**
- **VESSEL X** — Pre 7/7; Ops 3/4; Post 0/3 → open **Operational**

---

## 2. Goal / desired logic

Default tab = **earliest incomplete phase** in a fixed order:

1) **Pre‑Checking**  
2) **Operational**  
3) **Post‑Checking**

Decision rule:

- If `pre.done < pre.total` → open `pre-checking`
- Else if `ops.done < ops.total` → open `loading` (Operational)
- Else → open `post-checking`

Notes:

- This should apply consistently to both **Loading** and **Unloading** hubs (`/loading/...` and `/unloading/...`).
- The route uses **`op-<operationId>`** as the vessel id segment (consistent with At‑Berth open deep link behavior).

---

## 3. Current implementation (baseline)

- At‑Berth “Open” and Dashboard risk clicks share a helper that decides tab from:
  - `row.status` and sometimes `row.completionPercent`
- This does **not** use phase progress counts.

---

## 4. Options

### Option A (recommended): backend provides phase progress summary

Add a lightweight backend computation that returns **phase progress summary** for an operation:

```json
{
  "operationId": 12,
  "purpose": "Loading",
  "phaseProgress": {
    "pre": { "done": 3, "total": 7 },
    "ops": { "done": 0, "total": 4 },
    "post": { "done": 0, "total": 3 }
  }
}
```

Then, all “open” links compute the default tab using §2.

**Pros**
- One data source of truth for routing
- Avoids multiple per-click API calls
- Consistent across dashboard / at-berth / allocation shortcuts

**Cons**
- Requires backend work + agreement on totals and “Done” rules

### Option B: frontend computes progress on click (multi-fetch)

On click, the client fetches per-operation workflow state (sub-processes + operational activities) and computes the phase progress locally, then navigates.

**Pros**
- No new backend contract

**Cons**
- 2–3 API calls per click (slower, more failure modes)
- More duplicated logic in SPA

### Option C: improve heuristics only

Continue to route based on status/percent heuristics.

**Cons**
- Cannot meet the examples reliably (status is not a proxy for phase completion)

---

## 5. Recommended approach

Proceed with **Option A**.

### 5.1 Backend scope (proposed)

Provide phase progress for operations in one of these ways:

- **A1 (preferred):** include `phaseProgress` in existing lists:
  - `GET /operations/at-berth`
  - `GET /operations` (used by dashboard)
- **A2:** add a dedicated endpoint:
  - `GET /operations/:id/phase-progress`

### 5.2 Totals and “Done” rules (must match hub UI)

The definition of “done” should match the hub page logic (`Loading.jsx`):

- **Pre‑Checking total**: 7 fixed section keys (as today)
- **Operational total**: number of milestones for purpose (Loading vs Unloading)
- **Post‑Checking total**: number of post-check tabs (as today)

“Done” is derived from stored workflow state:

- Pre/Post: `operation_sub_processes` (and/or derived fields) + documents/timestamps where relevant
- Ops: `operation_operational_activities` + milestone N/A reasons

If backend cannot derive some items deterministically, it should return:

- best-effort counts + a boolean `isEstimated: true`, or
- omit `phaseProgress` so client falls back to status heuristics.

---

## 6. Frontend changes (planned)

### 6.1 Shared tab selector

Create/extend a shared helper, e.g.:

- `getDefaultHubSectionFromProgress(phaseProgress)` → `pre-checking | loading | post-checking`

### 6.2 Use the same logic for navigation

Apply to:

- **At‑Berth → Open** button
- **Dashboard → SLA & schedule risk** list click
- (Optional) Allocation “Active Vessel Detail → Current Phase” links when opening a hub page

### 6.3 Fallback behavior

If `phaseProgress` is missing:

- fall back to current status-based routing to avoid dead ends.

---

## 7. Acceptance criteria

- Given phase progress values, the app opens the correct hub tab per §2 for both Loading/Unloading.
- Behavior is consistent between:
  - At‑Berth “Open”
  - Dashboard SLA risk list click
- No navigation to invalid routes (e.g. `/loading/op-/...`).
- When progress is unavailable, the existing status-based behavior remains as fallback.

---

## 8. Test plan (later)

- Unit test the “choose default tab” function with the 3 examples in §1.
- Manual test:
  - One operation mid-pre-check
  - One operation mid-operational
  - One operation ready for post-check
  - Verify both At‑Berth and Dashboard lead to the same default tab.

