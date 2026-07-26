import { useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** Label + control, matching the prototype's small-caps field styling. */
export function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('mb-3', className)}>
      <Label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  )
}

/** Two fields side by side; collapses to one column on narrow screens. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-3 sm:grid-cols-2">{children}</div>
}

/**
 * A labelled select over a fixed option list. Base UI's Select is
 * value/onValueChange based and hands the change event a second argument, which
 * this wrapper hides.
 */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  placeholder,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  className?: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id} className={className}>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as T)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * Standalone select for filter rows, where there is no stacked label.
 * `'all'` is a real option value rather than an empty string, so the trigger
 * always shows a label instead of falling through to placeholder styling.
 */
export function FilterSelect<T extends string>({
  value,
  options,
  onChange,
  allLabel,
  ariaLabel,
}: {
  value: T | 'all'
  options: readonly T[]
  onChange: (value: T | 'all') => void
  allLabel: string
  ariaLabel: string
}) {
  return (
    <Select<string>
      value={value}
      onValueChange={(next) => onChange(next as T | 'all')}
    >
      <SelectTrigger aria-label={ariaLabel} className="min-w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
