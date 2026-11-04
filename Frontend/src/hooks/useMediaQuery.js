import { useSyncExternalStore } from 'react'

/** Width at which the app switches from the phone layout to the desktop layout with side menu. */
export const DESKTOP_QUERY = '(min-width: 1024px)'

/** Live result of a CSS media query; re-renders when it flips (e.g. window resize). */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}
