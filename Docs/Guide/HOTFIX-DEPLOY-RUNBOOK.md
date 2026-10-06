# Hotfix — plan, deploy, and rollback runbook

Use this runbook when production needs an **urgent, small, targeted fix** (bug patch) without waiting for a full release cycle. It covers planning, staging validation, production deploy on the **three-server** layout, and **fast rollback**.

**Related docs:**

- [STAGING-3-SERVER-DEPLOY-RUNBOOK.md](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md) — full staging setup
- [PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md](./PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md) — production topology
- [STAGING-3-SERVER-DEPLOY-RUNBOOK.md §7](./STAGING-3-SERVER-DEPLOY-RUNBOOK.md) — generic rollback pattern

**Deploy with the `.sh` scripts** (preferred). Use the manual commands only if a script fails.

| Server | Script (from `/opt/jetty-planning-system`) |
|--------|--------------------------------------------|
| **App** | `bash Backend/scripts/deploy-prod-frontend-three-server.sh deploy` |
| **API** | `bash Backend/scripts/deploy-prod-api-three-server.sh deploy` |
| **DB** | No code deploy — Postgres stays up |

---

## 1. When to use a hotfix

| Use a hotfix branch | Use a normal release (`main` / feature branch) |
|---------------------|-----------------------------------------------|
| Production is broken or severely degraded | Planned feature or multi-file change |
| Fix is **small** (ideally 1–3 commits, one area) | Includes **new migrations** you want batched with other work |
| Staging can validate the fix quickly | Needs full regression / UAT cycle |
| You need rollback in minutes | You can tolerate longer deploy windows |

**Hotfix scope examples:** single API route bug, missing SQL join, wrong validation, frontend display fix tied to one endpoint.

**Not ideal for hotfix:** schema migrations that are hard to reverse, large refactors, multi-service changes without staging proof.

---

## 2. Production topology (reminder)

| Server | Typical hostname | Role | Hotfix usually touches? |
|--------|------------------|------|-------------------------|
| **App** | e.g. ECS-FE | nginx + React SPA (`docker-compose.app.yml`, port **3080**) | Only if the fix includes **frontend** changes |
| **Backend / API** | e.g. **ECS-DB** (naming varies) | Node API (`docker-compose.backend-api-only.yml`, port **3000**) | **Yes** — most backend hotfixes |
| **DB** | dedicated Postgres host | PostgreSQL only | **No** — unless the hotfix is a manual data correction |

Repo path on deploy hosts: **`/opt/jetty-planning-system`**

Users reach: **`http://<APP_PUBLIC>:3080`** → nginx proxies **`/api/`** → Backend **`:3000`**.

---

## 3. Hotfix planning checklist

Before merging or deploying, answer these:

| # | Question | Notes |
|---|----------|--------|
| 1 | **Root cause confirmed?** | Reproduce on staging; capture expected error (500 message, stack trace, SQL error). |
| 2 | **Which servers change?** | Backend only / App only / Both. |
| 3 | **Migrations required?** | If **no** → rollback is git + rebuild only. If **yes** → plan forward-only migrate + optional DB restore rollback. |
| 4 | **Staging tested?** | Same branch/commit as production will run. |
| 5 | **Rollback SHA recorded?** | Save production commit **before** deploy (§5). |
| 6 | **Smoke test defined?** | 2–5 concrete UI/API steps after deploy. |
| 7 | **Maintenance window needed?** | API restart ~1–2 min; users may see brief errors during rebuild. |

---

## 4. Development workflow

### 4.1 Branch naming

```text
hotfix/<short-description>
```

Example: `hotfix/shiftout`

### 4.2 Implement and push

1. Fix on a branch from current production baseline (or `main`).
2. Keep the diff **minimal** — one logical change.
3. Push branch to GitHub:

   ```bash
   git push -u origin hotfix/<name>
   ```

4. Open a PR to `main` when convenient (can deploy from the hotfix branch first).

### 4.3 Validate on staging

On the **staging API** host (preferred):

```bash
cd /opt/jetty-planning-system
export DEPLOY_BRANCH=hotfix/<name>
# export RUN_MIGRATE=1   # only if this hotfix adds Backend/migrations
bash Backend/scripts/deploy-prod-api-three-server.sh deploy
```

If the hotfix includes frontend, on the **staging App** host (`172.28.92.56`). Repo root is the nested path (staging only; production App stays `/opt/jetty-planning-system`):

```bash
export JPS_REPO_DIR=/opt/jetty-planning-system/Jetty-Planning-System
cd "$JPS_REPO_DIR"
export DEPLOY_BRANCH=hotfix/<name>
bash Backend/scripts/deploy-prod-frontend-three-server.sh deploy
```

Run your **smoke test** on staging UI (same steps you will use on production).

**Do not deploy to production until staging passes.**

Manual fallback (if the script fails) is in §6.2.

---

## 5. Production — save rollback point

The deploy scripts **save the current HEAD automatically** before checkout:

- API: `/root/jps-prod-api-rollback-sha.txt`
- App: `/root/jps-prod-app-rollback-sha.txt`

Copy that SHA into your ticket after the script prints it.

### Optional: git tag (requires local git identity on server)

If `git tag` fails with *Committer identity unknown*, either skip the tag (SHA file is enough) or set **repo-local** identity once:

```bash
cd /opt/jetty-planning-system
git config user.email "deploy@yourcompany.com"
git config user.name "JPS Prod Deploy"

ROLLBACK_TAG="prod-pre-<hotfix-name>-$(date +%Y%m%d-%H%M)"
git tag -a "$ROLLBACK_TAG" -m "Production before hotfix/<name>"
git push origin "$ROLLBACK_TAG"
```

---

## 6. Production — deploy the hotfix

**Preferred: `.sh` scripts.** Set `DEPLOY_BRANCH` (and optional `DEPLOY_COMMIT`) to the same ref you tested on staging.

### 6.0 API server (backend / migrations)

```bash
ssh root@172.28.80.51
docker ps | grep jps-api    # confirm you are on the API host

cd /opt/jetty-planning-system
export DEPLOY_BRANCH=hotfix/<name>
# export DEPLOY_COMMIT=<sha>   # optional pin
# export RUN_MIGRATE=1         # only if this hotfix adds Backend/migrations
bash Backend/scripts/deploy-prod-api-three-server.sh deploy
```

Most code-only hotfixes **omit** `RUN_MIGRATE`.

### 6.1 App server (frontend)

Only if the hotfix includes frontend changes:

```bash
ssh root@172.28.80.50
cd /opt/jetty-planning-system
export DEPLOY_BRANCH=hotfix/<name>
# export DEPLOY_COMMIT=<sha>
bash Backend/scripts/deploy-prod-frontend-three-server.sh deploy
```

### 6.2 Manual fallback (script missing or failed)

**API host:**

```bash
cd /opt/jetty-planning-system
git fetch origin
git rev-parse HEAD | tee /root/jps-prod-api-rollback-sha.txt
git checkout hotfix/<name>
git pull origin hotfix/<name>
git log -1 --oneline

docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml build --no-cache jps-api
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d jps-api
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml logs --tail=25 jps-api
curl -sS http://127.0.0.1:3000/api/v1/health
# docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml exec -T jps-api npm run migrate
```

**App host:**

```bash
cd /opt/jetty-planning-system
git fetch origin
git rev-parse HEAD | tee /root/jps-prod-app-rollback-sha.txt
git checkout hotfix/<name>
git pull origin hotfix/<name>

docker compose -f docker-compose.app.yml build --no-cache jps-fe
docker compose -f docker-compose.app.yml up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/
curl -sS http://127.0.0.1:3080/api/v1/health
```

---

## 7. Production — smoke test

Define tests **before** deploy. Example template:

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open app URL, log in | Login works |
| 2 | Navigate to affected page | Page loads |
| 3 | Perform the previously broken action | Success (no 500 / error banner) |
| 4 | Optional: undo / related flow | Still works |

Record pass/fail in your ticket.

---

## 8. Rollback

Rollback is **redeploy the saved commit + rebuild**. No DB restore needed for **code-only** hotfixes.

### 8.1 Backend rollback (most common)

**Preferred:**

```bash
cd /opt/jetty-planning-system
bash Backend/scripts/deploy-prod-api-three-server.sh rollback
# or: export ROLLBACK_SHA=cd5c1a7e317881a4cc592bfa31f2ab14c38ce331
```

**Manual fallback:**

```bash
cd /opt/jetty-planning-system
git checkout "$(cat /root/jps-prod-api-rollback-sha.txt)"
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml build --no-cache jps-api
docker compose --env-file Backend/.env -f docker-compose.backend-api-only.yml up -d jps-api
curl -sS http://127.0.0.1:3000/api/v1/health
```

App rollback: `bash Backend/scripts/deploy-prod-frontend-three-server.sh rollback`.

Re-run smoke tests. Expect the **original bug to return** until the fix is redeployed.

### 8.2 What rollback does and does not do

| Area | Code-only hotfix rollback |
|------|---------------------------|
| **Database rows** | Not reverted — e.g. shift-out flags set while hotfix was live remain |
| **Uploaded files** | Unchanged |
| **Migrations** | Not undone — if hotfix ran migrations, rollback needs a forward fix or DB restore |
| **API behaviour** | Returns to pre-hotfix code (bug may reappear) |

### 8.3 Hotfix with migrations — extra caution

If you ran `npm run migrate` for the hotfix:

- **Rollback git + rebuild does not reverse migrations.**
- Options: ship a **forward-fix migration**, or restore DB from a **pre-deploy dump** (heavy; see [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md)).

Prefer **avoiding migrations in hotfixes** when possible.

---

## 9. After production is stable

1. **Merge** `hotfix/<name>` → `main` on GitHub.
2. On deploy hosts, return to tracking `main`:

   ```bash
   cd /opt/jetty-planning-system
   git fetch origin
   git checkout main
   git pull origin main
   git log -1 --oneline
   ```

3. Keep `/root/jps-prod-api-rollback-sha.txt` and `/root/jps-prod-app-rollback-sha.txt` for a few days, then archive or delete.
4. Close the incident ticket with: root cause, fix commit, rollback SHA, smoke test results.

---

## 10. Cheat sheet (copy/paste)

```bash
# === API host (172.28.80.51) ===
cd /opt/jetty-planning-system
export DEPLOY_BRANCH=hotfix/<name>
# export RUN_MIGRATE=1
bash Backend/scripts/deploy-prod-api-three-server.sh deploy
bash Backend/scripts/deploy-prod-api-three-server.sh rollback

# === App host (172.28.80.50) — frontend only ===
cd /opt/jetty-planning-system
export DEPLOY_BRANCH=hotfix/<name>
bash Backend/scripts/deploy-prod-frontend-three-server.sh deploy
bash Backend/scripts/deploy-prod-frontend-three-server.sh rollback
```

Manual commands if a script fails: §6.2.

---

## 11. Case study: `hotfix/shiftout` (Sep 2026)

### Problem

`POST /api/v1/operations/:id/shifting-out` returned **500 Internal server error** on production. At-Berth **Confirm shift-out** showed a red error banner.

### Root cause

In `Backend/src/routes/operations.js`, the shift-out handler used `OP_SELECT` (which references `sp.vessel_name`) but the pre-check SQL **did not join** `shipment_plans sp`. PostgreSQL error: `missing FROM-clause entry for table "sp"`.

Introduced when shipment plans changed `OP_SELECT` from `si.vessel_name` to `sp.vessel_name`; the shift-out inline query was not updated.

### Fix

One line added to the shift-out `SELECT`:

```sql
LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id
```

Branch: **`hotfix/shiftout`** · Commit: **`90b2d86`**

### Validation

| Environment | Result |
|-------------|--------|
| Staging | Shift-out + undo confirmed working |
| Production rollback SHA (before deploy) | `cd5c1a7e317881a4cc592bfa31f2ab14c38ce331` |

### Deploy scope

| Server | Changed? |
|--------|----------|
| Backend (ECS-DB) | Yes — rebuild `jps-api` |
| App | No |
| DB | No |
| Migrations | None |

### Smoke test

1. Open At-Berth Executions.
2. Shift out a berthed vessel with a required remark.
3. Expect success toast; vessel moves to Allocation incoming queue.
4. Optional: undo shift-out or re-dock.

### Rollback

Checkout `cd5c1a7e317881a4cc592bfa31f2ab14c38ce331` and rebuild `jps-api` (§8.1). Shift-out 500 returns until fix is redeployed; no DB restore needed.

---

*Document version: 2026-09-29 — three-server deploy/rollback via `deploy-prod-api-three-server.sh` and `deploy-prod-frontend-three-server.sh`.*
