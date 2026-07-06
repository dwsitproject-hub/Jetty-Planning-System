import { useEffect, useState } from 'react'
import { getOnline, onNetworkChange } from '../platform'

/**
 * Reactive connectivity flag. Uses the Capacitor Network plugin on native and
 * navigator.onLine + online/offline events on the web.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    let mounted = true
    getOnline()
      .then((o) => {
        if (mounted) setOnline(o)
      })
      .catch(() => {})
    const unsubscribe = onNetworkChange((o) => {
      if (mounted) setOnline(o)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return online
}
