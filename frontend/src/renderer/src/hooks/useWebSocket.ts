import { useEffect, useState, useCallback, useRef } from 'react'
import { wsClient } from '../lib/websocket'

// Track if connect() has been called globally (prevents React StrictMode double-connect)
let globalConnected = false

/** Hook to manage WebSocket connection lifecycle and message handling. */
export function useWebSocket() {
  const [connected, setConnected] = useState(wsClient.connected)

  useEffect(() => {
    // Only call connect once across all component instances
    if (!globalConnected) {
      globalConnected = true
      wsClient.connect()
    }

    const unsub1 = wsClient.on('_connected', () => setConnected(true))
    const unsub2 = wsClient.on('_disconnected', () => setConnected(false))

    // Sync initial state
    setConnected(wsClient.connected)

    return () => {
      unsub1()
      unsub2()
    }
  }, [])

  const send = useCallback((type: string, data?: any) => {
    wsClient.send(type, data)
  }, [])

  const subscribe = useCallback((type: string, handler: (data: any) => void) => {
    return wsClient.on(type, handler)
  }, [])

  return { connected, send, subscribe }
}
