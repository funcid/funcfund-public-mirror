/** Marketing copy only — prices come from GET /billing/plans. */
export const PLAN_COPY = {
  premium: {
    subtitle: 'Для личного управления капиталом',
  },
  pro: {
    subtitle: 'Для расширенной аналитики и командной работы',
  },
}

export function formatPlanPrice(amountRub) {
  return `${new Intl.NumberFormat('ru-RU').format(amountRub)} ₽ / месяц`
}

export function resolveCheckoutPlan(planCode, plans = []) {
  const code = (planCode || 'premium').toLowerCase()
  const fromApi = plans.find((plan) => String(plan.code).toLowerCase() === code)
  const copy = PLAN_COPY[code] || PLAN_COPY.premium
  return {
    code: fromApi?.code || code,
    title: fromApi?.title || (code === 'pro' ? 'Pro' : 'Premium'),
    price: fromApi?.amountRub != null ? formatPlanPrice(fromApi.amountRub) : null,
    amountRub: fromApi?.amountRub ?? null,
    subtitle: copy.subtitle,
  }
}
