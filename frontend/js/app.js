import { SignalingClient } from './signaling.js';
import { MediaManager } from './media.js';
import { WebRTCManager } from './webrtc.js';
import { QualityController } from './qualityController.js';
import { RoomState } from './room.js';

// Instanciação dos Módulos Centrais
const signaling = new SignalingClient();
const media = new MediaManager();
const webrtc = new WebRTCManager(signaling);
webrtc.setMediaManager(media);
const qualityController = new QualityController();
const roomState = new RoomState();

// Elementos do DOM - Lobby
const lobbyScreen = document.getElementById('lobbyScreen');
const roomScreen = document.getElementById('roomScreen');
const tabBtnCreate = document.getElementById('tabBtnCreate');
const tabBtnJoin = document.getElementById('tabBtnJoin');
const createRoomForm = document.getElementById('createRoomForm');
const joinRoomForm = document.getElementById('joinRoomForm');
const createUsernameInput = document.getElementById('createUsernameInput');
const createRoomIdInput = document.getElementById('createRoomIdInput');
const btnRandomRoom = document.getElementById('btnRandomRoom');
const createPasswordInput = document.getElementById('createPasswordInput');
const btnSubmitCreate = document.getElementById('btnSubmitCreate');
const joinUsernameInput = document.getElementById('joinUsernameInput');
const joinRoomIdInput = document.getElementById('joinRoomIdInput');
const joinPasswordInput = document.getElementById('joinPasswordInput');
const btnSubmitJoin = document.getElementById('btnSubmitJoin');
const lobbyAlert = document.getElementById('lobbyAlert');

// Elementos do DOM - Sala
const displayRoomId = document.getElementById('displayRoomId');
const btnCopyLink = document.getElementById('btnCopyLink');
const roleBadge = document.getElementById('roleBadge');
const roomLockBadge = document.getElementById('roomLockBadge');
const connectionBadge = document.getElementById('connectionBadge');
const userCountBadge = document.getElementById('userCountBadge');
const desktopAppBadge = document.getElementById('desktopAppBadge');
const btnToggleHud = document.getElementById('btnToggleHud');
const telemetryHud = document.getElementById('telemetryHud');

// Elementos do DOM - Seletor de Layouts & Painel Lateral
const layoutSelectorGroup = document.getElementById('layoutSelectorGroup');
const btnLayoutGrid = document.getElementById('btnLayoutGrid');
const btnLayoutStage = document.getElementById('btnLayoutStage');
const btnLayoutTheater = document.getElementById('btnLayoutTheater');
const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const sidebarBtnLabel = document.getElementById('sidebarBtnLabel');
const roomBody = document.getElementById('roomBody');

// Elementos do DOM - Grid Dinâmico & Palco de Transmissões
const videoWrapper = document.getElementById('videoWrapper');
const videoGrid = document.getElementById('videoGrid');
const unmuteBanner = document.getElementById('unmuteBanner');
const streamPlaceholder = document.getElementById('streamPlaceholder');
const placeholderNotice = document.getElementById('placeholderNotice');
const btnPromptShare = document.getElementById('btnPromptShare');
const btnPromptCamera = document.getElementById('btnPromptCamera');

// Elementos do DOM - Dock Flutuante de Prévia Local (Self-View)
const localDock = document.getElementById('localDock');
const localDockContent = document.getElementById('localDockContent');
const btnMinimizeDock = document.getElementById('btnMinimizeDock');
const localDockPill = document.getElementById('localDockPill');
const localDockPillLabel = document.getElementById('localDockPillLabel');

// Elementos do DOM - Controles da Toolbar
const btnShareScreen = document.getElementById('btnShareScreen');
const btnToggleCamera = document.getElementById('btnToggleCamera');
const cameraIcon = document.getElementById('cameraIcon');
const cameraLabel = document.getElementById('cameraLabel');
const btnToggleAudio = document.getElementById('btnToggleAudio');
const micIcon = document.getElementById('micIcon');
const micLabel = document.getElementById('micLabel');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnLeaveRoom = document.getElementById('btnLeaveRoom');

// Elementos do DOM - Sidebar (Chat & Participantes)
const sidebarTabs = document.querySelectorAll('.sidebar-tabs .tab-btn');
const tabChat = document.getElementById('tabChat');
const tabParticipants = document.getElementById('tabParticipants');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const participantsList = document.getElementById('participantsList');
const tabUserCount = document.getElementById('tabUserCount');

// Elementos do DOM - HUD Telemetria
const hudFps = document.getElementById('hudFps');
const hudResolution = document.getElementById('hudResolution');
const hudRtt = document.getElementById('hudRtt');
const hudBitrate = document.getElementById('hudBitrate');
const hudPacketLoss = document.getElementById('hudPacketLoss');
const hudCodec = document.getElementById('hudCodec');

// ========================================================
// GERENCIADOR DO GRID DINÂMICO DE TRANSMISSÕES (MULTI-STREAM)
// ========================================================
const activeTiles = new Map(); // Map<tileId, { tileEl, videoEl, stream, type, isLocal }>
const remoteUserMedia = new Map(); // Map<userId, { screen: boolean, camera: boolean }>
const localPreviews = new Map(); // Map<type ('camera'|'screen'), { cardEl, videoEl, stream, isHidden, isPinned }>
let currentSpotlightId = null;
let isDockMinimized = false;
let currentAttemptedPin = null;
let isConnecting = false;

// Estado de Layout (Sincronizado entre Web e Desktop)
let currentLayoutMode = (() => {
  try { return localStorage.getItem('webrtc_layout_mode') || 'grid'; } catch (_) { return 'grid'; }
})();
let isSidebarCollapsed = (() => {
  try { return localStorage.getItem('webrtc_sidebar_collapsed') === 'true'; } catch (_) { return false; }
})();

/**
 * Define o modo de layout ativo: 'grid' (Mosaico), 'stage' (Palco) ou 'theater' (Teatro)
 */
function setLayoutMode(mode) {
  currentLayoutMode = mode;
  try { localStorage.setItem('webrtc_layout_mode', mode); } catch (_) {}

  // Atualiza estado visual dos botões de controle de layout
  if (btnLayoutGrid) btnLayoutGrid.classList.toggle('active', mode === 'grid');
  if (btnLayoutStage) btnLayoutStage.classList.toggle('active', mode === 'stage');
  if (btnLayoutTheater) btnLayoutTheater.classList.toggle('active', mode === 'theater');

  if (roomBody) {
    roomBody.dataset.layout = mode;
    // No modo teatro, a barra lateral fica recolhida para foco máximo
    if (mode === 'theater') {
      roomBody.classList.add('sidebar-collapsed');
    } else {
      roomBody.classList.toggle('sidebar-collapsed', isSidebarCollapsed);
    }
  }

  if (mode === 'stage') {
    videoGrid.classList.add('stage-layout');
    ensureSpotlightSelected();
  } else {
    videoGrid.classList.remove('stage-layout');
    if (mode === 'grid') {
      clearSpotlight();
    }
  }

  updateGridLayout();
}

/**
 * Garante que haja um card no palco no modo Stage (prioriza tela compartilhada)
 */
function ensureSpotlightSelected() {
  if (activeTiles.size === 0) return;

  if (currentSpotlightId && activeTiles.has(currentSpotlightId)) {
    applySpotlightTile(currentSpotlightId);
    return;
  }

  let targetId = null;
  for (const [id, entry] of activeTiles.entries()) {
    if (entry.type === 'screen') {
      targetId = id;
      break;
    }
  }

  if (!targetId) {
    targetId = activeTiles.keys().next().value;
  }

  if (targetId) {
    applySpotlightTile(targetId);
  }
}

function applySpotlightTile(id) {
  currentSpotlightId = id;
  videoGrid.classList.add('spotlight-active');
  document.querySelectorAll('.stream-tile').forEach(t => {
    const isTarget = t.dataset.tileId === id;
    t.classList.toggle('is-spotlight', isTarget);
    const focusBtn = t.querySelector('.btn-focus');
    if (focusBtn) focusBtn.classList.toggle('active', isTarget);
  });
}

function clearSpotlight() {
  currentSpotlightId = null;
  videoGrid.classList.remove('spotlight-active');
  document.querySelectorAll('.stream-tile').forEach(t => {
    t.classList.remove('is-spotlight');
    const focusBtn = t.querySelector('.btn-focus');
    if (focusBtn) focusBtn.classList.remove('active');
  });
}

function toggleSidebar(forceState = null) {
  if (currentLayoutMode === 'theater') {
    setLayoutMode('grid');
    isSidebarCollapsed = false;
  } else if (forceState !== null) {
    isSidebarCollapsed = forceState;
  } else {
    isSidebarCollapsed = !isSidebarCollapsed;
  }

  try { localStorage.setItem('webrtc_sidebar_collapsed', isSidebarCollapsed ? 'true' : 'false'); } catch (_) {}

  if (roomBody) {
    roomBody.classList.toggle('sidebar-collapsed', isSidebarCollapsed);
  }

  if (sidebarBtnLabel) {
    sidebarBtnLabel.textContent = isSidebarCollapsed ? 'Abrir Chat' : 'Chat';
  }
  if (btnToggleSidebar) {
    btnToggleSidebar.classList.toggle('active', !isSidebarCollapsed);
  }
}

function showLobbyAlert(message, type = 'error') {
  if (!lobbyAlert) return;
  lobbyAlert.textContent = message;
  lobbyAlert.className = `lobby-alert ${type}`;
  lobbyAlert.classList.remove('hidden');
}

function hideLobbyAlert() {
  if (!lobbyAlert) return;
  lobbyAlert.classList.add('hidden');
  lobbyAlert.textContent = '';
}

function switchLobbyTab(tabName) {
  hideLobbyAlert();
  if (tabName === 'create') {
    if (tabBtnCreate) tabBtnCreate.classList.add('active');
    if (tabBtnJoin) tabBtnJoin.classList.remove('active');
    if (createRoomForm) createRoomForm.classList.add('active');
    if (joinRoomForm) joinRoomForm.classList.remove('active');
  } else {
    if (tabBtnJoin) tabBtnJoin.classList.add('active');
    if (tabBtnCreate) tabBtnCreate.classList.remove('active');
    if (joinRoomForm) joinRoomForm.classList.add('active');
    if (createRoomForm) createRoomForm.classList.remove('active');
  }
}

/**
 * Adiciona ou atualiza um card de transmissão remota (ou fixada local) no grid principal
 */
function addOrUpdateTile({ id, title, stream, isLocal = false, type = 'screen' }) {
  let entry = activeTiles.get(id);

  if (entry) {
    entry.stream = stream;
    if (entry.videoEl.srcObject !== stream) {
      entry.videoEl.srcObject = stream;
    }
    entry.videoEl.play().catch(e => console.warn('[App] Play tile:', e));
    return entry;
  }

  console.log(`[TileManager] Criando novo card no grid: ${id} (${type})`);

  const tileEl = document.createElement('div');
  tileEl.className = 'stream-tile';
  tileEl.id = `tile-${id}`;
  tileEl.dataset.tileId = id;

  const badgeClass = type === 'screen' ? 'badge-screen' : 'badge-camera';
  const badgeLabel = type === 'screen' ? '🖥️ Tela 60 FPS' : '📷 Câmera';

  const headerEl = document.createElement('div');
  headerEl.className = 'tile-header';
  headerEl.innerHTML = `
    <span class="tile-badge ${badgeClass}">${badgeLabel}</span>
    <span class="tile-title">${escapeHtml(title)}</span>
  `;

  const actionsEl = document.createElement('div');
  actionsEl.className = 'tile-actions';

  const btnFocus = document.createElement('button');
  btnFocus.className = 'tile-btn btn-focus';
  btnFocus.title = 'Focar transmissão (Spotlight)';
  btnFocus.innerHTML = '📌';
  btnFocus.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSpotlight(id);
  });

  const btnFull = document.createElement('button');
  btnFull.className = 'tile-btn btn-fullscreen';
  btnFull.title = 'Tela cheia deste vídeo';
  btnFull.innerHTML = '⛶';
  btnFull.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTileFullscreen(tileEl);
  });

  const btnMute = document.createElement('button');
  btnMute.className = 'tile-btn btn-mute';
  btnMute.title = 'Mutar / Desmutar áudio';
  btnMute.innerHTML = isLocal ? '🔇' : '🔊';
  btnMute.addEventListener('click', (e) => {
    e.stopPropagation();
    videoEl.muted = !videoEl.muted;
    btnMute.innerHTML = videoEl.muted ? '🔇' : '🔊';
  });

  const btnClose = document.createElement('button');
  btnClose.className = 'tile-btn btn-close';
  btnClose.title = 'Fechar / Ocultar';
  btnClose.innerHTML = '✕';
  btnClose.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isLocal) {
      if (type === 'screen') handleToggleScreenShare();
      if (type === 'camera') handleToggleCamera();
    } else {
      removeTile(id);
    }
  });

  actionsEl.appendChild(btnFocus);
  actionsEl.appendChild(btnFull);
  actionsEl.appendChild(btnMute);
  actionsEl.appendChild(btnClose);

  const videoEl = document.createElement('video');
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  if (isLocal) {
    videoEl.muted = true;
  }

  videoEl.srcObject = stream;

  tileEl.appendChild(headerEl);
  tileEl.appendChild(actionsEl);
  tileEl.appendChild(videoEl);
  videoGrid.appendChild(tileEl);

  // Ao clicar em uma miniatura secundária no modo Palco, promove ela para o palco principal
  tileEl.addEventListener('click', (e) => {
    if (e.target.closest('.tile-btn')) return;
    if (currentLayoutMode === 'stage' || videoGrid.classList.contains('stage-layout')) {
      if (currentSpotlightId !== id) {
        applySpotlightTile(id);
      }
    }
  });

  const playPromise = videoEl.play();
  if (playPromise !== undefined) {
    playPromise.catch((err) => {
      console.warn('[TileManager] Autoplay com som bloqueado, mutando...', err.message);
      videoEl.muted = true;
      btnMute.innerHTML = '🔇';
      videoEl.play().catch(e => console.error(e));
      if (unmuteBanner) unmuteBanner.classList.remove('hidden');
    });
  }

  entry = { tileEl, videoEl, stream, type, isLocal, title };
  activeTiles.set(id, entry);

  updateGridLayout();
  return entry;
}

/**
 * Remove um tile do grid e atualiza layout
 */
function removeTile(id) {
  const entry = activeTiles.get(id);
  if (!entry) return;

  if (entry.videoEl) {
    entry.videoEl.srcObject = null;
  }

  entry.tileEl.remove();
  activeTiles.delete(id);

  if (currentSpotlightId === id) {
    currentSpotlightId = null;
    if (currentLayoutMode === 'stage') {
      ensureSpotlightSelected();
    } else {
      videoGrid.classList.remove('spotlight-active');
    }
  }

  updateGridLayout();
}

  /**
 * Sincroniza dinamicamente as transmissões remotas de um usuário no grid
 * Garante que Tela e Câmera sejam exibidas em cards distintos e re-conectem instantaneamente
 */
function syncRemotePeerTiles(userId) {
  const participant = roomState.participants.get(userId);
  const participantName = participant ? participant.name : `Usuário ${userId.substring(0, 4)}`;
  const userMedia = remoteUserMedia.get(userId) || { screen: false, camera: false };

  console.log(`[App] syncRemotePeerTiles para ${participantName}: tela=${userMedia.screen}, camera=${userMedia.camera}`);

  // 1. Sincroniza Transmissão de Tela
  const screenTileId = `${userId}-screen`;
  if (userMedia.screen) {
    const screenStream = webrtc.getRemoteStreamForTile(userId, 'screen');
    const screenVideoTrack = webrtc.getRemoteVideoTrack(userId, 'screen');

    if (screenVideoTrack) {
      addOrUpdateTile({
        id: screenTileId,
        title: `${participantName} (Tela 60 FPS)`,
        stream: screenStream,
        isLocal: false,
        type: 'screen'
      });

      screenVideoTrack.onunmute = () => {
        console.log(`[App] Tela de ${participantName} pronta para reprodução (unmute)`);
        const tile = activeTiles.get(screenTileId);
        if (tile && tile.videoEl) {
          tile.videoEl.play().catch(e => console.warn(e));
        }
      };
    } else {
      setTimeout(() => syncRemotePeerTiles(userId), 300);
      setTimeout(() => syncRemotePeerTiles(userId), 800);
    }
  } else {
    removeTile(screenTileId);
  }

  // 2. Sincroniza Transmissão de Câmera
  const cameraTileId = `${userId}-camera`;
  if (userMedia.camera) {
    const cameraStream = webrtc.getRemoteStreamForTile(userId, 'camera');
    const cameraVideoTrack = webrtc.getRemoteVideoTrack(userId, 'camera');

    if (cameraVideoTrack) {
      addOrUpdateTile({
        id: cameraTileId,
        title: `${participantName} (Câmera)`,
        stream: cameraStream,
        isLocal: false,
        type: 'camera'
      });

      cameraVideoTrack.onunmute = () => {
        console.log(`[App] Câmera de ${participantName} pronta para reprodução (unmute)`);
        const tile = activeTiles.get(cameraTileId);
        if (tile && tile.videoEl) {
          tile.videoEl.play().catch(e => console.warn(e));
        }
      };
    } else {
      setTimeout(() => syncRemotePeerTiles(userId), 300);
      setTimeout(() => syncRemotePeerTiles(userId), 800);
    }
  } else {
    removeTile(cameraTileId);
  }

  updateGridLayout();
}

/**
 * Alterna modo de foco (Spotlight) em uma transmissão específica
 */
function toggleSpotlight(id) {
  if (currentSpotlightId === id) {
    if (currentLayoutMode === 'stage') {
      currentSpotlightId = null;
      ensureSpotlightSelected();
    } else {
      clearSpotlight();
    }
  } else {
    applySpotlightTile(id);
  }
}

function toggleTileFullscreen(tileEl) {
  if (!document.fullscreenElement) {
    tileEl.requestFullscreen().catch(err => console.warn(err));
  } else {
    document.exitFullscreen().catch(err => console.warn(err));
  }
}

// ========================================================
// GERENCIADOR DE PRÉVIA LOCAL (SELF-VIEW FLUTUANTE & DISCRETO)
// Evita túnel de espelho e não divide a visualização da tela principal
// ========================================================
function addOrUpdateLocalPreview(type, stream, title) {
  let entry = localPreviews.get(type);

  if (entry) {
    entry.stream = stream;
    if (entry.videoEl) {
      entry.videoEl.srcObject = stream;
      entry.videoEl.play().catch(e => console.warn('[LocalDock] Play:', e));
    }
    if (entry.isPinned) {
      addOrUpdateTile({
        id: `local-${type}`,
        title,
        stream,
        isLocal: true,
        type
      });
    }
    updateLocalDockVisibility();
    return entry;
  }

  const cardEl = document.createElement('div');
  cardEl.className = 'local-media-card';
  cardEl.id = `local-card-${type}`;

  const badgeClass = type === 'screen' ? 'badge-screen' : 'badge-camera';
  const badgeLabel = type === 'screen' ? '🖥️ Sua Tela 60 FPS' : '📷 Câmera (Você)';

  const headerEl = document.createElement('div');
  headerEl.className = 'local-card-header';
  headerEl.innerHTML = `
    <span class="local-card-badge ${badgeClass}">${badgeLabel}</span>
    <div class="local-card-actions">
      <button class="local-card-btn btn-toggle-preview" title="Ocultar / Mostrar prévia">👁️</button>
      <button class="local-card-btn btn-pin-grid" title="Fixar / Desafixar no grid principal">⊞</button>
      <button class="local-card-btn btn-stop" title="Encerrar transmissão">✕</button>
    </div>
  `;

  const videoWrap = document.createElement('div');
  videoWrap.className = `local-card-video-wrap is-${type}`;

  const videoEl = document.createElement('video');
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.srcObject = stream;
  videoWrap.appendChild(videoEl);

  const hiddenNotice = document.createElement('div');
  hiddenNotice.className = 'local-hidden-notice hidden';
  hiddenNotice.innerHTML = `
    <span>${type === 'screen' ? '🖥️ Tela transmitindo (60 FPS)' : '📷 Câmera ativa'}</span>
    <button class="btn-unhide-preview">Mostrar</button>
  `;

  cardEl.appendChild(headerEl);
  cardEl.appendChild(videoWrap);
  cardEl.appendChild(hiddenNotice);
  localDockContent.appendChild(cardEl);

  videoEl.play().catch(e => console.warn('[LocalDock] Autoplay:', e));

  entry = {
    cardEl,
    videoEl,
    videoWrap,
    hiddenNotice,
    stream,
    title,
    type,
    isHidden: false,
    isPinned: false
  };
  localPreviews.set(type, entry);

  const btnToggle = headerEl.querySelector('.btn-toggle-preview');
  const btnPin = headerEl.querySelector('.btn-pin-grid');
  const btnStop = headerEl.querySelector('.btn-stop');
  const btnUnhide = hiddenNotice.querySelector('.btn-unhide-preview');

  const togglePreviewVisibility = (hide) => {
    entry.isHidden = hide !== undefined ? hide : !entry.isHidden;
    cardEl.classList.toggle('preview-hidden', entry.isHidden);
    videoWrap.style.display = entry.isHidden ? 'none' : 'flex';
    hiddenNotice.classList.toggle('hidden', !entry.isHidden);
    btnToggle.title = entry.isHidden ? 'Mostrar prévia' : 'Ocultar prévia';
  };

  btnToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePreviewVisibility();
  });

  btnUnhide.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePreviewVisibility(false);
  });

  btnPin.addEventListener('click', (e) => {
    e.stopPropagation();
    entry.isPinned = !entry.isPinned;
    btnPin.classList.toggle('active', entry.isPinned);
    if (entry.isPinned) {
      addOrUpdateTile({
        id: `local-${type}`,
        title,
        stream: entry.stream,
        isLocal: true,
        type
      });
      cardEl.style.display = 'none';
    } else {
      removeTile(`local-${type}`);
      cardEl.style.display = 'block';
    }
  });

  btnStop.addEventListener('click', (e) => {
    e.stopPropagation();
    if (type === 'screen') handleToggleScreenShare();
    if (type === 'camera') handleToggleCamera();
  });

  updateLocalDockVisibility();
  return entry;
}

function removeLocalPreview(type) {
  const entry = localPreviews.get(type);
  if (!entry) return;

  if (entry.videoEl) {
    entry.videoEl.srcObject = null;
  }
  if (entry.isPinned) {
    removeTile(`local-${type}`);
  }
  entry.cardEl.remove();
  localPreviews.delete(type);

  updateLocalDockVisibility();
}

function updateLocalDockVisibility() {
  const hasActiveLocal = localPreviews.size > 0;
  if (!hasActiveLocal) {
    localDock.classList.add('hidden');
    localDockPill.classList.add('hidden');
    isDockMinimized = false;
  } else {
    if (isDockMinimized) {
      localDock.classList.add('hidden');
      localDockPill.classList.remove('hidden');
      const types = Array.from(localPreviews.keys()).map(t => t === 'screen' ? '🖥️ Tela 60 FPS' : '📷 Câmera').join(' + ');
      localDockPillLabel.textContent = `${types} Ativa${localPreviews.size > 1 ? 's' : ''}`;
    } else {
      localDock.classList.remove('hidden');
      localDockPill.classList.add('hidden');
    }
  }
  updateGridLayout();
}

/**
 * Atualiza layout do grid e placeholder informativo
 */
function updateGridLayout() {
  const count = activeTiles.size;
  videoGrid.dataset.count = count;

  if (currentLayoutMode === 'stage') {
    videoGrid.classList.add('stage-layout');
    ensureSpotlightSelected();
  } else {
    videoGrid.classList.remove('stage-layout');
    if (currentLayoutMode === 'grid' && !currentSpotlightId) {
      videoGrid.classList.remove('spotlight-active');
    }
  }

  if (count === 0) {
    streamPlaceholder.classList.remove('hidden');
    const isSharingScreen = media.hasActiveScreenStream();
    const isSharingCamera = media.hasActiveCamera();

    if (isSharingScreen && isSharingCamera) {
      placeholderNotice.textContent = 'Você está transmitindo sua tela (60 FPS) e sua câmera. Aguardando outros participantes.';
      connectionBadge.textContent = '🟢 Transmitindo Tela + Câmera';
      connectionBadge.className = 'status-badge connected';
    } else if (isSharingScreen) {
      placeholderNotice.textContent = 'Você está transmitindo sua tela a 60 FPS. Aguardando transmissões dos outros participantes.';
      connectionBadge.textContent = '🟢 Transmitindo Tela (60 FPS)';
      connectionBadge.className = 'status-badge connected';
    } else if (isSharingCamera) {
      placeholderNotice.textContent = 'Sua câmera está ativa. Aguardando transmissões dos outros participantes.';
      connectionBadge.textContent = '🟢 Câmera Ativa';
      connectionBadge.className = 'status-badge connected';
    } else {
      placeholderNotice.textContent = 'Inicie sua câmera ou compartilhe sua tela para começar a transmitir.';
      connectionBadge.textContent = '🟢 Sala Pronta';
      connectionBadge.className = 'status-badge connected';
    }
  } else {
    streamPlaceholder.classList.add('hidden');
    connectionBadge.textContent = `🟢 ${count} Transmissão${count > 1 ? 'ões' : ''} Ativa${count > 1 ? 's' : ''}`;
    connectionBadge.className = 'status-badge connected';
  }
}


// ========================================================
// 1. INICIALIZAÇÃO E TRATAMENTO DA URL
// ========================================================
function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  const pinFromUrl = urlParams.get('pin');

  const savedUsername = (() => {
    try { return localStorage.getItem('webrtc_username'); } catch (_) { return null; }
  })();

  const defaultUsername = savedUsername || ('User_' + Math.floor(Math.random() * 900 + 100));

  if (createUsernameInput) createUsernameInput.value = defaultUsername;
  if (joinUsernameInput) joinUsernameInput.value = defaultUsername;

  if (createRoomIdInput && !createRoomIdInput.value) {
    createRoomIdInput.value = 'stream-' + Math.random().toString(36).substring(2, 7);
  }

  // Se o usuário abriu um link de convite (com ?room=...)
  if (roomFromUrl) {
    switchLobbyTab('join');
    if (joinRoomIdInput) joinRoomIdInput.value = roomFromUrl.trim().toLowerCase();
    if (pinFromUrl && joinPasswordInput) {
      joinPasswordInput.value = pinFromUrl;
      showLobbyAlert(`Convite recebido para a sala "${roomFromUrl}" com PIN automático preenchido. Clique em Entrar!`, 'info');
    } else {
      showLobbyAlert(`Convite recebido para a sala "${roomFromUrl}".`, 'info');
    }
  }

  setupEventListeners();
  setupSignalingEvents();
  setupWebRTCEvents();

  // Detecção de Ambiente Desktop (Electron com WGC)
  if (window.desktopAPI) {
    console.log('[Desktop] Detectado ambiente nativo Desktop via Electron com WGC e aceleração GPU!');
    if (desktopAppBadge) {
      desktopAppBadge.classList.remove('hidden');
    }
  }

  // Configuração Inicial de Layout e Painel Lateral
  if (btnLayoutGrid) btnLayoutGrid.addEventListener('click', () => setLayoutMode('grid'));
  if (btnLayoutStage) btnLayoutStage.addEventListener('click', () => setLayoutMode('stage'));
  if (btnLayoutTheater) btnLayoutTheater.addEventListener('click', () => {
    if (currentLayoutMode === 'theater') {
      setLayoutMode('grid');
    } else {
      setLayoutMode('theater');
    }
  });
  if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', () => toggleSidebar());

  setLayoutMode(currentLayoutMode);
  if (isSidebarCollapsed) {
    toggleSidebar(true);
  }
}

async function enterRoom({ roomId, username, isHost, password, submitBtn }) {
  const sanitizedRoom = (roomId || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  const cleanUsername = (username || '').trim();
  const cleanPassword = password ? password.trim() : null;

  if (!sanitizedRoom) {
    showLobbyAlert('Por favor, informe um código de sala válido (apenas letras, números e hífens).');
    return;
  }
  if (!cleanUsername) {
    showLobbyAlert('Por favor, informe seu nome ou apelido.');
    return;
  }

  hideLobbyAlert();
  currentAttemptedPin = cleanPassword;

  try {
    localStorage.setItem('webrtc_username', cleanUsername);
  } catch (_) {}

  isConnecting = true;
  const originalBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Conectando...';

  const resetBtn = () => {
    isConnecting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  };

  try {
    await signaling.connect();
    signaling.roomId = sanitizedRoom;
    const sent = signaling.send('JOIN_ROOM', {
      username: cleanUsername,
      isHost,
      password: cleanPassword
    });

    if (!sent) {
      resetBtn();
      showLobbyAlert('Não foi possível enviar mensagem ao servidor de sinalização. Verifique sua conexão.');
      return;
    }

    setTimeout(() => {
      if (isConnecting && lobbyScreen.classList.contains('active')) {
        resetBtn();
      }
    }, 6000);
  } catch (err) {
    resetBtn();
    console.error('[App] Falha ao conectar:', err);
    showLobbyAlert(err.message || 'Não foi possível conectar ao servidor de sinalização.');
  }
}

// ========================================================
// 2. CONFIGURAÇÃO DE EVENTOS DA INTERFACE (UI)
// ========================================================
function setupEventListeners() {
  if (tabBtnCreate) tabBtnCreate.addEventListener('click', () => switchLobbyTab('create'));
  if (tabBtnJoin) tabBtnJoin.addEventListener('click', () => switchLobbyTab('join'));

  if (btnRandomRoom) {
    btnRandomRoom.addEventListener('click', () => {
      const randomId = 'stream-' + Math.random().toString(36).substring(2, 7);
      if (createRoomIdInput) createRoomIdInput.value = randomId;
    });
  }

  if (createRoomForm) {
    createRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      enterRoom({
        roomId: createRoomIdInput.value,
        username: createUsernameInput.value,
        isHost: true,
        password: createPasswordInput.value,
        submitBtn: btnSubmitCreate
      });
    });
  }

  if (joinRoomForm) {
    joinRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      enterRoom({
        roomId: joinRoomIdInput.value,
        username: joinUsernameInput.value,
        isHost: false,
        password: joinPasswordInput.value,
        submitBtn: btnSubmitJoin
      });
    });
  }

  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', () => {
      let inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(roomState.roomId)}`;
      if (roomState.hasPassword && roomState.roomPin) {
        inviteUrl += `&pin=${encodeURIComponent(roomState.roomPin)}`;
      }
      navigator.clipboard.writeText(inviteUrl).then(() => {
        btnCopyLink.textContent = '✅ Copiado!';
        setTimeout(() => {
          btnCopyLink.textContent = '📋 Copiar Link';
        }, 2000);
      }).catch(() => {
        prompt('Copie o link de convite abaixo:', inviteUrl);
      });
    });
  }

  if (unmuteBanner) {
    unmuteBanner.addEventListener('click', () => {
      activeTiles.forEach(({ videoEl }) => {
        videoEl.muted = false;
        videoEl.play().catch(() => {});
      });
      unmuteBanner.classList.add('hidden');
    });
  }

  btnToggleHud.addEventListener('click', () => {
    telemetryHud.classList.toggle('hidden');
  });

  if (btnMinimizeDock) {
    btnMinimizeDock.addEventListener('click', () => {
      isDockMinimized = true;
      updateLocalDockVisibility();
    });
  }

  if (localDockPill) {
    localDockPill.addEventListener('click', () => {
      isDockMinimized = false;
      updateLocalDockVisibility();
    });
  }

  sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sidebarTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      if (target === 'chat') {
        tabChat.classList.add('active');
        tabParticipants.classList.remove('active');
      } else {
        tabChat.classList.remove('active');
        tabParticipants.classList.add('active');
      }
    });
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    signaling.send('CHAT_MESSAGE', { text });
    chatInput.value = '';
  });

  // Botões de Iniciar Mídia
  btnShareScreen.addEventListener('click', handleToggleScreenShare);
  btnPromptShare.addEventListener('click', handleToggleScreenShare);

  btnToggleCamera.addEventListener('click', handleToggleCamera);
  btnPromptCamera.addEventListener('click', handleToggleCamera);

  // Mute / Unmute microfone
  btnToggleAudio.addEventListener('click', async () => {
    try {
      const { muted, stream } = await media.toggleMicrophone();
      micIcon.textContent = muted ? '🔇' : '🎤';
      micLabel.textContent = muted ? 'Microfone Mutado' : 'Microfone Ativo';
      btnToggleAudio.classList.toggle('active', !muted);

      const otherIds = roomState.getOtherParticipantIds();
      await webrtc.syncLocalMedia(media, otherIds);
      await webrtc.renegotiateAllPeers(otherIds);

      signaling.send('MUTE', { muted });
    } catch (err) {
      alert('Não foi possível acessar o microfone: ' + err.message);
    }
  });

  // Tela Cheia Geral
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      videoWrapper.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen().catch(err => console.warn(err));
    }
  });

  // Sair da Sala
  btnLeaveRoom.addEventListener('click', () => {
    leaveCurrentRoom();
  });

  media.onStreamEnded = () => {
    handleStreamEnded();
  };
}

// ========================================================
// 3. FLUXO DE CÂMERA (WEBCAM - ESTILO MEET / DISCORD)
// ========================================================
async function handleToggleCamera() {
  try {
    const { active, stream } = await media.toggleCamera();
    cameraIcon.textContent = active ? '📷' : '📹';
    cameraLabel.textContent = active ? 'Câmera Ativa' : 'Câmera';
    btnToggleCamera.classList.toggle('active', active);

    const otherIds = roomState.getOtherParticipantIds();

    if (active && media.cameraStream) {
      addOrUpdateLocalPreview('camera', media.cameraStream, 'Câmera (Você)');

      await webrtc.syncLocalMedia(media, otherIds);
      await webrtc.renegotiateAllPeers(otherIds);

      signaling.send('MEDIA_STATE', {
        type: 'camera',
        active: true,
        streamId: media.cameraStream?.id || null,
        trackId: media.getCameraVideoTrack()?.id || null
      });
      appendSystemChat('Você ativou sua câmera.');
    } else {
      removeLocalPreview('camera');

      await webrtc.syncLocalMedia(media, otherIds);
      await webrtc.renegotiateAllPeers(otherIds);

      signaling.send('MEDIA_STATE', {
        type: 'camera',
        active: false
      });
      appendSystemChat('Você desativou sua câmera.');
    }
    updateGridLayout();
  } catch (err) {
    console.error('[App] Erro ao alternar câmera:', err);
    alert('Não foi possível acessar a câmera:\n' + err.message + '\n\nCertifique-se de que a webcam não está aberta em outro aplicativo.');
  }
}

// ========================================================
// 4. FLUXO DE TELA (SCREEN SHARE - 60 FPS)
// ========================================================
async function handleToggleScreenShare() {
  if (media.hasActiveScreenStream()) {
    media.stopScreenCapture();
    handleStreamEnded();
  } else {
    try {
      console.log('[App] Solicitando compartilhamento de tela a 60 FPS...');
      const stream = await media.startScreenCapture();

      addOrUpdateLocalPreview('screen', media.screenStream, 'Sua Tela (60 FPS)');

      btnShareScreen.classList.add('active');
      btnShareScreen.querySelector('.label').textContent = 'Parar Tela';

      const otherIds = roomState.getOtherParticipantIds();
      await webrtc.syncLocalMedia(media, otherIds);
      await webrtc.renegotiateAllPeers(otherIds);

      const hasAudio = media.getScreenAudioTrack() !== null;
      const trackId = media.getScreenVideoTrack()?.id;
      const streamId = media.screenStream?.id;

      signaling.send('START_STREAM', { hasVideo: true, hasAudio, trackId, streamId });
      signaling.send('MEDIA_STATE', { type: 'screen', active: true, trackId, streamId });

      appendSystemChat('Você iniciou o compartilhamento de tela.');
      updateGridLayout();
    } catch (err) {
      console.error('[App] Falha ao compartilhar tela:', err);
      alert('Não foi possível iniciar o compartilhamento de tela:\n' + err.message);
    }
  }
}

function handleStreamEnded() {
  removeLocalPreview('screen');

  btnShareScreen.classList.remove('active');
  btnShareScreen.querySelector('.label').textContent = 'Compartilhar Tela';

  const otherIds = roomState.getOtherParticipantIds();
  webrtc.syncLocalMedia(media, otherIds);
  webrtc.renegotiateAllPeers(otherIds).catch(() => {});

  signaling.send('STOP_STREAM', {});
  signaling.send('MEDIA_STATE', { type: 'screen', active: false });
  appendSystemChat('Você encerrou o compartilhamento de tela.');
  updateGridLayout();
}

// ========================================================
// 5. CONFIGURAÇÃO DOS EVENTOS DO WEBRTC
// ========================================================
function setupWebRTCEvents() {
  webrtc.onRemoteStream = (stream, fromUserId) => {
    console.log(`[App] Stream remoto atualizado de ${fromUserId}...`, stream.getTracks());
  };

  // Roteamento inteligente de tracks remotos com reconexão reativa
  webrtc.onRemoteTrack = (track, stream, fromUserId) => {
    console.log(`[App] onRemoteTrack recebido de ${fromUserId}: kind=${track.kind}, id=${track.id}`);
    if (track.kind === 'audio') {
      activeTiles.forEach((entry, tileId) => {
        if (tileId.startsWith(fromUserId)) {
          if (!entry.stream.getTracks().some(t => t.id === track.id)) {
            entry.stream.addTrack(track);
          }
        }
      });
    }
    syncRemotePeerTiles(fromUserId);
  };

  // Callback acionado quando um track pausado/substituído volta a decodificar quadros (unmute)
  webrtc.onRemoteTrackUnmuted = (track, fromUserId) => {
    console.log(`[App] onRemoteTrackUnmuted recebido de ${fromUserId}: kind=${track.kind}`);
    syncRemotePeerTiles(fromUserId);
  };

  // Notificação imediata quando a negociação SDP (Offer/Answer) conclui
  webrtc.onNegotiationComplete = (fromUserId) => {
    console.log(`[App] Negociação SDP concluída para ${fromUserId}. Sincronizando tiles...`);
    syncRemotePeerTiles(fromUserId);
  };

  webrtc.onConnectionStateChange = (targetUserId, state) => {
    console.log(`[App] Status P2P com ${targetUserId}: ${state}`);
    if (state === 'connected') {
      connectionBadge.textContent = '🟢 P2P Conectado (60 FPS)';
      connectionBadge.className = 'status-badge connected';
      syncRemotePeerTiles(targetUserId);
    } else if (state === 'connecting') {
      connectionBadge.textContent = '🟡 Conectando P2P...';
      connectionBadge.className = 'status-badge connecting';
    } else if (state === 'disconnected' || state === 'failed') {
      connectionBadge.textContent = '🔴 P2P Desconectado';
      connectionBadge.className = 'status-badge';
    }
  };
}

// ========================================================
// 6. CONFIGURAÇÃO DOS EVENTOS DE SINALIZAÇÃO
// ========================================================
function setupSignalingEvents() {
  signaling.on('ROOM_JOINED', (msg) => {
    isConnecting = false;
    if (btnSubmitCreate) {
      btnSubmitCreate.disabled = false;
      btnSubmitCreate.textContent = '🚀 Criar Sala e Iniciar';
    }
    if (btnSubmitJoin) {
      btnSubmitJoin.disabled = false;
      btnSubmitJoin.textContent = '🚪 Entrar na Transmissão';
    }

    const roomId = msg.roomId || msg.data?.roomId || signaling.roomId;
    const { userId, username, isHost, users, iceServers, hostToken, hasPassword } = msg.data || {};
    signaling.userId = userId;

    roomState.setRoomInfo(roomId, userId, username, isHost, users, {
      hostToken,
      hasPassword,
      roomPin: currentAttemptedPin
    });
    webrtc.setIceServers(iceServers);

    lobbyScreen.classList.remove('active');
    roomScreen.classList.add('active');

    displayRoomId.textContent = roomId;
    roleBadge.textContent = isHost ? '👑 Host (Criador)' : '👁️ Participante';
    roleBadge.style.borderColor = isHost ? 'var(--warning)' : 'var(--border-color)';

    if (roomLockBadge) {
      roomLockBadge.classList.toggle('hidden', !hasPassword);
    }

    connectionBadge.textContent = '🟢 Sala Pronta';
    connectionBadge.className = 'status-badge connected';

    updateParticipantsUI();

    // Registra mídias de usuários já presentes na sala
    if (Array.isArray(users)) {
      users.forEach(u => {
        if (u.id !== userId) {
          const userMedia = {
            screen: Boolean(u.isScreenSharing || u.mediaState?.screen?.active),
            camera: Boolean(u.isCameraActive || u.mediaState?.camera?.active)
          };
          remoteUserMedia.set(u.id, userMedia);
          if (u.mediaState?.screen) {
            webrtc.updatePeerMediaState(u.id, 'screen', u.mediaState.screen.active, u.mediaState.screen.mid, u.mediaState.screen.streamId);
          }
          if (u.mediaState?.camera) {
            webrtc.updatePeerMediaState(u.id, 'camera', u.mediaState.camera.active, u.mediaState.camera.mid, u.mediaState.camera.streamId);
          }
        }
      });
    }

    qualityController.start(webrtc, (metrics) => {
      hudFps.textContent = metrics.fps;
      hudResolution.textContent = metrics.resolution;
      hudRtt.textContent = `${metrics.rtt} ms`;
      hudBitrate.textContent = `${metrics.bitrateMbps} Mbps`;
      hudPacketLoss.textContent = `${metrics.packetLossPercent}%`;
      hudCodec.textContent = metrics.codec;
    });

    appendSystemChat(`Você entrou na sala como ${isHost ? 'Host' : 'Participante'}.`);
  });

  signaling.on('USER_JOINED', async (msg) => {
    const { user } = msg.data;
    roomState.addParticipant(user);
    updateParticipantsUI();
    appendSystemChat(`${user.name} ingressou na sala.`);

    // Conecta imediatamente com o novo participante para estabelecer a malha P2P
    // Assim os participantes já ficam em chamada e qualquer transmissão iniciada depois conecta na hora
    console.log(`[App] Novo participante detectado (${user.id}). Conectando malha P2P de chamada...`);
    await webrtc.syncPeerTracks(user.id, media);
    await webrtc.createOfferForPeer(user.id);
  });

  signaling.on('USER_LEFT', (msg) => {
    const { userId, username } = msg.data;
    roomState.removeParticipant(userId);
    webrtc.closePeer(userId);

    // Remove todos os tiles pertencentes a este usuário do grid
    removeTile(`${userId}-screen`);
    removeTile(`${userId}-camera`);
    remoteUserMedia.delete(userId);

    updateParticipantsUI();
    appendSystemChat(`${username || 'Um usuário'} saiu da sala.`);
  });

  signaling.on('OFFER', async (msg) => {
    console.log(`[App] Oferta SDP recebida de ${msg.from}`);
    await webrtc.handleOffer(msg.from, msg.data);
  });

  signaling.on('ANSWER', async (msg) => {
    console.log(`[App] Resposta SDP recebida de ${msg.from}`);
    await webrtc.handleAnswer(msg.from, msg.data);
  });

  signaling.on('ICE_CANDIDATE', async (msg) => {
    await webrtc.handleIceCandidate(msg.from, msg.data);
  });

  // Atualização de estado de transmissão remota (câmera ou tela iniciada/encerrada)
  signaling.on('MEDIA_STATE', (msg) => {
    const { type, active, mid, streamId } = msg.data;
    const fromUserId = msg.from;
    console.log(`[App] Evento MEDIA_STATE de ${fromUserId}: tipo=${type}, ativo=${active}, mid=${mid}`);

    let userMedia = remoteUserMedia.get(fromUserId);
    if (!userMedia) {
      userMedia = { screen: false, camera: false };
      remoteUserMedia.set(fromUserId, userMedia);
    }
    userMedia[type] = active;

    webrtc.updatePeerMediaState(fromUserId, type, active, mid, streamId);
    syncRemotePeerTiles(fromUserId);
  });

  signaling.on('START_STREAM', (msg) => {
    const fromUserId = msg.from;
    console.log(`[App] Evento START_STREAM de ${fromUserId}`);
    let userMedia = remoteUserMedia.get(fromUserId);
    if (!userMedia) {
      userMedia = { screen: false, camera: false };
      remoteUserMedia.set(fromUserId, userMedia);
    }
    userMedia.screen = true;

    webrtc.updatePeerMediaState(fromUserId, 'screen', true, msg.data?.mid, msg.data?.streamId);
    syncRemotePeerTiles(fromUserId);
  });

  signaling.on('STOP_STREAM', (msg) => {
    const fromUserId = msg.from;
    console.log(`[App] Evento STOP_STREAM de ${fromUserId}`);
    let userMedia = remoteUserMedia.get(fromUserId);
    if (userMedia) userMedia.screen = false;

    webrtc.updatePeerMediaState(fromUserId, 'screen', false);
    syncRemotePeerTiles(fromUserId);
  });

  signaling.on('CHAT_MESSAGE', (msg) => {
    const { author, userId, text, timestamp } = msg.data;
    appendChatMessage(author, text, timestamp, userId === roomState.myUserId);
  });

  signaling.on('ERROR', (msg) => {
    isConnecting = false;
    const errorMsg = msg.data?.message || 'Erro inesperado';

    if (btnSubmitCreate) {
      btnSubmitCreate.disabled = false;
      btnSubmitCreate.textContent = '🚀 Criar Sala e Iniciar';
    }
    if (btnSubmitJoin) {
      btnSubmitJoin.disabled = false;
      btnSubmitJoin.textContent = '🚪 Entrar na Transmissão';
    }

    if (lobbyScreen && lobbyScreen.classList.contains('active')) {
      showLobbyAlert(`⚠️ ${errorMsg}`, 'error');
    } else {
      alert(`Aviso do Servidor: ${errorMsg}`);
    }
  });
}

// ========================================================
// 7. RENDERIZAÇÃO E ATUALIZAÇÃO DE UI
// ========================================================
function updateParticipantsUI() {
  const count = roomState.getParticipantCount();
  userCountBadge.textContent = `👥 ${count} participante${count > 1 ? 's' : ''}`;
  tabUserCount.textContent = count;

  participantsList.innerHTML = '';
  for (const user of roomState.participants.values()) {
    const li = document.createElement('li');
    li.className = 'participant-item';

    const isSelf = user.id === roomState.myUserId;
    li.innerHTML = `
      <div class="participant-info">
        <span>👤 ${user.name}${isSelf ? ' <em>(Você)</em>' : ''}</span>
      </div>
      <div>
        ${user.isHost ? '<span class="host-tag">HOST</span>' : ''}
      </div>
    `;
    participantsList.appendChild(li);
  }
}

function appendSystemChat(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.innerHTML = `<span>${text}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendChatMessage(author, text, timestamp, isSelf) {
  const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'chat-message-item';
  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-author ${isSelf ? 'is-self' : ''}">${author}</span>
      <span class="chat-msg-time">${timeStr}</span>
    </div>
    <div class="chat-msg-body">${escapeHtml(text)}</div>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function leaveCurrentRoom() {
  currentAttemptedPin = null;
  hideLobbyAlert();
  qualityController.stop();
  media.stopCamera();
  media.stopScreenCapture();
  webrtc.closeAllPeers();
  signaling.send('LEAVE_ROOM', {});
  signaling.disconnect();

  removeLocalPreview('screen');
  removeLocalPreview('camera');
  localPreviews.clear();
  remoteUserMedia.clear();
  updateLocalDockVisibility();

  activeTiles.forEach(({ videoEl }) => {
    if (videoEl) videoEl.srcObject = null;
  });
  activeTiles.clear();
  videoGrid.innerHTML = '';
  currentSpotlightId = null;
  videoGrid.classList.remove('spotlight-active');

  if (unmuteBanner) unmuteBanner.classList.add('hidden');
  roomState.reset();

  roomScreen.classList.remove('active');
  lobbyScreen.classList.add('active');
}

// Inicialização imediata
init();

