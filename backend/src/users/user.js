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

    // Controle de Rate Limiting
    this.messageCount = 0;
    this.rateWindowStart = Date.now();
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
   * Verifica se o usuário excedeu o limite de mensagens por segundo
   */
  checkRateLimit(maxPerSecond, windowMs = 1000) {
    const now = Date.now();
    if (now - this.rateWindowStart > windowMs) {
      this.rateWindowStart = now;
      this.messageCount = 1;
      return true;
    }

    this.messageCount++;
    return this.messageCount <= maxPerSecond;
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
