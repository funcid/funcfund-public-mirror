import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { useWebSocket } from './hooks/useWebSocket'
import { Sentry } from './observability/sentry'
import { CheckoutPage } from './features/billing/CheckoutPage'
import { fetchBillingPlans } from './features/billing/billing-api'
import { formatPlanPrice } from './features/billing/plans'

const navItems = [
  { to: '/dashboard', label: 'Дашборд' },
  { to: '/assets', label: 'Активы' },
  { to: '/import', label: 'Импорт' },
  { to: '/analytics', label: 'Аналитика' },
  { to: '/premium', label: 'Premium' },
  { to: '/profile', label: 'Профиль' },
]

const premiumFeatures = [
  'Автоагрегация банков, брокеров и криптобирж в одном окне',
  'Учет реальных трат без искажения переводами между своими счетами',
  'Динамика портфеля по периодам: месяц, квартал, YTD, год',
  'Умные рекомендации по ребалансировке и risk-алерты',
  'Расширенный импорт отчетов и автоклассификация операций',
]

const API_GATEWAY_BASE_URL = import.meta.env.VITE_API_GATEWAY_BASE_URL || '/gateway'
const TOKEN_STORAGE_KEY = 'funcfund.auth.token'
const REFRESH_TOKEN_STORAGE_KEY = 'funcfund.auth.refreshToken'

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1]
    if (!payload) {
      return null
    }
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(normalized)
    return JSON.parse(decoded)
  } catch (error) {
    return null
  }
}

function getUserIdFromToken(token) {
  const payload = decodeJwtPayload(token)
  const directCandidate = payload?.userId || payload?.id
  const directParsed = Number(directCandidate)
  if (Number.isFinite(directParsed)) {
    return directParsed
  }

  const subject = payload?.sub
  if (typeof subject === 'string') {
    const parsedSubjectAsNumber = Number(subject)
    if (Number.isFinite(parsedSubjectAsNumber)) {
      return parsedSubjectAsNumber
    }

    try {
      const subjectObject = JSON.parse(subject)
      const nestedCandidate = Number(subjectObject?.userId || subjectObject?.id)
      return Number.isFinite(nestedCandidate) ? nestedCandidate : null
    } catch (error) {
      return null
    }
  }

  if (typeof subject === 'object' && subject !== null) {
    const nestedCandidate = Number(subject.userId || subject.id)
    return Number.isFinite(nestedCandidate) ? nestedCandidate : null
  }

  return null
}

function createHttpError(status, data) {
  const message = data?.message || `HTTP ${status}`
  const err = new Error(message)
  err.status = status
  err.code = data?.code ?? null
  return err
}

async function requestJson(url, options = {}, onUnauthorized) {
  let response
  try {
    response = await fetch(url, options)
  } catch (error) {
    Sentry.captureException(error, {
      tags: { area: 'http', type: 'network_error' },
      extra: { url, method: options.method || 'GET' },
    })
    throw error
  }
  const data = await response.json().catch(() => null)

  if (response.status === 401 && onUnauthorized) {
    const nextAccessToken = await onUnauthorized()
    const retryOptions = { ...options, headers: { ...(options.headers || {}) } }
    if (nextAccessToken && retryOptions.headers.Authorization) {
      retryOptions.headers.Authorization = `Bearer ${nextAccessToken}`
    }
    const retryResponse = await fetch(url, retryOptions)
    const retryData = await retryResponse.json().catch(() => null)
    if (!retryResponse.ok) {
      throw createHttpError(retryResponse.status, retryData)
    }
    return retryData
  }

  if (!response.ok) {
    const httpError = createHttpError(response.status, data)
    Sentry.captureException(httpError, {
      tags: { area: 'http', type: 'http_error' },
      extra: { url, method: options.method || 'GET', status: response.status, code: data?.code ?? null },
    })
    throw httpError
  }

  return data
}

async function loginUser(email, password) {
  const url = `${API_GATEWAY_BASE_URL}/auth/login`
  return requestJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
}

async function registerUser(email, password) {
  const url = `${API_GATEWAY_BASE_URL}/auth/register`
  return requestJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
}

async function refreshAuth(refreshToken) {
  const url = `${API_GATEWAY_BASE_URL}/auth/refresh`
  return requestJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  })
}

async function verifyEmail(token) {
  const url = `${API_GATEWAY_BASE_URL}/auth/verify-email`
  return requestJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })
}

async function resendVerification(email) {
  const url = `${API_GATEWAY_BASE_URL}/auth/resend-verification`
  return requestJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })
}

async function forgotPassword(email) {
  const url = `${API_GATEWAY_BASE_URL}/auth/forgot-password`
  return requestJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })
}

async function resetPassword(token, newPassword) {
  const url = `${API_GATEWAY_BASE_URL}/auth/reset-password`
  return requestJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, newPassword }),
  })
}

async function fetchPortfolio(userId, token) {
  const url = `${API_GATEWAY_BASE_URL}/portfolios/${userId}`
  return requestJson(url, {
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
}

async function patchPortfolio(userId, token, patches) {
  const url = `${API_GATEWAY_BASE_URL}/portfolios/${userId}`
  return requestJson(url, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      patches,
      timestamp: new Date().toISOString(),
    }),
  })
}

async function importBrokerReport(file, token) {
  const mode = 'REPLACE'
  const url = `${API_GATEWAY_BASE_URL}/portfolios/imports/assets?mode=${encodeURIComponent(mode)}&sourceName=${encodeURIComponent(file.name)}`
  const formData = new FormData()
  formData.append('file', file)
  return requestJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  })
}

function formatAmount(value) {
  if (typeof value !== 'number') {
    return '0'
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function mapPortfolioToAssets(portfolio) {
  if (!portfolio) {
    return []
  }

  const sections = [
    { key: 'stocks', type: 'Акции', amountKey: 'amount', assetType: 'STOCK', idKey: 'ticker' },
    { key: 'bonds', type: 'Облигации', amountKey: 'amount', assetType: 'BOND', idKey: 'ticker' },
    { key: 'etfs', type: 'ETF', amountKey: 'amount', assetType: 'ETF', idKey: 'ticker' },
    { key: 'currencies', type: 'Валюты', amountKey: 'amount', assetType: 'CURRENCY', idKey: 'code' },
    { key: 'deposits', type: 'Депозиты', amountKey: 'amount', assetType: 'DEPOSIT', idKey: 'id' },
    { key: 'cryptocurrencies', type: 'Криптовалюты', amountKey: 'amount', assetType: 'CRYPTO_CURRENCY', idKey: 'ticker' },
    { key: 'federalLoanBonds', type: 'ОФЗ', amountKey: 'amount', assetType: 'FEDERAL_LOAN_BOND', idKey: 'ticker' },
    { key: 'metals', type: 'Металлы', amountKey: 'weight', assetType: 'METAL', idKey: 'id' },
  ]

  return sections.flatMap((section) => {
    const source = portfolio[section.key] || {}
    return Object.values(source).map((item) => {
      const ticker = item.ticker || item.code || item.id || '—'
      const amount = item[section.amountKey] ?? 0
      const idValue = item[section.idKey] || ticker
      return {
        idValue,
        ticker,
        type: section.type,
        amount: String(amount),
        assetType: section.assetType,
      }
    })
  })
}

function getSectionSize(portfolioSection) {
  if (!portfolioSection || typeof portfolioSection !== 'object') {
    return 0
  }
  return Object.keys(portfolioSection).length
}

function buildCustDevAnalytics(portfolio, wsSnapshot) {
  const sectionStats = [
    { key: 'stocks', label: 'Акции' },
    { key: 'bonds', label: 'Облигации' },
    { key: 'etfs', label: 'ETF' },
    { key: 'currencies', label: 'Валюты' },
    { key: 'deposits', label: 'Депозиты' },
    { key: 'cryptocurrencies', label: 'Криптовалюты' },
    { key: 'federalLoanBonds', label: 'ОФЗ' },
    { key: 'metals', label: 'Металлы' },
  ]

  const classesCoverage = sectionStats.map((section) => ({
    ...section,
    count: getSectionSize(portfolio?.[section.key]),
  }))

  const connectedClasses = classesCoverage.filter((section) => section.count > 0).length
  const coveragePercent = Math.round((connectedClasses / sectionStats.length) * 100)
  const totalPositions = classesCoverage.reduce((sum, section) => sum + section.count, 0)
  const missingClasses = classesCoverage.filter((section) => section.count === 0).map((section) => section.label)
  const topClass = [...classesCoverage].sort((left, right) => right.count - left.count)[0]
  const realtimeTotal = wsSnapshot?.totalValue || 0

  return {
    coveragePercent,
    connectedClasses,
    totalClasses: sectionStats.length,
    totalPositions,
    missingClasses,
    topClass,
    realtimeTotal,
    classesCoverage,
  }
}

function getClientAction(portfolio) {
  const totalAssets = mapPortfolioToAssets(portfolio).length
  const bondsAndOfz = getSectionSize(portfolio?.bonds) + getSectionSize(portfolio?.federalLoanBonds)
  const deposits = getSectionSize(portfolio?.deposits)
  const stocks = getSectionSize(portfolio?.stocks)
  const currencies = getSectionSize(portfolio?.currencies)

  if (!totalAssets) {
    return {
      title: 'Импортировать отчет',
      description: 'Добавьте первый отчет, чтобы получить персональные подсказки и динамику.',
    }
  }

  if (bondsAndOfz + deposits === 0) {
    return {
      title: 'Добавить защитную часть',
      description: 'Рассмотрите облигации или вклады для снижения волатильности портфеля.',
    }
  }

  if (stocks > bondsAndOfz * 2) {
    return {
      title: 'Снизить концентрацию в акциях',
      description: 'Проверьте баланс риска и постепенно увеличьте защитные инструменты.',
    }
  }

  if (currencies === 0) {
    return {
      title: 'Добавить валютный буфер',
      description: 'Небольшая валютная доля помогает сгладить локальные рыночные риски.',
    }
  }

  return {
    title: 'Поддерживать текущую стратегию',
    description: 'Структура выглядит сбалансированной. Проверяйте ее после каждого пополнения.',
  }
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  const [refreshTokenValue, setRefreshTokenValue] = useState(() => localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY))
  const refreshTokenRef = useRef(refreshTokenValue)
  const refreshInFlightRef = useRef(null)

  useEffect(() => {
    refreshTokenRef.current = refreshTokenValue
  }, [refreshTokenValue])

  const handleAuthSuccess = (authResponse) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, authResponse.accessToken)
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, authResponse.refreshToken)
    setToken(authResponse.accessToken)
    setRefreshTokenValue(authResponse.refreshToken)
  }

  const handleLogout = () => {
    refreshInFlightRef.current = null
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
    setToken(null)
    setRefreshTokenValue(null)
  }

  const refreshSession = async () => {
    const rt = refreshTokenRef.current
    if (!rt) {
      throw new Error('Сессия истекла')
    }
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current
    }
    const promise = (async () => {
      try {
        const authResponse = await refreshAuth(rt)
        handleAuthSuccess(authResponse)
        return authResponse.accessToken
      } catch (error) {
        handleLogout()
        throw error
      } finally {
        refreshInFlightRef.current = null
      }
    })()
    refreshInFlightRef.current = promise
    return promise
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage token={token} />} />
      <Route path="/auth/login" element={<LoginPage onAuthSuccess={handleAuthSuccess} />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/checkout" element={<CheckoutPage token={token} refreshSession={refreshSession} />} />
      <Route path="/premium" element={<Navigate to="/pricing" replace />} />
      <Route
        path="/app/*"
        element={
          token ? (
            <AppLayout token={token} refreshSession={refreshSession} onLogout={handleLogout} />
          ) : (
            <Navigate to="/auth/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function AppLayout({ token, refreshSession, onLogout }) {
  const navigate = useNavigate()
  const [portfolio, setPortfolio] = useState(null)
  const [portfolioError, setPortfolioError] = useState('')
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(true)
  const [refreshId, setRefreshId] = useState(0)

  const userId = useMemo(() => getUserIdFromToken(token), [token])
  const wsUrl = useMemo(() => {
    if (!token) {
      return null
    }
    try {
      const gateway = new URL(API_GATEWAY_BASE_URL, window.location.origin)
      const protocol = gateway.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${protocol}//${gateway.host}${gateway.pathname.replace(/\/$/, '')}/ws/portfolio?token=${token}`
    } catch (error) {
      return null
    }
  }, [token])
  const { snapshot: wsSnapshot, connectionStatus } = useWebSocket(wsUrl)

  useEffect(() => {
    const loadPortfolio = async () => {
      if (!userId) {
        setPortfolioError('Не удалось загрузить портфель. Перелогиньтесь, чтобы обновить сессию.')
        setPortfolio(null)
        setIsLoadingPortfolio(false)
        return
      }

      try {
        setIsLoadingPortfolio(true)
        setPortfolioError('')
        const data = await requestJson(
          `${API_GATEWAY_BASE_URL}/portfolios/${userId}`,
          {
            headers: {
              accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
          },
          refreshSession,
        )
        setPortfolio(data)
      } catch (error) {
        setPortfolio(null)
        setPortfolioError(error.message || 'Не удалось загрузить портфель')
      } finally {
        setIsLoadingPortfolio(false)
      }
    }

    loadPortfolio()
  }, [token, userId, refreshId])

  const handleImported = (nextPortfolio) => {
    if (nextPortfolio) {
      setPortfolio(nextPortfolio)
      setPortfolioError('')
      return
    }
    setRefreshId((current) => current + 1)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-badge">FF</span>
          <div>
            <strong>FuncFund Next</strong>
            <p>Новый дизайн фронтенда</p>
          </div>
        </div>

        <nav className="menu">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={`/app${item.to}`}
              className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <h1>Платформа управления капиталом</h1>
            <p>Видите все активы, изменения и важные действия в одном месте</p>
          </div>
          <div className="row-between topbar-actions">
            <Link to="/pricing" className="secondary-btn top-link-btn">
              Premium
            </Link>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                onLogout()
                navigate('/auth/login')
              }}
            >
              Выйти
            </button>
          </div>
        </header>

        {portfolioError && <div className="error-banner">{portfolioError}</div>}

        <Routes>
          <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <DashboardPage
                portfolio={portfolio}
                isLoading={isLoadingPortfolio}
                wsSnapshot={wsSnapshot}
                wsStatus={connectionStatus}
              />
            }
          />
          <Route
            path="/assets"
            element={
              <AssetsPage
                portfolio={portfolio}
                isLoading={isLoadingPortfolio}
                token={token}
                userId={userId}
                refreshSession={refreshSession}
                onPortfolioPatched={setPortfolio}
              />
            }
          />
          <Route
            path="/import"
            element={
              <ImportPage
                token={token}
                refreshSession={refreshSession}
                onImported={handleImported}
              />
            }
          />
          <Route path="/analytics" element={<AnalyticsPage portfolio={portfolio} wsSnapshot={wsSnapshot} />} />
          <Route path="/premium" element={<PremiumInsidePage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </main>
    </div>
  )
}

function HomePage({ token }) {
  return (
    <div className="landing">
      <header className="landing-header">
        <div className="brand">
          <span className="brand-badge">FF</span>
          <div>
            <strong>FuncFund</strong>
            <p>Единое окно финансов и инвестиций</p>
          </div>
        </div>
        <div className="landing-actions">
          {token ? (
            <Link className="primary-btn top-link-btn" to="/app/dashboard">
              Открыть кабинет
            </Link>
          ) : (
            <>
              <Link className="ghost-link" to="/auth/login">
                Войти
              </Link>
              <Link className="primary-btn top-link-btn" to="/auth/register">
                Начать бесплатно
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="hero card">
        <h1>Контролируйте весь капитал в одном дашборде</h1>
        <p>
          Единый обзор счетов и инвестиций помогает сократить ручную сверку и быстрее принимать
          решения. Поддерживается импорт брокерских отчетов Сбера, чтобы старт занял несколько минут.
        </p>
        <div className="hero-buttons">
          <Link className="primary-btn top-link-btn" to="/pricing">
            Смотреть тарифы
          </Link>
          <Link className="secondary-btn top-link-btn" to="/app/dashboard">
            Открыть демо-кабинет
          </Link>
        </div>
      </section>

      <section className="grid-cards">
        <article className="card">
          <h3>Боль #1: ручная сверка</h3>
          <p className="muted">Сводим банки, брокеров и крипту в один поток без копипаста в Excel.</p>
        </article>
        <article className="card">
          <h3>Боль #2: нет единой картины</h3>
          <p className="muted">Показываем полную структуру активов и динамику за выбранный период.</p>
        </article>
        <article className="card">
          <h3>Боль #3: нет времени</h3>
          <p className="muted">Автообновление и алерты сокращают рутину до нескольких минут в неделю.</p>
        </article>
      </section>
    </div>
  )
}

function LoginPage({ onAuthSuccess }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const nextPath = searchParams.get('next') || '/app/dashboard'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    try {
      setIsLoading(true)
      const data = await loginUser(email, password)
      onAuthSuccess(data)
      navigate(nextPath.startsWith('/') ? nextPath : '/app/dashboard')
    } catch (requestError) {
      const code = requestError.code
      const message = requestError.message || 'Не удалось выполнить вход'
      if (code === 'EMAIL_NOT_VERIFIED') {
        navigate(`/auth/verify-email?email=${encodeURIComponent(email)}`)
        return
      }
      if (code === 'USER_BLOCKED') {
        setError('Аккаунт заблокирован. Обратитесь в поддержку.')
        return
      }
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="auth-wrap">
      <article className="card auth-card">
        <h2>Авторизация</h2>
        <p className="muted">Вход в кабинет для управления портфелем и подпиской.</p>
        <form className="form-grid single" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary-btn wide" disabled={isLoading}>
            {isLoading ? 'Входим...' : 'Войти'}
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
        <p className="muted auth-hint">
          Нет аккаунта? <Link to="/auth/register">Создать</Link>
        </p>
        <p className="muted auth-hint">
          Забыли пароль? <Link to="/auth/forgot-password">Сбросить</Link>
        </p>
      </article>
    </section>
  )
}

function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    try {
      setIsLoading(true)
      await registerUser(email, password)
      navigate(`/auth/verify-email?email=${encodeURIComponent(email)}`)
    } catch (requestError) {
      setError(requestError.message || 'Не удалось создать аккаунт')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="auth-wrap">
      <article className="card auth-card">
        <h2>Регистрация</h2>
        <p className="muted">Создайте аккаунт и включите trial, чтобы проверить ценность автоматизации.</p>
        <form className="form-grid single" onSubmit={handleSubmit}>
          <label>
            Имя
            <input
              type="text"
              placeholder="Иван"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              placeholder="Минимум 8 символов"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary-btn wide" disabled={isLoading}>
            {isLoading ? 'Создаем...' : 'Создать аккаунт'}
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
        <p className="muted auth-hint">
          Уже есть аккаунт? <Link to="/auth/login">Войти</Link>
        </p>
      </article>
    </section>
  )
}

function VerifyEmailPage() {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  const email = params.get('email') || ''

  useEffect(() => {
    const submitVerification = async () => {
      if (!token) {
        return
      }
      try {
        setIsLoading(true)
        await verifyEmail(token)
        setMessage('Email успешно подтвержден. Теперь можно войти в аккаунт.')
      } catch (requestError) {
        setError(requestError.message || 'Не удалось подтвердить email')
      } finally {
        setIsLoading(false)
      }
    }
    submitVerification()
  }, [token])

  const handleResend = async () => {
    if (!email) {
      setError('Email не указан. Повторите регистрацию или укажите email в ссылке.')
      return
    }
    try {
      setIsLoading(true)
      setError('')
      await resendVerification(email)
      setMessage('Письмо для подтверждения отправлено повторно.')
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить письмо')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="auth-wrap">
      <article className="card auth-card">
        <h2>Подтверждение email</h2>
        <p className="muted">Проверьте почту и перейдите по ссылке из письма.</p>
        {isLoading && <p className="muted">Проверяем токен...</p>}
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
        {email && (
          <button type="button" className="secondary-btn wide" onClick={handleResend} disabled={isLoading}>
            Отправить письмо повторно
          </button>
        )}
        <p className="muted auth-hint">
          <Link to="/auth/login">Перейти ко входу</Link>
        </p>
      </article>
    </section>
  )
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      setIsLoading(true)
      setError('')
      await forgotPassword(email)
      setMessage('Если email существует, ссылка для сброса уже отправлена.')
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить запрос на сброс')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="auth-wrap">
      <article className="card auth-card">
        <h2>Сброс пароля</h2>
        <form className="form-grid single" onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <button type="submit" className="primary-btn wide" disabled={isLoading}>
            {isLoading ? 'Отправляем...' : 'Отправить ссылку'}
          </button>
        </form>
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </article>
    </section>
  )
}

function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const token = new URLSearchParams(window.location.search).get('token')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!token) {
      setError('Токен сброса не найден')
      return
    }
    try {
      setIsLoading(true)
      setError('')
      await resetPassword(token, password)
      setMessage('Пароль обновлен. Теперь можно войти с новым паролем.')
    } catch (requestError) {
      setError(requestError.message || 'Не удалось обновить пароль')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="auth-wrap">
      <article className="card auth-card">
        <h2>Новый пароль</h2>
        <form className="form-grid single" onSubmit={handleSubmit}>
          <label>
            Новый пароль
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <button type="submit" className="primary-btn wide" disabled={isLoading}>
            {isLoading ? 'Обновляем...' : 'Сохранить пароль'}
          </button>
        </form>
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </article>
    </section>
  )
}

function PricingPage() {
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState('')

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

  const premium = plans.find((plan) => String(plan.code).toLowerCase() === 'premium')
  const pro = plans.find((plan) => String(plan.code).toLowerCase() === 'pro')
  const priceOrPlaceholder = (plan) =>
    plansLoading ? '…' : plan?.amountRub != null ? formatPlanPrice(plan.amountRub) : '—'

  return (
    <section className="pricing-wrap">
      <header>
        <h1>Платные функции FuncFund</h1>
        <p className="muted">Выберите тариф по уровню автоматизации и глубине аналитики.</p>
      </header>
      {plansError ? <p className="error-text">{plansError}</p> : null}
      <div className="pricing-grid">
        <article className="card pricing-card">
          <h3>Free</h3>
          <p className="price">0 ₽</p>
          <ul className="timeline">
            <li>Базовый дашборд</li>
            <li>Ручной ввод активов</li>
            <li>1 источник импорта</li>
          </ul>
        </article>
        <article className="card pricing-card highlight">
          <p className="badge">Рекомендовано</p>
          <h3>{premium?.title || 'Premium'}</h3>
          <p className="price">{priceOrPlaceholder(premium)}</p>
          <ul className="timeline">
            {premiumFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <Link to="/checkout?plan=premium" className="primary-btn wide top-link-btn">
            Подключить {premium?.title || 'Premium'}
          </Link>
        </article>
        <article className="card pricing-card">
          <h3>{pro?.title || 'Pro'}</h3>
          <p className="price">{priceOrPlaceholder(pro)}</p>
          <ul className="timeline">
            <li>Все из Premium</li>
            <li>Командный доступ и роли</li>
            <li>Расширенные отчеты и сценарии</li>
          </ul>
          <Link to="/checkout?plan=pro" className="secondary-btn wide top-link-btn">
            Выбрать {pro?.title || 'Pro'}
          </Link>
        </article>
      </div>
    </section>
  )
}

function DashboardPage({ portfolio, isLoading, wsSnapshot, wsStatus }) {
  const assets = mapPortfolioToAssets(portfolio)
  const totalPortfolioValue = wsSnapshot?.totalValue || 0
  const stocksCount = getSectionSize(portfolio?.stocks)
  const bondsCount = getSectionSize(portfolio?.bonds) + getSectionSize(portfolio?.federalLoanBonds)
  const currenciesCount = getSectionSize(portfolio?.currencies) + getSectionSize(portfolio?.deposits)
  const action = getClientAction(portfolio)
  const cards = [
    {
      title: 'Текущая стоимость',
      value: `${formatAmount(totalPortfolioValue)} ₽`,
      trend: 'Оценка всех активов на сейчас',
    },
    {
      title: 'Что делать сейчас',
      value: action.title,
      trend: action.description,
    },
    {
      title: 'Ключевой фокус',
      value: stocksCount >= bondsCount ? 'Стабильность портфеля' : 'Потенциал роста',
      trend: stocksCount >= bondsCount
        ? 'Доля рисковых активов выше защитной'
        : 'Баланс в пользу защитных инструментов',
    },
    {
      title: 'Обновление данных',
      value: wsStatus === 'Подключено' ? 'В реальном времени' : 'Обновляется',
      trend: wsSnapshot ? `Текущая оценка: ${formatAmount(wsSnapshot.totalValue || 0)} ₽` : 'Скоро обновим данные',
    },
  ]

  return (
    <section className="page">
      <div className="grid-cards">
        {cards.map((card) => (
          <article key={card.title} className="card">
            <p className="card-label">{card.title}</p>
            <h2>{card.value}</h2>
            <small>{card.trend}</small>
          </article>
        ))}
      </div>

      <div className="grid-two">
        <article className="card">
          <h3>Структура капитала</h3>
          <p className="muted">Понятная раскладка, чтобы быстро оценить баланс риска и надежности</p>
          <div className="stack">
            <div>
              <span>Акции</span>
              <strong>{stocksCount || '—'}</strong>
            </div>
            <div>
              <span>Облигации и ОФЗ</span>
              <strong>{bondsCount || '—'}</strong>
            </div>
            <div>
              <span>Валюта и вклады</span>
              <strong>{currenciesCount || '—'}</strong>
            </div>
            <div>
              <span>Всего позиций</span>
              <strong>{assets.length || '—'}</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <h3>Рекомендации на сегодня</h3>
          <p className="muted">Только действия, которые помогают улучшить результат</p>
          <ul className="timeline">
            <li>{action.description}</li>
            <li>После каждого пополнения обновляйте отчет, чтобы видеть реальную картину</li>
            <li>Если структура сместилась, возвращайте доли к вашему плану</li>
          </ul>
        </article>
      </div>
    </section>
  )
}

function AssetsPage({ portfolio, isLoading, token, userId, refreshSession, onPortfolioPatched }) {
  const assets = mapPortfolioToAssets(portfolio)
  const [formType, setFormType] = useState('STOCK')
  const [formTicker, setFormTicker] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formCurrency, setFormCurrency] = useState('RUB')
  const [formInterestRate, setFormInterestRate] = useState('10')
  const [formDurationMonths, setFormDurationMonths] = useState('12')
  const [formMetalType, setFormMetalType] = useState('GOLD')
  const [formMetalName, setFormMetalName] = useState('Инвестиционный металл')
  const [formMetalForm, setFormMetalForm] = useState('слиток')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const typeOptions = [
    { value: 'STOCK', label: 'Акции' },
    { value: 'BOND', label: 'Облигации' },
    { value: 'ETF', label: 'ETF' },
    { value: 'CRYPTO_CURRENCY', label: 'Криптовалюты' },
    { value: 'CURRENCY', label: 'Валюты' },
    { value: 'FEDERAL_LOAN_BOND', label: 'ОФЗ' },
    { value: 'DEPOSIT', label: 'Депозиты' },
    { value: 'METAL', label: 'Металлы' },
  ]

  const getIdentityKey = (assetType) => {
    if (assetType === 'CURRENCY') {
      return 'code'
    }
    if (assetType === 'DEPOSIT' || assetType === 'METAL') {
      return 'id'
    }
    return 'ticker'
  }

  const getSectionKey = (assetType) => {
    const mapping = {
      STOCK: 'stocks',
      BOND: 'bonds',
      ETF: 'etfs',
      CURRENCY: 'currencies',
      DEPOSIT: 'deposits',
      CRYPTO_CURRENCY: 'cryptocurrencies',
      FEDERAL_LOAN_BOND: 'federalLoanBonds',
      METAL: 'metals',
    }
    return mapping[assetType]
  }

  const normalizeIdentity = (value) => String(value || '').trim().toUpperCase()

  const getRawAssetsByType = (assetType) => {
    const sectionKey = getSectionKey(assetType)
    if (!sectionKey) {
      return []
    }
    return Object.values(portfolio?.[sectionKey] || {})
  }

  const findRawAsset = (assetType, idValue) => {
    const identityKey = getIdentityKey(assetType)
    const target = normalizeIdentity(idValue)
    return getRawAssetsByType(assetType).find(
      (item) => normalizeIdentity(item?.[identityKey] || item?.ticker || item?.code || item?.id) === target,
    )
  }

  const submitPatch = async (patches, okMessage) => {
    if (!userId) {
      setError('Не удалось определить пользователя. Перезайдите в аккаунт.')
      return
    }

    try {
      setIsSaving(true)
      setError('')
      setSuccess('')
      const updatedPortfolio = await requestJson(
        `${API_GATEWAY_BASE_URL}/portfolios/${userId}`,
        {
          method: 'PATCH',
          headers: {
            accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            patches,
            timestamp: new Date().toISOString(),
          }),
        },
        refreshSession,
      )
      onPortfolioPatched(updatedPortfolio)
      setSuccess(okMessage)
    } catch (requestError) {
      setError(requestError.message || 'Не удалось сохранить изменения')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddOrUpdate = async (event) => {
    event.preventDefault()

    const trimmedTicker = formTicker.trim().toUpperCase()
    const numericAmount = Number(formAmount)

    if (!trimmedTicker || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Укажите корректный тикер/код и количество больше нуля')
      return
    }

    const nowIso = new Date().toISOString()
    let body

    if (formType === 'DEPOSIT') {
      body = {
        id: trimmedTicker,
        amount: numericAmount,
        currency: formCurrency.trim().toUpperCase(),
        interestRate: Number(formInterestRate) || 0,
        startDate: nowIso,
        durationMonths: Number(formDurationMonths) || 12,
      }
    } else if (formType === 'METAL') {
      body = {
        id: trimmedTicker,
        type: formMetalType.trim().toUpperCase(),
        weight: numericAmount,
        name: formMetalName.trim() || 'Инвестиционный металл',
        form: formMetalForm.trim() || 'слиток',
        value: 0,
        currency: formCurrency.trim().toUpperCase(),
        createdAt: nowIso,
        updatedAt: nowIso,
      }
    } else {
      const identityKey = getIdentityKey(formType)
      body = { [identityKey]: trimmedTicker, amount: numericAmount }
    }

    await submitPatch(
      [
        {
          operationType: 'UPSERT',
          assetType: formType,
          body: JSON.stringify(body),
        },
      ],
      'Актив сохранен',
    )
    setFormTicker('')
    setFormAmount('')
    setFormCurrency('RUB')
  }

  const handleEdit = (asset) => {
    const rawAsset = findRawAsset(asset.assetType, asset.idValue)
    setFormType(asset.assetType)
    setFormTicker(asset.idValue)
    setFormAmount(asset.amount)
    if (asset.assetType === 'DEPOSIT' && rawAsset) {
      setFormCurrency(rawAsset.currency || 'RUB')
      setFormInterestRate(String(rawAsset.interestRate ?? '10'))
      setFormDurationMonths(String(rawAsset.durationMonths ?? '12'))
    }
    if (asset.assetType === 'METAL' && rawAsset) {
      setFormCurrency(rawAsset.currency || 'RUB')
      setFormMetalType(rawAsset.type || 'GOLD')
      setFormMetalName(rawAsset.name || 'Инвестиционный металл')
      setFormMetalForm(rawAsset.form || 'слиток')
    }
    setError('')
    setSuccess('Заполните форму и нажмите "Сохранить актив"')
  }

  const handleDelete = async (asset) => {
    const identityKey = getIdentityKey(asset.assetType)
    const sourceAssets = getRawAssetsByType(asset.assetType)
    const target = normalizeIdentity(asset.idValue)
    const targetAsset =
      sourceAssets.find(
        (item) => normalizeIdentity(item?.[identityKey] || item?.ticker || item?.code || item?.id) === target,
      ) || null

    const remainingAssets = sourceAssets.filter(
      (item) => normalizeIdentity(item?.[identityKey] || item?.ticker || item?.code || item?.id) !== target,
    )

    if (!targetAsset) {
      setError('Не удалось найти актив для удаления. Обновите страницу и попробуйте снова.')
      return
    }

    const patches = [
      {
        operationType: 'DELETE',
        assetType: asset.assetType,
        body: JSON.stringify(targetAsset),
      },
      ...remainingAssets.map((item) => ({
        operationType: 'UPSERT',
        assetType: asset.assetType,
        body: JSON.stringify(item),
      })),
    ]

    await submitPatch(
      patches,
      'Актив удален',
    )
  }

  return (
    <section className="page">
      <article className="card">
        <div className="row-between">
          <div>
            <h3>Список активов</h3>
            <p className="muted">Все ваши позиции в единой таблице</p>
          </div>
          <span className="muted">{isLoading ? 'Загрузка...' : `Позиций: ${assets.length}`}</span>
        </div>
        <form className="asset-form" onSubmit={handleAddOrUpdate}>
          <label>
            Тип актива
            <select value={formType} onChange={(event) => setFormType(event.target.value)}>
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тикер / код
            <input
              type="text"
              placeholder={
                formType === 'CURRENCY'
                  ? 'USD'
                  : formType === 'DEPOSIT' || formType === 'METAL'
                    ? 'MY_ASSET_001'
                    : 'SBER'
              }
              value={formTicker}
              onChange={(event) => setFormTicker(event.target.value)}
            />
          </label>
          <label>
            Количество
            <input
              type="number"
              min="0"
              step="any"
              placeholder="10"
              value={formAmount}
              onChange={(event) => setFormAmount(event.target.value)}
            />
          </label>
          {(formType === 'DEPOSIT' || formType === 'METAL') && (
            <label>
              Валюта
              <input
                type="text"
                placeholder="RUB"
                value={formCurrency}
                onChange={(event) => setFormCurrency(event.target.value)}
              />
            </label>
          )}
          {formType === 'DEPOSIT' && (
            <>
              <label>
                Ставка, %
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formInterestRate}
                  onChange={(event) => setFormInterestRate(event.target.value)}
                />
              </label>
              <label>
                Срок, мес
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formDurationMonths}
                  onChange={(event) => setFormDurationMonths(event.target.value)}
                />
              </label>
            </>
          )}
          {formType === 'METAL' && (
            <>
              <label>
                Тип металла
                <input
                  type="text"
                  placeholder="GOLD"
                  value={formMetalType}
                  onChange={(event) => setFormMetalType(event.target.value)}
                />
              </label>
              <label>
                Название
                <input
                  type="text"
                  placeholder="Инвестиционный металл"
                  value={formMetalName}
                  onChange={(event) => setFormMetalName(event.target.value)}
                />
              </label>
              <label>
                Форма
                <input
                  type="text"
                  placeholder="слиток"
                  value={formMetalForm}
                  onChange={(event) => setFormMetalForm(event.target.value)}
                />
              </label>
            </>
          )}
          <button type="submit" className="primary-btn" disabled={isSaving}>
            {isSaving ? 'Сохраняем...' : 'Сохранить актив'}
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
        {success && <p className="success-text">{success}</p>}
        <table>
          <thead>
            <tr>
              <th>Тикер</th>
              <th>Тип</th>
              <th>Объем</th>
              <th>Доля</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {assets.length ? (
              assets.map((asset, index) => (
                <tr key={`${asset.ticker}-${index}`}>
                  <td>{asset.ticker}</td>
                  <td>{asset.type}</td>
                  <td>{formatAmount(Number(asset.amount))}</td>
                  <td>—</td>
                  <td className="actions-cell">
                    <button type="button" className="secondary-btn mini-btn" onClick={() => handleEdit(asset)}>
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="secondary-btn mini-btn danger-btn"
                      onClick={() => handleDelete(asset)}
                      disabled={isSaving}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="muted">
                  Портфель пока пуст. Импортируйте брокерский отчет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </article>
    </section>
  )
}

function ImportPage({ token, refreshSession, onImported }) {
  const [file, setFile] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleUpload = async () => {
    if (!file) {
      setError('Выберите файл отчета')
      return
    }

    try {
      setIsLoading(true)
      setError('')
      setSuccess('')
      const mode = 'REPLACE'
      const url = `${API_GATEWAY_BASE_URL}/portfolios/imports/assets?mode=${encodeURIComponent(mode)}&sourceName=${encodeURIComponent(file.name)}`
      const formData = new FormData()
      formData.append('file', file)
      const result = await requestJson(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
        refreshSession,
      )
      onImported(result?.portfolio)
      setSuccess(`Импорт завершен, добавлено позиций: ${result?.importedAssetsCount ?? 0}`)
      setFile(null)
    } catch (requestError) {
      setError(requestError.message || 'Не удалось импортировать отчет')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="page">
      <div className="grid-two">
        <article className="card">
          <h3>Импорт брокерского отчета</h3>
          <p className="muted">
            Загрузите файл и быстро обновите портфель без ручного ввода. Сейчас поддерживается импорт
            отчетов Сбера (HTML).
          </p>
          <label className="dropzone" htmlFor="file-upload">
            Перетащите файл сюда или выберите вручную
            <input
              id="file-upload"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <button type="button" className="primary-btn wide" onClick={handleUpload} disabled={isLoading}>
            {isLoading ? 'Импортируем...' : 'Загрузить и распознать'}
          </button>
          {error && <p className="error-text">{error}</p>}
          {success && <p className="success-text">{success}</p>}
        </article>

        <article className="card">
          <h3>Что вы получите после загрузки</h3>
          <ol className="steps">
            <li>Обновленный список активов в одном экране</li>
            <li>Пересчет структуры и текущей оценки капитала</li>
            <li>Актуальные подсказки по следующим шагам</li>
            <li>Быстрое сравнение с вашей целевой стратегией</li>
          </ol>
        </article>
      </div>
    </section>
  )
}

function AnalyticsPage({ portfolio, wsSnapshot }) {
  const analytics = buildCustDevAnalytics(portfolio, wsSnapshot)
  const action = getClientAction(portfolio)
  const topClasses = analytics.classesCoverage
    .filter((section) => section.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 4)

  return (
    <section className="page">
      <div className="grid-cards">
        <article className="card">
          <p className="card-label">Общий капитал</p>
          <h2>{formatAmount(analytics.realtimeTotal)} ₽</h2>
          <small>Актуальная оценка портфеля</small>
        </article>
        <article className="card">
          <p className="card-label">Экономия времени</p>
          <h2>{analytics.totalPositions ? '3-5 ч/мес' : '—'}</h2>
          <small>Меньше ручных действий, больше времени на решения</small>
        </article>
        <article className="card">
          <p className="card-label">Покрытие активов</p>
          <h2>{analytics.connectedClasses} из {analytics.totalClasses}</h2>
          <small>Сколько типов активов уже под единым контролем</small>
        </article>
        <article className="card">
          <p className="card-label">Скорость контроля</p>
          <h2>{analytics.coveragePercent}%</h2>
          <small>Чем выше покрытие, тем быстрее принимать решения</small>
        </article>
      </div>

      <div className="grid-two">
        <article className="card">
          <h3>Ключевые ориентиры</h3>
          <p className="muted">Простые показатели, которые помогают не терять контроль над капиталом</p>
          <div className="insight-list">
            <div className="insight-item">
              <div className="row-between">
                <span>Полнота учета активов</span>
                <strong>{analytics.coveragePercent}%</strong>
              </div>
              <div className="progress-line">
                <span style={{ width: `${analytics.coveragePercent}%` }} />
              </div>
            </div>
            <div className="insight-item">
              <div className="row-between">
                <span>Регулярность обновления</span>
                <strong>{analytics.totalPositions ? 'Высокая' : 'Низкая'}</strong>
              </div>
              <div className="progress-line">
                <span style={{ width: `${analytics.totalPositions ? 85 : 20}%` }} />
              </div>
            </div>
            <div className="insight-item">
              <div className="row-between">
                <span>Готовность к действиям</span>
                <strong>{analytics.totalPositions ? 'Готово' : 'Нужно заполнить'}</strong>
              </div>
              <div className="progress-line">
                <span style={{ width: `${analytics.totalPositions ? 80 : 15}%` }} />
              </div>
            </div>
          </div>
        </article>

        <article className="card">
          <h3>Ваш следующий шаг</h3>
          <ul className="timeline">
            <li>
              <strong>Приоритет:</strong> {action.title}
            </li>
            <li>
              <strong>Почему важно:</strong> {action.description}
            </li>
            <li>
              <strong>Регулярность:</strong> обновляйте данные после пополнений и крупных сделок.
            </li>
            <li>
              <strong>Контроль риска:</strong> раз в месяц сверяйте фактическую и целевую структуру.
            </li>
          </ul>
          <div className="stack">
            {analytics.missingClasses.length ? (
              analytics.missingClasses.slice(0, 4).map((assetClass) => (
                <div key={assetClass}>
                  <span>{assetClass}</span>
                  <strong>Еще не добавлен</strong>
                </div>
              ))
            ) : topClasses.length ? (
              topClasses.map((section) => (
                <div key={section.key}>
                  <span>{section.label}</span>
                  <strong>{section.count} поз.</strong>
                </div>
              ))
            ) : (
              <div>
                <span>Портфель пока пуст</span>
                <strong>Импортируйте первый отчет</strong>
              </div>
            )}
          </div>
        </article>
      </div>

      <article className="card">
        <h3>Краткий аналитический вывод</h3>
        <p className="muted">
          Главная цель — чтобы вы быстро понимали, что происходит с капиталом, и принимали решения
          без ручной рутины и лишних экранов.
        </p>
        <div className="placeholder-chart">
          <span>Дальше: персональные сценарии действий по вашей целевой стратегии</span>
        </div>
      </article>
    </section>
  )
}

function ProfilePage() {
  return (
    <section className="page">
      <article className="card form-card">
        <h3>Профиль пользователя</h3>
        <p className="muted">Макет настроек аккаунта и уведомлений</p>
        <div className="form-grid">
          <label>
            Email
            <input type="email" placeholder="you@example.com" />
          </label>
          <label>
            Телефон
            <input type="tel" placeholder="+7 900 000-00-00" />
          </label>
          <label>
            Валюта
            <select>
              <option>RUB</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </label>
          <label>
            Язык интерфейса
            <select>
              <option>Русский</option>
              <option>English</option>
            </select>
          </label>
        </div>
        <button type="button" className="primary-btn">
          Сохранить настройки
        </button>
      </article>
    </section>
  )
}

function PremiumInsidePage() {
  return (
    <section className="page">
      <article className="card">
        <h3>Платные функции в продукте</h3>
        <p className="muted">Экран-превью для того, как Premium будет выглядеть внутри кабинета.</p>
        <ul className="timeline">
          {premiumFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <Link to="/pricing" className="primary-btn top-link-btn">
          Перейти к тарифам
        </Link>
      </article>
    </section>
  )
}

export default App
