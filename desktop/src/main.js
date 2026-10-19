import { app, BrowserWindow, ipcMain, desktopCapturer, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { spawn, exec, execSync, execFile, execFileSync } from 'node:child_process';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import loopbackModule from 'loopback-capture';
import {
  isNewerVersion,
  extractExpectedSha256,
  verifyPackageIntegrity,
  generatePowerShellUpdaterScript
} from './updaterCore.js';

const LoopbackCapture = loopbackModule.LoopbackCapture || loopbackModule.default?.LoopbackCapture;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================================
// FLAGS CHROMIUM DE ULTRA-PERFORMANCE (WGC + GPU ACCELERATION)
// ========================================================
// 1. Unificação estrita de enable-features em uma ÚNICA chamada antes de app.whenReady()
// Destrava texturas D3D11 NV12 GpuMemoryBuffer no WebRTC e MediaFoundationVideoEncodeAccelerator na AMD RX 7600
app.commandLine.appendSwitch('enable-features', [
  'MediaFoundationVideoEncode',
  'MediaFoundationD3D11VideoCapture'
].join(','));
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force-high-performance-gpu');
app.commandLine.appendSwitch('enable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');

// 3. Mantém execução fluida e timers ativos em segundo plano sem desativar VSync ou sobrecarregar GPU/CPU
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WidgetLayering,MediaFoundationD3D11VideoCaptureBlocklist');

// 4. Ignora certificados autoassinados em conexões locais (HTTPS e WebSockets WSS)
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');

// Ignora erros de certificado SSL autoassinado para localhost durante o desenvolvimento (HTTPS e WSS)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

// Arquivo de configuração persistente para guardar configurações do app e preferências do usuário
const configFilePath = path.join(app.getPath('userData'), 'hyperstream-config.json');

function loadDesktopConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      return JSON.parse(fs.readFileSync(configFilePath, 'utf8')) || {};
    }
  } catch (e) {
    console.warn('[Desktop Main] Erro ao ler hyperstream-config.json:', e.message);
  }
  return {};
}

function saveDesktopConfig(partial) {
  try {
    const current = loadDesktopConfig();
    const updated = { ...current, ...partial };
    fs.writeFileSync(configFilePath, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (e) {
    console.warn('[Desktop Main] Erro ao salvar hyperstream-config.json:', e.message);
    return null;
  }
}

function loadSavedServerUrl() {
  const conf = loadDesktopConfig();
  return conf.serverUrl || null;
}

function saveServerUrl(url) {
  saveDesktopConfig({ serverUrl: url });
}

let mainWindow = null;
let selectedSourceId = null;
let captureAudioEnabled = true;
let cachedCapturerSources = [];

const RENDER_DEFAULT_URL = 'https://hyperstream-g9gz.onrender.com';

let localFrontendPort = null;
let localFrontendServer = null;

function findFrontendDir() {
  const candidates = [
    path.resolve(__dirname, '../../frontend'), // dev mode
    path.resolve(__dirname, '../frontend'),    // packaged mode
    path.join(process.resourcesPath, 'app/frontend'),
    path.join(process.resourcesPath, 'frontend')
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) {
      return c;
    }
  }
  return null;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm'
};

function startLocalFrontendServer() {
  const frontendDir = findFrontendDir();
  if (!frontendDir) {
    console.warn('[Desktop Main] Diretório frontend não encontrado para servidor local embutido.');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let reqPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
        if (reqPath === '/' || !path.extname(reqPath)) {
          reqPath = '/index.html';
        }
        const filePath = path.join(frontendDir, reqPath);
        if (filePath.startsWith(frontendDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mime = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          fs.createReadStream(filePath).pipe(res);
        } else {
          const indexPath = path.join(frontendDir, 'index.html');
          if (fs.existsSync(indexPath)) {
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache'
            });
            fs.createReadStream(indexPath).pipe(res);
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
          }
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${err.message}`);
      }
    });

    const PREFERRED_PORT = 38385;

    const startListening = (portToTry) => {
      server.listen(portToTry, '127.0.0.1', () => {
        localFrontendPort = server.address().port;
        localFrontendServer = server;
        console.log(`[Desktop Main] Servidor local embutido iniciado em http://127.0.0.1:${localFrontendPort} (servindo ${frontendDir})`);
        resolve(`http://127.0.0.1:${localFrontendPort}`);
      });
    };

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Desktop Main] Porta fixa ${PREFERRED_PORT} ocupada, utilizando porta dinâmica alternativa...`);
        server.listen(0, '127.0.0.1', () => {
          localFrontendPort = server.address().port;
          localFrontendServer = server;
          console.log(`[Desktop Main] Servidor local embutido iniciado em http://127.0.0.1:${localFrontendPort} (servindo ${frontendDir})`);
          resolve(`http://127.0.0.1:${localFrontendPort}`);
        });
      } else {
        console.warn('[Desktop Main] Falha ao iniciar servidor local embutido:', err.message);
        resolve(null);
      }
    });

    startListening(PREFERRED_PORT);
  });
}

function checkUrlReachable(targetUrl, timeoutMs = 300) {
  return new Promise((resolve) => {
    try {
      const u = new URL(targetUrl);
      const req = http.get({
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        timeout: timeoutMs
      }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

async function getInitialUrl() {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  const saved = loadSavedServerUrl();
  if (saved) {
    return saved;
  }

  // Se o backend local de desenvolvimento estiver ativo em localhost:3000, conecta diretamente
  const isLocalBackendRunning = await checkUrlReachable('http://localhost:3000/api/health', 300);
  if (isLocalBackendRunning) {
    console.log('[Desktop Main] Backend local detectado em http://localhost:3000. Conectando diretamente.');
    return 'http://localhost:3000';
  }

  // Se o servidor local embutido estiver ativo, carrega a interface embutida com código atualizado!
  if (localFrontendPort) {
    console.log(`[Desktop Main] Carregando interface embutida em http://127.0.0.1:${localFrontendPort}`);
    return `http://127.0.0.1:${localFrontendPort}`;
  }

  return RENDER_DEFAULT_URL;
}

function getErrorPageHtml(failedUrl) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>HyperStream — Conexão Pendente</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #121215; border: 1px solid #222226; border-radius: 12px; padding: 32px; max-width: 520px; width: 100%; box-shadow: 0 16px 36px rgba(0,0,0,0.5); }
    h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 8px; color: #ffffff; display: flex; align-items: center; gap: 10px; }
    .badge { font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; background: #1e1e23; border: 1px solid #3f3f46; color: #a1a1aa; font-weight: 500; }
    p { color: #a1a1aa; font-size: 0.9rem; line-height: 1.5; margin-bottom: 20px; }
    .hint { background: #18181c; border-left: 3px solid #3f3f46; padding: 12px 14px; border-radius: 4px; font-size: 0.82rem; color: #d4d4d8; margin-bottom: 20px; font-family: monospace; }
    .form-group { margin-bottom: 18px; }
    label { display: block; font-size: 0.8rem; font-weight: 500; color: #a1a1aa; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 14px; background: #141417; border: 1px solid #27272a; border-radius: 6px; color: #fff; font-size: 0.9rem; outline: none; }
    input:focus { border-color: #52525b; }
    .btn-row { display: flex; gap: 10px; margin-top: 22px; }
    button { flex: 1; padding: 10px 16px; border-radius: 6px; font-weight: 500; font-size: 0.9rem; cursor: pointer; border: none; transition: 0.2s; }
    .btn-primary { background: #f4f4f5; color: #09090b; }
    .btn-primary:hover { background: #ffffff; }
    .btn-secondary { background: #1e1e23; color: #f4f4f5; border: 1px solid #27272a; }
    .btn-secondary:hover { background: #27272a; }
  </style>
</head>
<body>
  <div class="card">
    <h2>
      <span>Hyperstream</span>
      <span class="badge">WGC 60 FPS</span>
    </h2>
    <p>Não foi possível conectar ao servidor na URL configurada:<br><strong style="color: #fff;">${failedUrl}</strong></p>
    <div class="hint">
      Servidor oficial na nuvem:<br>
      <strong>https://hyperstream-g9gz.onrender.com</strong><br><br>
      Para testes locais, execute <strong>npm run backend</strong> e use <strong>http://localhost:3000</strong>.
    </div>
    <div class="form-group">
      <label for="serverUrlInput">URL do Servidor (Render ou Localhost):</label>
      <input type="text" id="serverUrlInput" value="${failedUrl.startsWith('data:') ? 'https://hyperstream-g9gz.onrender.com' : failedUrl}">
    </div>
    <div class="btn-row">
      <button class="btn-secondary" onclick="window.desktopAPI.reloadApp()">Tentar Novamente</button>
      <button class="btn-primary" onclick="salvarEConectar()">Conectar</button>
    </div>
  </div>
  <script>
    function salvarEConectar() {
      const val = document.getElementById('serverUrlInput').value.trim();
      if (val) {
        window.desktopAPI.setServerUrl(val);
      }
    }
  </script>
</body>
</html>`;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0e14',
    title: 'Hyperstream',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // CRÍTICO: Não reduz FPS para 1 quando o jogo está em primeiro plano
      allowRunningInsecureContent: true,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  // Mantém o título da janela fixado estritamente como "Hyperstream"
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  const targetUrl = await getInitialUrl();
  console.log('[Desktop Main] Janela principal iniciada apontando para:', targetUrl);

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // -102: ERR_CONNECTION_REFUSED, -105: ERR_NAME_NOT_RESOLVED, -106: ERR_INTERNET_DISCONNECTED
    if (errorCode < 0 && errorCode !== -3) { // -3 é ERR_ABORTED
      console.warn(`[Desktop Main] Falha ao carregar ${validatedURL} (${errorCode}: ${errorDescription}). Exibindo tela de auxílio.`);
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getErrorPageHtml(validatedURL))}`);
    }
  });

  mainWindow.loadURL(targetUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))
    ) {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// IPC: Retorna lista de telas e janelas ativas com thumbnails para seleção WGC
ipcMain.handle('desktop:get-sources', async (event, opts = {}) => {
  try {
    const types = opts.types || ['screen', 'window'];
    const thumbnailWidth = opts.thumbnailWidth || 360;
    const thumbnailHeight = opts.thumbnailHeight || 202;

    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
      fetchWindowIcons: true
    });

    cachedCapturerSources = sources;

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
      display_id: source.display_id
    }));
  } catch (err) {
    console.error('[Desktop Main] Erro ao obter fontes:', err);
    return [];
  }
});

// IPC: Define a fonte selecionada antes da captura ser iniciada
ipcMain.handle('desktop:set-selected-source', async (event, sourceId) => {
  selectedSourceId = (sourceId && sourceId !== 'default') ? sourceId : null;
  console.log('[Desktop Main] Fonte de captura definida para:', selectedSourceId);
  return true;
});

// IPC: Obter / Definir URL do servidor
ipcMain.handle('desktop:get-server-url', () => {
  const saved = loadSavedServerUrl();
  if (saved) return saved;
  return RENDER_DEFAULT_URL;
});

ipcMain.handle('desktop:set-server-url', async (event, newUrl) => {
  if (newUrl && (newUrl.startsWith('http://') || newUrl.startsWith('https://'))) {
    saveServerUrl(newUrl);
    if (mainWindow) {
      mainWindow.loadURL(newUrl);
    }
    return true;
  }
  return false;
});

// IPC: Obter / Salvar preferências do usuário (Nome, última sala, etc.)
ipcMain.handle('desktop:get-preferences', () => {
  return loadDesktopConfig();
});

ipcMain.handle('desktop:save-preferences', (event, prefs) => {
  if (prefs && typeof prefs === 'object') {
    return saveDesktopConfig(prefs);
  }
  return null;
});

// IPC: Recarregar aplicação
ipcMain.handle('desktop:reload-app', async () => {
  if (mainWindow) {
    const target = await getInitialUrl();
    mainWindow.loadURL(target);
  }
  return true;
});

// IPC: Abrir link no navegador padrão do sistema
ipcMain.handle('desktop:open-external', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// IPC: Abrir janela interna chrome://gpu (1100x800) reutilizando instância se já estiver aberta
let chromeGpuWindow = null;
ipcMain.handle('desktop:open-chrome-gpu', async () => {
  try {
    if (chromeGpuWindow && !chromeGpuWindow.isDestroyed()) {
      if (chromeGpuWindow.isMinimized()) chromeGpuWindow.restore();
      chromeGpuWindow.show();
      chromeGpuWindow.focus();
      return { success: true, reused: true };
    }

    chromeGpuWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      title: 'chrome://gpu — Diagnóstico de GPU do Chromium',
      backgroundColor: '#09090b',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    chromeGpuWindow.on('closed', () => {
      chromeGpuWindow = null;
    });

    await chromeGpuWindow.loadURL('chrome://gpu');
    return { success: true, reused: false };
  } catch (err) {
    console.error('[Desktop Main] Erro ao abrir chrome://gpu:', err);
    return { success: false, error: err.message };
  }
});

// ========================================================
// GERENCIADOR DE SCREEN WORKER NATIVO (GPU AMD AMF)
// ========================================================
let activeScreenWorkerProcess = null;

function isAmdGpuPresent() {
  if (process.platform !== 'win32') return false;
  try {
    const stdout = execSync('powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', {
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return /amd|radeon/i.test(stdout);
  } catch (_) {
    return false;
  }
}

function findGstreamerBin() {
  const candidates = [
    process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ? path.join(process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64, 'bin') : null,
    path.join(process.resourcesPath || '', 'gstreamer', 'bin'),
    'C:\\gstreamer\\1.0\\msvc_x86_64\\bin',
    'C:\\Users\\adria\\.gemini\\antigravity-cli\\brain\\3614c794-5a00-4664-8dc2-10ac09b4c53a\\scratch\\gst-1.26.11\\PFiles64\\gstreamer\\1.0\\msvc_x86_64\\bin'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'gstreamer-1.0-0.dll'))) return c;
  }
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const p of pathDirs) {
    if (p && fs.existsSync(path.join(p, 'gstreamer-1.0-0.dll'))) return p;
  }
  return null;
}

function verifyGstreamerVersion(binDir) {
  if (!binDir) return false;
  try {
    const gstLaunch = path.join(binDir, 'gst-launch-1.0.exe');
    if (fs.existsSync(gstLaunch)) {
      const out = execSync(`"${gstLaunch}" --version`, {
        timeout: 3000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return /version\s+1\.26\./i.test(out);
    }
    return fs.existsSync(path.join(binDir, 'gstreamer-1.0-0.dll'));
  } catch (_) {
    return false;
  }
}

function findScreenWorkerRunner() {
  const candidates = [
    path.resolve(__dirname, '../screen-worker/worker_runner.mjs'),
    path.resolve(__dirname, 'screen-worker/worker_runner.mjs'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'desktop', 'screen-worker', 'worker_runner.mjs'),
    path.join(process.resourcesPath || '', 'screen-worker', 'worker_runner.mjs')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

ipcMain.handle('desktop:is-gpu-worker-supported', async () => {
  const isWin = process.platform === 'win32';
  const gstBin = findGstreamerBin();
  const hasGst = Boolean(gstBin && verifyGstreamerVersion(gstBin));
  const hasAmd = isWin && isAmdGpuPresent();
  const runnerPath = findScreenWorkerRunner();
  return {
    supported: isWin && hasGst && hasAmd && Boolean(runnerPath),
    isWindows: isWin,
    hasGstreamer: hasGst,
    hasAmdGpu: hasAmd,
    hasRunner: Boolean(runnerPath),
    reason: !isWin ? 'Requer sistema operacional Windows' :
            !hasAmd ? 'Requer GPU AMD Radeon compatível com AMF' :
            !hasGst ? 'GStreamer 1.26 não encontrado' :
            !runnerPath ? 'Worker runner não encontrado' : 'Compatível'
  };
});

ipcMain.handle('desktop:start-screen-worker', async (event, opts = {}) => {
  try {
    if (activeScreenWorkerProcess && !activeScreenWorkerProcess.killed) {
      console.log('[Desktop Main] Worker já em execução. PID:', activeScreenWorkerProcess.pid);
      return { success: true, pid: activeScreenWorkerProcess.pid, alreadyRunning: true };
    }

    const { roomId, hostId, workerToken, serverUrl, sourceId } = opts;
    if (!roomId || !hostId || !workerToken) {
      throw new Error('Parâmetros obrigatórios ausentes para iniciar screen-worker.');
    }

    const runner = findScreenWorkerRunner();
    if (!runner) {
      throw new Error('Script worker_runner.mjs não localizado.');
    }

    const gstBin = findGstreamerBin();
    const env = {
      ...process.env,
      PATH: gstBin ? `${gstBin}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH
    };

    const targetServerUrl = serverUrl || (await getInitialUrl());
    const runnerArgs = [
      runner,
      '--serverUrl', targetServerUrl,
      '--roomId', roomId,
      '--hostId', hostId,
      '--workerToken', workerToken
    ];
    if (sourceId) {
      runnerArgs.push('--sourceId', sourceId);
    }

    console.log('[Desktop Main] Lançando Screen Worker subprocesso:', process.execPath, runnerArgs);

    const child = spawn(process.execPath, runnerArgs, {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    });

    activeScreenWorkerProcess = child;

    child.on('message', (msg) => {
      console.log('[Desktop Main] Mensagem recebida do worker via IPC:', msg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:screen-worker-status', msg);
      }
    });

    child.stdout.on('data', (d) => {
      console.log(`[WorkerRunner Stdout] ${d.toString().trim()}`);
    });

    child.stderr.on('data', (d) => {
      console.warn(`[WorkerRunner Stderr] ${d.toString().trim()}`);
    });

    child.on('exit', (code, signal) => {
      console.log(`[Desktop Main] Worker subprocesso encerrou. Código: ${code}, Sinal: ${signal}`);
      if (activeScreenWorkerProcess === child) {
        activeScreenWorkerProcess = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:screen-worker-error', {
          code,
          signal,
          message: `Worker encerrou com código ${code}`
        });
      }
    });

    return { success: true, pid: child.pid };
  } catch (err) {
    console.error('[Desktop Main] Erro ao iniciar screen-worker:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('desktop:stop-screen-worker', async () => {
  if (activeScreenWorkerProcess && !activeScreenWorkerProcess.killed) {
    console.log('[Desktop Main] Encerrando screen-worker. PID:', activeScreenWorkerProcess.pid);
    try {
      activeScreenWorkerProcess.kill();
    } catch (_) {}
    activeScreenWorkerProcess = null;
  }
  return { success: true };
});

ipcMain.handle('desktop:get-screen-worker-status', () => {
  return {
    running: Boolean(activeScreenWorkerProcess && !activeScreenWorkerProcess.killed),
    pid: activeScreenWorkerProcess?.pid || null
  };
});

// IPC: Obter versão instalada do aplicativo Desktop
ipcMain.handle('desktop:get-version', () => {
  return app.getVersion();
});

// Coleta métricas de CPU e Memória totais do app via app.getAppMetrics()
function collectProcessMetricsSummary() {
  let totalCpuPercent = 0;
  let totalMemoryKB = 0;

  try {
    if (typeof app.getAppMetrics === 'function') {
      const metrics = app.getAppMetrics();
      for (const m of metrics) {
        totalCpuPercent += (m.cpu?.percentCPUUsage || 0);
        totalMemoryKB += (m.memory?.workingSetSize || 0);
      }
    }
  } catch (err) {
    console.warn('[Desktop Main] Erro ao consultar app.getAppMetrics():', err.message);
  }

  if (totalCpuPercent === 0 && process.getCPUUsage) {
    try {
      totalCpuPercent = process.getCPUUsage()?.percentCPUUsage || 0;
    } catch (_) {}
  }

  return {
    cpuUsagePercent: Number(totalCpuPercent.toFixed(1)),
    memoryUsageMB: Math.round(totalMemoryKB / 1024)
  };
}

// IPC: Obter uso real de CPU e RAM do processo Electron
ipcMain.handle('desktop:get-cpu-usage', () => {
  return collectProcessMetricsSummary();
});

// Cache em memória para diagnóstico estático de GPU (executa apenas 1 vez para não congelar o processo GPU)
let cachedGpuInfo = null;
let cachedGpuInfoPromise = null;
let cachedSystemGpu = null;

async function getCachedGpuInfo() {
  if (cachedGpuInfo) return cachedGpuInfo;
  if (cachedGpuInfoPromise) return cachedGpuInfoPromise;
  cachedGpuInfoPromise = (async () => {
    try {
      cachedGpuInfo = await app.getGPUInfo('basic');
    } catch (e) {
      cachedGpuInfo = { error: e.message };
    }
    return cachedGpuInfo;
  })();
  return cachedGpuInfoPromise;
}

// IPC: Diagnóstico enxuto de GPU e recursos do sistema
ipcMain.handle('desktop:get-gpu-diagnostics', async () => {
  const gpuInfo = await getCachedGpuInfo();
  const metricsSummary = collectProcessMetricsSummary();

  let systemGpu = cachedSystemGpu;
  if (!systemGpu && process.platform === 'win32') {
    try {
      const dev = gpuInfo?.gpuDevice?.[0];
      if (dev?.deviceString) {
        systemGpu = {
          name: dev.deviceString,
          driverVersion: dev.driverVersion || 'Nativo',
          vendorId: dev.vendorId,
          deviceId: dev.deviceId
        };
      }
    } catch (_) {}
    if (!systemGpu) {
      try {
        const out = execSync('powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name, DriverVersion, VideoProcessor | ConvertTo-Json"', { timeout: 3500, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        if (out && out.trim()) {
          const parsed = JSON.parse(out);
          systemGpu = {
            name: parsed.Name || 'GPU Dedicada',
            driverVersion: parsed.DriverVersion || 'Nativo Windows',
            videoProcessor: parsed.VideoProcessor || ''
          };
        }
      } catch (_) {}
    }
    cachedSystemGpu = systemGpu;
  }

  return {
    gpuInfo,
    systemGpu,
    platform: process.platform,
    arch: process.arch,
    cpuUsagePercent: metricsSummary.cpuUsagePercent,
    memoryUsageMB: metricsSummary.memoryUsageMB,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome
  };
});

// IPC: Configuração de captura de áudio do sistema (loopback)
ipcMain.handle('desktop:set-capture-audio', (event, enabled) => {
  captureAudioEnabled = Boolean(enabled);
  console.log('[Desktop Main] Captura de áudio do sistema definida para:', captureAudioEnabled);
  return captureAudioEnabled;
});

ipcMain.handle('desktop:get-capture-audio', () => {
  return captureAudioEnabled;
});

let activeLoopbacks = [];

function stopAllActiveLoopbacks() {
  if (Array.isArray(activeLoopbacks) && activeLoopbacks.length > 0) {
    for (const cap of activeLoopbacks) {
      try { cap.stop(); } catch (_) {}
    }
    activeLoopbacks = [];
  }
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function findLivePidsForApp(appItem) {
  if (!appItem) return { rootPid: null, audioPid: null, allPids: [] };
  const rawName = appItem.processName || appItem.name || (appItem.id ? appItem.id : '');
  const clean = path.basename(rawName).replace(/\.exe$/i, '').toLowerCase();

  // 1. Verifica no cache recente do mixer de áudio
  if (Array.isArray(cachedMixerApps) && cachedMixerApps.length > 0) {
    const match = cachedMixerApps.find(a => {
      const aClean = path.basename(a.processName || a.name || '').replace(/\.exe$/i, '').toLowerCase();
      return aClean === clean || (a.id && a.id.toLowerCase() === appItem.id?.toLowerCase());
    });
    if (match && match.rootPid && isPidAlive(match.rootPid)) {
      return { rootPid: match.rootPid, audioPid: match.pid, allPids: [match.rootPid, match.pid] };
    }
  }

  // 2. Busca processo no Windows via PowerShell / WMI em tempo real usando execFileSync para evitar conflitos de aspas
  try {
    const filter = `Name like '${clean}%.exe'`;
    const stdout = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json`
    ], { encoding: 'utf8', timeout: 3000 });
    const parsed = JSON.parse(stdout.trim() || '[]');
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (list.length > 0) {
      const pidSet = new Set(list.map(p => p.ProcessId));
      const root = list.find(p => !pidSet.has(p.ParentProcessId)) || list[0];
      if (root && root.ProcessId && isPidAlive(root.ProcessId)) {
        return {
          rootPid: root.ProcessId,
          audioPid: appItem.pid || null,
          allPids: list.map(p => p.ProcessId)
        };
      }
    }
  } catch (err) {
    console.warn('[Desktop Main] Falha ao consultar PIDs em tempo real via WMI:', err.message);
  }

  // 3. Fallback
  const fallbackRoot = appItem.rootPid || appItem.pid || null;
  return {
    rootPid: (fallbackRoot && isPidAlive(fallbackRoot)) ? fallbackRoot : fallbackRoot,
    audioPid: appItem.pid || null,
    allPids: []
  };
}

const execFileAsync = util.promisify(execFile);

function getAudioHelperExePath() {
  const candidatePaths = [
    // 1. Packaged: recursos descompactados fora do asar (executáveis nativos Windows)
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'bin', 'AudioSessionHelper.exe'),
    path.join(app.getAppPath().replace(/app\.asar$/i, 'app.asar.unpacked'), 'bin', 'AudioSessionHelper.exe'),
    path.join(path.dirname(app.getAppPath()), 'app.asar.unpacked', 'bin', 'AudioSessionHelper.exe'),
    path.join(__dirname.replace(/app\.asar/i, 'app.asar.unpacked'), '..', 'bin', 'AudioSessionHelper.exe'),
    // 2. Extraído em userData
    path.join(app.getPath('userData'), 'AudioSessionHelper.exe'),
    // 3. Desenvolvimento / binários locais fora do asar
    path.join(process.resourcesPath || '', 'bin', 'AudioSessionHelper.exe'),
    path.join(__dirname, '..', 'bin', 'AudioSessionHelper.exe'),
    path.join(app.getAppPath(), 'bin', 'AudioSessionHelper.exe')
  ];

  for (const p of candidatePaths) {
    // Windows CreateProcess não pode executar arquivos dentro do arquivo virtual .asar!
    if (/app\.asar[\\/]/i.test(p) && !/app\.asar\.unpacked/i.test(p)) {
      continue;
    }
    if (fs.existsSync(p)) return p;
  }

  // Fallback: se estiver dentro do asar mas não descompactado, extrai para userData
  try {
    const asarExe = path.join(app.getAppPath(), 'bin', 'AudioSessionHelper.exe');
    const targetExe = path.join(app.getPath('userData'), 'AudioSessionHelper.exe');
    if (fs.existsSync(asarExe)) {
      fs.writeFileSync(targetExe, fs.readFileSync(asarExe));
      if (fs.existsSync(targetExe)) return targetExe;
    }
  } catch (err) {
    console.warn('[Desktop Main] Falha ao extrair AudioSessionHelper para userData:', err.message);
  }

  // Se não encontrou binário pré-compilado, compila na hora via csc.exe do .NET nativo do Windows
  const csCandidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'bin', 'AudioSessionHelper.cs'),
    path.join(path.dirname(app.getAppPath()), 'app.asar.unpacked', 'bin', 'AudioSessionHelper.cs'),
    path.join(__dirname.replace(/app\.asar/i, 'app.asar.unpacked'), '..', 'bin', 'AudioSessionHelper.cs'),
    path.join(__dirname, '..', 'bin', 'AudioSessionHelper.cs'),
    path.join(app.getAppPath(), 'bin', 'AudioSessionHelper.cs'),
    path.join(process.resourcesPath || '', 'bin', 'AudioSessionHelper.cs')
  ];
  const csFile = csCandidates.find(p => {
    if (/app\.asar[\\/]/i.test(p) && !/app\.asar\.unpacked/i.test(p)) return false;
    return fs.existsSync(p);
  });
  if (csFile) {
    const cscCompiler = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    const targetExe = path.join(app.getPath('userData'), 'AudioSessionHelper.exe');
    if (fs.existsSync(cscCompiler)) {
      try {
        console.log('[Desktop Main] Compilando AudioSessionHelper nativo via csc.exe...');
        execSync(`"${cscCompiler}" /target:exe /optimize+ /out:"${targetExe}" "${csFile}"`, { timeout: 8000 });
        if (fs.existsSync(targetExe)) {
          return targetExe;
        }
      } catch (err) {
        console.warn('[Desktop Main] Falha ao compilar AudioSessionHelper via csc.exe:', err.message);
      }
    }
  }

  return candidatePaths[0];
}

const iconCache = new Map();
let cachedMixerApps = [];
let isQueryingMixer = false;
let mixerQueryTimer = null;

// Busca sessões de áudio do Windows Mixer em segundo plano sem travar a interface
async function queryMixerAppsInBackground() {
  if (isQueryingMixer) return cachedMixerApps;
  isQueryingMixer = true;

  try {
    const helperExe = getAudioHelperExePath();
    if (!fs.existsSync(helperExe)) {
      return cachedMixerApps;
    }

    // Executa helper passando o PID do Hyperstream para exclusão automática
    const { stdout } = await execFileAsync(helperExe, [String(process.pid)], {
      encoding: 'utf8',
      timeout: 3000
    });

    const parsed = JSON.parse(stdout.trim() || '[]');

    // Pré-busca concorrente de ícones que ainda não estão no cache (cada ícone só é lido uma vez)
    await Promise.all(parsed.map(async (item) => {
      if (item.exePath && !iconCache.has(item.exePath) && fs.existsSync(item.exePath)) {
        try {
          const iconNative = await app.getFileIcon(item.exePath, { size: 'normal' });
          if (iconNative && !iconNative.isEmpty()) {
            iconCache.set(item.exePath, iconNative.toDataURL());
          }
        } catch (_) {}
      }
    }));

    const results = parsed.map(item => {
      const cleanProcess = item.processName || (item.exePath ? path.basename(item.exePath) : 'app.exe');
      const appId = cleanProcess.toLowerCase();
      const appIcon = item.exePath ? (iconCache.get(item.exePath) || null) : null;

      return {
        id: appId,
        pid: item.pid,
        rootPid: item.rootPid || item.pid,
        name: item.name || cleanProcess.replace(/\.exe$/i, ''),
        processName: cleanProcess,
        windowTitle: item.windowTitle || '',
        exePath: item.exePath || '',
        state: item.state, // 1 = Active, 0 = Inactive
        peak: Number(item.peak) || 0,
        hasAudio: true,
        isActiveAudio: item.state === 1 || (Number(item.peak) > 0.001),
        appIcon
      };
    });

    // Ordena colocando aplicativos com som ativo no topo
    results.sort((a, b) => {
      if (a.isActiveAudio && !b.isActiveAudio) return -1;
      if (!a.isActiveAudio && b.isActiveAudio) return 1;
      return (b.peak || 0) - (a.peak || 0);
    });

    cachedMixerApps = results;

    // Notifica a janela do renderer em tempo real sobre mudanças no mixer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:audio-apps-updated', cachedMixerApps);
    }
  } catch (err) {
    console.warn('[Desktop Main] Erro ao consultar mixer apps via AudioSessionHelper:', err?.message || err);
  } finally {
    isQueryingMixer = false;
  }

  return cachedMixerApps;
}

// Inicia loop leve em segundo plano: verifica a cada 3s quando em foco, ou 8s quando em background
function startBackgroundAudioQueryLoop() {
  if (mixerQueryTimer) {
    clearTimeout(mixerQueryTimer);
    mixerQueryTimer = null;
  }

  const scheduleNext = () => {
    const isFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
    // Usa intervalo adaptativo (6s em foco, 15s em background) para minimizar criação de processos
    const intervalMs = isFocused ? 6000 : 15000;

    mixerQueryTimer = setTimeout(async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        await queryMixerAppsInBackground();
      }
      scheduleNext();
    }, intervalMs);
  };

  // Primeira execução inicial assíncrona
  queryMixerAppsInBackground().finally(() => {
    scheduleNext();
  });
}

// IPC: Obter aplicativos diretamente do Mixer de Áudio do Windows (retorno instantâneo a partir da memória)
ipcMain.handle('desktop:get-audio-apps', async () => {
  if (Array.isArray(cachedMixerApps) && cachedMixerApps.length > 0) {
    queryMixerAppsInBackground().catch(() => {});
    return cachedMixerApps;
  }
  return await queryMixerAppsInBackground();
});

// IPC: Inicia captura nativa de áudio do sistema com suporte a isolamento de processo (WASAPI Loopback)
ipcMain.handle('desktop:start-loopback-capture', async (event, opts = {}) => {
  try {
    stopAllActiveLoopbacks();
    await new Promise(r => setTimeout(r, 60));

    if (!LoopbackCapture) {
      throw new Error('Módulo LoopbackCapture nativo indisponível.');
    }

    const onChunk = (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:audio-pcm-chunk', payload);
      }
    };

    // Garante que o cache de sessões do mixer está pronto
    if (!Array.isArray(cachedMixerApps) || cachedMixerApps.length === 0) {
      try {
        await queryMixerAppsInBackground();
      } catch (_) {}
    }

    const mode = opts.mode || 'all';
    const disabledApps = Array.isArray(opts.disabledApps) ? opts.disabledApps : [];
    const enabledApps = Array.isArray(opts.enabledApps) ? opts.enabledApps : [];

    console.log(`[Desktop Main] Iniciar loopback: modo=${mode}, desativados=${disabledApps.length}, ativados=${enabledApps.length}`);

    // Se o modo for 'all' ou nenhum aplicativo foi desmarcado:
    if (mode === 'all' || disabledApps.length === 0) {
      console.log('[Desktop Main] Modo Todos os Apps: capturando áudio global do sistema.');
      const cap = new LoopbackCapture();
      try {
        cap.start(process.pid, false, (buf) => onChunk({ streamId: 0, chunk: buf }));
      } catch (_) {
        cap.startSystemAudio((buf) => onChunk({ streamId: 0, chunk: buf }));
      }
      activeLoopbacks.push(cap);
      return { success: true, mode: 'all' };
    }

    // Modo seletivo com exatamente 1 aplicativo desmarcado:
    // WASAPI EXCLUDE mode captura todo o som do sistema (jogos, Chrome, Spotify, etc.) EXCETO este aplicativo
    if (disabledApps.length === 1) {
      const targetApp = disabledApps[0];
      const liveInfo = findLivePidsForApp(targetApp);
      const targetPid = liveInfo.rootPid || targetApp.rootPid || targetApp.pid;

      if (targetPid && targetPid > 0 && isPidAlive(targetPid)) {
        console.log(`[Desktop Main] Excluindo aplicativo único via WASAPI: ${targetApp.name || targetApp.processName} (PID ${targetPid})`);
        const cap = new LoopbackCapture();
        cap.start(targetPid, false, (buf) => onChunk({ streamId: 0, chunk: buf }));
        activeLoopbacks.push(cap);
        return { success: true, mode: 'exclude', pid: targetPid };
      } else {
        console.warn(`[Desktop Main] PID do aplicativo desmarcado (${targetApp.name || targetApp.processName}) não encontrado ou inativo (PID ${targetPid}).`);
      }
    }

    // Modo seletivo com múltiplos aplicativos desmarcados:
    // Captura exclusivamente os aplicativos marcados (INCLUDE mode) para garantir que NENHUM desmarcado vaze
    const activeEnabled = enabledApps.length > 0
      ? enabledApps
      : (Array.isArray(cachedMixerApps)
          ? cachedMixerApps.filter(a => !disabledApps.some(d => d.id === a.id || (d.processName && a.processName && d.processName.toLowerCase() === a.processName.toLowerCase())))
          : []);

    if (activeEnabled.length > 0) {
      console.log(`[Desktop Main] Capturando exclusivamente ${activeEnabled.length} aplicativos marcados (include mode):`);
      let startedCount = 0;
      for (let idx = 0; idx < activeEnabled.length; idx++) {
        const app = activeEnabled[idx];
        const liveInfo = findLivePidsForApp(app);
        const targetPid = liveInfo.rootPid || app.rootPid || app.pid;
        if (targetPid && targetPid > 0 && isPidAlive(targetPid)) {
          try {
            console.log(`  -> Incluindo: ${app.name || app.processName} (PID ${targetPid}, Stream ${idx})`);
            const cap = new LoopbackCapture();
            const streamId = idx;
            cap.start(targetPid, true, (buf) => onChunk({ streamId, chunk: buf }));
            activeLoopbacks.push(cap);
            startedCount++;
          } catch (appErr) {
            console.warn(`  [!] Falha ao incluir PID ${targetPid}:`, appErr.message);
          }
        }
      }

      if (startedCount > 0) {
        return { success: true, mode: 'include_multiple', count: startedCount };
      }
    }

    // Fallback: se nenhum marcado estava ativo ou detectado, tenta excluir o primeiro desmarcado
    if (disabledApps.length > 0) {
      const targetApp = disabledApps[0];
      const liveInfo = findLivePidsForApp(targetApp);
      const targetPid = liveInfo.rootPid || targetApp.rootPid || targetApp.pid;
      if (targetPid && targetPid > 0 && isPidAlive(targetPid)) {
        console.log(`[Desktop Main] Fallback: excluindo primeiro aplicativo ${targetApp.name || targetApp.processName} (PID ${targetPid})`);
        const cap = new LoopbackCapture();
        cap.start(targetPid, false, (buf) => onChunk({ streamId: 0, chunk: buf }));
        activeLoopbacks.push(cap);
        return { success: true, mode: 'exclude_fallback', pid: targetPid };
      }
    }

    // Se todos os aplicativos forem desmarcados pelo usuário ou nenhum estiver ativo, silencia o loopback
    console.log('[Desktop Main] Todos os aplicativos de áudio desmarcados ou inativos: áudio do sistema silenciado.');
    return { success: true, mode: 'muted_all' };
  } catch (err) {
    console.error('[Desktop Main] Falha ao iniciar LoopbackCapture:', err);
    try {
      const fallback = new LoopbackCapture();
      fallback.startSystemAudio((buf) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('desktop:audio-pcm-chunk', { streamId: 0, chunk: buf });
        }
      });
      activeLoopbacks.push(fallback);
      return { success: true, mode: 'fallback_system' };
    } catch (fbErr) {
      console.error('[Desktop Main] Fallback de LoopbackCapture também falhou:', fbErr);
      return { success: false, error: err.message };
    }
  }
});

// IPC: Interrompe captura nativa de áudio do sistema
ipcMain.handle('desktop:stop-loopback-capture', async () => {
  try {
    stopAllActiveLoopbacks();
    console.log('[Desktop Main] Loopbacks nativos encerrados.');
    return { success: true };
  } catch (err) {
    console.warn('[Desktop Main] Erro ao encerrar LoopbackCapture:', err.message);
    activeLoopbacks = [];
    return { success: false, error: err.message };
  }
});

// ========================================================
// SISTEMA DE ATUALIZAÇÕES AUTOMÁTICAS IN-APP (GITHUB RELEASES)
// ========================================================
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'http:' ? http : https;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Hyperstream-Desktop-App',
        'Accept': 'application/vnd.github.v3+json, application/json, */*'
      }
    };
    client.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(new URL(res.headers.location, url).href));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'http:' ? http : https;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Hyperstream-Desktop-App',
        'Accept': 'text/plain, */*'
      }
    };
    client.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(new URL(res.headers.location, url).href));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let redirectsCount = 0;
    const maxRedirects = 6;

    const doDownload = (targetUrl) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch (err) {
        return reject(new Error(`URL inválida para download: ${targetUrl}`));
      }

      const client = parsedUrl.protocol === 'http:' ? http : https;
      const req = client.get(targetUrl, {
        headers: {
          'User-Agent': 'Hyperstream-Desktop-App',
          'Accept': 'application/octet-stream, */*'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectsCount++;
          if (redirectsCount > maxRedirects) {
            return reject(new Error('Muitos redirecionamentos durante o download da atualização.'));
          }
          const nextUrl = new URL(res.headers.location, targetUrl).href;
          res.resume();
          return doDownload(nextUrl);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Falha no download da atualização: HTTP ${res.statusCode} ${res.statusMessage || ''}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        res.on('data', chunk => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            onProgress({ percent, downloaded: downloadedBytes, total: totalBytes, status: 'downloading' });
          }
        });

        res.on('error', (err) => {
          fileStream.destroy();
          fs.unlink(destPath, () => {});
          reject(err);
        });

        fileStream.on('error', (err) => {
          fileStream.destroy();
          fs.unlink(destPath, () => {});
          reject(err);
        });

        fileStream.on('finish', () => {
          fileStream.close(() => resolve());
        });

        res.pipe(fileStream);
      });

      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });

      req.setTimeout(60000, () => {
        req.destroy();
        fs.unlink(destPath, () => {});
        reject(new Error('Tempo limite de download esgotado (60s).'));
      });
    };

    doDownload(url);
  });
}

// IPC: Obter informações detalhadas de versão e metadados de build do Desktop
ipcMain.handle('desktop:get-version-info', () => {
  let meta = {
    version: app.getVersion(),
    protocolVersion: 2,
    minClientProtocolVersion: 2,
    gitCommit: 'a186ed0',
    buildDate: new Date().toISOString()
  };
  try {
    const vPath = path.resolve(__dirname, '../version.json');
    if (fs.existsSync(vPath)) {
      meta = { ...meta, ...JSON.parse(fs.readFileSync(vPath, 'utf8')) };
    }
  } catch (_) {}

  // Em modo de desenvolvimento, tenta inspecionar commit ativo do git
  if (!app.isPackaged) {
    try {
      meta.gitCommit = execSync('git rev-parse --short HEAD', { cwd: path.resolve(__dirname, '../..') }).toString().trim();
    } catch (_) {}
  }

  return {
    ...meta,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    isPackaged: app.isPackaged
  };
});

// IPC: Verificar se há nova versão no GitHub Releases
ipcMain.handle('desktop:check-for-updates', async () => {
  try {
    const currentVersion = app.getVersion();
    const repo = process.env.HYPERSTREAM_GITHUB_REPO || 'AdriamSouza/webrtc';
    const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
    const latestTag = release.tag_name || release.name || '';
    const latestVersion = latestTag.replace(/^v/i, '');
    const hasUpdate = isNewerVersion(currentVersion, latestVersion);
    const asset = (release.assets || []).find(a => a.name && a.name.endsWith('.zip'));

    return {
      success: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseName: release.name,
      releaseNotes: release.body,
      publishedAt: release.published_at,
      downloadUrl: asset ? asset.browser_download_url : release.html_url,
      assetSize: asset ? asset.size : 0
    };
  } catch (err) {
    console.warn('[Desktop Main] Erro ao verificar atualizações:', err.message);
    return { success: false, error: err.message, currentVersion: app.getVersion() };
  }
});

// IPC: Baixar e aplicar atualização de forma 100% autônoma, validada por SHA-256 e com rollback
ipcMain.handle('desktop:download-and-install-update', async () => {
  try {
    const repo = process.env.HYPERSTREAM_GITHUB_REPO || 'AdriamSouza/webrtc';
    const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
    const asset = (release.assets || []).find(a => a.name && a.name.endsWith('.zip'));
    if (!asset) {
      throw new Error('Nenhum pacote zip de atualização encontrado na release do GitHub.');
    }

    // 1. Localiza metadados confiáveis de SHA-256 (latest.json, .sha256 ou digest do asset)
    let latestJson = null;
    let sha256Text = null;

    const latestJsonAsset = (release.assets || []).find(a => a.name === 'latest.json');
    if (latestJsonAsset && latestJsonAsset.browser_download_url) {
      try {
        console.log('[Desktop Updater] Baixando manifesto latest.json para verificação de integridade...');
        latestJson = await fetchJson(latestJsonAsset.browser_download_url);
      } catch (err) {
        console.warn('[Desktop Updater] Não foi possível obter latest.json:', err.message);
      }
    }

    const sha256Asset = (release.assets || []).find(a => a.name && a.name.endsWith('.sha256'));
    if (sha256Asset && sha256Asset.browser_download_url) {
      try {
        console.log('[Desktop Updater] Baixando checksum .sha256 para verificação de integridade...');
        sha256Text = await fetchText(sha256Asset.browser_download_url);
      } catch (err) {
        console.warn('[Desktop Updater] Não foi possível obter arquivo .sha256:', err.message);
      }
    }

    const expectedSha256 = extractExpectedSha256({ release, latestJson, sha256Text });
    console.log('[Desktop Updater] Hash SHA-256 esperado:', expectedSha256 || '(nenhum encontrado nos assets)');

    const tempDir = app.getPath('temp');
    const updateId = Date.now();
    const zipPath = path.join(tempDir, `hyperstream-update-${updateId}.zip`);
    const extractDir = path.join(tempDir, `hyperstream-update-${updateId}`);
    const backupDir = path.join(tempDir, `hyperstream-backup-${updateId}`);
    const psScriptPath = path.join(tempDir, `apply_hyperstream_update_${updateId}.ps1`);
    const logPath = path.join(tempDir, 'hyperstream-updater.log');

    // 2. Download seguro do pacote com monitoramento de progresso
    console.log('[Desktop Updater] Baixando atualização de:', asset.browser_download_url);
    await downloadFile(asset.browser_download_url, zipPath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:update-progress', progress);
      }
    });

    // 3. Validação estrita de integridade via SHA-256
    console.log('[Desktop Updater] Validando integridade do pacote baixado via SHA-256...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:update-progress', { percent: 100, status: 'verifying' });
    }

    try {
      const integrityResult = await verifyPackageIntegrity(zipPath, expectedSha256, {
        allowMissing: false // Não permite instalar se hash não puder ser validado
      });
      console.log('[Desktop Updater] Integridade confirmada com sucesso! SHA256:', integrityResult.actualSha256);
    } catch (integrityErr) {
      // Limpa arquivo baixado corrompido ou adulterado
      try { fs.unlinkSync(zipPath); } catch (_) {}
      console.error('[Desktop Updater] Falha na validação de integridade:', integrityErr.message);
      throw integrityErr;
    }

    // 4. Descompactação do pacote em diretório temporário isolado
    console.log('[Desktop Updater] Descompactando arquivos...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:update-progress', { percent: 100, status: 'extracting' });
    }

    fs.mkdirSync(extractDir, { recursive: true });

    await new Promise((resolve, reject) => {
      const cmd = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force"`;
      exec(cmd, { windowsHide: true }, (err) => {
        if (err) return reject(new Error(`Falha ao descompactar atualização: ${err.message}`));
        resolve();
      });
    });

    console.log('[Desktop Updater] Arquivos descompactados. Localizando executável Hyperstream.exe...');

    const findExeInDir = (dir) => {
      if (fs.existsSync(path.join(dir, 'Hyperstream.exe'))) return dir;
      const subs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const s of subs) {
        const found = findExeInDir(path.join(dir, s.name));
        if (found) return found;
      }
      return null;
    };

    const foundSourceDir = findExeInDir(extractDir);
    if (!foundSourceDir) {
      throw new Error('Executável Hyperstream.exe não foi localizado dentro do pacote de atualização descompactado.');
    }
    const sourceFolder = foundSourceDir;

    const currentExePath = process.execPath;
    const currentAppDir = path.dirname(currentExePath);
    const isPackaged = app.isPackaged;

    if (!isPackaged) {
      try {
        fs.unlinkSync(zipPath);
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch (_) {}
      return {
        success: true,
        devMode: true,
        message: 'Atualização baixada e validada com sucesso! Em modo de desenvolvimento, os arquivos do executável não são substituídos automaticamente.'
      };
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:update-progress', { percent: 100, status: 'installing' });
    }

    // 5. Gera script de atualização autônomo com backup prévio e rollback automático
    const psContent = generatePowerShellUpdaterScript({
      mainPid: process.pid,
      targetDir: currentAppDir,
      sourceDir: sourceFolder,
      exePath: currentExePath,
      zipPath,
      extractDir,
      logPath,
      scriptPath: psScriptPath,
      backupDir
    });

    fs.writeFileSync(psScriptPath, psContent, 'utf8');

    console.log('[Desktop Updater] Disparando script de atualização invisível via PowerShell com rollback ativo...');
    const updaterProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', psScriptPath
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    updaterProcess.unref();

    // Encerra a instância antiga do app de forma controlada após breve intervalo
    setTimeout(() => {
      app.exit(0);
    }, 300);

    return { success: true, restarting: true };
  } catch (err) {
    console.error('[Desktop Updater] Erro durante o processo de atualização:', err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  // Permissões de mídia automáticas para áudio, microfone e captura de tela no Electron
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'display-capture', 'audio-capture', 'notifications', 'fullscreen', 'pointerLock'];
    if (allowed.includes(permission)) {
      return callback(true);
    }
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });

  // Manipulador nativo de captura para getDisplayMedia no Electron
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      let chosen = null;

      // Prioriza a fonte previamente selecionada pelo usuário no cache já carregado
      if (selectedSourceId && selectedSourceId !== 'default' && Array.isArray(cachedCapturerSources) && cachedCapturerSources.length > 0) {
        chosen = cachedCapturerSources.find(s => s.id === selectedSourceId);
      }

      // Se não encontrou no cache, busca as fontes rapidamente com thumbnail 1x1
      if (!chosen) {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 1, height: 1 }
        });
        cachedCapturerSources = sources;

        if (selectedSourceId && selectedSourceId !== 'default') {
          chosen = sources.find(s => s.id === selectedSourceId);
        }
        if (!chosen) {
          chosen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
        }
      }

      // Limpa a seleção para que próximas transmissões não fiquem presas em janelas antigas
      selectedSourceId = null;

      if (chosen) {
        console.log('[Desktop Main] Transmitindo fonte:', chosen.name, 'id:', chosen.id);
        const streamOpts = { video: chosen };
        if (captureAudioEnabled && request.audioRequested === true) {
          streamOpts.audio = 'loopback';
          console.log('[Desktop Main] Loopback de áudio do sistema ativado na captura.');
        } else {
          console.log('[Desktop Main] Captura sem loopback geral do Chromium (isolamento de processo ativo ou sem áudio).');
        }
        callback(streamOpts);
      } else {
        console.warn('[Desktop Main] Nenhuma fonte disponível para captura de tela.');
        callback(null);
      }
    } catch (err) {
      console.error('[Desktop Main] Erro ao selecionar fonte de captura:', err);
      callback(null);
    }
  });

  await startLocalFrontendServer();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (mixerQueryTimer) {
    clearTimeout(mixerQueryTimer);
    mixerQueryTimer = null;
  }
  if (localFrontendServer) {
    try { localFrontendServer.close(); } catch (_) {}
    localFrontendServer = null;
  }
  stopAllActiveLoopbacks();
  if (activeScreenWorkerProcess && !activeScreenWorkerProcess.killed) {
    try { activeScreenWorkerProcess.kill(); } catch (_) {}
    activeScreenWorkerProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
