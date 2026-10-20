import { MessageTypes, createMessage } from './messages.js';

/**
 * Handlers de Roteamento de Eventos WebSocket
 * Implementa a lógica das Seções 7, 8 e 20 do Documento de Arquitetura.
 */

export function handleJoinRoom(user, message, roomManager, config) {
  const { roomId, data } = message;

  // Entrada de processo separado nativo Screen Worker com GPU
  if (data?.role === 'screen-worker') {
    const hostId = data?.hostId || data?.parentUserId;
    const workerToken = data?.workerToken || data?.token;

    try {
      const room = roomManager.getRoom(roomId);
      if (!room) {
        throw new Error(`Sala ${roomId} não encontrada.`);
      }
      if (!hostId || !workerToken) {
        throw new Error('hostId e workerToken são obrigatórios para autenticação do worker.');
      }
      if (!room.getUser(hostId)) {
        throw new Error(`Host ${hostId} não está presente na sala.`);
      }
      if (!room.validateAndConsumeWorkerToken(hostId, workerToken)) {
        throw new Error('workerToken inválido, expirado ou já utilizado.');
      }

      user.name = `screen-worker-${hostId.substring(0, 5)}`;
      user.role = 'screen-worker';
      user.hostId = hostId;
      room.addWorker(user, hostId);
      console.log(`[Signaling] Screen-Worker ${user.id} autenticado com sucesso para o Host ${hostId} na sala ${room.id}`);

      // Responde ao worker confirmando entrada
      user.send(
        createMessage(MessageTypes.ROOM_JOINED, room.id, 'server', user.id, {
          roomId: room.id,
          role: 'screen-worker',
          hostId,
          userId: user.id,
          iceServers: config.iceServers,
          users: room.getAllUsers().filter(u => u.id !== hostId).map(u => u.toJSON())
        })
      );

      // Notifica os espectadores da sala que o stream de tela do host virá por este worker
      room.broadcast(
        createMessage(MessageTypes.WORKER_JOINED, room.id, user.id, null, {
          workerId: user.id,
          hostId,
          role: 'screen-worker'
        })
      );
      return;
    } catch (err) {
      user.send(
        createMessage(MessageTypes.ERROR, roomId, 'server', user.id, {
          code: 'WORKER_AUTH_ERROR',
          message: err.message
        })
      );
      return;
    }
  }

  const username = data?.username?.trim();
  if (username) {
    user.name = username;
  }

  const requestedHost = Boolean(data?.isHost);
  const password = data?.password ? String(data.password).trim() : null;
  const hostToken = data?.hostToken ? String(data.hostToken).trim() : null;

  if (Array.isArray(data?.supportedCodecs)) {
    user.mediaState = { ...(user.mediaState || {}), supportedCodecs: data.supportedCodecs };
  }

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
        users: room.getAllUsers().map(u => u.toJSON()),
        streams: room.getAllStreams()
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

  const sourceType = data?.type || 'desktop';
  const customTitle = data?.title || null;
  const streamInfo = room.publishStream(user, sourceType, customTitle);

  user.isScreenSharing = (sourceType === 'desktop' || sourceType === 'screen');
  if (sourceType === 'camera') user.isCameraActive = true;
  if (!user.mediaState) user.mediaState = {};
  user.mediaState[sourceType] = { active: true, ...data };
  room.status = 'streaming';

  console.log(`[Catalog] Transmissão publicada por ${user.name}: ${streamInfo.streamId} (${streamInfo.title})`);

  // 1. Mensagem clássica para compatibilidade de clientes legados
  room.broadcast(
    createMessage(MessageTypes.START_STREAM, roomId, user.id, null, { ...data, streamInfo })
  );

  // 2. Anúncio formal no Catálogo de Transmissões da Sala
  room.broadcast(
    createMessage(MessageTypes.STREAM_PUBLISHED, roomId, user.id, null, {
      stream: streamInfo
    })
  );
}

export function handleStopStream(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const sourceType = message.data?.type || 'desktop';
  const removed = room.unpublishStream(user.id, sourceType);

  if (sourceType === 'desktop' || sourceType === 'screen') user.isScreenSharing = false;
  if (sourceType === 'camera') user.isCameraActive = false;
  if (!user.mediaState) user.mediaState = {};
  user.mediaState[sourceType] = { active: false };

  console.log(`[Catalog] Transmissão encerrada por ${user.name}: tipo=${sourceType}`);

  room.broadcast(
    createMessage(MessageTypes.STOP_STREAM, roomId, user.id, null, {
      userId: user.id,
      type: sourceType
    })
  );

  removed.forEach(streamInfo => {
    room.broadcast(
      createMessage(MessageTypes.STREAM_ENDED, roomId, user.id, null, {
        streamId: streamInfo.streamId,
        hostId: user.id,
        sourceType: streamInfo.sourceType
      })
    );
  });
}

export function handleMute(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const isMuted = Boolean(message.data?.muted);
  user.isMuted = isMuted;

  room.broadcast(
    createMessage(isMuted ? MessageTypes.MUTE : MessageTypes.UNMUTE, roomId, user.id, null, message.data)
  );
}

export function handleMediaState(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const data = message.data || {};
  const sourceType = data?.type;
  if (!sourceType) return;

  if (sourceType === 'screen' || sourceType === 'desktop') {
    user.isScreenSharing = Boolean(data.active);
  } else if (sourceType === 'camera') {
    user.isCameraActive = Boolean(data.active);
  }

  if (!user.mediaState) user.mediaState = {};
  user.mediaState[sourceType] = data;

  // Atualização sincronizada no catálogo da sala
  if (data.active) {
    const streamInfo = room.publishStream(user, sourceType, data.title || null);
    room.broadcast(
      createMessage(MessageTypes.STREAM_PUBLISHED, roomId, user.id, null, {
        stream: streamInfo
      })
    );
  } else {
    const removed = room.unpublishStream(user.id, sourceType);
    removed.forEach(streamInfo => {
      room.broadcast(
        createMessage(MessageTypes.STREAM_ENDED, roomId, user.id, null, {
          streamId: streamInfo.streamId,
          hostId: user.id,
          sourceType: streamInfo.sourceType
        })
      );
    });
  }

  room.broadcast(
    createMessage(MessageTypes.MEDIA_STATE, roomId, user.id, null, {
      ...data,
      userId: user.id
    }),
    user.id
  );
}

export function handleViewerState(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const data = message.data || {};
  const viewerState = {
    state: data.state || 'active', // 'active' | 'background' | 'inactive'
    isVisible: data.isVisible !== false,
    isFocused: Boolean(data.isFocused),
    timestamp: Date.now(),
    userId: user.id,
    userName: user.name
  };

  user.viewerState = viewerState;

  // Notifica o host (ou a sala) para adaptação dinâmica de taxa e resolução no transmissor
  if (message.to) {
    room.sendTo(
      message.to,
      createMessage(MessageTypes.VIEWER_STATE, roomId, user.id, message.to, viewerState)
    );
  } else {
    room.broadcast(
      createMessage(MessageTypes.VIEWER_STATE, roomId, user.id, null, viewerState),
      user.id
    );
  }
}

export function handleStreamList(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  user.send(
    createMessage(MessageTypes.STREAM_LIST, roomId, 'server', user.id, {
      streams: room.getAllStreams()
    })
  );
}

export function handleSubscribeStream(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const { streamId } = message.data || {};
  const streamInfo = room.getStream(streamId);
  if (!streamInfo) return;

  console.log(`[Subscription] Usuário ${user.name} (${user.id}) assinou transmissão: ${streamId}`);
  const host = room.getUser(streamInfo.hostId);
  if (host && host.id !== user.id) {
    host.send(
      createMessage(MessageTypes.SUBSCRIBE_STREAM, roomId, user.id, host.id, {
        streamId,
        sourceType: streamInfo.sourceType,
        subscriberId: user.id,
        subscriberName: user.name
      })
    );
  }
}

export function handleUnsubscribeStream(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const { streamId } = message.data || {};
  const streamInfo = room.getStream(streamId);
  if (!streamInfo) return;

  console.log(`[Subscription] Usuário ${user.name} (${user.id}) desinscreveu de: ${streamId}`);
  const host = room.getUser(streamInfo.hostId);
  if (host && host.id !== user.id) {
    host.send(
      createMessage(MessageTypes.UNSUBSCRIBE_STREAM, roomId, user.id, host.id, {
        streamId,
        sourceType: streamInfo.sourceType,
        subscriberId: user.id,
        subscriberName: user.name
      })
    );
  }
}

export function handleChatMessage(user, message, roomManager) {
  const { roomId, data } = message;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const text = (typeof data?.text === 'string') ? data.text.trim().slice(0, 500) : '';
  let image = null;

  // Validação segura de imagem efêmera em Base64 (data URL)
  if (data?.image && typeof data.image === 'string' && data.image.startsWith('data:image/')) {
    // Limite defensivo de até 7 MB para manter performance do WebSocket
    if (data.image.length <= 7 * 1024 * 1024) {
      image = data.image;
    }
  }

  // Ignora se não houver texto nem imagem
  if (!text && !image) return;

  const chatPayload = {
    author: user.name,
    userId: user.id,
    text,
    image,
    timestamp: Date.now()
  };

  // Chat e imagens trafegam exclusivamente em memória via WebSocket e não são persistidos em disco
  room.broadcast(
    createMessage(MessageTypes.CHAT_MESSAGE, roomId, user.id, null, chatPayload)
  );
}

export function handleRequestWorkerToken(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) {
    user.send(createMessage(MessageTypes.ERROR, roomId, 'server', user.id, {
      code: 'ROOM_NOT_FOUND',
      message: 'Sala não encontrada para geração de token de worker'
    }));
    return;
  }

  const token = room.createWorkerToken(user.id);
  console.log(`[Signaling] Token de screen-worker emitido para o Host ${user.name} (${user.id}) na sala ${room.id}`);

  user.send(
    createMessage(MessageTypes.WORKER_TOKEN_ISSUED, room.id, 'server', user.id, {
      roomId: room.id,
      hostId: user.id,
      workerToken: token
    })
  );
}

export function handleGpuStreamReady(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const targetId = message.to || message.data?.workerId || message.data?.hostId;
  console.log(`[Signaling] GPU_STREAM_READY de ${user.name} (${user.id}) -> ${targetId || 'broadcast'}`);

  if (targetId) {
    room.sendTo(targetId, createMessage(MessageTypes.GPU_STREAM_READY, roomId, user.id, targetId, message.data || {}));
  } else {
    room.broadcast(createMessage(MessageTypes.GPU_STREAM_READY, roomId, user.id, null, message.data || {}), user.id);
  }
}

export function handleQualityReport(user, message, roomManager) {
  const roomId = message.roomId || user.roomId;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const targetId = message.to || message.data?.workerId;
  if (targetId) {
    room.sendTo(targetId, createMessage(MessageTypes.QUALITY_REPORT, roomId, user.id, targetId, message.data || {}));
  }
}

export function handleDisconnect(user, roomManager) {
  console.log(`[Signaling] Conexão encerrada: ${user.name} (${user.id})`);

  // Se o desconectado era um screen-worker
  if (user.role === 'screen-worker') {
    const room = roomManager.getRoom(user.roomId);
    if (room) {
      room.removeWorker(user.id);
      room.broadcast(
        createMessage(MessageTypes.WORKER_LEFT, room.id, user.id, null, {
          workerId: user.id,
          hostId: user.hostId
        })
      );
    }
    return;
  }

  const room = roomManager.getRoom(user.roomId);
  if (room) {
    // Se o usuário possuía workers nativos associados, remove e notifica
    const hostWorkers = room.getWorkersByHost(user.id);
    hostWorkers.forEach(w => {
      room.removeWorker(w.id);
      w.send(createMessage(MessageTypes.ERROR, room.id, 'server', w.id, {
        code: 'HOST_DISCONNECTED',
        message: 'O Host desta transmissão foi desconectado.'
      }));
      room.broadcast(
        createMessage(MessageTypes.WORKER_LEFT, room.id, w.id, null, {
          workerId: w.id,
          hostId: user.id
        })
      );
    });

    const removedStreams = room.unpublishStream(user.id);
    removedStreams.forEach(streamInfo => {
      room.broadcast(
        createMessage(MessageTypes.STREAM_ENDED, room.id, user.id, null, {
          streamId: streamInfo.streamId,
          hostId: user.id,
          sourceType: streamInfo.sourceType
        })
      );
    });
  }

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
