const { contextBridge, ipcRenderer } = require('electron');

// Expõe APIs seguras para a interface Web do aplicativo
contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  wgcEnabled: true,

  // Captura de fontes nativas (janelas de jogos ou telas inteiras)
  getSources: (opts) => ipcRenderer.invoke('desktop:get-sources', opts),

  // Abertura de links externos de forma segura
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url)
});

console.log('[Desktop Preload] desktopAPI injetada com sucesso no renderer.');
