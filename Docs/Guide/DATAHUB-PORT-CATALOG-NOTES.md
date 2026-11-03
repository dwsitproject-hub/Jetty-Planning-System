# DataHub port_master — catalog notes

**Purpose:** JPS Master – Port ↔ DHM `port_master` (pull → review → apply only in v1; no JPS→DHM push).

**Probe:** from `Backend/` with credentials in env:

```bash
node scripts/probe-datahub-catalog.mjs
```

## Contract baseline ([DATAHUB_CLIENT_INTEGRATION.md](./DATAHUB_CLIENT_INTEGRATION.md))

| DHM field | JPS `ports` column | Sync apply | Master – Port UI |
| --- | --- | --- | --- |
| `code` | `hub_code` | Yes | Hub Code (read-only) |
| `name` | `name` | Yes | Yes |
| `unlocode` | `unlocode` | Yes | Yes |
| `country` | `country` | Yes | Yes |
| `is_active` | `is_active` | Yes | Yes (inactive still listed on master grid) |
| `site_id` | `hub_site_id` | Yes if present | Hidden |

**JPS-local only (never from hub diff):** `description`, `schedule_timezone`, `operational_day_start`, `allow_multi_jetty_berthing`, ATG tuning columns.

**Hierarchy:** DHM expects `organization → site → port_master`. JPS does not model org/site; `site_id` is stored on apply when the hub sends it.

**Webhook:** subscribe `record.updated` for entity type **`port_master`** (confirm delivery payload in staging).

## Live probe output

Run `node scripts/probe-datahub-catalog.mjs` after allowlist includes `port_master` and paste summarized `fieldKeys` + one sync sample below.

<!-- Append live probe JSON summaries here after staging run -->

## Troubleshooting sync

| Symptom | Cause | Fix |
| --- | --- | --- |
| `DataHub HTTP 403: Application is not permitted to call 'port_master'` | JPS key pair is not allowlisted for `port_master` on that DHM host | DHM integrator: enable **port_master** on the same integration as your Admin → DataHub public key. Re-run **Test connection** (should show `port_master` field count). |
| Browser **502** on `POST …/ports/datahub/sync/runs` | JPS wraps upstream DHM failure (often the 403 above) | Fix allowlist first; message body includes `hint`. |
| Browser **404** on `GET …/ports/datahub/sync/runs` | API build without port sync routes, or wrong backend on port 3000 | Local: ensure only **Docker `jps-api`** serves 3000 (`docker ps --filter name=jps-api`). Redeploy staging API if UI is not local. Logged-in GET should return `[]` or a JSON array, not HTML 404. |
