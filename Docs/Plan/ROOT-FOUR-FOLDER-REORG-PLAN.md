# Plan — Root Reorganization (Reassessed)

## Objective

Split frontend/backend into self-contained app roots while keeping a **minimal root compatibility layer** so existing commands continue to work.

## Revised Constraints

- Root files are allowed.
- Fully split app ownership is still required.
- Existing command UX should be preserved where possible:
  - root `npm run dev`
  - root compose filenames and common invocation patterns.

## Most Important: Mapping Plan

This mapping is authoritative for execution.

### A) Keep at root (compatibility layer)

| Path | Action | Reason |
|---|---|---|
| `/Assets` | Keep | Main folder |
| `/Backend` | Keep | Main folder |
| `/Docs` | Keep | Main folder |
| `/Frontend` | Keep | Main folder |
| `/package.json` | Keep (rewrite as wrapper scripts) | Preserve root command UX |
| `/README.md` | Keep (or trim + point to Docs) | Entry onboarding |
| `/.gitignore` | Keep | Repo-wide ignore rules |
| `/.env.example` | Keep (compat template) | Existing setup path |
| `/docker-compose.backend.yml` | Keep (entrypoint) | Preserve existing root compose command |
| `/docker-compose.app.yml` | Keep (entrypoint) | Preserve deployment command paths |
| `/docker-compose.production.yml` | Keep (entrypoint) | Preserve deployment command paths |
| `/docker-compose.yml` | Keep (entrypoint) | Preserve local compose command path |

### B) Move to `Frontend` (self-contained app ownership)

| Old | New |
|---|---|
| `/vite.config.js` | `/Frontend/vite.config.js` |
| `/index.html` | `/Frontend/index.html` |
| `/public` | `/Frontend/public` |
| `/e2e` | `/Frontend/e2e` |
| `/playwright.config.js` | `/Frontend/playwright.config.js` |
| `/package-lock.json` | `/Frontend/package-lock.json` |
| `/.env` (frontend vars) | `/Frontend/.env` |
| `/Dockerfile` (frontend image) | `/Frontend/infra/Dockerfile` |
| `/nginx.conf` | `/Frontend/infra/nginx.conf` |
| `/nginx.alicloud-app.conf` | `/Frontend/infra/nginx.alicloud-app.conf` |
| `/scripts` (frontend-related items only) | `/Frontend/scripts` |

Notes:
- Root `package.json` remains, but frontend app dependencies/scripts become owned by `Frontend/package.json`.
- Root scripts should delegate to `Frontend` commands.

### C) Move to `Backend` (infra/deploy ownership)

| Old | New |
|---|---|
| backend/deploy internals currently in root compose definitions | `/Backend/infra/*` as canonical implementations |
| `/.dockerignore` (if still needed by backend root-context builds) | `/Backend/infra/.dockerignore.root-context` |
| `/scripts` (backend/deploy-related items) | `/Backend/scripts` or `/Backend/infra/scripts` |

Notes:
- Root compose files remain as compatibility entrypoints but should reference canonical backend/frontend paths.
- Canonical infra logic should live under `Backend/infra`.

### D) Move to `Docs`

| Old | New |
|---|---|
| `/scripts` (docs-only helpers) | `/Docs/scripts` |
| root operational notes that are not top-level onboarding (if any) | `/Docs/...` |

### E) Remove (generated/transient)

| Path | Action |
|---|---|
| `/dist` | Delete |
| `/node_modules` (root) | Delete after split install model |
| `/test-results` | Delete |
| `/.tmp-pdf-extract` | Delete |

## Command Compatibility Design

### Root npm behavior (must continue)
- Root `package.json` scripts become wrappers, for example:
  - `dev` delegates to frontend app (`Frontend`)
  - `build` delegates to frontend app
  - optional backend wrappers (`dev:api`, `migrate`) delegate to backend commands.

### Root compose behavior (must continue)
- Keep root filenames unchanged (`docker-compose.backend.yml`, etc.).
- Internally, point build contexts/dockerfiles/env paths to canonical locations under `Frontend` and `Backend`.

## Implementation Phases

### Phase 1 — Compatibility-first prep
1. Introduce wrapper scripts at root.
2. Define canonical infra files under `Backend/infra` and `Frontend/infra`.
3. Validate root commands still run before moving content.

### Phase 2 — File moves by ownership
1. Move frontend-owned files into `Frontend`.
2. Move infra/deploy internals into `Backend/infra`.
3. Keep root compatibility entrypoints stable.

### Phase 3 — Docs rewrite (blocking)
1. Update runbooks with preferred app-local commands.
2. Keep a root-compatible command section for backward compatibility.
3. Priority docs:
   - `Docs/ALICLOUD-DEPLOYMENT-GUIDE.md`
   - `Docs/Troubleshoot/LOCAL-FRONTEND-BACKEND-STARTUP.md`
   - `Docs/Troubleshoot/REBUILD-RESTART-CONTAINERS.md`
   - `Docs/TECH-SPEC-Jetty-Planning-System.md`

### Phase 4 — Cleanup
1. Remove generated/transient root artifacts.
2. Confirm root has only intentional compatibility files/folders.

## Risks and Mitigations

### 1) Wrapper drift
- **Risk:** root wrapper scripts diverge from app-local commands.
- **Mitigation:** treat root wrappers as thin pass-through only.

### 2) Compose path errors
- **Risk:** moved dockerfiles/contexts break root compose commands.
- **Mitigation:** test each compose file with config/up checks immediately after refactor.

### 3) Env confusion
- **Risk:** `.env` ownership unclear between root and app folders.
- **Mitigation:** document canonical env per app and what root compatibility reads.

### 4) Docs mismatch
- **Risk:** users run stale commands.
- **Mitigation:** update docs in the same PR and include old->new command map.

## Validation Checklist

### Root compatibility checks
- Root `npm run dev` works.
- Root `docker compose --env-file Backend/.env -f docker-compose.backend.yml up -d --build jps-api` works.

### App-local checks
- `Frontend`: install/dev/build/test works standalone.
- `Backend`: API startup/migration/compose works from backend-owned paths.

### Integration checks
- Frontend reaches backend with correct env.
- Core pages load and run: Dashboard, Allocation, Loading/Unloading, Verification.

## Deliverables

1. Updated mapping implemented exactly as above.
2. Self-contained `Frontend` and `Backend` ownership.
3. Preserved root command compatibility.
4. Updated runbooks/spec docs for new structure.
5. Root cleaned of non-essential generated clutter.

