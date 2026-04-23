# pgAdmin → JPS PostgreSQL on Alicloud (SSH tunnel)

Use this note when you want **pgAdmin on your Windows PC** to connect to **`jps-db`** on the **backend ECS**, which often has **no public IP** and sits behind the same VPC as the **app/jump** server.

**Related:** [ALICLOUD-DEPLOYMENT-GUIDE.md](ALICLOUD-DEPLOYMENT-GUIDE.md) (deploy layout). For **local dev** password issues, see [pgadmin-connect-fix.md](pgadmin-connect-fix.md).

---

## Progress so far (resume here)

| Topic | Status / finding |
|--------|------------------|
| **Goal** | Reach JPS Postgres from pgAdmin via **SSH port forwarding** (no need to open PostgreSQL in the public security group). |
| **Layout** | Typical pattern: **App ECS** (public IP, e.g. `8.215.x.x`) → SSH → **Backend ECS** (private IP, e.g. `172.28.92.57`) where **`jps-db`** runs. |
| **Why `find` returned nothing** | On the server, the file may **not** be named `docker-compose.backend.yml`. The repo uses that name; the host might use `docker-compose.yml`, another path, or containers started without Compose. **Empty `find` output means “no file with that name,” not a broken command.** |
| **Why `127.0.0.1:5432` on the DB host can fail** | **`jps-db`** may have **no `ports:`** mapping, so Postgres is only on the Docker network. Another container (e.g. `infra-postgres`) may own **host** `0.0.0.0:5432`. Connecting to host **5432** can hit the **wrong** database. |
| **Planned fix (when you continue)** | Publish JPS Postgres only on **loopback**: `127.0.0.1:<HOST_PORT>:5432` (repo default **HOST_PORT = 5436** in `docker-compose.backend.yml`). Postgres **inside** the container stays on **5432**; the **left** number is the port **on the Linux host** you forward through SSH. |
| **Credentials** | Use **`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`** from the backend environment (e.g. `docker exec jps-db env \| grep POSTGRES_`), **not** the Linux `root` password. |

---

## Concepts (read once)

1. **Security group:** Keep **TCP 5432 closed** to the internet. The tunnel runs over **SSH (22)** only.
2. **Tunnel:** Your PC opens a **local** port (e.g. **5433**). SSH sends traffic to **`127.0.0.1:<HOST_PORT>` on the backend host**, where Docker should map to **`jps-db:5432`**.
3. **Jump host:** If you cannot SSH directly to the backend, connect **PC → app server → backend**, and forward through both hops (see below).

---

## Part A — Backend: expose Postgres on localhost only (do on DB server)

**Prerequisite:** Shell on the machine where `docker ps` shows **`jps-db`**.

### A.1 Find the real Compose file (if `find` for `docker-compose.backend.yml` is empty)

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Confirm **`jps-db`** exists on **this** host.

```bash
docker inspect jps-db --format '{{json .Config.Labels}}'
```

Look for Compose metadata, e.g. `com.docker.compose.project.config_files` or `com.docker.compose.project.working_dir`.

Search for any compose file:

```bash
find /opt /root /home -name "docker-compose*.yml" 2>/dev/null
```

### A.2 Add a host port mapping for `jps-db`

In the Compose file that defines **`jps-db`**, under that service, ensure you have (adjust **5436** if that port is busy on the host):

```yaml
    ports:
      - "127.0.0.1:5436:5432"
```

- **5436** = port on the **Linux host** (choose another free port if needed: `sudo ss -tlnp | grep 5436`).
- **5432** = port **inside** the container (leave as **5432**).

From the directory that contains that compose file:

```bash
docker compose -f <your-compose-file>.yml up -d
```

Verify:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep jps-db
```

Expect something like **`127.0.0.1:5436->5432/tcp`**.

### A.3 Test from the backend host

```bash
docker exec jps-db env | grep POSTGRES_
PGPASSWORD='<POSTGRES_PASSWORD>' psql -h 127.0.0.1 -p 5436 -U jps_user -d jps_db -c 'SELECT 1'
```

If this fails, fix the mapping or credentials before trying pgAdmin.

---

## Part B — Windows PC: SSH tunnel

Pick a **local** port for pgAdmin, e.g. **5433** (any free port on your PC).

### B.1 One-hop SSH (you can SSH straight to the backend)

**OpenSSH (PowerShell or Git Bash):**

```bash
ssh -N -L 5433:127.0.0.1:5436 root@<BACKEND_HOST>
```

- Replace **5436** if you chose a different host port in Part A.
- Leave this window open while using pgAdmin.

**PuTTY:** Connection → SSH → Tunnels → **Source port** `5433`, **Destination** `127.0.0.1:5436`, **Local**, Add, then open the session to `<BACKEND_HOST>`.

### B.2 Two-hop SSH (backend reachable only from app server)

**OpenSSH** (ProxyJump; you will authenticate to **both** hosts if required):

```bash
ssh -N -L 5433:127.0.0.1:5436 root@<BACKEND_PRIVATE_IP> -J root@<APP_PUBLIC_IP>
```

**PuTTY:** Easiest is two sessions: first connect to the app server with a tunnel **to the backend’s SSH**, or use **Connection → Proxy** to send the main session through the app server, then add **Local** tunnel `5433` → `127.0.0.1:5436` on the **backend** side. (Exact clicks depend on your PuTTY version; the logical target is always **backend loopback:5436**.)

---

## Part C — pgAdmin 4 registration

Create a **new server** (or connection):

| Field | Value |
|--------|--------|
| **Host** | `127.0.0.1` or `localhost` |
| **Port** | **5433** (your **local** tunnel port from Part B), **not** 5436 unless you intentionally use the same number locally |
| **Target database** | Usually `jps_db` (or your `POSTGRES_DB`) |
| **Username** | `jps_user` (or your `POSTGRES_USER`) |
| **Password** | Value of **`POSTGRES_PASSWORD`** on the backend (from `.env` / `docker exec` — see progress table) |

If pgAdmin reports **password authentication failed** while `psql` from inside the container works, see [pgadmin-connect-fix.md](pgadmin-connect-fix.md) (often an old volume initialized with a different password).

---

## Part D — Quick checklist when you return

1. [ ] On **backend**: `docker ps` shows **`jps-db`** with **`127.0.0.1:5436->5432`** (or your chosen host port).
2. [ ] On **backend**: `psql -h 127.0.0.1 -p 5436 ...` succeeds with **`jps_user`** / **`POSTGRES_PASSWORD`**.
3. [ ] On **PC**: SSH tunnel active, local port **5433** (or chosen) forwarding to **`127.0.0.1:5436`** on the backend.
4. [ ] **pgAdmin:** host **127.0.0.1**, port **5433**, DB/user/password as above.

---

## Repo reference

The checked-in **`docker-compose.backend.yml`** at the project root includes the optional **`127.0.0.1:5436:5432`** mapping for **`jps-db`**. After `git pull` on the backend server, align the server’s compose file with this if you deploy from the same repo.
