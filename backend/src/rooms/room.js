/**
 * Classe que representa uma Sala Virtual de Transmissão P2P
 * Documentação Arquitetural: Seção 9 (Gerenciamento de salas)
 */

export class Room {
  constructor(id, metadata = {}) {
    this.id = id;
    this.hostId = null;
    this.hostToken = metadata.hostToken || null;
    this.password = metadata.password ? String(metadata.password).trim() : null;
    this.users = new Map(); // Map<userId, User>
    this.workers = new Map(); // Map<workerId, { user, hostId }>
    this.workerTokens = new Map(); // Map<token, { hostId, createdAt, used }>
    this.streams = new Map(); // Map<streamId, StreamInfo> (Catálogo efêmero de transmissões)
    this.status = 'idle'; // 'idle' | 'streaming' | 'closed'
    this.metadata = metadata;
    this.createdAt = new Date();
    this.lastActiveAt = new Date();
  }

  hasPassword() {
    return Boolean(this.password && this.password.length > 0);
  }

  verifyPassword(candidatePassword) {
    if (!this.hasPassword()) return true;
    return this.password === (candidatePassword ? String(candidatePassword).trim() : '');
  }

  verifyHostToken(token) {
    if (!this.hostToken) return false;
    return this.hostToken === token;
  }

  /**
   * Adiciona um participante à sala
   * Se for o primeiro ou explicitamente o criador, assume o papel de Host
   */
  addUser(user, makeHost = false) {
    user.roomId = this.id;
    if (makeHost || !this.hostId) {
      this.hostId = user.id;
      user.isHost = true;
    } else {
      user.isHost = false;
    }

    this.users.set(user.id, user);
    this.lastActiveAt = new Date();
    return user.isHost;
  }

  /**
   * Remove um participante da sala
   * Se o Host sair, promove o próximo participante ou atualiza estado
   */
  removeUser(userId) {
    const user = this.users.get(userId);
    if (!user) return null;

    this.users.delete(userId);
    user.roomId = null;
    this.lastActiveAt = new Date();

    // Se o host saiu e ainda há participantes, promove o participante mais antigo
    if (this.hostId === userId) {
      if (this.users.size > 0) {
        const nextHost = this.users.values().next().value;
        this.hostId = nextHost.id;
        nextHost.isHost = true;
        this.status = 'idle';
      } else {
        this.hostId = null;
        this.status = 'closed';
      }
    }

    return user;
  }

  /**
   * Registra uma nova transmissão publicada na sala
   */
  publishStream(user, sourceType = 'desktop', customTitle = null) {
    const streamId = `${user.id}-${sourceType}`;
    const defaultTitle = (sourceType === 'desktop' || sourceType === 'screen')
      ? `Área de Trabalho de ${user.name}`
      : `Câmera de ${user.name}`;

    const streamInfo = {
      streamId,
      roomId: this.id,
      hostId: user.id,
      hostName: user.name,
      sourceType: (sourceType === 'screen') ? 'desktop' : sourceType,
      title: customTitle || defaultTitle,
      status: 'live',
      publishedAt: Date.now()
    };

    this.streams.set(streamId, streamInfo);
    this.status = 'streaming';
    this.lastActiveAt = new Date();
    return streamInfo;
  }

  /**
   * Remove uma transmissão publicada (por tipo específico ou todas do usuário)
   */
  unpublishStream(userId, sourceType = null) {
    const removed = [];
    if (sourceType) {
      const typeKey = (sourceType === 'screen') ? 'desktop' : sourceType;
      const streamId = `${userId}-${typeKey}`;
      const altStreamId = `${userId}-${sourceType}`;
      [streamId, altStreamId].forEach(id => {
        if (this.streams.has(id)) {
          removed.push(this.streams.get(id));
          this.streams.delete(id);
        }
      });
    } else {
      for (const [streamId, info] of this.streams.entries()) {
        if (info.hostId === userId) {
          removed.push(info);
          this.streams.delete(streamId);
        }
      }
    }

    if (this.streams.size === 0) {
      this.status = 'idle';
    }
    this.lastActiveAt = new Date();
    return removed;
  }

  getStream(streamId) {
    if (!streamId) return null;
    if (this.streams.has(streamId)) return this.streams.get(streamId);
    if (streamId.endsWith('-screen')) return this.streams.get(streamId.replace(/-screen$/, '-desktop')) || null;
    if (streamId.endsWith('-desktop')) return this.streams.get(streamId.replace(/-desktop$/, '-screen')) || null;
    return null;
  }

  getAllStreams() {
    return Array.from(this.streams.values());
  }

  getUser(userId) {
    return this.users.get(userId);
  }

  getAllUsers() {
    return Array.from(this.users.values());
  }

  isEmpty() {
    return this.users.size === 0;
  }

  getUserCount() {
    return this.users.size;
  }

  /**
   * Transmite uma mensagem JSON para todos os participantes da sala (com exclusão opcional)
   */
  broadcast(messageObject, exceptUserId = null) {
    for (const [id, user] of this.users.entries()) {
      if (id !== exceptUserId) {
        user.send(messageObject);
      }
    }
  }

  /**
   * Envia mensagem especificamente para o Host da sala
   */
  sendToHost(messageObject) {
    if (this.hostId && this.users.has(this.hostId)) {
      this.users.get(this.hostId).send(messageObject);
    }
  }

  createWorkerToken(hostId) {
    const token = `wt_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
    this.workerTokens.set(token, { hostId, createdAt: Date.now(), used: false });
    return token;
  }

  validateAndConsumeWorkerToken(hostId, candidateToken) {
    if (!candidateToken || !this.workerTokens.has(candidateToken)) return false;
    const entry = this.workerTokens.get(candidateToken);
    if (entry.hostId !== hostId || entry.used) return false;
    if (Date.now() - entry.createdAt > 60000) {
      this.workerTokens.delete(candidateToken);
      return false;
    }
    entry.used = true;
    return true;
  }

  addWorker(user, hostId) {
    user.roomId = this.id;
    user.role = 'screen-worker';
    user.hostId = hostId;
    this.workers.set(user.id, { user, hostId });
    this.lastActiveAt = new Date();
    return user;
  }

  removeWorker(workerId) {
    const entry = this.workers.get(workerId);
    if (!entry) return null;
    this.workers.delete(workerId);
    entry.user.roomId = null;
    this.lastActiveAt = new Date();
    return entry.user;
  }

  getWorker(workerId) {
    return this.workers.get(workerId)?.user || null;
  }

  getWorkersByHost(hostId) {
    const list = [];
    for (const entry of this.workers.values()) {
      if (entry.hostId === hostId) {
        list.push(entry.user);
      }
    }
    return list;
  }

  /**
   * Envia mensagem direcionada a um usuário ou worker específico da sala
   */
  sendTo(targetUserId, messageObject) {
    const target = this.users.get(targetUserId) || this.workers.get(targetUserId)?.user;
    if (target) {
      target.send(messageObject);
      return true;
    }
    return false;
  }

  toJSON() {
    return {
      id: this.id,
      hostId: this.hostId,
      status: this.status,
      userCount: this.users.size,
      users: this.getAllUsers().map(u => u.toJSON()),
      streams: this.getAllStreams(),
      createdAt: this.createdAt
    };
  }
}
