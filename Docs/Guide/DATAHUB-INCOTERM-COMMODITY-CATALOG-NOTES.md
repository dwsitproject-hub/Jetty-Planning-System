# DataHub incoterm & commodity — live catalog notes

**Purpose:** capture field keys from `GET /v1/catalog/{slug}` and sample `/v1/sync/{slug}` payloads when integrating Master – Term and Master – Commodity.

**Probe:** from `Backend/` with credentials in env:

```bash
node scripts/probe-datahub-catalog.mjs
```

## Contract (from DATAHUB_CLIENT_INTEGRATION.md appendix)

| Slug | Identity | Required on create | Optional |
| --- | --- | --- | --- |
| `incoterm` | `code` (INC-NNNN) | `name` | `description`, `is_active` |
| `commodity` | `code` (CMD-NNNN) | `name` | `hs_code`, `uom`, `is_active` |

## JPS mapping (implemented)

| DHM | Master – Term (`si_trade_terms`) | Master – Commodity (`si_commodities`) |
| --- | --- | --- |
| `code` | `hub_code` | `hub_code` |
| `name` | `code` (Incoterm, uppercased) | — (DHM uses `long_name` for full name) |
| `long_name` | `long_name` (when in sync payload) | `name` (JPS commodity long name) |
| `description` | `description` | — |
| `hs_code` | — | `hs_code` |
| `short_name` | — | `short_name` (short commodity name) |
| `type` | — | `commodity_type` (`Liquid` \| `Solid`) |
| `uom` | — | `default_metric_id` via `metric.code` KL/MT |
| — | `sort_order` local | `kl_to_mt_factor` JPS-only (not synced from DHM) |

**Match / apply:** commodities link by `hub_code`, then **`UPPER(short_name)`**, then name; apply updates an existing short name instead of inserting a duplicate (same pattern as Term ↔ `code`).

Run the probe against staging/production DHM and append any extra field keys returned by the allowlisted catalog below this line.

<!-- Live probe output (optional): paste JSON summaries after running probe-datahub-catalog.mjs -->
