import { useEffect, useState } from 'react'
import { apiGet } from '../api/client.js'

/** Dark-launch switches from the API (FEATURE_* env vars). All off until loaded or on error. */
export const FEATURES_OFF = Object.freeze({ netRate: false, noFlowReport: false, ganttStops: false })

let cached = null

function loadFlags() {
  if (!cached) {
    cached = apiGet('/features')
      .then((data) => ({ ...FEATURES_OFF, ...Object.fromEntries(
        Object.keys(FEATURES_OFF).map((k) => [k, data?.[k] === true])
      ) }))
      .catch(() => {
        cached = null
        return FEATURES_OFF
      })
  }
  return cached
}

/** @returns {{ netRate: boolean, noFlowReport: boolean, ganttStops: boolean }} */
export default function useFeatureFlags() {
  const [flags, setFlags] = useState(FEATURES_OFF)
  useEffect(() => {
    let alive = true
    loadFlags().then((f) => { if (alive) setFlags(f) })
    return () => { alive = false }
  }, [])
  return flags
}
