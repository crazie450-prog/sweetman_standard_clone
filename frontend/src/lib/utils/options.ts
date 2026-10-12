export type Option = { value: string; label: string; group?: string }

export function keepingCurrent(
  options: Option[],
  value: string | null | undefined,
  name?: string | null
): Option[] {
  if (!value || options.some((o) => o.value === value)) return options
  return [...options, { value, label: `${name ?? 'Archived'} (archived)` }]
}

export function vendorChoices(
  vendors: { id: string; name: string; status: string }[],
  current: string | null | undefined
): Option[] {
  return vendors
    .filter((v) => v.status !== 'inactive' || v.id === current)
    .map((v) => ({ value: v.id, label: v.status === 'inactive' ? `${v.name} (inactive)` : v.name }))
}

const UNCATEGORIZED = 'Uncategorized'

export function ingredientChoices(
  ingredients: { id: string; name: string; category?: string | null }[]
): Option[] {
  const group = (i: { category?: string | null }) => i.category || UNCATEGORIZED
  return [...ingredients]
    .sort(
      (a, b) =>
        Number(group(a) === UNCATEGORIZED) - Number(group(b) === UNCATEGORIZED) ||
        group(a).localeCompare(group(b)) ||
        a.name.localeCompare(b.name)
    )
    .map((i) => ({ value: i.id, label: i.name, group: group(i) }))
}
