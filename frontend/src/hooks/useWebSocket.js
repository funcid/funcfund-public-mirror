import { useEffect, useRef, useState } from 'react'
import { Sentry } from '../observability/sentry'

export function useWebSocket(url) {
  const [snapshot, setSnapshot] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('Отключено')
  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)

  useEffect(() => {
    if (!url) {
      setConnectionStatus('Ожидание токена...')
      return undefined
    }

    let isDisposed = false

    const connect = () => {
      if (isDisposed) {
        return
      }

      try {
        setConnectionStatus('Подключение...')
        const socket = new WebSocket(url)
        socketRef.current = socket

        socket.onopen = () => {
          setConnectionStatus('Подключено')
        }

        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)

            if (message.type === 'PORTFOLIO_SNAPSHOT') {
              setSnapshot(message.payload)
              return
            }

            if (message.type === 'ASSET_UPDATE') {
              const update = message.payload
              setSnapshot((prev) => {
                if (!prev) {
                  return prev
                }
                const nextAssets = {
                  ...prev.assets,
                  [update.ticker]: {
                    ticker: update.ticker,
                    amount: update.amount,
                    price: update.price,
                    totalValue: update.totalValue,
                  },
                }
                const nextTotalValue = Object.values(nextAssets).reduce(
                  (sum, asset) => sum + (asset.totalValue || 0),
                  0,
                )

                return {
                  ...prev,
                  assets: nextAssets,
                  totalValue: nextTotalValue,
                }
              })
            }
          } catch (error) {
            setConnectionStatus('Ошибка чтения сообщения')
            Sentry.captureException(error, {
              tags: { area: 'ws', type: 'message_parse_error' },
              extra: { url },
            })
          }
        }

        socket.onerror = () => {
          setConnectionStatus('Ошибка подключения')
          Sentry.captureMessage('WebSocket connection error', 'error')
        }

        socket.onclose = () => {
          if (isDisposed) {
            return
          }
          setConnectionStatus('Переподключение...')
          reconnectTimerRef.current = window.setTimeout(connect, 3000)
        }
      } catch (error) {
        setConnectionStatus('Ошибка подключения')
        Sentry.captureException(error, {
          tags: { area: 'ws', type: 'connect_error' },
          extra: { url },
        })
        reconnectTimerRef.current = window.setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      isDisposed = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      if (socketRef.current) {
        socketRef.current.close()
      }
    }
  }, [url])

  return { snapshot, connectionStatus }
}
