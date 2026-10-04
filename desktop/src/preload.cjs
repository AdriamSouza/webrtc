const { contextBridge, ipcRenderer } = require('electron');

// Expõe APIs seguras para a interface Web do aplicativo
contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  wgcEnabled: true,

  // Captura de fontes nativas (janelas de jogos ou telas inteiras com thumbnails)
  getSources: (opts) => ipcRenderer.invoke('desktop:get-sources', opts),

  // Seleciona a fonte específica que o usuário escolheu no modal
  setSelectedSource: (sourceId) => ipcRenderer.invoke('desktop:set-selected-source', sourceId),

  // Obter ou alterar a URL do servidor (Localhost ou Render)
  getServerUrl: () => ipcRenderer.invoke('desktop:get-server-url'),
  setServerUrl: (url) => ipcRenderer.invoke('desktop:set-server-url', url),
  reloadApp: () => ipcRenderer.invoke('desktop:reload-app'),

  // Abertura de links externos no navegador padrão de forma segura
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url)
});

console.log('[Desktop Preload] desktopAPI estendida com suporte WGC injetada no renderer.');
