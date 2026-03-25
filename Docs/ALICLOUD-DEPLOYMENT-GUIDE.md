# Jetty Planning System — Alicloud Ubuntu Deployment Guide

This guide covers deploying the **Jetty Planning System (JPS)** on an **Alibaba Cloud (Alicloud) Ubuntu** instance with Docker, optional PostgreSQL, and exact shell commands for use via **PuTTY** (or any SSH client).

**Target directory:** `/opt/jetty-planning-system`

---

## 1. Alicloud Security Group — Ports to Open

Configure the **Security Group** for your ECS instance in the Alicloud console so the following ports are allowed.

| Port | Protocol | Purpose | Source (recommended) |
|------|----------|---------|----------------------|
| **22** | TCP | SSH (PuTTY / admin) | Your IP or VPN only |
| **3001** | TCP | React frontend (web UI) — default | 0.0.0.0/0 (or restrict to known IPs) |
| **3002** | TCP | React frontend (web UI) — **staging** (recommended for your current server; ports 3000, 3001, 3010, 3011, 8010 and 80 are already in use per `sudo ss -tuln`) | 0.0.0.0/0 (or restrict to known IPs) |
| **3000** | TCP | Node.js backend API | 0.0.0.0/0 or LB only (when backend is deployed) |
| **5432** | TCP | PostgreSQL (direct DB access) | **Do not open to 0.0.0.0** — only if you need external DB tools (e.g. DMS); otherwise leave closed (containers use internal network) |

**Summary:**

- **Minimum for current app (frontend only):** open **22** (SSH) and either **3001** (default) or **3002** (staging when 3001 is taken).
- **Staging on a shared server (your case):** since `sudo ss -tuln` shows 3000, 3001, 3010, 3011, 8010 and 80 already listening, use **3002** for the JPS frontend and open **3002** in the Security Group.
- **When you add the Node backend:** open **3000**.
- **PostgreSQL:** keep **5432** closed to the internet; access only from same VPC or via SSH tunnel if needed.

---

## 2. Prerequisites on the Ubuntu Instance

- Ubuntu 22.04 LTS (or 20.04) on Alicloud ECS.
- Root or sudo access.
- PuTTY: connect with your ECS public IP and the key/user provided by Alicloud.

---

## 3. Shell Commands (Run via PuTTY)

Copy and run these blocks in order in your PuTTY session.

### 3.1 Update system and install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

Log out and log back in (or run `newgrp docker`) so your user can run Docker without sudo.

### 3.2 Create target directory and set ownership

```bash
sudo mkdir -p /opt/jetty-planning-system
sudo chown $USER:$USER /opt/jetty-planning-system
cd /opt/jetty-planning-system
```

### 3.3 Deploy application files

**Option A — Clone from Git (if repo is in Git):**

```bash
cd /opt
# If you need to remove existing content first: sudo rm -rf /opt/jetty-planning-system && sudo mkdir -p /opt/jetty-planning-system && sudo chown $USER:$USER /opt/jetty-planning-system
cd /opt/jetty-planning-system
git clone <YOUR_REPO_URL> .
# Or clone into a subfolder and copy: git clone <YOUR_REPO_URL> repo && cp -r repo/. . && rm -rf repo
```

**Option B — Copy files via SCP from your PC (from Windows PowerShell or PSCP):**

From your **local machine** (PowerShell), not on the server:

```powershell
scp -r "C:\Users\04125050828\Documents\Workspace\Cursor\Jetty Planning System\*" ubuntu@<ECS_PUBLIC_IP>:/opt/jetty-planning-system/
```

Replace `ubuntu` with your ECS username and `<ECS_PUBLIC_IP>` with the instance public IP. If you use a key file:

```powershell
scp -i "C:\path\to\your.pem" -r "C:\Users\04125050828\Documents\Workspace\Cursor\Jetty Planning System\*" ubuntu@<ECS_PUBLIC_IP>:/opt/jetty-planning-system/
```

Then in **PuTTY** (on the server):

```bash
cd /opt/jetty-planning-system
ls -la
```

Ensure `Dockerfile`, `docker-compose.yml`, `package.json`, and `Frontend` (and optionally `docker-compose.production.yml`) are present.

### 3.4 Environment file

**For frontend-only deployment** (current setup), no `.env` is required.

**For production with PostgreSQL** (when using `docker-compose.production.yml`), create `.env` with a strong password:

```bash
cd /opt/jetty-planning-system
cat << 'EOF' > .env
# Jetty Planning System - Production (required for docker-compose.production.yml)
POSTGRES_USER=jps_user
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD
POSTGRES_DB=jps_db
# When you add the Node backend, uncomment and set:
# NODE_ENV=production
# DATABASE_URL=postgresql://jps_user:CHANGE_ME_STRONG_PASSWORD@jps-db:5432/jps_db
EOF
chmod 600 .env
# Edit .env and replace CHANGE_ME_STRONG_PASSWORD with a secure value before starting containers:
# nano .env
```

### 3.5 Docker-based deployment (frontend only — current setup)

**Staging (recommended when 3001 is already in use):** In `docker-compose.yml`, set the frontend port to **3002** so it does not conflict with existing services:

```yaml
ports:
  - "3002:80"
```

Then run:

```bash
cd /opt/jetty-planning-system
docker compose build --no-cache
docker compose up -d
docker compose ps
```

- **If using port 3001:** the web app is at **http://&lt;ECS_PUBLIC_IP&gt;:3001**.
- **If using port 3002 (staging):** the web app is at **http://&lt;ECS_PUBLIC_IP&gt;:3002**.

Ensure the Security Group allows the port you use (3001 or 3002).

### 3.6 Docker-based deployment (with PostgreSQL and optional Node API)

When you add a Node backend and PostgreSQL, use the production Compose file and migrations as below.

**Start all services (web + DB; API when you add it):**

```bash
cd /opt/jetty-planning-system
docker compose -f docker-compose.production.yml build --no-cache
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

**Run PostgreSQL migrations (after DB is up):**

Wait for PostgreSQL to be ready, then run migrations using one of the options below.

```bash
# Wait for PostgreSQL to be ready
sleep 10
docker compose -f docker-compose.production.yml exec jps-db pg_isready -U jps_user -d jps_db
```

**Option 1 — Migrations via Node backend (when you have added `jps-api`):**  
Uncomment the `jps-api` service in `docker-compose.production.yml`, rebuild, then:

```bash
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml exec jps-api npm run migrate
```

**Option 2 — Raw SQL file from host:**  
Place your migration SQL in the project (e.g. `migrations/001_initial.sql`), then:

```bash
docker compose -f docker-compose.production.yml exec -T jps-db psql -U jps_user -d jps_db < /opt/jetty-planning-system/migrations/001_initial.sql
```

**Option 3 — One-off migration container (e.g. node-pg-migrate):**  
When your backend has a migration CLI, run it in a temporary container that connects to `jps-db:5432` using `DATABASE_URL` from `.env`.

**Verify DB:**

```bash
docker compose -f docker-compose.production.yml exec jps-db psql -U jps_user -d jps_db -c '\dt'
```

### 3.7 Useful operational commands

```bash
cd /opt/jetty-planning-system

# View logs
docker compose logs -f
# Or for production file:
docker compose -f docker-compose.production.yml logs -f

# Stop
docker compose down
# Or:
docker compose -f docker-compose.production.yml down

# Rebuild and restart
docker compose build --no-cache && docker compose up -d
```

---

## 4. PostgreSQL Database Migration (When Backend Exists)

Once you have a Node (or other) backend and a PostgreSQL database in Docker:

1. **Create migrations** (e.g. with `node-pg-migrate`, `knex migrate:make`, or raw SQL in `Backend/migrations/`).
2. **Ensure the DB container is up** and the backend can reach it at host `jps-db` port `5432`.
3. **Run migrations** from the host (as in section 3.6) or from CI/CD:
   - Either `docker compose exec jps-api npm run migrate`
   - Or a one-off container that runs your migration CLI against `DATABASE_URL` pointing to `jps-db:5432`.

**Example migration script (Node with pg):**  
Place in `Backend/scripts/migrate.js` and run inside the API container:

```bash
# Inside container: node scripts/migrate.js
# Or from host:
docker compose -f docker-compose.production.yml exec jps-api node scripts/migrate.js
```

---

## 5. Port Reference Summary

| Service | Container port | Host port | Security Group |
|---------|----------------|-----------|----------------|
| SSH | — | 22 | Open (restrict by IP) |
| React frontend (nginx) | 80 | **3001** (default) or **3002** (staging) | Open the one you use |
| Node backend API | 3000 | **3000** | Open when in use |
| PostgreSQL | 5432 | 5432 (optional bind) | Keep closed to internet |

---

## 6. Checklist

- [ ] Alicloud Security Group: 22 (SSH); 3001 or 3002 (frontend, use 3002 for staging if 3001 is in use); 3000 if API is used; 5432 closed to public.
- [ ] Docker and Docker Compose installed on Ubuntu.
- [ ] App deployed under `/opt/jetty-planning-system`.
- [ ] For staging, `docker-compose.yml` set to port **3002** (e.g. `ports: - "3002:80"`) if 3001 is already in use.
- [ ] `.env` created if using production Compose with DB/API.
- [ ] `docker compose up -d` (or production Compose) run successfully.
- [ ] PostgreSQL migrations run after first DB start (when applicable).
- [ ] Web UI accessible at `http://<ECS_PUBLIC_IP>:3001` or `http://<ECS_PUBLIC_IP>:3002` (staging).

---

## 7. Troubleshooting

- **Cannot connect on 3001 or 3002:** Check Security Group allows inbound TCP for the port you use (3001 or 3002). On the server, run `sudo ss -tlnp | grep 3001` or `sudo ss -tlnp | grep 3002` to confirm the app is listening.
- **Permission denied (Docker):** Ensure user is in group docker: `groups`; re-login or `newgrp docker`.
- **Build fails:** Run `docker compose build --no-cache` and check that `package.json`, `Frontend/`, and `Dockerfile` exist in `/opt/jetty-planning-system`.
- **DB connection refused:** Ensure `jps-db` is running and migrations run after DB is ready (`sleep 10` or healthcheck); confirm `DATABASE_URL` uses host `jps-db` and correct port/password.
