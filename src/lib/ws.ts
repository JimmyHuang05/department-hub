/**
 * WebSocket 客户端连接管理
 * - 自动重连（指数退避）
 * - 心跳保活
 * - 消息路由
 */

type MessageHandler = (data: any) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private token: string = '';
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: any = null;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private destroyed: boolean = false;
  private heartbeatTimer: any = null;
  private isConnected: boolean = false;
  private onStatusChange: ((connected: boolean) => void) | null = null;

  connect(token: string) {
    this.token = token;
    this.destroyed = false;
    this.doConnect();
  }

  private doConnect() {
    if (this.destroyed) return;
    if (this.ws) this.close();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.send({ type: 'auth', token: this.token });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'ping') {
          this.send({ type: 'pong' });
          return;
        }
        if (msg.type === 'auth-ok') {
          this.isConnected = true;
          this.reconnectDelay = 1000;
          this.startHeartbeat();
          this.onStatusChange?.(true);
          this.emit('_ready', msg);
          return;
        }
        if (msg.type === 'auth-error') {
          this.onStatusChange?.(false);
          this.emit('auth-error', msg);
          return;
        }

        this.emit(msg.type, msg);
      } catch (e) {
        // 忽略解析错误
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.stopHeartbeat();
      this.onStatusChange?.(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose 会紧接着触发
    };
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'pong' });
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.doConnect();
    }, this.reconnectDelay);
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  once(type: string, handler: MessageHandler): void {
    const wrapper = (data: any) => {
      handler(data);
      this.handlers.get(type)?.delete(wrapper);
    };
    this.on(type, wrapper);
  }

  private emit(type: string, data: any) {
    this.handlers.get(type)?.forEach(h => h(data));
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.onStatusChange = cb;
    return () => { this.onStatusChange = null; };
  }

  get connected(): boolean {
    return this.isConnected;
  }

  close() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.handlers.clear();
  }
}

export const wsClient = new WSClient();
