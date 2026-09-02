-- Per-commodity default SI breakdown unit (MT/KL). When set, SI must use that metric.
BEGIN;

ALTER TABLE si_commodities
  ADD COLUMN IF NOT EXISTS default_metric_id BIGINT REFERENCES metric(id);

UPDATE si_commodities c
SET default_metric_id = (
  SELECT id FROM metric WHERE UPPER(code) = 'KL' AND deleted_at IS NULL LIMIT 1
)
WHERE c.deleted_at IS NULL
  AND c.default_metric_id IS NULL
  AND (
    UPPER(c.short_name) = 'FAME'
    OR UPPER(c.name) LIKE '%FATTY ACID METHYL ESTER%'
  );

COMMIT;
