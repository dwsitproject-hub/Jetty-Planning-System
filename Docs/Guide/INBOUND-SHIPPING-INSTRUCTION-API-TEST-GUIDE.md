# Inbound Shipping Instruction API — Test Guide

> **Audience:** JPS developers and operators who need to test the partner integration API locally.
> **Hand off to external developers:** Use [INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md) (v3.6) — it includes the full API contract, master data endpoints, **PATCH** while Pending, **staging environment**, and self-service test walkthrough.

---

## 1. What you are testing

You simulate an **external system** (ERP, agency software, etc.) that:

1. **Submits** a Shipping Instruction to JPS (`POST`)
2. **Amends** the instruction while it is still `Pending` (`PATCH`, optional)
3. **Polls** for review status (`GET`)
4. **Observes** the lifecycle: `Pending` → `Approved` / `Rejected` → `Allocated`

The operator review (approve, reject, allocate a jetty) happens in the normal JPS web app — that is how you complete the end-to-end test.

```mermaid
flowchart LR
    tester[You POST via API] --> pending[Status Pending]
    pending --> operator[JPS operator in web app]
    operator -->|Approve| approved[Status Approved]
    operator -->|Reject| rejected[Status Rejected]
    approved -->|Allocate jetty| allocated[Status Allocated]
    approved --> poll[You GET via API]
    allocated --> poll
    rejected --> poll
```

---

## 2. Prerequisites

### 2.1 Backend running

**Docker (recommended):**

```powershell
cd Backend
docker compose up -d --build
```

| Service | URL |
|---------|-----|
| API | `http://localhost:3000` |
| Health check | `http://localhost:3000/api/v1/health` |
| Frontend (optional, for operator steps) | `http://localhost:5173` |

Open the health URL in a browser. You should see JSON like `{ "status": "ok", ... }`.

### 2.2 Database migration

The integration API requires migration `084` (API keys + submission ledger) and related schema. Run once after pulling new code:

```powershell
docker exec jps-api npm run migrate
```

You should see `Applying migration: 084_integration_partner_api.sql` on first run. Later pulls may apply additional migrations — that is normal.

### 2.3 API key

Each test partner needs an API key.

**Option A — CLI (local Docker):**

```powershell
docker exec jps-api node scripts/create-integration-api-key.mjs --partner "MY_TEST"
```

**Option B — JPS Admin UI (if you have admin access):**

Log in → **Admin** → **Partner API Keys** (`/admin/partner-api`) → create a key for your partner name.

The plaintext key is printed **once** (CLI) or shown once in the modal (UI). Copy it immediately — it cannot be retrieved later. Example:

```
jps_live_38e897ef93a27803db551de78b65f333
```

Other useful CLI commands:

```powershell
# List keys (prefix only, not the full secret)
docker exec jps-api node scripts/create-integration-api-key.mjs --list

# Revoke a key
docker exec jps-api node scripts/create-integration-api-key.mjs --deactivate 4
```

Keys are not port-scoped. Partners pass a valid `port_id` on each request. Use `GET /ports` (§4.2) to see valid IDs in your environment — do not assume port `1` is always BONTANG on every database.

### 2.4 Valid master data

Your test payload must use values that exist in JPS master data:

| Field | Rule |
|-------|------|
| `port_id` | Must be a valid JPS port — use `GET /ports` for the live list |
| `cargo[].cargo_type` | Must match a commodity **short_name** (case-insensitive), e.g. `CPO` — use `GET /commodities` for the live list |
| `cargo[].unit` | `MT` or `KL` only |
| `purpose` | `Loading` or `Unloading` |

#### Prefer the API over hard-coded tables

**Recommended:** call `GET /ports` and `GET /commodities` before your first POST (see §4.2). Those endpoints return the master data for your environment.

The static commodity table below is a **snapshot** only. A fresh local dev database may have **fewer** commodities than staging/production until master data is seeded or copied.

#### Commodity mapping snapshot (`cargo_type` → JPS short name)

Send the **JPS short_name** value in `cargo_type`. Full display names are **not** accepted.

| JPS short_name (`cargo_type`) | JPS display name | Type |
|-------------------------------|------------------|------|
| `CG` | CRUDE GLYCERINE | Liquid |
| `CPKO` | CRUDE PALM KERNEL OIL | Liquid |
| `CPO` | CRUDE PALM OIL | Liquid |
| `FAME` | Fatty Acid Methyl Ester | Liquid |
| `INS POME FAD` | INS PALM OIL MILL EFFLUENT FATTY ACID DISTILLATE | Liquid |
| `INS RPOME` | INS REFINED PALM OIL MILL EFFLUENT | Liquid |
| `ISCC POMEPFAD` | ISCC PALM OIL MILL EFFLUENT FATTY ACID DISTILLATE (POMEPFAD) | Liquid |
| `ISCC RPOME` | ISCC REFINED PALM OIL MILL EFFLUENT | Liquid |
| `METHANOL` | METHANOL | Liquid |
| `PFAD` | Palm Fatty Acid Distillate | Liquid |
| `PKE` | Palm Kernel Expeller | Solid |
| `PKM` | Palm Kernel Meal | Solid |
| `PKS` | Palm Kernel Shell | Solid |
| `POME` | Palm Oil Mill Effluent | Liquid |
| `RBD PO` | RBD PO | Liquid |
| `RG` | REFINED GLYCERINE | Liquid |
| `ROL` | Refined Olein | Liquid |
| `RPOME` | REFINED PALM OIL MILL EFFLUENT | Liquid |
| `SPLIT CPKO FA` | SPLIT CRUDE PALM KERNEL OIL FATTY ACID | Liquid |
| `SPLIT RBD PKO FA` | SPLIT RBD PALM KERNEL OIL FATTY ACID | Liquid |

*20 commodities as of a staging snapshot. Use `GET /commodities` for your environment.*

To refresh this list from your database (alternative to the API):

```powershell
docker exec jps-api node -e "import('pg').then(async ({default:pg})=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});const r=await p.query('SELECT short_name, name, commodity_type FROM si_commodities WHERE deleted_at IS NULL ORDER BY short_name');r.rows.forEach(x=>console.log(x.short_name+' | '+x.name+' | '+x.commodity_type));await p.end();})"
```

If you send an unknown `cargo_type`, the API returns `400` with a list of valid short names in `valid_cargo_types` — use that list to fix your payload.

---

## 3. Base URL and auth (local)

| Item | Local value |
|------|-------------|
| Base URL | `http://localhost:3000/api/v1/integrations` |
| Auth header | `x-api-key: jps_live_...` (your key) |
| Content-Type (POST) | `application/json` |

For staging/production, replace the host with your HTTPS domain (see the [partner API guide](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md)).

---

## 4. Test with curl (PowerShell)

curl is built into Windows 10/11. Use `curl.exe` in PowerShell so you do not hit the `Invoke-WebRequest` alias.

### 4.1 Create API key and set variables

**Step 1 — Create a key** (skip if you already have one saved):

```powershell
cd "d:\Cursor\Jetty Planning System\Backend"
docker exec jps-api node scripts/create-integration-api-key.mjs --partner "MY_TEST"
```

Copy the full `jps_live_...` line from the output.

**Step 2 — Set PowerShell variables.** Replace the example below with **your actual key** from step 1:

```powershell
$API_KEY = "jps_live_38e897ef93a27803db551de78b65f333"   # ← paste YOUR key here
$BASE    = "http://localhost:3000/api/v1/integrations"
```

> **Common mistake:** leaving the placeholder `"jps_live_PASTE_YOUR_KEY_HERE"` (or similar) in `$API_KEY` causes `401 INVALID_API_KEY` on every request. The placeholder is not a valid key.

**Quick sanity check** — this must return `"success": true`, not `INVALID_API_KEY`:

```powershell
curl.exe "$BASE/ports" -H "x-api-key: $API_KEY"
```

### 4.2 Test 0 — Fetch master data (expect `200`)

Before submitting, fetch valid ports and commodities for your environment:

```powershell
curl.exe "$BASE/ports" -H "x-api-key: $API_KEY"
curl.exe "$BASE/commodities" -H "x-api-key: $API_KEY"
```

**Check:** both return `"success": true` with a non-empty `data` array. Note a `port_id` (from `data[].id`) and a `short_name` (e.g. `CPO`) for your POST payload in §4.3.

Example ports response:

```json
{ "success": true, "data": [{ "id": 1, "name": "PORT TESTING" }] }
```

Example commodities entry:

```json
{ "id": 3, "short_name": "CPO", "name": "CRUDE PALM OIL", "commodity_type": "Liquid" }
```

### 4.3 Test 1 — Submit a shipping instruction (expect `201`)

Save a sample payload to a file (easier than inline JSON on Windows):

```powershell
@'
{
  "external_reference": "SI-TEST-001",
  "port_id": 1,
  "vessel_name": "MV TEST VESSEL",
  "voyage_no": "VY-001",
  "vessel_loa_m": 180,
  "vessel_gross_tonnage": 30000,
  "vessel_draft": 11.5,
  "purpose": "Loading",
  "eta": "2026-06-20T08:00:00Z",
  "etd": "2026-06-22T18:00:00Z",
  "agent_name": "PT Test Agency",
  "agent_contact": "ops@test.example.com",
  "notes": "My first API test",
  "cargo": [
    {
      "cargo_type": "CPO",
      "description": "Main lot",
      "tonnage": 25000,
      "unit": "MT",
      "contract_no": "CTR-001"
    }
  ]
}
'@ | Set-Content -Path "$env:TEMP\si-test.json" -Encoding UTF8

curl.exe -X POST "$BASE/shipping-instructions" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  --data "@$env:TEMP\si-test.json"
```

**Success response (`201`):**

```json
{
  "success": true,
  "data": {
    "id": 41,
    "external_reference": "SI-TEST-001",
    "status": "Pending",
    "vessel_name": "MV TEST VESSEL",
    "port_id": 1,
    "vessel_loa_m": 180,
    "vessel_gross_tonnage": 30000,
    "vessel_draft": 11.5,
    "vessel_capacity": 25000,
    "vessel_dwt": 55000,
    "received_at": "2026-06-12T08:49:12.525Z"
  }
}
```

**Save the `id`** from `data.id` — you need it for the next step.

> Use a **new** `external_reference` (e.g. `SI-TEST-002`) for each new submission. Reusing the same reference returns `409 DUPLICATE_REFERENCE`.

### 4.4 Test 2 — Check status by id (expect `200`, status `Pending`)

Replace `41` with your id:

```powershell
curl.exe "$BASE/shipping-instructions/41" -H "x-api-key: $API_KEY"
```

### 4.5 Test 3 — Check status by external reference

Useful if you lost the id:

```powershell
curl.exe "$BASE/shipping-instructions?external_reference=SI-TEST-001" -H "x-api-key: $API_KEY"
```

### 4.6 Test 4 — PATCH while Pending (expect `200`)

While status is still `Pending`, amend one or more fields. Only include fields you want to change:

```powershell
curl.exe -X PATCH "$BASE/shipping-instructions/41" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  -d '{ "vessel_name": "MV TEST VESSEL II", "vessel_loa_m": 185 }'
```

Replace `41` with your id from Test 1.

**Success:** `"success": true`, `"status": "Pending"`, updated fields reflected in the response.

Same update by your reference:

```powershell
curl.exe -X PATCH "$BASE/shipping-instructions?external_reference=SI-TEST-001" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  -d '{ "voyage_no": "VY-002" }'
```

**Empty body (expect `400`):** at least one updatable field is required.

**After operator approves/rejects (expect `409 NOT_EDITABLE`):** PATCH is no longer allowed — submit a new instruction with a new `external_reference` if rejected.

### 4.7 Test 5 — Duplicate submission (expect `409`)

Run the same `POST` from Test 1 again without changing `external_reference`:

```powershell
curl.exe -X POST "$BASE/shipping-instructions" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  --data "@$env:TEMP\si-test.json"
```

Expected: `"code": "DUPLICATE_REFERENCE"` and `details.existing_id` pointing to the original submission.

### 4.8 Test 6 — Invalid API key (expect `401`)

```powershell
curl.exe "$BASE/shipping-instructions/41" -H "x-api-key: jps_live_wrong"
```

Expected: `"code": "INVALID_API_KEY"`.

### 4.9 Test 7 — Unknown port (expect `400`)

Copy the JSON file, change `"port_id": 1` to `"port_id": 99` (a port that does not exist), and use a new `external_reference` (e.g. `SI-TEST-003`):

```powershell
curl.exe -X POST "$BASE/shipping-instructions" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  --data "@$env:TEMP\si-bad-port.json"
```

Expected: `"code": "VALIDATION_ERROR"` with an `unknown port` issue in `details`.

### 4.9 Test 7 — Unknown cargo type (expect `400`)

Use `"cargo_type": "FAKE_CARGO"` and a new `external_reference`:

Expected: `"code": "VALIDATION_ERROR"` with `valid_cargo_types` in `details`.

---

## 5. Test with Postman (visual)

Postman is a free desktop app for building and saving HTTP requests without typing curl.

### 5.1 Install and setup

1. Download from [postman.com/downloads](https://www.postman.com/downloads/).
2. Create a **Collection** named `JPS Integration API`.
3. Open the collection → **Variables** tab:

| Variable | Initial value |
|----------|---------------|
| `baseUrl` | `http://localhost:3000/api/v1/integrations` |
| `apiKey` | paste your real `jps_live_...` key (not a placeholder) |
| `siId` | leave empty; fill after first POST |

### 5.2 Request: Get ports

| Setting | Value |
|---------|-------|
| Method | `GET` |
| URL | `{{baseUrl}}/ports` |
| Headers | `x-api-key`: `{{apiKey}}` |

### 5.3 Request: Get commodities

| Setting | Value |
|---------|-------|
| Method | `GET` |
| URL | `{{baseUrl}}/commodities` |
| Headers | `x-api-key`: `{{apiKey}}` |

### 5.4 Request: Submit shipping instruction

| Setting | Value |
|---------|-------|
| Method | `POST` |
| URL | `{{baseUrl}}/shipping-instructions` |
| Headers | `x-api-key`: `{{apiKey}}`, `Content-Type`: `application/json` |
| Body | raw → JSON — paste the sample from §4.3 |

Click **Send**. Status should be `201 Created`. Copy `data.id` into the collection variable `siId`.

### 5.5 Request: Get status by id

| Setting | Value |
|---------|-------|
| Method | `GET` |
| URL | `{{baseUrl}}/shipping-instructions/{{siId}}` |
| Headers | `x-api-key`: `{{apiKey}}` |

Click **Send**. Status should be `200 OK`, `"status": "Pending"`.

### 5.6 Request: Get status by external reference

| Setting | Value |
|---------|-------|
| Method | `GET` |
| URL | `{{baseUrl}}/shipping-instructions?external_reference=SI-TEST-001` |
| Headers | `x-api-key`: `{{apiKey}}` |

Duplicate these requests in the collection to build a reusable test suite for your team.

---

## 6. Simulate the operator side (full lifecycle)

The API only submits and reads status. To see `Approved` or `Allocated`, an operator must act in JPS:

| Step | Where | Action |
|------|-------|--------|
| 1 | API (`GET`) | Fetch `GET /ports` and `GET /commodities` for valid `port_id` and `cargo_type` |
| 2 | API (`POST`) | Submit instruction → status `Pending` |
| 2b | API (`PATCH`) | Optional — amend fields while still `Pending` |
| 3 | JPS web app | Log in → **Shipment plans** (`/shipment-plans`) |
| 4 | JPS web app | Find your vessel or **External reference** column |
| 5 | JPS web app | Open approval → **Approve** or **Reject** (`/shipment-plans/approval/:planId`) |
| 6 | API (`GET`) | Confirm status is `Approved` or `Rejected` |
| 7 | JPS web app | If approved → **Allocation & Berthing** → assign jetty |
| 8 | API (`GET`) | Confirm status is `Allocated` and `allocation.jetty_name` is set |

### Expected status after each stage

| Stage | GET `status` | Notable fields |
|-------|--------------|----------------|
| Just submitted | `Pending` | `allocation: null`, `rejection_reason: null` |
| Operator approved | `Approved` | `allocation: null` |
| Jetty assigned | `Allocated` | `allocation.jetty_name`, `allocation.planned_berthing_time` |
| Operator rejected | `Rejected` | `rejection_reason` populated |

Poll every few minutes in real integrations — operator review is a human process, not instant.

---

## 7. Reading responses

### Success envelope

```json
{ "success": true, "data": { ... } }
```

### Error envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Payload validation failed",
    "details": [ { "field": "eta", "issue": "required" } ]
  },
  "request_id": "req_abc123"
}
```

Always note `request_id` when reporting failures — it helps trace the request in server logs.

### HTTP status reference

| HTTP | Error code | Meaning |
|------|------------|---------|
| `201` | — | Instruction created |
| `200` | — | Status retrieved or instruction updated (`PATCH`) |
| `400` | `VALIDATION_ERROR` | Fix the JSON payload |
| `401` | `INVALID_API_KEY` | Missing or wrong `x-api-key` |
| `404` | `NOT_FOUND` | Unknown id or reference (or not yours) |
| `409` | `DUPLICATE_REFERENCE` | Same `external_reference` already submitted |
| `409` | `NOT_EDITABLE` | PATCH when status is not `Pending` |
| `429` | `RATE_LIMITED` | Over 120 requests/minute — wait and retry |
| `500` | `INTERNAL_ERROR` | Server error — retry with backoff |

---

## 8. First-session checklist

- [ ] Backend up — `http://localhost:3000/api/v1/health` returns OK
- [ ] Migration `084` applied — `docker exec jps-api npm run migrate`
- [ ] API key created and saved — `create-integration-api-key.mjs`
- [ ] `GET /ports` and `GET /commodities` → `200` with master data
- [ ] `POST` with valid payload → `201`, status `Pending`, note the `id`
- [ ] `PATCH` by id while Pending → `200`, fields updated
- [ ] `PATCH` by `external_reference` while Pending → `200`
- [ ] `GET` by id → `200`, status `Pending`
- [ ] Duplicate `POST` → `409 DUPLICATE_REFERENCE`
- [ ] Bad key → `401 INVALID_API_KEY`
- [ ] Plan visible in JPS web app (Shipment Plans / approval)
- [ ] Approve in UI → `GET` shows `Approved`
- [ ] Allocate jetty in UI → `GET` shows `Allocated`

---

## 9. Common mistakes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 INVALID_API_KEY` on all requests | Placeholder left in `$API_KEY` (e.g. `PASTE_YOUR_KEY`) | Paste the real `jps_live_...` key from key creation output |
| `401 INVALID_API_KEY` | Missing/wrong header | Add `-H "x-api-key: jps_live_..."`; create a new key if lost |
| `401` after code deploy | Old API container image | `docker compose up -d --build` in `Backend/` (see §10) |
| `400` unknown port | `port_id` not in JPS | Run `GET /ports` and use a returned `id` |
| `400` unknown cargo | Typo in `cargo_type` or full name instead of short code | Run `GET /commodities`; use `short_name`, not `name` |
| `409 NOT_EDITABLE` on PATCH | Instruction no longer `Pending` | Only amend while awaiting review; POST new reference if rejected |
| `409 DUPLICATE_REFERENCE` | Reused `external_reference` | Change to a new reference for each test |
| Status stuck on `Pending` | No operator action yet | Approve/reject in JPS web app |
| Status never `Allocated` | No jetty assigned | Complete allocation in JPS after approval |
| Connection refused | API not running | `docker compose up -d` in `Backend/` |

---

## 10. Troubleshooting

### API container not starting after code changes

Rebuild and restart (required if your container was built from an image without a live `src` volume mount):

```powershell
cd Backend
docker compose up -d --build
docker exec jps-api npm run migrate
```

If `GET /ports` returns `Authentication required` (session auth error) instead of the integration envelope, the running container likely has **old code** — rebuild as above.

### Check API logs

```powershell
docker logs jps-api --tail 50
```

### Verify integration tables exist

```powershell
docker exec jps-api node -e "import('pg').then(async ({default:pg})=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});const r=await p.query(`SELECT to_regclass('integration_api_keys'), to_regclass('integration_submissions')`);console.log(r.rows[0]);await p.end();})"
```

Both columns should show table names, not `null`.

---

## 11. Related files

| File | Purpose |
|------|---------|
| [INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md) | Full API contract for external partners (v3.6) |
| [Backend/scripts/create-integration-api-key.mjs](../../Backend/scripts/create-integration-api-key.mjs) | Create/list/revoke API keys (CLI) |
| [Backend/src/routes/integration-admin.js](../../Backend/src/routes/integration-admin.js) | Admin API for Partner API Keys UI |
| [Backend/src/routes/integrations.js](../../Backend/src/routes/integrations.js) | Partner route implementation |
| [Backend/migrations/084_integration_partner_api.sql](../../Backend/migrations/084_integration_partner_api.sql) | Integration API keys + submission ledger |
| [Backend/migrations/085_shipment_plan_integration_source.sql](../../Backend/migrations/085_shipment_plan_integration_source.sql) | Plan `external_reference` / `requested_by` columns |

---

## Document history

| Version | Date | Notes |
|---------|------|-------|
| 1.4 | 2026-08-12 | PATCH tests while Pending; `NOT_EDITABLE`; partner doc v3.6. |
| 1.3 | 2026-08-12 | Clearer API key setup (avoid placeholder); master data via GET; Admin UI; operator UI paths; Postman ports/commodities. |
| 1.2 | 2026-08-11 | Master data tests: `GET /ports`, `GET /commodities`; partner doc v3.5. |
| 1.1 | 2026-08-11 | Optional vessel fields in sample payload (`vessel_loa_m`, `vessel_gross_tonnage`, `vessel_draft`); partner doc v3.4. |
| 1.0 | 2026-06-12 | Initial test guide: curl, Postman, operator lifecycle, checklist |
