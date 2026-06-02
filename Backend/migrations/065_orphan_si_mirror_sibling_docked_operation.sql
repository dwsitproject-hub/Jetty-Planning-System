-- Multi-SI shipment plans: if one SI has a DOCKED operation on a jetty and another SI on the
-- same plan has no operation yet, clone the docked row (timelines, jetty, port) onto the orphan SI
-- and assign jetty_operation_code via the same DB function the API uses (056).

DO $$
DECLARE
  new_id bigint;
BEGIN
  FOR new_id IN
    INSERT INTO public.operations (
      shipping_instruction_id,
      jetty_id,
      status,
      purpose,
      docking_start_time,
      estimated_completion_time,
      actual_completion_time,
      completion_percent,
      cast_off_at,
      clearance_document_url,
      vessel_photo_url,
      sailed_at,
      exception_status,
      exception_justification,
      exception_document_url,
      exception_requested_at,
      exception_resolved_at,
      exception_approver_user_id,
      sequence,
      remark,
      eta,
      ta,
      etb,
      nor_tendered_at,
      nor_accepted_at,
      pob,
      tb,
      sob,
      priority,
      no_pkk,
      demurrage_liability_from_at,
      port_id,
      shifting_out,
      shifting_out_at,
      updated_by,
      signoff_requested_at,
      signoff_requested_by,
      signoff_request_remark,
      jetty_operation_code
    )
    SELECT
      si_orphan.id,
      t.jetty_id,
      'DOCKED',
      COALESCE(
        (SELECT spp.code
         FROM public.shipment_plans sp2
         JOIN public.si_purposes spp ON spp.id = sp2.purpose_id AND spp.deleted_at IS NULL
         WHERE sp2.id = si_orphan.shipment_plan_id
           AND sp2.deleted_at IS NULL
         LIMIT 1),
        t.purpose
      ),
      t.docking_start_time,
      t.estimated_completion_time,
      t.actual_completion_time,
      t.completion_percent,
      t.cast_off_at,
      t.clearance_document_url,
      t.vessel_photo_url,
      t.sailed_at,
      t.exception_status,
      t.exception_justification,
      t.exception_document_url,
      t.exception_requested_at,
      t.exception_resolved_at,
      t.exception_approver_user_id,
      t.sequence,
      t.remark,
      t.eta,
      t.ta,
      t.etb,
      t.nor_tendered_at,
      t.nor_accepted_at,
      t.pob,
      t.tb,
      t.sob,
      t.priority,
      t.no_pkk,
      t.demurrage_liability_from_at,
      t.port_id,
      COALESCE(t.shifting_out, false),
      t.shifting_out_at,
      NULL::bigint,
      NULL::timestamptz,
      NULL::bigint,
      NULL::text,
      NULL::text
    FROM public.shipping_instructions si_orphan
    JOIN LATERAL (
      SELECT o.*
      FROM public.operations o
      JOIN public.shipping_instructions si_d
        ON si_d.id = o.shipping_instruction_id
       AND si_d.deleted_at IS NULL
      WHERE si_d.shipment_plan_id = si_orphan.shipment_plan_id
        AND si_d.id <> si_orphan.id
        AND o.deleted_at IS NULL
        AND o.status = 'DOCKED'
        AND o.jetty_id IS NOT NULL
      ORDER BY o.id
      LIMIT 1
    ) t ON true
    WHERE si_orphan.deleted_at IS NULL
      AND si_orphan.shipment_plan_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.operations o2
        WHERE o2.shipping_instruction_id = si_orphan.id
          AND o2.deleted_at IS NULL
      )
    RETURNING id
  LOOP
    PERFORM public.assign_jetty_operation_code(new_id, 'Asia/Jakarta');
  END LOOP;
END $$;
