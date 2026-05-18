# Purge transactional data (production / staging reset)

Use this when you need an **empty vessel-call dataset** while keeping **master data**, **users**, and **RBAC**.

**This is not a migration.** Nothing runs this on deploy or `npm run migrate`.

\---

## What gets deleted

|Area|Tables (hard delete via `TRUNCATE`)|
|-|-|
|Shipment plan|`shipment\_plans`, `shipping\_instructions`, `shipping\_instruction\_breakdown`, `shipping\_instruction\_documents`|
|Allocation|`operations`, `operation\_nor\_details`, `jetty\_operation\_code\_counters` (+ plan/SI rows above)|
|At-berth (pre / ops / post)|`operation\_sub\_processes`, `operation\_sub\_process\_documents`, `operation\_operational\_activities`, `operation\_cargo\_load\_lines`, `qc\_\*`, `quantity\_checks`, `operation\_materials`|
|Clearance|Cleared with `operations` / plan rows; `operation\_documents`, sign-off notification rows|

**Kept:** `ports`, `jetties`, `si\_\*` masters, `users`, `roles`, `permissions`, `schema\_migrations`, etc.

**Not deleted by SQL:** files under the API `UPLOAD\_DIR` (clear manually if needed).

**Script:** `Backend/scripts/purge-transactional-data.sql`  
**Wrapper (confirmation required):** `Backend/scripts/run-purge-transactional-data.sh`

\---

## Backend server (Alicloud / Docker) — recommended

SSH to the **backend** host (API + `jps-db`), then:

```bash
cd /opt/jetty-planning-system
git pull   # ensure purge scripts exist on the server

chmod +x Backend/scripts/run-purge-transactional-data.sh
bash Backend/scripts/run-purge-transactional-data.sh
```

When prompted, type **`PURGE`** (all caps).

### One-liner (after `git pull`, same confirmation script)

```bash
cd /opt/jetty-planning-system \&\& bash Backend/scripts/run-purge-transactional-data.sh
```

### Manual `psql` (no `PURGE` prompt — use only if you accept the risk)

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db \\
  psql -v ON\_ERROR\_STOP=1 -U jps\_user -d jps\_db \\
  < Backend/scripts/purge-transactional-data.sql
```

Adjust `jps\_user` / `jps\_db` if your `Backend/.env` uses different `POSTGRES\_USER` / `POSTGRES\_DB`.

\---

## SSH from your PC (jump through app server)

If you only SSH to the **app** server and the backend is private:

```bash
ssh root@<APP\_PUBLIC\_IP>
ssh root@<BACKEND\_PRIVATE\_IP>
cd /opt/jetty-planning-system
bash Backend/scripts/run-purge-transactional-data.sh
```

Or one jump (OpenSSH):

```bash
ssh -t root@<APP\_PUBLIC\_IP> "ssh -t root@<BACKEND\_PRIVATE\_IP> 'cd /opt/jetty-planning-system \&\& bash Backend/scripts/run-purge-transactional-data.sh'"
```

\---

## Local dev (Backend `docker-compose`)

From repo root:

```bash
cd Backend
bash scripts/run-purge-transactional-data.sh
```

If you use `Backend/docker-compose.yml` only (service names may differ), run `psql` against your local `jps-db` the same way as in [LOCAL-FRONTEND-BACKEND-STARTUP.md](./LOCAL-FRONTEND-BACKEND-STARTUP.md), piping `Backend/scripts/purge-transactional-data.sql`.

For **demo data after purge**, use `Backend/scripts/reset-and-seed-dev.sql` (separate script; includes seed).

\---

## Before you run in production

1. **Backup:** `pg\_dump` or Alicloud snapshot of `jps\_db`.
2. Confirm you are on the **backend** host and the correct database (`Backend/.env`).
3. Do **not** run `docker compose down -v` unless you intend to destroy the entire Postgres volume.

\---

## Related

* Dev reset **with** seed: `Backend/scripts/reset-and-seed-dev.sql`
* Migrations (schema only): `docker compose ... exec -T jps-api npm run migrate` — see [ALICLOUD-DEPLOYMENT-GUIDE.md](../Guide/ALICLOUD-DEPLOYMENT-GUIDE.md)

