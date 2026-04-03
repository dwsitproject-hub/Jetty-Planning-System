# Jetty Planning System — Feature & Module Summary

This document provides a **detailed assessment and summary of each feature and module** built in the application, for review when turning the project into an actual (production) application.

---

## Latest Update (2026-03-27)

The original sections below contain historical mockup notes. The following items describe current implemented behavior:

- **Port assignment and scope**
  - Port assignment is managed in **Admin User Management** (add/edit user with multi-port checkbox selection).
  - Login/access is port-scoped:
    - 0 assigned ports -> blocked access with message:
      - `No port assigned, please contact Jetty Planning System Admin`
    - 1 assigned port -> auto-select.
    - >1 assigned ports -> user must select port before entering operational pages.
  - Header includes a port switcher for multi-port users.
  - Selected port persistence is **session only**.
  - Operational modules are filtered/scoped by selected port globally; Admin/Master are excluded from this restriction.

- **Clearance module**
  - Verification uses API-backed data (`operations` / `operation-documents`), not mock-only state.
  - Depart flow is **CAST Off only** (HOSE removed).
  - Upload evidence is persisted and shown in SAILED read-only view.
  - Table includes status chips, filters/sort, and expandable vessel details.

---

## 1. Project overview

| Aspect | Description |
|--------|-------------|
| **Purpose** | Web-based Jetty Planning System (JPS) for CPO Downstream Jetty Operations: planning, allocation, at-berth execution, clearance, and reporting. |
| **Current state** | **Frontend-only mockup.** All data is in-memory; no persistent backend or database. Reload clears or resets data. |
| **Tech stack** | React 18, Vite 5, React Router 6. CSS with design tokens (KPN Downstream); no UI component library. |
| **Run** | `npm install` → `npm run dev` (localhost:5173); or `docker-compose up --build` (localhost:3001). |

**To become an actual application**, the following will be needed (not implemented today):

- Backend API (REST or equivalent) and database for all entities.
- Authentication and session management.
- Enforcement of RBAC (Admin defines roles/permissions; today only the Admin UI exists, no route or field guards).
- Replacement of in-memory data stores with API calls.
- File upload/storage for documents, photos, and reports (currently mock or object URLs).

---

## 2. Application structure

### 2.1 Routes (App.jsx)

| Path | Page | Purpose |
|------|------|--------|
| `/` | Dashboard | Command center: pipeline, at-berth summary, metrics, quick links. |
| `/shipping-instruction` | ShippingInstruction | List/filter SI; links to approval and view. |
| `/shipping-instruction/approval/:siId` | SIApproval | Approve or reject an SI; upload docs; sign-off. |
| `/shipping-instruction/view/:siId` | SIView | Read-only SI document view (approved Loading / Unloading). |
| `/allocation`, `/berthing` | Allocation | Line-up plan, 72h slots, jetty schematic, NOR/berthing events. |
| `/at-berth` | AtBerthExecutions | List of vessels at berth by phase; link to Loading/Unloading. |
| `/loading`, `/loading/:vesselId`, `/loading/:vesselId/:section` | Loading | Loading operations: list → vessel detail (Pre-Checking, Operational, Post-Checking). |
| `/unloading`, `/unloading/:vesselId`, `/unloading/:vesselId/:section` | Loading | Same component as Loading; purpose = Unloading. |
| `/quality` | Quality | CPO analysis: Loading vs Discharge (FFA, DOBI, IV). |
| `/verification` | Verification | Clearance: list vessels ready to sail / sailed; record hose-off, cast-off, documents, photos. |
| `/reporting` | Reporting | Menu of reports (cards). |
| `/reporting/daily-activities` | DailyActivitiesReport | Daily activities report: filters, table, Excel export. |
| `/reporting/vessel` | VesselReport | Jetty–vessel report: filters, table, Excel export. |
| `/master` | Master | Master menu (Port, Jetty, Jetty Layout). |
| `/master/port` | MasterPort | CRUD ports. |
| `/master/jetty` | MasterJetty | CRUD jetties per port. |
| `/master/jetty-layout` | MasterJettyLayout | Per-port jetty schematic layout (columns, top/middle/bottom slots). |
| `/admin` | Admin | Admin menu (Users, Roles, Departments). |
| `/admin/users` | AdminUsers | User list; add/edit user (departments, roles). |
| `/admin/roles` | AdminRoles | Role list; add/edit role + permission matrix (Department, Page, Field + View/Edit/Delete). |
| `/admin/departments` | AdminDepartments | Department CRUD; activate/deactivate. |

### 2.2 Layout and global UI

- **Layout.jsx**: Top bar (logo, “Mockup” label), sidebar navigation (all main sections including Admin), main content area, **Activity Log panel** (collapsible, right side).
- **Activity Log**: Shown on every page **except** Reporting. One log per page (filtered by `pageKey`); shows add/update/delete actions for that page. Implemented via `ActivityLogContext` and `ActivityLogPanel.jsx`.
- **ErrorBoundary**: Wraps the app for React error handling (if used at root).

### 2.3 Contexts (global state)

| Context | Role |
|---------|------|
| **LoadingProvider** | Holds loading/unloading step data per vessel (A1–C2), operational activities, pre-checking and post-checking sections. Used by Dashboard, Allocation, At-Berth, Loading page, Daily Activities report. |
| **ClearanceProvider** | Holds clearance state per vessel (hose-off, cast-off, documents, photos, departed). Used by Verification and reports. |
| **ActivityLogProvider** | Holds activity entries (pageKey, action, entityType, entityLabel, details). Used by Layout for Activity Log panel; pages call `logActivity` (e.g. Master Port/Jetty/Jetty Layout). |

---

## 3. Feature / module summaries

### 3.1 Dashboard

- **File**: `pages/Dashboard.jsx`
- **Data**: `mockData` (vessels, upcomingQueue, painPointTracker, dashboardMetrics, dashboardWeather, dashboardClearance, getAtBerthOperations, allocationPlan, nominations).
- **Behaviour**:
  - Pipeline stages (SI → Allocation → At-Berth → Clearance) with counts and links.
  - Live line-up: at-berth vessels with phase (Pre-Checking / Operational / Post-Checking) from LoadingContext.
  - Active vessel detail and pain point tracker.
  - Upcoming queue; weather; KPIs (e.g. berth occupancy, avg pumping rate).
  - Quick links to At-Berth, Allocation, Clearance, Shipping Instruction.
- **For production**: Replace mockData with API; optional real-time updates.

---

### 3.2 Shipping Instruction (SI)

- **List** (`ShippingInstruction.jsx`): Table of nominations/SI with filters (purpose, status), ETA, vessel, product, etc. Actions: Request Approval, View, Approve (links to approval or view by `siId`). Create New SI is feature-flagged off (`SHOW_CREATE_NEW = false`).
- **Approval** (`SIApproval.jsx`): Single SI by `siId`; lifecycle steps; approve/reject with comments; certification checkbox; upload manual docs; Approve & Sign-off generates a document number and can redirect. Reads from `nominations` (mockData).
- **View** (`SIView.jsx`): Read-only SI document (approved Loading or Unloading). Form-style layout with company header, SI number, dates, parties, commodity, quantity, etc. Uses same `nominations` data.
- **Data**: All from `mockData` (nominations, SURVEYOR_OPTIONS, AGENT_OPTIONS, SHIPPER_OPTIONS, LOADING_PORT_OPTIONS, BERTH_IDS). No persistence.
- **For production**: SI CRUD and workflow APIs; document generation and storage; real status transitions and audit.

---

### 3.3 Allocation & Berthing

- **File**: `pages/Allocation.jsx`
- **Data**: `mockData` (allocationPlan, BERTH_IDS, berths, vessels, ALLOCATION_EVENTS, BERTHING_EVENTS, setArrivalNor); `LoadingContext` (getSteps, getLoadingPhaseIndex); `masterData` (getJettyLayout, getJettiesByPort) for schematic.
- **Behaviour**:
  - **Jetty schematic**: Visual grid of jetties (from Master Jetty Layout); shows vessel/status per slot; optional berth selection.
  - **72-hour slot grid**: Time slots (e.g. 6h each); plan lines show ETB/ETA and sequence (Active, Berthing, Expected).
  - **Line-up table**: Plan rows with vessel, jetty, ETA/ETB, priority, sequence; reorder (up/down); arrival/NOR and berthing events (POB, ALL FAST, SOB) via modals or inline.
  - Unified flow links: Shipping Instruction → Allocation → Berthing → Pre Checking → Operational → Post Checking → Clearance.
- **For production**: Allocation and berthing persisted via API; events and NOR stored; schematic driven by master data from backend.

---

### 3.4 At-Berth Executions

- **File**: `pages/AtBerthExecutions.jsx`
- **Data**: `getAtBerthOperations('Loading' | 'Unloading')` from mockData; `LoadingContext.getSteps`, `getLoadingPhaseIndex` for phase label.
- **Behaviour**:
  - Summary by purpose (Loading / Unloading) and phase (Pre-Checking, Operational, Post-Checking) with counts.
  - Filter by purpose (All / Loading / Unloading).
  - Table: Vessel, SI, Purpose, Current phase; sortable/filterable; each row links to `/loading/:vesselId` or `/unloading/:vesselId`.
- **For production**: Source “at-berth” list from backend; phases can remain from LoadingContext or be stored server-side.

---

### 3.5 Loading / Unloading

- **File**: `pages/Loading.jsx` (single component; purpose derived from path `/loading` vs `/unloading`).
- **Routes**: `/loading`, `/loading/:vesselId`, `/loading/:vesselId/:section` (and same for `/unloading`).
- **Data**: mockData (vessels, getAtBerthOperations, LOADING_STEP_IDS, LOADING_STEPS_CONFIG, initialLoadingStepsByVesselId, getLoadingOperationCargo, LOADING_ACTIVITY_CATEGORIES, UNLOADING_ACTIVITY_CATEGORIES, getArrivalNor, setArrivalNor, defaultPreCheckingSection, defaultPostCheckingSection); LoadingContext (getSteps, setStepData, getLoadingOperation, addLoadingActivity, updateLoadingActivity, deleteLoadingActivity, getPreChecking, setPreCheckingSection, getPostChecking, setPostCheckingSection).
- **Behaviour**:
  - **List** (no vesselId): List of Loading or Unloading operations; link to vessel detail.
  - **Vessel detail** (vesselId): Purpose banner; sections: **Pre-Checking** (A1, A2, A3: survey, quality, quantity; documents/photos); **Operational** (B: cargo loading, activities with category, start/end time, add/edit/delete); **Post-Checking** (C1, C2: final quality/quantity). Step status and timestamps; document upload (mock: object URLs). When C1 and C2 are done, link to Clearance. Cargo summary from mockData.
- **For production**: Steps, activities, and pre/post sections persisted; file upload to server; integration with allocation and clearance.

---

### 3.6 Quality

- **File**: `pages/Quality.jsx`
- **Data**: `mockData.qualityComparison` (loading: FFA, DOBI, IV; discharge: same).
- **Behaviour**: Single card: “CPO Analysis — Loading vs Discharge” table (Parameter, Loading Quality, Discharge Quality, Δ). Note about future upload.
- **For production**: Quality data from backend; real upload and comparison logic.

---

### 3.7 Clearance (Verification)

- **File**: `pages/Verification.jsx`
- **Data**: `getAtBerthOperations` (mockData); `ClearanceContext` (clearanceByVesselId, getClearance, setClearance).
- **Behaviour**:
  - List of at-berth vessels with SI, purpose, status (“Ready to Sail” / “Sailed”). Filter and sort.
  - Per-vessel modal: Hose-off time, Cast-off time, document upload, vessel photo upload; “Mark as Sailed” sets departed in ClearanceContext.
- **For production**: Clearance records and file storage in backend; optional integration with dry certificate / tank status.

---

### 3.8 Reporting

- **Menu** (`Reporting.jsx`): Two report cards — Daily Activities Report, Jetty – Vessel Report.
- **Daily Activities Report** (`DailyActivitiesReport.jsx`):
  - Filters: date range, vessels (multi-select), jetties (multi-select). “Apply” builds report from allocationPlan, getAtBerthOperations, getSteps, getPreChecking, getPostChecking, getClearance, getLoadingOperationCargo, getArrivalNor, getBerthingEvents (mockData + contexts).
  - Table: header fields (jetty, vessel, commodity, quantity, stowage, load/disch port, shipper, consignee, surveyor, agent) and timelog/loading progress.
  - Export to Excel via `dailyActivitiesReportExcel.js` (client-side build).
- **Jetty – Vessel Report** (`VesselReport.jsx`):
  - Filters: date range, jetties (multi-select). Builds from `jettyVesselReportData.buildJettyVesselReport` (allocationPlan, getLoadingOperationCargo, getBerthingEvents, getClearance).
  - Table: jetty, vessel, ETA, arrival, ETB, berthed, sailed off, commodity, quantity, stowage, load/disch port, shipper, consignee, surveyor, agent. Sort and filter. Export to Excel via `jettyVesselReportExcel.js`.
- **For production**: Reports run server-side or via report API; Excel generation on server; filter by real persisted data.

---

### 3.9 Master data

- **Master menu** (`Master.jsx`): Three cards — Port, Jetty, Jetty Layout.
- **Master – Port** (`MasterPort.jsx`): Table of ports; Add / Edit modal (name, description). Data: `masterData` (getPorts, addPort, updatePort). Activity log: logActivity on add/update.
- **Master – Port** (`MasterPort.jsx`): Table of ports; Add / Edit modal (name, description). User-to-port assignment is no longer handled here.
- **Master – Jetty** (`MasterJetty.jsx`): Table of jetties (port, order no, name, description); Add / Edit modal (port, order, name, description). Data: `masterData` (getPorts, getJetties, addJetty, updateJetty). Activity log on add/update.
- **Master – Jetty Layout** (`MasterJettyLayout.jsx`): Select port; set number of columns; per-column slots: Top (jetty/unused), Middle (block/unused), Bottom (jetty/unused). Use default layout; Save layout. Data: `masterData` (getPorts, getJettiesByPort, getJettyLayout, setJettyLayout, buildDefaultJettyLayout). Activity log on save.
- **Persistence**: All in-memory in `Frontend/src/data/masterData.js` (ports, jetties, jettyLayoutsByPortId). Used by Allocation (JettySchematic) and by JettySchematic component.
- **For production**: CRUD APIs and DB for ports, jetties, and layout; Allocation and schematic read from backend.

---

### 3.10 Admin (User management & RBAC)

- **Admin home** (`Admin.jsx`): Three cards — User Management, Role Management, Department Management.
- **Department Management** (`AdminDepartments.jsx`):
  - Table: Name, Code, Status (Active/Inactive), Actions (Edit, Deactivate/Activate). Add Department modal (name, code, active). Deactivate warns if users are assigned. Data: `departmentsData.js` (getDepartments, getActiveDepartments, addDepartment, updateDepartment). Seeded: Industrial - Jetty Operation (IJO), Industrial - Quality Control (IQC), PPIC.
- **Role Management** (`AdminRoles.jsx`):
  - List: Role name, description, # users, permission summary; Add Role / Edit. Role edit: tabs — **Basic** (name, description); **Departments** (table: each department × View/Edit/Delete checkboxes); **Pages** (table: each page × View/Edit/Delete); **Fields** (per-page fields for Loading and Verification: View/Edit). Data: `rolesData.js` (getRoles, getRoleById, addRole, updateRole, getPermission, setPermission; PAGE_OPTIONS, FIELD_OPTIONS_BY_PAGE). Roles and permissions in-memory only.
- **User Management** (`AdminUsers.jsx`):
  - Table: User, Email, Departments, Roles, Status, Edit. Add/Edit user modal: username, display name, email, departments (multi-select), roles (multi-select), active. Data: `usersData.js` (getUsers, addUser, updateUser); departments from departmentsData; roles from rolesData. User–department and user–role assignment in-memory only.
- **RBAC granularity**: Department → Page → Field, with View / Edit / Delete. **Not enforced** in the app yet (no route guards or field-level checks); only the configuration UI exists.
- **For production**: Backend for users, departments, roles, and permissions; authentication; middleware or hooks to enforce permissions on routes and fields.

---

## 4. Shared components and assets

- **JettySchematic** (`components/JettySchematic.jsx`): Renders jetty grid from master layout (getJettyLayout, getJettyById); shows berth id, vessel, LOAD/DISCH. Used in Allocation. Uses `mockData.berths` and `vessels`; optional `onSelectBerth`.
- **ActivityLogPanel** (`components/ActivityLogPanel.jsx`): Collapsible right panel; filter by action (All/Add/Update/Delete); shows entries from `getActivitiesForPage(pageKey)`. Styled in `activity-log.css`.
- **DropdownMultiSelect**: Used in reports for vessel/jetty filters.
- **ErrorBoundary**: Catches React errors (if mounted).
- **Design tokens**: `Assets/design-tokens.json` → `design-tokens.css` (colors, typography, spacing, radius, shadow). Other CSS: app.css, allocation.css, modal.css, dashboard.css, shipping-instruction.css, si-approval.css, si-view.css, jetty-schematic.css, admin.css, activity-log.css, etc.

---

## 5. Data layer summary

| Source | Purpose |
|--------|---------|
| **mockData.js** | Vessels, berths, nominations, allocation plan, at-berth operations, loading steps/config, activities, arrival/NOR, berthing events, quality comparison, dashboard metrics/weather/clearance, tank levels, line-up, palka mock, report inputs. Mutating helpers: setArrivalNor, setBerthingEvents. |
| **masterData.js** | Ports, jetties, jetty layout per port. CRUD for ports and jetties; getJettyLayout, setJettyLayout, buildDefaultJettyLayout. |
| **departmentsData.js** | Departments (id, name, code, isActive). getDepartments, getActiveDepartments, getDepartmentById, addDepartment, updateDepartment. Seeded: 3 departments. |
| **rolesData.js** | Roles (id, name, description, isSystemRole, permissions[]). Permissions: resourceType (department/page/field), resourceKey, view, edit, delete. getRoles, getRoleById, addRole, updateRole, getPermission, setPermission. PAGE_OPTIONS, FIELD_OPTIONS_BY_PAGE. |
| **usersData.js** | Users (id, username, displayName, email, isActive, departmentIds[], roleIds[]). getUsers, getUserById, addUser, updateUser, countUsersByDepartmentId, countUsersByRoleId. |
| **reportData.js** | buildDailyActivitiesReport (and related) for Daily Activities report. |
| **jettyVesselReportData.js** | buildJettyVesselReport for Vessel report. |
| **dailyActivitiesReportExcel.js** | Download Daily Activities as Excel (client-side). |
| **jettyVesselReportExcel.js** | Download Jetty–Vessel report as Excel (client-side). |

All of the above are **in-memory**; no API calls or persistence.

---

## 6. What to do next (turning into an actual application)

1. **Backend**: Add REST (or other) API and database; define entities (users, departments, roles, permissions, ports, jetties, layouts, nominations/SI, allocation plan, berthing/arrival events, loading steps/activities, clearance, reports).
2. **Auth**: Login/session; pass token or session to API; optional SSO.
3. **Replace data layer**: Swap each `getX` / `addX` / `updateX` usage to API calls; keep the same UI and context shapes where possible.
4. **RBAC enforcement**: Use role/permission from backend; hide nav and disable routes for unauthorized pages; enforce field-level read/edit where required.
5. **File storage**: Upload documents and photos to server; store URLs in clearance/SI/loading steps; serve report Excel from server or generate server-side.
6. **Reporting**: Run report logic server-side with filters; optionally queue long-running reports.
7. **Activity log**: Persist activities in DB; optionally restrict to admin or per-tenant.

This document is the single reference for **what exists today** and **what each feature does**, so you can review module-by-module and plan the transition to a production application.
