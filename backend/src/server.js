import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
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

// Endpoints REST de Apoio e Diagnóstico
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    https: isHttps,
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

  console.log(`====================================================`);
  console.log(`🚀 Servidor WebRTC P2P inicializado com sucesso!`);
  console.log(`📡 URL Local:      ${scheme}://localhost:${config.port}`);
  console.log(`🌐 Acesso na Rede: ${scheme}://192.168.0.17:${config.port}`);
  console.log(`🔒 Modo Seguro:    ${isHttps ? 'HTTPS ATIVO (Desbloqueia getDisplayMedia em todos dispositivos)' : 'HTTP'}`);
  console.log(`💬 WebSocket Path: ${wsScheme}://${config.host}:${config.port}/ws`);
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
