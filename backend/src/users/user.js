/**
 * Classe que representa um Usuário Conectado ao Servidor
 */

export class User {
  constructor(id, name, ws) {
    this.id = id;
    this.name = name || `User-${id.substring(0, 5)}`;
    this.ws = ws;
    this.roomId = null;
    this.isHost = false;
    this.isMuted = false;
    this.isScreenSharing = false;
    this.isCameraActive = false;
    this.mediaState = { screen: false, camera: false, mids: {} };
    this.joinedAt = new Date();

    // Controle de Rate Limiting com algoritmo Token Bucket
    this.tokens = 160; // Capacidade inicial de burst
    this.maxTokens = 160;
    this.lastRefill = Date.now();
    this.lastRateLimitWarning = 0;
  }

  /**
   * Envia uma mensagem JSON padronizada através do WebSocket deste usuário
   */
  send(messageObject) {
    if (this.ws && this.ws.readyState === 1) { // 1 = OPEN
      try {
        this.ws.send(JSON.stringify(messageObject));
      } catch (err) {
        console.error(`[User ${this.id}] Erro ao enviar mensagem:`, err.message);
      }
    }
  }

  /**
   * Verifica se o usuário excedeu o limite de mensagens usando Token Bucket
   * Permite rajadas instantâneas legítimas de negociação ICE enquanto bloqueia floods sustentados
   */
  checkRateLimit(maxPerSecond = 60, burstCapacity = 160) {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.maxTokens = burstCapacity;
    this.tokens = Math.min(this.maxTokens, this.tokens + (elapsedSec * maxPerSecond));
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Representação serializável do usuário para envio aos outros participantes
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      isHost: this.isHost,
      isMuted: this.isMuted,
      isScreenSharing: this.isScreenSharing,
      isCameraActive: this.isCameraActive,
      mediaState: this.mediaState,
      joinedAt: this.joinedAt
    };
  }
}
