import { Sentry } from '../../observability/sentry'

const API_GATEWAY_BASE_URL = import.meta.env.VITE_API_GATEWAY_BASE_URL || '/gateway'

async function parseJson(response) {
  return response.json().catch(() => null)
}

/** Public endpoint — no auth. */
export async function fetchBillingPlans() {
  const url = `${API_GATEWAY_BASE_URL}/billing/plans`
  let response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'billing', type: 'plans_network' } })
    throw error
  }
  const data = await parseJson(response)
  if (!response.ok) {
    const error = new Error(data?.message || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return Array.isArray(data) ? data : []
}

export async function createCheckout(planCode, token, onUnauthorized) {
  const url = `${API_GATEWAY_BASE_URL}/billing/checkout`
  const options = {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ planCode }),
  }

  let response
  try {
    response = await fetch(url, options)
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'billing', type: 'checkout_network' } })
    throw error
  }

  if (response.status === 401 && onUnauthorized) {
    const nextAccessToken = await onUnauthorized()
    response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${nextAccessToken}` },
    })
  }

  const data = await parseJson(response)
  if (!response.ok) {
    const error = new Error(data?.message || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

export async function syncPayment(paymentId, token, onUnauthorized) {
  const url = `${API_GATEWAY_BASE_URL}/billing/payments/${paymentId}/sync`
  const options = {
    method: 'POST',
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }

  let response
  try {
    response = await fetch(url, options)
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'billing', type: 'sync_network' } })
    throw error
  }

  if (response.status === 401 && onUnauthorized) {
    const nextAccessToken = await onUnauthorized()
    response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${nextAccessToken}` },
    })
  }

  const data = await parseJson(response)
  if (!response.ok) {
    const error = new Error(data?.message || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}
