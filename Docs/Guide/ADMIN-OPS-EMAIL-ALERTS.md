# System Health Dashboard — unhealthy email alerts

Email **`it-project@energi-up.com`** when any System Health Dashboard check **newly becomes unhealthy**. Sending is controlled only by the **dashboard checkbox** — works on staging or production when enabled.

## Dashboard toggle

1. Open **Admin → System Health Dashboard** (`/admin/operations`).
2. Enable **Email alerts when a check becomes unhealthy**.
3. If unticked, no alert emails are sent (cron still updates state).

Requires SMTP configured under **Admin → Notifications** on that server.

## Setup (staging or production)

### 1. Migration

```bash
cd Backend && npm run migrate
```

### 2. SMTP

Configure SMTP under **Admin → Notifications** (same as SLA emails).

### 3. Enable toggle

On the System Health Dashboard, tick **Email alerts when a check becomes unhealthy**.

### 4. Cron (every 15 minutes)

On the API host:

```cron
*/15 * * * * cd /opt/jetty-planning-system/Backend && npm run run:admin-ops-alerts >> /var/log/jps-admin-ops-alerts.log 2>&1
```

Docker-only Node:

```cron
*/15 * * * * cd /opt/jetty-planning-system && docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run run:admin-ops-alerts >> /var/log/jps-admin-ops-alerts.log 2>&1
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
| healthy / degraded / unknown → **unhealthy** | Yes (if toggle on + SMTP configured) |
| unhealthy → unhealthy | No (same incident) |
| First cron run (no prior state) | No (seed only) |
| Recovery to healthy | No recovery email |

Checks: ATG sync, ATG data purging, Synology upload mount, DataHub API, Partner Integration API.

## Related

- [SYNOLOGY-MOUNT-TROUBLESHOOTING-AND-RECOVERY.md §10](./SYNOLOGY-MOUNT-TROUBLESHOOTING-AND-RECOVERY.md) — mount cron + dashboard
- [SLA-EMAIL-NOTIFICATIONS-SETUP.md](./SLA-EMAIL-NOTIFICATIONS-SETUP.md) — SMTP configuration
