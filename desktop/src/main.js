import { app, BrowserWindow, ipcMain, desktopCapturer, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================================
// FLAGS CHROMIUM DE ULTRA-PERFORMANCE (WGC + ZERO-COPY GPU DIRECT)
// ========================================================
// Habilita captura direta via Windows Graphics Capture API (DirectX / Vulkan / Jogos em Tela Cheia Exclusiva)
app.commandLine.appendSwitch('enable-features', 'WindowsGraphicsCapture,ZeroCopyDxgiVideo,WebRtcHideLocalIpsWithMdns');
// Pipeline Zero-Copy: textura de vídeo permanece na VRAM da GPU sem cópias intermediárias na CPU
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,underlays');
// Remove limites de FPS e desativa throttling quando a janela do app estiver em segundo plano durante o jogo
app.commandLine.appendSwitch('disable-frame-rate-limit');
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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0e14',
    title: 'HyperStream (Desktop - WGC 60 FPS)',
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

  const targetUrl = process.env.APP_URL || 'https://localhost:3000';
  mainWindow.loadURL(targetUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  console.log('[Desktop Main] Janela principal iniciada apontando para:', targetUrl);
}

// IPC: Retorna lista de telas e janelas ativas para seleção de captura nativa
ipcMain.handle('desktop:get-sources', async (event, opts = {}) => {
  try {
    const types = opts.types || ['screen', 'window'];
    const thumbnailWidth = opts.thumbnailWidth || 320;
    const thumbnailHeight = opts.thumbnailHeight || 180;

    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
      fetchWindowIcons: true
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }));
  } catch (err) {
    console.error('[Desktop Main] Erro ao obter fontes:', err);
    return [];
  }
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
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
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
