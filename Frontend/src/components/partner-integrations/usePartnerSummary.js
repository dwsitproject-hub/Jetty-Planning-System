import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchActivitySummary } from '../../api/integrationAdmin'
import { DEFAULT_WINDOW_HOURS } from './partnerActivityFormat.js'

/** 24 h health numbers for every partner, keyed by API key id. */
export default function usePartnerSummary() {
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchActivitySummary({ hours: DEFAULT_WINDOW_HOURS })
      setPartners(Array.isArray(res?.partners) ? res.partners : [])
    } catch (e) {
      setError(e?.message || 'Failed to load summary')
      setPartners([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const byKeyId = useMemo(() => new Map(partners.map((p) => [p.keyId, p])), [partners])
  return { byKeyId, loading, error, reload }
}
