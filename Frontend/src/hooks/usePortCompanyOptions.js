import { useEffect, useState } from 'react'
import { fetchInstructionCompanyOptions } from '../api/masterCompanies'
import { usePortScope } from '../context/PortScopeContext'

const HIDDEN = { mode: 'hidden', companies: [] }

/** Active companies mapped to the selected port, for the shipping-instruction field. */
export function usePortCompanyOptions(enabled = true) {
  const { selectedPortId } = usePortScope()
  const [companyOptions, setCompanyOptions] = useState(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setCompanyOptions(null)
    fetchInstructionCompanyOptions()
      .then((row) => {
        if (!cancelled) setCompanyOptions(row?.mode ? row : HIDDEN)
      })
      .catch(() => {
        if (!cancelled) setCompanyOptions(HIDDEN)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, selectedPortId])

  return companyOptions
}
