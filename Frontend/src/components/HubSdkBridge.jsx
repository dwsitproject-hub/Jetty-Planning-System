import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hubSdkEnabled, identifyHubUser, resetHubUser, trackHubPage } from '../lib/hubSdk'

/** Names the signed-in user and records client-side route changes. */
export default function HubSdkBridge() {
  const location = useLocation()
  const { me } = useAuth()
  const sawUser = useRef(false)

  useEffect(() => {
    if (!hubSdkEnabled()) return undefined
    if (!me) {
      if (sawUser.current) {
        resetHubUser()
        sawUser.current = false
      }
      return undefined
    }
    sawUser.current = true
    identifyHubUser({ id: me.oidcSub, email: me.email })
    return undefined
  }, [me])

  useEffect(() => {
    if (!hubSdkEnabled()) return undefined
    trackHubPage(location.pathname)
    return undefined
  }, [location.pathname])

  return null
}
