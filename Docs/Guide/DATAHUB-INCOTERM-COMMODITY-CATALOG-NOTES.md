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
| `short_name` | `code` (Term, uppercased) | `short_name` |
| `long_name` | `long_name` | `name` (JPS commodity long name) |
| `description` | `description` | — |
| `hs_code` | — | `hs_code` |
| `material_code` | — | `material_code` |
| `name` (legacy hub) | fallback for `short_name` if present | — |
| `type` | — | `hub_type` (verbatim DHM string, e.g. Chemical, Fuel Greases and Lub) |
| `uom` | — | `default_metric_id` via `metric.code` KL/MT |
| — | `sort_order` local | `commodity_type` JPS-only (`Solid` \| `Liquid`; not synced from DHM) |
| — | — | `kl_to_mt_factor` JPS-only (not synced from DHM) |

**Match / apply:** commodities link **only by `hub_code`** (same CMD on hub and JPS). Local-only rows (no hub code) are listed in sync review as unchanged and are never updated or deleted by sync. Apply creates a new JPS row when the hub CMD is not linked; it updates only the row already tied to that hub code (or the staged local id from the plan).

**Active (JPS-only):** rows **created** by commodity sync apply start with **Active = No**; users turn them on in Master – Commodity. Hub updates do not change `is_active` on existing rows.

**Type split:** `hub_type` is synced from DHM; `commodity_type` is set manually in JPS (NULL on hub import until the user chooses Solid/Liquid). Activating a commodity requires `commodity_type` to be set.

Incoterms still match by `hub_code`, then term `code`, then name.

Run the probe against staging/production DHM and append any extra field keys returned by the allowlisted catalog below this line.

<!-- Live probe output (optional): paste JSON summaries after running probe-datahub-catalog.mjs -->
