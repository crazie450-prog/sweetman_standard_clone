'use client'

import { useEffect } from 'react'

export function errorReportingConfig() {
  const apiKey = process.env.NEXT_PUBLIC_BUGSNAG_API_KEY?.trim()
  if (!apiKey) return null
  const stage = process.env.NEXT_PUBLIC_APP_ENV?.trim()
  return {
    apiKey,
    releaseStage: stage === 'staging' || stage === 'production' ? stage : 'development',
    enabledReleaseStages: ['production', 'staging'],
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
  }
}

export function ErrorReporting() {
  useEffect(() => {
    const config = errorReportingConfig()
    if (!config) return
    void import('@bugsnag/browser').then(({ default: Bugsnag }) => {
      if (!Bugsnag.isStarted()) Bugsnag.start(config)
    })
  }, [])
  return null
}
