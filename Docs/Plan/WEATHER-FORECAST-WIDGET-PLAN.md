# Plan: Weather forecast widget (Dashboard)

**Status:** Proposed (not implemented)  
**Created:** 2026-04-07  
**Owner surfaces:** Dashboard (primary), optional Allocation header (later)

This document defines the **Weather forecast widget** for the Dashboard, including **data contract**, **UI states**, and **backend proxy** design so the SPA never calls external weather providers directly.

---

## Goals

- Provide a **simple, reliable weather snapshot + short forecast** for the **selected port**.
- Avoid exposing third-party secrets in the browser; all provider calls go through the backend.
- Handle failure modes gracefully (quota, timeouts, provider downtime) without breaking Dashboard.
- Make provider choice **swappable** (Open-Meteo first; other providers later).

---

## Non-goals (this release)

- Marine-specific forecasts (waves/tides/currents) unless explicitly added later.
- Hyper-local sensor integration (“weather hardware”).
- Weather-based automation/alerts (separate notifications feature).

---

## Product decisions (lock these before implementation)

### Forecast horizon

- **Now + next 24 hours (hourly)**: temp, rain probability (or precipitation), wind speed/direction.
- **Next 3 days (daily)**: max/min temp + short condition label.

If the chosen provider cannot supply a field, the backend normalizes to `null` and the UI hides that sub-field.

### Location source for a port

One of the following must be selected:

- **Option A (recommended): store coordinates on the port** (`ports.latitude`, `ports.longitude`).
- **Option B: config map** in backend env (e.g. JSON mapping portId → lat/lon).

Option A is preferred because it keeps the system self-contained and editable via Master Port (future enhancement).

---

## Free weather APIs (recommended choices)

### Recommended default: Open-Meteo (free, no API key)

- **Pros**: no API key; generous free usage; strong “hourly + daily” forecast; simple REST.
- **Cons**: depends on external uptime; attribution requirements may apply depending on usage.

### Alternative: MET Norway (`api.met.no`) (free, no API key)

- **Pros**: high quality; no key.
- **Cons**: strict requirement for a descriptive `User-Agent` and fair-use; may be blocked if misused.

### Alternative: OpenWeather (free tier with API key)

- **Pros**: common, lots of examples.
- **Cons**: requires key, free tier limits, plan differences; avoid putting key in SPA.

**Plan assumption:** Implement against **Open-Meteo** first; backend design allows swapping providers later.

---

## Backend contract (proposed)

### Endpoint

`GET /api/v1/dashboard/weather`

### Scope

- Port-scoped by **`X-Selected-Port-Id`** (consistent with other operational modules).
- No `port_id` query param required (if present for compatibility, backend may ignore or validate it).

### Auth / RBAC

- Same as Dashboard access: authenticated session/JWT.
- If the user cannot access the selected port, return **403**.

### Response shape (normalized)

```json
{
  "portId": 1,
  "portName": "KPN Port A",
  "provider": "open-meteo",
  "timezone": "Asia/Jakarta",
  "fetchedAt": "2026-04-07T10:00:00.000Z",
  "isStale": false,
  "current": {
    "observedAt": "2026-04-07T10:00:00.000Z",
    "temperatureC": 31.2,
    "conditionText": "Partly cloudy",
    "windSpeedKph": 18,
    "windDirectionDeg": 240,
    "precipitationMm": 0.0
  },
  "hourly": [
    {
      "time": "2026-04-07T11:00:00.000Z",
      "temperatureC": 31.0,
      "precipitationMm": 0.0,
      "precipitationProbabilityPct": 10,
      "windSpeedKph": 20,
      "windDirectionDeg": 250
    }
  ],
  "daily": [
    {
      "date": "2026-04-07",
      "tempMaxC": 32.0,
      "tempMinC": 25.0,
      "conditionText": "Cloudy",
      "precipitationProbabilityPct": 40
    }
  ],
  "alerts": [
    {
      "severity": "info",
      "title": "Provider latency",
      "message": "Showing cached weather from 25 minutes ago."
    }
  ]
}
```

Notes:
- `hourly` should include **at least** the next 6 hours; target is 24 hours.
- `conditionText` is a normalized label (backend maps provider codes → text).
- `alerts` is optional; use it for stale cache or provider degradation messaging.

### Error responses (normalized)

- **400**: port has no location configured (no lat/lon found).
- **401**: not logged in.
- **403**: user cannot access selected port.
- **502**: upstream provider error (non-timeout).
- **504**: upstream provider timeout.

Body:

```json
{ "message": "Weather is temporarily unavailable. Please try again later." }
```

Backend should avoid leaking provider internals in user-facing error text; log full upstream details server-side.

---

## Caching & resilience

- Cache key: `weather:{portId}`.
- Cache TTL (recommended): **15 minutes**.
- Timeout for provider HTTP call: **3–5 seconds**.
- If provider fails but cache exists (even stale up to e.g. **2 hours**):
  - Return cached data with `isStale: true` and an `alerts[]` info message.
- If provider fails and no cache:
  - Return 502/504 with a short message; widget renders an error state (does not break dashboard).

Implementation can start with in-memory cache (per instance) for simplicity; later replace with Redis/shared cache if needed.

---

## Frontend (Dashboard widget) UX

### Placement

- Dashboard right-side column (where current mock weather card exists today).

### States

- **Loading**: skeleton for current card + small list skeleton for hourly.
- **Loaded**:
  - Header: “Weather — {Port}”
  - Subheader: “Updated {relative time}” (use `fetchedAt`; show “cached” if `isStale`).
  - Current row: temp, condition, wind.
  - Hourly mini-strip: next 6–12 hours (scroll or condensed).
  - Daily: next 3 days (compact).
- **Error**: inline message + “Retry” button.
- **No location configured**: message “Port location not set. Contact admin.” (or RBAC-aware copy if Master Port editing exists).

### Accessibility & i18n

- Units: Celsius, kph, mm.
- Time display: use port timezone when rendering (backend returns `timezone`).

---

## Acceptance criteria

- Widget shows weather for the **currently selected port**.
- Widget does **not** require any third-party calls from the browser.
- Provider failures do not break Dashboard; user sees a clear error or cached-stale message.
- Weather endpoint respects port scoping and denies cross-port access.

---

## Implementation notes / dependencies

- If choosing **Option A (port coordinates)**, add a migration to add:
  - `ports.latitude NUMERIC`
  - `ports.longitude NUMERIC`
  - (Optional) `ports.timezone TEXT` (fallback to `Asia/Jakarta` if not set)
- Provider adapter should be isolated (e.g. `weatherProviders/openMeteo.js`) and map to the normalized response.

