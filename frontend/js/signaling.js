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
    this.maxReconnectAttempts = 8;
    this.isConnected = false;
    this.heartbeatInterval = null;
    this.reconnectTimer = null;
    this.iceCandidateQueues = new Map(); // Map<targetUserId, candidate[]>
    this.iceBatchTimers = new Map(); // Map<targetUserId, timerId>
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
        const wasReconnecting = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connection_change', { status: 'connected', wasReconnecting });
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
        this.stopHeartbeat();
        console.warn(`[SignalingClient] Conexão WebSocket encerrada. Código: ${event.code}`);
        this.isConnected = false;
        this.emit('connection_change', { status: 'disconnected', code: event.code });
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

  /**
   * Tenta reconectar com intervalo progressivo (backoff exponencial) e jitter aleatório
   * Evita "thundering herd" com muitos clientes reconectando simultaneamente
   */
  attemptReconnect() {
    if (!this.roomId) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const baseDelay = Math.min(1000 * Math.pow(1.6, this.reconnectAttempts), 12000);
      const jitter = Math.floor(Math.random() * 800);
      const delay = Math.round(baseDelay + jitter);

      console.log(`[SignalingClient] Tentando reconectar em ${delay}ms (Tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      this.emit('reconnecting', {
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        delayMs: delay
      });

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.roomId) return;
        this.connect().catch(() => {});
      }, delay);
    } else {
      console.warn('[SignalingClient] Limite de tentativas de reconexão automática atingido.');
      this.emit('reconnect_failed', {
        attempts: this.reconnectAttempts
      });
    }
  }

  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.emit('reconnect_cancelled');
  }

  reconnectNow() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    return this.connect();
  }

  /**
   * Enfileira e agrupa candidatos ICE locais para envio em lote (batching)
   * Reduz drasticamente o volume de frames WebSocket em salas com múltiplos peers
   */
  sendIceCandidate(candidate, to) {
    if (!to || !candidate) return;
    if (!this.iceCandidateQueues.has(to)) {
      this.iceCandidateQueues.set(to, []);
    }
    this.iceCandidateQueues.get(to).push(candidate);

    if (this.iceCandidateQueues.get(to).length >= 8) {
      this.flushIceCandidates(to);
      return;
    }

    if (!this.iceBatchTimers.has(to)) {
      const timer = setTimeout(() => {
        this.flushIceCandidates(to);
      }, 35);
      this.iceBatchTimers.set(to, timer);
    }
  }

  flushIceCandidates(to) {
    if (this.iceBatchTimers.has(to)) {
      clearTimeout(this.iceBatchTimers.get(to));
      this.iceBatchTimers.delete(to);
    }

    const queue = this.iceCandidateQueues.get(to);
    if (!queue || queue.length === 0) return;

    const batch = queue.splice(0, queue.length);
    if (batch.length === 1) {
      this.send('ICE_CANDIDATE', batch[0], to);
    } else {
      this.send('ICE_CANDIDATE', { candidates: batch }, to);
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

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('PING', {});
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  disconnect() {
    this.stopHeartbeat();
    this.cancelReconnect();
    for (const timer of this.iceBatchTimers.values()) {
      clearTimeout(timer);
    }
    this.iceBatchTimers.clear();
    this.iceCandidateQueues.clear();
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
