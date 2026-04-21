# Allowing Public Access

This note explains how to reach JPS from the **internet** (public EIP) **and** from the **VPC / LAN** (private IP) with one deployment.

For Alicloud ECS, security groups, and two-server layout, start with [ALICLOUD-DEPLOYMENT-GUIDE](./ALICLOUD-DEPLOYMENT-GUIDE.md).

**Order of work:** complete **Part A — App server** first, then **Part B — Backend server**. Login and API calls only work end-to-end after both parts match (nginx → API, CORS, cookies).

---

## Part A — App server (do this first)

Do these steps in SSH on the **frontend / app ECS** (the host where `docker-compose.app.yml` runs). The guide uses deploy root **`/opt/jetty-planning-system`** — adjust if your path differs.

### A.0 — Values to have ready

| Value | Example | Used for |
|-------|---------|----------|
| App server **private IP** | `172.28.92.56` | VPC / LAN URL, and later `CORS_ORIGIN` on the backend |
| App **public EIP** | `203.0.113.10` | Internet URL (Alibaba Cloud → ECS → Elastic IP) |
| Host port mapped to nginx | `3080` (or `3001` if default) | Security group and URLs `http://<IP>:<port>` |
| **Backend** server private IP | `172.28.92.57` | `Frontend/nginx.alicloud-app.conf` upstream |

### A.1 — Security group (Alibaba Cloud console)

On the **app** instance’s security group, inbound **TCP** to the port users open (e.g. **3080**), source per your policy (e.g. `0.0.0.0/0` for full public access). Ensure the ECS has an **EIP** bound if users reach it from the internet.

### A.2 — Code on the server

```bash
cd /opt/jetty-planning-system
git pull origin <your-branch>   # optional: get latest, including relative VITE_API_BASE_URL support in Frontend/src/api/client.js
```

### A.3 — Nginx upstream to the API host

Edit **`Frontend/nginx.alicloud-app.conf`** on this server. The `upstream jps_backend` block must point to your **backend** machine’s private IP and API port (**3000**):

```nginx
upstream jps_backend {
    server 172.28.92.57:3000;
```

(Replace `172.28.92.57` with your real backend private IP.)

### A.4 — Repo root `.env` (next to `docker-compose.app.yml`)

Create or edit **`.env`** in `/opt/jetty-planning-system` (repository root, **not** `Frontend/.env` for this Docker flow):

```env
VITE_API_BASE_URL=/api/v1
JPS_FE_PORT=3080
```

- **`VITE_API_BASE_URL=/api/v1`** — one build works for both `http://<private>:3080` and `http://<EIP>:3080`.
- **`JPS_FE_PORT`** — must match the host port you mapped in the security group (use **`3001`** if you omit this and the default in compose is acceptable).

Save the file.

### A.5 — Rebuild the frontend image and restart the container

From `/opt/jetty-planning-system`:

```bash
docker compose -f docker-compose.app.yml build --no-cache
docker compose -f docker-compose.app.yml up -d
```

### A.6 — Quick checks on the app server

Use the **same port** you set in `JPS_FE_PORT` (e.g. **3080**), or **3001** if you left the compose default:

```bash
docker compose -f docker-compose.app.yml ps
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/
```

You want HTTP **200** (or **304**) for the SPA shell.

### A.7 — Stop here until Part B is done

Open **`http://<app-private-IP>:<port>`** in a browser on the VPC/LAN: the UI should load. **Login may still fail** until **`CORS_ORIGIN`** and **`COOKIE_SECURE`** are set on the backend (Part B). After Part B, test **`http://<EIP>:<port>`** from the internet.

---

## Part B — Backend server (after Part A)

SSH to the **backend** ECS (API + Postgres host) where **`docker-compose.backend.yml`** runs.

### B.1 — Edit `Backend/.env`

Path: **`/opt/jetty-planning-system/Backend/.env`** (same deploy root; file is not committed).

Set **both** browser origins your users will type (private and public), **same port** as on the app server, **http** unless you already use HTTPS:

```env
CORS_ORIGIN=http://172.28.92.56:3080,http://203.0.113.10:3080
COOKIE_SECURE=false
```

- Replace **`172.28.92.56`** with your app server **private** IP.
- Replace **`203.0.113.10`** with your app server **public EIP**.
- Replace **`3080`** with your real `JPS_FE_PORT` if different.
- **`COOKIE_SECURE=false`** is required for **plain HTTP**; omit or change when everything is HTTPS.

If **`CORS_ORIGIN`** already exists, merge into one comma-separated line (no spaces around commas is fine; the app trims entries).

### B.2 — Restart the API

From **`/opt/jetty-planning-system`**:

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d
```

This recreates **`jps-api`** with the new environment. Postgres container is unchanged unless the file forces a change.

### B.3 — Verify API health (optional)

From the **backend** host (or app server if SG allows app → backend :3000):

```bash
curl -sS http://127.0.0.1:3000/health
curl -sS -o /dev/null -w "%{http_code}\n" -H "Origin: http://172.28.92.56:3080" http://127.0.0.1:3000/api/v1/ping
```

You should see JSON from `/health` and **200** from `/api/v1/ping` when an allowed `Origin` is sent.

### B.4 — End-to-end test in the browser

1. **`http://<private-IP>:<port>`** — log in; confirm session works (navigation, API calls).
2. **`http://<EIP>:<port>`** — same from a machine **outside** the VPC.

Remember: cookies are **per host**; logging in on the private URL does not copy the session to the EIP URL (two separate sign-ins is normal).

---

## Reference — Why these settings exist

- **Private IP in the browser from the internet:** `http://172.28.x.x` is not reachable from the public internet. Users need **`http://<EIP>:<port>`** and an EIP (or LB) on the app ECS.
- **`VITE_API_BASE_URL=/api/v1`:** Relative base → the SPA calls the API on whatever host the user opened; nginx proxies `/api/` to the backend (`Frontend/nginx.alicloud-app.conf`).
- **`CORS_ORIGIN`:** Comma-separated list; must include every `http://<host>:<port>` users type for the SPA (`Backend/src/index.js`).
- **`COOKIE_SECURE=false`:** Required for **plain HTTP** in production; otherwise cookies are not stored (`Backend/src/lib/auth-cookies.js`, `docker-compose.backend.yml`). Revisit when you move to HTTPS.
- **Two URLs:** Session cookies are **per origin** — separate login on private URL vs EIP is normal.

**Local Vite dev** (laptop): keep **`VITE_API_BASE_URL=http://localhost:3000/api/v1`** in repo root `.env` — not the same as production on the server.

---

## Quick reference

| Item | File | Example line |
|------|------|----------------|
| Relative API base (production build) | Repo root `.env` | `VITE_API_BASE_URL=/api/v1` |
| CORS for private + public | `Backend/.env` | `CORS_ORIGIN=http://<PRIVATE>:3080,http://<EIP>:3080` |
| HTTP session cookies | `Backend/.env` | `COOKIE_SECURE=false` |

Code that resolves a relative base to the current browser origin: `Frontend/src/api/client.js` (`getApiOrigin`).
