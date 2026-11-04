-- One QC card per commodity on a sampling sub-process.
-- The parent operation_sub_processes row stays the visit (start, end, status).
-- A single-commodity instruction is copied onto its card so existing samples stay editable.

CREATE TABLE IF NOT EXISTS public.sampling_commodity_qc (
  id BIGSERIAL PRIMARY KEY,
  sub_process_id BIGINT NOT NULL REFERENCES public.operation_sub_processes(id) ON DELETE CASCADE,
  commodity_id BIGINT NOT NULL REFERENCES public.si_commodities(id),
  decision TEXT,
  remark TEXT,
  ffa_average NUMERIC(7,3),
  moisture_average NUMERIC(7,3),
  dobi NUMERIC(7,3),
  iodine_value NUMERIC(7,3),
  records_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT sampling_commodity_qc_decision_check CHECK (
    decision IS NULL OR decision IN ('approve_in', 'approve_out', 'hold', 'reject_in', 'reject_out')
  ),
  CONSTRAINT sampling_commodity_qc_ffa_average_check CHECK (
    ffa_average IS NULL OR (ffa_average >= 0 AND ffa_average <= 1000)
  ),
  CONSTRAINT sampling_commodity_qc_moisture_average_check CHECK (
    moisture_average IS NULL OR (moisture_average >= 0 AND moisture_average <= 1000)
  ),
  CONSTRAINT sampling_commodity_qc_dobi_check CHECK (
    dobi IS NULL OR (dobi >= 0 AND dobi <= 1000)
  ),
  CONSTRAINT sampling_commodity_qc_iodine_value_check CHECK (
    iodine_value IS NULL OR (iodine_value >= 0 AND iodine_value <= 1000)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sampling_commodity_qc_active
  ON public.sampling_commodity_qc (sub_process_id, commodity_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.sampling_commodity_qc IS
  'Per-commodity sampling result and QC decision for one Pre-Checking sampling sub-process.';

ALTER TABLE public.operation_sub_process_documents
  ADD COLUMN IF NOT EXISTS commodity_id BIGINT REFERENCES public.si_commodities(id);

COMMENT ON COLUMN public.operation_sub_process_documents.commodity_id IS
  'Sampling document for this commodity. NULL on older documents and on every other sub-process.';

INSERT INTO public.sampling_commodity_qc (
  sub_process_id, commodity_id, remark,
  ffa_average, moisture_average, dobi, iodine_value, records_json
)
SELECT sp.id,
       single.commodity_id,
       '',
       sp.ffa_average,
       sp.moisture_average,
       sp.dobi,
       sp.iodine_value,
       COALESCE(sp.payload_json->'records', '[]'::jsonb)
FROM public.operation_sub_processes sp
JOIN (
  SELECT o.id AS operation_id, MIN(b.commodity_id) AS commodity_id
  FROM public.operations o
  JOIN public.shipping_instruction_breakdown b
    ON b.shipping_instruction_id = o.shipping_instruction_id
   AND b.deleted_at IS NULL
  WHERE o.deleted_at IS NULL
  GROUP BY o.id
  HAVING COUNT(DISTINCT b.commodity_id) = 1
) single ON single.operation_id = sp.operation_id
WHERE sp.deleted_at IS NULL
  AND sp.phase = 'Pre-Checking'
  AND sp.sub_process_key = 'sampling'
  AND NOT EXISTS (
    SELECT 1 FROM public.sampling_commodity_qc q
    WHERE q.sub_process_id = sp.id AND q.deleted_at IS NULL
  );

UPDATE public.operation_sub_process_documents d
SET commodity_id = q.commodity_id,
    updated_at = NOW()
FROM public.sampling_commodity_qc q
WHERE d.sub_process_id = q.sub_process_id
  AND d.deleted_at IS NULL
  AND d.commodity_id IS NULL
  AND q.deleted_at IS NULL;
