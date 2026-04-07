# pgAdmin 4 – Can't connect (password authentication failed)

If your `.env` has the correct `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` but pgAdmin still says "password authentication failed", the database was probably **first created with a different password** (or no `.env`). PostgreSQL only sets the password when the data directory is created; changing `.env` later does not update it.

## Fix: Reset the DB volume and re-run migrations

From the **Backend** folder:

```bash
# 1. Stop containers and remove the database volume (this deletes all DB data)
docker compose down -v

# 2. Start again (Postgres will initialize with current .env)
docker compose up -d

# 3. Wait a few seconds for Postgres to be ready, then run migrations
docker compose exec jps-api npm run migrate
```

Then in **pgAdmin 4**:

- **Host**: `localhost`
- **Port**: `5433` (JPS Postgres is mapped to host port 5433 to avoid conflict with local Postgres on 5432)
- **Database**: `jps_db`
- **Username**: `jps_user`
- **Password**: exactly what you have in `Backend/.env` as `POSTGRES_PASSWORD` (e.g. `jps_dev_password` — no spaces, correct case)

Save and connect. It should work.

## If port 5432 is already in use

Another program (e.g. a local PostgreSQL install) might be using 5432. Then Docker might not bind to 5432, or pgAdmin might be talking to the wrong server.

Check what is using 5432:

```bash
# Windows (PowerShell)
netstat -ano | findstr :5432
```

JPS Postgres is already set to host port **5433** in `Backend/docker-compose.yml` so it doesn't conflict with a local Postgres on 5432. Use **port 5433** in pgAdmin.
