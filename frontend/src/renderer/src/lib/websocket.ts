/**
 * WebSocket client singleton for communicating with the Python backend.
 */

type MessageHandler = (msg: any) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private handlers: Map<string, Set<MessageHandler>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false

  constructor(url: string = 'ws://127.0.0.1:9099/ws') {
    this.url = url
  }

  get connected(): boolean {
    return this._connected
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ws?.readyState === WebSocket.CONNECTING) return

    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        console.log('[WS] Connected to backend')
        this._connected = true
        this._emit('_connected', {})
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const type = msg.type as string
          this._emit(type, msg.data || msg)
          this._emit('*', msg) // wildcard for debug
        } catch (e) {
          console.error('[WS] Parse error:', e)
        }
      }

      this.ws.onclose = () => {
        console.log('[WS] Disconnected')
        this._connected = false
        this._emit('_disconnected', {})
        this._scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err)
        this.ws?.close()
      }
    } catch (e) {
      console.error('[WS] Connection failed:', e)
      this._scheduleReconnect()
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this._connected = false
  }

  send(type: string, data?: any): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected, cannot send:', type)
      return
    }
    this.ws.send(JSON.stringify({ type, data: data || {} }))
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler)
    }
  }

  private _emit(type: string, data: any): void {
    this.handlers.get(type)?.forEach((handler) => {
      try {
        handler(data)
      } catch (e) {
        console.error(`[WS] Handler error for ${type}:`, e)
      }
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      console.log('[WS] Attempting reconnect...')
      this.connect()
    }, 2000)
  }
}

// Singleton instance
export const wsClient = new WebSocketClient()
