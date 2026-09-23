import { useEffect, useRef } from 'react'
import { useStickyState } from './use-sticky-state'

/**
 * One page of a long list, and the controls to move through it.
 *
 * Rendering the whole tracker at once was the slow part of opening it: every
 * member holds a copy of every scraped tender, and each row carries a status
 * select and a handful of buttons, so a register of a thousand notices mounted
 * a thousand of each before anything could be clicked. Filtering and sorting
 * still run over everything — they are cheap — and only the rows on screen
 * are built.
 *
 * The page number is sticky for the same reason the filters are: opening a
 * tender unmounts the list, and coming Back to page one of forty is losing
 * your place. It goes back to page one when `resetOn` changes, because a new
 * search on page twelve would otherwise show an empty page or the wrong rows.
 */
export function usePaged<T>(
  items: readonly T[],
  key: string,
  resetOn: string,
  pageSize = 50,
) {
  const [page, setPage] = useStickyState(`${key}:page`, 1)

  // Starts at the current value so a remount — returning from a profile with
  // the filters restored — keeps the page rather than treating it as a change.
  const lastReset = useRef(resetOn)
  useEffect(() => {
    if (lastReset.current === resetOn) return
    lastReset.current = resetOn
    setPage(1)
  }, [resetOn, setPage])

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  // Clamped, not stored clamped: rows removed under the reader (a delete, a
  // sync pruning closed tenders) shrink the list without anyone paging.
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * pageSize

  return {
    rows: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    start,
    total: items.length,
    pageSize,
    setPage,
  }
}
