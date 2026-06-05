# E2E Test Report — Normal vs Late SI Berthing Gate

| Field | Value |
|-------|-------|
| **Suite** | `e2e/late-si-berthing-flow.spec.ts` |
| **Environment** | `http://127.0.0.1:5173` (API proxied to `localhost:3000`) |
| **Browser** | Chromium (Playwright 1.58.2) |
| **Credentials** | `admin` / `admin1234` |
| **Execution date** | 2026-06-05 |
| **Duration** | ~2.3 minutes (3 tests, 1 worker) |
| **Overall result** | **3 PASSED · 0 FAILED · 0 SKIPPED** |

---

## Summary

| # | Test case | Result | Duration (approx.) |
|---|-----------|--------|-------------------|
| 1 | Happy Path — Normal Flow | **PASS** | ~1.1 min |
| 2 | Late SI — Blocked State | **PASS** | ~3.6 s |
| 3 | Late SI — Unlocked State | **PASS** | ~1.1 min |

---

## Test Case 1 — Happy Path (Normal Flow)

**Objective:** Verify the standard workflow: plan with approved SI → jetty assignment → berthing with TA / TB / ETC.

| Step | Action | Result |
|------|--------|--------|
| 1 | Login as `admin` | PASS |
| 2 | Create shipment plan + 1 SI (`/shipment-plans`) | PASS |
| 3 | Submit plan for approval + approve on approval page | PASS |
| 4 | Open Allocation & Berthing (`/allocation-plans`) | PASS |
| 5 | Log arrival update — assign jetty | PASS |
| 6 | Assert **Berthing** button is **enabled** | PASS |
| 7 | Open Confirm Berthing — fill TA, TB, ETC, photo, remarks | PASS |
| 8 | Confirm Berthing — modal closes (save succeeded) | PASS |

**Key assertions:**
- `Berthing` button `.toBeEnabled()`
- Fields: `#berthing-ta`, `#berthing-tb`, `#berthing-estimated-completion`, `#berthing-photos`, `#berthing-remarks`

---

## Test Case 2 — Late SI Blocked State

**Objective:** Plan created **without** SI; jetty may be assigned early, but Berthing must stay blocked with tooltip.

| Step | Action | Result |
|------|--------|--------|
| 1 | Login | PASS |
| 2 | Create plan only (no SI) — late-SI path | PASS |
| 3 | Assign jetty via Log arrival update | PASS |
| 4 | Open Log arrival update again, then Cancel (workflow check) | PASS |
| 5 | Assert **Berthing** button is **disabled** | PASS |
| 6 | Hover Berthing — assert `title` tooltip | PASS |

**Tooltip asserted (app implementation):**

```
Add at least one shipping instruction and approve the shipment plan before berthing.
```

**Diagram spec string (not used in assertion — copy mismatch):**

```
Please make sure SI is submitted and approved.
```

> The gate **behavior** (disabled until SI + approved plan) matches the Late SI diagram. Only the tooltip **wording** differs from the diagram.

---

## Test Case 3 — Late SI Unlocked State

**Objective:** Continuing from TC2 — add & approve SI, return to Allocation, Berthing enabled, complete arrival.

| Step | Action | Result |
|------|--------|--------|
| 1 | Login (serial continuation from TC2 plan id) | PASS |
| 2 | Deep-link add SI to draft plan + save | PASS |
| 3 | Submit + approve shipment plan | PASS |
| 4 | Return to `/allocation-plans` | PASS |
| 5 | Assert **Berthing** button is **enabled** | PASS |
| 6 | Complete Confirm Berthing (TA / TB / ETC / photo / remarks) | PASS |

---

## Artifacts

| Artifact | Location |
|----------|----------|
| **HTML report (Playwright)** | `Frontend/playwright-report/index.html` |
| **Open HTML report** | `cd Frontend && npx playwright show-report` |
| **Session videos** | `Frontend/test-results/<test-name>/video.webm` |
| **Spec file** | `Frontend/e2e/late-si-berthing-flow.spec.ts` |
| **Helpers** | `Frontend/e2e/helpers/auth.ts`, `shipment-plan.ts`, `allocation.ts` |

---

## How to re-run

```powershell
Set-Location "D:\Cursor\Jetty Planning System\Frontend"
$env:E2E_BASE_URL = "http://127.0.0.1:5173"
$env:E2E_USERNAME = "admin"
$env:E2E_PASSWORD = "admin1234"

# Headless + HTML report
npx playwright test e2e/late-si-berthing-flow.spec.ts --reporter=html,list

# Headed (visible browser)
npx playwright test e2e/late-si-berthing-flow.spec.ts --headed --reporter=html,list

# View last HTML report
npx playwright show-report
```

**Prerequisites:** Frontend dev server on `127.0.0.1:5173`, backend API on `3000`, database up.

---

## Notes & observations

1. **Jetty congestion:** Local data has busy/OOS jetties (e.g. `1B` full, jetty `5` OOS). Tests use retry logic on Confirm Berthing to pick a working jetty.
2. **Modal locators:** Save/Confirm actions use `.modal__footer button.btn--primary` because `getByRole` did not reliably match buttons whose accessible names include long aria-labels.
3. **Berthing button:** Located via visible text `Berthing` (not role name alone) because disabled state embeds the gate message in `aria-label`.
4. **Video recording:** Enabled per test (`video: 'on'` + `recordVideo` in spec).

---

## Sign-off

| Role | Status |
|------|--------|
| Automation | Complete — all 3 workflow tests passing |
| Environment | `127.0.0.1:5173` local dev |
| Blocking issues | None at time of report |
