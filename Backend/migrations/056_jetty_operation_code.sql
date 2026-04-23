-- Jetty Operation ID: human-facing code LD|UN-YY-MM-#### on operations.
-- Backfill uses IANA zone Asia/Jakarta — must match default JETTY_OPERATION_CODE_TIMEZONE in Backend/.env.example
-- until a custom pre-migrate edit is documented for other zones.

BEGIN;

CREATE TABLE IF NOT EXISTS public.jetty_operation_code_counters (
  period_key TEXT NOT NULL PRIMARY KEY,
  last_n INT NOT NULL CHECK (last_n >= 1)
);

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS jetty_operation_code TEXT;

COMMENT ON COLUMN public.operations.jetty_operation_code IS
  'External Jetty Operation Id (LD|UN-YY-MM-####). Internal API paths still use bigint id.';

-- Backfill: order by created_at, id within each (prefix, calendar month in Asia/Jakarta).
WITH ordered AS (
  SELECT
    o.id,
    o.created_at,
    CASE o.purpose
      WHEN 'Loading' THEN 'LD'
      WHEN 'Unloading' THEN 'UN'
    END AS prefix,
    to_char(timezone('Asia/Jakarta'::text, o.created_at), 'YY') AS yy,
    to_char(timezone('Asia/Jakarta'::text, o.created_at), 'MM') AS mm
  FROM public.operations o
  WHERE o.purpose IN ('Loading', 'Unloading')
),
numbered AS (
  SELECT
    id,
    prefix || '-' || yy || '-' || mm AS period_key,
    row_number() OVER (
      PARTITION BY prefix, yy, mm
      ORDER BY created_at ASC, id ASC
    ) AS seq
  FROM ordered
)
UPDATE public.operations o
SET jetty_operation_code = n.period_key || '-' || lpad(n.seq::text, 4, '0')
FROM numbered n
WHERE o.id = n.id;

-- Seed counters so new inserts continue after the highest backfilled sequence per period.
INSERT INTO public.jetty_operation_code_counters (period_key, last_n)
SELECT
  substring(o.jetty_operation_code FROM 1 FOR (char_length(o.jetty_operation_code) - 5)) AS period_key,
  max(right(o.jetty_operation_code, 4)::int) AS last_n
FROM public.operations o
WHERE o.jetty_operation_code IS NOT NULL
GROUP BY 1
ON CONFLICT (period_key) DO UPDATE
SET last_n = GREATEST(public.jetty_operation_code_counters.last_n, EXCLUDED.last_n);

CREATE OR REPLACE FUNCTION public.assign_jetty_operation_code(p_operation_id bigint, p_tz text)
RETURNS text
LANGUAGE plpgsql
AS $func$
DECLARE
  v_purpose text;
  v_created timestamptz;
  v_prefix text;
  v_yy text;
  v_mm text;
  v_period text;
  v_seq int;
  v_code text;
BEGIN
  SELECT o.purpose, o.created_at
  INTO v_purpose, v_created
  FROM public.operations o
  WHERE o.id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation % not found', p_operation_id;
  END IF;

  v_prefix := CASE v_purpose
    WHEN 'Loading' THEN 'LD'
    WHEN 'Unloading' THEN 'UN'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'invalid purpose % for jetty operation code', v_purpose;
  END IF;

  v_yy := to_char(timezone(p_tz, v_created), 'YY');
  v_mm := to_char(timezone(p_tz, v_created), 'MM');
  v_period := v_prefix || '-' || v_yy || '-' || v_mm;

  INSERT INTO public.jetty_operation_code_counters (period_key, last_n)
  VALUES (v_period, 1)
  ON CONFLICT (period_key) DO UPDATE
    SET last_n = public.jetty_operation_code_counters.last_n + 1
  RETURNING last_n INTO v_seq;

  v_code := v_period || '-' || lpad(v_seq::text, 4, '0');

  UPDATE public.operations
  SET jetty_operation_code = v_code
  WHERE id = p_operation_id;

  RETURN v_code;
END;
$func$;

-- Nullable so INSERT can omit the column; application assigns in the same transaction via assign_jetty_operation_code.
-- Backfill sets all existing rows; partial index enforces uniqueness once assigned.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_jetty_operation_code
  ON public.operations (jetty_operation_code)
  WHERE jetty_operation_code IS NOT NULL;

COMMIT;
