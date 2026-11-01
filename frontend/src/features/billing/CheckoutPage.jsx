import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createCheckout, fetchBillingPlans, syncPayment } from './billing-api'
import { resolveCheckoutPlan } from './plans'

const PENDING_PAYMENT_KEY = 'funcfund.billing.pendingPaymentId'

export function CheckoutPage({ token, refreshSession }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const planCode = searchParams.get('plan') || 'premium'
  const paidStatus = searchParams.get('status')
  const paymentIdFromUrl = searchParams.get('paymentId')
  const loginNext = `/checkout?plan=${encodeURIComponent(planCode)}`

  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState('')
  const [agree, setAgree] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncedStatus, setSyncedStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    setPlansLoading(true)
    setPlansError('')
    fetchBillingPlans()
      .then((data) => {
        if (!cancelled) {
          setPlans(data)
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setPlansError(requestError.message || 'Не удалось загрузить тарифы')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPlansLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const plan = resolveCheckoutPlan(planCode, plans)

  useEffect(() => {
    if (paidStatus !== 'success' || !token) {
      return undefined
    }
    const paymentId = paymentIdFromUrl || sessionStorage.getItem(PENDING_PAYMENT_KEY)
    if (!paymentId) {
      setError('Не удалось определить платёж для синхронизации')
      return undefined
    }

    let cancelled = false
    setIsSyncing(true)
    setError('')
    syncPayment(paymentId, token, refreshSession)
      .then((payment) => {
        if (cancelled) {
          return
        }
        setSyncedStatus(payment.status)
        sessionStorage.removeItem(PENDING_PAYMENT_KEY)
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError.message || 'Не удалось синхронизировать статус оплаты')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSyncing(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [paidStatus, paymentIdFromUrl, token, refreshSession])

  const handlePay = async () => {
    setError('')
    if (!token) {
      navigate(`/auth/login?next=${encodeURIComponent(loginNext)}`)
      return
    }
    try {
      setIsSubmitting(true)
      const response = await createCheckout(plan.code, token, refreshSession)
      if (!response?.confirmationUrl) {
        throw new Error('ЮKassa не вернула ссылку на оплату')
      }
      sessionStorage.setItem(PENDING_PAYMENT_KEY, String(response.paymentId))
      window.location.assign(response.confirmationUrl)
    } catch (requestError) {
      setError(requestError.message || 'Не удалось создать платёж в ЮKassa')
      setIsSubmitting(false)
    }
  }

  const isSucceeded = syncedStatus === 'succeeded'
  const priceLabel = plansLoading ? '…' : plan.price || '—'

  return (
    <section className="auth-wrap">
      <article className="card auth-card">
        <h2>Подключение тарифа {plan.title}</h2>
        <p className="muted">{plan.subtitle}</p>
        <div className="stack">
          <div>
            <span>Тариф</span>
            <strong>{plan.title}</strong>
          </div>
          <div>
            <span>Стоимость</span>
            <strong>{priceLabel}</strong>
          </div>
          <div>
            <span>Оплата</span>
            <strong>ЮKassa · банковская карта и СБП</strong>
          </div>
        </div>

        {paidStatus === 'success' && (
          <div className="success-box">
            {isSyncing && <p className="muted">Проверяем статус оплаты в ЮKassa...</p>}
            {isSucceeded && (
              <>
                <p className="success-text">Оплата подтверждена. Подписка активирована.</p>
                <Link className="primary-btn wide top-link-btn" to="/app/dashboard">
                  Открыть кабинет
                </Link>
              </>
            )}
            {!isSyncing && !isSucceeded && syncedStatus && (
              <p className="muted">Статус платежа: {syncedStatus}. Обновите страницу чуть позже.</p>
            )}
          </div>
        )}

        {paidStatus !== 'success' && (
          <>
            <label className="consent">
              <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
              Подтверждаю условия подписки и согласен на периодическое списание через ЮKassa
            </label>
            {token ? (
              <button
                type="button"
                className="primary-btn wide"
                disabled={!agree || isSubmitting || plansLoading || !plan.price}
                onClick={handlePay}
              >
                {isSubmitting
                  ? 'Переходим в ЮKassa...'
                  : plan.price
                    ? `Оплатить ${plan.price}`
                    : 'Оплатить'}
              </button>
            ) : (
              <button
                type="button"
                className="primary-btn wide"
                disabled={!agree}
                onClick={() => navigate(`/auth/login?next=${encodeURIComponent(loginNext)}`)}
              >
                Войти и оплатить в ЮKassa
              </button>
            )}
          </>
        )}

        {(error || plansError) && <p className="error-text">{error || plansError}</p>}
      </article>
    </section>
  )
}
