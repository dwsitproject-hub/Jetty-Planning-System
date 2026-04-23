# Soft delete (backend)

Migration **`007_soft_delete_all.sql`** adds **`deleted_at TIMESTAMPTZ`** (NULL = active) on all business tables.

## Behaviour

- **Lists and reads** only return rows with **`deleted_at IS NULL`**.
- **Uniques** (username, email, role name, `material_key`, junction pairs, `(operation_id, material_key)` for materials) apply only to **active** rows via partial unique indexes — you can re-create after a soft delete.
- **Login / `/users/me`** ignore soft-deleted users.

## HTTP soft-delete endpoints

| Method | Path | Notes |
|--------|------|--------|
| DELETE | `/api/v1/ports/:id` | Blocked if port still has active jetties |
| DELETE | `/api/v1/jetties/:id` | Blocked if any active operation references the jetty |
| DELETE | `/api/v1/standard-rates/:id` | |
| DELETE | `/api/v1/shipping-instructions/:id` | Blocked if any active operation references the SI |
| DELETE | `/api/v1/operations/:id` | Cascades: materials, QC surveys + documents, quantity checks |
| DELETE | `/api/v1/operations/:id/materials/:materialId` | Single material row |
| DELETE | `/api/v1/qc-surveys/:id` | Cascades QC documents |
| DELETE | `/api/v1/quantity-checks/:id` | |

**Users:** `DELETE /api/v1/users/:id` (JWT) — soft-deletes user and active `user_roles`; cannot delete self.

**RBAC** (all under `/api/v1/rbac`, JWT required):

| Method | Path | |
|--------|------|--|
| GET/POST | `/rbac/roles` | List / create role |
| GET/PUT/DELETE | `/rbac/roles/:id` | System roles cannot be deleted |
| GET/POST/DELETE | `/rbac/roles/:roleId/permissions` (+ `/:permissionId`) | Link permission to role |
| GET/POST/PUT/DELETE | `/rbac/permissions` (+ `/:id`) | Permission CRUD; delete cascades junction |
| GET/POST/DELETE | `/rbac/users/:userId/roles` (+ `/:roleId`) | Assign / remove role from user |

**`sla_config`**, **`jetty_status_history`**: have `deleted_at` for schema consistency; normal APIs do not delete them.

## Apply

```bash
docker compose exec jps-api npm run migrate
docker compose restart jps-api
```
