# SLA Email Notifications — Setup Guide

This guide explains how to configure and schedule **SLA email notifications** in Jetty Planning System (JPS):

| Notification | When it fires | Event key |
|---|---|---|
| **D-1 ETC reminder** | Calendar day before ETC for vessels at berth (port timezone) | `operation.sla_etc_d1` |
| **Daily SLA breach alert** | Once per port-local calendar day while ETC is overdue | `operation.sla_etc_breach` |

No user login is required for delivery. A **cron job** evaluates SLA rules and queues notifications; the **backend API** sends queued email in the background.

Related deployment context: [STAGING-3-SERVER-DEPLOY-RUNBOOK.md](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md) §8.

---

## How it works

```
┌─────────────────┐     queue rows      ┌──────────────────────────┐
│  Cron / Task    │ ──────────────────► │  notification_deliveries │
│  Scheduler      │   (in-app + email)  │  (status: queued)        │
└─────────────────┘                     └────────────┬─────────────┘
        │                                            │
        │ run-sla-notifications.js                   │ polled ~every 20s
        │ (--mode=d1 | breach)                       ▼
        │                                 ┌──────────────────────────┐
        │                                 │  Backend API process     │
        │                                 │  notification-email-     │
        │                                 │  worker → SMTP send      │
        └────────────────────────────────►└──────────────────────────┘
```

| Component | Runs where | Purpose |
|---|---|---|
| `scripts/run-sla-notifications.js` | Host cron / Task Scheduler | Find eligible vessels, resolve recipients, queue notifications |
| `notification-email-worker` | Inside `npm run dev` / API container | Send queued email via SMTP |
| Admin UI | `/admin/notifications` | SMTP, event toggles, recipients |
| Email Delivery Log | `/admin/notifications/email-log` | Sent / failed / skipped / queued status |

The SLA job uses a PostgreSQL advisory lock so overlapping cron runs on one host do not double-process.

---

## Prerequisites

### 1. Database migrations

Apply migrations **093** and **094** on the target database:

```bash
cd Backend
npm run migrate
```

Migration **093** creates `notification_event_settings`, `notification_event_recipients`, `smtp_config`, and SLA email/in-app templates.  
Migration **094** allows the same user recipient on multiple ports.

### 2. Backend API running

The email worker starts automatically with the API (`Backend/src/index.js`). If the API is stopped, notifications are still **queued** but email is not sent until the API is back up.

### 3. Admin access

Configure notifications under **Admin → Notifications**. Users need the existing **`admin`** page permission (same as other admin sub-pages).

### 4. Valid recipient emails

Each notification recipient must be an active user with a valid email address. Role-based recipients are expanded to users assigned to that role (and port, if scoped).

---

## Step 1 — Configure SMTP (Admin UI)

1. Sign in as an admin user.
2. Open **Admin → Notifications** (`/admin/notifications`).
3. Under **SMTP configuration**, enter:

   | Field | Production example |
   |---|---|
   | Host | `mail.energi-up.com` |
   | Port | `465` |
   | Secure (SSL/TLS) | **On** |
   | Username | `noreply.sys@energi-up.com` |
   | From address | `noreply.sys@energi-up.com` |
   | Enabled | **On** |

4. Click **Save**, then **Send test email** (delivers to your logged-in user’s email).

SMTP passwords are encrypted at rest (AES-256-GCM) using `NOTIFICATION_ENCRYPTION_KEY` or, if unset, `JWT_SECRET`.

### Optional: environment fallback

If database SMTP is disabled, the worker falls back to `SMTP_*` variables in `Backend/.env`:

```env
SMTP_HOST=mail.energi-up.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply.sys@energi-up.com
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply.sys@energi-up.com
SMTP_REJECT_UNAUTHORIZED=true
NOTIFICATION_EMAIL_POLL_MS=20000
```

Prefer the Admin UI in production so operators can rotate credentials without redeploying.

### Email links in notifications

Set the public app URL so “View at berth” links in emails point to the correct host:

```env
APP_PUBLIC_URL=https://jps.example.com
```

If unset, the worker uses the first origin in `CORS_ORIGIN`, then `http://localhost:5173`.

---

## Step 2 — Configure SLA events and recipients

On **Admin → Notifications**:

### Event settings

| Setting | D-1 reminder | Breach alert |
|---|---|---|
| Enabled | Turn on when ready | Turn on when ready |
| In-app | Optional | Optional |
| Email | Recommended **On** | Recommended **On** |
| Include post-signoff breach | N/A (always excluded for D-1) | Off by default; enable if overdue post-signoff vessels should alert |
| Daily send hour | N/A | Default **8** (08:00). Schedule breach cron to match this hour in the port’s local timezone (see § Cron). |

### Recipients

Add one or more recipients per event:

- **User** — select user and one or more ports (multi-port supported after migration 094).
- **Role** — optional port scope; all active users in that role (and port, if set) receive alerts.

If **no recipients** are configured for an event, the system falls back to active users assigned to the vessel’s port.

### Email templates

Each SLA event card includes an **Email template** section where admins can edit the plain-text **subject** and **body** without SQL or redeploy.

| Placeholder | Description |
|---|---|
| `{{vesselName}}` | Vessel name |
| `{{jettyName}}` | Jetty name |
| `{{jettyOperationCode}}` | Operation code |
| `{{planReference}}` | Plan or SI reference |
| `{{portName}}` | Port name |
| `{{etcFormatted}}` | ETC in port timezone |
| `{{overdueFormatted}}` | Breach only — overdue duration (e.g. `+2.5h`) |
| `{{actionUrl}}` | Link to At Berth page |

Use **Preview** to check layout with sample data. **Reset to default** restores the original templates from migration 093. **Send test email** sends a message with sample data to your user email (subject prefixed with `[TEST]`); it uses your current edits even if unsaved. Test sends appear in **Email Delivery Log** under the matching SLA event (status **sent** or **failed**).

Event, recipient, and template changes are recorded in the **Activity Log** on the same page.

---

## Step 3 — Schedule the SLA job (cron)

**Yes — you need a scheduled job** on the backend host to evaluate SLA rules. Sending email does **not** require a separate cron; that is handled by the running API.

### Recommended schedule (Linux crontab)

Adjust the deploy path (`/opt/jetty-planning-system/Backend`) to match your server.

```bash
crontab -e
```

Add:

```cron
# D-1 ETC reminder — every 30 minutes
*/30 * * * * cd /opt/jetty-planning-system/Backend && /usr/bin/node scripts/run-sla-notifications.js --mode=d1 >> /var/log/jps-sla-notifications.log 2>&1

# SLA breach daily alert — 08:00 WIB (01:00 UTC); align with Admin "daily send hour"
0 1 * * * cd /opt/jetty-planning-system/Backend && /usr/bin/node scripts/run-sla-notifications.js --mode=breach >> /var/log/jps-sla-notifications.log 2>&1
```

**Why every 30 minutes for D-1?** ETC “tomorrow” is evaluated in each port’s `schedule_timezone` (default `Asia/Jakarta`). Frequent runs reduce the risk of missing the reminder window if cron is delayed.

**Why once daily for breach?** Dedup keys include the port-local calendar date (`op:{id}:sla_breach:{YYYY-MM-DD}`), so one run per day per vessel is sufficient. Schedule cron at the hour configured in Admin (default 08:00 local).

Ensure the cron environment can reach Postgres (`DATABASE_URL` or the same `Backend/.env` used by the API).

### Docker backend (host cron)

If the API runs in Docker, run the script from the host with database access:

```cron
*/30 * * * * docker compose --env-file /opt/jetty-planning-system/Backend/.env -f /opt/jetty-planning-system/docker-compose.backend-api-only.yml exec -T jps-api node scripts/run-sla-notifications.js --mode=d1 >> /var/log/jps-sla-notifications.log 2>&1

0 1 * * * docker compose --env-file /opt/jetty-planning-system/Backend/.env -f /opt/jetty-planning-system/docker-compose.backend-api-only.yml exec -T jps-api node scripts/run-sla-notifications.js --mode=breach >> /var/log/jps-sla-notifications.log 2>&1
```

Alternatively, run `node scripts/run-sla-notifications.js` on the host with `DATABASE_URL` pointing at the database (no container exec).

### Windows (development or small installs)

**Manual run:**

```bat
cd Backend
npm run run:sla-notifications
```

Or:

```bat
Backend\scripts\run-sla-notifications.bat --mode=d1
Backend\scripts\run-sla-notifications.bat --mode=breach
Backend\scripts\run-sla-notifications.bat --mode=all
```

**Task Scheduler (optional):** create two tasks that call `run-sla-notifications.bat` with the same intervals as the Linux cron examples above. Set “Start in” to the `Backend` folder and ensure `Backend\.env` contains `DATABASE_URL`.

---

## Step 4 — Verify

### Smoke test (CLI)

From `Backend`:

```bash
npm run test:sla-notifications
```

Requires migrations 093/094 and database connectivity. Runs D-1 and breach jobs once and prints JSON results.

SMTP unit tests:

```bash
npm run test:smtp-config
```

### Admin UI

| Check | Where |
|---|---|
| Job summaries | **Admin → Notifications** → Activity Log |
| Email status | **Admin → Notifications → Email Delivery Log** |
| SMTP | **Send test email** on Notifications page |

Delivery statuses:

| Status | Meaning |
|---|---|
| `queued` | Waiting for email worker |
| `sent` | Delivered via SMTP |
| `failed` | SMTP or template error (see `error_text` in DB or log UI) |
| `skipped` | Email channel off, no SMTP, or invalid recipient |

### Cron log

```bash
tail -f /var/log/jps-sla-notifications.log
```

Each run prints one JSON line per mode, for example:

```json
{"mode":"d1","vessels":2,"notifications":4,"emailQueued":4}
{"mode":"breach","vessels":1,"notifications":2,"emailQueued":2}
```

`"skipped":true,"reason":"lock_not_acquired"` means another run was still holding the advisory lock — usually harmless if schedules overlap.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| No emails at all | SMTP not enabled or API down | Enable SMTP in Admin; ensure API container/process is running |
| Notifications queued, not sent | Worker not running | Restart API; check `NOTIFICATION_EMAIL_POLL_MS` |
| Cron runs, zero vessels | No eligible operations or event disabled | Confirm at-berth ops with ETC; enable event in Admin |
| No recipients | Empty recipient list and no port users | Add recipients in Admin or assign users to the port |
| Duplicate emails same day | Cron running breach mode too often | Run breach **once** per port-local day; dedup should prevent duplicates — check logs |
| Wrong timezone for D-1 | Port missing `schedule_timezone` | Set port schedule timezone in master data (defaults to `Asia/Jakarta`) |
| Test email works, SLA emails fail | Missing email template | Re-run migration 093 or check `notification_templates` for SLA event keys |
| `Missing table notification_event_settings` | Migration not applied | `cd Backend && npm run migrate` |

---

## CLI reference

```bash
# Run both modes
node scripts/run-sla-notifications.js --mode=all

# D-1 only
node scripts/run-sla-notifications.js --mode=d1

# Breach only
node scripts/run-sla-notifications.js --mode=breach
```

npm shortcuts (from `Backend/`):

```bash
npm run run:sla-notifications          # same as --mode=all
npm run test:sla-notifications
npm run test:smtp-config
```

---

## Security notes

- SMTP credentials in the database are encrypted; do not commit `.env` files.
- Only admin users can change SMTP, events, and recipients (`/api/v1/notification-admin/*`).
- Recipient addresses are validated before send to reduce header injection risk.
- Cron runs as a server process with DB access — restrict host access and protect `Backend/.env`.

---

## Quick checklist

- [ ] Migrations **093** and **094** applied
- [ ] Backend API running (email worker active)
- [ ] SMTP configured and test email received
- [ ] SLA events enabled; recipients configured
- [ ] Email templates reviewed (optional customization per event)
- [ ] `APP_PUBLIC_URL` (or `CORS_ORIGIN`) set for production links
- [ ] Cron (or Task Scheduler) for `--mode=d1` every 30 minutes
- [ ] Cron for `--mode=breach` once daily at configured hour
- [ ] Verified via Email Delivery Log and smoke test
