import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregamento de variáveis de ambiente nativo do Node.js (v20.6.0+)
// Tenta carregar .env da raiz do projeto ou da pasta backend
const possibleEnvPaths = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
        console.log(`[Config] Arquivo .env carregado com sucesso de: ${envPath}`);
      }
      break;
    } catch (e) {
      console.warn(`[Config] Aviso ao ler ${envPath}:`, e.message);
    }
  }
}

/**
 * Constrói a lista de servidores ICE (STUN/TURN)
 */
function buildIceServers() {
  // 1. Se fornecido JSON bruto de servidores ICE (ex: exportado de Metered, Twilio ou Xirsys)
  if (process.env.ICE_SERVERS_JSON) {
    try {
      const parsed = JSON.parse(process.env.ICE_SERVERS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (err) {
      console.warn('[Config] Erro ao parsear ICE_SERVERS_JSON:', err.message);
    }
  }

  // 2. Servidores STUN públicos (Google + Cloudflare)
  const stunUrls = process.env.STUN_URLS
    ? process.env.STUN_URLS.split(',').map(s => s.trim()).filter(Boolean)
    : [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun.cloudflare.com:3478'
      ];

  const servers = [
    { urls: stunUrls }
  ];

  // 3. Servidor(es) TURN para relay de contingência (Internet / CGNAT / 4G)
  const turnUrlsRaw = process.env.TURN_URLS || process.env.TURN_URL;
  if (turnUrlsRaw) {
    const turnUrls = turnUrlsRaw.split(',').map(u => u.trim()).filter(Boolean);
    const username = process.env.TURN_USERNAME || '';
    const credential = process.env.TURN_PASSWORD || process.env.TURN_CREDENTIAL || '';

    servers.push({
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
      username,
      credential
    });
  }

  return servers;
}

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

  // Infraestrutura STUN / TURN fornecida aos clientes WebRTC
  iceServers: buildIceServers()
};
