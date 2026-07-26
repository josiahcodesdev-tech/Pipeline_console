import {
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  TrendingUpIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
  { id: 'leads', label: 'Leads', icon: UsersIcon },
  { id: 'rfps', label: 'RFPs', icon: ClipboardListIcon },
  { id: 'progress', label: 'Progress', icon: TrendingUpIcon },
  { id: 'tasks', label: 'Tasks', icon: ListChecksIcon },
  { id: 'report', label: 'Weekly report', icon: FileTextIcon },
] as const satisfies readonly {
  id: string
  label: string
  icon: LucideIcon
}[]

export type ViewId = (typeof NAV_ITEMS)[number]['id']

export function isViewId(value: string): value is ViewId {
  return NAV_ITEMS.some((item) => item.id === value)
}
