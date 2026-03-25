# Jetty Planning System — Backend API

Backend development is **Docker-only**: API and PostgreSQL run in containers. No need to run `npm install` on your host.

## Prerequisites

- Docker and Docker Compose (v2)
- (Optional) Copy `.env.example` to `.env` and adjust if needed

## Run (development)

From this folder (`Backend/`):

```bash
docker compose up --build
```

- **API**: http://localhost:3000  
- **PostgreSQL**: localhost:5433 (user `jps_user`, db `jps_db`; default password in `.env.example`). Port 5433 avoids conflict with local Postgres on 5432.

Code is mounted into the container; `node --watch` restarts the server when you change files.

## Stop

```bash
docker compose down
```

Database data is kept in a Docker volume. To remove it: `docker compose down -v`.

## Migrations

Migrations are plain SQL files under `Backend/migrations/`, applied in filename order and tracked in `schema_migrations`.

Run migrations from this folder:

```bash
docker compose exec jps-api npm run migrate
```

After Step 1.9 (bcrypt + JWT), run once to hash the admin password:

```bash
docker compose exec jps-api npm run seed:admin
```
Then login with username `admin`, password `admin123`; use the returned `token` as `Authorization: Bearer <token>` for GET /api/v1/users/me.

## See also

- `Docs/README.md` — documentation index  
- `Docs/technical-architecture.md` — stack and API design  
