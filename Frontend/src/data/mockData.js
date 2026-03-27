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
    siId: 'SI-2026-0892',
    purpose: 'Unloading',
    etaToCompletion: '2h',
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
    numberOfPalkas: 18,
    currentPhaseIndex: 4,
    eta: '2026-02-18T06:00:00',
    ta: '2026-02-18T07:15:00',
    etb: '2026-02-18T08:00:00',
    tb: '2026-02-18T08:30:00',
    timeSinceDocking: '2d 4h',
    estCompletion: '2026-02-20T14:00:00',
    estTimeRemaining: '2h',
  },
  'v-bg-sumber-kencana': {
    id: 'v-bg-sumber-kencana',
    vesselId: 'BG SUMBER KENCANA II',
    vesselName: 'BG SUMBER KENCANA II',
    product: 'CPO',
    quantity: 3200,
    siId: 'SI-2026-0891',
    purpose: 'Unloading',
    status: 'Offloading',
    phaseLabel: 'Offloading',
    priority: 'NORMAL',
    age: '3 days',
    ragStatus: 'amber',
    lastStatus: 'Offloading',
    etaToCompletion: '18h',
    numberOfPalkas: 11,
    currentPhaseIndex: 3,
    eta: '2026-02-19T12:00:00',
    ta: '2026-02-19T11:45:00',
    etb: '2026-02-19T14:00:00',
    tb: '2026-02-19T13:50:00',
    timeSinceDocking: '1d 12h',
    estCompletion: '2026-02-22T08:00:00',
    estTimeRemaining: '18h',
  },
  'v-mt-metro': {
    id: 'v-mt-metro',
    vesselId: 'MT METRO MARITIM I',
    vesselName: 'MT METRO MARITIM I',
    product: 'FAME',
    quantity: 2800,
    siId: 'SI-2026-0888',
    purpose: 'Loading',
    status: 'Loading',
    phaseLabel: 'Loading FAME',
    priority: 'NORMAL',
    age: '1 day',
    ragStatus: 'green',
    lastStatus: 'Loading FAME',
    etaToCompletion: '8h',
    numberOfPalkas: 15,
    currentPhaseIndex: 4,
    eta: '2026-02-20T22:00:00',
    ta: '2026-02-20T21:30:00',
    etb: '2026-02-21T00:00:00',
    tb: '2026-02-21T00:15:00',
    timeSinceDocking: '6h',
    estCompletion: '2026-02-21T18:00:00',
    estTimeRemaining: '8h',
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
    berthingImpact: true,
    berthingNote: 'Berthing may be difficult; consider delay.',
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

/** Dashboard clearance snapshot (mock until shared with Verification page) */
export const dashboardClearance = { readyToDepart: 3, departed: 5 };

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

/** Shipping instructions — pulled from Logistics & EXIM; Jetty team does not edit. siId, status (Draft/Submitted/Approved), purpose (Loading/Unloading), jetty */
export const nominations = [
  {
    id: 'n1',
    siId: 'SI-2026-0892',
    status: 'Submitted',
    purpose: 'Unloading',
    vesselName: 'TB. ARIA CITRA IV / BG. MULIA VII',
    etaFrom: '2026-02-09',
    etaTo: '2026-02-11',
    etaDateTime: '2026-02-09T14:00:00',
    shipper: 'PT. TANJUNG BUYU PERKASA',
    loadingPort: 'LEMPAKE, KALIMANTAN TIMUR',
    commodity: 'CPO',
    term: 'FOB',
    totalQtyKg: 3001887,
    surveyor: 'LSN',
    agent: 'PSM',
    jetty: '1A',
    breakdown: [
      { shipper: 'PT. TBP', contractNo: '001/TBP-EUP/FOB-CPO/01/26', poNo: '1001027272', qtyKg: 1500000, remarks: '' },
      { shipper: 'PT. TBP', contractNo: '002/TBP-EUP/FOB-CPO/01/26', poNo: '1001027273', qtyKg: 1501887, remarks: '' },
    ],
    qualityFFA: 3.57,
    qualityMI: 0.43,
    documents: [{ id: 'd1', name: 'BL-CPO-001.pdf' }, { id: 'd2', name: 'Nomination-form.pdf' }],
    receivedAt: '2026-02-08T10:00:00Z',
  },
  {
    id: 'n2',
    siId: 'SI-2026-0891',
    status: 'Approved',
    purpose: 'Unloading',
    vesselName: 'MT ROMEO P',
    etaFrom: '2026-02-27',
    etaTo: '2026-02-27',
    etaDateTime: '2026-02-27T09:30:00',
    shipper: 'PT. Example',
    loadingPort: 'Dumai',
    commodity: 'POME',
    term: 'FOB',
    totalQtyKg: 8765000,
    surveyor: 'SAYBOLT',
    agent: 'TPB BONTANG',
    jetty: '1B',
    breakdown: [],
    qualityFFA: null,
    qualityMI: null,
    documents: [{ id: 'd3', name: 'POME-spec.pdf' }],
    receivedAt: '2026-02-26T14:00:00Z',
  },
  {
    id: 'n3',
    siId: 'SI-2026-0889',
    status: 'Draft',
    purpose: 'Loading',
    vesselName: 'TB OSEANIK 03',
    etaFrom: '2026-03-01',
    etaTo: '2026-03-01',
    etaDateTime: '2026-03-01T06:00:00',
    shipper: 'PT. EUP',
    loadingPort: 'BONTANG',
    commodity: 'CPO',
    term: 'FOB',
    totalQtyKg: 4409000,
    surveyor: 'LSN',
    agent: 'PSM',
    jetty: '',
    destination: 'NANSHA, CHINA',
    billOfLading: '3 NON-NEGOTIABLE BILLS OF LADING',
    consignee: 'TO ORDER',
    notifyParty: '',
    npwp: '81.291.248.3-018.000',
    blIndicated: 'CLEAN SHIPPED ON BOARD FREIGHT PREPAID',
    breakdown: [],
    qualityFFA: null,
    qualityMI: null,
    documents: [],
    receivedAt: '2026-02-27T09:30:00Z',
  },
  {
    id: 'n4',
    siId: 'SI-2026-0893',
    status: 'Submitted',
    purpose: 'Loading',
    vesselName: 'MT BINTANG LAUT',
    etaFrom: '2026-03-05',
    etaTo: '2026-03-05',
    etaDateTime: '2026-03-05T08:00:00',
    shipper: 'PT. EUP',
    loadingPort: 'BONTANG',
    commodity: 'FAME',
    term: 'FOB',
    totalQtyKg: 5000000,
    surveyor: 'LSN',
    agent: 'PSM',
    jetty: '2A',
    destination: 'NANSHA, CHINA',
    billOfLading: '3 NON-NEGOTIABLE BILLS OF LADING',
    consignee: 'TO ORDER',
    notifyParty: '',
    npwp: '81.291.248.3-018.000',
    blIndicated: 'CLEAN SHIPPED ON BOARD FREIGHT PREPAID',
    breakdown: [],
    qualityFFA: 0.8,
    qualityMI: 0.1,
    documents: [{ id: 'd4', name: 'SI-Loading-0893.pdf' }],
    receivedAt: '2026-03-02T11:00:00Z',
  },
  {
    id: 'n5',
    siId: 'SI-2026-0888',
    status: 'Approved',
    purpose: 'Loading',
    vesselName: 'MT SUMBER CAHAYA',
    etaFrom: '2026-02-28',
    etaTo: '2026-02-28',
    etaDateTime: '2026-02-28T12:00:00',
    shipper: 'PT. EUP',
    loadingPort: 'BONTANG',
    commodity: 'CPO',
    term: 'FOB',
    totalQtyKg: 3200000,
    surveyor: 'LSN',
    agent: 'PSM',
    jetty: '1A',
    destination: 'NANSHA, CHINA',
    billOfLading: '3 NON-NEGOTIABLE BILLS OF LADING',
    consignee: 'TO ORDER',
    notifyParty: '',
    npwp: '81.291.248.3-018.000',
    blIndicated: 'CLEAN SHIPPED ON BOARD FREIGHT PREPAID',
    breakdown: [
      { shipper: 'PT. EUP', contractNo: '001/EUP/CPO-FOB/02/26', poNo: '1001027100', qtyKg: 2000000, remarks: '' },
      { shipper: 'PT. EUP', contractNo: '001/EUP/CPO-FOB/02/26', poNo: '1001027101', qtyKg: 1200000, remarks: '' },
    ],
    qualityFFA: 1.2,
    qualityMI: 0.2,
    documents: [{ id: 'd5', name: 'SI-Loading-0888-approved.pdf' }],
    receivedAt: '2026-02-25T09:00:00Z',
    approvalId: 'JPS-20260228-120530-A1B2',
  },
  {
    id: 'n6',
    siId: 'SI-2026-0890',
    status: 'Approved',
    purpose: 'Loading',
    vesselName: 'TB OSEANIK 05',
    etaFrom: '2026-03-08',
    etaTo: '2026-03-08',
    etaDateTime: '2026-03-08T06:00:00',
    shipper: 'PT. EUP',
    loadingPort: 'BONTANG',
    commodity: 'FAME',
    term: 'FOB',
    totalQtyKg: 4500000,
    surveyor: 'LSN',
    agent: 'TPB BONTANG',
    jetty: '2A',
    destination: 'NANSHA, CHINA',
    billOfLading: '3 NON-NEGOTIABLE BILLS OF LADING',
    consignee: 'TO ORDER',
    notifyParty: '',
    npwp: '81.291.248.3-018.000',
    blIndicated: 'CLEAN SHIPPED ON BOARD FREIGHT PREPAID',
    breakdown: [
      { shipper: 'PT. EUP', contractNo: '002/EUP/FAME-FOB/03/26', poNo: '1001027501', qtyKg: 2500000, remarks: '' },
      { shipper: 'PT. EUP', contractNo: '002/EUP/FAME-FOB/03/26', poNo: '1001027502', qtyKg: 2000000, remarks: '' },
    ],
    qualityFFA: 0.9,
    qualityMI: 0.15,
    documents: [{ id: 'd6', name: 'SI-Loading-0890-approved.pdf' }],
    receivedAt: '2026-03-01T14:00:00Z',
    approvalId: 'JPS-20260301-092651-YEQS',
  },
];

/** Incoming vessel & berthing plan (Allocation page) — from nominations + allocation fields; vesselId links to vessels for Berthing */
export const allocationPlan = [
  { id: 'a1', sequence: 1, vesselId: 'v-ob-mapan', vesselName: 'OB MAPAN 27028', shippingInstruction: 'SI-2026-0901', priority: 'High', purpose: 'Unloading', remark: 'After Eminence VII', eta: '01/03 02:24', etb: '25/02pm', jetty: '1B', noPkk: 'PKK-2026-001', numberOfPalka: 12, shipper: 'PT. TJIM', agent: 'PSM', surveyor: 'LSN', loadDischarge: 'DISCH', etaDateTime: '2026-03-01T02:24', taDateTime: '2026-02-21T21:00', etbDateTime: '2026-02-25T14:00', shippingTable: [{ contract: 'CTR-OB-2026-01', po: 'PO-1001', material: 'CPO', qty: '3,000 MT' }] },
  { id: 'a2', sequence: 2, vesselId: 'v-bg-as-marina-10', vesselName: 'BG AS MARINA 10', shippingInstruction: 'SI-2026-0902', priority: 'Moderate', purpose: 'Unloading', remark: 'Wait Info', eta: '01/03 17:00', etb: '01/03pm', jetty: '1A', noPkk: 'PKK-2026-002', numberOfPalka: 10, shipper: 'PT. EUPLG', agent: 'TPB', surveyor: 'SAYBOLT', loadDischarge: 'DISCH', etaDateTime: '2026-03-01T17:00', taDateTime: '', etbDateTime: '2026-03-01T14:00', shippingTable: [{ contract: 'CTR-POME-026', po: 'PO-1002', material: 'POME INS', qty: '4,800 MT' }] },
  { id: 'a3', sequence: 3, vesselId: 'v-spob-anugerah', vesselName: 'SPOB ANUGERAH BERSAM', shippingInstruction: 'SI-2026-0903', priority: 'Critical', purpose: 'Loading', remark: 'After Delta Victory', eta: '02/03 08:00', etb: '', jetty: '3B', noPkk: 'PKK-2026-003', numberOfPalka: 14, shipper: 'PT. EUP', agent: 'PSM', surveyor: 'LSN', loadDischarge: 'LOAD', etaDateTime: '2026-03-02T08:00', taDateTime: '', etbDateTime: '', shippingTable: [{ contract: '002/EUP/FAME-FOB/03/26', po: '1001027501', material: 'FAME', qty: '2,500 MT' }, { contract: '002/EUP/FAME-FOB/03/26', po: '1001027502', material: 'FAME', qty: '2,500 MT' }] },
  { id: 'a4', sequence: 4, vesselId: 'v-mt-desan-chemi', vesselName: 'MT DESAN CHEMI V.006', shippingInstruction: 'SI-2026-0904', priority: 'Moderate', purpose: 'Unloading', remark: 'After SMS 3000', eta: '02/03 14:00', etb: '', jetty: '2B', noPkk: 'PKK-2026-004', numberOfPalka: 18, shipper: 'PT. TJIM', agent: 'TPB', surveyor: 'SAYBOLT', loadDischarge: 'DISCH', etaDateTime: '2026-03-02T14:00', taDateTime: '', etbDateTime: '', shippingTable: [{ contract: 'CTR-SRPKFA-011', po: 'PO-1004', material: 'SRPKFA+CG', qty: '7,000 MT' }] },
  { id: 'a5', sequence: 5, vesselId: 'v-mt-romeo', vesselName: 'MT ROMEO P', shippingInstruction: 'SI-2026-0905', priority: 'High', purpose: 'Unloading', remark: 'After MM1', eta: '27/02 12:00', etb: '27/02pm', jetty: '3A', noPkk: 'PKK-2026-005', numberOfPalka: 16, shipper: 'PT. Example', agent: 'PSM', surveyor: 'LSN', loadDischarge: 'DISCH', etaDateTime: '2026-02-27T12:00', taDateTime: '', etbDateTime: '2026-02-27T14:00', shippingTable: [{ contract: 'CTR-POME-028', po: 'PO-1005', material: 'POME ISCC', qty: '8,765 MT' }] },
  { id: 'a6', sequence: 6, vesselId: 'v-tb-oseanik', vesselName: 'TB OSEANIK 03', shippingInstruction: 'SI-2026-0906', priority: 'Low', purpose: 'Loading', remark: 'On Arrival', eta: '01/03 06:00', etb: '', jetty: '2A', noPkk: 'PKK-2026-006', numberOfPalka: 8, shipper: 'PT. EUP', agent: 'TPB', surveyor: 'LSN', loadDischarge: 'LOAD', etaDateTime: '2026-03-01T06:00', taDateTime: '', etbDateTime: '', shippingTable: [{ contract: 'CTR-CPO-033', po: 'PO-1006', material: 'CPO', qty: '4,409 MT' }] },
  { id: 'a7', sequence: 7, vesselId: 'v-mv-vinh', vesselName: 'MV VINH QUANG', shippingInstruction: 'SI-2026-0907', priority: 'Moderate', purpose: 'Unloading', remark: '', eta: '03/03 10:00', etb: '', jetty: '3B', noPkk: 'PKK-2026-007', numberOfPalka: 11, shipper: 'PT. EUPLG', agent: 'PSM', surveyor: 'SAYBOLT', loadDischarge: 'DISCH', etaDateTime: '2026-03-03T10:00', taDateTime: '', etbDateTime: '', shippingTable: [{ contract: 'CTR-PKE-019', po: 'PO-1007', material: 'PKE', qty: '3,300 MT' }] },
];

/** Loading flow: step IDs and config (A1–A3, B, C1–C2) */
export const LOADING_STEP_IDS = ['A1', 'A2', 'A3', 'B', 'C1', 'C2']

export const LOADING_STEPS_CONFIG = {
  A1: { label: 'Survey', pic: 'Surveyor' },
  A2: { label: 'Quality Check', pic: 'QC Team' },
  A3: { label: 'Quantity Check', pic: 'Tank Farm' },
  B: { label: 'Loading', pic: 'Jetty Team / Jetty Operator' },
  C1: { label: 'Final Quality Check', pic: 'QC Team' },
  C2: { label: 'Final Quantity Check', pic: 'Tank Farm' },
}

/** Initial loading step status per vessel (for Loading flow). Used to derive Active Vessel stepper phase. */
export const initialLoadingStepsByVesselId = {
  'v-mt-metro': {
    A1: { status: 'completed', startTime: '2026-02-21T08:00:00', endTime: '2026-02-21T09:30:00', quantityResult: null, documents: [] },
    A2: { status: 'completed', startTime: '2026-02-21T10:00:00', endTime: '2026-02-21T11:00:00', quantityResult: null, documents: [] },
    A3: { status: 'in_progress', startTime: '2026-02-21T11:30:00', endTime: '', quantityResult: '2,750 MT', documents: [] },
    B: { status: 'not_started', startTime: '', endTime: '', quantityResult: null, documents: [] },
    C1: { status: 'not_started', startTime: '', endTime: '', quantityResult: null, documents: [] },
    C2: { status: 'not_started', startTime: '', endTime: '', quantityResult: null, documents: [] },
  },
}

/** Allocation & Berthing time-log events (from unified flow) */
export const ALLOCATION_EVENTS = ['VESSEL ARRIVED', 'DROP ANCHORED', 'NOR TENDERED']
export const BERTHING_EVENTS = ['POB', 'ALL FAST', 'SOB']

/** Loading Activity Category options for Detail Activity (Operational tab) */
export const LOADING_ACTIVITY_CATEGORIES = [
  'OPENING H1 & H2',
  'HOSE ON',
  'COMM LOAD',
  'COMPL LOAD',
  'OTHER',
]

/** Unloading Activity Category options for Detail Activity (Operational tab) */
export const UNLOADING_ACTIVITY_CATEGORIES = [
  'OPENING H1 & H2',
  'HOSE ON',
  'COMM DISCHARGE',
  'COMPL DISCHARGE',
  'OTHER',
]

/** Berthing events (POB, ALL FAST/TB, SOB) — used by Daily Activities Report; Allocation can be wired to set these on confirm */
let berthingEventsByVesselId = {}
export function getBerthingEvents(vesselId) {
  return berthingEventsByVesselId[vesselId] ?? { pob: '', allFast: '', sob: '' }
}
export function setBerthingEvents(vesselId, data) {
  berthingEventsByVesselId[vesselId] = { ...getBerthingEvents(vesselId), ...data }
}

/** NOR data from Log Arrival Update (shared so Loading Pre-Checking can show it) */
let arrivalNorByVesselId = {}
export function getArrivalNor(vesselId) {
  const d = arrivalNorByVesselId[vesselId]
  return d
    ? { norDocumentNames: d.norDocumentNames || [], norTenderedDateTime: d.norTenderedDateTime || '', norAcceptedDateTime: d.norAcceptedDateTime || '' }
    : { norDocumentNames: [], norTenderedDateTime: '', norAcceptedDateTime: '' }
}
export function setArrivalNor(vesselId, data) {
  arrivalNorByVesselId[vesselId] = { ...getArrivalNor(vesselId), ...data }
}

/** Get vessel + jetty + cargo info for Loading tab (from vessels, berths, allocationPlan) */
export function getLoadingOperationCargo(vesselId) {
  const vessel = vessels[vesselId]
  if (!vessel) return null
  const berth = Object.values(berths).find((b) => b.currentVesselId === vesselId)
  const plan = allocationPlan.find((r) => r.vesselId === vesselId)
  const jettyName = berth ? berth.name?.replace('Jetty ', '') ?? berth?.id : '—'
  return {
    vesselName: vessel.vesselName,
    commodity: vessel.product || '—',
    quantity: vessel.quantity != null ? `${Number(vessel.quantity).toLocaleString('en-US', { minimumFractionDigits: 3 })} KL` : '—',
    quantityNum: vessel.quantity,
    stowage: '1PS,2PS,3PS,4PS,5PS,6PS',
    loadPort: 'JETTY EUP BONTANG, KALTIM',
    dischPort: plan?.dischPort || '—',
    shipper: plan?.shipper || vessel.shipper || '—',
    consignee: plan?.consignee || '—',
    surveyor: plan?.surveyor || vessel.surveyor || '—',
    agent: plan?.agent || vessel.agent || '—',
    jettyName,
    jettyId: berth?.id,
  }
}

/** Default pre-checking section data (Loading Pre-Checking) */
export const defaultPreCheckingSection = () => ({
  keyMeeting: { dateTime: '', documents: [], remark: '' },
  norAccepted: { norTenderedDateTime: '', norAcceptedDateTime: '', documents: [], remark: '' },
  tankInspection: { dateTime: '', documents: [], remark: '' },
  holdInspection: { dateTime: '', documents: [], remark: '' },
  sampling: { dateTime: '', documents: [], remark: '', records: [] },
  initialSounding: { dateTime: '', documents: [], remark: '' },
  initialDraftSurvey: { dateTime: '', documents: [], remark: '' },
})

/** Default post-checking section data (Loading Post-Checking) */
export const defaultPostCheckingSection = () => ({
  finalTankInspection: { result: '', dateTime: '', documents: [] },
  finalHoldInspection: { result: '', dateTime: '', documents: [] },
  finalSounding: { result: '', dateTime: '', documents: [] },
})

/** Initial loading operation data per vessel (detail activities only) */
export const initialLoadingOperationByVesselId = {
  'v-mt-metro': {
    milestoneNa: {},
    activities: [
      { id: 'act-1', category: 'HOSE ON', description: 'Hoses connected for loading.', subStepTitle: '', startTime: '2026-02-21T18:36:00', endTime: '2026-02-21T19:00:00' },
      { id: 'act-2', category: 'COMM LOAD', description: 'Commenced loading.', subStepTitle: '', startTime: '2026-02-21T20:36:00', endTime: '2026-02-21T21:00:00' },
    ],
  },
}

/** At-berth operations list (Loading or Unloading) — filter vessels by purpose */
export function getAtBerthOperations(purpose) {
  const p = purpose === 'Unloading' ? 'Unloading' : 'Loading'
  return Object.entries(vessels)
    .filter(([, v]) => v.purpose === p)
    .map(([id, v]) => ({ vesselId: id, vesselName: v.vesselName, siId: v.siId, product: v.product }))
}

/** @deprecated Use getAtBerthOperations('Loading') */
export const getLoadingOperations = () => getAtBerthOperations('Loading')

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

/** Jetty performance (daily) — used by Berthing & Allocation (derived from operations in real app) */
export const jettyPerformanceDaily = { averageBerthingTimeMinutes: 42, slaCompliancePercent: 92.4 }
