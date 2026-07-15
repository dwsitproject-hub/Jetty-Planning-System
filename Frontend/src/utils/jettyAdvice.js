/** Shared jetty suitability advice: LOA, DWT, commodity capability, and ETA-window occupancy. */

const MS_PER_DAY = 24 * 3600 * 1000;

/** Mirror backend jettyShortName: "Jetty 2B" → "2B". */
export function jettyShortName(name) {
  if (!name) return null;
  return String(name).replace(/^Jetty\s+/i, '').trim() || null;
}

/**
 * Resolve a row's jetty to a single berth short id (e.g. "1A/2A" → "1A").
 * @param {{ jetty?: string | null }} row
 */
export function getTargetJettyShortId(row) {
  const raw = (row?.jetty || '').trim();
  return raw.split('/')[0].trim() || null;
}

/**
 * @param {string | null | undefined} dateTimeLocal
 */
export function parseDateTimeLocalMs(dateTimeLocal) {
  if (!dateTimeLocal?.trim()) return null;
  const ms = new Date(dateTimeLocal).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {object} params
 * @param {object[]} params.jetties - Master jetty list from si-lookups
 * @param {number | null | undefined} params.loa - Vessel LOA (m)
 * @param {number | null | undefined} params.dwt - Vessel DWT
 * @param {string | null | undefined} params.purposeCode - 'Loading' | 'Unloading' | null
 * @param {Iterable<number>} params.commodityIds - Commodity ids on the shipment
 * @param {number | null | undefined} params.referenceTimeMs - ETA/TB for occupancy window
 * @param {object[]} [params.occupancyRows] - Rows to check jetty occupancy (shipment plans or allocation queue)
 * @param {object} [params.occupancyOptions]
 * @param {'numericId' | 'shortName'} [params.occupancyOptions.jettyKey='numericId'] - How occupancy rows identify jetties
 * @param {number | string | null} [params.occupancyOptions.excludePlanId] - Plan id to skip (shipment plans)
 * @param {string | null} [params.occupancyOptions.excludeVesselId] - Vessel id to skip (allocation)
 * @param {number | string | null} [params.occupancyOptions.excludeShipmentPlanId] - Shipment plan id to skip (allocation)
 */
export function computeJettyAdvice({
  jetties,
  loa,
  dwt,
  purposeCode,
  commodityIds,
  referenceTimeMs,
  occupancyRows = [],
  occupancyOptions = {},
}) {
  const loaNum = Number(loa);
  const dwtNum = dwt != null ? Number(dwt) : null;
  const etaMs = referenceTimeMs != null ? Number(referenceTimeMs) : NaN;
  const adviceReady = Number.isFinite(loaNum) && loaNum > 0 && Number.isFinite(etaMs);

  const commodityIdSet = new Set();
  if (commodityIds) {
    for (const cid of commodityIds) {
      const n = Number(cid);
      if (Number.isFinite(n) && n > 0) commodityIdSet.add(n);
    }
  }

  const {
    jettyKey = 'numericId',
    excludePlanId = null,
    excludeVesselId = null,
    excludeShipmentPlanId = null,
  } = occupancyOptions;

  const byId = {};
  const byShortId = {};

  for (const j of jetties || []) {
    const unloadingCommodityIds = Array.isArray(j.unloadingCommodityIds) ? j.unloadingCommodityIds : [];
    const loadingCommodityIds = Array.isArray(j.loadingCommodityIds) ? j.loadingCommodityIds : [];
    const hasSpecs =
      j.jettyLengthM != null ||
      j.jettyDwt != null ||
      unloadingCommodityIds.length > 0 ||
      loadingCommodityIds.length > 0;

    const loaOk =
      j.jettyLengthM == null || !Number.isFinite(loaNum) || loaNum <= 0 || loaNum <= Number(j.jettyLengthM);
    const dwtOk = j.jettyDwt == null || dwtNum == null || dwtNum <= Number(j.jettyDwt);
    const jettyCommodities =
      purposeCode === 'Loading'
        ? loadingCommodityIds
        : purposeCode === 'Unloading'
          ? unloadingCommodityIds
          : [];
    const commodityOk =
      jettyCommodities.length === 0 ||
      commodityIdSet.size === 0 ||
      [...commodityIdSet].every((cid) => jettyCommodities.includes(cid));
    const fits = loaOk && dwtOk && commodityOk;

    let occupied = false;
    if (Number.isFinite(etaMs)) {
      const shortId = jettyShortName(j.name);
      for (const p of occupancyRows) {
        const rowJetty =
          jettyKey === 'shortName'
            ? getTargetJettyShortId(p)
            : p.jettyId != null
              ? Number(p.jettyId)
              : null;
        const matchesJetty =
          jettyKey === 'shortName'
            ? rowJetty === shortId
            : rowJetty != null && Number(rowJetty) === Number(j.id);
        if (!matchesJetty) continue;

        if (excludePlanId != null && p.id != null && String(p.id) === String(excludePlanId)) continue;
        if (excludeVesselId != null && p.vesselId != null && String(p.vesselId) === String(excludeVesselId)) {
          continue;
        }
        if (
          excludeShipmentPlanId != null &&
          p.shipmentPlanId != null &&
          Number(p.shipmentPlanId) === Number(excludeShipmentPlanId)
        ) {
          continue;
        }

        const startRaw =
          jettyKey === 'shortName'
            ? p.etaDateTime || p.eta
            : p.eta;
        const start = startRaw ? new Date(startRaw).getTime() : NaN;
        if (!Number.isFinite(start)) continue;

        const endRaw =
          jettyKey === 'shortName'
            ? p.estimatedCompletionDateTime ||
              p.actualCompletionDateTime ||
              p.castOffDateTime ||
              p.etbDateTime
            : p.sailedAt || p.castOffAt || p.actualCompletionTime || p.estimatedCompletionTime;
        const endMs = endRaw ? new Date(endRaw).getTime() : start + MS_PER_DAY;

        if (etaMs >= start && etaMs <= endMs) {
          occupied = true;
          break;
        }
      }
    }

    const entry = { fits, occupied, hasSpecs, loaOk, dwtOk, commodityOk, jetty: j };
    byId[j.id] = entry;
    const shortId = jettyShortName(j.name);
    if (shortId) byShortId[shortId] = entry;
  }

  const suggested = (jetties || []).filter(
    (j) => byId[j.id]?.hasSpecs && byId[j.id]?.fits && !byId[j.id]?.occupied
  );

  const hasConfiguredSpecs = (jetties || []).some((j) => {
    const unloadingCommodityIds = Array.isArray(j.unloadingCommodityIds) ? j.unloadingCommodityIds : [];
    const loadingCommodityIds = Array.isArray(j.loadingCommodityIds) ? j.loadingCommodityIds : [];
    return (
      j.jettyLengthM != null ||
      j.jettyDwt != null ||
      unloadingCommodityIds.length > 0 ||
      loadingCommodityIds.length > 0
    );
  });

  return { byId, byShortId, suggested, adviceReady, hasConfiguredSpecs };
}

/**
 * Build unsuitability reason strings for a jetty advice entry.
 * @param {Function} t - i18n translate function (shipmentPlan namespace)
 */
export function getJettyAdviceUnsuitabilityReasons(adviceEntry, jetty, ctx, t) {
  if (!adviceEntry || adviceEntry.fits) return [];
  const reasons = [];
  if (!adviceEntry.loaOk) {
    reasons.push(t('jettyReasonLoa', { loa: ctx.loa, len: jetty.jettyLengthM }));
  }
  if (!adviceEntry.dwtOk) {
    reasons.push(t('jettyReasonDwt', { dwt: ctx.dwt, max: jetty.jettyDwt }));
  }
  if (!adviceEntry.commodityOk) {
    reasons.push(t('jettyReasonCommodity', { defaultValue: 'commodity not handled by this jetty' }));
  }
  return reasons;
}

/**
 * Validate selected jetty against advice. Returns { ok: true } or { ok: false, message }.
 * @param {object} params
 * @param {object} params.jettyAdvice - Result from computeJettyAdvice
 * @param {string | number | null} params.selectedJettyId - Numeric jetty id (shipment plans)
 * @param {string | null} [params.selectedJettyShortId] - Short name (allocation)
 * @param {object[]} params.jetties
 * @param {object} params.ctx - { loa, dwt }
 * @param {Function} params.t - i18n translate
 */
export function validateJettyAdviceSelection({
  jettyAdvice,
  selectedJettyId,
  selectedJettyShortId,
  jetties,
  ctx,
  t,
}) {
  const selectedId = selectedJettyId != null && selectedJettyId !== '' ? selectedJettyId : null;
  const selectedShort =
    selectedJettyShortId != null && selectedJettyShortId !== '' ? selectedJettyShortId : null;

  if (!selectedId && !selectedShort) return { ok: true };

  let jetty = null;
  let adviceEntry = null;

  if (selectedId != null) {
    jetty = (jetties || []).find((x) => String(x.id) === String(selectedId));
    adviceEntry = jettyAdvice?.byId?.[jetty?.id];
  } else if (selectedShort) {
    adviceEntry = jettyAdvice?.byShortId?.[selectedShort];
    jetty = adviceEntry?.jetty || (jetties || []).find((x) => jettyShortName(x.name) === selectedShort);
  }

  if (!jetty) return { ok: true };
  if (!jettyAdvice?.adviceReady || !jettyAdvice?.hasConfiguredSpecs) return { ok: true };
  if (!adviceEntry || adviceEntry.fits) return { ok: true };

  const reasons = getJettyAdviceUnsuitabilityReasons(adviceEntry, jetty, ctx, t);
  return {
    ok: false,
    message: t('formJettyUnsuitable', {
      jetty: jetty.name || jetty.label || selectedShort,
      reason: reasons.join('; '),
    }),
  };
}

/**
 * Compute jetty advice for Shipment Plans form context.
 */
export function computeShipmentPlanJettyAdvice({
  jetties,
  list,
  formVesselLoa,
  vesselDwtComputed,
  formEta,
  formPurposeId,
  lookups,
  editingPlan,
  siDrafts,
}) {
  const purposeCode =
    (lookups?.purposes || []).find((p) => String(p.id) === String(formPurposeId))?.code ?? null;
  const draftCommodityIds = [];
  for (const d of siDrafts || []) {
    for (const row of d?.form?.breakdown || []) {
      const cid = parseInt(row?.commodityId, 10);
      if (Number.isFinite(cid) && cid > 0) draftCommodityIds.push(cid);
    }
  }
  const etaMs = formEta?.trim() ? new Date(formEta).getTime() : NaN;

  return computeJettyAdvice({
    jetties,
    loa: formVesselLoa,
    dwt: vesselDwtComputed,
    purposeCode,
    commodityIds: draftCommodityIds,
    referenceTimeMs: etaMs,
    occupancyRows: list || [],
    occupancyOptions: {
      jettyKey: 'numericId',
      excludePlanId: editingPlan?.id ?? null,
    },
  });
}

/**
 * Compute jetty advice for Allocation modal context.
 */
export function computeAllocationJettyAdvice({
  jetties,
  row,
  referenceDateTime,
  occupancyRows,
}) {
  if (!row) {
    return {
      byId: {},
      byShortId: {},
      suggested: [],
      adviceReady: false,
      hasConfiguredSpecs: false,
      hasLoa: false,
      hasEta: false,
    };
  }

  const purposeCode = row.purpose || null;
  const loaNum = Number(row.vesselLoaM);
  const hasLoa = Number.isFinite(loaNum) && loaNum > 0;
  const etaMs =
    parseDateTimeLocalMs(referenceDateTime) ??
    parseDateTimeLocalMs(row.etaDateTime) ??
    (row.eta ? new Date(row.eta).getTime() : null);
  const hasEta = Number.isFinite(etaMs);

  const advice = computeJettyAdvice({
    jetties,
    loa: row.vesselLoaM,
    dwt: row.vesselDwt,
    purposeCode,
    commodityIds: row.commodityIds || [],
    referenceTimeMs: etaMs,
    occupancyRows: occupancyRows || [],
    occupancyOptions: {
      jettyKey: 'shortName',
      excludeVesselId: row.vesselId ?? null,
      excludeShipmentPlanId: row.shipmentPlanId ?? null,
    },
  });

  return { ...advice, hasLoa, hasEta };
}
