export const WASTE_REASONS = [
  { value: 'spoilage', label: 'Spoilage' },
  { value: 'overproduction', label: 'Overproduction' },
  { value: 'trim', label: 'Trim waste' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
] as const

export const WASTE_REASON_LABEL: Record<string, string> = Object.fromEntries(
  WASTE_REASONS.map((r) => [r.value, r.label]),
)
