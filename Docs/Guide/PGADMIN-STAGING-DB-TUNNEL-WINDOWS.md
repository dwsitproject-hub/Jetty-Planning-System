# Connect Local pgAdmin to Staging DB (Windows, no public DB port)

This guide documents the exact working flow to connect local pgAdmin to staging PostgreSQL through SSH tunnel.

## Scope and current server mapping

- App server (frontend / jump candidate): `172.28.92.56`
- DB server (JPS API + JPS DB host): `172.28.92.57`
- JPS DB Docker mapping on DB host: `127.0.0.1:5436 -> 5432`

Security intent:

- Do not expose DB port publicly in security groups.
- Access DB only through SSH (`22`) and local port forwarding.

## Prerequisites

1. You can SSH to DB server from your Windows machine.
2. On DB server, `jps-db` is mapped to loopback host port:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Expected for JPS DB:

- `jps-db    127.0.0.1:5436->5432/tcp`

3. DB credentials are known from `Backend/.env` (or `docker exec jps-db env`):
   - `POSTGRES_DB`
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`

## Step 1 - Start SSH tunnel on Windows PowerShell

Run this from your local Windows PowerShell (not from inside the server shell):

```powershell
ssh -N -L 5433:127.0.0.1:5436 root@172.28.92.57
```

Notes:

- First-time connection can show host fingerprint prompt.
- Type `yes` to continue, then enter password.
- This terminal will appear idle/hanging; that is normal.
- Keep this window open while using pgAdmin.

## Step 2 - Verify local tunnel endpoint

Open a second PowerShell window and run:

```powershell
Test-NetConnection 127.0.0.1 -Port 5433
```

Success indicator:

- `TcpTestSucceeded : True`

If false, check:

- Tunnel window is still open.
- No local app already uses port `5433`.
- SSH login/route to `172.28.92.57` is valid.

## Step 3 - Configure pgAdmin

In pgAdmin 4, create a new server registration.

### General tab

- Name: `JPS Staging (Tunnel)`

### Connection tab

- Host name/address: `127.0.0.1`
- Port: `5433`
- Maintenance database: `<POSTGRES_DB>` (or `postgres`)
- Username: `<POSTGRES_USER>`
- Password: `<POSTGRES_PASSWORD>`
- Save password: optional

Click `Save`.

## Step 4 - Troubleshooting quick checks

1. Ensure pgAdmin uses `127.0.0.1` and local tunnel port `5433` (not `172.28.92.57` and not `5436`).
2. Confirm tunnel command is running in local PowerShell.
3. Confirm DB credentials from JPS env are correct.
4. If local `5433` is occupied, use another local port, for example:

```powershell
ssh -N -L 5434:127.0.0.1:5436 root@172.28.92.57
```

Then set pgAdmin port to `5434`.

## Step 5 - End session

When finished, stop the tunnel by returning to the tunnel PowerShell window and pressing `Ctrl + C`.
