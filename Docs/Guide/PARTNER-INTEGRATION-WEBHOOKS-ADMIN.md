# Partner integrations — Admin guide (API keys & webhooks)

**Audience:** JPS administrators with **Admin** page permission.

**Related:** Partner self-service contract — [INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md) (v5.4). TECH-SPEC **§0.37**, **§0.42**.

---

## Where to open it

**Admin → Partner integrations** (`/admin/partner-api`).

Layout:

1. **Partners (left)** — select a registered integration key (EOS, KLIP, etc.).
2. **Credentials (right)** — masked key prefix, active/revoked, last used, **Revoke key**.
3. **Webhooks** — outbound URLs JPS POSTs to when plans are approved, berthing milestones change, or the **Cargo Operations operation window** is saved (**`schedule.updated`**, v5.4 includes **`cargo_ops_start_at`** / partner ATS in the payload).

Partners can register the same webhooks via **`POST /api/v1/integrations/webhooks`** with their **`x-api-key`**. Admin UI is for onboarding and support when the partner cannot call the API.

---

## Register a webhook (admin)

1. Select the partner key.
2. **Add webhook**.
3. Enter **HTTP or HTTPS URL** (internal apps often use plain HTTP).
4. Choose events: **All events (`*`)**, **`status.changed`**, and/or **`schedule.updated`**.
5. Copy the **webhook secret** when shown — it is displayed **once** (HMAC verification on the partner side).

Limits: **3 active** endpoints per API key (same as partner API).

---

## Deliveries

Click **Deliveries** on a webhook row to inspect recent outbound attempts:

| Column | Meaning |
|--------|---------|
| Delivery ID | Dedupe key (`X-JPS-Delivery-Id` on the partner request) |
| Event | `status.changed` or `schedule.updated` |
| Reference | Partner `external_reference` |
| Status | `pending`, `sent`, or `failed` |
| Payload | Expand to view JSON sent to the partner |

**Retry** re-queues a **failed** delivery for the in-process webhook worker.

---

## Document links (v5.1)

Partners may send HTTPS links on submit:

- `shipping_instruction_document_url`
- `contract_document_url`
- `bl_document_url`

JPS stores URLs on the shipping instruction; operators see **Partner document links** in the SI detail modal (read-only). JPS does not download or mirror partner files.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Deliveries stuck `pending` | API process running; webhook worker started in `Backend/src/index.js` |
| Repeated `failed` | Partner URL down, TLS issues, or non-2xx/timeout (>15s) |
| Invalid URL on create | Must be valid **HTTP or HTTPS** URL |
| Partner locked out | Key revoked — create a new key and share plaintext once |

For signature verification and event shapes, point partners to **§3.4–3.6** of the partner API guide.

---

## Schedule milestones (internal mapping, v5.4)

Partners map industry labels to fields in webhook/GET **`data.schedule`**:

| Partner label | JPS field | Operator source (summary) |
|---------------|-----------|---------------------------|
| ATA | `ta` | Arrival / TA |
| ATB | `tb` | Berthing |
| ATS | **`cargo_ops_start_at`** | **Cargo Operations → Operation Window → Start** (`cargo_operations` activity) |
| ATC | `cast_off_at` | Cast off / sailed |

**`schedule.updated`** fires when these schedule fields change from operator saves (including Cargo Operations window create/update/delete — not load-segment-only edits).
