import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { monthLabel } from '@/domain/dates'

/**
 * Picks the month tenders were brought in, or all of them.
 *
 * The value is a `YYYY-MM` or 'all'. Pages hold it under the shared
 * 'rfps:month' key, so a month chosen on one is the month the others open on.
 */
export function MonthSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <Select<string> value={value} onValueChange={(next) => onChange(next ?? 'all')}>
      <SelectTrigger aria-label="Filter by month obtained" className="min-w-[160px]">
        <SelectValue>{(current: string) => (current === 'all' ? 'All months' : monthLabel(current))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All months</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {monthLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
