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
| `name` | `code` (Incoterm, uppercased) | `name` |
| `description` | `description` | — |
| `hs_code` | — | `hs_code` |
| `uom` | — | `default_metric_id` via `metric.code` KL/MT |
| — | `sort_order` local | `short_name`, `commodity_type`, `kl_to_mt_factor` JPS defaults on create |

Run the probe against staging/production DHM and append any extra field keys returned by the allowlisted catalog below this line.

<!-- Live probe output (optional): paste JSON summaries after running probe-datahub-catalog.mjs -->
