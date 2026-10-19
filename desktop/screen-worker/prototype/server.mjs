import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import pkg from '../../../backend/node_modules/ws/index.js';
const { WebSocketServer } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8888;
const TEST_DURATION_SECONDS = 60;
const GST_BIN = 'C:\\Users\\adria\\.gemini\\antigravity-cli\\brain\\3614c794-5a00-4664-8dc2-10ac09b4c53a\\scratch\\gst-1.26.11\\PFiles64\\gstreamer\\1.0\\msvc_x86_64\\bin';
const CHROME_BIN = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_PROFILE = 'C:\\Users\\adria\\.gemini\\antigravity-cli\\brain\\3614c794-5a00-4664-8dc2-10ac09b4c53a\\scratch\\chrome-test-profile';

console.log('===============================================================');
console.log('   FASE 0 GATE — PROTÓTIPO SCREEN WORKER (AMD AMF + WEBRTC)    ');
console.log('===============================================================\n');

// 1. Servidor HTTP
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/receiver.html') {
    const htmlPath = path.join(__dirname, 'receiver.html');
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading receiver.html');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

let gstProc = null;
let chromeProc = null;
let monitorProc = null;
let workerPid = null;
let wsClient = null;
let latestOffer = null;
const pendingWorkerIce = [];

// Telemetria coletada
const clientMetrics = [];
const gpuSamples = [];
const cpuSamples = [];

let prevCpuSec = null;
let prevCpuTimestamp = null;
let currentCpuPct = 0;
let currentGpuPct = 0;

let testStarted = false;
let testFinished = false;

// Monitoramento via monitor.ps1
function startMonitoring(pid) {
  console.log(`[Monitor] Iniciando monitoramento de hardware para PID ${pid}...`);
  monitorProc = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'monitor.ps1'),
    '-TargetPid', pid.toString()
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  let buf = '';
  monitorProc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('MONITOR,')) continue;
      const parts = line.split(',');
      if (parts.length < 4) continue;

      const timestamp = parseInt(parts[1], 10);
      const cpuSec = parseFloat(parts[2]);
      const gpuVal = parseFloat(parts[3]);

      if (prevCpuSec !== null && prevCpuTimestamp !== null) {
        const timeDelta = (timestamp - prevCpuTimestamp) / 1000;
        if (timeDelta > 0) {
          const cpuDelta = cpuSec - prevCpuSec;
          currentCpuPct = (cpuDelta / timeDelta) * 100;
          if (testStarted && !testFinished) {
            cpuSamples.push(currentCpuPct);
          }
        }
      }
      prevCpuSec = cpuSec;
      prevCpuTimestamp = timestamp;

      currentGpuPct = gpuVal;
      if (testStarted && !testFinished) {
        gpuSamples.push(gpuVal);
      }
    }
  });
}

// 2. Inicia o gst_worker
function startGstWorker() {
  console.log('[Worker] Iniciando gst_worker.exe...');
  const env = { ...process.env, PATH: GST_BIN + ';' + process.env.PATH };
  gstProc = spawn(path.join(__dirname, 'gst_worker.exe'), [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdoutBuf = '';
  gstProc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleWorkerMessage(msg);
      } catch (e) {
        console.log('[Worker RAW]:', line);
      }
    }
  });

  gstProc.stderr.on('data', (d) => {
    const errText = d.toString().trim();
    if (errText) console.error('[Worker STDERR]:', errText);
  });

  gstProc.on('exit', (code, sig) => {
    console.log(`[Worker] Processo saiu com código ${code}, sinal ${sig}`);
  });
}

function handleWorkerMessage(msg) {
  if (msg.type === 'ready') {
    workerPid = msg.pid;
    console.log(`[Worker] Pronto! PID detectado: ${workerPid}`);
    startMonitoring(workerPid);
    launchChrome();
  } else if (msg.type === 'offer') {
    console.log('[Worker] SDP Offer gerado pelo webrtcbin:\n' + msg.sdp);
    latestOffer = msg;
    if (wsClient && wsClient.readyState === 1) {
      wsClient.send(JSON.stringify(msg));
    }
  } else if (msg.type === 'ice') {
    console.log('[Worker -> Browser ICE]:', msg.candidate);
    if (wsClient && wsClient.readyState === 1) {
      wsClient.send(JSON.stringify(msg));
    } else {
      pendingWorkerIce.push(msg);
    }
  } else if (msg.type === 'error') {
    console.error('[Worker ERROR]:', msg.message);
  } else if (msg.type === 'status') {
    console.log('[Worker STATUS]:', msg.message);
  }
}

// 3. Lançamento do navegador receptor
function launchChrome() {
  console.log('[Chrome] Abrindo Chrome para reprodução e animação WebRTC...');
  chromeProc = spawn(CHROME_BIN, [
    `--user-data-dir=${CHROME_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1280,720',
    `http://127.0.0.1:${PORT}`
  ], { stdio: 'ignore' });
}

// 4. WebSocket sinalização e coleta de métricas
wss.on('connection', (ws) => {
  console.log('[WebSocket] Cliente conectado!');
  wsClient = ws;

  if (latestOffer) {
    console.log('[WebSocket] Enviando Offer existente para o cliente...');
    ws.send(JSON.stringify(latestOffer));
  } else if (gstProc && gstProc.stdin.writable) {
    console.log('[WebSocket] Solicitando createOffer do worker...');
    gstProc.stdin.write(JSON.stringify({ type: 'createOffer' }) + '\n');
  }

  if (pendingWorkerIce.length > 0) {
    console.log(`[WebSocket] Descarregando ${pendingWorkerIce.length} candidatos ICE acumulados para o cliente...`);
    for (const ice of pendingWorkerIce) {
      ws.send(JSON.stringify(ice));
    }
    pendingWorkerIce.length = 0;
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'browserLog') {
        console.log(msg.text);
      } else if (msg.type === 'answer') {
        console.log('[WebSocket] SDP Answer recebido do receptor:\n' + msg.sdp);
        if (gstProc && gstProc.stdin.writable) {
          gstProc.stdin.write(JSON.stringify(msg) + '\n');
        }
      } else if (msg.type === 'ice') {
        console.log('[Browser -> Worker ICE]:', msg.candidate);
        if (gstProc && gstProc.stdin.writable) {
          gstProc.stdin.write(JSON.stringify(msg) + '\n');
        }
      } else if (msg.type === 'metrics') {
        if (!testStarted) {
          testStarted = true;
          console.log('\n>>> TRANSMISSÃO WEBRTC ESTABELECIDA! INICIANDO BENCHMARK DE 60 SEGUNDOS <<<\n');
        }

        if (testStarted && !testFinished) {
          clientMetrics.push({
            timestamp: Date.now(),
            fps: msg.fps,
            bitrateMbps: msg.bitrateMbps,
            width: msg.width,
            height: msg.height,
            decoder: msg.decoder,
            packetLoss: msg.packetLoss,
            jitter: msg.jitter,
            cpuPct: currentCpuPct,
            gpuPct: currentGpuPct
          });

          const count = clientMetrics.length;
          console.log(
            `[${count.toString().padStart(2, '0')}/${TEST_DURATION_SECONDS}s] ` +
            `FPS: ${msg.fps.toString().padStart(2, ' ')} | ` +
            `Bitrate: ${msg.bitrateMbps.toFixed(2)} Mbps | ` +
            `Decoder: ${msg.decoder} | ` +
            `Worker CPU: ${currentCpuPct.toFixed(1)}% de 1 core | ` +
            `GPU Encode: ${currentGpuPct.toFixed(1)}%`
          );

          if (count >= TEST_DURATION_SECONDS) {
            finishBenchmark();
          }
        }
      }
    } catch (e) {
      console.error('[WebSocket Error]:', e);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Cliente desconectado.');
  });
});

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function finishBenchmark() {
  if (testFinished) return;
  testFinished = true;
  console.log('\n===============================================================');
  console.log('             RELATÓRIO FINAL DO BENCHMARK (60s)               ');
  console.log('===============================================================');

  const fpsList = clientMetrics.map(m => m.fps);
  const bitrateList = clientMetrics.map(m => m.bitrateMbps);
  const cpuList = cpuSamples.length > 0 ? cpuSamples : clientMetrics.map(m => m.cpuPct);
  const gpuList = gpuSamples.length > 0 ? gpuSamples : clientMetrics.map(m => m.gpuPct);

  const avgFps = fpsList.length > 0 ? (fpsList.reduce((a, b) => a + b, 0) / fpsList.length).toFixed(2) : '0';
  const p1Fps = calculatePercentile(fpsList, 1).toFixed(2);
  const minFps = fpsList.length > 0 ? Math.min(...fpsList) : 0;
  const maxFps = fpsList.length > 0 ? Math.max(...fpsList) : 0;

  const avgBitrate = bitrateList.length > 0 ? (bitrateList.reduce((a, b) => a + b, 0) / bitrateList.length).toFixed(2) : '0';
  const avgCpu = cpuList.length > 0 ? (cpuList.reduce((a, b) => a + b, 0) / cpuList.length).toFixed(2) : '0';
  const maxCpu = cpuList.length > 0 ? Math.max(...cpuList).toFixed(2) : '0';

  const avgGpu = gpuList.length > 0 ? (gpuList.reduce((a, b) => a + b, 0) / gpuList.length).toFixed(2) : '0';
  const maxGpu = gpuList.length > 0 ? Math.max(...gpuList).toFixed(2) : '0';
  const nonZeroGpu = gpuList.filter(v => v > 0).length;

  const decoderUsed = clientMetrics[clientMetrics.length - 1]?.decoder || 'N/A';
  const resolution = `${clientMetrics[clientMetrics.length - 1]?.width}x${clientMetrics[clientMetrics.length - 1]?.height}`;

  console.log(`- Amostras coletadas       : ${clientMetrics.length}s`);
  console.log(`- Resolução do vídeo       : ${resolution}`);
  console.log(`- Decodificador no cliente : ${decoderUsed}`);
  console.log(`- FPS Médio recebido       : ${avgFps} fps`);
  console.log(`- FPS 1% Low               : ${p1Fps} fps`);
  console.log(`- FPS Min / Max            : ${minFps} / ${maxFps} fps`);
  console.log(`- Bitrate Médio            : ${avgBitrate} Mbps`);
  console.log(`- Worker CPU (Média / Max) : ${avgCpu}% / ${maxCpu}% (de 1 core)`);
  console.log(`- GPU Video Encode Counter : Média ${avgGpu}%, Pico ${maxGpu}%, Amostras > 0: ${nonZeroGpu}/${gpuList.length}`);

  console.log('\n---------------------------------------------------------------');
  console.log('                     AVALIAÇÃO DO GATE                         ');
  console.log('---------------------------------------------------------------');

  const gateFpsPass = parseFloat(avgFps) >= 55.0;
  const gateCpuPass = parseFloat(avgCpu) <= 20.0;
  const gateGpuPass = maxGpu > 0 || nonZeroGpu > 0;

  console.log(`1. Encode por GPU comprovado (GPU Encode > 0%) : ${gateGpuPass ? '✅ PASS' : '❌ FAIL'} (Pico: ${maxGpu}%)`);
  console.log(`2. CPU do Worker baixa (<= 20% de 1 core)      : ${gateCpuPass ? '✅ PASS' : '❌ FAIL'} (Média: ${avgCpu}%)`);
  console.log(`3. FPS do cliente adequado (>= 55 fps)         : ${gateFpsPass ? '✅ PASS' : '❌ FAIL'} (Média: ${avgFps} fps)`);

  const gatePassed = gateFpsPass && gateCpuPass && gateGpuPass;
  console.log(`\n>>> RESULTADO DO GATE: ${gatePassed ? 'APROVADO ✅' : 'REPROVADO ❌'} <<<\n`);

  const results = {
    gatePassed,
    criteria: {
      gpuEncodeActive: { pass: gateGpuPass, maxGpu: parseFloat(maxGpu), nonZeroSamples: nonZeroGpu },
      workerCpuLow: { pass: gateCpuPass, avgCpu: parseFloat(avgCpu), maxCpu: parseFloat(maxCpu) },
      fpsAdequate: { pass: gateFpsPass, avgFps: parseFloat(avgFps), p1Fps: parseFloat(p1Fps) }
    },
    metrics: {
      resolution,
      decoder: decoderUsed,
      avgFps: parseFloat(avgFps),
      p1Fps: parseFloat(p1Fps),
      minFps,
      maxFps,
      avgBitrateMbps: parseFloat(avgBitrate),
      avgWorkerCpuPct: parseFloat(avgCpu),
      maxWorkerCpuPct: parseFloat(maxCpu),
      avgGpuEncodePct: parseFloat(avgGpu),
      maxGpuEncodePct: parseFloat(maxGpu)
    },
    rawSamples: clientMetrics
  };

  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  console.log('[Salvo] Resultados salvos em desktop/screen-worker/prototype/results.json');

  cleanup();
}

function cleanup() {
  console.log('[Cleanup] Encerrando processos...');
  if (chromeProc) {
    try { chromeProc.kill(); } catch (e) {}
  }
  if (monitorProc) {
    try { monitorProc.kill(); } catch (e) {}
  }
  if (gstProc) {
    try {
      gstProc.stdin.write(JSON.stringify({ type: 'quit' }) + '\n');
      setTimeout(() => {
        try { gstProc.kill(); } catch (e) {}
        server.close(() => process.exit(0));
      }, 1000);
      return;
    } catch (e) {}
  }
  server.close(() => process.exit(0));
}

// 5. Inicia o servidor HTTP e o Worker
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[HTTP] Servidor rodando em http://127.0.0.1:${PORT}`);
  startGstWorker();
});

// Timeout de segurança após 90 segundos
setTimeout(() => {
  if (!testFinished) {
    console.warn('[Timeout] Tempo limite de 90s atingido.');
    finishBenchmark();
  }
}, 90000);
