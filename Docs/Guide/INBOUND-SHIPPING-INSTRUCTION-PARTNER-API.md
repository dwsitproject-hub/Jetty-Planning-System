# Inbound Shipping Instruction Partner API Guide

## 1) Purpose

This guide defines the machine-to-machine API contract for external partners to push Shipping Instructions into JPS.

- Base URL: `https://<your-domain>/api/v1/integrations`
- Content type: `application/json`
- Auth: HMAC signature per partner
- Scope: create/update (upsert) and status sync by external id

---

## 2) Security model

Each partner gets:

- `partner_id` (public identifier)
- `partner_secret` (shared secret, private)
- allowed `port_id` list
- optional source IP allowlist

Required headers on every request:

- `X-Partner-Id`
- `X-Timestamp` (UTC ISO8601)
- `X-Nonce` (unique random string)
- `X-Signature` (hex HMAC SHA256)

Timestamp window:

- Max clock skew: +/- 300 seconds

Replay protection:

- Nonce must be unique per `partner_id` within TTL window (recommended TTL 10 minutes)

Rate limit:

- Recommended: per partner, for example 120 requests/minute

---

## 3) Signature contract

Signature algorithm:

- `HMAC-SHA256`
- output encoding: lowercase hex

Signing string format:

`{METHOD}\n{PATH}\n{TIMESTAMP}\n{NONCE}\n{RAW_BODY}`

Where:

- `METHOD` is uppercase (for example `POST`)
- `PATH` is absolute API path only (for example `/api/v1/integrations/shipping-instructions`)
- `TIMESTAMP` exactly equals `X-Timestamp`
- `NONCE` exactly equals `X-Nonce`
- `RAW_BODY` is exact JSON bytes sent by partner (no reformatting)

Verification rules:

1. Check partner exists and active
2. Check timestamp inside allowed window
3. Check nonce not reused
4. Recompute HMAC from raw request body
5. Compare signature using constant-time compare
6. Mark nonce as used (only after passing checks)

---

## 4) Endpoint: Create/Upsert Shipping Instruction

### 4.1 Request

- Method: `POST`
- URL: `/shipping-instructions`

Headers:

- `Content-Type: application/json`
- `X-Partner-Id: ERP_A`
- `X-Timestamp: 2026-04-23T08:25:31Z`
- `X-Nonce: 6fffc6e2-b5a4-428f-aa4f-e7f09a507768`
- `X-Signature: <hex-hmac>`

Body:

```json
{
  "source_system": "ERP_A",
  "external_instruction_id": "SI-EXT-20260423-0001",
  "port_id": 3,
  "mode": "upsert",
  "submitted_at": "2026-04-23T08:20:00Z",
  "shipping_instruction": {
    "reference_number": "SI/2026/04/0001",
    "vessel_name": "MV NUSANTARA",
    "voyage_no": "VY-8891",
    "purpose": "Loading",
    "eta_from": "2026-04-26",
    "eta_to": "2026-04-28",
    "document_date": "2026-04-23",
    "trade_term_id": 2,
    "preferred_jetty_id": 7,
    "shipper_id": 4,
    "loading_port_id": 3,
    "surveyor_id": 5,
    "agent_id": 6,
    "destination_text": "Surabaya",
    "freight_terms": "PREPAID",
    "bill_of_lading_clause": "Clean on board",
    "consignee_text": "PT Example Consignee",
    "notify_party_text": "PT Example Notify",
    "bl_split_text": "3/3 originals",
    "bl_indicated": "As instructed",
    "note": "Auto pushed by ERP"
  },
  "breakdown": [
    {
      "line_no": 1,
      "commodity_id": 11,
      "metric_id": 2,
      "qty": 25000,
      "contract_no": "CTR-7788",
      "po_no": "PO-1010",
      "remarks": "Main lot",
      "shipper_text": "PT Example Shipper"
    }
  ]
}
```

### 4.2 Field rules

Top-level:

- `source_system`: required, string, max 50
- `external_instruction_id`: required, string, max 100, unique per source system
- `port_id`: required, integer, must be in partner allowed ports
- `mode`: optional, `upsert` or `create_only` (default `upsert`)

`shipping_instruction`:

- `reference_number`: required, non-empty string
- `vessel_name`: required, non-empty string
- `purpose`: required, `Loading` or `Unloading`
- `eta_from`: required, `YYYY-MM-DD`
- `eta_to`: required, `YYYY-MM-DD`
- `document_date`: required, `YYYY-MM-DD`
- `freight_terms` (if provided): `PREPAID`, `COLLECT`, `AS_PER_CHARTER_PARTY`, `OTHER`

`breakdown`:

- required, non-empty array
- each line requires `commodity_id`, `metric_id`, `qty >= 0`
- all commodities in one SI must have the same commodity type (`Solid` or `Liquid`)

Reference validation:

- provided IDs must be active and valid in JPS master data

### 4.3 Idempotency and upsert behavior

Uniqueness key:

- `(source_system, external_instruction_id)`

Behavior:

- `create_only`: create new only, return conflict if already exists
- `upsert`: create if not exists, update if exists and mutable

State lock:

- If existing SI is in non-mutable state by policy, return conflict (`STATE_LOCKED`)

### 4.4 Responses

Created:

- HTTP `201`

Upsert update or same payload:

- HTTP `200`

Success body:

```json
{
  "success": true,
  "action": "created",
  "source_system": "ERP_A",
  "external_instruction_id": "SI-EXT-20260423-0001",
  "jps_shipping_instruction_id": 1289,
  "reference_number": "SI/2026/04/0001",
  "status": "Draft",
  "purpose": "Loading",
  "port_id": 3,
  "received_at": "2026-04-23T08:25:32.441Z"
}
```

`action` values:

- `created`
- `updated`
- `unchanged`

---

## 5) Endpoint: Get sync status by external id

### 5.1 Request

- Method: `GET`
- URL: `/shipping-instructions/{source_system}/{external_instruction_id}`
- Auth headers: same as section 2
- Signature uses empty raw body

### 5.2 Response (200)

```json
{
  "success": true,
  "source_system": "ERP_A",
  "external_instruction_id": "SI-EXT-20260423-0001",
  "found": true,
  "jps_shipping_instruction_id": 1289,
  "reference_number": "SI/2026/04/0001",
  "status": "Draft",
  "purpose": "Loading",
  "port_id": 3,
  "updated_at": "2026-04-23T08:25:32.441Z"
}
```

---

## 6) Error contract

All non-2xx responses return:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "Signature mismatch",
    "details": null
  },
  "request_id": "req_01HXYZABC123",
  "timestamp": "2026-04-23T08:25:32.441Z"
}
```

Recommended error codes:

- `UNKNOWN_PARTNER` -> 401
- `INVALID_SIGNATURE` -> 401
- `TIMESTAMP_EXPIRED` -> 401
- `NONCE_REPLAY` -> 409
- `FORBIDDEN_PORT_SCOPE` -> 403
- `VALIDATION_ERROR` -> 400
- `REFERENCE_NOT_FOUND` -> 400
- `CONFLICT_CREATE_ONLY` -> 409
- `STATE_LOCKED` -> 409
- `RATE_LIMITED` -> 429
- `INTERNAL_ERROR` -> 500

---

## 7) Partner onboarding checklist

Use this checklist before production go-live.

### 7.1 Commercial and ownership

- [ ] Partner name and owner team confirmed
- [ ] JPS internal owner assigned
- [ ] Data ownership and correction flow agreed
- [ ] SLA and support contact channel agreed

### 7.2 Security

- [ ] `partner_id` and strong `partner_secret` generated
- [ ] Secret shared via secure channel only
- [ ] Secret rotation policy agreed (recommended every 90 days)
- [ ] Partner source IP allowlist configured (if used)
- [ ] Allowed `port_id` scope configured
- [ ] Partner clock sync validated (NTP)

### 7.3 Contract and payload mapping

- [ ] `source_system` and `external_instruction_id` convention agreed
- [ ] Purpose mapping validated (`Loading` / `Unloading`)
- [ ] Master id mapping validated (`commodity_id`, `metric_id`, etc.)
- [ ] Optional field behavior agreed (null vs empty)
- [ ] Error handling and retry strategy agreed

### 7.4 Testing

- [ ] Happy path tested (new SI)
- [ ] Idempotency tested (resend same payload)
- [ ] Upsert update tested (changed payload)
- [ ] Invalid signature tested
- [ ] Expired timestamp tested
- [ ] Nonce replay tested
- [ ] Forbidden port tested
- [ ] Invalid master reference tested

### 7.5 Production readiness

- [ ] Rate limit configured and communicated
- [ ] Monitoring dashboard and alerts active
- [ ] Request/response audit logging verified
- [ ] Runbook for incident and key rotation documented
- [ ] Go-live signoff completed

---

## 8) Postman collection sample

Example Postman v2.1 collection (minimal) for partner testing.

```json
{
  "info": {
    "name": "JPS Partner Inbound SI API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "baseUrl", "value": "https://jps.example.com" },
    { "key": "partnerId", "value": "ERP_A" },
    { "key": "partnerSecret", "value": "replace-with-secret" },
    { "key": "timestamp", "value": "" },
    { "key": "nonce", "value": "" },
    { "key": "signature", "value": "" },
    { "key": "sourceSystem", "value": "ERP_A" },
    { "key": "externalInstructionId", "value": "SI-EXT-20260423-0001" }
  ],
  "item": [
    {
      "name": "Create or Upsert SI",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "X-Partner-Id", "value": "{{partnerId}}" },
          { "key": "X-Timestamp", "value": "{{timestamp}}" },
          { "key": "X-Nonce", "value": "{{nonce}}" },
          { "key": "X-Signature", "value": "{{signature}}" }
        ],
        "url": "{{baseUrl}}/api/v1/integrations/shipping-instructions",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"source_system\": \"{{sourceSystem}}\",\n  \"external_instruction_id\": \"{{externalInstructionId}}\",\n  \"port_id\": 3,\n  \"mode\": \"upsert\",\n  \"shipping_instruction\": {\n    \"reference_number\": \"SI/2026/04/0001\",\n    \"vessel_name\": \"MV NUSANTARA\",\n    \"purpose\": \"Loading\",\n    \"eta_from\": \"2026-04-26\",\n    \"eta_to\": \"2026-04-28\",\n    \"document_date\": \"2026-04-23\"\n  },\n  \"breakdown\": [\n    {\n      \"line_no\": 1,\n      \"commodity_id\": 11,\n      \"metric_id\": 2,\n      \"qty\": 25000\n    }\n  ]\n}"
        }
      }
    },
    {
      "name": "Get SI by External ID",
      "request": {
        "method": "GET",
        "header": [
          { "key": "X-Partner-Id", "value": "{{partnerId}}" },
          { "key": "X-Timestamp", "value": "{{timestamp}}" },
          { "key": "X-Nonce", "value": "{{nonce}}" },
          { "key": "X-Signature", "value": "{{signature}}" }
        ],
        "url": "{{baseUrl}}/api/v1/integrations/shipping-instructions/{{sourceSystem}}/{{externalInstructionId}}"
      }
    }
  ]
}
```

### 8.1 Postman pre-request script (sample)

Use this script per request to auto-set `timestamp`, `nonce`, and `signature`.

```javascript
const partnerSecret = pm.environment.get("partnerSecret");
const method = pm.request.method.toUpperCase();
const path = pm.request.url.getPathWithQuery();
const timestamp = new Date().toISOString();
const nonce = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
const rawBody = pm.request.body && pm.request.body.mode === "raw" ? pm.request.body.raw : "";

const signingString = `${method}\n${path}\n${timestamp}\n${nonce}\n${rawBody}`;
const signature = CryptoJS.HmacSHA256(signingString, partnerSecret).toString(CryptoJS.enc.Hex);

pm.environment.set("timestamp", timestamp);
pm.environment.set("nonce", nonce);
pm.environment.set("signature", signature);
```

---

## 9) Exact signature verification pseudo-code

### 9.1 JPS side (Node.js pseudo-code)

```javascript
import crypto from "crypto";

function verifyInboundSignature(req, partner) {
  const partnerId = req.get("X-Partner-Id");
  const ts = req.get("X-Timestamp");
  const nonce = req.get("X-Nonce");
  const sig = req.get("X-Signature");

  if (!partnerId || !ts || !nonce || !sig) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Missing auth headers" };
  }

  // 1) Partner lookup
  if (!partner || !partner.active) {
    return { ok: false, code: "UNKNOWN_PARTNER", message: "Unknown partner" };
  }

  // 2) Timestamp validation
  const nowMs = Date.now();
  const tsMs = Date.parse(ts);
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > 300000) {
    return { ok: false, code: "TIMESTAMP_EXPIRED", message: "Timestamp outside allowed window" };
  }

  // 3) Nonce replay check
  if (nonceStore.has(partnerId, nonce)) {
    return { ok: false, code: "NONCE_REPLAY", message: "Nonce already used" };
  }

  // 4) Build signing string using RAW body bytes captured by raw-body middleware
  const method = req.method.toUpperCase();
  const path = req.originalUrl.split("?")[0] + (req.url.includes("?") ? "?" + req.url.split("?")[1] : "");
  const rawBody = req.rawBody || "";
  const signingString = `${method}\n${path}\n${ts}\n${nonce}\n${rawBody}`;

  // 5) Compute expected signature
  const expected = crypto
    .createHmac("sha256", partner.secret)
    .update(signingString, "utf8")
    .digest("hex");

  // 6) Constant-time compare
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(sig).toLowerCase(), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "INVALID_SIGNATURE", message: "Signature mismatch" };
  }

  // 7) Mark nonce used only after successful validation
  nonceStore.put(partnerId, nonce, 600); // ttl in seconds

  return { ok: true };
}
```

Implementation note:

- Keep raw request body before JSON parsing so signature uses exact payload bytes.

### 9.2 Partner side (Node.js example)

```javascript
import crypto from "crypto";

function signRequest({ method, path, timestamp, nonce, rawBody, secret }) {
  const signingString = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${rawBody}`;
  return crypto.createHmac("sha256", secret).update(signingString, "utf8").digest("hex");
}
```

### 9.3 Partner side (Python example)

```python
import hmac
import hashlib

def sign_request(method, path, timestamp, nonce, raw_body, secret):
    signing_string = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{raw_body}"
    return hmac.new(
        secret.encode("utf-8"),
        signing_string.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
```

---

## 10) Operational recommendations

- Use dedicated integration database tables for partner credentials, nonce cache, and external id mapping
- Always include `request_id` in logs and API responses
- Store payload hash to support replay and dispute tracing
- Add alerting for spikes in `INVALID_SIGNATURE` and `NONCE_REPLAY`
- Define retry policy for partners:
  - Retry only `5xx` and `429`
  - Do not retry `4xx` validation/auth errors without correction

---

## 11) Versioning

- Document version: `1.0`
- Date: `2026-04-23`
- Owner: JPS Backend/API Team

