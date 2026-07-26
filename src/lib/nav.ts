export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'leads', label: 'Leads' },
  { id: 'rfps', label: 'RFPs' },
  { id: 'progress', label: 'Progress' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'report', label: 'Weekly report' },
] as const

export type ViewId = (typeof NAV_ITEMS)[number]['id']

export function isViewId(value: string): value is ViewId {
  return NAV_ITEMS.some((item) => item.id === value)
}
