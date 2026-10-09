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
  }

  addParticipant(user) {
    this.participants.set(user.id, user);
  }

  removeParticipant(userId) {
    const user = this.participants.get(userId);
    this.participants.delete(userId);
    return user;
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
    this.chatMessages = [];
  }
}
