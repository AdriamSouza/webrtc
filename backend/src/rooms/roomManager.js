import { Room } from './room.js';

/**
 * Gerenciador Global de Salas em Memória (Room Manager)
 * Conforme especificado na Seção 6.A e Seção 9 da Arquitetura:
 * "as salas virtuais são mantidas diretamente na memória do servidor através de const rooms = new Map();"
 */
export class RoomManager {
  constructor() {
    this.rooms = new Map(); // Map<roomId, Room>
  }

  /**
   * Obtém uma sala existente pelo ID
   */
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * Obtém ou cria uma sala
   */
  getOrCreateRoom(roomId, metadata = {}) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, metadata);
      this.rooms.set(roomId, room);
      console.log(`[RoomManager] Nova sala criada: ${roomId}`);
    }
    return room;
  }

  /**
   * Realiza a entrada de um usuário em uma sala respeitando limites arquiteturais e segurança
   */
  joinRoom(roomId, user, options = {}, maxUsers = 20) {
    const isOptionsObj = typeof options === 'object' && options !== null;
    const requestedHost = isOptionsObj ? Boolean(options.makeHost) : Boolean(options);
    const password = isOptionsObj ? options.password : null;
    const hostToken = isOptionsObj ? options.hostToken : null;

    let room = this.rooms.get(roomId);

    if (!room) {
      // Nova sala criada com token de host exclusivo e senha opcional
      const newHostToken = `ht_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
      room = new Room(roomId, {
        password: password ? String(password).trim() : null,
        hostToken: newHostToken
      });
      this.rooms.set(roomId, room);
      console.log(`[RoomManager] Nova sala criada: ${roomId} (Protegida por senha: ${room.hasPassword()})`);
      const isHost = room.addUser(user, true);
      return { room, isHost: true, hostToken: newHostToken, hasPassword: room.hasPassword() };
    }

    // Validação de senha se a sala for protegida
    if (room.hasPassword()) {
      if (!room.verifyPassword(password)) {
        throw new Error('Senha ou PIN incorreto para acessar esta sala.');
      }
    }

    // Verificação de capacidade máxima
    if (room.getUserCount() >= maxUsers && !room.users.has(user.id)) {
      throw new Error(`A sala atingiu a capacidade máxima de ${maxUsers} participantes.`);
    }

    // Proteção de papel de Host: apenas quem tem o hostToken ou se a sala não tem host pode ser Host
    let makeHost = false;
    if (requestedHost) {
      if (!room.hostId) {
        makeHost = true;
      } else if (hostToken && room.verifyHostToken(hostToken)) {
        makeHost = true;
      } else {
        makeHost = false;
      }
    }

    const isHost = room.addUser(user, makeHost);
    return {
      room,
      isHost,
      hostToken: isHost ? room.hostToken : null,
      hasPassword: room.hasPassword()
    };
  }

  /**
   * Remove o usuário da sala onde ele estiver associado
   */
  leaveRoom(user) {
    if (!user.roomId) return null;

    const room = this.rooms.get(user.roomId);
    if (!room) {
      user.roomId = null;
      return null;
    }

    const removed = room.removeUser(user.id);

    // Se a sala estiver completamente vazia, limpamos a memória
    if (room.isEmpty()) {
      this.rooms.delete(room.id);
      console.log(`[RoomManager] Sala vazia removida: ${room.id}`);
    }

    return { room, user: removed };
  }

  /**
   * Limpeza de rotina de salas abandonadas ou inativas
   */
  cleanupAbandonedRooms(inactivityTimeoutMs) {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, room] of this.rooms.entries()) {
      const isExpired = (now - room.lastActiveAt.getTime()) > inactivityTimeoutMs;
      if (room.isEmpty() || isExpired) {
        this.rooms.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[RoomManager] Rotina de limpeza: ${cleaned} salas inativas removidas.`);
    }
  }

  getTotalRooms() {
    return this.rooms.size;
  }

  getTotalUsers() {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.getUserCount();
    }
    return total;
  }
}

export const roomManager = new RoomManager();
