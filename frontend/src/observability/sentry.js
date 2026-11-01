import * as Sentry from '@sentry/react'

const TOKEN_REPLACEMENT = '[REDACTED]'

function redactString(value) {
  if (typeof value !== 'string') {
    return value
  }
  return value
    .replace(/(token=)[^&]+/gi, `$1${TOKEN_REPLACEMENT}`)
    .replace(/(authorization["']?\s*:\s*["']?bearer\s+)[^"'\s]+/gi, `$1${TOKEN_REPLACEMENT}`)
    .replace(/("?(accessToken|refreshToken|password|email)"?\s*:\s*")[^"]+/gi, `$1${TOKEN_REPLACEMENT}`)
}

function deepRedact(value) {
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map(deepRedact)
  }
  if (value && typeof value === 'object') {
    const next = {}
    Object.entries(value).forEach(([key, nested]) => {
      next[key] = deepRedact(nested)
    })
    return next
  }
  return value
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    beforeSend(event) {
      return deepRedact(event)
    },
  })
}

export { Sentry }
