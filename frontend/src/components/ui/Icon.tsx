const PATHS = {
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  alert: 'M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5',
  bars: 'M18 20V10M12 20V4M6 20v-6',
  bin: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h8l1-13M10 11v6M14 11v6',
  book: 'M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2v14',
  box: 'M12 3 4 7v10l8 4 8-4V7l-8-4M4 7l8 4 8-4M12 11v10',
  calendar:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H3M9 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0M19 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0',
  chart: 'M4 20V10M10 20V4M16 20v-7M20 20H3',
  clipboard:
    'M9 4h6M9 4a2 2 0 0 0-2 2H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1a2 2 0 0 0-2-2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3',
  document: 'M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5',
  dollar:
    'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 3 5 3.3 5 1.4 5 3.2-2.2 3.5-5 3.5-5-1.4-5-3.3',
  layers: 'M12 2 2 7l10 5 10-5-10-5M2 12l10 5 10-5M2 17l10 5 10-5',
  person: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c.5-3.5 3.4-5 7-5s6.5 1.5 7 5',
  percent: 'M19 5 5 19M7.5 8a1.5 1.5 0 1 1 0-.01M16.5 16a1.5 1.5 0 1 1 0-.01',
  received: 'M12 3v12m-4-4l4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  tag: 'M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4zM7 7v.01',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m1 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  trendDown: 'M3 7l6 6 4-4 8 8m0 0h-5m5 0v-5',
  wallet: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 12h2',
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  className = 'size-6',
  strokeWidth = 1.8,
}: {
  name: IconName
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
