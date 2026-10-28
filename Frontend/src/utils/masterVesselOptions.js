/** DataHub Vessel_Type enum values. Labels match the hub screen. */
export const VESSEL_TYPE_OPTIONS = [
  { value: 'barge', label: 'Barge' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'SPOB', label: 'SPOB' },
  { value: 'tugboat', label: 'Tugboat' },
  { value: 'wooden boat', label: 'Wooden boat' },
]

export const VESSEL_TYPES = VESSEL_TYPE_OPTIONS.map((o) => o.value)

export const LAMBUNG_TYPES = [
  'Double hull Double Bottom',
  'Single hull Double Bottom',
  'Single hull Single Bottom',
]

export const CHARTER_TYPES = ['Voyage Charter', 'Time Charter']
