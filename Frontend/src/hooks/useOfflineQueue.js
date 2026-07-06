import { useCallback, useEffect, useState } from 'react'
import { getOutboxSnapshot, discardMutation } from '../offline'
import { runSync, retryMutation } from '../offline/syncRunner'
import { onNetworkChange } from '../platform'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * Offline write queue + sync control for the pending badge / queue viewer.
 * Auto-syncs on reconnect, on mount, and periodically. Empty + inert on the web
 * (nothing is ever queued there and runSync short-circuits), so the UI stays hidden.
 */
export function useOfflineQueue() {
  const [rows, setRows] = useState([])
  const [syncing, setSyncing] = useState(false)
  const online = useOnlineStatus()

  const refresh = useCallback(async () => {
    try {
      setRows(await getOutboxSnapshot())
    } catch {
      setRows([])
    }
  }, [])

  const syncNow = useCallback(async () => {
    setSyncing(true)
    try {
      await runSync()
    } catch {
      /* runSync never throws for expected cases; ignore */
    } finally {
      setSyncing(false)
      await refresh()
    }
  }, [refresh])

  const retry = useCallback(
    async (id) => {
      setSyncing(true)
      try {
        await retryMutation(id)
      } catch {
        /* ignore */
      } finally {
        setSyncing(false)
        await refresh()
      }
    },
    [refresh]
  )

  const discard = useCallback(
    async (id) => {
      await discardMutation(id)
      await refresh()
    },
    [refresh]
  )

  // Poll the queue list for display.
  useEffect(() => {
    let mounted = true
    const run = async () => {
      const snap = await getOutboxSnapshot().catch(() => [])
      if (mounted) setRows(snap)
    }
    run()
    const id = setInterval(run, 5000)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [online])

  // Auto-sync: on mount, whenever connectivity returns, and every 60s.
  useEffect(() => {
    let mounted = true
    const trigger = async () => {
      if (!mounted) return
      setSyncing(true)
      try {
        await runSync()
      } catch {
        /* ignore */
      } finally {
        if (mounted) {
          setSyncing(false)
          refresh()
        }
      }
    }
    trigger()
    const off = onNetworkChange((isOnline) => {
      if (isOnline) trigger()
    })
    const id = setInterval(trigger, 60000)
    return () => {
      mounted = false
      off()
      clearInterval(id)
    }
  }, [refresh])

  const pendingCount = rows.filter((r) => r.status === 'pending' || r.status === 'failed').length
  const conflictCount = rows.filter((r) => r.status === 'conflict').length
  return { rows, pendingCount, conflictCount, syncing, online, refresh, discard, retry, syncNow }
}
