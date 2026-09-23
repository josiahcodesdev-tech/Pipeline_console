import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import type { usePaged } from '@/shared/hooks/use-paged'

/** Where the reader is in a `usePaged` list, and the way to the next page. */
export function Pager({
  page,
  pageCount,
  start,
  total,
  pageSize,
  setPage,
}: ReturnType<typeof usePaged<unknown>>) {
  // One page needs no controls, and an empty list has its own empty state.
  if (pageCount <= 1) return null

  const go = (next: number) => {
    setPage(next)
    // The controls sit under the table; the next page starts at its top.
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
      <span className="tabular-nums">
        {start + 1}–{Math.min(start + pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={() => go(page - 1)} disabled={page <= 1}>
          <ChevronLeftIcon />
          Previous
        </Button>
        <span className="px-1.5 tabular-nums">
          Page {page} of {pageCount}
        </span>
        <Button variant="outline" size="sm" onClick={() => go(page + 1)} disabled={page >= pageCount}>
          Next
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}
