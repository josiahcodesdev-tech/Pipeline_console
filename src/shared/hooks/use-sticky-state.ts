import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * State that survives leaving a view and coming back to it.
 *
 * THE PROBLEM. Opening a tender's profile unmounts the tracker — the router
 * swaps one for the other rather than layering them — so every filter, the
 * search box, the sort and the scroll position are gone by the time you press
 * Back. Someone triaging four hundred notices sets a service area, sorts by
 * deadline, scrolls to the fortieth row, opens one to read it, and returns to
 * an unfiltered list at the top. The work of getting back to where they were is
 * larger than the work of reading the tender was.
 *
 * WHY sessionStorage AND NOT localStorage. This is "where I was a moment ago",
 * not a preference. A filter that outlives the browser session is a filter
 * somebody set last Tuesday and has forgotten about, which turns an empty
 * tracker into a bug report. The sidebar's collapsed state is a preference and
 * correctly uses localStorage; this is not.
 *
 * Failures are swallowed. A browser refusing storage — private mode, a strict
 * policy — should cost the console a convenience, never a render.
 */
export function useStickyState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key)
      return stored === null ? initial : (JSON.parse(stored) as T)
    } catch {
      return initial
    }
  })

  /**
   * Takes a value or an updater, because `useState` does and this replaces it.
   *
   * A setter that only accepted a value would compile everywhere it was not
   * used that way and fail at the one toggle written `setX(c => !c)` — and the
   * tempting fix, rewriting that call site, quietly makes every future one a
   * trap. Persisting from inside the updater is what lets both forms write the
   * same resolved value to storage.
   */
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved =
          typeof next === 'function' ? (next as (value: T) => T)(current) : next
        try {
          sessionStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          // Preference lost, view unaffected.
        }
        return resolved
      })
    },
    [key],
  )

  return [value, set]
}

/**
 * Puts the page back where it was when this view last unmounted.
 *
 * Separate from the filters because it is restored differently. A filter can be
 * applied before the first paint; a scroll position cannot — the page has to be
 * tall enough to scroll to, and it only becomes tall once the rows are laid
 * out. Restoring in a layout effect lands at the top on a long list, because
 * the list is still one row high at that moment.
 *
 * So the restore is attempted across a few frames and stops as soon as it
 * sticks. That reads as a hack and is the honest shape of the problem: nothing
 * in the DOM announces "the table has finished laying out", and a ResizeObserver
 * on the document would fire for every image and font swap as well.
 *
 * The saved position is cleared once used. Coming back a second time from a
 * fresh navigation — clicking Opportunities in the sidebar rather than Back —
 * should start at the top, because that is a new visit rather than a return.
 */
export function useRestoredScroll(key: string, ready: boolean): void {
  const restored = useRef(false)

  useLayoutEffect(() => {
    if (restored.current || !ready) return

    let target = 0
    try {
      target = Number(sessionStorage.getItem(key) ?? '0')
    } catch {
      return
    }
    if (!target) {
      restored.current = true
      return
    }

    restored.current = true
    let frames = 0
    const attempt = () => {
      window.scrollTo(0, target)
      // Landed, or the page is genuinely shorter than it was — either way there
      // is nothing further to wait for.
      if (Math.abs(window.scrollY - target) < 2 || frames > 8) {
        try {
          sessionStorage.removeItem(key)
        } catch {
          // Nothing to clean up.
        }
        return
      }
      frames += 1
      requestAnimationFrame(attempt)
    }
    requestAnimationFrame(attempt)
  }, [key, ready])

  // Saved on the way out rather than on every scroll event: this runs once per
  // navigation, where a scroll listener runs on every wheel tick of a four
  // hundred row list.
  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem(key, String(window.scrollY))
      } catch {
        // Position lost, navigation unaffected.
      }
    }
  }, [key])
}
