/**
 * Orchestrator para o Screen Worker Nativo de Captura + Encode AMF GPU
 * Gerencia o ciclo de vida do processo nativo (screen_worker.exe),
 * a conexão WebSocket de sinalização com o backend como peer 'screen-worker',
 * e o controle adaptativo de qualidade (escada L0-L3).
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { AdaptiveLadder } from './adaptive_ladder.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Leitura de parâmetros de linha de comando
const args = process.argv.slice(2);
function getArg(flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultVal;
}

const serverUrl = getArg('--serverUrl', 'http://localhost:3000');
const roomId = getArg('--roomId');
const hostId = getArg('--hostId');
const workerToken = getArg('--workerToken');
const sourceId = getArg('--sourceId', null);

if (!roomId || !hostId || !workerToken) {
  console.error('[WorkerRunner] Parâmetros obrigatórios ausentes: --roomId, --hostId, --workerToken');
  process.exit(1);
}

const workerUserId = `screen-worker-${hostId.slice(0, 8)}`;

// 2. Detecção de GPU AMD (Requisito estrito: worker deve detectar GPU não-AMD e recusar iniciar)
function detectAmdGpu() {
  if (process.platform !== 'win32') return false;
  try {
    const stdout = execSync('powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', {
      timeout: 3000,
      encoding: 'utf8'
    });
    return /amd|radeon/i.test(stdout);
  } catch (err) {
    console.warn('[WorkerRunner] Não foi possível verificar modelo da GPU via WMI:', err.message);
    return true; // Prossegue e deixa o pipeline D3D11/AMF validar
  }
}

if (!detectAmdGpu()) {
  console.error('[WorkerRunner] Nenhuma GPU AMD Radeon compatível detectada no sistema. Worker nativo AMF não suportado neste dispositivo.');
  if (process.send) {
    process.send({
      type: 'error',
      code: 'UNSUPPORTED_GPU',
      message: 'GPU AMD Radeon não detectada. Utilizando caminho WebRTC padrão.'
    });
  }
  process.exit(2);
}

// 3. Localização do GStreamer binário
function findGstBinDir() {
  const candidates = [
    process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ? path.join(process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64, 'bin') : null,
    'C:\\Users\\adria\\.gemini\\antigravity-cli\\brain\\3614c794-5a00-4664-8dc2-10ac09b4c53a\\scratch\\gst-1.26.11\\PFiles64\\gstreamer\\1.0\\msvc_x86_64\\bin',
    'C:\\gstreamer\\1.0\\msvc_x86_64\\bin',
    path.resolve(__dirname, '../../resources/gstreamer/bin')
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'gstreamer-1.0-0.dll'))) {
      return c;
    }
  }

  // Verifica no PATH existente
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const p of pathDirs) {
    if (fs.existsSync(path.join(p, 'gstreamer-1.0-0.dll'))) {
      return p;
    }
  }

  return null;
}

const gstBinDir = findGstBinDir();
if (!gstBinDir) {
  console.error('[WorkerRunner] Diretório binário do GStreamer MSVC x64 não encontrado.');
  if (process.send) {
    process.send({
      type: 'error',
      code: 'GSTREAMER_NOT_FOUND',
      message: 'Binários do GStreamer MSVC x64 não localizados no sistema.'
    });
  }
  process.exit(3);
}

// 4. Localização do executável screen_worker.exe
const workerExeCandidates = [
  path.join(__dirname, 'screen_worker.exe'),
  path.join(__dirname, 'prototype', 'gst_worker.exe')
];
const workerExe = workerExeCandidates.find(p => fs.existsSync(p));

if (!workerExe) {
  console.error('[WorkerRunner] Executável screen_worker.exe não encontrado.');
  process.exit(4);
}

console.log(`[WorkerRunner] Iniciando worker nativo: ${workerExe}`);
console.log(`[WorkerRunner] GStreamer bin path: ${gstBinDir}`);

// 5. Instanciação da Escada Adaptativa (L0–L3)
const ladder = new AdaptiveLadder({
  onLevelChange: (viewerId, newLevel, reason, oldLevel) => {
    console.log(`[WorkerRunner] Nível alterado para ${viewerId}: ${oldLevel} -> ${newLevel} (${reason})`);
    
    // Atualiza bitrate no encoder C nativo
    const effectiveBitrate = ladder.getGlobalEffectiveBitrateKbps();
    sendToWorkerNative({
      type: 'setBitrate',
      bitrate: effectiveBitrate
    });

    // Envia notificação de qualidade para a sala
    sendSignaling('QUALITY_REPORT', {
      viewerId,
      level: newLevel,
      bitrateKbps: effectiveBitrate,
      reason,
      diagnostics: ladder.getDiagnosticsTable()
    });
  }
});

// 6. Lançamento do processo nativo screen_worker.exe
const childEnv = {
  ...process.env,
  PATH: `${gstBinDir}${path.delimiter}${process.env.PATH || ''}`
};

const workerProcess = spawn(workerExe, [], {
  env: childEnv,
  stdio: ['pipe', 'pipe', 'inherit'],
  windowsHide: true
});

let isWorkerReady = false;
const pendingPeerOffers = new Set();

function sendToWorkerNative(obj) {
  if (workerProcess && workerProcess.stdin && !workerProcess.stdin.destroyed) {
    try {
      workerProcess.stdin.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      console.warn('[WorkerRunner] Erro ao enviar comando para worker nativo:', e.message);
    }
  }
}

const rl = readline.createInterface({
  input: workerProcess.stdout,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    handleWorkerNativeMessage(msg);
  } catch (err) {
    console.log(`[Native Worker] ${trimmed}`);
  }
});

workerProcess.on('exit', (code, signal) => {
  console.warn(`[WorkerRunner] Processo nativo encerrou com código ${code}, sinal ${signal}`);
  if (process.send) {
    process.send({ type: 'exit', code, signal });
  }
  teardown();
  process.exit(code || 0);
});

// 7. Conexão WebSocket de Sinalização
let ws = null;
let wsHeartbeat = null;

function sendSignaling(type, data = {}, to = null) {
  if (!ws || ws.readyState !== 1 /* OPEN */) return false;
  const payload = {
    type,
    roomId,
    from: workerUserId,
    to,
    data,
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(payload));
  return true;
}

async function connectSignaling() {
  const u = new URL(serverUrl);
  const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${u.host}/ws`;

  console.log(`[WorkerRunner] Conectando ao backend de sinalização em ${wsUrl}...`);

  const WS = globalThis.WebSocket || (await import('ws')).default;
  ws = new WS(wsUrl);

  ws.onopen = () => {
    console.log('[WorkerRunner] WebSocket conectado com sucesso! Autenticando com role=screen-worker...');
    sendSignaling('JOIN_ROOM', {
      role: 'screen-worker',
      parentUserId: hostId,
      token: workerToken
    });

    wsHeartbeat = setInterval(() => {
      sendSignaling('PING', {});
    }, 15000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleIncomingSignaling(msg);
    } catch (e) {
      console.error('[WorkerRunner] Erro ao decodificar mensagem do WebSocket:', e);
    }
  };

  ws.onclose = (event) => {
    console.warn(`[WorkerRunner] Conexão WebSocket de sinalização encerrada. Código: ${event.code}`);
    teardown();
    process.exit(0);
  };

  ws.onerror = (err) => {
    console.error('[WorkerRunner] Erro no WebSocket de sinalização:', err.message || err);
  };
}

// 8. Roteamento de mensagens nativas do worker -> sinalização
function handleWorkerNativeMessage(msg) {
  switch (msg.type) {
    case 'ready':
      isWorkerReady = true;
      console.log(`[WorkerRunner] Worker nativo PRONTO! PID=${msg.pid}, Slots=${msg.slots}`);
      if (process.send) {
        process.send({ type: 'ready', pid: msg.pid });
      }
      // Drena solicitações de ofertas pendentes
      for (const peerId of pendingPeerOffers) {
        sendToWorkerNative({ type: 'createOffer', peerId });
      }
      pendingPeerOffers.clear();
      break;

    case 'offer':
      console.log(`[WorkerRunner] Oferta SDP gerada para ${msg.peerId}. Enviando via sinalização...`);
      sendSignaling('OFFER', {
        type: 'offer',
        sdp: msg.sdp,
        role: 'screen-worker',
        parentUserId: hostId
      }, msg.peerId);
      break;

    case 'ice':
      sendSignaling('ICE_CANDIDATE', {
        candidate: msg.candidate,
        sdpMLineIndex: msg.sdpMLineIndex,
        sdpMid: 'video'
      }, msg.peerId);
      break;

    case 'status':
      console.log(`[WorkerRunner Status] ${msg.message} (peerId=${msg.peerId || 'global'})`);
      break;

    case 'error':
      console.error(`[WorkerRunner Error] ${msg.message} (peerId=${msg.peerId || 'global'})`);
      break;
  }
}

// 9. Roteamento de mensagens da sinalização -> worker nativo
function handleIncomingSignaling(msg) {
  const { type, from, data } = msg;

  switch (type) {
    case 'ROOM_JOINED':
      console.log('[WorkerRunner] Confirmado ingresso na sala como screen-worker!');
      break;

    case 'USER_JOINED':
      // Se um novo participante entrar, inicializa na escada e gera oferta SDP
      if (from && from !== workerUserId && from !== hostId) {
        console.log(`[WorkerRunner] Novo participante na sala (${from}). Iniciando oferta WebRTC do worker...`);
        ladder.initViewer(from);
        if (isWorkerReady) {
          sendToWorkerNative({ type: 'createOffer', peerId: from });
        } else {
          pendingPeerOffers.add(from);
        }
      }
      break;

    case 'ANSWER':
      if (from && data?.sdp) {
        console.log(`[WorkerRunner] Resposta SDP recebida de ${from}. Repassando para o worker nativo...`);
        sendToWorkerNative({
          type: 'answer',
          peerId: from,
          sdp: data.sdp
        });
      }
      break;

    case 'ICE_CANDIDATE':
      if (from && data) {
        const cand = data.candidate || data;
        const mline = (typeof data.sdpMLineIndex === 'number') ? data.sdpMLineIndex : 0;
        sendToWorkerNative({
          type: 'ice',
          peerId: from,
          candidate: cand,
          sdpMLineIndex: mline
        });
      }
      break;

    case 'QUALITY_REPORT':
      if (from && data) {
        ladder.processReport(from, data);
      }
      break;

    case 'USER_LEFT':
      if (from) {
        console.log(`[WorkerRunner] Participante ${from} saiu. Liberando slot no worker nativo...`);
        ladder.removeViewer(from);
        sendToWorkerNative({ type: 'removePeer', peerId: from });
      }
      break;
  }
}

// 10. Encerramento gracioso
function teardown() {
  if (wsHeartbeat) {
    clearInterval(wsHeartbeat);
    wsHeartbeat = null;
  }
  if (ws && ws.readyState === 1) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
  if (workerProcess && !workerProcess.killed) {
    sendToWorkerNative({ type: 'quit' });
    setTimeout(() => {
      try { workerProcess.kill('SIGKILL'); } catch (_) {}
    }, 1500);
  }
}

process.on('SIGINT', () => {
  teardown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  teardown();
  process.exit(0);
});

// Inicia conexão
connectSignaling();
