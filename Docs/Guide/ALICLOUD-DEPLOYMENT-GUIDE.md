# Jetty Planning System — Alicloud Ubuntu Deployment Guide

This guide deploys JPS on **two or three ECS instances** in the same VPC:

|Layout|Servers|Compose (repo root)|
|-|-|-|
|**Two-server** (bootstrap)|App \| API + PostgreSQL|`docker-compose.app.yml`, `docker-compose.backend.yml`|
|**Three-server** (after DB split)|App \| API only \| PostgreSQL only|`docker-compose.app.yml`, `docker-compose.backend-api-only.yml`, `Backend/infra/docker-compose.db.yml`|

**Two-server roles (example IPs):**

|Server|Role|What runs there|
|-|-|-|
|**App server** (`172.28.92.56`)|**Frontend only**|Docker: **nginx + built React SPA** (`docker-compose.app.yml`). Proxies `/api/` and `/uploads/` to the API over the **private network**.|
|**Backend server** (`172.28.92.57`)|**API + database**|Docker: **Node API** (`jps-api`) + **PostgreSQL** (`jps-db`) (`docker-compose.backend.yml`). **Do not** install the JPS frontend container on this host.|

**Three-server:** add **DB server** (`172.28.92.60` example) — PostgreSQL only. App and nginx are **unchanged**; API uses `DB\_HOST` pointing at the DB host. See [THREE-SERVER-DB-SPLIT-GUIDE.md](./THREE-SERVER-DB-SPLIT-GUIDE.md) and [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md). Topology summary: [technical-architecture.md](../technical-architecture.md) §0.6.

Users reach **only** the app server URL (public IP or DNS + port). They never call the backend IP directly from the browser.

**Public internet access (EIP, security group, dual URL private + public, `VITE\\\_API\\\_BASE\\\_URL`, `CORS\\\_ORIGIN`, cookies):** see [Allowing Public Access](./Allowing-Public-Access.md).

All **shell commands** below are intended to be run in an SSH session on the correct host (**PuTTY**, `ssh`, etc.).

\---

## Deployment at a glance (requirements)

|#|Requirement|How this guide covers it|
|-|-|-|
|**1**|**Target directory:** `/opt/\\\\\\\\\\\\\\\[project-name]`|Use **`/opt/jetty-planning-system`** on **both** servers (`\\\\\\\\\\\\\\\[project-name]` = `jetty-planning-system`). All `cd` and `docker compose` commands assume this path.|
|**2**|**Docker** + **PostgreSQL migrations**|**Backend server:** `docker compose --env-file Backend/.env -f docker-compose.backend.yml` (API + `jps-db`), then `docker compose ... exec -T jps-api npm run migrate` (§5). **App server:** `docker-compose.app.yml` (§6) + **`rtsp-stream-viewer/.env`** on the host for Jetty Live (§6.2A).|
|**3**|**Security Group ports**|**Consolidated table** below; details per server in §1. **JPS Postgres** is **not** opened on any SG (Docker internal only).|
|**4**|**Exact shell commands (PuTTY)**|§3 (Docker install), §4 (GitHub + directory), §5–§6 (deploy + migrate), §8 (operations). Copy/paste each block on the correct server.|

### Security Group ports to open (summary)

Apply these in the **Alibaba Cloud ECS console** → Security Group → **Inbound** rules.

|Port (TCP)|Server|Purpose|Source (recommended)|
|-|-|-|-|
|**22**|App + Backend|SSH (admin)|Your office / VPN IP only|
|**3080**|App|React frontend (nginx) + proxied API path `/api/`|Internet or your users’ IP range|
|**3000**|Backend|Node.js API (Express)|**Only** app server private IP **`172.28.92.56`**|
|**5432**|—|JPS PostgreSQL|**Do not open** (DB is internal to Docker on the backend host)|
|**80** / **443**|App|Optional: TLS or existing reverse proxy|As needed for your org|

If your app host uses **`JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT=3001`** (clean server) instead of **3080**, open **3001** instead of **3080** in the app SG.

**Outbound:** On the **app** SG, allow TCP **3000** (or your API host port) toward **172.28.92.57** so nginx can reach the API.

\---

## Which server first? (follow this order)

**Always start with the Backend + API + DB server (`172.28.92.57`), then the Frontend / App server (`172.28.92.56`).**

|Order|Instance (private IP)|Role|Why first / second|
|-|-|-|-|
|**1st**|**Backend** `172.28.92.57`|API + PostgreSQL (Docker)|Database and API must exist before migrations; the app server only proxies to this API. Set `CORS\\\\\\\\\\\\\\\_ORIGIN` to the **app** URL you plan to use (decide app public IP and port **3080** before deploying the app).|
|**2nd**|**App** `172.28.92.56`|React + nginx reverse proxy|Needs a **running** API to proxy `/api/` and `/uploads/`. `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL` must point at the **same** host:port users open (e.g. `http://<APP\\\\\\\\\\\\\\\_PUBLIC>:3080/api/v1`).|

\---

## Step-by-step checklist (copy order)

Do **A → N** in sequence. Use **PuTTY** (or `ssh`) on each host. Replace placeholders: `<APP\\\\\\\\\\\\\\\_PUBLIC\\\\\\\\\\\\\\\_IP>`, GitHub URL, passwords.

### A. Alicloud console (before logging in)

1. **Backend** security group: inbound **TCP 22** (admin), **TCP 3000** source = **172.28.92.56** only. Do **not** open **5432** for JPS Docker DB.
2. **App** security group: inbound **TCP 22** (admin), **TCP 3080** (JPS UI) for users. **Outbound:** allow TCP **3000** to **172.28.92.57** (or confirm default VPC allows it).

### B. Backend server `172.28.92.57` (FIRST)

3. SSH to backend (PuTTY → public or bastion IP for that host).
4. Install Docker — run the full block in **§3**.
5. Create directory and clone GitHub — **§4.1** then **§4.2** (or **§4.3** if private).
6. Create `/opt/jetty-planning-system/.env` — **§5.1**. Use a real **`CORS\\\\\\\\\\\\\\\_ORIGIN`** matching the app, e.g. `http://<APP\\\\\\\\\\\\\\\_PUBLIC\\\\\\\\\\\\\\\_IP>:3080` (set `<APP\\\\\\\\\\\\\\\_PUBLIC\\\\\\\\\\\\\\\_IP>` to your app ECS **EIP**).
7. Start stack and run migrations — **§5.2** and **§5.3**.
8. Optional: from **app** server, run **§5.4** `curl` to confirm API responds.

### C. App server `172.28.92.56` (SECOND)

9. SSH to app server (PuTTY → app public IP).
10. Install Docker — **§3** again on this host.
11. Directory + GitHub — **§4.1** + **§4.2** / **§4.3** (same repo).
12. Edit **`Frontend/nginx.alicloud-app.conf`**: upstream **`172.28.92.57:3000`** — **§6.1**.
13. Create app **`.env`**: **`JPS_FE_PORT=3080`** and **`VITE_API_BASE_URL=http://<APP_PUBLIC_IP>:3080/api/v1`** — **§6.2**.
14. Create **`rtsp-stream-viewer/.env`** (Jetty Live CCTV on the **host**, not Docker) — **§6.2A**. Copy from **`.env.example`**, set camera **`RTSP_URL`**, then install/enable **`jps-jetty-live`** if not already done — [JETTY-LIVE-STREAM-DEPLOYMENT.md](./JETTY-LIVE-STREAM-DEPLOYMENT.md).
15. Build and start frontend — **§6.3**.

### D. Validate

16. Browser: `http://<APP_PUBLIC_IP>:3080` — login / API should work via same origin.
17. Jetty Live (optional): with **View Jetty Live stream** RBAC, open CCTV from Allocation schematic; `curl -s http://127.0.0.1:3081/api/health` on app host shows `viewerCount` / `ffmpegRunning` when a viewer is connected — **§6.2A**.
18. Later updates: **§4.4** (`git pull` + rebuild + migrate on backend).

**Full command text** for each step lives in the sections referenced (**§3–§6**). Use this checklist as the **order**; use those sections as the **exact commands**.

\---

## Architecture (two ECS instances)

|Server|Private IP (example)|Role|
|-|-|-|
|**App**|`172.28.92.56`|React SPA (nginx) + **reverse proxy** to the API (`/api/`, `/uploads/`)|
|**Backend**|`172.28.92.57`|Node **API** + **PostgreSQL** (Docker). **No** public database port.|

Users open only the **app** URL (public IP / domain + port or HTTPS). The browser calls **`/api/v1`** on **that same origin**; nginx on the app server forwards requests to the API over the **private** network.

**Target directory (both servers):** `/opt/jetty-planning-system` (i.e. `/opt/\\\\\\\\\\\\\\\[project-name]` with `project-name=jetty-planning-system`).

**Repo files used:**

* **App server:** `Frontend/Dockerfile`, `docker-compose.app.yml`, `Frontend/nginx.alicloud-app.conf`, root `.env` (for `VITE_API_BASE_URL` and compose), **`rtsp-stream-viewer/.env`** (Jetty Live stream helper on the **host** — **§6.2A**; not committed to Git)
* **Backend server:** `Backend/`, `docker-compose.backend.yml`, **`Backend/.env`** (DB + JWT + `CORS_ORIGIN`). Run Compose with `--env-file Backend/.env` so `${POSTGRES_PASSWORD}` and other vars interpolate from that file.

**Single-server alternative (all-in-one on one VM):** use `docker-compose.production.yml` as documented in git history or enable `jps-web` + `jps-api` + `jps-db` on one host; this guide focuses on the **two-server** split.

**Three-server split (dedicated database host):** when scaling API and PostgreSQL onto separate ECS instances, follow [THREE-SERVER-DB-SPLIT-GUIDE.md](./THREE-SERVER-DB-SPLIT-GUIDE.md) (host readiness, practice migration). **Cutover:** [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md).

\---

## 1\. Security groups (two SGs)

### App server (`172.28.92.56`)

|Port|Protocol|Purpose|Source|
|-|-|-|-|
|**22**|TCP|SSH|Your admin IP / VPN only|
|**3080** (recommended)|TCP|HTTP (JPS SPA + proxied `/api/` + `/uploads/`)|Users (or restrict); see §1.1 if your host is already busy|
|**80** / **443**|TCP|Often already used by other stacks; optional later: reverse proxy + TLS for JPS|As needed|

**Outbound:** allow TCP **3000** to **backend private IP** `172.28.92.57` (nginx → API).

### 1.1 App server: pick a free host port for JPS

On a **shared** app ECS, check what is already listening:

```bash
sudo ss -tuln
```

On **`172.28.92.56`** the following TCP ports were observed in use on **all interfaces** (`0.0.0.0` / `\\\\\\\\\\\\\\\[::]`), so **do not** bind JPS to them:

|Already in use|Typical role|
|-|-|
|**22**|SSH|
|**80**|HTTP|
|**3000**, **3001**, **3002**, **3005**|Other apps|
|**3010**, **3011**|Other apps|
|**8010**|Other apps|

(Local resolver ports **53** on `127.0.0.x` do not conflict with binding JPS on another port.)

**Recommendation for this host:** expose JPS on **`3080`** (host) → container **80**:

* Set `JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT=3080` in the app server `.env` (same directory as `docker-compose.app.yml`), **or** run:

  * `JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT=3080 docker compose -f docker-compose.app.yml up -d --build`
* Open **TCP 3080** in the app security group for users.
* Set `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL` and backend `CORS\\\\\\\\\\\\\\\_ORIGIN` to use **`:3080`** (same scheme, host, and port the browser uses).

If **3080** is ever taken, choose another free port (e.g. **8080**, **3003**) and use it consistently for `JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT`, the security group, `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL`, and `CORS\\\\\\\\\\\\\\\_ORIGIN`.

On a **dedicated** app server with no conflicts, you may keep the compose default **`JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT=3001`** instead.

### Backend server (`172.28.92.57`)

|Port|Protocol|Purpose|Source|
|-|-|-|-|
|**22**|TCP|SSH|Your admin IP / VPN / bastion only|
|**3000**|TCP|Node API (default; see §1.2)|**Only** app server private IP **`172.28.92.56`** (not `0.0.0.0/0`)|
|**5432**|TCP|PostgreSQL|**Do not open** in the security group. DB stays on the Docker network; not published to the host.|

### 1.2 Backend server (`172.28.92.57`): API port and host Postgres

Run `sudo ss -tuln` on the backend host and pick a **host port** for **`jps-api`** that is **not** already listening on `0.0.0.0` / `\\\\\\\\\\\\\\\[::]`.

On **`172.28.92.57`** the following TCP ports were observed **in use** (do **not** use the same host port for JPS API unless you remap compose):

|Already in use|Note|
|-|-|
|**22**|SSH|
|**3001**, **3003**|Other services|
|**4000**|Other service|
|**5001**, **5002**|Other services|
|**5432**, **5434**, **5422**|PostgreSQL (or similar) on the **host**|
|**5433**|`127.0.0.1` / `127.0.1.1` only — does not block other ports|

**Recommendation:** **`3000` is free** on this host — keep **`docker-compose.backend.yml`** as **`3000:3000`** and keep **`Frontend/nginx.alicloud-app.conf`** upstream as **`172.28.92.57:3000`**.

**JPS Postgres in Docker:** do **not** publish container **5432** on host **`0.0.0.0`** (would conflict with other Postgres on the host and is unnecessary). The checked-in compose maps **`127.0.0.1:5436:5432`** so **inside the container** Postgres remains on **5432** (what `jps-api` uses via `DATABASE\\\\\\\\\\\\\\\_URL` → `jps-db:5432`), while **on the Linux host** you connect to **127.0.0.1 port 5436** for admin tools after an SSH tunnel. See **§1.3** and [PGADMIN-ALICLOUD-DB-TUNNEL.md](PGADMIN-ALICLOUD-DB-TUNNEL.md).

### 1.3 Backend host port **5436** (pgAdmin / DBA tools)

|Item|Detail|
|-|-|
|**Why not host :5432?**|Many ECS images already run PostgreSQL or other services on **5432**. Binding JPS there causes conflicts; tools like pgAdmin may attach to the **wrong** instance.|
|**Chosen host port**|**`5436`** on **127.0.0.1 only** in `docker-compose.backend.yml` (`127.0.0.1:5436:5432`).|
|**API unchanged**|`DATABASE\\\\\\\\\\\\\\\_URL` uses hostname **`jps-db`** and port **5432** (Docker DNS). Only **your PC → SSH → backend `127.0.0.1:5436`** uses the host mapping.|
|**Security**|Keep **5436** off public SGs. Access is **SSH + local forward** (see PGADMIN doc).|
|**After `git pull`**|If compose changed ports, run `docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d` so `jps-db` recreates with the new mapping (data volume is preserved).|

If **3000** becomes occupied later, map a free host port (e.g. **`3010:3000`**) in compose, set nginx upstream to that host port, and allow that port from the app server in the backend SG.

**Summary**

* Internet → **app** only on the port you assign to JPS (e.g. **3080** on a busy host, or **3001** on a clean host), or **443** when TLS terminates on the app server.
* **App → backend** on **:3000** over VPC (default for `172.28.92.57`; adjust if you change the API host port).
* **Postgres** never exposed outside the backend host.

\---

## 2\. Prerequisites

* Ubuntu 22.04 or 24.04 on both ECS instances.
* Same VPC; private IPs can reach each other (default route / same vSwitch).
* **PuTTY** (or any SSH client): connect with the ECS **public IP** (app server) or **bastion/jump** host for the backend if it has no public IP.
* **Git** installed (included in §3 with `git` package).
* **GitHub** repository URL for this project (HTTPS or SSH).
* Replace example IPs (`172.28.92.56` / `172.28.92.57`) if yours differ.

\---

## 3\. Install Docker (run on BOTH servers)

```bash
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git nano
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb \\\\\\\\\\\\\\\[arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& echo "$VERSION\\\\\\\\\\\\\\\_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
newgrp docker
docker --version \\\\\\\\\\\\\\\&\\\\\\\\\\\\\\\& docker compose version
```

\---

## 4\. Target directory and code from GitHub (both servers)

Use the same path on **app** and **backend** so documentation and scripts match.

### 4.1 Create `/opt/\\\\\\\\\\\\\\\[project-name]`

**Project name** for this repo: `jetty-planning-system` → full path **`/opt/jetty-planning-system`**.

Run on **each** server (PuTTY session):

```bash
sudo mkdir -p /opt/jetty-planning-system
sudo chown $USER:$USER /opt/jetty-planning-system
cd /opt/jetty-planning-system
```

### 4.2 First-time clone from GitHub (HTTPS — public repo)

If the repository is **public**, clone into the empty directory:

```bash
cd /opt/jetty-planning-system
git clone https://github.com/<YOUR\\\\\\\\\\\\\\\_ORG\\\\\\\\\\\\\\\_OR\\\\\\\\\\\\\\\_USER>/<YOUR\\\\\\\\\\\\\\\_REPO\\\\\\\\\\\\\\\_NAME>.git .
```

Example (replace with your real URL):

```bash
git clone https://github.com/your-org/jetty-planning-system.git .
```

Verify:

```bash
ls -la
# Expect: Backend/, Frontend/Dockerfile, docker-compose.app.yml, docker-compose.backend.yml, Frontend/nginx.alicloud-app.conf, package.json, etc.
```

### 4.3 First-time clone from GitHub (private repo)

**Option A — Personal Access Token (HTTPS)**

1. On GitHub: **Settings → Developer settings → Personal access tokens** — create a token with **`repo`** scope.
2. On the server (PuTTY):

```bash
cd /opt/jetty-planning-system
git clone https://github.com/<YOUR\\\\\\\\\\\\\\\_ORG\\\\\\\\\\\\\\\_OR\\\\\\\\\\\\\\\_USER>/<YOUR\\\\\\\\\\\\\\\_REPO\\\\\\\\\\\\\\\_NAME>.git .
```

When prompted for password, paste the **token** (not your GitHub password). To avoid storing the token in shell history, you can use:

```bash
git clone https://<YOUR\\\\\\\\\\\\\\\_GITHUB\\\\\\\\\\\\\\\_USERNAME>@github.com/<YOUR\\\\\\\\\\\\\\\_ORG\\\\\\\\\\\\\\\_OR\\\\\\\\\\\\\\\_USER>/<YOUR\\\\\\\\\\\\\\\_REPO\\\\\\\\\\\\\\\_NAME>.git .
# Password prompt: paste PAT
```

**Option B — SSH deploy key (recommended for servers)**

1. On the server (PuTTY):

```bash
ssh-keygen -t ed25519 -C "jps-deploy-jps" -f \\\\\\\\\\\\\\\~/.ssh/github\\\\\\\\\\\\\\\_jps -N ""
cat \\\\\\\\\\\\\\\~/.ssh/github\\\\\\\\\\\\\\\_jps.pub
```

2. In GitHub: repo **Settings → Deploy keys → Add deploy key** — paste the public key, allow read access.
3. Clone **into** `/opt/jetty-planning-system` (must be empty except after §4.1):

```bash
cd /opt/jetty-planning-system
GIT\\\\\\\\\\\\\\\_SSH\\\\\\\\\\\\\\\_COMMAND='ssh -i \\\\\\\\\\\\\\\~/.ssh/github\\\\\\\\\\\\\\\_jps -o IdentitiesOnly=yes' git clone git@github.com:<YOUR\\\\\\\\\\\\\\\_ORG\\\\\\\\\\\\\\\_OR\\\\\\\\\\\\\\\_USER>/<YOUR\\\\\\\\\\\\\\\_REPO\\\\\\\\\\\\\\\_NAME>.git .
```

For a **persistent** SSH config (optional):

```bash
nano \\\\\\\\\\\\\\\~/.ssh/config
```

Add:

```
Host github.com
  HostName github.com
  User git
  IdentityFile \\\\\\\\\\\\\\\~/.ssh/github\\\\\\\\\\\\\\\_jps
  IdentitiesOnly yes
```

Then:

```bash
cd /opt/jetty-planning-system
git clone git@github.com:<YOUR\\\\\\\\\\\\\\\_ORG\\\\\\\\\\\\\\\_OR\\\\\\\\\\\\\\\_USER>/<YOUR\\\\\\\\\\\\\\\_REPO\\\\\\\\\\\\\\\_NAME>.git .
```

### 4.4 Update code with `git pull` (app, API, and DB servers)

After the initial clone, deploy updates **without** SCP.

**Repo root on each host:** use the directory that contains `docker-compose.app.yml` or `docker-compose.backend.yml` at the top level. The standard path is:

```bash
cd /opt/jetty-planning-system
```

If you cloned into a **nested** folder on one host only (e.g. `/opt/jetty-planning-system/Jetty-Planning-System`), use that path on **that** host — but prefer one consistent root on all servers to avoid confusion.

**Deploy branch (SIT example):** checkout the branch you deploy from GitHub before `pull`:

```bash
git fetch origin
git checkout sit-post-bontang-visit   # or your branch name
git pull origin sit-post-bontang-visit
git log -1 --oneline                  # confirm commit matches GitHub
```

**Notes (to keep deployments consistent + safe):**

* **Run on each server only if needed**:

  * **Frontend-only** change → **App server** only (§6).
  * **Backend/**, migrations, or API routes → **API server first** (§5), then App.
  * **DB compose / Postgres config** → **DB server** only (three-server); see [THREE-SERVER-DB-SPLIT-GUIDE.md](./THREE-SERVER-DB-SPLIT-GUIDE.md).
* Builds use this checkout on the server; runtime containers do **not** mount the whole repo (app compose mounts only `Frontend/nginx.alicloud-app.conf`).
* **Database safety**: `docker compose up -d` does **not** wipe Postgres data. Do **not** run `docker compose down -v` unless you intentionally want to delete volumes.
* **Browser cache**: hard refresh (Chrome: `Ctrl+Shift+R`) after frontend deploys.

**API server — two-server layout** (`jps-api` + `jps-db` on same host):

```bash
cd /opt/jetty-planning-system
git fetch origin
git checkout sit-post-bontang-visit
git pull origin sit-post-bontang-visit
docker compose --env-file Backend/.env -f docker-compose.backend.yml build --no-cache
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate
```

**API server — three-server layout** (API only; Postgres on Server 3):

```bash
cd /opt/jetty-planning-system
git fetch origin
git checkout sit-post-bontang-visit
git pull origin sit-post-bontang-visit
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml build --no-cache
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
```

Quick health check (API server):

```bash
docker compose --env-file Backend/.env -f docker-compose.backend.yml ps    # two-server
# or: ... -f docker-compose.backend-api-only.yml ps                         # three-server
curl -sS http://127.0.0.1:3000/health
docker compose --env-file Backend/.env -f docker-compose.backend.yml logs --tail=50 jps-api
```

**App server (PuTTY):**

```bash
cd /opt/jetty-planning-system/Jetty-Planning-System
git fetch origin
git checkout sit-post-bontang-visit
git pull origin sit-post-bontang-visit
docker compose -f docker-compose.app.yml build --no-cache
docker compose -f docker-compose.app.yml up -d
```

If **`rtsp-stream-viewer/`** changed, ensure **`rtsp-stream-viewer/.env`** exists (**§6.2A**), then:

```bash
cd rtsp-stream-viewer && npm ci
sudo systemctl restart jps-jetty-live
```

Quick check:

```bash
docker compose -f docker-compose.app.yml ps
curl -sS -o /dev/null -w "%{http\_code}\\n" http://127.0.0.1:3080/
curl -sS http://127.0.0.1:3080/api/v1/health
docker compose -f docker-compose.app.yml logs --tail=50 jps-fe
```

Use **`3001`** instead of **`3080`** in `curl` if `JPS\_FE\_PORT=3001`.

If you changed only server-local files (`.env`, `Frontend/nginx.alicloud-app.conf`), **do not** commit secrets to GitHub — keep them on the server and resolve merge conflicts carefully after `git pull`.

### 4.5 Alternative: copy from PC (no Git)

If GitHub is not used on a host, from **Windows PowerShell**:

```powershell
scp -r "D:\\\\\\\\\\\\\\\\path\\\\\\\\\\\\\\\\to\\\\\\\\\\\\\\\\Jetty Planning System\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*" ubuntu@<ECS\\\\\\\\\\\\\\\_PUBLIC\\\\\\\\\\\\\\\_IP>:/opt/jetty-planning-system/
```

Then continue with §5 / §6 using the same paths.

\---

## 5\. Backend server first (`172.28.92.57`)

### 5.1 Create `Backend/.env` (secrets stay here)

```bash
cd /opt/jetty-planning-system
nano Backend/.env
```

Use strong values. **`CORS\\\\\\\\\\\\\\\_ORIGIN`** must match the URL users use for the SPA (scheme + host + port), e.g. `http://<APP\\\\\\\\\\\\\\\_PUBLIC\\\\\\\\\\\\\\\_IP>:3080` when JPS listens on **3080**, or `https://app.example.com` behind TLS.

```bash
POSTGRES\\\\\\\\\\\\\\\_USER=jps\\\\\\\\\\\\\\\_user
POSTGRES\\\\\\\\\\\\\\\_PASSWORD=CHANGE\\\\\\\\\\\\\\\_ME\\\\\\\\\\\\\\\_STRONG\\\\\\\\\\\\\\\_DB\\\\\\\\\\\\\\\_PASSWORD
POSTGRES\\\\\\\\\\\\\\\_DB=jps\\\\\\\\\\\\\\\_db

JWT\\\\\\\\\\\\\\\_SECRET=CHANGE\\\\\\\\\\\\\\\_ME\\\\\\\\\\\\\\\_STRONG\\\\\\\\\\\\\\\_JWT\\\\\\\\\\\\\\\_SECRET

# Origin of the SPA as seen by the browser (must match JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT on app server)
CORS\\\\\\\\\\\\\\\_ORIGIN=http://<APP\\\\\\\\\\\\\\\_PUBLIC\\\\\\\\\\\\\\\_IP\\\\\\\\\\\\\\\_OR\\\\\\\\\\\\\\\_DOMAIN>:3080

# Strict OIDC SSO (keep disabled until staging verification is complete)
OIDC\_ISSUER=https://<HUB\_HOST>
OIDC\_DISCOVERY\_URL=https://<HUB\_HOST>/api/sso/.well-known/openid-configuration
OIDC\_CLIENT\_ID=<REGISTERED\_APP\_CLIENT\_ID>
OIDC\_REDIRECT\_URI=https://<APP\_PUBLIC\_DOMAIN\_OR\_IP>/auth/oidc/callback
OIDC\_SCOPES=openid profile email
SSO\_OIDC\_ENABLED=false
SSO\_LEGACY\_BRIDGE\_ENABLED=true
```

```bash
chmod 600 Backend/.env
```

If you already have secrets in a **root** `.env` from an older layout, either move those keys into **`Backend/.env`** or run Compose with `--env-file` pointing at your file; interpolation only reads the env file you pass (or the default **root** `.env` if you omit `--env-file`).

OIDC prerequisite: register the exact callback URI from `OIDC\_REDIRECT\_URI` in Hub application settings (`sso\_mode=oidc`, `oauth\_client\_id`, redirect URI allowlist) before setting `SSO\_OIDC\_ENABLED=true`.

### 5.2 Start API + database

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml build --no-cache
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d
docker compose --env-file Backend/.env -f docker-compose.backend.yml ps
```

### 5.2A Upload storage (Synology NAS on staging/production)

Uploaded files (berthing photos, NOR attachments, SI PDFs, sub-process documents) are stored on disk under **`UPLOAD\_DIR`** (default **`/var/jps/uploads`** inside **`jps-api`**). PostgreSQL stores relative `stored_path` metadata only.

**Staging and production** use the shared Synology NAS. Set **`UPLOAD\_HOST\_PATH`** in **`Backend/.env`** to the NAS folder mounted on the API host; compose bind-mounts it into the container:

| Environment | File Station | Example `UPLOAD_HOST_PATH` |
|-------------|--------------|----------------------------|
| Staging | `172.30.1.94/dev/JETTYPLANNING` | `/mnt/synology/dev/JETTYPLANNING` |
| Production | `172.30.1.94/JETTYPLANNING` | `/mnt/synology/JETTYPLANNING` |

Full cutover and migration steps: [SYNOLOGY-INTEGRATION.md](../Plan/SYNOLOGY-INTEGRATION.md).

> **Docker Compose v5 — `UPLOAD_HOST_PATH` not interpolated via `--env-file`**
> On Docker Compose v5 (verified on v5.0.2), the `--env-file` flag does **not** propagate variables into compose-file volume interpolation. `UPLOAD_HOST_PATH` will silently fall back to the `jps_uploads` named volume even when correctly set in `Backend/.env`. To ensure the bind mount is applied, **source the env file into the shell first** before any `up --force-recreate` or `up -d` that changes the volume:
>
> ```bash
> set -a && source Backend/.env && set +a
> docker compose -f docker-compose.backend-api-only.yml up -d --force-recreate jps-api
> ```
>
> Confirm with `docker inspect jps-api | grep -A 10 '"Mounts"'` — you must see `"Type": "bind"` and the correct `"Source"` path. This applies any time `UPLOAD_HOST_PATH` changes (e.g. switching from host disk to NAS, or updating the NAS path).

**Local dev / machines without NAS:** omit `UPLOAD\_HOST\_PATH` — compose uses named volume **`jps\_uploads`** at `/var/jps/uploads` so files survive container rebuilds.

**Do not** use ephemeral paths such as **`/tmp/jps-uploads`** without a volume or NAS bind: a container recreate wipes **`/tmp`** while DB metadata remains, causing filenames to appear in the UI with broken preview/download.

**Never run `docker compose down -v` on production** — the **`-v`** flag deletes named volumes, including **`jps\_pgdata`**. With NAS, uploads live on the share; **`jps\_uploads`** may still exist as an unused fallback volume until removed manually.

After **`docker compose up`**, confirm startup logs show:

```text
Upload directory: /var/jps/uploads (writable)
```

#### One-time migration from `/tmp/jps-uploads` (existing servers)

If the API previously used **`/tmp/jps-uploads`** without a volume, rescue any files still in the running container **before** recreating **`jps-api`** with the updated compose:

```bash
cd /opt/jetty-planning-system
docker exec jps-api find /tmp/jps-uploads -type f 2>/dev/null || true
mkdir -p ./upload-rescue
docker cp jps-api:/tmp/jps-uploads/. ./upload-rescue/ 2>/dev/null || true
git pull   # or deploy updated docker-compose.backend.yml
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --build jps-api
docker cp ./upload-rescue/. jps-api:/var/jps/uploads/
docker exec jps-api find /var/jps/uploads -type f
```

Files uploaded before the last container recreate that were already lost from **`/tmp`** cannot be recovered from disk — users must re-upload those documents (DB rows may still show filenames until replaced or deleted). Step-by-step manual restore (SQL lookup, `scp`, `docker cp`, verification): [MANUAL-UPLOAD-RESTORE-GUIDE.md](./MANUAL-UPLOAD-RESTORE-GUIDE.md).

#### One-time migration from `jps_uploads` volume to NAS

When moving from the Docker volume to Synology, see [SYNOLOGY-INTEGRATION.md §5](../Plan/SYNOLOGY-INTEGRATION.md) (backup, copy to NAS, set `UPLOAD\_HOST\_PATH`, recreate `jps-api`).

#### Backup uploads

**NAS (staging/production):** back up the host mount path (e.g. rsync or Synology snapshot). Example if still using the named volume locally:

```bash
docker run --rm -v jps\_uploads:/data -v $(pwd):/backup alpine \\
  tar czf /backup/jps-uploads-$(date +%F).tar.gz -C /data .
```

### 5.3 Migrations

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-db pg\\\\\\\\\\\\\\\_isready -U ${POSTGRES\\\\\\\\\\\\\\\_USER:-jps\\\\\\\\\\\\\\\_user} -d ${POSTGRES\\\\\\\\\\\\\\\_DB:-jps\\\\\\\\\\\\\\\_db}
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate
```

### 5.4 Verify API from the app server (optional)

From **app** server (SSH):

```bash
curl -sS -o /dev/null -w "%{http\\\\\\\\\\\\\\\_code}\\\\\\\\\\\\\\\\n" http://172.28.92.57:3000/api/v1/
```

You should get a non-connection-refused response (e.g. **401** or **404** on a sub-path is fine; **000** means network/SG).

\---

## 6\. App server (`172.28.92.56`)

### 6.1 Point nginx at the backend private IP

Edit the upstream in `Frontend/nginx.alicloud-app.conf` (default in repo is `172.28.92.57`):

```bash
cd /opt/jetty-planning-system
nano Frontend/nginx.alicloud-app.conf
```

Ensure:

```nginx
upstream jps\\\\\\\\\\\\\\\_backend {
    server 172.28.92.57:3000;
```

(use your real **backend** private IP)

### 6.2 Root `.env` — `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL` + `JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT` (same origin)

The SPA must call the API **through the app host** (so paths match nginx). On **`172.28.92.56`** use host port **3080** (see §1.1). Example if the app’s public IP is `203.0.113.10`:

```bash
cd /opt/jetty-planning-system
cat << 'EOF' > .env
JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT=3080
VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL=http://203.0.113.10:3080/api/v1
EOF
chmod 600 .env
nano .env
```

Replace with your **public** app IP or DNS and the **same** port as `JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT`. With HTTPS later: `https://app.example.com/api/v1` and terminate TLS on the app server (or a load balancer).

> Root `.env` is **not** copied into the Docker build context (`Frontend/.dockerignore`). Compose passes `VITE_API_BASE_URL` as a **build-arg** (see `Frontend/Dockerfile`). `JPS_FE_PORT` controls the host port mapping in `docker-compose.app.yml`.

### 6.2A Jetty Live — create `rtsp-stream-viewer/.env` (app host only)

Jetty Live CCTV uses a **separate host process** (`rtsp-stream-viewer`), not the `jps-fe` Docker container. This file is **gitignored** — you must create it on **every app server** (greenfield and after clone). Do **not** skip it when deploying.

**Repo path:** if you cloned into a nested folder, use e.g. `/opt/jetty-planning-system/Jetty-Planning-System/rtsp-stream-viewer`; otherwise `/opt/jetty-planning-system/rtsp-stream-viewer`.

```bash
cd /opt/jetty-planning-system/rtsp-stream-viewer
# or: cd /opt/jetty-planning-system/Jetty-Planning-System/rtsp-stream-viewer

cp .env.example .env
nano .env
chmod 600 .env
```

Edit **`.env`** (required keys):

```bash
RTSP_URL=rtsp://<user>:<password>@<camera-ip>:554/Stream1
RTSP_TRANSPORT=tcp
HTTP_PORT=3081
WS_PORT=9999
STREAM_OUTPUT_FPS=1
STREAM_MPEG1_RATE=25
STREAM_SCALE=640:-1
STREAM_IDLE_STOP_MS=30000
STREAM_CORS_ORIGINS=http://<APP_PUBLIC_IP>:3080,http://172.28.92.56:3080
```

| Variable | Why |
|----------|-----|
| `RTSP_URL` | Default camera when no jetty URL is passed; jetty-specific URLs come from Master Jetty / schematic. |
| `HTTP_PORT=3081` | **3080** is used by `jps-fe`; stream HTTP must not conflict. |
| `WS_PORT=9999` | nginx proxies `/jetty-live-ws` to this port on the host. |
| `STREAM_OUTPUT_FPS=1` | Throttle via **`-vf fps=1`** (display rate). |
| `STREAM_MPEG1_RATE=25` | Valid **mpeg1video** encoder `-r` (MPEG-1 does not support `-r 1`). |
| `STREAM_SCALE=640:-1` | Downscale for HEVC/H.265 cameras before MPEG-1 encode. |
| `STREAM_IDLE_STOP_MS=30000` | Stop FFmpeg 30 s after the last viewer closes the Jetty Live tab. |

Install dependencies and enable the systemd unit (first time only):

```bash
cd /opt/jetty-planning-system/rtsp-stream-viewer   # adjust nested path if needed
npm ci
sudo systemctl enable --now jps-jetty-live
```

After **any** change to **`rtsp-stream-viewer/.env`** or stream code:

```bash
sudo systemctl restart jps-jetty-live
curl -s http://127.0.0.1:3081/api/health
```

Idle (no viewers): `"ffmpegRunning": false`, `"viewerCount": 0` is **normal**. Open **`/jetty-live`** from the schematic to start FFmpeg.

Full steps (systemd unit file, UFW for Docker → host **3081/9999**, camera network tests): **[JETTY-LIVE-STREAM-DEPLOYMENT.md](./JETTY-LIVE-STREAM-DEPLOYMENT.md)**.

### 6.3 Build and run frontend

```bash
cd /opt/jetty-planning-system
docker compose -f docker-compose.app.yml build --no-cache
docker compose -f docker-compose.app.yml up -d
docker compose -f docker-compose.app.yml ps
```

Open in a browser: `http://<APP\\\\\\\\\\\\\\\_PUBLIC\\\\\\\\\\\\\\\_IP>:3080` (or your domain and chosen port). If you use the default **`JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT=3001`** on a clean host, use `:3001` instead everywhere.

\---

## 7\. Port reference (two-server)

|Location|Service|Host port|Who can reach it|
|-|-|-|-|
|App|nginx (SPA + proxy)|**3080** (recommended on busy host `172.28.92.56`); **3001** (compose default on a clean host)|Internet (or restricted SG)|
|App|Jetty Live stream HTTP (host, systemd)|**3081**|localhost + Docker bridge only (nginx → host); **§6.2A**|
|App|Jetty Live WebSocket (host, systemd)|**9999**|localhost + Docker bridge only (nginx → host); **§6.2A**|
|Backend|Node API|**3000** (default; free on `172.28.92.57` per §1.2)|**App private IP only** (SG)|
|Backend|PostgreSQL|(Docker internal)|**Not** exposed on SG|

**App server `172.28.92.56` — ports already in use (do not use for JPS):** 22, 80, 3000, 3001, 3002, 3005, 3010, 3011, 8010 (from `sudo ss -tuln`).

**Backend server `172.28.92.57` — ports already in use on host:** 22, 3001, 3003, 4000, 5001, 5002, 5432, 5434, 5422 (plus localhost 5433). JPS API recommended on **3000**. JPS Postgres published on **loopback `5436`** only (not `0.0.0.0:5432`).

\---

## 4.6 Staging / repeat deployment (updates only)

Use this when JPS is **already** running on staging and you are deploying **new code** (e.g. new migrations `042+`, API/UI changes). **Do not** treat this like a greenfield install.

|Do|Don’t|
|-|-|
|On **backend:** `git pull` → `docker compose --env-file Backend/.env -f docker-compose.backend.yml build` → `up -d` → **`docker compose ... exec -T jps-api npm run migrate`**|**`docker compose down -v`** (destroys Postgres volume and all data).|
|On **app:** `git pull` → rebuild and `up -d` for `docker-compose.app.yml`|Re-run **user \& role bootstrap** SQL or **dev seed** scripts (`reset-and-seed-dev.sql`, `023`/`024` seeds) on staging **unless** you intentionally reset a **non-production** database.|
|On **app:** confirm **`rtsp-stream-viewer/.env`** exists (**§6.2A**); after stream code changes: `npm ci` in that folder + **`sudo systemctl restart jps-jetty-live`**|Assume `.env.example` alone is enough — **`.env` is gitignored** and must be created on the server.|
|Expect **`npm run migrate`** to apply **only migrations that have not yet run** (tracked in **`schema\\\\\\\\\\\\\\\_migrations`**; see `Backend/scripts/run-migrations.js`). Already-applied files — including schema for **`users`**, **`roles`**, **`permissions`**, **seed users** — are **not** executed again.|Manually re-import **`002\\\\\\\\\\\\\\\_seed\\\\\\\\\\\\\\\_first\\\\\\\\\\\\\\\_user.sql`**-style dumps if accounts already exist (risk duplicate or conflicting ids).|

**Staging RBAC:** If users and roles are **already** configured on the server, a normal **`git pull` + `migrate`** is enough for new feature migrations (e.g. jetty layout, `shifting\\\\\\\\\\\\\\\_out`, `updated\\\\\\\\\\\\\\\_by`). Reserve full re-seed for **new environments only**, documented in §2 / reset scripts.

**Order for an update:** **Backend server first** (API + DB + migrate), then **App server** (rebuild SPA if `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL` or frontend changed).

\---

## 8\. Operational commands

**Backend**

```bash
cd /opt/jetty-planning-system
docker compose --env-file Backend/.env -f docker-compose.backend.yml logs -f
docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate
docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --build
```

**Purge all transactional data (manual only — not a migration):** see [PURGE-TRANSACTIONAL-DATA.md](../Troubleshoot/PURGE-TRANSACTIONAL-DATA.md). On the backend host: `bash Backend/scripts/run-purge-transactional-data.sh` (type `PURGE` when prompted).

**App**

```bash
cd /opt/jetty-planning-system
docker compose -f docker-compose.app.yml logs -f
docker compose -f docker-compose.app.yml up -d --build
```

\---

## 9\. Checklist

* \[ ] **Directory:** `/opt/jetty-planning-system` created on **both** servers
* \[ ] **GitHub:** `git clone` or `git pull` works on both servers (HTTPS/PAT or SSH deploy key)
* \[ ] VPC: app can `curl` backend `http://<BACKEND\\\\\\\\\\\\\\\_PRIVATE\\\\\\\\\\\\\\\_IP>:3000/...`
* \[ ] Backend SG: **3000** from **app private IP** only; **5432** not open
* \[ ] App SG: **3080** (or chosen `JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT`) for JPS users; **22** restricted
* \[ ] Backend `.env`: `POSTGRES\\\\\\\\\\\\\\\_PASSWORD`, `JWT\\\\\\\\\\\\\\\_SECRET`, `CORS\\\\\\\\\\\\\\\_ORIGIN` matches SPA URL (including **:3080** if used)
* \[ ] `Frontend/nginx.alicloud-app.conf` upstream = backend private IP
* \[ ] App `.env`: `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL` = `http(s)://<same-host-as-SPA>/api/v1`
* \[ ] Migrations ran on backend: `docker compose --env-file Backend/.env -f docker-compose.backend.yml exec -T jps-api npm run migrate`
* \[ ] UI loads and login/API works through **one** browser origin

\---

## 10\. Troubleshooting

* **Browser CORS errors:** `CORS\\\\\\\\\\\\\\\_ORIGIN` on backend must exactly match the SPA origin (scheme, host, port).
* **API 502 from nginx:** Backend container down, wrong private IP in `Frontend/nginx.alicloud-app.conf`, or SG blocks **app → backend:3000**.
* **Wrong API host in SPA:** Rebuild app image after changing `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL`: `docker compose -f docker-compose.app.yml up -d --build`.
* **Bind / start fails (“port already allocated”):** Run `sudo ss -tuln`, pick a host port not listed, set `JPS\\\\\\\\\\\\\\\_FE\\\\\\\\\\\\\\\_PORT`, update SG + `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL` + backend `CORS\\\\\\\\\\\\\\\_ORIGIN`, then rebuild.
* **DB errors on backend:** `docker compose --env-file Backend/.env -f docker-compose.backend.yml logs jps-db jps-api`.
* **pgAdmin or desktop tools → remote JPS Postgres:** Use an SSH tunnel and optional localhost-only Docker port mapping; full steps and “where we left off” are in [PGADMIN-ALICLOUD-DB-TUNNEL.md](PGADMIN-ALICLOUD-DB-TUNNEL.md).

\---

## 11\. TLS (recommended for production)

Terminate HTTPS on the **app** server (nginx on host or container + certificates) and:

* Serve the SPA over **443**
* Keep proxying `/api/` and `/uploads/` to `https://` or `http://` backend as appropriate (internal VPC often stays HTTP)

Update `VITE\\\\\\\\\\\\\\\_API\\\\\\\\\\\\\\\_BASE\\\\\\\\\\\\\\\_URL` and `CORS\\\\\\\\\\\\\\\_ORIGIN` to use **`https://`**. If users reach JPS only on **443**, you may drop a high port like **3080** from the public URL or hide it behind a load balancer.

