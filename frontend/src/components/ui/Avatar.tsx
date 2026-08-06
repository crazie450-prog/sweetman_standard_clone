import { cn } from '@/lib/utils/cn'

const HUES = [
  'from-primary-500 to-primary-700',
  'from-sky-500 to-blue-600',
  'from-rose-500 to-rose-700',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-violet-700',
]

function hueOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const clean = name.replace(/^invited:\s*/i, '')
  const initials = clean
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('')
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white',
        hueOf(clean),
        size === 'sm' ? 'size-7 text-[11px]' : 'size-9 text-[13px]',
        className
      )}
    >
      {initials}
    </span>
  )
}
