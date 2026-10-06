import { app, BrowserWindow, ipcMain, desktopCapturer, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { spawn, exec } from 'node:child_process';
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
let captureAudioEnabled = false;
let cachedCapturerSources = [];

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

// IPC: Obter versão instalada do aplicativo Desktop
ipcMain.handle('desktop:get-version', () => {
  return app.getVersion();
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

// IPC: Obter aplicativos e janelas abertas no sistema para seleção no mixer de áudio
ipcMain.handle('desktop:get-audio-apps', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      fetchWindowIcons: true,
      thumbnailSize: { width: 64, height: 64 }
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      hasAudio: true
    }));
  } catch (err) {
    console.warn('[Desktop Main] Erro ao obter lista de aplicativos de áudio:', err.message);
    return [];
  }
});

// ========================================================
// SISTEMA DE ATUALIZAÇÕES AUTOMÁTICAS IN-APP (GITHUB RELEASES)
// ========================================================
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Hyperstream-Desktop-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    https.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location));
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

function isNewerVersion(current, latest) {
  const parseVer = (v) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const c = parseVer(current);
  const l = parseVer(latest);
  for (let i = 0; i < 3; i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return https.get(res.headers.location, handleResponse).on('error', reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Falha no download: HTTP ${res.statusCode}`));
      }
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;

      res.on('data', chunk => {
        downloadedBytes += chunk.length;
        if (onProgress && totalBytes > 0) {
          const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          onProgress({ percent, downloaded: downloadedBytes, total: totalBytes });
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
    };

    https.get(url, { headers: { 'User-Agent': 'Hyperstream-Desktop-App' } }, handleResponse).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// IPC: Verificar se há nova versão no GitHub Releases
ipcMain.handle('desktop:check-for-updates', async () => {
  try {
    const currentVersion = app.getVersion();
    const release = await fetchJson('https://api.github.com/repos/AdriamSouza/webrtc/releases/latest');
    const latestTag = release.tag_name || release.name || '';
    const latestVersion = latestTag.replace(/^v/i, '');
    const hasUpdate = isNewerVersion(currentVersion, latestVersion);
    const asset = (release.assets || []).find(a => a.name.endsWith('.zip'));

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

// IPC: Baixar e aplicar atualização sem necessidade de download manual
ipcMain.handle('desktop:download-and-install-update', async () => {
  try {
    const release = await fetchJson('https://api.github.com/repos/AdriamSouza/webrtc/releases/latest');
    const asset = (release.assets || []).find(a => a.name.endsWith('.zip'));
    if (!asset) {
      throw new Error('Nenhum pacote zip de atualização encontrado na release.');
    }

    const tempDir = app.getPath('temp');
    const updateId = Date.now();
    const zipPath = path.join(tempDir, `hyperstream-update-${updateId}.zip`);
    const extractDir = path.join(tempDir, `hyperstream-update-${updateId}`);

    console.log('[Desktop Updater] Baixando atualização de:', asset.browser_download_url);
    await downloadFile(asset.browser_download_url, zipPath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:update-progress', progress);
      }
    });

    console.log('[Desktop Updater] Download concluído. Descompactando...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:update-progress', { percent: 100, status: 'extracting' });
    }

    // Cria diretório temporário exclusivo para esta tentativa de update (evita colisões e erros de ENOTEMPTY)
    fs.mkdirSync(extractDir, { recursive: true });

    // Tenta limpar diretórios de updates antigos de forma tolerante a falhas (não bloqueante)
    try {
      const oldStatic = path.join(tempDir, 'hyperstream-update-extracted');
      if (fs.existsSync(oldStatic)) {
        fs.rmSync(oldStatic, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      }
    } catch (_) {}

    // Extrai usando PowerShell Expand-Archive nativo do Windows
    await new Promise((resolve, reject) => {
      const cmd = `powershell.exe -NoProfile -NonInteractive -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force"`;
      exec(cmd, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    console.log('[Desktop Updater] Arquivos descompactados. Preparando reinicialização...');

    // Localiza a pasta contendo Hyperstream.exe descompactada
    let sourceFolder = extractDir;
    const subfolders = fs.readdirSync(extractDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const sub of subfolders) {
      if (fs.existsSync(path.join(extractDir, sub.name, 'Hyperstream.exe'))) {
        sourceFolder = path.join(extractDir, sub.name);
        break;
      }
    }

    const currentAppDir = path.dirname(process.execPath);
    const isPackaged = app.isPackaged;

    if (!isPackaged) {
      return {
        success: true,
        devMode: true,
        message: 'Atualização baixada com sucesso! Em modo de desenvolvimento, os arquivos do executável não são substituídos automaticamente.'
      };
    }

    // Cria script batch para aguardar encerramento do processo, substituir os binários e reiniciar
    const batPath = path.join(tempDir, `apply_hyperstream_update_${updateId}.bat`);
    const batContent = `@echo off
chcp 65001 > nul
set "PID=${process.pid}"
set "TARGET_DIR=${currentAppDir}"
set "SOURCE_DIR=${sourceFolder}"
set "EXE_PATH=${path.join(currentAppDir, 'Hyperstream.exe')}"

:: Aguarda até que o processo do Hyperstream seja totalmente encerrado pelo Windows
:wait_loop
tasklist /fi "PID eq %PID%" 2>nul | find "%PID%" >nul
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)

:: Pausa extra para garantir a liberação total de todos os arquivos (.dll, .asar)
timeout /t 1 /nobreak >nul

:: Copia todos os arquivos novos com robocopy tolerante a tentativas
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /E /IS /IT /NP /R:3 /W:1 >nul

:: Fallback com xcopy caso robocopy retorne erro fatal
if errorlevel 8 (
    xcopy /s /y /e /h "%SOURCE_DIR%\\*" "%TARGET_DIR%\\" >nul
)

:: Inicia o executável atualizado
start "" "%EXE_PATH%"
exit
`;
    fs.writeFileSync(batPath, batContent, 'utf8');

    // Executa o script desacoplado do processo do Electron e finaliza o app
    const updaterProcess = spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore'
    });
    updaterProcess.unref();

    setTimeout(() => {
      app.quit();
    }, 500);

    return { success: true, restarting: true };
  } catch (err) {
    console.error('[Desktop Updater] Erro durante o processo de atualização:', err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
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
        if (captureAudioEnabled && request.audioRequested) {
          streamOpts.audio = 'loopback';
          console.log('[Desktop Main] Loopback de áudio do sistema ativado na captura.');
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
