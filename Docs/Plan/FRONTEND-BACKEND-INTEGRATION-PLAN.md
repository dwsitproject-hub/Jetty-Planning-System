# Frontend ↔ Backend integration plan

**Goal:** Replace `Frontend/src/data/mockData.js` usage **feature by feature**. After each step you can manually verify that page against the live API (and add automated tests later if you want).

**Prerequisite stack:** `Backend` Docker (`jps-api` :3000, `jps-db` :5433). Frontend preferred: **`cd Frontend && npm run dev`** (typically :5173). Root compatibility command `npm run dev` still works.

**CORS:** In `Backend/.env`, set `CORS_ORIGIN=http://localhost:5173` (add `,http://localhost:3001` if you use root Docker nginx).

**Env file:** `Frontend/.env` (same folder as `Frontend/vite.config.js`). Set `VITE_API_BASE_URL=http://localhost:3000/api/v1`.

---

## Slice 0 — API shell ✅

| Item | Action |
|------|--------|
| Env | `Frontend/.env`: `VITE_API_BASE_URL=http://localhost:3000/api/v1` |
| Code | `Frontend/src/api/client.js` — `apiGet` / `apiPost` / `apiPut` / `apiDelete`, `getHealth`, `ping`, optional `Authorization` from `localStorage.jps_token` |
| Test | **Master → Port** page shows “API: health + /ping OK” when Backend + CORS are correct |

**Done when:** Master Port loads and status line shows both checks OK (Network tab shows `/health` and `/api/v1/ping`).

---

## Feature 1 — Master: Ports ✅

| Pages | `MasterPort.jsx` |
| APIs | `GET/POST/PUT /ports` via `Frontend/src/api/ports.js` |
| Mock | Master Port no longer uses in-memory `masterData` ports for this page |

**Test checklist**

1. List loads from API (empty DB = empty list OK).
2. Create port → appears in list after refresh or optimistic update.
3. Edit port → persists after reload.

---

## Feature 2 — Master: Jetties ✅

| Pages | `MasterJetty.jsx`, `MasterJettyLayout.jsx` (as applicable) |
| APIs | `GET/POST/PUT /jetties`, `GET /ports` (for dropdowns) |
| Mock | `berths`, jetty names tied to mock ports |

**Test checklist**

1. Jetties list from API; port filter / port name from joined data.
2. Create jetty (valid `port_id`) → success.
3. Jetty schematic/layout: either map API jetty ids to UI or defer layout until data model matches.

---

## Feature 3 — SLA config & standard rates (optional early)

| Pages | Often buried in Master or settings — or skip until Loading needs SLA |
| APIs | `GET/PUT /sla-config`, `GET/POST/PUT /standard-rates` |
| Test | Read/write round-trip; required before trusting SLA on operations |

---

## Feature 4 — Shipping instructions (SI) ✅

| Pages | `ShippingInstruction.jsx`, `SIView.jsx`, `SIApproval.jsx` |
| APIs | `GET/POST/PUT /shipping-instructions` |
| Mock | `nominations`, SI fields |

**Test checklist**

1. List SIs from API.
2. Create SI → new row with backend `id` (use **numeric id** in routes, not mock string ids).
3. Open SI view / approval using **URL param = real id**.

**Note:** Approve persists `PUT /shipping-instructions/:id` with `status: Approved`.

---

## Feature 5 — Operations & allocation / berthing

| Pages | `Allocation.jsx`, `JettySchematic.jsx` (partial) |
| APIs | `GET /operations`, `POST /operations`, `PUT /operations/:id`, `POST .../start-docking`, `POST .../recalculate-sla` |
| Mock | `allocationPlan`, `ALLOCATION_EVENTS`, `BERTHING_EVENTS`, `vessels`/`berths` for labels |

**Data model shift:** UI today uses **`vesselId`** (mock). Backend uses **`operation.id`** + **`shippingInstructionId`**. Plan:

- Table rows keyed by **`operation.id`** (or SI + jetty).
- Display `vesselName` / `referenceNumber` from SI join (API already returns some).

**Test checklist**

1. Create operation: `shipping_instruction_id` + `jetty_id` → 201.
2. List/filter operations on Allocation page.
3. Start docking → status `DOCKED`, SLA fields populated.
4. Deep links to Loading: prefer **`/loading/:operationId`** (or map vessel label → operation id).

---

## Feature 6 — At berth ✅

| Pages | `AtBerthExecutions.jsx` |
| APIs | `GET /operations/at-berth` |
| Mock | `getAtBerthOperations` |

**Test checklist**

1. Only operations in DOCKED / IN_PROGRESS / COMPLETED show (per API).
2. After start-docking, vessel appears; after `depart` (Phase 5), disappears from at-berth.

---

## Feature 7 — Loading / Unloading (operation-centric) ✅ (primary: `LoadingOperation.jsx`)

| Pages | `LoadingOperation.jsx` at `/loading/operation/:operationId`; `Loading.jsx` mock flow retained |
| APIs | `GET /operations/:id`, `GET/POST .../materials`, `GET/POST .../qc-surveys`, `PUT /qc-surveys/:id`, `GET/POST .../quantity-checks`, `PUT /quantity-checks/:id`, `PUT /operations/:id` (`completion_percent`) |

**Test checklist**

1. Open loading for a real **operation id** → header shows vessel/jetty from API.
2. Add/list materials.
3. QC + quantity CRUD persists; reload page shows same data.

---

## Feature 8 — Verification (clearance) ✅

| Pages | `Verification.jsx` (API depart; `ClearanceContext` optional for legacy) |
| APIs | `POST .../signoff`, `depart`, `request-exception`, `approve-exception`, `reject-exception` |
| Mock | `getAtBerthOperations`, local clearance state |

**Test checklist**

1. Exception path: request → approve → signoff → depart → **SAILED**.
2. Normal path: 100% + QC/qty rules → signoff → depart.
3. Errors from API shown in UI (400 messages).

---

## Feature 9 — Dashboard ✅ (API KPIs + mock weather/queue)

| Pages | `Dashboard.jsx` |
| APIs | Compose from `GET /operations`, `GET /operations/at-berth`, counts; later `GET /dashboard/summary` if implemented |
| Mock | `allocationPlan`, `dashboardMetrics`, weather, clearance snapshot |

**Test checklist**

1. KPIs match rough counts from API (vessels at berth, etc.).
2. No hard dependency on mock `allocationPlan` for main cards.

---

## Feature 10 — Reporting

| Pages | `Reporting.jsx`, `DailyActivitiesReport.jsx`, `VesselReport.jsx` |
| APIs | Mostly `GET /operations` + SI filters; may keep derived client-side until report APIs exist |

**Test checklist**

1. Vessel/report dropdowns fed from API operations + SIs.
2. Export or print still works with live data shape.

---

## Feature 11 — Quality

| Pages | `Quality.jsx` |
| APIs | TBD (backend may not have CPO upload yet) — integrate when endpoint exists, or keep partial mock |

---

## Feature 12 — Admin (users, roles) — Users ✅

| Pages | `AdminUsers.jsx` (API); `AdminRoles.jsx`, `AdminDepartments.jsx` still mock/local |
| APIs | `POST /auth/login`, `GET /users/me`, `GET/POST/PUT /users` (+ roles when exposed) |
| Test | Login → token → users list; RBAC may block routes once middleware is on |

---

## Testing style (per feature)

| Type | What to do |
|------|------------|
| **Manual (fastest)** | Checklist above + browser Network tab (no 4xx/5xx on happy path). |
| **API-only** | curl/Postman same endpoints the page uses. |
| **Automated later** | Vitest: mock `fetch` for `client.js`; or Playwright one flow per feature. |

---

## Suggested order (dependencies)

```
0 → 1 → 2 → (3) → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12
        ↑ SLA before heavy Loading/SLA display if you show ETA
```

Start **Slice 0**, then **Feature 1**. Stop after each feature until its checklist passes.

---

## Doc maintenance

Update this file when:

- A new backend route is added for a page.
- You rename routes (e.g. `operationId` in URL).
