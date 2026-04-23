-- Persist port scope directly on Shipping Instructions and Operations.
-- This prevents "port-less" rows when preferred_jetty_id / jetty_id is NULL.

BEGIN;

-- Shipping Instructions: add port_id (nullable for backfill, then enforce not null when possible).
ALTER TABLE public.shipping_instructions
  ADD COLUMN IF NOT EXISTS port_id BIGINT REFERENCES public.ports(id);

-- Backfill SI port_id from preferred_jetty_id when present.
UPDATE public.shipping_instructions si
SET port_id = j.port_id
FROM public.jetties j
WHERE si.port_id IS NULL
  AND si.preferred_jetty_id IS NOT NULL
  AND j.id = si.preferred_jetty_id
  AND j.deleted_at IS NULL;

-- Operations: add port_id.
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS port_id BIGINT REFERENCES public.ports(id);

-- Backfill operations.port_id from jetty_id when present.
UPDATE public.operations o
SET port_id = j.port_id
FROM public.jetties j
WHERE o.port_id IS NULL
  AND o.jetty_id IS NOT NULL
  AND j.id = o.jetty_id
  AND j.deleted_at IS NULL;

-- Keep helpful indexes for port-scoped queries.
CREATE INDEX IF NOT EXISTS idx_si_port_id ON public.shipping_instructions (port_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_operations_port_id ON public.operations (port_id) WHERE deleted_at IS NULL;

COMMIT;

