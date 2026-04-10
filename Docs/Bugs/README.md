# Bugs / known issues

Tracked notes for issues that are **open**, **environment-specific**, or **easy to misread** in logs.

| Document | Topics |
|----------|--------|
| [KNOWN-ISSUES-dashboard-nor-and-console.md](./KNOWN-ISSUES-dashboard-nor-and-console.md) | Dashboard `PHASES` error, misleading `nor_accepted` in console, NOR Accepted `500` |

## Release notes (2026-04-10)

- Post-Checking save hardening:
  - Final Tank / Post-Checking time-range failures were fixed by normalizing datetime handling and enforcing explicit `occurredAt` / `startAt` / `endAt` behavior.
  - Post-Checking sub-process updates now avoid stale merged timestamps that previously caused `400 Invalid time range`.
- Operations status lifecycle:
  - `operations_status_check` migration order was corrected so lifecycle statuses (`POST_OPS`, `SIGNOFF_REQUESTED`, `SIGNOFF_APPROVED`) can be applied safely on existing data.
- Sign-off flow and entry points:
  - Sign-off request path now handles legacy `POST_OPS` rows with low completion percent by normalizing before eligibility checks.
  - Loading/Unloading hub no longer exposes direct approve action; final sign-off entry point is Clearance (`/verification`) only.
- Dashboard updates:
  - Clearance summary card label changed from `Exceptions pending` to `Pending Sign Off`, sourced from `SIGNOFF_REQUESTED`.
  - Performance `Turnaround` median now includes sailed vessels by using operations data (instead of only allocation queue rows).
