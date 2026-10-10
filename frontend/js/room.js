/**
 * Gerenciador de Estado da Sala no Cliente
 */

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
    this.chatMessages = [];
  }
}
