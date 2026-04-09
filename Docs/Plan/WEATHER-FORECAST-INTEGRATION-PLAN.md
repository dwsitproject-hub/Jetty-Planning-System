# Plan: Weather forecast integration (backend + frontend)

**Status:** Proposed (not implemented)  
**Created:** 2026-04-07  
**Depends on:** `WEATHER-FORECAST-WIDGET-PLAN.md`

This plan breaks down the engineering work required to integrate a real weather provider into the Dashboard widget, using a backend proxy and port-scoped access.

---

## 1) Choose provider (recommended baseline)

### Provider: Open-Meteo (default)

- No API key required.
- Supports hourly + daily forecasts.

### Fallback providers (optional later)

- MET Norway (`api.met.no`) — requires descriptive `User-Agent` and fair-use compliance.
- OpenWeather — API key required; free-tier limits apply.

**Decision for first pass:** Open-Meteo.

---

## 2) Data prerequisites: port location

### Option A (recommended): store lat/lon on `ports`

1. Add migration:
   - `ALTER TABLE ports ADD COLUMN latitude NUMERIC;`
   - `ALTER TABLE ports ADD COLUMN longitude NUMERIC;`
   - (Optional) `ALTER TABLE ports ADD COLUMN timezone TEXT;`
2. Update ports API (`GET /ports`, `PUT /ports/:id`) to include these fields.
3. (Optional UI later) Extend Master Port to edit coordinates/timezone.

### Option B: backend env mapping

- Add env var like `PORT_WEATHER_LOCATIONS_JSON`:
  - Example: `{ "1": { "lat": -6.2, "lon": 106.8, "tz": "Asia/Jakarta" } }`
- Use as a lookup before calling provider.

**Recommendation:** Option A for correctness and maintainability; Option B is acceptable for a fast MVP if schema changes are undesirable right now.

---

## 3) Backend work

### 3.1 Route: `GET /api/v1/dashboard/weather`

- Enforce auth + port scope (use the same port scoping pattern as other operational routes via `X-Selected-Port-Id`).
- Resolve port location:
  - Prefer DB (`ports.latitude/longitude[/timezone]`) if present.
  - Else fall back to env mapping if configured.
  - If still missing → 400.

### 3.2 Provider adapter (Open-Meteo)

- Implement a dedicated adapter that:
  - Builds provider URL from lat/lon.
  - Sets a tight timeout (3–5 seconds).
  - Normalizes response into the contract in `WEATHER-FORECAST-WIDGET-PLAN.md`.
  - Maps provider “weather codes” to `conditionText`.

### 3.3 Caching

- Add cache wrapper at the route layer:
  - Key: `weather:{portId}`
  - TTL: 15 minutes
  - Stale-while-revalidate behavior:
    - If provider fails but cached exists (even stale up to 2 hours) → return cached with `isStale: true`.
    - If no cached data → 502/504.

Implementation choices:
- MVP: in-memory cache (per node instance).
- Later: shared cache (Redis) if multiple backend instances are used.

### 3.4 Observability / safety

- Log (server-side only): portId, provider, latency, upstream status code, cache hit/miss.
- Do not return raw upstream payloads to the client.

---

## 4) Frontend work

### 4.1 API client

- Add `fetchDashboardWeather()` in the frontend API layer that calls:
  - `GET /dashboard/weather` (base path already includes `/api/v1` in client).
- Ensure it uses the same auth mechanism as other calls (cookie/session or Bearer as configured).

### 4.2 Dashboard widget wiring

- Replace mock weather data usage with API call.
- Render states:
  - loading skeleton
  - loaded (current + hourly + daily)
  - stale cached banner (when `isStale`)
  - error + retry

### 4.3 Timezone handling

- Use the backend-provided `timezone` for display grouping/labels when possible.
- If UI uses browser-local formatting utilities, ensure it doesn’t mislead:
  - Show explicit “WIB”/timezone label if not using port timezone rendering.

---

## 5) Security & compliance

- No provider keys in the SPA.
- If any provider requires attribution or usage policy compliance:
  - Add a small “Powered by …” footnote in the widget (as required).
- Rate-limit the backend endpoint if necessary (to protect upstream).

---

## 6) Test plan

### API tests (manual + automated later)

- **Happy path**: port has lat/lon → returns normalized payload.
- **Missing location**: 400.
- **Forbidden**: user cannot access selected port → 403.
- **Upstream timeout**: returns cached stale when available; else 504.
- **Upstream 5xx**: returns cached stale when available; else 502.
- **Cache**: repeated calls within TTL do not call upstream every time.

### UI tests (manual)

- Switch selected port → widget updates for that port.
- Simulate offline / backend 5xx → widget shows error state, Dashboard remains functional.
- Stale message displays when backend returns `isStale: true`.

---

## 7) Rollout steps

- Phase 1 (behind a flag): keep mock weather as fallback if API fails.
- Phase 2: remove mock data dependency once endpoint is stable.

