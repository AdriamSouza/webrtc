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

  /**
   * Envia mensagem direcionada a um usuário específico da sala
   */
  sendTo(targetUserId, messageObject) {
    const target = this.users.get(targetUserId);
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
      createdAt: this.createdAt
    };
  }
}
