-- Shipment Plan (multi-SI foundation): parent aggregate for vessel-level allocation / berthing / clearance.
-- Phase 1: schema + 1:1 backfill (one plan per existing SI). Legacy columns on `operations` remain for rollback.

BEGIN;

CREATE TABLE IF NOT EXISTS shipment_plans (
  id BIGSERIAL PRIMARY KEY,
  port_id BIGINT NOT NULL REFERENCES ports(id) ON DELETE RESTRICT,
  vessel_name TEXT NOT NULL,
  jetty_id BIGINT REFERENCES jetties(id) ON DELETE RESTRICT,
  sequence INT,
  remark TEXT,
  priority TEXT,
  no_pkk TEXT,
  eta TIMESTAMPTZ,
  ta TIMESTAMPTZ,
  etb TIMESTAMPTZ,
  pob TIMESTAMPTZ,
  tb TIMESTAMPTZ,
  sob TIMESTAMPTZ,
  docking_start_time TIMESTAMPTZ,
  estimated_completion_time TIMESTAMPTZ,
  actual_completion_time TIMESTAMPTZ,
  nor_tendered_at TIMESTAMPTZ,
  nor_accepted_at TIMESTAMPTZ,
  demurrage_liability_from_at TIMESTAMPTZ,
  shifting_out BOOLEAN NOT NULL DEFAULT false,
  shifting_out_at TIMESTAMPTZ,
  sailed_at TIMESTAMPTZ,
  cast_off_at TIMESTAMPTZ,
  clearance_document_url TEXT,
  vessel_photo_url TEXT,
  exception_status TEXT
    CHECK (exception_status IS NULL OR exception_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  exception_justification TEXT,
  exception_document_url TEXT,
  exception_requested_at TIMESTAMPTZ,
  exception_resolved_at TIMESTAMPTZ,
  exception_approver_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shipment_plans_port_id
  ON shipment_plans (port_id);
CREATE INDEX IF NOT EXISTS idx_shipment_plans_jetty_id
  ON shipment_plans (jetty_id) WHERE jetty_id IS NOT NULL;

COMMENT ON TABLE shipment_plans IS
  'Vessel call / allocation aggregate; multiple shipping_instructions may reference one plan (future).';

ALTER TABLE shipping_instructions
  ADD COLUMN IF NOT EXISTS shipment_plan_id BIGINT REFERENCES shipment_plans(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_shipping_instructions_shipment_plan_id
  ON shipping_instructions (shipment_plan_id) WHERE deleted_at IS NULL;

DO $$
DECLARE
  r_si RECORD;
  op_id BIGINT;
  new_plan_id BIGINT;
  default_port_id BIGINT;
BEGIN
  SELECT p.id INTO default_port_id
  FROM ports p
  WHERE p.deleted_at IS NULL
  ORDER BY p.id
  LIMIT 1;

  IF default_port_id IS NULL THEN
    RAISE EXCEPTION '059_shipment_plans: no active port row; cannot backfill';
  END IF;

  FOR r_si IN
    SELECT si.id, si.vessel_name, si.port_id
    FROM shipping_instructions si
  LOOP
    SELECT o.id INTO op_id
    FROM operations o
    WHERE o.shipping_instruction_id = r_si.id
      AND o.deleted_at IS NULL
    ORDER BY o.id DESC
    LIMIT 1;

    IF op_id IS NOT NULL THEN
      INSERT INTO shipment_plans (
        port_id,
        vessel_name,
        jetty_id,
        sequence,
        remark,
        priority,
        no_pkk,
        eta,
        ta,
        etb,
        pob,
        tb,
        sob,
        docking_start_time,
        estimated_completion_time,
        actual_completion_time,
        nor_tendered_at,
        nor_accepted_at,
        demurrage_liability_from_at,
        shifting_out,
        shifting_out_at,
        sailed_at,
        cast_off_at,
        clearance_document_url,
        vessel_photo_url,
        exception_status,
        exception_justification,
        exception_document_url,
        exception_requested_at,
        exception_resolved_at,
        exception_approver_user_id,
        created_at,
        updated_at,
        updated_by
      )
      SELECT
        COALESCE(r_si.port_id, o.port_id, default_port_id),
        r_si.vessel_name,
        o.jetty_id,
        o.sequence,
        o.remark,
        o.priority,
        o.no_pkk,
        o.eta,
        o.ta,
        o.etb,
        o.pob,
        o.tb,
        o.sob,
        o.docking_start_time,
        o.estimated_completion_time,
        o.actual_completion_time,
        o.nor_tendered_at,
        o.nor_accepted_at,
        o.demurrage_liability_from_at,
        o.shifting_out,
        o.shifting_out_at,
        o.sailed_at,
        o.cast_off_at,
        o.clearance_document_url,
        o.vessel_photo_url,
        o.exception_status,
        o.exception_justification,
        o.exception_document_url,
        o.exception_requested_at,
        o.exception_resolved_at,
        o.exception_approver_user_id,
        o.created_at,
        o.updated_at,
        o.updated_by
      FROM operations o
      WHERE o.id = op_id
      RETURNING id INTO new_plan_id;
    ELSE
      INSERT INTO shipment_plans (
        port_id,
        vessel_name,
        jetty_id,
        created_at,
        updated_at
      )
      VALUES (
        COALESCE(r_si.port_id, default_port_id),
        r_si.vessel_name,
        NULL,
        NOW(),
        NOW()
      )
      RETURNING id INTO new_plan_id;
    END IF;

    UPDATE shipping_instructions si
    SET shipment_plan_id = new_plan_id
    WHERE si.id = r_si.id;
  END LOOP;
END $$;

ALTER TABLE shipping_instructions
  ALTER COLUMN shipment_plan_id SET NOT NULL;

COMMIT;
