# System Health Dashboard — unhealthy email alerts

Email when a System Health check **newly becomes unhealthy** (not when it is only **degraded**). Recipients are configurable per check; **ATG sync** is one alert unit **per working port**.

## Where to configure

1. Open **Admin → Notifications** (`/admin/notifications`) and expand **System health email alerts** (anchor `#system-health`).
2. Enable **Enable system health email alerts**.
3. Set **Default alert email** (fallback when a row has no specific address).
4. Optionally set **Recipient email** on each row (ATG sync has one row per port).

The **System Health Dashboard** (`/admin/operations`) shows read-only alert status and links here.

Requires SMTP configured on the same **Admin → Notifications** page.

## Setup (staging or production)

### 1. Migration

Includes `admin_ops_alert_recipients` (migration **156**):

```bash
cd Backend && npm run migrate
```

Docker API host after deploy:

```bash
cd /opt/jetty-planning-system && docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
```

### 2. SMTP

Configure SMTP under **Admin → Notifications** (same as SLA / workflow emails).

### 3. Enable alerts and recipients

Use the **System health email alerts** panel on **Admin → Notifications**.

### 4. Cron (every 15 minutes)

On the API host (ECS-DB example):

```cron
*/15 * * * * cd /opt/jetty-planning-system && docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run run:admin-ops-alerts >> /var/log/jps-admin-ops-alerts.log 2>&1
```

Bare Node on host:

```cron
*/15 * * * * cd /opt/jetty-planning-system/Backend && npm run run:admin-ops-alerts >> /var/log/jps-admin-ops-alerts.log 2>&1
```

### 5. Verify

```bash
cd Backend
npm run run:admin-ops-alerts -- --dry-run
tail -20 /var/log/jps-admin-ops-alerts.log
```

## Alert rules

| Transition | Email |
|------------|-------|
| healthy / degraded / unknown → **unhealthy** | Yes (if enabled + SMTP configured) |
| unhealthy → unhealthy | No (same incident) |
| First cron run (no prior state) | No (seed only) |
| Recovery to healthy | No recovery email |
| **degraded** only | No |

**ATG sync:** each port is unhealthy when **all** enabled ATG sources for that port are stale; email goes to that port’s recipient or the default.

**Other checks:** one unit each (Synology mount, ATG purge, DataHub, Partner API, etc.).

Emails for multiple units in one cron tick are **grouped by recipient** (one email per address when possible).

Default fallback address when a row is blank: **it-project@energi-up.com** (overridable via default email field).

## Related

- [SYNOLOGY-MOUNT-TROUBLESHOOTING-AND-RECOVERY.md §10](./SYNOLOGY-MOUNT-TROUBLESHOOTING-AND-RECOVERY.md) — mount cron + dashboard
- [SLA-EMAIL-NOTIFICATIONS-SETUP.md](./SLA-EMAIL-NOTIFICATIONS-SETUP.md) — SMTP configuration