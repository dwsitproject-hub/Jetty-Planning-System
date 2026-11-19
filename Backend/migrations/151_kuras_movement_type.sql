-- Movement type (Normal / Kuras) on cargo segments, plus the per-port Kuras rule master.
-- A segment is tagged by an operator (source = manual) or by the rule (source = auto).

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_kuras_rules (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  remaining_pct_below NUMERIC(6, 2) NOT NULL CHECK (remaining_pct_below > 0 AND remaining_pct_below <= 100),
  rate_mt_per_hour_below NUMERIC(12, 3) NOT NULL CHECK (rate_mt_per_hour_below > 0),
  match_mode TEXT NOT NULL DEFAULT 'and' CHECK (match_mode IN ('and', 'or')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_kuras_rules_port_default
  ON public.master_kuras_rules (port_id)
  WHERE is_default AND deleted_at IS NULL;

-- One rule per commodity per port; rows are removed when the rule is deleted.
CREATE TABLE IF NOT EXISTS public.master_kuras_rule_commodities (
  rule_id BIGINT NOT NULL REFERENCES public.master_kuras_rules(id) ON DELETE CASCADE,
  port_id BIGINT NOT NULL REFERENCES ports(id),
  commodity_id BIGINT NOT NULL REFERENCES si_commodities(id),
  PRIMARY KEY (rule_id, commodity_id),
  UNIQUE (port_id, commodity_id)
);

COMMENT ON TABLE public.master_kuras_rules IS
  'Per-port thresholds that auto-tag a closed cargo segment as Kuras (cleaning).';

ALTER TABLE public.operation_cargo_load_lines
  ADD COLUMN IF NOT EXISTS movement_type TEXT CHECK (movement_type IN ('normal', 'kuras')),
  ADD COLUMN IF NOT EXISTS movement_type_source TEXT NOT NULL DEFAULT 'auto'
    CHECK (movement_type_source IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS movement_type_reason JSONB,
  ADD COLUMN IF NOT EXISTS movement_type_set_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS movement_type_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.operation_cargo_load_lines.movement_type_reason IS
  'Why the segment got its movement type: { code, remainingPct, rate, rule limits, ... } rendered per locale.';

-- Default rule (20% remaining AND 30 MT/h) for every active port.
INSERT INTO public.master_kuras_rules (port_id, is_default, remaining_pct_below, rate_mt_per_hour_below, match_mode)
SELECT p.id, TRUE, 20, 30, 'and'
FROM ports p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.master_kuras_rules r
    WHERE r.port_id = p.id AND r.is_default AND r.deleted_at IS NULL
  );

INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
SELECT 'page', 'master-kuras-rules', FALSE, FALSE, FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'master-kuras-rules'
);

-- Mirror master-tanks grants onto master-kuras-rules.
INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT rp.role_id, p_new.id, rp.can_view, rp.can_edit, rp.can_delete, COALESCE(rp.can_approve, FALSE), NOW()
FROM role_permissions rp
JOIN permissions p_src
  ON p_src.id = rp.permission_id
 AND p_src.deleted_at IS NULL
 AND p_src.resource_type = 'page'
 AND p_src.resource_key = 'master-tanks'
JOIN permissions p_new
  ON p_new.deleted_at IS NULL
 AND p_new.resource_type = 'page'
 AND p_new.resource_key = 'master-kuras-rules'
WHERE rp.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = rp.role_id AND x.permission_id = p_new.id AND x.deleted_at IS NULL
  );

INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve, updated_at)
SELECT r.id, p.id, TRUE, TRUE, TRUE, TRUE, NOW()
FROM roles r
JOIN permissions p
  ON p.deleted_at IS NULL AND p.resource_type = 'page' AND p.resource_key = 'master-kuras-rules'
WHERE r.deleted_at IS NULL
  AND r.name = 'JPS Full Access'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = r.id AND x.permission_id = p.id AND x.deleted_at IS NULL
  );

COMMIT;
