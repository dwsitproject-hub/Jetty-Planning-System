-- Persist Jetty schematic layout per port (DB-backed).

CREATE TABLE IF NOT EXISTS public.jetty_layouts (
  id bigserial PRIMARY KEY,
  port_id bigint NOT NULL REFERENCES public.ports(id) ON DELETE CASCADE,
  layout_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jetty_layouts_port_active
  ON public.jetty_layouts(port_id)
  WHERE deleted_at IS NULL;

