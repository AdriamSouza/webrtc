import { MessageTypes, createMessage } from './messages.js';

/**
 * Handlers de Roteamento de Eventos WebSocket
 * Implementa a lógica das Seções 7, 8 e 20 do Documento de Arquitetura.
 */

export function handleJoinRoom(user, message, roomManager, config) {
  const { roomId, data } = message;
  const username = data?.username?.trim();
  if (username) {
    user.name = username;
  }

  const requestedHost = Boolean(data?.isHost);
  const password = data?.password ? String(data.password).trim() : null;
  const hostToken = data?.hostToken ? String(data.hostToken).trim() : null;

  try {
    const { room, isHost, hostToken: roomHostToken, hasPassword } = roomManager.joinRoom(
      roomId,
      user,
      {
        makeHost: requestedHost,
        password,
        hostToken
      },
      config.maxUsersPerRoom
    );

    console.log(`[Signaling] Usuário ${user.name} (${user.id}) entrou na sala ${room.id} como ${isHost ? 'HOST' : 'VIEWER'}`);

    // 1. Responde ao usuário confirmando a entrada e enviando a lista atual de participantes e servidores STUN/TURN
    user.send(
      createMessage(MessageTypes.ROOM_JOINED, room.id, 'server', user.id, {
        roomId: room.id,
        isHost,
        hostToken: isHost ? roomHostToken : null,
        hasPassword,
        userId: user.id,
        username: user.name,
        iceServers: config.iceServers,
        users: room.getAllUsers().map(u => u.toJSON())
      })
    );

    // 2. Notifica todos os demais participantes sobre a chegada do novo usuário
    room.broadcast(
      createMessage(MessageTypes.USER_JOINED, room.id, user.id, null, {
        user: user.toJSON()
      }),
      user.id // exceto o próprio usuário que acabou de entrar
    );
  } catch (err) {
    user.send(
      createMessage(MessageTypes.ERROR, roomId, 'server', user.id, {
        code: 'JOIN_ERROR',
        message: err.message
      })
    );
  }
}

export function handleOffer(user, message, roomManager) {
  const { roomId, to, data } = message;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (!to) {
    user.send(createMessage(MessageTypes.ERROR, roomId, 'server', user.id, {
      code: 'MISSING_TARGET',
      message: 'Campo "to" obrigatório no envio de OFFER'
    }));
    return;
  }

  console.log(`[Signaling] Roteando OFFER de ${user.name} (${user.id}) -> destino (${to})`);

  // O servidor atua apenas como intermediário transparente, sem decodificar ou alterar SDP
  room.sendTo(
    to,
    createMessage(MessageTypes.OFFER, roomId, user.id, to, data)
  );
}

export function handleAnswer(user, message, roomManager) {
  const { roomId, to, data } = message;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (!to) {
    user.send(createMessage(MessageTypes.ERROR, roomId, 'server', user.id, {
      code: 'MISSING_TARGET',
      message: 'Campo "to" obrigatório no envio de ANSWER'
    }));
    return;
  }

  console.log(`[Signaling] Roteando ANSWER de ${user.name} (${user.id}) -> host (${to})`);

  // Encaminha a resposta SDP para o peer de destino
  room.sendTo(
    to,
    createMessage(MessageTypes.ANSWER, roomId, user.id, to, data)
  );
}

export function handleIceCandidate(user, message, roomManager) {
  const { roomId, to, data } = message;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (!to) return;

  console.log(`[Signaling] Candidato ICE roteado: ${user.name} (${user.id}) -> ${to}`);

  // Encaminha o candidato ICE para o peer de destino
  room.sendTo(
    to,
    createMessage(MessageTypes.ICE_CANDIDATE, roomId, user.id, to, data)
  );
}

export function handleStartStream(user, message, roomManager) {
  const { roomId, data } = message;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  user.isScreenSharing = true;
  if (!user.mediaState) user.mediaState = {};
  user.mediaState.screen = { active: true, ...data };
  room.status = 'streaming';

  room.broadcast(
    createMessage(MessageTypes.START_STREAM, roomId, user.id, null, data || {})
  );
}

export function handleStopStream(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  user.isScreenSharing = false;
  if (!user.mediaState) user.mediaState = {};
  user.mediaState.screen = { active: false };
  room.status = 'idle';

  room.broadcast(
    createMessage(MessageTypes.STOP_STREAM, roomId, user.id, null, {
      userId: user.id
    })
  );
}

export function handleMute(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const isMuted = Boolean(data?.muted);
  user.isMuted = isMuted;

  room.broadcast(
    createMessage(isMuted ? MessageTypes.MUTE : MessageTypes.UNMUTE, roomId, user.id, null, data)
  );
}

export function handleMediaState(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const data = message.data || {};
  if (data?.type === 'screen') {
    user.isScreenSharing = Boolean(data.active);
  } else if (data?.type === 'camera') {
    user.isCameraActive = Boolean(data.active);
  }

  if (!user.mediaState) user.mediaState = {};
  if (data?.type) {
    user.mediaState[data.type] = data;
  }

  room.broadcast(
    createMessage(MessageTypes.MEDIA_STATE, roomId, user.id, null, {
      ...data,
      userId: user.id
    }),
    user.id
  );
}

export function handleChatMessage(user, message, roomManager) {
  const { roomId, data } = message;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const text = data?.text?.trim();
  if (!text) return;

  const chatPayload = {
    author: user.name,
    userId: user.id,
    text: text.slice(0, 500), // limite defensivo de caracteres
    timestamp: Date.now()
  };

  // Chat passa diretamente pelo WebSocket e distribui para toda a sala
  room.broadcast(
    createMessage(MessageTypes.CHAT_MESSAGE, roomId, user.id, null, chatPayload)
  );
}

export function handleDisconnect(user, roomManager) {
  console.log(`[Signaling] Conexão encerrada: ${user.name} (${user.id})`);

  const result = roomManager.leaveRoom(user);
  if (result && result.room) {
    result.room.broadcast(
      createMessage(MessageTypes.USER_LEFT, result.room.id, user.id, null, {
        userId: user.id,
        username: user.name
      })
    );
  }
}
