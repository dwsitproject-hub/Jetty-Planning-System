# Jetty Planning System (JPS) — Mockup

Web-based mockup for CPO Downstream Jetty Operations. No backend or database; all data is in-memory. Built with **React**, **Vite**, and the **KPN Downstream** design tokens (see `Assets/design-tokens.json`). Responsive for web and mobile.

## Run locally (development)

```bash
cd Frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Run with Docker (environment parity)

Build and serve the production bundle with nginx:

```bash
docker-compose up --build
```

Open [http://localhost:3001](http://localhost:3001).

## Features (mockup)

- **Dashboard (Command Center):** Live Line-Up (5 berths), Active Vessel Detail, Pain Point Tracker, Upcoming Queue
- **Nomination:** New nomination form; list of received nominations with timestamp
- **Planning:** Shore tank levels; Line-Up board with reorder (up/down)
- **Operations:** Docking (arrival/connection); Palka Cleaning (15 palkas, start/end)
- **Quality:** Loading vs Discharge CPO comparison (FFA, DOBI, IV)
- **Verification:** Dry Certificate; tank status and digital sign; Vessel Sailed lock until CLEAN

## Tech stack

- React 18, Vite 5, React Router 6
- CSS with design tokens (no UI library)
- Mock data in `Frontend/src/data/mockData.js` — replace with API calls when building the real application

## Project structure

- `Frontend/src/components/` — Layout (top bar, sidebar)
- `Frontend/src/pages/` — Dashboard, Nomination, Planning, Operations, Quality, Verification
- `Frontend/src/data/mockData.js` — In-memory mock data
- `Frontend/src/styles/` — design-tokens.css, app.css, dashboard.css
- `Assets/design-tokens.json` — Design system source
- `Frontend/Dockerfile` + `docker-compose.yml` — Container build and run
