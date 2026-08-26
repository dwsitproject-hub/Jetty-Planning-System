# Copy production data → staging, excluding user/identity tables

Refreshes the **staging** database (`172.28.92.60`) with a snapshot of **production** (`172.28.92.59`) master + transactional data, while **staging keeps its own** `users` / roles / permissions / port-access rows (so staging logins keep working, unaffected by production accounts).

**Servers:**

- Production DB: `172.28.92.59` (`docker-compose.backend.yml` or `Backend/infra/docker-compose.db.yml`, container `jps-db`)
- Staging DB: `172.28.92.60` (`Backend/infra/docker-compose.db.yml`, container `jps-db`)

**Related:** [PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md](./PRODUCTION-THREE-SERVER-DEPLOY-AND-FULL-DATA-MIGRATION.md) (full-copy the other direction), [THREE-SERVER-DB-CUTOVER-RUNBOOK.md](./THREE-SERVER-DB-CUTOVER-RUNBOOK.md).

---

## 0. What gets excluded, and why

**Tables excluded entirely** (staging keeps its own data — not overwritten):

| Table | Reason |
|---|---|
| `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_ports` | Identity/RBAC — staging logins, roles, and port-access assignments must survive the copy |
| `notifications`, `notification_deliveries` | Per-user inbox rows; `notifications.user_id` is `NOT NULL` so it can't be copied without a valid staging user |
| `schema_migrations` | Bookkeeping of *staging's own* applied migrations — must not be overwritten by production's history |

**Columns nulled out after copying** (table's data IS copied, but the "who" pointer is cleared since it would otherwise point at a production-only user id):

- `shipment_plans.approved_by_user_id`, `.exception_approver_user_id`, `.updated_by`
- `operations.exception_approver_user_id`, `.signoff_requested_by`, `.updated_by`
- `activity_logs.actor_user_id`
- `shipping_instruction_documents.uploaded_by`
- `operation_sub_processes.created_by`, `.updated_by`
- `operation_nor_details.created_by`, `.updated_by`

Everything else (jetties, ports, vessels/shipment plans, shipping instructions, operations, commodities, SI reference data, allocation/QC data, etc.) is copied as-is from production.

**Known side note — `ports` / `user_ports`:** `user_ports.port_id` is a `NOT NULL` FK to `ports(id)`. Truncating+reloading `ports` is done with FK checks temporarily suspended (see Step 4), so it won't fail — but if production and staging ever had *different* `ports.id` values for the same physical port, staging's `user_ports` rows could end up pointing at the wrong port. Step 6 includes a quick sanity check for this.

---

## 1. Preflight (once)

**Check `jps_user` is a superuser** on both hosts (needed for `--disable-triggers` / `session_replication_role`):

```bash
docker exec -T jps-db psql -U jps_user -d jps_db -c "SELECT usename, usesuper FROM pg_user WHERE usename='jps_user';"
```

Expect `usesuper = t`. If not, stop and let me know — the approach below needs adjusting.

**Confirm staging's schema is at least as new as production's** (staging must not be missing columns/tables production's dump will contain):

```bash
# On staging (.60)
docker exec -T jps-db psql -U jps_user -d jps_db -c "SELECT COUNT(*) FROM schema_migrations;"
# On production (.59)
docker exec -T jps-db psql -U jps_user -d jps_db -c "SELECT COUNT(*) FROM schema_migrations;"
```

Staging's count should be **≥** production's. If staging is behind, run `npm run migrate` on staging's API host first.

---

## 2. Dump production (on `172.28.92.59`)

```bash
ssh root@172.28.92.59
cd /opt/jetty-planning-system
STAMP=$(date +%Y%m%d_%H%M)
docker exec -t jps-db pg_dump -U jps_user -d jps_db -Fc --no-owner --no-acl \
  > "jps_db_prod_${STAMP}.dump"
ls -lh "jps_db_prod_${STAMP}.dump"
```

## 3. Copy the dump to staging (on `172.28.92.59`, then verify on `.60`)

```bash
scp "jps_db_prod_${STAMP}.dump" root@172.28.92.60:/opt/jetty-planning-system/
```

```bash
ssh root@172.28.92.60
ls -lh "/opt/jetty-planning-system/jps_db_prod_${STAMP}.dump"
```

## 4. Safety backup of staging (on `172.28.92.60`)

Full backup of staging **before** touching anything — this is your rollback if anything goes wrong:

```bash
cd /opt/jetty-planning-system
STAMP_BAK=$(date +%Y%m%d_%H%M)
docker exec -t jps-db pg_dump -U jps_user -d jps_db -Fc --no-owner --no-acl \
  > "jps_db_staging_backup_${STAMP_BAK}.dump"
ls -lh "jps_db_staging_backup_${STAMP_BAK}.dump"
```

## 5. Clear staging's non-identity tables

Build the list of tables to wipe/reload (everything except the identity + notification + migration tables from §0), and truncate them with referential-integrity triggers momentarily suspended (so the `ports` ↔ `user_ports` FK doesn't block it):

```bash
EXCLUDE="'users','roles','permissions','role_permissions','user_roles','user_ports','notifications','notification_deliveries','schema_migrations'"

TABLES=$(docker exec -T jps-db psql -U jps_user -d jps_db -t -A -c "
  SELECT string_agg(quote_ident(tablename), ', ')
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename NOT IN (${EXCLUDE});
")
echo "$TABLES"   # sanity-check the list before running the truncate

docker exec -T jps-db psql -U jps_user -d jps_db -c "
  SET session_replication_role = 'replica';
  TRUNCATE TABLE ${TABLES} RESTART IDENTITY;
  SET session_replication_role = 'origin';
"
```

## 6. Restore production data into staging (excluding identity/notification/migration tables)

```bash
DUMP="/opt/jetty-planning-system/jps_db_prod_${STAMP}.dump"

docker exec -i jps-db pg_restore -U jps_user -d jps_db \
  --data-only --disable-triggers \
  --exclude-table-data=users \
  --exclude-table-data=roles \
  --exclude-table-data=permissions \
  --exclude-table-data=role_permissions \
  --exclude-table-data=user_roles \
  --exclude-table-data=user_ports \
  --exclude-table-data=notifications \
  --exclude-table-data=notification_deliveries \
  --exclude-table-data=schema_migrations \
  < "$DUMP"
```

`--disable-triggers` also lets rows with `created_by`/`approved_by`/etc. pointing at production-only user ids load without FK errors (they get cleared in the next step anyway).

**Sanity check `ports` alignment** (do this before relying on `user_ports`):

```bash
docker exec -T jps-db psql -U jps_user -d jps_db -c "SELECT id, name FROM ports ORDER BY id;"
```

Compare against what staging's `user_ports` previously assumed (or just re-check each staging user's port access in the Admin UI after the copy).

## 7. Null out the "who" columns that would otherwise point at production-only users

```bash
docker exec -T jps-db psql -U jps_user -d jps_db -c "
  UPDATE shipment_plans SET approved_by_user_id = NULL WHERE approved_by_user_id IS NOT NULL;
  UPDATE shipment_plans SET exception_approver_user_id = NULL WHERE exception_approver_user_id IS NOT NULL;
  UPDATE shipment_plans SET updated_by = NULL WHERE updated_by IS NOT NULL;
  UPDATE operations SET exception_approver_user_id = NULL WHERE exception_approver_user_id IS NOT NULL;
  UPDATE operations SET signoff_requested_by = NULL WHERE signoff_requested_by IS NOT NULL;
  UPDATE operations SET updated_by = NULL WHERE updated_by IS NOT NULL;
  UPDATE activity_logs SET actor_user_id = NULL WHERE actor_user_id IS NOT NULL;
  UPDATE shipping_instruction_documents SET uploaded_by = NULL WHERE uploaded_by IS NOT NULL;
  UPDATE operation_sub_processes SET created_by = NULL WHERE created_by IS NOT NULL;
  UPDATE operation_sub_processes SET updated_by = NULL WHERE updated_by IS NOT NULL;
  UPDATE operation_nor_details SET created_by = NULL WHERE created_by IS NOT NULL;
  UPDATE operation_nor_details SET updated_by = NULL WHERE updated_by IS NOT NULL;
"
```

## 8. Verify

```bash
docker exec -T jps-db psql -U jps_user -d jps_db -c "
  SELECT COUNT(*) AS users FROM users;                 -- unchanged (staging's own)
  SELECT COUNT(*) AS jetties FROM jetties;              -- now matches production
  SELECT COUNT(*) AS shipment_plans FROM shipment_plans;
  SELECT COUNT(*) AS operations FROM operations;
  SELECT COUNT(*) AS shipping_instructions FROM shipping_instructions;
"
```

Then in the browser: log into staging with a staging account (unaffected), and check shipment plans / operations / allocation show production-like data. Records copied from production will show blank/"unknown" for "approved by" / "updated by" fields — expected, since those were nulled in Step 7.

No API/app container restart is required — only data changed, not schema or code.

## 9. Rollback

Restore the Step 4 backup if anything looks wrong:

```bash
docker exec -T jps-db psql -U jps_user -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='jps_db';"
docker exec -T jps-db psql -U jps_user -d postgres -c "DROP DATABASE IF EXISTS jps_db WITH (FORCE);"
docker exec -T jps-db psql -U jps_user -d postgres -c "CREATE DATABASE jps_db OWNER jps_user;"
docker exec -i jps-db pg_restore -U jps_user -d jps_db --no-owner --no-acl < "jps_db_staging_backup_${STAMP_BAK}.dump"
```
