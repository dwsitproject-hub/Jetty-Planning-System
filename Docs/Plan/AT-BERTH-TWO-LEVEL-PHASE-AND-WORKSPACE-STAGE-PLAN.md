# Plan — At-Berth: two-level phase (Lifecycle + Workspace stage) + fix “0/3 → 3/3” + list phase clarity

**Status:** **partial** — Case A (Option A) **implemented** (2026-04-10); Case B (Workspace column on At-Berth list) **not implemented** yet.  
**Last updated:** 2026-04-10  
**Owner:** Product / Engineering

---

## 1. Background (two user-visible issues)

### Case A — Workspace header shows Post-Checking `0/3` until user clicks the Post-Checking tab

**Implemented (Option A, 2026-04-10):** Loading/Unloading **stage tabs** show **`— / n complete`** for Pre-Checking and Post-Checking until that stage’s persisted load has finished, instead of misleading **`0/n`**. Code: `Frontend/src/pages/Loading.jsx` (`StageTabs`, hydration flags, `onPersistedHydrationDone`). Specs: **FUNCTIONAL-SPEC §9.1.5**, **TECH-SPEC §2.2.4**.

---

#### Original problem statement (for history)

Observed behaviour:

- On first open (e.g. Operational tab), stage counters show **Post-Checking 0/3**.
- After clicking **Post-Checking**, it flips to **3/3**.

Root cause:

- Pre/Post persisted state is **lazy-loaded per section** (`PreCheckingSections` / `PostCheckingSections` mount triggers fetch).
- Header stage counters compute from in-memory context (`getPostChecking`) even when it hasn’t been populated yet.

### Case B — At-Berth Executions list shows “Phase = Pre-Checking” even when Post-Checking steps are done

Observed behaviour:

- Operation row can remain **DOCKED** and therefore appear in **Pre-Checking** (status-driven phase), even if Post-Checking sub-processes are complete.

Root cause:

- At-Berth list “Phase” is currently a **lifecycle/status-derived** concept (aligned with `operations.status`), not a checklist/workspace concept.

---

## 2. Goal

Introduce a **two-level phase model**:

- **Level 1 (Lifecycle phase)**: keep the existing high-level pipeline and status semantics (SI → Planned berthing → At-Berth → Clearance; DOCKED/IN_PROGRESS/COMPLETED/SAILED).
- **Level 2 (Workspace stage)**: show a deeper “where are we inside At‑Berth” label derived from **structured steps**, using **latest touch** rules (works with Edit/Delete).

Additionally:

- Fix the misleading **0/3** header display on first open (Case A).
- Resolve user confusion on At-Berth list by showing the new workspace stage alongside the lifecycle phase (Case B).

---

## 3. Definitions

### 3.1 Lifecycle phase (Level 1)

This remains unchanged:

- Used for clearance eligibility and depart workflow.
- Derived from `operations.status` and sign-off / depart rules.

### 3.2 Workspace stage (Level 2) — “latest touch”

Workspace stage is derived from the **most recent non-deleted work event**.

Stages:

- **Pre‑Checking**
- **Operational**
- **Post‑Checking**
- **Sign‑off pending** (highest priority when sign-off request exists and operation not COMPLETED)

Examples:

- Latest touched is **INITIAL SOUNDING** → **Pre‑Checking**
- Latest touched is **CARGO PRE‑CONDITIONING** → **Operational**
- Latest touched is **FINAL HOLD INSPECTION** → **Post‑Checking**
- `signoff_requested_at` exists (and status not COMPLETED) → **Sign‑off pending**

Rationale:

- Users are allowed to **Edit/Delete** entries. “Latest touch” is stable and honest (stage can move backwards after deletes/edits).

---

## 4. Proposed implementation (minimal impact)

### 4.1 Add “Workspace” stage to the At‑Berth Executions list (primary)

**Where:**

- `Frontend/src/pages/AtBerthExecutions.jsx`

**UI change:**

- Add a new column: **Workspace** (or **At‑Berth stage**) next to the existing **Phase** / **Status** columns.
- Display as a short badge: `Pre‑Checking`, `Operational`, `Post‑Checking`, `Sign‑off pending`, or `—` while unknown.

**Fetch strategy (to avoid N+1 on load):**

- Do **not** fetch stage for all rows on initial list load.
- Compute stage on demand:
  - Trigger on **row expand** (Full details open), and/or
  - Optional: prefetch for the **first N visible rows** only.

**Data source (reuse existing endpoint):**

- `GET /operations/:id/activity-timeline` (merged detailed log).
- Find the **most recent** event in the response (already excludes deleted rows).
- Derive stage from the latest event:
  - `source === 'sub_process'` + `phase === 'Pre-Checking'` → Pre‑Checking
  - `source === 'sub_process'` + `phase === 'Post-Checking'` → Post‑Checking
  - `source === 'operational_activity'` → Operational
- Override: if operation has `signoffRequestedAt` and status not `COMPLETED` → `Sign‑off pending`.

**Caching:**

- Cache per operation id in At‑Berth page state: `operationId -> { workspaceStage, lastEventAt }`.
- Reuse cache on subsequent expands; allow manual refresh via page reload.

### 4.2 Fix Case A (header “0/3 → 3/3”) in Loading/Unloading workspace

**Where:**

- `Frontend/src/pages/Loading.jsx`

**Decision:** **Option A** — **implemented** (2026-04-10).

**Option A (implemented):** show unknown until loaded  
  - Track hydration for API-backed operations (`preCheckPersistHydrated` / `postCheckPersistHydrated`; reset on operation change).
  - Before loaded, show **`— / n complete`** instead of **`0/n`** so users aren’t misled.
  - Callbacks from `PreCheckingSections` / `PostCheckingSections` signal hydration after persisted merge or handled fetch error; parent ignores stale `operationId` via ref.

**Option B (not implemented; optional follow-up):** prefetch Pre + Post once `operationId` is known  
  - On workspace mount, fetch:
    - `fetchSubProcesses(operationId, 'Pre-Checking')`
    - `fetchSubProcesses(operationId, 'Post-Checking')`
  - Populate context so header counts are accurate **without** opening each tab first.

### 4.3 Keep lifecycle “Phase” unchanged (avoid regressions)

- Do not change existing At‑Berth list “Phase” definition (status-derived).
- Add workspace stage as an additional label to prevent conflating the two concepts.

---

## 5. Trigger model (when workspace stage updates)

Workspace stage changes when the underlying events change, i.e. after:

- Saving/editing/deleting a Pre/Post sub-process.
- Saving/editing/deleting an operational activity.
- Creating a sign-off request / approving sign-off.

Practical triggers:

- On At‑Berth list: compute on row expand; recompute on expand after returning from workspace.
- On workspace header: Option A updates when data loads; Option B updates immediately after prefetch finishes.

---

## 6. Acceptance criteria

- **Case B — pending:** At‑Berth list shows **both**:
  - Lifecycle phase (existing behaviour), and
  - Workspace stage (latest touch) in a dedicated column/badge.
- **Case B — pending:** Workspace stage derives from **latest non-deleted** timeline event, with **Sign‑off pending** priority when applicable.
- **Case A — met (Option A):** Workspace **stage tabs** do not show misleading **`0/n`** purely due to “not yet fetched” for Pre/Post (unknown **`— / n`** until load settles).
- No changes to clearance eligibility logic or depart flow.
- **Case B — pending:** Performance: At‑Berth list does not make N API calls on initial load (expand-only or limited prefetch).

---

## 7. Rollout steps

1. Implement workspace stage derivation helper (frontend-only). — **pending (Case B)**
2. Add Workspace column to `AtBerthExecutions.jsx` using fetch-on-expand + cache. — **pending (Case B)**
3. Implement header fix Option A or Option B in `Loading.jsx`. — **done: Option A**
4. Update **FUNCTIONAL-SPEC** and **TECH-SPEC** for Case A (§9.1.5 / §2.2.4); two-level list column still to document when Case B ships. — **partial (2026-04-10)**
5. QA scenarios:
   - latest touch in each phase — **pending (Case B)**
   - deletes moving stage backward — **pending (Case B)**
   - sign-off requested priority — **pending (Case B)**
   - first-open header correctness — **addressed by Case A Option A**

---

## 8. Decisions

- **Header fix (Case A):** **Option A** (unknown state until stage load) — **locked and implemented**.
- **At‑Berth list fetch trigger (Case B):** expand-only vs expand + prefetch first N rows — **open**.
- **Priority:** confirm `Sign‑off pending` overrides latest-touch stage (recommended: yes) — **open until Case B**.

