/**
 * Configurações Centrais do Servidor de Sinalização
 * Baseado nas diretrizes do Documento de Arquitetura WebRTC P2P
 */

export const config = {
  // Configurações do Servidor HTTP / WebSocket
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  host: process.env.HOST || '0.0.0.0',

  // Limite arquitetural da malha P2P Mesh (definido no documento para proteger o uplink do transmissor)
  maxUsersPerRoom: process.env.MAX_USERS_PER_ROOM ? parseInt(process.env.MAX_USERS_PER_ROOM, 10) : 20,

  // Segurança e Rate Limiting
  rateLimit: {
    maxMessagesPerSecond: 50, // Anti-flood por cliente
    windowMs: 1000
  },

  // Gerenciamento de Ciclo de Vida de Salas
  rooms: {
    cleanupIntervalMs: 60 * 1000, // Verificação a cada 1 minuto
    inactivityTimeoutMs: 15 * 60 * 1000 // Remove salas sem participantes há 15 min
  },

  // Infraestrutura STUN / TURN fornecida aos clientes
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]
    },
    // Caso haja TURN configurado via ENV:
    ...(process.env.TURN_URL ? [{
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || ''
    }] : [])
  ]
};
