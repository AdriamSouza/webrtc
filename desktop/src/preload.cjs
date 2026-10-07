const { contextBridge, ipcRenderer } = require('electron');

// Expõe APIs seguras para a interface Web do aplicativo
contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  wgcEnabled: true,

  // Versão do aplicativo
  getVersion: () => ipcRenderer.invoke('desktop:get-version'),

  // Captura de fontes nativas (janelas de jogos ou telas inteiras com thumbnails)
  getSources: (opts) => ipcRenderer.invoke('desktop:get-sources', opts),

  // Seleciona a fonte específica que o usuário escolheu no modal
  setSelectedSource: (sourceId) => ipcRenderer.invoke('desktop:set-selected-source', sourceId),

  // Configuração de áudio do sistema (loopback) durante a captura
  setCaptureAudio: (enabled) => ipcRenderer.invoke('desktop:set-capture-audio', enabled),
  getCaptureAudio: () => ipcRenderer.invoke('desktop:get-capture-audio'),
  getAudioApplications: () => ipcRenderer.invoke('desktop:get-audio-apps'),

  // Captura seletiva de áudio nativo por processo / WASAPI Loopback
  startLoopbackCapture: (opts) => ipcRenderer.invoke('desktop:start-loopback-capture', opts),
  stopLoopbackCapture: () => ipcRenderer.invoke('desktop:stop-loopback-capture'),
  onAudioPcmChunk: (callback) => {
    const listener = (event, chunk) => callback(chunk);
    ipcRenderer.on('desktop:audio-pcm-chunk', listener);
    return () => ipcRenderer.removeListener('desktop:audio-pcm-chunk', listener);
  },

  // Sistema de Atualizações Automáticas no App
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('desktop:download-and-install-update'),
  onUpdateProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('desktop:update-progress', listener);
    return () => ipcRenderer.removeListener('desktop:update-progress', listener);
  },

  // Obter ou alterar a URL do servidor (Localhost ou Render)
  getServerUrl: () => ipcRenderer.invoke('desktop:get-server-url'),
  setServerUrl: (url) => ipcRenderer.invoke('desktop:set-server-url', url),
  reloadApp: () => ipcRenderer.invoke('desktop:reload-app'),

  // Abertura de links externos no navegador padrão de forma segura
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url)
});

console.log('[Desktop Preload] desktopAPI estendida com suporte a atualizações e controle de áudio.');
