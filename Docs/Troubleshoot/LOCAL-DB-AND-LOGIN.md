## Troubleshooting: Local DB (pgAdmin) + Login

### pgAdmin: “connection timeout expired” (localhost)

**Symptom**
- pgAdmin connection test fails with:
  - `connection timeout expired`
  - attempts to `localhost` on a port like `5433`

**Cause**
- Nothing is listening on that host port.
- In this repo’s backend Docker stack, Postgres is published on **host port `5436`** (mapped to container `5432`).

**Fix**
1. In pgAdmin connection:
   - **Host name/address**: `localhost`
   - **Port**: `5436`
   - **Maintenance DB**: your `POSTGRES_DB` (commonly `jps_db`)
   - **Username**: your `POSTGRES_USER` (commonly `jps_user`)
   - **Password**: your `POSTGRES_PASSWORD` (from `Backend/.env`)

2. Confirm the DB container is up (PowerShell, repo root):

```powershell
docker compose --env-file Backend/.env -f docker-compose.backend.yml ps
```

You should see `jps-db` with ports similar to `127.0.0.1:5436->5432/tcp`.

**If pgAdmin runs in Docker**
- Use **Host**: `host.docker.internal`
- Use **Port**: `5436`

---

### Login: “Invalid username or password” (admin)

**Symptom**
- Login fails even though you didn’t “change” credentials.

**Common causes**
- You’re connected to a different DB/volume than before (so the `admin` user row is missing or different).
- The `admin` user password was converted to a **bcrypt hash** (login uses bcrypt compare), and the stored `password_hash` no longer matches what you expect.

**What the repo expects**
- Seeded login user:
  - **Username**: `admin`
  - **Password**: `admin123`

**Fix (reset admin password to `admin123`)**
From repo root (PowerShell):

```powershell
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run seed:admin
```

Then login with:
- **Username**: `admin`
- **Password**: `admin123`

**Confirm the admin row exists (pgAdmin)**

```sql
SELECT id, username, password_hash
FROM users
WHERE deleted_at IS NULL
ORDER BY id;
```

- If `password_hash` starts with `$2b$` / `$2a$` it’s a bcrypt hash (expected with bcrypt login).

