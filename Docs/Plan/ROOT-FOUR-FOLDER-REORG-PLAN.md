# Plan — Root Reorganization (Reassessed)

## Objective

Split frontend/backend into self-contained app roots while keeping a **minimal root compatibility layer** so existing commands continue to work.

## Revised Constraints

- Root files are allowed.
- Fully split app ownership is still required.
- Existing command UX should be preserved where possible:
  - root `npm run dev`
  - root compose filenames and common invocation patterns.

## Status Update (2026-04-13)

This plan has been **implemented** and **tested locally**.

### Implemented

- Frontend ownership moved to `Frontend/`:
  - `Frontend/package.json`, `Frontend/package-lock.json`
  - `Frontend/vite.config.js`, `Frontend/index.html`, `Frontend/playwright.config.js`
  - `Frontend/public`, `Frontend/e2e`, `Frontend/scripts`
  - `Frontend/Dockerfile`, `Frontend/nginx.conf`, `Frontend/nginx.alicloud-app.conf`, `Frontend/.dockerignore`
- Root compatibility preserved:
  - root `package.json` now delegates to `Frontend` (`npm --prefix Frontend run ...`)
  - root compose filenames preserved (`docker-compose.yml`, `docker-compose.app.yml`, `docker-compose.backend.yml`, `docker-compose.production.yml`)
- Canonical infra definitions added under `Backend/infra`:
  - `Backend/infra/docker-compose.backend.yml`
  - `Backend/infra/docker-compose.app.yml`
  - `Backend/infra/docker-compose.production.yml`
- Runbooks/docs updated to prefer app-local commands while retaining root-compatible commands.

### Tested locally

- `npm run build` from repo root (delegates to `Frontend`) — **pass**
- `docker compose -f docker-compose.yml config` — **pass**
- `docker compose -f docker-compose.app.yml config` — **pass**
- `docker compose --env-file Backend/.env -f docker-compose.backend.yml config` — **pass**
- `docker compose --env-file Backend/.env -f Backend/infra/docker-compose.backend.yml config` — **pass**
- Vite dev server validated from `Frontend` on `http://localhost:5173` after restarting stale pre-reorg process — **pass**

### Cleanup status

- Root transient folders cleaned: `dist`, `test-results`, `.tmp-pdf-extract`, plus legacy root `e2e/public/scripts`.
- Remaining non-target root folder: `node_modules` (Windows file lock on `esbuild`/`rollup` binaries in this session).

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

---

## Comprehensive execution plan (diligent)

This section turns the mapping above into an ordered, verifiable rollout. Follow it in sequence unless a step explicitly allows parallel work.

### 0) Preconditions

- [ ] Agree freeze window: no large feature merges during the move (reduces merge conflicts on moved paths).
- [ ] Baseline: `sit` (or target branch) builds and runs locally today (record commit SHA).
- [ ] List external consumers of repo layout: CI jobs, Alicloud deploy scripts, teammate muscle memory. Nothing in-repo may capture all of this; note them in the PR description.
- [ ] **Current repo facts (snapshot):**
  - Root `package.json` owns Vite, Playwright, and all frontend `dependencies` / `devDependencies`.
  - Root `Dockerfile` uses `COPY . .` then `npm run build` — build context is effectively the whole repo root today.
  - Root `docker-compose.yml` and `docker-compose.app.yml` build from root `Dockerfile` and mount `./nginx.alicloud-app.conf` from root.
  - `scripts/` currently contains only `ui-demurrage-clickthrough.mjs` (decide: `Frontend/scripts` vs `Docs/scripts` by usage).

### 1) Discovery pass (read-only, before edits)

Run from repo root and save outputs for the PR (or ticket):

- [ ] `git ls-files` at root: list every tracked file outside `Assets/`, `Backend/`, `Docs/`, `Frontend/` — these are candidates to move, delete, or re-home into the compatibility layer.
- [ ] Ripgrep for fragile path references (extend patterns as needed):
  - `vite.config`, `playwright`, `docker-compose`, `Dockerfile`, `nginx.alicloud`, `nginx.conf`, `package-lock`, `Frontend/src` from root configs
  - Docs: `npm run dev`, `docker compose`, `--env-file Backend/.env`, `-f docker-compose`
- [ ] Identify **canonical env** story after move:
  - **Frontend:** `Frontend/.env` with `VITE_API_BASE_URL` (and any other `VITE_*`).
  - **Backend:** `Backend/.env` (unchanged for API/DB).
  - **Root:** optional thin `.env.example` that only points to the two app env files (avoid duplicating secrets).

### 2) Workstream A — Frontend package root (blocking)

**Goal:** `Frontend/package.json` is the single source of truth for frontend deps and scripts; root only delegates.

- [ ] Create `Frontend/package.json` by **moving** (not copying) dependency lists from root `package.json` (same `dependencies` / `devDependencies` / `scripts` names where possible).
- [ ] Move `package-lock.json` to `Frontend/` and run `npm install` inside `Frontend/` to refresh lockfile if needed.
- [ ] Move: `vite.config.js`, `index.html`, `public/`, `e2e/`, `playwright.config.js` → `Frontend/`.
- [ ] Update `vite.config.js` paths if anything assumed repo root (e.g. `root`, `publicDir`, alias `@`, env dir). Prefer `envDir: '.'` inside `Frontend/` so `Frontend/.env` loads by default.
- [ ] Move `scripts/ui-demurrage-clickthrough.mjs` → `Frontend/scripts/` **or** `Docs/scripts/`; fix any hardcoded URLs; document how to run it from the new path.
- [ ] **Root `package.json` (compatibility):** use cross-platform delegation (works on Windows PowerShell and Unix):

```json
{
  "scripts": {
    "dev": "npm --prefix Frontend run dev",
    "build": "npm --prefix Frontend run build",
    "preview": "npm --prefix Frontend run preview",
    "test:e2e": "npm --prefix Frontend run test:e2e"
  }
}
```

- [ ] Root `package.json` should **not** duplicate large dependency trees long-term; optional: leave a minimal `dependencies`/`devDependencies` empty or only tooling needed at root (prefer empty).
- [ ] **Gate A:** from repo root, `npm install` (if root still has package.json) + `npm run dev` starts Vite; from `Frontend/`, `npm run dev` also works.

### 3) Workstream B — Frontend container (`Dockerfile` + nginx)

**Goal:** Production image build context is `Frontend/` (or explicitly scoped), not whole monorepo.

- [ ] Move `Dockerfile` → `Frontend/infra/Dockerfile` (or `Frontend/Dockerfile` if you prefer flatter layout — pick one and use consistently in compose).
- [ ] Rewrite Dockerfile stages:
  - `WORKDIR /app`
  - `COPY package.json package-lock.json ./` from **frontend** app root only
  - `RUN npm ci`
  - `COPY . .` should copy **only** frontend tree (build context = `Frontend/`).
  - Build args for `VITE_*` unchanged in spirit.
- [ ] Move `nginx.conf` and `nginx.alicloud-app.conf` → `Frontend/infra/` (or next to Dockerfile).
- [ ] **Gate B:** `docker build -f Frontend/infra/Dockerfile Frontend` (adjust path) produces an image that serves `dist` and health-checks nginx.

### 4) Workstream C — Canonical compose under `Backend/infra`

**Goal:** `Backend/infra/` holds the “real” compose definitions; root files stay as thin entrypoints **or** re-export via `include` (Compose v2.20+ `include:`) — choose one pattern and document it.

- [ ] Create `Backend/infra/` and move **content** of:
  - `docker-compose.backend.yml` → canonical file (e.g. `Backend/infra/docker-compose.backend.yml`).
  - Optionally same for `docker-compose.app.yml`, `docker-compose.production.yml`, `docker-compose.yml` (frontend-only stack).
- [ ] Fix all **build** stanzas:
  - Frontend service: `context: ../../Frontend` (or repo-relative path from infra file), `dockerfile: infra/Dockerfile` (path relative to context).
  - Backend service: `context: ..` pointing at `Backend/` (where `Backend/Dockerfile` already lives).
- [ ] Fix **volume** mounts for nginx config: path relative to compose file location or use `${COMPOSE_FILE}`-friendly paths.
- [ ] Root-level `docker-compose*.yml` options:
  - **Option 1 (recommended):** one-liner files that only set `include:` and pass through profiles/env (keeps user command `docker compose -f docker-compose.backend.yml` at root).
  - **Option 2:** document new canonical path only (`docker compose -f Backend/infra/docker-compose.backend.yml ...`) and deprecate root filenames in a later release (breaks muscle memory — avoid unless team agrees).

- [ ] **Gate C:** from repo root, documented command still brings up `jps-api` + DB; frontend compose still builds and serves on expected port.

### 5) Workstream D — `.dockerignore` and build context hygiene

- [ ] Root `.dockerignore` today likely excludes `Docs`, etc. After frontend context moves to `Frontend/`, add `Frontend/.dockerignore` excluding `node_modules`, `dist`, tests, etc.
- [ ] Keep or relocate root-context ignore only if something still builds from repo root (ideally nothing after migration).

### 6) Workstream E — Documentation (blocking for merge)

Update in the **same PR** as structural changes (or immediately after in a fast-follow if policy requires two PRs — prefer one).

Priority files (non-exhaustive):

- [ ] `Docs/ALICLOUD-DEPLOYMENT-GUIDE.md` — build context, env file locations, nginx mount paths.
- [ ] `Docs/Troubleshoot/LOCAL-FRONTEND-BACKEND-STARTUP.md`
- [ ] `Docs/Troubleshoot/REBUILD-RESTART-CONTAINERS.md`
- [ ] `Docs/README.md` and root `README.md` — “preferred” vs “legacy root” commands.
- [ ] `Docs/TECH-SPEC-Jetty-Planning-System.md` — any “repo root” frontend statements.

Each updated doc should contain:

1. **Preferred:** commands run from `Frontend/` or `Backend/`.
2. **Compatible:** commands still run from repo root via wrappers / include files (until deprecation).

### 7) Cleanup and guardrails

- [ ] Delete from repo root (and ensure `.gitignore` covers): `dist/`, `test-results/`, `.tmp-pdf-extract/`, root `node_modules/` after frontend install migrates.
- [ ] Add CI note (if applicable): install step runs `npm ci` in `Frontend/`; E2E installs Playwright from `Frontend/`.
- [ ] Optional: `npm run postinstall` at root is **not** recommended; keep root dumb.

### 8) Verification matrix (sign-off)

| Check | Command / action | Pass criteria |
|--------|-------------------|---------------|
| FE dev (root) | `npm run dev` from repo root | Vite serves, HMR works |
| FE dev (app) | `cd Frontend && npm run dev` | Same |
| FE build | `cd Frontend && npm run build` | `Frontend/dist` exists |
| FE E2E | `cd Frontend && npm run test:e2e` | Tests discover config under `Frontend/` |
| BE compose | Documented `docker compose ... jps-api` | API healthy |
| FE compose | Documented frontend compose | SPA + nginx up |
| Integration | Login + Dashboard + one Loading flow | No CORS or wrong `VITE_API_BASE_URL` |
| Grep | No references to deleted root paths in code | CI grep job optional |

### 9) PR strategy

- **PR 1 (recommended monolith for this refactor):** Workstreams A–E + docs + gates. Hard to split without broken intermediate state.
- **PR 2 (optional):** Remove root `package.json` dependencies entirely and leave only `scripts` + `packageManager` note, or introduce `pnpm`/`npm` workspaces later — only if team wants a second cleanup pass.

### 10) Rollback

- Revert the merge commit on `sit` / mainline.
- Restore previous root `Dockerfile` + compose if image pipeline broke.
- Communicate: “Use previous compose command from docs commit &lt;SHA&gt;.”

### 11) Ownership matrix (after completion)

| Concern | Owner directory | Entry command |
|--------|-----------------|---------------|
| SPA dev/build/test | `Frontend/` | `npm run dev` / `build` / `test:e2e` |
| API, migrations, DB compose | `Backend/` | `docker compose …` per runbook |
| Product / runbooks | `Docs/` | N/A |
| Static branding assets | `Assets/` | N/A |
| Repo onboarding | root `README.md` | Points to `Docs/` and app folders |

---

*End of comprehensive execution plan.*

