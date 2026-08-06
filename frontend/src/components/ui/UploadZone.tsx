'use client'

import { useId, useRef, useState, type DragEvent } from 'react'
import { cn } from '@/lib/utils/cn'

const chipTone: Record<string, string> = {
  TXT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  MD: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  DOC: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  DOCX: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  PDF: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  JPG: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  JPEG: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  PNG: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  GIF: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  WEBP: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  HEIC: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  HEIF: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  XLSX: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  XLS: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  CSV: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}
const chipDefault = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'

export function UploadZone({
  formats,
  hint = 'Drag & drop a file here',
  onFiles,
  className,
}: {
  formats: string[]
  hint?: string
  onFiles?: (files: File[]) => void
  className?: string
}) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    onFiles?.(Array.from(e.dataTransfer.files))
  }

  return (
    <button
      type="button"
      aria-describedby={id}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'group/zone flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-[border-color,background-color,transform] duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
        dragOver
          ? 'scale-[1.01] border-primary-600 bg-primary-50 dark:bg-primary-900/20'
          : 'border-border-strong bg-surface hover:border-primary-500 hover:bg-primary-50/50 dark:hover:bg-primary-900/10',
        className
      )}
    >
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-full transition-colors',
          dragOver
            ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200'
            : 'bg-primary-50 text-primary-700 group-hover/zone:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:group-hover/zone:bg-primary-900/50'
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="size-6"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
          />
        </svg>
      </span>
      <p className="text-sm font-medium">{hint}</p>
      <p className="-mt-1.5 text-[13px] text-text-muted">
        or{' '}
        <span className="font-semibold text-primary-700 dark:text-primary-400">
          click to browse
        </span>
      </p>
      <div id={id} className="flex flex-wrap justify-center gap-1.5">
        {formats.map((f) => (
          <span
            key={f}
            className={cn(
              'rounded-full px-2.5 py-1 text-[13px] font-medium',
              chipTone[f.toUpperCase()] ?? chipDefault
            )}
          >
            {f}
          </span>
        ))}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onFiles?.(Array.from(e.target.files ?? []))}
      />
    </button>
  )
}
