import { useCallback, useState } from 'react'

const KEY = 'jps.gantt.showStops'

/** "Show stops" choice of the Gantt legend; remembered in this browser, on by default. */
export default function useShowGanttStops() {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '0'
    } catch {
      return true
    }
  })
  const update = useCallback((next) => {
    setShow(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      /* choice just is not remembered */
    }
  }, [])
  return [show, update]
}
