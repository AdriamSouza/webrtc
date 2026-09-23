/**
 * Padronização do Protocolo de Mensagens JSON
 * Documentação Arquitetural: Seção 7 (Padronização do Protocolo de Mensagens JSON)
 *
 * Esquema Geral:
 * {
 *   "type": "NOME_DO_EVENTO",
 *   "roomId": "abc12345",
 *   "from": "id_usuario_remetente",
 *   "to": "id_usuario_destino",
 *   "data": { ... }
 * }
 */

export const MessageTypes = Object.freeze({
  JOIN_ROOM: 'JOIN_ROOM',
  ROOM_JOINED: 'ROOM_JOINED',
  USER_JOINED: 'USER_JOINED',
  USER_LEFT: 'USER_LEFT',
  OFFER: 'OFFER',
  ANSWER: 'ANSWER',
  ICE_CANDIDATE: 'ICE_CANDIDATE',
  START_STREAM: 'START_STREAM',
  STOP_STREAM: 'STOP_STREAM',
  MUTE: 'MUTE',
  UNMUTE: 'UNMUTE',
  MEDIA_STATE: 'MEDIA_STATE',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  LEAVE_ROOM: 'LEAVE_ROOM',
  ERROR: 'ERROR'
});

/**
 * Construtor padronizado de mensagens do sistema
 */
export function createMessage(type, roomId = null, from = 'server', to = null, data = {}) {
  if (!MessageTypes[type]) {
    throw new Error(`Tipo de mensagem inválido: ${type}`);
  }

  return {
    type,
    roomId,
    from,
    to,
    data,
    timestamp: Date.now()
  };
}

/**
 * Validador estrito de mensagens recebidas via WebSocket
 */
export function validateMessage(rawJson) {
  let parsed;
  try {
    parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  } catch (err) {
    return { valid: false, error: 'JSON malformado' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: 'Mensagem deve ser um objeto JSON' };
  }

  const { type, roomId } = parsed;

  if (!type || typeof type !== 'string' || !MessageTypes[type]) {
    return { valid: false, error: `Tipo de evento desconhecido: ${type}` };
  }

  // Eventos de sala devem obrigatoriamente conter roomId
  if (!roomId && type !== MessageTypes.ERROR) {
    return { valid: false, error: 'roomId é obrigatório para mensagens de controle de sala' };
  }

  return { valid: true, message: parsed };
}
