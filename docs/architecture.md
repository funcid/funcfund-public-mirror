# Архитектура FuncFund (overview)

Высокоуровневая схема. Детали реализации, деплой и внутренние сервисы не раскрываются.

```mermaid
graph TB
  subgraph Clients
    Mobile["Mobile / PWA<br/>Expo"]
    Web["Web<br/>React + Vite legacy"]
  end

  subgraph Edge
    GW["API Gateway"]
  end

  subgraph Services
    User["User / Auth"]
    Portfolio["Portfolio"]
    Dictionary["Dictionary / Search"]
    Billing["Billing"]
    WS["Live quotes WS"]
  end

  subgraph Data
    PG[(PostgreSQL)]
    Redis[(Redis)]
    OS[(OpenSearch)]
    CH[(ClickHouse)]
  end

  Mobile --> GW
  Web --> GW
  GW --> User
  GW --> Portfolio
  GW --> Dictionary
  GW --> Billing
  GW --> WS
  User --> PG
  Portfolio --> PG
  Portfolio --> CH
  Dictionary --> OS
  Billing --> PG
  WS --> Redis
```

## Публичные контракты

См. `contracts/public/`:

- `user-api.yaml` — регистрация, login, OAuth-провайдеры, профиль
- `portfolio-api.yaml` — портфель, история, импорт, интеграции
- `dictionary-api.yaml` — поиск активов и курсы
- `billing-api.yaml` — тарифы, подписка, checkout

Internal и webhook-эндпоинты в mirror не включены.
