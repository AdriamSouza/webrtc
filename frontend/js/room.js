/**
 * Gerenciador de Estado da Sala no Cliente
 */

// Paleta de cores vibrantes e modernas (estilo Discord e Material Design)
export const PARTICIPANT_PALETTE = [
  '#5865F2', // Discord Blurple
  '#57F287', // Discord Green
  '#FEE75C', // Discord Amber/Yellow
  '#EB459E', // Discord Fuchsia
  '#ED4245', // Discord Red
  '#00B0F4', // Sky Blue
  '#9B59B6', // Amethyst Purple
  '#E67E22', // Carrot Orange
  '#1ABC9C', // Turquoise
  '#E91E63', // Neon Pink
  '#3498DB', // Peter River Blue
  '#10B981', // Emerald Green
  '#8B5CF6', // Violet
  '#F43F5E', // Rose
  '#06B6D4', // Cyan
  '#F59E0B'  // Amber
];

/**
 * Obtém ou gera uma cor vibrante para o participante
 * Preparado para suportar avatar com imagem e extração de cor predominante no futuro
 */
export function getParticipantColor(user) {
  if (!user) return PARTICIPANT_PALETTE[0];
  if (user.color) return user.color;
  // Se no futuro houver foto com cor dominante calculada:
  if (user.avatarDominantColor) {
    user.color = user.avatarDominantColor;
    return user.color;
  }

  // Gera uma cor aleatória/determinística baseada no ID ou nome
  const seed = String(user.id || user.name || Math.random());
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PARTICIPANT_PALETTE.length;
  user.color = PARTICIPANT_PALETTE[index];
  return user.color;
}

/**
 * Obtém as iniciais em maiúsculas do nome do participante
 */
export function getUserInitials(name) {
  if (!name) return 'U';
  const clean = name.trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.substring(0, 2).toUpperCase();
}

export class RoomState {
  constructor() {
    this.roomId = null;
    this.myUserId = null;
    this.myUsername = '';
    this.isHost = false;
    this.hostToken = null;
    this.hasPassword = false;
    this.roomPin = null;
    this.isStreaming = false;
    this.participants = new Map(); // Map<userId, UserData>
    this.availableStreams = new Map(); // Map<streamId, StreamInfo> (Catálogo efêmero da sala)
    this.subscribedStreamIds = new Set(); // Set<streamId> (Transmissões ativamente assinadas pelo usuário)
    this.chatMessages = [];

    // Rastreamento de assinantes das nossas transmissões locais (para entrega de vídeo sob demanda)
    this.localSubscribers = {
      screen: new Set(),
      camera: new Set()
    };
  }

  addLocalSubscriber(sourceType, userId) {
    const key = (sourceType === 'desktop' || sourceType === 'screen') ? 'screen' : sourceType;
    if (this.localSubscribers[key]) {
      this.localSubscribers[key].add(userId);
    }
  }

  removeLocalSubscriber(sourceType, userId) {
    const key = (sourceType === 'desktop' || sourceType === 'screen') ? 'screen' : sourceType;
    if (this.localSubscribers[key]) {
      this.localSubscribers[key].delete(userId);
    }
  }

  isPeerSubscribedToLocal(sourceType, userId) {
    // Em chamada direta com apenas 2 participantes, auto-entrega fica ativa para comodidade imediata
    if (this.participants.size <= 2) return true;
    const key = (sourceType === 'desktop' || sourceType === 'screen') ? 'screen' : sourceType;
    return Boolean(this.localSubscribers[key]?.has(userId));
  }

  setRoomInfo(roomId, userId, username, isHost, initialUsers = [], extra = {}) {
    this.roomId = roomId;
    this.myUserId = userId;
    this.myUsername = username;
    this.isHost = isHost;
    this.hostToken = extra.hostToken || null;
    this.hasPassword = Boolean(extra.hasPassword);
    this.roomPin = extra.roomPin || null;

    this.participants.clear();
    initialUsers.forEach(u => this.addParticipant(u));

    this.availableStreams.clear();
    if (Array.isArray(extra.initialStreams)) {
      extra.initialStreams.forEach(s => this.addStream(s));
    }
  }

  addParticipant(user) {
    if (!user) return;
    if (!user.color) {
      user.color = getParticipantColor(user);
    }
    this.participants.set(user.id, user);
  }

  removeParticipant(userId) {
    const user = this.participants.get(userId);
    this.participants.delete(userId);
    // Remove streams associadas a este participante
    for (const [streamId, info] of this.availableStreams.entries()) {
      if (info.hostId === userId) {
        this.availableStreams.delete(streamId);
        this.subscribedStreamIds.delete(streamId);
      }
    }
    return user;
  }

  setStreams(streamList = []) {
    this.availableStreams.clear();
    streamList.forEach(s => this.addStream(s));
  }

  addStream(streamInfo) {
    if (!streamInfo || !streamInfo.streamId) return;
    this.availableStreams.set(streamInfo.streamId, streamInfo);
  }

  removeStream(streamId) {
    this.availableStreams.delete(streamId);
    this.subscribedStreamIds.delete(streamId);
  }

  isSubscribed(streamId) {
    if (!streamId) return false;
    if (this.subscribedStreamIds.has(streamId)) return true;
    if (streamId.endsWith('-screen') && this.subscribedStreamIds.has(streamId.replace(/-screen$/, '-desktop'))) return true;
    if (streamId.endsWith('-desktop') && this.subscribedStreamIds.has(streamId.replace(/-desktop$/, '-screen'))) return true;
    return false;
  }

  subscribe(streamId) {
    if (!streamId) return;
    this.subscribedStreamIds.add(streamId);
    if (streamId.endsWith('-screen')) this.subscribedStreamIds.add(streamId.replace(/-screen$/, '-desktop'));
    if (streamId.endsWith('-desktop')) this.subscribedStreamIds.add(streamId.replace(/-desktop$/, '-screen'));
  }

  unsubscribe(streamId) {
    if (!streamId) return;
    this.subscribedStreamIds.delete(streamId);
    if (streamId.endsWith('-screen')) this.subscribedStreamIds.delete(streamId.replace(/-screen$/, '-desktop'));
    if (streamId.endsWith('-desktop')) this.subscribedStreamIds.delete(streamId.replace(/-desktop$/, '-screen'));
  }

  getStream(streamId) {
    if (!streamId) return null;
    if (this.availableStreams.has(streamId)) return this.availableStreams.get(streamId);
    if (streamId.endsWith('-screen')) return this.availableStreams.get(streamId.replace(/-screen$/, '-desktop')) || null;
    if (streamId.endsWith('-desktop')) return this.availableStreams.get(streamId.replace(/-desktop$/, '-screen')) || null;
    return null;
  }

  getAllStreams() {
    return Array.from(this.availableStreams.values());
  }

  addChatMessage(author, text, timestamp = Date.now(), isSelf = false, image = null) {
    const msg = { author, text, timestamp, isSelf, image };
    this.chatMessages.push(msg);
    return msg;
  }

  getParticipantCount() {
    return this.participants.size;
  }

  getOtherParticipantIds() {
    return Array.from(this.participants.keys()).filter(id => id !== this.myUserId);
  }

  reset() {
    this.roomId = null;
    this.myUserId = null;
    this.isHost = false;
    this.hostToken = null;
    this.hasPassword = false;
    this.roomPin = null;
    this.isStreaming = false;
    this.participants.clear();
    this.availableStreams.clear();
    this.subscribedStreamIds.clear();
    this.localSubscribers.screen.clear();
    this.localSubscribers.camera.clear();
    this.chatMessages = [];
  }

  static saveLastRoom(roomId, username, roomPin = null) {
    if (!roomId) return;
    try {
      const data = {
        roomId: String(roomId).trim().toUpperCase(),
        username: username ? String(username).trim() : '',
        roomPin: roomPin ? String(roomPin).trim() : '',
        timestamp: Date.now()
      };
      localStorage.setItem('hyperstream_last_room', JSON.stringify(data));
    } catch (_) {}
  }

  static getLastRoom() {
    try {
      const raw = localStorage.getItem('hyperstream_last_room');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.roomId) return data;
    } catch (_) {}
    return null;
  }

  static clearLastRoom() {
    try {
      localStorage.removeItem('hyperstream_last_room');
    } catch (_) {}
  }
}
