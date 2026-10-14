import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { config } from './config/config.js';
import { roomManager } from './rooms/roomManager.js';
import { setupWebSocketServer } from './signaling/websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(express.json());

// Servir os arquivos estáticos do frontend diretamente (Canal 1: HTTP/HTTPS)
const frontendPath = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// Metadados de versão e protocolo para compatibilidade entre Desktop, Web e Render
const versionFilePath = path.resolve(__dirname, 'version.json');
let versionMetadata = {
  version: '1.3.4',
  protocolVersion: 2,
  minClientProtocolVersion: 2,
  gitCommit: 'a186ed0',
  buildDate: new Date().toISOString()
};

try {
  if (fs.existsSync(versionFilePath)) {
    versionMetadata = { ...versionMetadata, ...JSON.parse(fs.readFileSync(versionFilePath, 'utf8')) };
  } else {
    const rootPkgPath = path.resolve(__dirname, '../../package.json');
    if (fs.existsSync(rootPkgPath)) {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      if (rootPkg.version) versionMetadata.version = rootPkg.version;
    }
  }
} catch (e) {
  console.warn('[Server] Aviso ao ler version.json:', e.message);
}

// Resolução dinâmica de commit real em produção (Render) ou ambiente Git local
function resolveBackendGitCommit() {
  if (process.env.RENDER_GIT_COMMIT) {
    return process.env.RENDER_GIT_COMMIT.substring(0, 7);
  }
  if (process.env.GIT_COMMIT) {
    return process.env.GIT_COMMIT.substring(0, 7);
  }
  try {
    const gitHead = execSync('git rev-parse --short HEAD', {
      cwd: path.resolve(__dirname, '../..'),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    }).toString().trim();
    if (gitHead) return gitHead;
  } catch (_) {}
  return versionMetadata.gitCommit || 'unknown';
}

// Endpoints REST de Apoio, Diagnóstico e Compatibilidade
app.get('/api/version', (req, res) => {
  const currentCommit = resolveBackendGitCommit();
  res.json({
    service: 'hyperstream-backend',
    ...versionMetadata,
    gitCommit: currentCommit,
    environment: process.env.NODE_ENV || 'development',
    deploymentPlatform: process.env.RENDER ? 'Render Cloud' : 'Self-Hosted/Local',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  const currentCommit = resolveBackendGitCommit();
  res.json({
    status: 'online',
    https: isHttps,
    version: versionMetadata.version,
    protocolVersion: versionMetadata.protocolVersion,
    minClientProtocolVersion: versionMetadata.minClientProtocolVersion,
    gitCommit: currentCommit,
    environment: process.env.NODE_ENV || 'development',
    deploymentPlatform: process.env.RENDER ? 'Render Cloud' : 'Self-Hosted/Local',
    activeRooms: roomManager.getTotalRooms(),
    connectedUsers: roomManager.getTotalUsers(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/rooms', (req, res) => {
  const roomsList = Array.from(roomManager.rooms.values()).map(r => r.toJSON());
  res.json({ rooms: roomsList });
});

// Fallback para SPA / rotas de sala
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Detecção e ativação de HTTPS com certificados SSL (Seção 9.C, Seção 21 e 26 da Arquitetura)
const certPath = path.resolve(__dirname, '../certs/cert.pem');
const keyPath = path.resolve(__dirname, '../certs/key.pem');

let server;
let isHttps = false;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const sslOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  server = https.createServer(sslOptions, app);
  isHttps = true;
} else {
  server = http.createServer(app);
}

// Inicialização do Servidor de Sinalização WebSocket (Canal 2: WebSocket / WSS)
setupWebSocketServer(server);

// Inicialização do Servidor
server.listen(config.port, config.host, () => {
  const scheme = isHttps ? 'https' : 'http';
  const wsScheme = isHttps ? 'wss' : 'ws';

  const turnServers = config.iceServers.filter(s => {
    if (Array.isArray(s.urls)) return s.urls.some(u => u.startsWith('turn'));
    return typeof s.urls === 'string' && s.urls.startsWith('turn');
  });

  // Identificação de IPs locais para acesso facilitado em celulares na mesma rede Wi-Fi
  const localIps = [];
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIps.push(iface.address);
        }
      }
    }
  } catch (_) {}

  console.log(`====================================================`);
  console.log(`🚀 Servidor WebRTC P2P inicializado com sucesso!`);
  console.log(`📡 URL Local (PC): ${scheme}://localhost:${config.port}`);
  if (localIps.length > 0) {
    localIps.forEach(ip => {
      console.log(`📱 Acesso Celular: ${scheme}://${ip}:${config.port}`);
    });
  }
  console.log(`🔒 Modo Seguro:    ${isHttps ? 'HTTPS ATIVO (Desbloqueia getDisplayMedia em todos dispositivos)' : 'HTTP'}`);
  console.log(`💬 WebSocket Path: ${wsScheme}://${config.host}:${config.port}/ws`);
  console.log(`🛡️ ICE Servers:    ${config.iceServers.length} configurados (${turnServers.length > 0 ? `TURN Relay Ativo (${turnServers.length} server)` : 'Apenas STUN - configure TURN no .env para CGNAT/4G'})`);
  console.log(`🌍 Teste Remoto:   Execute 'npm run tunnel' para gerar link HTTPS público com Cloudflare Tunnel`);
  console.log(`⚡ Fluidez Alvo:   60 FPS (Zero-Media Relay no Servidor)`);
  console.log(`====================================================`);
});

// Tratamento de Encerramento Gracioso
function gracefulShutdown(signal) {
  console.log(`\nRecebido sinal ${signal}. Encerrando servidor graciosamente...`);
  server.close(() => {
    console.log('Servidor encerrado.');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
