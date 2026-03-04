/**
 * Mock data for JPS mockup. No backend — all in memory.
 * Structure is ready for future API substitution.
 */

export const BERTH_IDS = ['1A', '1B', '2A', '2B', '3A', '3B'];

export const berths = [
  { id: '1A', name: 'Jetty 1A', currentVesselId: null, nextVesselId: 'v-ob-mapan' },
  { id: '1B', name: 'Jetty 1B', currentVesselId: 'v-bg-mulia-vii', nextVesselId: null },
  { id: '2A', name: 'Jetty 2A', currentVesselId: 'v-bg-sumber-kencana', nextVesselId: null },
  { id: '2B', name: 'Jetty 2B', currentVesselId: null, nextVesselId: 'v-delta-victory' },
  { id: '3A', name: 'Jetty 3A', currentVesselId: 'v-mt-metro', nextVesselId: null },
  { id: '3B', name: 'Jetty 3B', currentVesselId: null, nextVesselId: null },
];

export const vessels = {
  'v-bg-mulia-vii': {
    id: 'v-bg-mulia-vii',
    vesselId: 'BG MULIA VII',
    vesselName: 'BG MULIA VII',
    product: 'CPO',
    quantity: 4500,
    ETA: '2026-02-11',
    berthDate: '2026-02-19',
    status: 'Discharge',
    phaseLabel: 'Finalizing',
    priority: 'NORMAL',
    priorityReason: '',
    nominationTimestamp: '2026-02-10T08:00:00Z',
    currentPhase: '(5) Ship Discharge',
    totalQuantityDischarged: 2984256,
    lossGainPercent: -0.59,
    avgPumpingRateMTPerHour: 125,
    tankInspection: 'CLEAN',
    arrivalDate: '2026-02-11',
    waitTimeDays: 8,
    demurrageAlert: true,
    offloadingSlaTargetHours: 60,
    offloadingSlaActualHours: 63,
    offloadingSlaPercent: 92,
    age: '12 days',
    ragStatus: 'red',
    lastStatus: 'Finalizing',
    etaToCompletion: '2h',
    numberOfPalkas: 18,
  },
  'v-bg-sumber-kencana': {
    id: 'v-bg-sumber-kencana',
    vesselId: 'BG SUMBER KENCANA II',
    vesselName: 'BG SUMBER KENCANA II',
    product: 'CPO',
    quantity: 3200,
    status: 'Offloading',
    phaseLabel: 'Offloading',
    priority: 'NORMAL',
    age: '3 days',
    ragStatus: 'amber',
    lastStatus: 'Offloading',
    etaToCompletion: '18h',
    numberOfPalkas: 11,
  },
  'v-mt-metro': {
    id: 'v-mt-metro',
    vesselId: 'MT METRO MARITIM I',
    vesselName: 'MT METRO MARITIM I',
    product: 'FAME',
    quantity: 2800,
    status: 'Loading',
    phaseLabel: 'Loading FAME',
    priority: 'NORMAL',
    age: '1 day',
    ragStatus: 'green',
    lastStatus: 'Loading FAME',
    etaToCompletion: '8h',
    numberOfPalkas: 15,
  },
  'v-ob-mapan': {
    id: 'v-ob-mapan',
    vesselId: 'OB MAPAN',
    vesselName: 'OB MAPAN',
    product: 'CPO',
    quantity: 4100,
    ETA: '2026-02-28',
    status: 'Nominated',
    priority: 'NORMAL',
  },
  'v-delta-victory': {
    id: 'v-delta-victory',
    vesselId: 'DELTA VICTORY',
    vesselName: 'DELTA VICTORY',
    product: 'CPO',
    quantity: 3500,
    ETA: '2026-03-01',
    status: 'Nominated',
    priority: 'NORMAL',
  },
  'v-mt-romeo': {
    id: 'v-mt-romeo',
    vesselId: 'MT ROMEO P',
    vesselName: 'MT ROMEO P',
    product: 'POME',
    quantity: 8765,
    ETA: '2026-02-27',
    status: 'Nominated',
    priority: 'HIGH',
    priorityReason: 'Refinery Shortage',
  },
  'v-tb-oseanik': {
    id: 'v-tb-oseanik',
    vesselId: 'TB OSEANIK 03',
    vesselName: 'TB OSEANIK 03',
    product: 'CPO',
    quantity: 4409,
    ETA: '2026-03-01',
    status: 'Nominated',
    priority: 'NORMAL',
  },
  'v-mv-vinh': {
    id: 'v-mv-vinh',
    vesselId: 'MV VINH QUANG',
    vesselName: 'MV VINH QUANG',
    product: 'PKE',
    quantity: 3300,
    ETA: '2026-03-01',
    status: 'Nominated',
    priority: 'NORMAL',
  },
  'v-bg-as-marina-10': {
    id: 'v-bg-as-marina-10',
    vesselId: 'BG AS MARINA 10',
    vesselName: 'BG AS MARINA 10',
    product: 'POME INS',
    quantity: 4800,
    ETA: '2026-03-01',
    status: 'Nominated',
    priority: 'NORMAL',
  },
  'v-spob-anugerah': {
    id: 'v-spob-anugerah',
    vesselId: 'SPOB ANUGERAH BERSAM',
    vesselName: 'SPOB ANUGERAH BERSAM',
    product: 'FAME',
    quantity: 5000,
    ETA: '2026-03-02',
    status: 'Nominated',
    priority: 'NORMAL',
  },
  'v-mt-desan-chemi': {
    id: 'v-mt-desan-chemi',
    vesselId: 'MT DESAN CHEMI V.006',
    vesselName: 'MT DESAN CHEMI V.006',
    product: 'SRPKFA+CG',
    quantity: 7000,
    ETA: '2026-03-02',
    status: 'Nominated',
    priority: 'NORMAL',
  },
};

/** Dashboard metric cards (above Jetty Schematic) — Productivity & Efficiency, mock values */
export const dashboardMetrics = [
  {
    id: 'avg-pumping-rate',
    label: 'Average Pumping Rate',
    value: 118,
    unit: 'MT/Hour',
    valueType: 'Total quantity (Shore Sounding) ÷ Pumping Active hours (Timesheet)',
    managementAction: 'Monitor for vessel-to-vessel consistency',
  },
  {
    id: 'berth-occupancy',
    label: 'Berth Occupancy Ratio',
    value: 76,
    unit: '%',
    valueType: 'Time berths occupied vs. empty — optimizes Jetty Allocation',
    managementAction: 'Review line-up to reduce idle time',
  },
  {
    id: 'palka-cleaning',
    label: 'Palka Cleaning Efficiency',
    value: 2.4,
    unit: 'hrs/palka',
    valueType: 'Average time per palka — tracks crew SLA (e.g. CV. Resolver)',
    managementAction: 'Ensure cleaning crew meets target',
  },
];

/** Weather for Dashboard widget — current + forecast (mock; replace with API later) */
export const dashboardWeather = {
  current: {
    condition: 'Heavy rain',
    temperature: 27,
    windKmh: 22,
    humidity: 88,
    dockingImpact: true,
    dockingNote: 'Docking may be difficult; consider delay.',
  },
  forecast: [
    { label: 'Today 18:00', condition: 'Heavy rain', tempMin: 26, tempMax: 28, rainChance: 95 },
    { label: 'Wed 04/03', condition: 'Light rain', tempMin: 25, tempMax: 29, rainChance: 60 },
    { label: 'Thu 05/03', condition: 'Partly cloudy', tempMin: 26, tempMax: 31, rainChance: 20 },
    { label: 'Fri 06/03', condition: 'Sunny', tempMin: 26, tempMax: 32, rainChance: 5 },
    { label: 'Sat 07/03', condition: 'Partly cloudy', tempMin: 26, tempMax: 31, rainChance: 15 },
  ],
};

/** Upcoming queue for dashboard Section 4 */
export const upcomingQueue = [
  { vesselId: 'v-mt-romeo', ETA: '27/02', product: 'POME', qty: 8765, priority: 'HIGH', priorityReason: 'Refinery Shortage' },
  { vesselId: 'v-tb-oseanik', ETA: '01/03', product: 'CPO', qty: 4409, priority: 'NORMAL', priorityReason: '' },
  { vesselId: 'v-mv-vinh', ETA: '01/03', product: 'PKE', qty: 3300, priority: 'NORMAL', priorityReason: '' },
];

/** Pain point tracker (for active vessel or global) */
export const painPointTracker = {
  waitTimeDays: 8,
  arrivalDate: '11/02',
  berthDate: '19/02',
  demurrageNote: 'High Demurrage Risk Detected.',
  offloadingSlaPercent: 92,
  offloadingSlaTargetHours: 60,
  offloadingSlaActualHours: 63,
  shoreTankId: '5102',
  tankLevelCm: 1231.4,
  feedstockActionNote: 'Sufficient for next 48 hours of production.',
};

/** Active vessel metrics (Section 2) — keyed by vessel id */
export const activeVesselMetrics = {
  'v-bg-mulia-vii': [
    { metric: 'Current Phase', value: '(5) Ship Discharge', source: 'End-to-End Flow' },
    { metric: 'Total Quantity Discharged', value: '2,984,256 KG', source: 'Shore Sounding Report' },
    { metric: 'Loss/Gain %', value: '-0.59%', source: 'Shipment Discharging Details', alert: true },
    { metric: 'Avg. Pumping Rate', value: '125 MT / Hour', source: 'Calculated from Timesheet' },
    { metric: 'Tank Inspection', value: 'CLEAN', source: 'Dry Certificate', clean: true },
  ],
  'v-bg-sumber-kencana': [
    { metric: 'Current Phase', value: '(4) Offloading', source: 'End-to-End Flow' },
    { metric: 'Total Quantity Discharged', value: '1,200,000 KG', source: 'Shore Sounding Report' },
    { metric: 'Loss/Gain %', value: '-0.12%', source: 'Shipment Discharging Details', alert: false },
    { metric: 'Avg. Pumping Rate', value: '118 MT / Hour', source: 'Calculated from Timesheet' },
    { metric: 'Tank Inspection', value: 'PENDING', source: 'Dry Certificate', clean: false },
  ],
  'v-mt-metro': [
    { metric: 'Current Phase', value: '(3) Loading FAME', source: 'End-to-End Flow' },
    { metric: 'Total Quantity Loaded', value: '1,850,000 KG', source: 'Shore Sounding Report' },
    { metric: 'Loss/Gain %', value: '—', source: 'N/A (loading)', alert: false },
    { metric: 'Avg. Pumping Rate', value: '95 MT / Hour', source: 'Calculated from Timesheet' },
    { metric: 'Tank Inspection', value: 'N/A', source: 'Dry Certificate', clean: false },
  ],
};

/** Tank farm sounding (mock) for Planning */
export const tankLevels = [
  { id: '5101', name: 'Tank 5101', levelCm: 1850, capacityCm: 2500 },
  { id: '5102', name: 'Tank 5102', levelCm: 1231.4, capacityCm: 2500 },
  { id: '5103', name: 'Tank 5103', levelCm: 920, capacityCm: 2500 },
];

/** Surveyor & Agent options (Shipping Instruction) */
export const SURVEYOR_OPTIONS = ['LSN', 'SAYBOLT', 'SGS', 'Bureau Veritas', 'Intertek', 'Other']
export const AGENT_OPTIONS = ['PSM', 'TPB BONTANG', 'PT. SCM', 'PT. Pelayaran Sentosa Makmur', 'PT. EUPLG', 'Other']

/** Shipper & Loading port options (Shipping Instruction) */
export const SHIPPER_OPTIONS = [
  'PT. TANJUNG BUYU PERKASA',
  'PT. TJIM',
  'PT. EUPLG',
  'PT. EUP',
  'PT. Example',
  'Other',
]
export const LOADING_PORT_OPTIONS = [
  'LEMPAKE, KALIMANTAN TIMUR',
  'DUMAI',
  'BONTANG',
  'POSO, INDONESIA',
  'TANAH GROGOT',
  'RVTG',
  'Other',
]

/** Shipping instructions (formerly nominations) — vessel trip data */
export const nominations = [
  {
    id: 'n1',
    vesselName: 'TB. ARIA CITRA IV / BG. MULIA VII',
    etaFrom: '2026-02-09',
    etaTo: '2026-02-11',
    shipper: 'PT. TANJUNG BUYU PERKASA',
    loadingPort: 'LEMPAKE, KALIMANTAN TIMUR',
    commodity: 'CPO',
    term: 'FOB',
    totalQtyKg: 3001887,
    surveyor: 'LSN',
    agent: 'PSM',
    breakdown: [{ shipper: 'PT. TBP', contractNo: '001/TBP-EUP/FOB-CPO/01/26', poNo: '1001027272', qtyKg: 3001887, remarks: '' }],
    qualityFFA: 3.57,
    qualityMI: 0.43,
    documents: [{ id: 'd1', name: 'BL-CPO-001.pdf' }, { id: 'd2', name: 'Nomination-form.pdf' }],
    receivedAt: '2026-02-08T10:00:00Z',
  },
  {
    id: 'n2',
    vesselName: 'MT ROMEO P',
    etaFrom: '2026-02-27',
    etaTo: '2026-02-27',
    shipper: 'PT. Example',
    loadingPort: 'Dumai',
    commodity: 'POME',
    term: 'FOB',
    totalQtyKg: 8765000,
    surveyor: 'SAYBOLT',
    agent: 'TPB BONTANG',
    breakdown: [],
    qualityFFA: null,
    qualityMI: null,
    documents: [{ id: 'd3', name: 'POME-spec.pdf' }],
    receivedAt: '2026-02-26T14:00:00Z',
  },
  {
    id: 'n3',
    vesselName: 'TB OSEANIK 03',
    etaFrom: '2026-03-01',
    etaTo: '2026-03-01',
    shipper: '',
    loadingPort: '',
    commodity: 'CPO',
    term: 'FOB',
    totalQtyKg: 4409000,
    surveyor: '',
    agent: 'PT. SCM',
    breakdown: [],
    qualityFFA: null,
    qualityMI: null,
    documents: [],
    receivedAt: '2026-02-27T09:30:00Z',
  },
];

/** Incoming vessel/barges & berthing plan (Allocation page) — from nominations + allocation fields; vesselId links to vessels for Docking */
export const allocationPlan = [
  { id: 'a1', sequence: 1, vesselId: 'v-ob-mapan', vesselName: 'OB MAPAN 27028', priority: 'High', cargo: 'CPO', loadDischarge: 'DISCH', blQtyMtKl: '3K', shipper: 'PT. TJIM', term: 'CIF', portOfLoading: 'POSO', agent: 'PSM', surveyor: 'LSN', eta: '01/03 02:24 LT', ta: '21/02 21:00', etb: '25/02pm', jetty: '1B', remarks: 'After Eminence VII', etaDateTime: '2026-03-01T02:24', taDateTime: '2026-02-21T21:00', etbDateTime: '2026-02-25T14:00' },
  { id: 'a2', sequence: 2, vesselId: 'v-bg-as-marina-10', vesselName: 'BG AS MARINA 10', priority: 'Moderate', cargo: 'POME INS', loadDischarge: 'DISCH', blQtyMtKl: '4,8K', shipper: 'PT. EUPLG', term: 'FOB', portOfLoading: 'DUMAI', agent: 'TPB', surveyor: 'SAYBOLT', eta: '01/03 17:00 LT', ta: '', etb: '01/03pm', jetty: '1A', remarks: 'Wait Info', etaDateTime: '2026-03-01T17:00', taDateTime: '', etbDateTime: '2026-03-01T14:00' },
  { id: 'a3', sequence: 3, vesselId: 'v-spob-anugerah', vesselName: 'SPOB ANUGERAH BERSAM', priority: 'Critical', cargo: 'FAME', loadDischarge: 'LOAD', blQtyMtKl: '5K', shipper: 'PT. EUP', term: 'FOB', portOfLoading: 'BONTANG', agent: 'PSM', surveyor: 'LSN', eta: '02/03 08:00 LT', ta: '', etb: '', jetty: '3B', remarks: 'After Delta Victory', etaDateTime: '2026-03-02T08:00', taDateTime: '', etbDateTime: '' },
  { id: 'a4', sequence: 4, vesselId: 'v-mt-desan-chemi', vesselName: 'MT DESAN CHEMI V.006', priority: 'Moderate', cargo: 'SRPKFA+CG', loadDischarge: 'DISCH', blQtyMtKl: '7K', shipper: 'PT. TJIM', term: 'CIF', portOfLoading: 'DUMAI', agent: 'TPB', surveyor: 'SAYBOLT', eta: '02/03 14:00 LT', ta: '', etb: '', jetty: '2B', remarks: 'After SMS 3000', etaDateTime: '2026-03-02T14:00', taDateTime: '', etbDateTime: '' },
  { id: 'a5', sequence: 5, vesselId: 'v-mt-romeo', vesselName: 'MT ROMEO P', priority: 'High', cargo: 'POME ISCC', loadDischarge: 'DISCH', blQtyMtKl: '8,7K', shipper: 'PT. Example', term: 'FOB', portOfLoading: 'DUMAI', agent: 'PSM', surveyor: 'LSN', eta: '27/02 12:00 LT', ta: '', etb: '27/02pm', jetty: '3A', remarks: 'After MM1', etaDateTime: '2026-02-27T12:00', taDateTime: '', etbDateTime: '2026-02-27T14:00' },
  { id: 'a6', sequence: 6, vesselId: 'v-tb-oseanik', vesselName: 'TB OSEANIK 03', priority: 'Low', cargo: 'CPO', loadDischarge: 'LOAD', blQtyMtKl: '4,4K', shipper: 'PT. EUP', term: 'FOB', portOfLoading: 'BONTANG', agent: 'TPB', surveyor: 'LSN', eta: '01/03 06:00 LT', ta: '', etb: '', jetty: '2A', remarks: 'On Arrival', etaDateTime: '2026-03-01T06:00', taDateTime: '', etbDateTime: '' },
  { id: 'a7', sequence: 7, vesselId: 'v-mv-vinh', vesselName: 'MV VINH QUANG', priority: 'Moderate', cargo: 'PKE', loadDischarge: 'DISCH', blQtyMtKl: '3,3K', shipper: 'PT. EUPLG', term: 'CF', portOfLoading: 'DUMAI', agent: 'PSM', surveyor: 'SAYBOLT', eta: '03/03 10:00 LT', ta: '', etb: '', jetty: '3B', remarks: '', etaDateTime: '2026-03-03T10:00', taDateTime: '', etbDateTime: '' },
];

/** Line-up for Planning (vessel ids in order, with optional berth) */
export const lineUp = [
  { vesselId: 'v-ob-mapan', berthId: '1A', order: 1 },
  { vesselId: 'v-delta-victory', berthId: '2B', order: 2 },
  { vesselId: 'v-mt-romeo', berthId: null, order: 3 },
  { vesselId: 'v-tb-oseanik', berthId: null, order: 4 },
  { vesselId: 'v-mv-vinh', berthId: null, order: 5 },
];

/** Activity tags for Offloading (reason for stop/resume etc.) */
export const OFFLOADING_ACTIVITY_TAGS = [
  { id: 'cargo-solid', label: 'Cargo Solid' },
  { id: 'over-tank', label: 'Over Tank (Wait for tank space)' },
  { id: 'pump-trouble', label: 'Pump Trouble' },
  { id: 'cast-off-neighbor', label: 'Cast Off Neighbor (Waiting for another ship)' },
  { id: 'booster-pump', label: 'Booster Pump (Active utilization)' },
  { id: 'cleaning-crew-wait', label: 'Waiting for Cleaning Crew' },
  { id: 'break-time', label: 'Break time' },
  { id: 'equipment-issue', label: 'Equipment issue' },
  { id: 'other', label: 'Other' },
];

/** Palkas — length from vessel.numberOfPalkas (Nomination) or default 15 */
export const getPalkaCount = (vessel) => (vessel && vessel.numberOfPalkas != null ? vessel.numberOfPalkas : 15);

/** Palka list for Offloading (dynamic count per vessel) */
export const getPalkaMock = (vesselId, count) => {
  const n = count != null ? count : 15;
  return Array.from({ length: n }, (_, i) => ({
    id: `palka-${i + 1}`,
    index: i + 1,
    name: `Palka ${i + 1}`,
    startTime: null,
    endTime: null,
  }));
};

/** Quality: loading vs discharge (mock) */
export const qualityComparison = {
  shipmentId: 'v-bg-mulia-vii',
  loading: { FFA: 2.1, DOBI: 65, IV: 52 },
  discharge: { FFA: 2.3, DOBI: 64, IV: 51 },
};

/** Dry cert status */
export const dryCertStatus = { vesselId: 'v-bg-mulia-vii', status: 'CLEAN', signedAt: '2026-02-21T16:00:00Z' };
