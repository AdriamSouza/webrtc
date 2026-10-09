/**
 * Cliente de Sinalização WebSocket (Canal 2: WSS)
 * Responsável por conectar ao servidor Node.js e despachar mensagens padronizadas JSON.
 */

export class SignalingClient {
  constructor() {
    this.ws = null;
    this.roomId = null;
    this.userId = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.isConnected = false;
  }

  /**
   * Conecta ao servidor WebSocket usando o protocolo e host atuais da página
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this._pendingConnectPromise) {
      return this._pendingConnectPromise;
    }

    this._pendingConnectPromise = new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      console.log(`[SignalingClient] Conectando ao servidor em ${wsUrl}...`);

      let connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          try { if (this.ws) this.ws.close(); } catch (_) {}
          this._pendingConnectPromise = null;
          reject(new Error('Tempo limite de conexão esgotado ao contatar o servidor de sinalização.'));
        }
      }, 8000);

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e) {
        clearTimeout(connectionTimeout);
        this._pendingConnectPromise = null;
        return reject(e);
      }

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this._pendingConnectPromise = null;
        console.log('[SignalingClient] Conexão WebSocket estabelecida com sucesso.');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connection_change', { status: 'connected' });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleIncomingMessage(message);
        } catch (err) {
          console.error('[SignalingClient] Erro ao decodificar JSON recebido:', err);
        }
      };

      this.ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        this._pendingConnectPromise = null;
        console.warn(`[SignalingClient] Conexão WebSocket encerrada. Código: ${event.code}`);
        this.isConnected = false;
        this.emit('connection_change', { status: 'disconnected' });
        if (this.roomId) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (err) => {
        clearTimeout(connectionTimeout);
        this._pendingConnectPromise = null;
        console.error('[SignalingClient] Erro no WebSocket:', err);
        this.emit('error', err);
        if (!this.isConnected) {
          reject(new Error('Falha ao conectar via WebSocket seguro (WSS). Verifique se o servidor está online e se o certificado foi aceito no navegador.'));
        }
      };
    });

    return this._pendingConnectPromise;
  }

  attemptReconnect() {
    if (!this.roomId) return;
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      console.log(`[SignalingClient] Tentando reconectar em ${delay}ms (Tentativa ${this.reconnectAttempts})...`);
      setTimeout(() => {
        if (!this.roomId) return;
        this.connect().catch(() => {});
      }, delay);
    }
  }

  /**
   * Envia uma mensagem no formato padronizado do protocolo
   */
  send(type, data = {}, to = null) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[SignalingClient] Não foi possível enviar mensagem: WebSocket não está aberto.');
      return false;
    }

    const payload = {
      type,
      roomId: this.roomId,
      from: this.userId,
      to,
      data,
      timestamp: Date.now()
    };

    this.ws.send(JSON.stringify(payload));
    return true;
  }

  handleIncomingMessage(message) {
    const { type } = message;

    // Emite para ouvintes específicos do tipo de mensagem
    this.emit(type, message);

    // Emite também para ouvinte genérico 'message'
    this.emit('message', message);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const filtered = this.listeners.get(event).filter(cb => cb !== callback);
    this.listeners.set(event, filtered);
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    for (const callback of this.listeners.get(event)) {
      try {
        callback(data);
      } catch (err) {
        console.error(`[SignalingClient] Erro no listener do evento '${event}':`, err);
      }
    }
  }

  disconnect() {
    this.roomId = null;
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.isConnected = false;
  }
}
