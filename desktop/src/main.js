import { app, BrowserWindow, ipcMain, desktopCapturer, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================================
// FLAGS CHROMIUM DE ULTRA-PERFORMANCE (WGC + GPU ACCELERATION)
// ========================================================
// Habilita captura direta via Windows Graphics Capture API (DirectX / Vulkan / Jogos em Tela Cheia)
app.commandLine.appendSwitch('enable-features', 'WindowsGraphicsCapture');
// Pipeline acelerado por GPU: rasterização e overlays diretos na GPU
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,underlays');
// Mantém execução fluida e timers ativos em segundo plano sem desativar VSync ou sobrecarregar GPU/CPU
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Ignora certificados autoassinados em conexões locais (HTTPS e WebSockets WSS)
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');

// Ignora erros de certificado SSL autoassinado para localhost durante o desenvolvimento (HTTPS e WSS)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

// Arquivo de configuração persistente para guardar a URL do servidor (Localhost ou Render)
const configFilePath = path.join(app.getPath('userData'), 'hyperstream-config.json');

function loadSavedServerUrl() {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
      if (data && data.serverUrl) return data.serverUrl;
    }
  } catch (e) {
    console.warn('[Desktop Main] Erro ao ler hyperstream-config.json:', e.message);
  }
  return null;
}

function saveServerUrl(url) {
  try {
    fs.writeFileSync(configFilePath, JSON.stringify({ serverUrl: url }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Desktop Main] Erro ao salvar hyperstream-config.json:', e.message);
  }
}

let mainWindow = null;
let selectedSourceId = null;

const RENDER_DEFAULT_URL = 'https://hyperstream-g9gz.onrender.com';

function getInitialUrl() {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  const saved = loadSavedServerUrl();
  if (saved) {
    return saved;
  }
  // Padrão oficial de produção: Render
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

function createWindow() {
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

  const targetUrl = getInitialUrl();
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
  selectedSourceId = sourceId;
  console.log('[Desktop Main] Fonte de captura definida para:', sourceId);
  return true;
});

// IPC: Obter / Definir URL do servidor
ipcMain.handle('desktop:get-server-url', () => {
  return getInitialUrl();
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

// IPC: Recarregar aplicação
ipcMain.handle('desktop:reload-app', () => {
  if (mainWindow) {
    const target = getInitialUrl();
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

app.whenReady().then(() => {
  // Manipulador nativo de captura para getDisplayMedia no Electron
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      let chosen = sources[0];

      if (selectedSourceId) {
        const found = sources.find(s => s.id === selectedSourceId);
        if (found) {
          chosen = found;
          console.log('[Desktop Main] Usando fonte selecionada pelo usuário:', chosen.name);
        }
        selectedSourceId = null; // Limpa após uso
      } else {
        console.log('[Desktop Main] Nenhuma fonte pré-selecionada, usando padrão:', chosen?.name);
      }

      if (chosen) {
        callback({ video: chosen, audio: 'loopback' });
      } else {
        callback(null);
      }
    } catch (err) {
      console.error('[Desktop Main] Erro ao selecionar fonte de captura:', err);
      callback(null);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
