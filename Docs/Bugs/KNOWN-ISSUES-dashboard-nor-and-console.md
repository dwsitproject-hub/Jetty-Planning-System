# Known issues: Dashboard, NOR endpoint, and browser console

This note records behaviours that are **not** the Final Tank Inspection / Post-Checking time-range `400` (that case is addressed in `Frontend/src/pages/Loading.jsx` Post-Checking `saveSection`: explicit start/end must not reuse a stale `dateTime` for `endAt`).

---

## 1. Dashboard: `ReferenceError: PHASES is not defined`

**Symptoms:** Dashboard crashes on load; console points at `empty()` inside a `useMemo` or at a `PHASES.map(...)`.

**Cause:** The at-berth summary cards were refactored from a constant `PHASES` to `AT_BERTH_SUMMARY_PHASES`. A **partial** rename (some references still using `PHASES`) or a **stale Vite bundle** can trigger this.

**What to check:**

- In `Frontend/src/pages/Dashboard.jsx`, all summary-card logic should use `AT_BERTH_SUMMARY_PHASES`, not `PHASES`.
- Restart the dev server and hard-refresh the browser (`Ctrl+Shift+R`).

**Resolution (code):** Ensure there are **no** remaining `PHASES` references in `Dashboard.jsx` for the at-berth summary.

---

## 3. Browser console / Network tab shows `nor_accepted` while debugging Final Tank Inspection

**Symptoms:** User is saving **Final Tank Inspection** (`final_tank_inspection`) but the console or Network list still shows a failed request to `.../sub-processes/nor_accepted`.

**Cause:** The list is **historical**: a previous request failed and remains visible; or another tab / background refresh hit NOR. Final Tank uses a different path: `.../sub-processes/final_tank_inspection`.

**What to do:** Filter Network by `final_tank_inspection` (or the current sub-process key) to see the request that matches the action you just took.

---

## 4. NOR Accepted sub-process: `500 Internal Server Error`

**Symptoms:** `PUT` or save to `/api/v1/operations/:id/sub-processes/nor_accepted` returns **500**.

**Scope:** Separate from Post-Checking / final tank. Typical causes already addressed elsewhere include:

- **`operation_sub_processes` time check:** `end_at >= start_at` when both are set — mismatched tendered vs accepted times can violate the constraint (backend may map this to **400** after error-handler updates).
- **Invalid payload** (e.g. JSON / DB constraint).

**What to do:**

- Inspect **server logs** for the real PostgreSQL or stack trace.
- Confirm NOR form sends **start/end** (or single instant) consistently; see `Loading.jsx` NOR Accepted save path and `Backend/src/routes/operation-sub-processes.js`.

---

## Related files

| Area | File(s) |
|------|--------|
| Post-Checking save (Final Tank, etc.) | `Frontend/src/pages/Loading.jsx` (`PostCheckingSections` / `saveSection`) |
| Sub-process upsert + time validation | `Backend/src/routes/operation-sub-processes.js` |
| Dashboard at-berth summary cards | `Frontend/src/pages/Dashboard.jsx` |
