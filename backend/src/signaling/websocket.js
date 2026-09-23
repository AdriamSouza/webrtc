import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../users/user.js';
import { roomManager } from '../rooms/roomManager.js';
import { config } from '../config/config.js';
import { MessageTypes, validateMessage, createMessage } from './messages.js';
import {
  handleJoinRoom,
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  handleStartStream,
  handleStopStream,
  handleMute,
  handleMediaState,
  handleChatMessage,
  handleDisconnect
} from './handlers.js';

/**
 * Inicialização e Gerenciamento do Servidor WebSocket
 */
export function setupWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  console.log('[WebSocket] Servidor de sinalização WebSocket inicializado na rota /ws');

  // Heartbeat para detectar conexões inativas ou travadas
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Limpeza de salas inativas em background
  const cleanupInterval = setInterval(() => {
    roomManager.cleanupAbandonedRooms(config.rooms.inactivityTimeoutMs);
  }, config.rooms.cleanupIntervalMs);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(cleanupInterval);
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const userId = uuidv4();
    const user = new User(userId, null, ws);
    console.log(`[WebSocket] Novo cliente conectado: ${userId} (${req.socket.remoteAddress})`);

    ws.on('message', (raw) => {
      // 1. Rate Limiting / Anti-Flood
      if (!user.checkRateLimit(config.rateLimit.maxMessagesPerSecond, config.rateLimit.windowMs)) {
        user.send(
          createMessage(MessageTypes.ERROR, user.roomId, 'server', user.id, {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Limite de mensagens por segundo excedido'
          })
        );
        return;
      }

      // 2. Validação Estrita de JSON
      const { valid, message, error } = validateMessage(raw.toString());
      if (!valid) {
        user.send(
          createMessage(MessageTypes.ERROR, user.roomId, 'server', user.id, {
            code: 'INVALID_PAYLOAD',
            message: error
          })
        );
        return;
      }

      // 3. Roteamento de Eventos
      try {
        switch (message.type) {
          case MessageTypes.JOIN_ROOM:
            handleJoinRoom(user, message, roomManager, config);
            break;

          case MessageTypes.OFFER:
            handleOffer(user, message, roomManager);
            break;

          case MessageTypes.ANSWER:
            handleAnswer(user, message, roomManager);
            break;

          case MessageTypes.ICE_CANDIDATE:
            handleIceCandidate(user, message, roomManager);
            break;

          case MessageTypes.START_STREAM:
            handleStartStream(user, message, roomManager);
            break;

          case MessageTypes.STOP_STREAM:
            handleStopStream(user, message, roomManager);
            break;

          case MessageTypes.MUTE:
          case MessageTypes.UNMUTE:
            handleMute(user, message, roomManager);
            break;

          case MessageTypes.MEDIA_STATE:
            handleMediaState(user, message, roomManager);
            break;

          case MessageTypes.CHAT_MESSAGE:
            handleChatMessage(user, message, roomManager);
            break;

          case MessageTypes.LEAVE_ROOM:
            handleDisconnect(user, roomManager);
            break;

          default:
            console.warn(`[WebSocket] Evento não mapeado: ${message.type}`);
            break;
        }
      } catch (handlerErr) {
        console.error(`[WebSocket] Erro no processamento do evento ${message.type}:`, handlerErr);
      }
    });

    ws.on('close', () => {
      handleDisconnect(user, roomManager);
    });

    ws.on('error', (err) => {
      console.error(`[WebSocket] Erro no socket do cliente ${user.id}:`, err.message);
    });
  });

  return wss;
}
