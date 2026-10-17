import { SignalingClient } from './signaling.js';
import { MediaManager } from './media.js';
import { WebRTCManager } from './webrtc.js';
import { QualityController } from './qualityController.js';
import { RoomState, getParticipantColor, getUserInitials } from './room.js';
import { Icons } from './icons.js';
import { evaluateCodecCapabilities, identifyGpuVendor, STREAM_RESOLUTIONS, probeRealHardwareEncoders, parseH264ProfileLevel, classifyCodecImplementation } from './hardwareDetector.js';
import { probeWebCodecsHardware, runRealGpuEncodeBenchmark, GpuHardwareEncoderEngine } from './gpuEncoderEngine.js';

// Instanciação dos Módulos Centrais
const signaling = new SignalingClient();
const media = new MediaManager();
const webrtc = new WebRTCManager(signaling);
webrtc.setMediaManager(media);
const qualityController = new QualityController();
qualityController.setWebRTC(webrtc);
webrtc.setQualityController(qualityController);
const roomState = new RoomState();
webrtc.setRoomState(roomState);
const gpuEncoderEngine = new GpuHardwareEncoderEngine();

function updateConnectionStatus(statusClass, text) {
  if (!connectionBadge) return;
  connectionBadge.className = `status-badge ${statusClass}`.trim();
  connectionBadge.innerHTML = `<span class="status-dot"></span><span class="status-text">${text}</span>`;
}

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
const telemetryHud = document.getElementById('telemetryHud');

// Elementos do DOM - Seletor de Layouts & Painel Lateral
const layoutSelectorGroup = document.getElementById('layoutSelectorGroup');
const btnLayoutGrid = document.getElementById('btnLayoutGrid');
const btnLayoutStage = document.getElementById('btnLayoutStage');
const btnLayoutTheater = document.getElementById('btnLayoutTheater');
const btnToggleParticipantsStrip = document.getElementById('btnToggleParticipantsStrip');
const participantsStripBtnLabel = document.getElementById('participantsStripBtnLabel');
const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const sidebarBtnLabel = document.getElementById('sidebarBtnLabel');
const roomBody = document.getElementById('roomBody');

// Elementos do DOM - Grid Dinâmico & Palco de Transmissões
const videoWrapper = document.getElementById('videoWrapper');
const videoGrid = document.getElementById('videoGrid');
const participantsStrip = document.getElementById('participantsStrip');
const participantsStripList = document.getElementById('participantsStripList');
const btnCollapseStrip = document.getElementById('btnCollapseStrip');
const unmuteBanner = document.getElementById('unmuteBanner');
const streamPlaceholder = document.getElementById('streamPlaceholder');
const placeholderNotice = document.getElementById('placeholderNotice');
const btnPromptShare = document.getElementById('btnPromptShare');
const btnPromptCamera = document.getElementById('btnPromptCamera');

// Elementos do DOM - Dock Flutuante de Prévia Local (Self-View)
const localDock = document.getElementById('localDock');
const localDockContent = document.getElementById('localDockContent');
const btnMinimizeDock = document.getElementById('btnMinimizeDock');
const chkAutoPauseLocalPreview = document.getElementById('chkAutoPauseLocalPreview');
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
const btnLeaveRoomHeader = document.getElementById('btnLeaveRoomHeader');

// Elementos do DOM - Sidebar (Chat & Participantes)
const sidebarTabs = document.querySelectorAll('.sidebar-tabs .tab-btn');
const tabChat = document.getElementById('tabChat');
const tabParticipants = document.getElementById('tabParticipants');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatImageInput = document.getElementById('chatImageInput');
const btnAttachImage = document.getElementById('btnAttachImage');
const chatImagePreview = document.getElementById('chatImagePreview');
const chatPreviewThumb = document.getElementById('chatPreviewThumb');
const chatPreviewName = document.getElementById('chatPreviewName');
const btnRemoveChatImage = document.getElementById('btnRemoveChatImage');
const imageLightboxModal = document.getElementById('imageLightboxModal');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxAuthor = document.getElementById('lightboxAuthor');
const btnCloseLightbox = document.getElementById('btnCloseLightbox');
const participantsList = document.getElementById('participantsList');
const tabUserCount = document.getElementById('tabUserCount');
const tabStreamCount = document.getElementById('tabStreamCount');

// Elementos do DOM - HUD Telemetria
const hudFps = document.getElementById('hudFps');
const hudResolution = document.getElementById('hudResolution');
const hudRtt = document.getElementById('hudRtt');
const hudBitrate = document.getElementById('hudBitrate');
const hudPacketLoss = document.getElementById('hudPacketLoss');
const hudCodec = document.getElementById('hudCodec');
const hudConnectionType = document.getElementById('hudConnectionType');

// ========================================================
// GERENCIADOR DO GRID DINÂMICO DE TRANSMISSÕES (MULTI-STREAM)
// ========================================================
const activeTiles = new Map(); // Map<tileId, { tileEl, videoEl, stream, type, isLocal }>
const remoteUserMedia = new Map(); // Map<userId, { screen: boolean, camera: boolean }>
const localPreviews = new Map(); // Map<type ('camera'|'screen'), { cardEl, videoEl, stream, isHidden, isPinned }>
const stripVideoThumbnails = new Map(); // Map<tileId, HTMLVideoElement> - Cache de miniaturas de vídeo para Tira/Filmstrip (reutilização limpa)
let currentSpotlightId = null;
let isDockMinimized = false;
let autoPauseLocalPreview = (() => {
  try {
    const saved = localStorage.getItem('hyperstream_auto_pause_local_preview');
    return saved !== null ? saved === 'true' : true;
  } catch (_) { return true; }
})();
let currentAttemptedPin = null;
let isConnecting = false;
const peerSyncTimers = new Map(); // Map<userId, number> - Timer de retry único por peer (previne loop exponencial)
const peerRetryCounts = new Map(); // Map<userId, number> - Contador de tentativas limitadas

/**
 * Normaliza IDs de transmissões/tiles para formato canônico,
 * garantindo compatibilidade uniforme entre '-desktop' e '-screen'.
 */
function toCanonicalTileId(id) {
  if (!id) return '';
  return String(id).replace(/-desktop$/, '-screen');
}

function areTileIdsEquivalent(id1, id2) {
  if (!id1 || !id2) return false;
  if (id1 === id2) return true;
  return toCanonicalTileId(id1) === toCanonicalTileId(id2);
}

// Estado de Layout (Sincronizado entre Web e Desktop)
let currentLayoutMode = (() => {
  try {
    const saved = localStorage.getItem('webrtc_layout_mode');
    return (saved === 'stage' || saved === 'theater') ? saved : 'grid';
  } catch (_) { return 'grid'; }
})();
let isSidebarCollapsed = (() => {
  try {
    const saved = localStorage.getItem('webrtc_sidebar_collapsed');
    if (saved !== null) return saved === 'true';
    // No celular, inicia recolhido para priorizar visualização em tela cheia da transmissão
    return typeof window !== 'undefined' && window.innerWidth <= 768;
  } catch (_) { return typeof window !== 'undefined' && window.innerWidth <= 768; }
})();
let isParticipantsStripHidden = (() => {
  try {
    const saved = localStorage.getItem('webrtc_strip_hidden');
    return saved === 'true';
  } catch (_) { return false; }
})();

/**
 * Alterna a visibilidade da tira de miniaturas dos participantes no modo Palco e Teatro
 */
function toggleParticipantsStrip(forceState = null) {
  if (forceState !== null) {
    isParticipantsStripHidden = forceState;
  } else {
    isParticipantsStripHidden = !isParticipantsStripHidden;
  }

  try { localStorage.setItem('webrtc_strip_hidden', isParticipantsStripHidden ? 'true' : 'false'); } catch (_) {}

  const isStageOrTheater = currentLayoutMode === 'stage' || currentLayoutMode === 'theater';
  if (participantsStrip) {
    participantsStrip.classList.toggle('hidden', isParticipantsStripHidden || !isStageOrTheater);
  }

  if (participantsStripBtnLabel) {
    participantsStripBtnLabel.textContent = isParticipantsStripHidden ? 'Mostrar Miniaturas' : 'Ocultar Miniaturas';
  }
  if (btnToggleParticipantsStrip) {
    btnToggleParticipantsStrip.classList.toggle('active', !isParticipantsStripHidden);
  }
}

/**
 * Define o modo de layout ativo: 'grid' (Mosaico), 'stage' (Palco) ou 'theater' (Teatro)
 */
function setLayoutMode(mode) {
  currentLayoutMode = (mode === 'stage' || mode === 'theater') ? mode : 'grid';
  try { localStorage.setItem('webrtc_layout_mode', currentLayoutMode); } catch (_) {}

  // Atualiza estado visual dos botões de controle de layout
  if (btnLayoutGrid) btnLayoutGrid.classList.toggle('active', currentLayoutMode === 'grid');
  if (btnLayoutStage) btnLayoutStage.classList.toggle('active', currentLayoutMode === 'stage');
  if (btnLayoutTheater) btnLayoutTheater.classList.toggle('active', currentLayoutMode === 'theater');

  if (btnToggleParticipantsStrip) {
    btnToggleParticipantsStrip.style.display = (currentLayoutMode === 'grid') ? 'none' : 'inline-flex';
  }

  if (roomBody) {
    roomBody.dataset.layout = currentLayoutMode;
    roomBody.classList.toggle('sidebar-collapsed', isSidebarCollapsed);
  }

  if (currentLayoutMode === 'theater') {
    videoGrid.classList.remove('stage-layout');
    videoGrid.classList.add('theater-layout', 'spotlight-active');
    ensureSpotlightSelected();
    toggleParticipantsStrip(isParticipantsStripHidden);
  } else if (currentLayoutMode === 'stage') {
    videoGrid.classList.remove('theater-layout');
    videoGrid.classList.add('stage-layout', 'spotlight-active');
    ensureSpotlightSelected();
    toggleParticipantsStrip(isParticipantsStripHidden);
  } else {
    videoGrid.classList.remove('stage-layout', 'spotlight-active', 'theater-layout');
    clearSpotlight();
    if (participantsStrip) {
      participantsStrip.classList.add('hidden');
    }
  }

  updateGridLayout();
}

/**
 * Garante que haja um card no palco ou teatro (prioriza tela compartilhada)
 */
function ensureSpotlightSelected() {
  if (activeTiles.size === 0) return;

  const canonicalCurrent = toCanonicalTileId(currentSpotlightId);
  if (canonicalCurrent) {
    for (const [id] of activeTiles.entries()) {
      if (areTileIdsEquivalent(id, canonicalCurrent)) {
        applySpotlightTile(id);
        return;
      }
    }
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
  if (!id) return;
  const canonicalId = toCanonicalTileId(id);
  currentSpotlightId = canonicalId;

  if (currentLayoutMode === 'stage') {
    videoGrid.classList.remove('theater-layout');
    videoGrid.classList.add('stage-layout', 'spotlight-active');
  } else if (currentLayoutMode === 'theater') {
    videoGrid.classList.remove('stage-layout');
    videoGrid.classList.add('theater-layout', 'spotlight-active');
  }

  let matched = false;
  document.querySelectorAll('.stream-tile').forEach(t => {
    const isTarget = areTileIdsEquivalent(t.dataset.tileId, canonicalId);
    if (isTarget) matched = true;
    t.classList.toggle('is-spotlight', isTarget);
    const focusBtn = t.querySelector('.btn-focus');
    if (focusBtn) focusBtn.classList.toggle('active', isTarget);
  });

  // Se nenhum tile coincidiu ainda (ex: acabou de ser montado), promove o primeiro no modo palco ou teatro
  if (!matched && (currentLayoutMode === 'stage' || currentLayoutMode === 'theater')) {
    const firstTile = document.querySelector('.stream-tile');
    if (firstTile) {
      firstTile.classList.add('is-spotlight');
      currentSpotlightId = toCanonicalTileId(firstTile.dataset.tileId);
      const focusBtn = firstTile.querySelector('.btn-focus');
      if (focusBtn) focusBtn.classList.add('active');
    }
  }

  renderParticipantsStrip();
}

function clearSpotlight() {
  currentSpotlightId = null;
  videoGrid.classList.remove('spotlight-active');
  document.querySelectorAll('.stream-tile').forEach(t => {
    t.classList.remove('is-spotlight');
    const focusBtn = t.querySelector('.btn-focus');
    if (focusBtn) focusBtn.classList.remove('active');
  });
  renderParticipantsStrip();
}

function toggleSidebar(forceState = null) {
  if (forceState !== null) {
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
      entry.videoEl.play().catch(e => console.warn('[App] Play tile:', e));
    } else if (entry.videoEl.paused) {
      entry.videoEl.play().catch(e => console.warn('[App] Resume tile:', e));
    }
    return entry;
  }

  console.log(`[TileManager] Criando novo card no grid: ${id} (${type})`);

  const tileEl = document.createElement('div');
  tileEl.className = 'stream-tile';
  tileEl.id = `tile-${id}`;
  tileEl.dataset.tileId = id;

  const badgeClass = type === 'screen' ? 'badge-screen' : 'badge-camera';
  const badgeLabel = type === 'screen' ? 'Tela 60 FPS' : 'Câmera';

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
  btnFocus.innerHTML = Icons.spotlight(14);
  btnFocus.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSpotlight(id);
  });

  const btnFull = document.createElement('button');
  btnFull.className = 'tile-btn btn-fullscreen';
  btnFull.title = 'Tela cheia deste vídeo';
  btnFull.innerHTML = Icons.maximize(14);
  btnFull.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTileFullscreen(tileEl);
  });

  // Grupo de Volume com Slider Integrado
  const volumeGroup = document.createElement('div');
  volumeGroup.className = 'tile-volume-group';

  const btnMute = document.createElement('button');
  btnMute.className = 'tile-btn btn-mute';
  btnMute.title = 'Mutar / Desmutar áudio';
  btnMute.innerHTML = isLocal ? Icons.volumeX(14) : Icons.volume2(14);

  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.className = 'tile-volume-slider';
  volumeSlider.min = '0';
  volumeSlider.max = '1';
  volumeSlider.step = '0.02';
  volumeSlider.value = isLocal ? '0' : '1';
  volumeSlider.title = 'Ajustar volume da transmissão (0 a 100%)';
  if (isLocal) {
    volumeSlider.disabled = true;
    volumeSlider.title = 'Prévia local com som silenciado para evitar eco';
  }

  let lastVolume = 1.0;

  const updateVolumeUi = () => {
    if (videoEl.muted || videoEl.volume === 0) {
      btnMute.innerHTML = Icons.volumeX(14);
      volumeSlider.value = '0';
    } else {
      btnMute.innerHTML = videoEl.volume > 0.4 ? Icons.volume2(14) : Icons.volume1(14);
      volumeSlider.value = String(videoEl.volume);
    }
  };

  volumeSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    const val = parseFloat(volumeSlider.value);
    if (val === 0) {
      videoEl.muted = true;
      videoEl.volume = 0;
    } else {
      videoEl.muted = false;
      videoEl.volume = val;
      lastVolume = val;
    }
    updateVolumeUi();
  });

  volumeSlider.addEventListener('click', (e) => e.stopPropagation());
  volumeSlider.addEventListener('pointerdown', (e) => e.stopPropagation());
  volumeSlider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  btnMute.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isLocal) return;
    if (videoEl.muted || videoEl.volume === 0) {
      videoEl.muted = false;
      videoEl.volume = lastVolume > 0 ? lastVolume : 1.0;
    } else {
      lastVolume = videoEl.volume > 0 ? videoEl.volume : lastVolume;
      videoEl.muted = true;
    }
    updateVolumeUi();
  });

  volumeGroup.appendChild(btnMute);
  volumeGroup.appendChild(volumeSlider);

  const btnClose = document.createElement('button');
  btnClose.className = 'tile-btn btn-close';
  btnClose.title = 'Fechar / Ocultar';
  btnClose.innerHTML = Icons.x(14);
  btnClose.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isLocal) {
      if (type === 'screen') handleToggleScreenShare();
      if (type === 'camera') handleToggleCamera();
    } else {
      toggleStreamSubscription(id, false);
    }
  });

  actionsEl.appendChild(btnFocus);
  actionsEl.appendChild(btnFull);
  actionsEl.appendChild(volumeGroup);
  actionsEl.appendChild(btnClose);

  const videoEl = document.createElement('video');
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.setAttribute('playsinline', '');
  videoEl.setAttribute('webkit-playsinline', '');
  videoEl.setAttribute('x5-playsinline', '');
  if (isLocal) {
    videoEl.muted = true;
    videoEl.volume = 0;
  }

  videoEl.srcObject = stream;

  tileEl.appendChild(headerEl);
  tileEl.appendChild(actionsEl);
  tileEl.appendChild(videoEl);
  videoGrid.appendChild(tileEl);

  // Configura comportamento de auto-hide em tela cheia para este tile
  setupTileFullscreenBehavior(tileEl);

  // Ao clicar em uma miniatura secundária no modo Palco ou Teatro, promove ela para o palco principal
  tileEl.addEventListener('click', (e) => {
    if (e.target.closest('.tile-btn') || e.target.closest('.tile-volume-group')) return;
    if (currentLayoutMode === 'stage' || currentLayoutMode === 'theater' || videoGrid.classList.contains('stage-layout') || videoGrid.classList.contains('theater-layout')) {
      if (!areTileIdsEquivalent(currentSpotlightId, id)) {
        applySpotlightTile(id);
      }
    }
  });

  // Duplo clique alterna tela cheia da transmissão
  tileEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tile-btn') || e.target.closest('.tile-volume-group')) return;
    toggleTileFullscreen(tileEl);
  });

  const safePlayVideo = () => {
    const playPromise = videoEl.play();
    if (playPromise !== undefined && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.warn('[TileManager] Autoplay com som bloqueado, mutando...', err.message);
        videoEl.muted = true;
        updateVolumeUi();
        videoEl.play().catch(e => console.warn('[TileManager] Fallback play falhou:', e.message));
        if (unmuteBanner) unmuteBanner.classList.remove('hidden');
      });
    }
  };

  videoEl.addEventListener('loadedmetadata', () => {
    if (videoEl.paused) safePlayVideo();
  });
  safePlayVideo();

  entry = { tileEl, videoEl, stream, type, isLocal, title };
  activeTiles.set(id, entry);

  if (currentLayoutMode === 'stage' || currentLayoutMode === 'theater') {
    if (!currentSpotlightId || areTileIdsEquivalent(currentSpotlightId, id) || activeTiles.size === 1) {
      applySpotlightTile(id);
    }
  }

  updateGridLayout();
  return entry;
}

/**
 * Remove um tile do grid e atualiza layout
 */
function removeTile(id) {
  const canonicalId = toCanonicalTileId(id);
  const entry = activeTiles.get(id) || activeTiles.get(canonicalId);
  if (!entry) {
    const orphanEl = document.getElementById(`tile-${id}`) || document.getElementById(`tile-${canonicalId}`);
    if (orphanEl) orphanEl.remove();
    if (activeTiles.size === 0 && (currentLayoutMode === 'stage' || currentLayoutMode === 'theater')) {
      setLayoutMode('grid');
    } else {
      updateGridLayout();
    }
    return;
  }

  if (entry.videoEl) {
    try {
      entry.videoEl.pause();
      entry.videoEl.srcObject = null;
      entry.videoEl.load();
    } catch (_) {}
  }

  entry.tileEl.remove();
  activeTiles.delete(id);
  activeTiles.delete(canonicalId);

  if (areTileIdsEquivalent(currentSpotlightId, id)) {
    currentSpotlightId = null;
    if (activeTiles.size === 0) {
      setLayoutMode('grid');
    } else if (currentLayoutMode === 'stage' || currentLayoutMode === 'theater') {
      ensureSpotlightSelected();
    } else {
      videoGrid.classList.remove('spotlight-active');
    }
  }

  if (activeTiles.size === 0 && (currentLayoutMode === 'stage' || currentLayoutMode === 'theater')) {
    setLayoutMode('grid');
  } else {
    updateGridLayout();
  }
}

function clearPeerSyncTimer(userId) {
  if (peerSyncTimers.has(userId)) {
    clearTimeout(peerSyncTimers.get(userId));
    peerSyncTimers.delete(userId);
  }
}

/**
 * Sincroniza dinamicamente as transmissões remotas de um usuário no grid
 * Garante que Tela e Câmera sejam exibidas em cards distintos e re-conectem instantaneamente
 * Utiliza retentativas controladas e limitadas com cancelamento, eliminando vazamento de CPU/RAM.
 */
function syncRemotePeerTiles(userId) {
  clearPeerSyncTimer(userId);

  const participant = roomState.participants.get(userId);
  const participantName = participant ? participant.name : `Usuário ${userId.substring(0, 4)}`;
  const userMedia = remoteUserMedia.get(userId) || { screen: false, camera: false };

  // Verifica se o usuário possui stream anunciada no catálogo de transmissões ativas
  const hasScreenInCatalog = Array.from(roomState.availableStreams.values()).some(
    s => s.hostId === userId && (s.sourceType === 'desktop' || s.sourceType === 'screen' || s.streamId?.endsWith('-screen') || s.streamId?.endsWith('-desktop'))
  );
  const hasCameraInCatalog = Array.from(roomState.availableStreams.values()).some(
    s => s.hostId === userId && (s.sourceType === 'camera' || s.streamId?.endsWith('-camera'))
  );

  const isScreenActive = Boolean(userMedia.screen || hasScreenInCatalog);
  const isCameraActive = Boolean(userMedia.camera || hasCameraInCatalog);

  let pendingTrack = false;

  // 1. Sincroniza Transmissão de Tela (Sob Demanda via Assinatura)
  const screenTileId = `${userId}-screen`;
  const isScreenSubscribed = roomState.isSubscribed(screenTileId);
  if (isScreenActive && isScreenSubscribed) {
    const screenStream = webrtc.getRemoteStreamForTile(userId, 'screen');
    const screenVideoTrack = webrtc.getRemoteVideoTrack(userId, 'screen');

    if (screenVideoTrack && (screenVideoTrack.readyState === 'live' || !screenVideoTrack.ended)) {
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
        if (tile && tile.videoEl && tile.videoEl.paused) {
          tile.videoEl.play().catch(() => {
            tile.videoEl.muted = true;
            tile.videoEl.play().catch(() => {});
          });
        }
      };

      screenVideoTrack.onended = () => {
        removeTile(screenTileId);
      };
    } else {
      pendingTrack = true;
    }
  } else {
    removeTile(screenTileId);
  }

  // 2. Sincroniza Transmissão de Câmera (Sob Demanda via Assinatura)
  const cameraTileId = `${userId}-camera`;
  const isCameraSubscribed = roomState.isSubscribed(cameraTileId);
  if (isCameraActive && isCameraSubscribed) {
    const cameraStream = webrtc.getRemoteStreamForTile(userId, 'camera');
    const cameraVideoTrack = webrtc.getRemoteVideoTrack(userId, 'camera');

    if (cameraVideoTrack && (cameraVideoTrack.readyState === 'live' || !cameraVideoTrack.ended)) {
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
        if (tile && tile.videoEl && tile.videoEl.paused) {
          tile.videoEl.play().catch(() => {
            tile.videoEl.muted = true;
            tile.videoEl.play().catch(() => {});
          });
        }
      };

      cameraVideoTrack.onended = () => {
        removeTile(cameraTileId);
      };
    } else {
      pendingTrack = true;
    }
  } else {
    removeTile(cameraTileId);
  }

  if (pendingTrack) {
    const retries = peerRetryCounts.get(userId) || 0;
    if (retries < 10) {
      peerRetryCounts.set(userId, retries + 1);
      const timer = setTimeout(() => {
        peerSyncTimers.delete(userId);
        syncRemotePeerTiles(userId);
      }, 350);
      peerSyncTimers.set(userId, timer);
    } else {
      peerRetryCounts.delete(userId);
    }
  } else {
    peerRetryCounts.delete(userId);
  }

  updateGridLayout();
}

/**
 * Alterna modo de foco (Spotlight) em uma transmissão específica
 */
function toggleSpotlight(id) {
  if (areTileIdsEquivalent(currentSpotlightId, id)) {
    if (currentLayoutMode === 'stage' || currentLayoutMode === 'theater') {
      setLayoutMode('grid');
    } else {
      clearSpotlight();
    }
  } else {
    if (currentLayoutMode !== 'theater') {
      setLayoutMode('stage');
    }
    applySpotlightTile(id);
  }
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth <= 900);
}

function updateMobileFullscreenOrientation(tileEl) {
  if (!tileEl) return;
  const isMobile = isMobileDevice();
  const isPortrait = window.innerHeight > window.innerWidth;

  if (document.fullscreenElement && isMobile && isPortrait) {
    const videoEl = tileEl.querySelector('video');
    // Só rotaciona se o vídeo for horizontal/landscape (ou se ainda não tiver dimensões nativas)
    const isLandscapeVideo = !videoEl || !videoEl.videoWidth || (videoEl.videoWidth >= videoEl.videoHeight);
    if (isLandscapeVideo) {
      tileEl.classList.add('fullscreen-mobile-rotated');
    } else {
      tileEl.classList.remove('fullscreen-mobile-rotated');
    }
  } else {
    tileEl.classList.remove('fullscreen-mobile-rotated');
  }
}

function toggleTileFullscreen(tileEl) {
  if (!document.fullscreenElement) {
    if (isMobileDevice() && screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => {});
    }
    if (tileEl.requestFullscreen) {
      tileEl.requestFullscreen().then(() => {
        updateMobileFullscreenOrientation(tileEl);
      }).catch(err => {
        // Fallback para Safari / navegadores mobile antigos
        const videoEl = tileEl.querySelector('video');
        if (videoEl && videoEl.webkitEnterFullscreen) {
          videoEl.webkitEnterFullscreen();
        } else {
          console.warn('[Fullscreen]', err);
        }
      });
    } else {
      const videoEl = tileEl.querySelector('video');
      if (videoEl && videoEl.webkitEnterFullscreen) {
        videoEl.webkitEnterFullscreen();
      }
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(err => console.warn('[Fullscreen]', err));
    }
  }
}

// ========================================================
// CONTROLE DE AUTO-HIDE EM TELA CHEIA (INATIVIDADE 2.5s)
// Oculta nome, fechar e controles até que o usuário mexa o mouse ou clique
// ========================================================
let fullscreenIdleTimer = null;

function handleFullscreenActivity(tileEl) {
  if (!document.fullscreenElement) return;
  tileEl.classList.remove('fullscreen-idle');
  tileEl.classList.add('fullscreen-active');

  if (fullscreenIdleTimer) {
    clearTimeout(fullscreenIdleTimer);
  }

  fullscreenIdleTimer = setTimeout(() => {
    if (document.fullscreenElement) {
      tileEl.classList.remove('fullscreen-active');
      tileEl.classList.add('fullscreen-idle');
    }
  }, 2500);
}

function setupTileFullscreenBehavior(tileEl) {
  const onActivity = () => {
    if (document.fullscreenElement) {
      if (document.fullscreenElement === tileEl || document.fullscreenElement.contains(tileEl) || tileEl.contains(document.fullscreenElement)) {
        handleFullscreenActivity(tileEl);
      }
    }
  };

  tileEl.addEventListener('mousemove', onActivity);
  tileEl.addEventListener('pointerdown', onActivity);
  tileEl.addEventListener('touchstart', onActivity, { passive: true });
}

document.addEventListener('fullscreenchange', () => {
  const fsEl = document.fullscreenElement;
  if (!fsEl) {
    if (fullscreenIdleTimer) {
      clearTimeout(fullscreenIdleTimer);
      fullscreenIdleTimer = null;
    }
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      try { screen.orientation.unlock(); } catch (_) {}
    }
    document.querySelectorAll('.stream-tile').forEach(tile => {
      tile.classList.remove('fullscreen-idle', 'fullscreen-active', 'is-fullscreen', 'fullscreen-mobile-rotated');
    });
  } else {
    if (isMobileDevice() && screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => {});
    }
    const targetTile = fsEl.classList.contains('stream-tile')
      ? fsEl
      : (fsEl.querySelector('.stream-tile.is-spotlight') || fsEl.querySelector('.stream-tile'));
    if (targetTile) {
      targetTile.classList.add('is-fullscreen');
      updateMobileFullscreenOrientation(targetTile);
      handleFullscreenActivity(targetTile);
    }
  }
});

window.addEventListener('resize', () => {
  if (document.fullscreenElement) {
    const fsEl = document.fullscreenElement;
    const targetTile = fsEl.classList.contains('stream-tile')
      ? fsEl
      : (fsEl.querySelector('.stream-tile.is-spotlight') || fsEl.querySelector('.stream-tile'));
    if (targetTile) {
      updateMobileFullscreenOrientation(targetTile);
    }
  }
});

window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    if (document.fullscreenElement) {
      const fsEl = document.fullscreenElement;
      const targetTile = fsEl.classList.contains('stream-tile')
        ? fsEl
        : (fsEl.querySelector('.stream-tile.is-spotlight') || fsEl.querySelector('.stream-tile'));
      if (targetTile) {
        updateMobileFullscreenOrientation(targetTile);
      }
    }
  }, 150);
});

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
      if (entry.isHidden || isDockMinimized) {
        try { entry.videoEl.pause(); } catch (_) {}
      } else {
        entry.videoEl.play().catch(e => console.warn('[LocalDock] Play:', e));
      }
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
  const badgeLabel = type === 'screen' ? 'Sua Tela (60 FPS)' : 'Câmera (Você)';

  const headerEl = document.createElement('div');
  headerEl.className = 'local-card-header';
  headerEl.innerHTML = `
    <span class="local-card-badge ${badgeClass}">${badgeLabel}</span>
    <div class="local-card-actions">
      <button class="local-card-btn btn-toggle-preview" title="Ocultar / Mostrar prévia">${Icons.eye(12)}</button>
      <button class="local-card-btn btn-pin-grid" title="Fixar / Desafixar no grid principal">${Icons.layoutGrid(12)}</button>
      <button class="local-card-btn btn-stop" title="Encerrar transmissão">${Icons.x(12)}</button>
    </div>
  `;

  const videoWrap = document.createElement('div');
  videoWrap.className = `local-card-video-wrap is-${type}`;

  const videoEl = document.createElement('video');
  videoEl.autoplay = false;
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.srcObject = stream;
  videoWrap.appendChild(videoEl);

  const hiddenNotice = document.createElement('div');
  hiddenNotice.className = 'local-hidden-notice hidden';
  hiddenNotice.innerHTML = `
    <span>${type === 'screen' ? 'Prévia pausada (Economia GPU/CPU)' : 'Câmera ativa (prévia pausada)'}</span>
    <button class="btn-unhide-preview">Mostrar</button>
  `;

  cardEl.appendChild(headerEl);
  cardEl.appendChild(videoWrap);
  cardEl.appendChild(hiddenNotice);
  localDockContent.appendChild(cardEl);

  entry = {
    cardEl,
    videoEl,
    videoWrap,
    hiddenNotice,
    stream,
    title,
    type,
    isHidden: false,
    isPinned: false,
    togglePreviewVisibility: null
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
    btnToggle.title = entry.isHidden ? 'Mostrar prévia' : 'Ocultar e pausar prévia';

    if (entry.videoEl) {
      if (entry.isHidden || isDockMinimized) {
        try { entry.videoEl.pause(); } catch (_) {}
      } else {
        entry.videoEl.play().catch(e => console.warn('[LocalDock] Play:', e));
      }
    }
  };
  entry.togglePreviewVisibility = togglePreviewVisibility;

  // Modo "Auto-Pausar Prévia Local Ao Transmitir": pausa renderização 1080p60 local para economizar CPU/GPU
  if (type === 'screen' && autoPauseLocalPreview) {
    togglePreviewVisibility(true);
  } else if (!isDockMinimized) {
    videoEl.play().catch(e => console.warn('[LocalDock] Autoplay:', e));
  }

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
      if (entry.videoEl) {
        try { entry.videoEl.pause(); } catch (_) {}
      }
    } else {
      removeTile(`local-${type}`);
      cardEl.style.display = 'block';
      if (entry.videoEl && !entry.isHidden && !isDockMinimized) {
        entry.videoEl.play().catch(() => {});
      }
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
  removeTile(`local-${type}`);
  if (roomState.myUserId) {
    removeTile(`${roomState.myUserId}-${type}`);
  }
  if (type === 'screen') {
    removeTile(`local-desktop`);
    if (roomState.myUserId) {
      removeTile(`${roomState.myUserId}-desktop`);
    }
  }

  const entry = localPreviews.get(type);
  if (entry) {
    if (entry.videoEl) {
      try {
        entry.videoEl.pause();
        entry.videoEl.srcObject = null;
      } catch (_) {}
    }
    entry.cardEl.remove();
    localPreviews.delete(type);
  }

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
      const types = Array.from(localPreviews.keys()).map(t => t === 'screen' ? 'Tela 60 FPS' : 'Câmera').join(' + ');
      localDockPillLabel.textContent = `${types} Ativa${localPreviews.size > 1 ? 's' : ''} (Pausada)`;
      // Garante que o decodificador/compositor local pare de desenhar quadros enquanto minimizado
      localPreviews.forEach(p => {
        if (p.videoEl && !p.videoEl.paused) {
          try { p.videoEl.pause(); } catch (_) {}
        }
      });
    } else {
      localDock.classList.remove('hidden');
      localDockPill.classList.add('hidden');
      localPreviews.forEach(p => {
        if (p.videoEl && !p.isHidden && !p.isPinned && p.videoEl.paused) {
          p.videoEl.play().catch(() => {});
        }
      });
    }
  }
  updateGridLayout();
}

// ========================================================
// GERENCIADOR DE ÁUDIO REMOTO E DETECÇÃO DE VOZ ATIVA (VAD)
// Sinaliza quando um participante está falando (contorno/card verde)
// ========================================================
const peerAudioElements = new Map(); // Map<userId, HTMLAudioElement>

function playRemoteAudioTrack(userId, track) {
  if (!track || track.kind !== 'audio') return;
  let audioEl = peerAudioElements.get(userId);
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.autoplay = true;
    peerAudioElements.set(userId, audioEl);
  }
  let stream = audioEl.srcObject;
  if (!stream || !(stream instanceof MediaStream)) {
    stream = new MediaStream();
    audioEl.srcObject = stream;
  }
  if (!stream.getTracks().some(t => t.id === track.id)) {
    stream.addTrack(track);
  }
  audioEl.play().catch(e => console.warn('[App] Play remote audio error:', e));

  // Monitora a voz deste participante remoto
  vad.monitorStream(userId, stream);
}

class VoiceActivityDetector {
  constructor() {
    this.audioCtx = null;
    this.monitoredStreams = new Map(); // Map<userId, { analyser, dataArray, source, lastSpoke }>
    this.speakingState = new Map(); // Map<userId, boolean>
    this.checkInterval = null;
  }

  ensureContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  monitorStream(userId, stream) {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    this.stopMonitoring(userId);

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      this.monitoredStreams.set(userId, { analyser, dataArray, source, stream, lastSpoke: 0 });

      this.startLoop();
    } catch (err) {
      console.warn('[VAD] Erro ao monitorar stream de áudio:', err);
    }
  }

  stopMonitoring(userId) {
    const entry = this.monitoredStreams.get(userId);
    if (entry) {
      try { entry.source.disconnect(); } catch (_) {}
      this.monitoredStreams.delete(userId);
    }
    this.setSpeaking(userId, false);
    if (this.monitoredStreams.size === 0 && this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  startLoop() {
    if (this.checkInterval) return;
    // Intervalo otimizado para 150ms (reduz em 60% as chamadas getByteFrequencyData no processo Renderer)
    this.checkInterval = setInterval(() => {
      const now = Date.now();
      this.monitoredStreams.forEach((entry, userId) => {
        // Se for o usuário local e o microfone estiver mutado, pausa leitura de FFT
        if (userId === roomState.myUserId) {
          if (media && typeof media.isAudioMuted === 'function' && media.isAudioMuted()) {
            this.setSpeaking(userId, false);
            return;
          }
        }
        // Também ignora se todas as tracks de áudio do stream estiverem desabilitadas ou encerradas
        if (entry.stream && typeof entry.stream.getAudioTracks === 'function') {
          const tracks = entry.stream.getAudioTracks();
          if (tracks.length === 0 || tracks.every(t => !t.enabled || t.readyState === 'ended')) {
            this.setSpeaking(userId, false);
            return;
          }
        }

        entry.analyser.getByteFrequencyData(entry.dataArray);
        let sum = 0;
        for (let i = 0; i < entry.dataArray.length; i++) {
          sum += entry.dataArray[i];
        }
        const avg = sum / entry.dataArray.length;

        // Limiar de detecção de fala (volume da voz humana)
        if (avg > 13) {
          entry.lastSpoke = now;
          this.setSpeaking(userId, true);
        } else if (now - entry.lastSpoke > 350) {
          this.setSpeaking(userId, false);
        }
      });
    }, 150);
  }

  setSpeaking(userId, isSpeaking) {
    const current = this.speakingState.get(userId) || false;
    if (current === isSpeaking) return;
    this.speakingState.set(userId, isSpeaking);

    // Atualiza cards de chamada no Grid
    document.querySelectorAll(`.participant-card[data-user-id="${userId}"]`).forEach(card => {
      card.classList.toggle('is-speaking', isSpeaking);
    });

    // Atualiza miniaturas na Tira inferior
    document.querySelectorAll(`.strip-card[data-user-id="${userId}"]`).forEach(card => {
      card.classList.toggle('is-speaking', isSpeaking);
    });
  }
}

const vad = new VoiceActivityDetector();

/**
 * Renderiza os cards de participantes estilo Discord Voice Call no Grid principal
 */
function renderCallParticipants() {
  if (!videoGrid) return;

  const participants = Array.from(roomState.participants.values());
  const allStreams = roomState.getAllStreams();

  // Se não estiver no modo grid, remove cards de participantes e atualiza strip
  if (currentLayoutMode !== 'grid') {
    videoGrid.querySelectorAll('.participant-card').forEach(el => el.remove());
    renderParticipantsStrip();
    return;
  }

  // 1. No modo GRID (Mosaico), reconciliação in-place (dirty-checking) dos cards de participantes
  const existingCards = new Map();
  videoGrid.querySelectorAll('.participant-card').forEach(el => {
    if (el.dataset.userId) existingCards.set(el.dataset.userId, el);
  });
  const currentParticipantIds = new Set(participants.map(p => p.id));

  // Remove cards de usuários que já saíram
  for (const [uid, el] of existingCards.entries()) {
    if (!currentParticipantIds.has(uid)) {
      el.remove();
      existingCards.delete(uid);
    }
  }

  participants.forEach(user => {
    const isSelf = user.id === roomState.myUserId;
    let userStreams = allStreams.filter(s => s.hostId === user.id);

    if (isSelf) {
      if (media.hasActiveScreenStream() && !userStreams.some(s => s.sourceType === 'desktop' || s.sourceType === 'screen')) {
        userStreams.push({
          streamId: `${user.id}-screen`,
          hostId: user.id,
          hostName: user.name,
          sourceType: 'desktop',
          title: 'Sua Tela (60 FPS)',
          status: 'live'
        });
      }
      if (media.hasActiveCamera() && !userStreams.some(s => s.sourceType === 'camera')) {
        userStreams.push({
          streamId: `${user.id}-camera`,
          hostId: user.id,
          hostName: user.name,
          sourceType: 'camera',
          title: 'Sua Câmera',
          status: 'live'
        });
      }
    }

    const screenStream = userStreams.find(s => s.sourceType === 'desktop' || s.sourceType === 'screen' || s.streamId?.endsWith('-screen') || s.streamId?.endsWith('-desktop'));
    const cameraStream = userStreams.find(s => s.sourceType === 'camera' || s.streamId?.endsWith('-camera'));

    const isScreenSubscribed = screenStream ? (isSelf || roomState.isSubscribed(screenStream.streamId) || activeTiles.has(toCanonicalTileId(screenStream.streamId))) : false;
    const isCameraSubscribed = cameraStream ? (isSelf || roomState.isSubscribed(cameraStream.streamId) || activeTiles.has(toCanonicalTileId(cameraStream.streamId))) : false;

    const hasLiveStream = Boolean(screenStream || cameraStream);
    const isSpeaking = vad.speakingState.get(user.id) || false;

    let isMuted = false;
    if (isSelf) {
      try {
        if (media && typeof media.isAudioMuted === 'function') {
          isMuted = media.isAudioMuted();
        } else if (media && typeof media.isaudioMuted === 'function') {
          isMuted = media.isaudioMuted();
        } else if (media) {
          isMuted = Boolean(media.isMuted || media.micMuted);
        }
      } catch (_) {
        isMuted = false;
      }
    } else {
      isMuted = Boolean(user.isMuted);
    }
    const micIconHtml = isMuted ? Icons.micOff(13) : Icons.mic(13);

    // Assinatura estrutural do card: se não mudar, atualiza apenas classes e atributos in-place!
    const structKey = `${user.id}#${user.name}#${user.isHost ? '1' : '0'}#${hasLiveStream ? '1' : '0'}#${screenStream?.streamId || ''}#${cameraStream?.streamId || ''}#${isScreenSubscribed ? '1' : '0'}#${isCameraSubscribed ? '1' : '0'}`;

    const existingCard = existingCards.get(user.id);
    if (existingCard && existingCard.dataset.structKey === structKey) {
      // Atualização in-place sem reconstruir o DOM
      existingCard.classList.toggle('is-speaking', isSpeaking);
      const micIndicator = existingCard.querySelector('.participant-mic-indicator');
      if (micIndicator) {
        micIndicator.classList.toggle('is-muted', isMuted);
        micIndicator.title = isMuted ? 'Microfone silenciado' : 'Microfone ativo';
        if (micIndicator.dataset.isMuted !== String(isMuted)) {
          micIndicator.innerHTML = micIconHtml;
          micIndicator.dataset.isMuted = String(isMuted);
        }
      }
      return;
    }

    // Criação ou substituição estrutural quando houver alteração de stream/estado
    const card = document.createElement('div');
    card.className = `participant-card ${isSelf ? 'is-self' : ''} ${user.isHost ? 'is-host' : ''} ${hasLiveStream ? 'is-live' : ''} ${isSpeaking ? 'is-speaking' : ''}`;
    card.dataset.userId = user.id;
    card.dataset.structKey = structKey;

    const userColor = getParticipantColor(user);
    const initials = getUserInitials(user.name);

    let liveBannerHtml = '';
    let watchActionsHtml = '';

    if (hasLiveStream) {
      const badges = [];
      if (screenStream) badges.push(`${Icons.monitor(12)} <span>Tela</span>`);
      if (cameraStream) badges.push(`${Icons.video(12)} <span>Câmera</span>`);

      liveBannerHtml = `
        <div class="participant-live-banner">
          <span class="badge-live"><span class="badge-live-dot"></span> AO VIVO</span>
          <span class="live-source-pill">${badges.join(' • ')}</span>
        </div>
      `;

      if (!isSelf) {
        if (screenStream && cameraStream) {
          watchActionsHtml = `
            <div class="participant-watch-actions">
              <button type="button" class="btn-watch-stream btn-sm-action ${isScreenSubscribed ? 'watching' : ''} btn-watch-screen" data-action="screen" title="${isScreenSubscribed ? 'Assistindo Tela' : 'Assistir Tela'}">
                ${Icons.monitor(12)} <span>${isScreenSubscribed ? 'Tela Ativa' : 'Assistir Tela'}</span>
              </button>
              <button type="button" class="btn-watch-stream btn-sm-action ${isCameraSubscribed ? 'watching' : ''} btn-watch-camera" data-action="camera" title="${isCameraSubscribed ? 'Assistindo Câmera' : 'Assistir Câmera'}">
                ${Icons.video(12)} <span>${isCameraSubscribed ? 'Câmera Ativa' : 'Assistir Câmera'}</span>
              </button>
              <button type="button" class="btn-watch-stream btn-sm-action btn-watch-both" data-action="both" title="Assistir à tela e à câmera simultaneamente">
                <span>Assistir Ambos</span>
              </button>
            </div>
          `;
        } else if (screenStream) {
          watchActionsHtml = `
            <button type="button" class="btn-watch-stream ${isScreenSubscribed ? 'watching' : ''}" data-action="screen" title="${isScreenSubscribed ? 'Assistindo à tela' : 'Assistir à transmissão de tela'}">
              ${Icons.monitor(13)}
              <span>${isScreenSubscribed ? 'Assistindo Tela' : 'Assistir Tela'}</span>
            </button>
          `;
        } else if (cameraStream) {
          watchActionsHtml = `
            <button type="button" class="btn-watch-stream btn-watch-camera ${isCameraSubscribed ? 'watching' : ''}" data-action="camera" title="${isCameraSubscribed ? 'Assistindo à câmera' : 'Assistir à câmera'}">
              ${Icons.video(13)}
              <span>${isCameraSubscribed ? 'Assistindo Câmera' : 'Assistir Câmera'}</span>
            </button>
          `;
        }
      } else {
        if (screenStream && cameraStream) {
          watchActionsHtml = `
            <div class="participant-watch-actions">
              <button type="button" class="btn-watch-stream btn-sm-action btn-self-view" data-action="self-screen" title="Ver sua tela no palco principal">
                ${Icons.monitor(12)} <span>Ver Tela no Palco</span>
              </button>
              <button type="button" class="btn-watch-stream btn-sm-action btn-self-view" data-action="self-camera" title="Ver sua câmera no palco principal">
                ${Icons.video(12)} <span>Ver Câmera no Palco</span>
              </button>
            </div>
          `;
        } else if (screenStream) {
          watchActionsHtml = `
            <button type="button" class="btn-watch-stream btn-self-view" data-action="self-screen" title="Ver sua tela no palco principal">
              ${Icons.monitor(13)} <span>Ver Tela no Palco</span>
            </button>
          `;
        } else if (cameraStream) {
          watchActionsHtml = `
            <button type="button" class="btn-watch-stream btn-self-view" data-action="self-camera" title="Ver sua câmera no palco principal">
              ${Icons.video(13)} <span>Ver Câmera no Palco</span>
            </button>
          `;
        }
      }
    }

    card.innerHTML = `
      ${liveBannerHtml}
      <div class="participant-avatar-wrap">
        <div class="participant-avatar" style="--user-color: ${userColor}; background-color: ${userColor};">
          ${escapeHtml(initials)}
        </div>
      </div>
      ${watchActionsHtml}
      <div class="participant-footer">
        <div class="participant-name-tag">
          <span>${escapeHtml(user.name)}</span>
          ${isSelf ? '<span class="tag-badge">Você</span>' : ''}
          ${user.isHost ? '<span class="tag-badge">HOST</span>' : ''}
        </div>
        <div class="participant-mic-indicator ${isMuted ? 'is-muted' : ''}" data-is-muted="${isMuted}" title="${isMuted ? 'Microfone silenciado' : 'Microfone ativo'}">
          ${micIconHtml}
        </div>
      </div>
    `;

    // Handlers de interação
    const screenAction = (e) => {
      if (e) e.stopPropagation();
      if (!screenStream) return;
      if (!isScreenSubscribed) toggleStreamSubscription(screenStream.streamId, true);
      setLayoutMode('stage');
      const target = toCanonicalTileId(screenStream.streamId);
      applySpotlightTile(target);
    };

    const cameraAction = (e) => {
      if (e) e.stopPropagation();
      if (!cameraStream) return;
      if (!isCameraSubscribed) toggleStreamSubscription(cameraStream.streamId, true);
      setLayoutMode('stage');
      const target = toCanonicalTileId(cameraStream.streamId);
      applySpotlightTile(target);
    };

    const bothAction = (e) => {
      if (e) e.stopPropagation();
      if (screenStream && !isScreenSubscribed) toggleStreamSubscription(screenStream.streamId, true);
      if (cameraStream && !isCameraSubscribed) toggleStreamSubscription(cameraStream.streamId, true);
      setLayoutMode('stage');
      if (screenStream) applySpotlightTile(toCanonicalTileId(screenStream.streamId));
    };

    const selfScreenAction = (e) => {
      if (e) e.stopPropagation();
      if (media.screenStream) {
        addOrUpdateTile({
          id: 'local-screen',
          title: 'Sua Tela (60 FPS)',
          stream: media.screenStream,
          isLocal: true,
          type: 'screen'
        });
        setLayoutMode('stage');
        applySpotlightTile('local-screen');
      }
    };

    const selfCameraAction = (e) => {
      if (e) e.stopPropagation();
      if (media.cameraStream) {
        addOrUpdateTile({
          id: 'local-camera',
          title: 'Sua Câmera',
          stream: media.cameraStream,
          isLocal: true,
          type: 'camera'
        });
        setLayoutMode('stage');
        applySpotlightTile('local-camera');
      }
    };

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.action;
        if (action === 'screen') screenAction(e);
        else if (action === 'camera') cameraAction(e);
        else if (action === 'both') bothAction(e);
        else if (action === 'self-screen') selfScreenAction(e);
        else if (action === 'self-camera') selfCameraAction(e);
      });
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (!isSelf) {
        if (screenStream) screenAction(e);
        else if (cameraStream) cameraAction(e);
      } else {
        if (media.screenStream) selfScreenAction(e);
        else if (media.cameraStream) selfCameraAction(e);
      }
    });
    if (hasLiveStream) card.style.cursor = 'pointer';

    if (existingCard) {
      existingCard.replaceWith(card);
    } else {
      videoGrid.appendChild(card);
    }
  });

  // 2. Renderiza as miniaturas na tira de participantes (Modo Palco e Teatro)
  renderParticipantsStrip();
}

/**
 * Renderiza as miniaturas de todos os participantes na barra/tira inferior do modo Palco e Teatro
 * Inclui prévias de vídeo ao vivo para câmeras e telas secundárias com dirty checking e sem desconectar <video>
 */
function renderParticipantsStrip() {
  if (!participantsStripList) return;

  const participants = Array.from(roomState.participants.values());
  const allStreams = roomState.getAllStreams();
  const renderedTileIds = new Set();
  const renderedUserIds = new Set();

  const existingCardsByTileId = new Map();
  const existingCardsByStreamId = new Map();
  const existingCardsByUserId = new Map();

  participantsStripList.querySelectorAll('.strip-card').forEach(el => {
    if (el.dataset.tileId) existingCardsByTileId.set(el.dataset.tileId, el);
    else if (el.dataset.streamId) existingCardsByStreamId.set(el.dataset.streamId, el);
    else if (el.dataset.userId) existingCardsByUserId.set(el.dataset.userId, el);
  });

  const usedNodes = new Set();

  // 1. Renderiza TODOS os cards de transmissões atualmente ativas no activeTiles
  for (const [tileId, entry] of activeTiles.entries()) {
    renderedTileIds.add(tileId);
    renderedTileIds.add(toCanonicalTileId(tileId));

    const isSpotlight = areTileIdsEquivalent(tileId, currentSpotlightId);
    const isScreen = entry.type === 'screen';
    const isLocal = Boolean(entry.isLocal);

    let userId = null;
    if (isLocal) {
      userId = roomState.myUserId;
    } else {
      userId = tileId.replace(/-screen$|-camera$|-desktop$/, '');
    }
    if (userId) renderedUserIds.add(userId);

    const participant = userId ? roomState.participants.get(userId) : null;
    const participantName = participant ? participant.name : (isLocal ? 'Você' : (entry.title || 'Participante'));
    const isSpeaking = userId ? (vad.speakingState.get(userId) || false) : false;

    let videoThumb = stripVideoThumbnails.get(tileId);
    if (!videoThumb) {
      videoThumb = document.createElement('video');
      videoThumb.autoplay = true;
      videoThumb.playsInline = true;
      videoThumb.setAttribute('playsinline', '');
      videoThumb.setAttribute('webkit-playsinline', '');
      videoThumb.muted = true;
      videoThumb.volume = 0;
      stripVideoThumbnails.set(tileId, videoThumb);
    }

    if (entry.stream && videoThumb.srcObject !== entry.stream) {
      videoThumb.srcObject = entry.stream;
      videoThumb.play().catch(() => {});
    }

    let card = existingCardsByTileId.get(tileId);
    if (card) {
      // Reconciliação in-place sem remontar o DOM
      card.classList.toggle('active-spotlight', isSpotlight);
      card.classList.toggle('is-speaking', isSpeaking);
      const focusCue = card.querySelector('.strip-focus-cue');
      if (focusCue) focusCue.textContent = isSpotlight ? '✓ Ativo' : 'Destaque';

      const badgesTop = card.querySelector('.strip-badges-top');
      if (badgesTop) {
        let spotBadge = badgesTop.querySelector('.strip-badge-spotlight');
        if (isSpotlight && !spotBadge) {
          spotBadge = document.createElement('span');
          spotBadge.className = 'strip-badge-spotlight';
          spotBadge.textContent = 'DESTAQUE';
          badgesTop.appendChild(spotBadge);
        } else if (!isSpotlight && spotBadge) {
          spotBadge.remove();
        }
      }

      const vCont = card.querySelector('.strip-video-container');
      if (vCont && !vCont.contains(videoThumb)) {
        vCont.appendChild(videoThumb);
      }
      usedNodes.add(card);
    } else {
      card = document.createElement('div');
      card.className = `strip-card strip-video-card ${isSpotlight ? 'active-spotlight' : ''} ${isScreen ? 'is-screen' : 'is-camera'} ${isSpeaking ? 'is-speaking' : ''}`;
      if (userId) card.dataset.userId = userId;
      card.dataset.tileId = tileId;
      card.title = `${participantName} (${isScreen ? 'Tela' : 'Câmera'}) - Clique para colocar em destaque`;

      const videoContainer = document.createElement('div');
      videoContainer.className = 'strip-video-container';
      videoContainer.appendChild(videoThumb);

      const overlay = document.createElement('div');
      overlay.className = 'strip-overlay';
      overlay.innerHTML = `
        <div class="strip-badges-top">
          <span class="strip-badge-type ${isScreen ? 'badge-screen' : 'badge-camera'}">${isScreen ? 'Tela' : 'Câmera'}</span>
          ${isSpotlight ? '<span class="strip-badge-spotlight">DESTAQUE</span>' : ''}
        </div>
        <div class="strip-info-bottom">
          <span class="strip-label-text">${escapeHtml(participantName)}</span>
          <span class="strip-focus-cue">${isSpotlight ? '✓ Ativo' : 'Destaque'}</span>
        </div>
      `;

      card.appendChild(videoContainer);
      card.appendChild(overlay);

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isSpotlight) {
          applySpotlightTile(tileId);
        }
      });

      participantsStripList.appendChild(card);
      usedNodes.add(card);
    }
  }

  // 2. Renderiza transmissões anunciadas na sala que ainda NÃO foram abertas/inscritas pelo usuário
  allStreams.forEach(streamInfo => {
    const canonicalId = toCanonicalTileId(streamInfo.streamId);
    if (renderedTileIds.has(streamInfo.streamId) || renderedTileIds.has(canonicalId)) {
      return;
    }

    const host = roomState.participants.get(streamInfo.hostId);
    const hostName = host ? host.name : (streamInfo.hostName || 'Participante');
    const isScreen = streamInfo.sourceType === 'desktop' || streamInfo.sourceType === 'screen';
    const userColor = host ? getParticipantColor(host) : '#5865F2';
    const initials = getUserInitials(hostName);
    const isSpeaking = streamInfo.hostId ? (vad.speakingState.get(streamInfo.hostId) || false) : false;

    let stripCard = existingCardsByStreamId.get(streamInfo.streamId);
    if (stripCard) {
      stripCard.classList.toggle('is-speaking', isSpeaking);
      usedNodes.add(stripCard);
    } else {
      stripCard = document.createElement('div');
      stripCard.className = `strip-card is-live has-stream-option ${isSpeaking ? 'is-speaking' : ''}`;
      if (streamInfo.hostId) stripCard.dataset.userId = streamInfo.hostId;
      stripCard.dataset.streamId = streamInfo.streamId;
      stripCard.title = `${hostName} transmitindo ${isScreen ? 'Tela' : 'Câmera'} ao vivo - Clique para assistir e destacar`;

      stripCard.innerHTML = `
        <span class="strip-live-badge">${isScreen ? 'TELA' : 'CÂMERA'}</span>
        <div class="strip-avatar" style="--user-color: ${userColor}; background-color: ${userColor};">
          ${escapeHtml(initials)}
        </div>
        <span class="strip-name">${escapeHtml(hostName)}</span>
      `;

      stripCard.addEventListener('click', () => {
        toggleStreamSubscription(streamInfo.streamId, true);
        const isTheater = currentLayoutMode === 'theater';
        if (!isTheater) setLayoutMode('stage');
        applySpotlightTile(canonicalId);
        setTimeout(() => applySpotlightTile(canonicalId), 150);
        setTimeout(() => applySpotlightTile(canonicalId), 400);
      });

      participantsStripList.appendChild(stripCard);
      usedNodes.add(stripCard);
    }

    renderedTileIds.add(streamInfo.streamId);
    renderedTileIds.add(canonicalId);
    if (streamInfo.hostId) renderedUserIds.add(streamInfo.hostId);
  });

  // 3. Renderiza os demais participantes da sala (apenas áudio / sem transmissão de vídeo ativa)
  participants.forEach(user => {
    if (renderedUserIds.has(user.id)) return;

    const isSelf = user.id === roomState.myUserId;
    const userColor = getParticipantColor(user);
    const initials = getUserInitials(user.name);
    const isSpeaking = vad.speakingState.get(user.id) || false;

    let stripCard = existingCardsByUserId.get(user.id);
    if (stripCard) {
      stripCard.classList.toggle('is-speaking', isSpeaking);
      usedNodes.add(stripCard);
    } else {
      stripCard = document.createElement('div');
      stripCard.className = `strip-card ${isSpeaking ? 'is-speaking' : ''}`;
      stripCard.dataset.userId = user.id;
      stripCard.title = `${user.name}${isSelf ? ' (Você)' : ''}`;

      stripCard.innerHTML = `
        <div class="strip-avatar" style="--user-color: ${userColor}; background-color: ${userColor};">
          ${escapeHtml(initials)}
        </div>
        <span class="strip-name">${escapeHtml(user.name)}${isSelf ? ' (Você)' : ''}</span>
      `;

      participantsStripList.appendChild(stripCard);
      usedNodes.add(stripCard);
    }
  });

  // 4. Remove nós órfãos que não estão mais ativos na sala
  participantsStripList.querySelectorAll('.strip-card').forEach(el => {
    if (!usedNodes.has(el)) {
      el.remove();
    }
  });

  // 5. Limpeza periódica do cache de miniaturas de vídeo (libera decodificadores e streams obsoletos)
  for (const [tId, vEl] of stripVideoThumbnails.entries()) {
    if (!activeTiles.has(tId) && !activeTiles.has(toCanonicalTileId(tId))) {
      try {
        vEl.pause();
        vEl.srcObject = null;
        vEl.load();
        vEl.remove();
      } catch (_) {}
      stripVideoThumbnails.delete(tId);
    }
  }
}

/**
 * Atualiza layout do grid e placeholder informativo
 */
function updateGridLayout() {
  // Renderiza primeiro os cards dos participantes para calcular contagem exata no grid
  renderCallParticipants();

  const activeTileCount = activeTiles.size;
  const participantCards = (currentLayoutMode === 'grid') ? videoGrid.querySelectorAll('.participant-card').length : 0;
  const totalCount = activeTileCount + participantCards;

  videoGrid.dataset.count = totalCount;

  if (currentLayoutMode === 'theater') {
    videoGrid.classList.remove('stage-layout');
    videoGrid.classList.add('theater-layout', 'spotlight-active');
    ensureSpotlightSelected();
    if (participantsStrip) {
      participantsStrip.classList.toggle('hidden', isParticipantsStripHidden);
    }
  } else if (currentLayoutMode === 'stage') {
    videoGrid.classList.remove('theater-layout');
    videoGrid.classList.add('stage-layout', 'spotlight-active');
    ensureSpotlightSelected();
    if (participantsStrip) {
      participantsStrip.classList.toggle('hidden', isParticipantsStripHidden);
    }
  } else {
    videoGrid.classList.remove('stage-layout', 'spotlight-active', 'theater-layout');
    clearSpotlight();
    if (participantsStrip) {
      participantsStrip.classList.add('hidden');
    }
  }

  // Mantém streamPlaceholder permanentemente oculto (layout unificado de chamada estilo Discord / Meet)
  if (streamPlaceholder) {
    streamPlaceholder.classList.add('hidden');
    streamPlaceholder.style.display = 'none';
  }

  const streamCount = roomState.availableStreams.size;
  const participantCount = Math.max(roomState.participants.size, 1);
  updateConnectionStatus('connected', `${participantCount} participante${participantCount > 1 ? 's' : ''}${streamCount > 0 ? ` • ${streamCount} ao vivo` : ''}`);
}

// ========================================================
// RECONEXÃO AUTOMÁTICA, ÚLTIMA SALA E DIAGNÓSTICO EM TEMPO REAL
// ========================================================
function showReconnectBanner(text, isFailed = false) {
  const banner = document.getElementById('reconnectBanner');
  const bannerText = document.getElementById('reconnectBannerText');
  const spinner = banner?.querySelector('.reconnect-spinner');
  if (!banner) return;
  if (bannerText) bannerText.textContent = text;
  if (spinner) spinner.style.display = isFailed ? 'none' : 'inline-block';
  banner.classList.remove('hidden');
}

function hideReconnectBanner() {
  const banner = document.getElementById('reconnectBanner');
  if (banner) banner.classList.add('hidden');
}

function updateLastRoomCardUI() {
  const lastRoomCard = document.getElementById('lastRoomCard');
  const lastRoomIdDisplay = document.getElementById('lastRoomIdDisplay');
  const lastRoomUserDisplay = document.getElementById('lastRoomUserDisplay');
  if (!lastRoomCard) return;

  const last = RoomState.getLastRoom();
  const savedUser = (() => {
    try { return localStorage.getItem('webrtc_username'); } catch (_) { return null; }
  })();
  const userToShow = (last && last.username) ? last.username : (savedUser || 'Usuário');

  if (last && last.roomId) {
    if (lastRoomIdDisplay) lastRoomIdDisplay.textContent = last.roomId;
    if (lastRoomUserDisplay) lastRoomUserDisplay.textContent = userToShow;
    lastRoomCard.classList.remove('hidden');
  } else {
    lastRoomCard.classList.add('hidden');
  }
}

let diagnosticsInterval = null;

async function renderDiagnosticsData() {
  const diagGpuRenderer = document.getElementById('diagGpuRenderer');
  const diagGpuDriver = document.getElementById('diagGpuDriver');
  const diagGpuDecode = document.getElementById('diagGpuDecode');
  const diagGpuEncode = document.getElementById('diagGpuEncode');
  const diagCpuUsage = document.getElementById('diagCpuUsage');
  const diagMemoryUsage = document.getElementById('diagMemoryUsage');
  const diagGpuStatusBadge = document.getElementById('diagGpuStatusBadge');
  const diagGpuEncProfiles = document.getElementById('diagGpuEncProfiles');
  const diagGpuWorkarounds = document.getElementById('diagGpuWorkarounds');
  const diagGpuLogs = document.getElementById('diagGpuLogs');
  const diagRtcSenderProfiles = document.getElementById('diagRtcSenderProfiles');

  let gpuDiag = null;

  if (window.desktopAPI && typeof window.desktopAPI.getGpuDiagnostics === 'function') {
    try {
      gpuDiag = await window.desktopAPI.getGpuDiagnostics();
      if (gpuDiag) {
        const gpuName = gpuDiag.systemGpu?.name || gpuDiag.gpuInfo?.gpuDevice?.[0]?.description || gpuDiag.gpuInfo?.gpuDevice?.[0]?.deviceString || 'GPU Dedicada (Desktop)';
        const gpuDriver = gpuDiag.systemGpu?.driverVersion || gpuDiag.gpuInfo?.gpuDevice?.[0]?.driverVersion || 'Nativo Windows (DirectX/MediaFoundation)';

        if (diagGpuRenderer) diagGpuRenderer.textContent = gpuName;
        if (diagGpuDriver) diagGpuDriver.textContent = gpuDriver;

        const evaluated = evaluateCodecCapabilities(
          { description: gpuName, vendor: gpuName },
          gpuDiag.featureStatus || {}
        );
        webrtc.setHardwareCapabilities(evaluated);

        // Atualiza badges dinâmicos de codecs nas configurações se existirem
        const badgeH264 = document.getElementById('badgeH264Status');
        const badgeAv1 = document.getElementById('badgeAv1Status');
        const descH264 = document.getElementById('descH264Status');
        const descAv1 = document.getElementById('descAv1Status');

        if (badgeH264 && evaluated.codecs?.H264) {
          badgeH264.textContent = evaluated.codecs.H264.hardwareSupported ? 'GPU ⚡' : 'Software ⚠️';
          badgeH264.className = evaluated.codecs.H264.hardwareSupported ? 'badge badge-success' : 'badge badge-secondary';
        }
        if (descH264 && evaluated.codecs?.H264) {
          descH264.textContent = evaluated.codecs.H264.description;
        }
        if (badgeAv1 && evaluated.codecs?.AV1) {
          badgeAv1.textContent = evaluated.codecs.AV1.hardwareSupported ? 'GPU ⚡' : 'Software CPU ⚠️';
          badgeAv1.className = evaluated.codecs.AV1.hardwareSupported ? 'badge badge-success' : 'badge badge-secondary';
        }
        if (descAv1 && evaluated.codecs?.AV1) {
          descAv1.textContent = evaluated.codecs.AV1.description;
        }

        const videoDecodeStatus = gpuDiag.featureStatus?.video_decode || 'unknown';
        const videoEncodeStatus = gpuDiag.featureStatus?.video_encode || gpuDiag.featureStatus?.accelerated_video_encode || 'unknown';

        const isDecodeHw = videoDecodeStatus === 'enabled' || videoDecodeStatus === 'hardware_accelerated';
        const isEncodeHw = videoEncodeStatus === 'enabled' || videoEncodeStatus === 'hardware_accelerated';

        if (diagGpuDecode) {
          diagGpuDecode.innerHTML = isDecodeHw
            ? `<span class="diag-badge-hw">Ativa (D3D11 / ${evaluated.vendorInfo.vendor} ⚡)</span>`
            : `<span class="diag-badge-sw">${videoDecodeStatus}</span>`;
        }
        if (diagGpuEncode) {
          diagGpuEncode.innerHTML = isEncodeHw
            ? `<span class="diag-badge-hw">Ativa (${evaluated.vendorInfo.vendor} MediaFoundation ⚡)</span>`
            : `<span class="diag-badge-sw">${videoEncodeStatus}</span>`;
        }

        if (diagCpuUsage && gpuDiag.cpuUsagePercent !== undefined) {
          diagCpuUsage.textContent = `${gpuDiag.cpuUsagePercent.toFixed(1)}%`;
          if (Array.isArray(gpuDiag.processBreakdown) && gpuDiag.processBreakdown.length > 0) {
            const tip = gpuDiag.processBreakdown.map(p => `${p.name}: ${p.cpuPercent}% CPU (${p.memoryMB} MB)`).join('\n');
            diagCpuUsage.title = tip;
            if (diagMemoryUsage) diagMemoryUsage.title = tip;
          }
        }
        if (diagMemoryUsage && gpuDiag.memoryUsageMB !== undefined) {
          diagMemoryUsage.textContent = `${gpuDiag.memoryUsageMB} MB`;
        }

        // ETAPA 3.3: Detalhamento de CPU por Subprocesso (Browser, GPU Process, Tab Renderer, Utility)
        const diagCpuBrowser = document.getElementById('diagCpuBrowser');
        const diagCpuGpu = document.getElementById('diagCpuGpu');
        const diagCpuRenderer = document.getElementById('diagCpuRenderer');
        const diagCpuUtility = document.getElementById('diagCpuUtility');
        const sub = gpuDiag.subprocessCpu || {};
        const findFromBreakdown = (labelKey) => {
          if (sub[labelKey]) return sub[labelKey];
          if (Array.isArray(gpuDiag.processBreakdown)) {
            return gpuDiag.processBreakdown.find(p => p.name === labelKey) || null;
          }
          return null;
        };
        const fmtSub = (entry) => {
          if (!entry) return '0.0% (0 MB)';
          const cpuVal = typeof entry.cpuPercent === 'number' ? entry.cpuPercent.toFixed(1) : '0.0';
          const memVal = entry.memoryMB !== undefined ? entry.memoryMB : 0;
          return `${cpuVal}% (${memVal} MB)`;
        };
        if (diagCpuBrowser) diagCpuBrowser.textContent = fmtSub(findFromBreakdown('Browser (Main)'));
        if (diagCpuGpu) diagCpuGpu.textContent = fmtSub(findFromBreakdown('GPU Process'));
        if (diagCpuRenderer) diagCpuRenderer.textContent = fmtSub(findFromBreakdown('Tab (Renderer)'));
        if (diagCpuUtility) diagCpuUtility.textContent = fmtSub(findFromBreakdown('Utility (Audio/Video)'));

        if (diagGpuStatusBadge) {
          diagGpuStatusBadge.textContent = isEncodeHw ? `${evaluated.vendorInfo.vendor} Acelerado ⚡` : 'GPU Detectada';
          diagGpuStatusBadge.className = isEncodeHw ? 'badge badge-success' : 'badge';
        }

        // CAUSA 4: Perfis de Hardware Encode, Workarounds de Driver e Logs do Processo GPU
        if (diagGpuEncProfiles) {
          if (Array.isArray(gpuDiag.videoAccelerators) && gpuDiag.videoAccelerators.length > 0) {
            diagGpuEncProfiles.textContent = gpuDiag.videoAccelerators.map(a => {
              if (typeof a === 'string') return `• ${a}`;
              const prof = a.profile || a.profileName || a.codec || JSON.stringify(a);
              const maxRes = (a.maxResolution || a.max_resolution) ? ` (máx: ${a.maxResolution?.width || a.max_resolution?.width}x${a.maxResolution?.height || a.max_resolution?.height})` : '';
              const maxFps = (a.maxFramerateNumerator || a.max_framerate_numerator) ? ` @ ${a.maxFramerateNumerator || a.max_framerate_numerator}fps` : '';
              return `• ${prof}${maxRes}${maxFps}`;
            }).join('\n');
          } else {
            diagGpuEncProfiles.textContent = 'Nenhum perfil de aceleração de vídeo retornado em videoAccelerators.';
          }
        }

        if (diagGpuWorkarounds) {
          if (Array.isArray(gpuDiag.driverBugWorkarounds) && gpuDiag.driverBugWorkarounds.length > 0) {
            diagGpuWorkarounds.innerHTML = `<span style="color: #fbbf24; font-weight: 600;">Workarounds ativos:</span> ${escapeHtml(gpuDiag.driverBugWorkarounds.join(', '))}`;
          } else {
            diagGpuWorkarounds.innerHTML = '<span style="color: #34d399; font-weight: 600;">Nenhum workaround bloqueador reportado pelo processo GPU</span>';
          }
        }

        if (diagGpuLogs) {
          if (Array.isArray(gpuDiag.relevantGpuLogs) && gpuDiag.relevantGpuLogs.length > 0) {
            diagGpuLogs.textContent = gpuDiag.relevantGpuLogs.join('\n');
          } else {
            diagGpuLogs.textContent = 'Nenhuma mensagem de erro ou bloqueio registrada no processo GPU.';
          }
        }
      }
    } catch (e) {
      console.warn('[Diagnostics] Erro ao obter diagnóstico de GPU desktop:', e);
    }
  } else {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo && diagGpuRenderer) {
          diagGpuRenderer.textContent = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
        if (debugInfo && diagGpuDriver) {
          diagGpuDriver.textContent = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        }
      }
      if (diagGpuDecode) diagGpuDecode.textContent = 'Decodificador WebRTC do Navegador';
      if (diagGpuEncode) diagGpuEncode.textContent = 'Codificador WebRTC do Navegador';
      if (diagCpuUsage) {
        diagCpuUsage.textContent = 'N/A (Navegador)';
        diagCpuUsage.title = 'Métricas de CPU do sistema não são expostas pela Sandbox do Navegador';
      }
      const diagCpuBrowser = document.getElementById('diagCpuBrowser');
      const diagCpuGpu = document.getElementById('diagCpuGpu');
      const diagCpuRenderer = document.getElementById('diagCpuRenderer');
      const diagCpuUtility = document.getElementById('diagCpuUtility');
      if (diagCpuBrowser) diagCpuBrowser.textContent = 'N/A (Web)';
      if (diagCpuGpu) diagCpuGpu.textContent = 'N/A (Web)';
      if (diagCpuRenderer) diagCpuRenderer.textContent = 'N/A (Web)';
      if (diagCpuUtility) diagCpuUtility.textContent = 'N/A (Web)';
      if (diagMemoryUsage) {
        const heapMem = (window.performance && performance.memory) ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
        diagMemoryUsage.textContent = heapMem ? `${heapMem} MB (Heap JS)` : 'N/A (Navegador)';
      }
      if (diagGpuStatusBadge) {
        diagGpuStatusBadge.textContent = 'Web Runtime';
        diagGpuStatusBadge.className = 'badge';
      }
      if (diagGpuEncProfiles) diagGpuEncProfiles.textContent = 'Não aplicável no Navegador (requer Electron Desktop).';
      if (diagGpuWorkarounds) diagGpuWorkarounds.textContent = 'Gerenciado pelo Navegador.';
      if (diagGpuLogs) diagGpuLogs.textContent = 'Acessível via chrome://gpu no navegador.';
    } catch (_) {}
  }

  // CAUSA 4: Exibe e imprime os codecs H.264 exatos com sdpFmtpLine de RTCRtpSender.getCapabilities
  let rtcCodecs = [];
  try {
    if (typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function') {
      rtcCodecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
    }
  } catch (_) {}

  const h264List = rtcCodecs.filter(c => (c.mimeType || '').toLowerCase() === 'video/h264');
  if (diagRtcSenderProfiles) {
    if (h264List.length > 0) {
      diagRtcSenderProfiles.textContent = h264List.map((c, i) => {
        const parsed = parseH264ProfileLevel(c.sdpFmtpLine || '');
        let profileTag = '';
        if (parsed) {
          if (parsed.fullPid.startsWith('42e0')) {
            profileTag = ' [Constrained Baseline - GPU MFT ⚡ 1080p60 OK]';
          } else if (parsed.fullPid.startsWith('4d00')) {
            profileTag = ' [Main Profile - GPU MFT ⚡ 1080p60 OK]';
          } else if (parsed.fullPid.startsWith('6400')) {
            profileTag = ' [High Profile - último na ordem]';
          } else if (parsed.fullPid.startsWith('4200')) {
            profileTag = ' [Baseline unconstrained - último na ordem]';
          }
        }
        return `[${i + 1}] ${c.mimeType} | "${c.sdpFmtpLine || ''}"${profileTag}`;
      }).join('\n');
    } else {
      diagRtcSenderProfiles.textContent = 'Nenhum codec H.264 retornado por RTCRtpSender.getCapabilities("video").';
    }
  }

  const diagMediaCapabilitiesProbe = document.getElementById('diagMediaCapabilitiesProbe');
  if (diagMediaCapabilitiesProbe) {
    const probe = webrtc.hardwareProbe || (await webrtc.probeHardware().catch(() => null));
    const wcProbe = gpuEncoderEngine.lastProbeResult || (await gpuEncoderEngine.probeHardware().catch(() => null));

    let htmlParts = [];

    htmlParts.push(
      `<div style="margin-bottom: 6px; padding: 6px 8px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 4px; color: #fde68a; font-size: 0.7rem;">` +
      `⚠️ <strong>Aviso Técnico:</strong> <code>VideoEncoder.isConfigSupported</code> devolve de volta o <code>hardwareAcceleration</code> que foi passado. Portanto, <code>supported: true</code> por si só <strong>NÃO prova aceleração por hardware</strong> — a prova real é o Benchmark na Seção 4 (tempo de encode e fila) e o <code>chrome://gpu</code>.` +
      `</div>`
    );

    if (probe && Array.isArray(probe.probedCodecs)) {
      const h264Probed = probe.probedCodecs.filter(p => (p.mimeType || '').toLowerCase().includes('h264'));
      if (h264Probed.length > 0) {
        htmlParts.push(`<div style="margin: 4px 0; font-weight: 600; color: #e2e8f0;">A) navigator.mediaCapabilities.encodingInfo (1080p60):</div>`);
        htmlParts.push(h264Probed.map((p, idx) => {
          const isSup = p.supported !== false;
          const isPe = p.powerEfficient === true;
          const badge = isPe
            ? `<span class="diag-badge-hw" style="font-size: 0.68rem; padding: 1px 6px;">supported: ${isSup} • powerEfficient: true</span>`
            : `<span class="diag-badge-sw" style="font-size: 0.68rem; padding: 1px 6px;">supported: ${isSup} • powerEfficient: false</span>`;
          const fmtp = p.sdpFmtpLine || 'default';
          return `<div style="margin-bottom: 4px; padding: 4px 8px; background: rgba(0,0,0,0.25); border-radius: 4px; border: 1px solid rgba(255,255,255,0.06); font-family: monospace;">` +
                 `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">` +
                 `<strong style="color: #f1f5f9;">[${idx + 1}] ${escapeHtml(p.mimeType)}</strong> ${badge}` +
                 `</div>` +
                 `<div style="font-size: 0.68rem; color: #94a3b8; word-break: break-all;">${escapeHtml(fmtp)}</div>` +
                 `</div>`;
        }).join(''));
      }
    }

    if (wcProbe && Array.isArray(wcProbe.profiles) && wcProbe.profiles.length > 0) {
      htmlParts.push(`<div style="margin: 8px 0 4px 0; font-weight: 600; color: #38bdf8;">B) WebCodecs VideoEncoder.isConfigSupported (Candidatos):</div>`);
      htmlParts.push(wcProbe.profiles.map((p, idx) => {
        const peStr = p.powerEfficient === null || p.powerEfficient === undefined ? 'N/A' : String(p.powerEfficient);
        const badge = p.supported
          ? `<span class="diag-badge-neutral" style="font-size: 0.68rem; padding: 1px 6px;">supported: true • powerEfficient: ${peStr} (${escapeHtml(p.hardwareAcceleration)})</span>`
          : `<span class="diag-badge-sw" style="font-size: 0.68rem; padding: 1px 6px;">supported: false • powerEfficient: ${peStr}${p.error ? ' (' + escapeHtml(p.error) + ')' : ''}</span>`;
        return `<div style="margin-bottom: 4px; padding: 4px 8px; background: rgba(0,0,0,0.25); border-radius: 4px; border: 1px solid rgba(255,255,255,0.06); font-family: monospace; display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">` +
               `<span><strong style="color: #f8fafc;">[${idx + 1}] ${escapeHtml(p.codec)}</strong> — <span style="color: #94a3b8;">${escapeHtml(p.label)} (bitrateMode: ${escapeHtml(p.bitrateMode || 'omitido')})</span></span>` +
               `${badge}` +
               `</div>`;
      }).join(''));
    }

    diagMediaCapabilitiesProbe.innerHTML = htmlParts.join('');
  }

  // Emite relatório detalhado no console do DevTools a cada 15 segundos ou na primeira abertura
  if (window.__lastGpuDiagLogTime === undefined || Date.now() - window.__lastGpuDiagLogTime > 15000) {
    window.__lastGpuDiagLogTime = Date.now();
    console.groupCollapsed('%c[GPU Diagnostics Real] Telemetria da GPU e Codecs WebRTC:', 'color: #38bdf8; font-weight: bold;');
    console.log('1. GPU Feature Status:', gpuDiag?.featureStatus);
    console.log('2. Hardware Video Accelerators (Boot):', gpuDiag?.videoAccelerators);
    console.log('3. Driver Bug Workarounds Ativos:', gpuDiag?.driverBugWorkarounds);
    console.log('4. GPU Logs Relevantes:', gpuDiag?.relevantGpuLogs);
    console.log('5. RTCRtpSender H.264 Codecs:', h264List);
    console.groupEnd();
  }

  try {
    if (!qualityController.intervalId) {
      await qualityController.collectMetrics();
    }
  } catch (err) {
    console.warn('[Diagnostics] Erro ao coletar métricas no QualityController:', err);
  }

  const detailed = qualityController.getDetailedDiagnostics();
  const outboundTbody = document.getElementById('diagOutboundTableBody');
  const inboundTbody = document.getElementById('diagInboundTableBody');

  const outboundStreams = detailed?.outboundStreams || detailed?.outbound || [];
  const inboundStreams = detailed?.inboundStreams || detailed?.inbound || [];
  const localCaptures = detailed?.localCaptures || [];

  const fallbackAlert = document.getElementById('hardwareFallbackAlert');
  const fallbackAlertText = document.getElementById('hardwareFallbackAlertText');
  const activeSoftwareOutbound = outboundStreams.find(s => {
    const implName = s.rawImplementation || s.encoderImplementation || '';
    const isSwByRule = s.hwState === 'software_confirmed' || classifyCodecImplementation(implName).hwState === 'software_confirmed';
    return isSwByRule && (s.framesEncoded > 0 || s.bytesSent > 0);
  });
  if (fallbackAlert) {
    if (activeSoftwareOutbound && (webrtc.getEncoderPreference ? webrtc.getEncoderPreference() : 'gpu') !== 'cpu') {
      if (fallbackAlertText) {
        fallbackAlertText.innerHTML = `Codificador ativo: <strong style="color: #fca5a5;">[Software (CPU): ${escapeHtml(activeSoftwareOutbound.rawImplementation || activeSoftwareOutbound.encoderImplementation)}]</strong> no codec <strong>${escapeHtml(activeSoftwareOutbound.codec)}</strong>.<br>Motivo: A implementação reportada pelo WebRTC foi classificada como software na CPU pela regra prioritária.`;
      }
      fallbackAlert.classList.remove('hidden');
    } else {
      fallbackAlert.classList.add('hidden');
    }
  }

  if (outboundTbody) {
    if (outboundStreams.length === 0) {
      if (localCaptures.length > 0) {
        const cap = localCaptures[0];
        const prefCodec = detailed?.preferredCodec || 'H264';
        const prefEnc = (webrtc.getEncoderPreference ? webrtc.getEncoderPreference() : 'gpu').toUpperCase();
        outboundTbody.innerHTML = `
          <tr>
            <td colspan="7" class="diag-empty" style="text-align: left; padding: 14px 16px !important;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <span class="diag-badge-hw" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border-color: rgba(59, 130, 246, 0.35);">Captura Local Ativa</span>
                <strong style="color: #f0f2f5;">${escapeHtml(cap.label)} (${cap.width}x${cap.height} @ ${cap.fps} fps)</strong>
              </div>
              <div style="color: #94a3b8; font-size: 0.75rem; line-height: 1.4;">
                Modo de aceleração: <strong>${escapeHtml(prefEnc)}</strong> • Codec preferencial: <strong>${escapeHtml(prefCodec)}</strong>.<br>
                Codificadores RTP por hardware/software são acionados sob demanda assim que outros participantes ingressarem e assistirem à transmissão.
              </div>
            </td>
          </tr>
        `;
      } else {
        outboundTbody.innerHTML = '<tr><td colspan="7" class="diag-empty">Nenhum fluxo de vídeo sendo transmitido no momento.</td></tr>';
      }
    } else {
      outboundTbody.innerHTML = outboundStreams.map(s => {
        const targetName = roomState.participants.get(s.targetUserId || s.targetPeerId)?.name || s.targetPeerName || s.targetUserId || 'Todos';
        const rawImpl = s.rawImplementation || s.encoderImplementation || 'Não informado';
        const classified = classifyCodecImplementation(rawImpl);
        const badgeClass = s.hwBadgeClass || classified.hwBadgeClass || (s.hwState === 'hardware_confirmed' || s.isHardware ? 'diag-badge-hw' : (s.hwState === 'software_confirmed' || s.isSoftware ? 'diag-badge-sw' : 'diag-badge-neutral'));
        const badgeLabel = s.hwLabel || classified.hwLabel || (s.hwState === 'hardware_confirmed' ? 'GPU Hardware ⚡' : (s.hwState === 'software_confirmed' ? 'Software (CPU)' : 'Indeterminado'));

        const peTag = typeof s.powerEfficientEncoder === 'boolean'
          ? (s.powerEfficientEncoder
            ? '<span class="diag-badge-hw" style="margin-left: 4px; font-size: 0.65rem; padding: 1px 5px;" title="Valor bruto powerEfficientEncoder retornado pelo WebRTC">[powerEfficient: true]</span>'
            : '<span class="diag-badge-sw" style="margin-left: 4px; font-size: 0.65rem; padding: 1px 5px;" title="Valor bruto powerEfficientEncoder retornado pelo WebRTC">[powerEfficient: false]</span>')
          : '';

        const fmtpDisplay = (s.sdpFmtpLine && s.sdpFmtpLine !== '--')
          ? `<div style="font-size: 0.68rem; color: #94a3b8; font-family: monospace; margin-top: 3px; word-break: break-all;">${escapeHtml(s.sdpFmtpLine)}</div>`
          : '';

        const implBadge = `
          <div>
            <span class="${badgeClass}" title="${escapeHtml(s.hwEvidence || '')}">${escapeHtml(badgeLabel)} — <code>${escapeHtml(rawImpl)}</code></span>
            ${peTag}
            ${fmtpDisplay}
          </div>
        `;

        const limitDisplay = s.qualityLimitationReason === 'none'
          ? '<span style="color: #10b981;">Nenhuma</span>'
          : (s.qualityLimitationReason === 'cpu'
            ? '<span style="color: #ef4444; font-weight: 600;">CPU</span>'
            : (s.qualityLimitationReason === 'bandwidth'
              ? '<span style="color: #f59e0b; font-weight: 600;">Banda / Rede</span>'
              : `<span style="color: #a1a1aa;">${escapeHtml(s.qualityLimitationReason || 'none')}</span>`));
        const bitrateStr = s.bitrateMbps ? `${s.bitrateMbps} Mbps` : `${s.bitrateKbps || 0} kbps`;
        const fpsStr = (s.fps !== undefined && s.fps !== null && s.fps !== '') ? `${s.fps} fps` : '--';

        // Solicitado (Requested)
        const req = s.requested || {};
        const reqFps = req.maxFramerate ? `${req.maxFramerate} fps` : '--';
        const reqScale = req.scaleResolutionDownBy ? `${req.scaleResolutionDownBy}x` : '1.0x';
        const reqBitrate = req.maxBitrate ? `${(req.maxBitrate / 1000000).toFixed(1)}M` : '--';
        const requestedDisplay = `
          <div style="font-size: 0.75rem; line-height: 1.3;">
            <div style="font-weight: 600; color: #f0f2f5;">${escapeHtml(req.label || req.state || 'Ativo')}</div>
            <div style="color: #94a3b8; font-family: monospace; font-size: 0.7rem;">${reqFps} • esc: ${reqScale} • ${reqBitrate}</div>
          </div>
        `;

        // Aplicado (Applied via RTCRtpSender.getParameters)
        const app = s.applied || {};
        let appliedDisplay = '';
        if (s.adaptationError) {
          appliedDisplay = `
            <div style="font-size: 0.72rem; color: #ef4444; line-height: 1.3;">
              <strong>Rejeitado:</strong> ${escapeHtml(s.adaptationError)}
            </div>
          `;
        } else if (app.maxFramerate || app.scaleResolutionDownBy || app.maxBitrate) {
          const appFps = app.maxFramerate ? `${app.maxFramerate} fps` : '--';
          const appScale = app.scaleResolutionDownBy ? `${app.scaleResolutionDownBy}x` : '1.0x';
          const appBitrate = app.maxBitrate ? `${(app.maxBitrate / 1000000).toFixed(1)}M` : '--';
          const appDeg = app.degradationPreference ? `<span style="font-size: 0.65rem; color: #64748b;">(${escapeHtml(app.degradationPreference)})</span>` : '';
          appliedDisplay = `
            <div style="font-size: 0.75rem; line-height: 1.3; font-family: monospace;">
              <div>${appFps} • esc: ${appScale} • ${appBitrate}</div>
              <div>${appDeg}</div>
            </div>
          `;
        } else {
          appliedDisplay = '<span style="color: #64748b; font-size: 0.75rem;">Padrão</span>';
        }

        // Observado Real (getStats)
        const observedDisplay = `
          <div style="font-size: 0.75rem; line-height: 1.3; font-family: monospace;">
            <div style="color: #f0f2f5; font-weight: 600;">${s.width}x${s.height} @ ${fpsStr}</div>
            <div style="color: #38bdf8;">${bitrateStr}</div>
          </div>
        `;

        // Tempo Real de Encode & Limitação (Métrica de Hardware Comprovada)
        const encodeTimeDisplay = (s.avgEncodeTimeMs && s.avgEncodeTimeMs !== '--')
          ? `<div style="font-size: 0.75rem; color: #34d399; font-weight: 600;">⚡ ${escapeHtml(s.avgEncodeTimeMs)}</div>`
          : '<div style="font-size: 0.75rem; color: #94a3b8;">--</div>';
        const encodeAndLimitDisplay = `
          <div style="font-size: 0.75rem; line-height: 1.3;">
            <div style="color: #94a3b8; font-size: 0.68rem;">Tempo Real Encode:</div>
            ${encodeTimeDisplay}
            <div style="margin-top: 2px;">${limitDisplay}</div>
          </div>
        `;

        // Badge com identificação explícita de "Modelo Teórico Estimado"
        const viewerBadge = `<div style="margin-top: 3px;"><span class="${escapeHtml(s.viewerBadgeClass || 'diag-badge-hw')}" style="font-size: 0.68rem; padding: 1px 5px;" title="Economia Teórica Estimada (Modelo): ${s.estimatedSavingsPercent || 0}%">${escapeHtml(s.viewerStateLabel || 'Ativo')} (Modelo: -${s.estimatedSavingsPercent || 0}%)</span></div>`;

        return `
          <tr>
            <td>
              <strong>${escapeHtml(targetName)}</strong>
              ${viewerBadge}
            </td>
            <td>
              <div>${escapeHtml(s.streamType || 'Tela / Desktop')}</div>
              <strong style="color: #cbd5e1; font-size: 0.78rem;">${escapeHtml(s.codec || '---')}</strong>
            </td>
            <td>${implBadge}</td>
            <td>${requestedDisplay}</td>
            <td>${appliedDisplay}</td>
            <td>${observedDisplay}</td>
            <td>${encodeAndLimitDisplay}</td>
          </tr>
        `;
      }).join('');
    }
  }

  if (inboundTbody) {
    if (inboundStreams.length === 0) {
      inboundTbody.innerHTML = '<tr><td colspan="7" class="diag-empty">Nenhum fluxo de vídeo remoto recebido no momento.</td></tr>';
    } else {
      inboundTbody.innerHTML = inboundStreams.map(s => {
        const senderName = roomState.participants.get(s.peerId)?.name || s.senderName || s.peerId;
        const rawImpl = s.rawImplementation || s.decoderImplementation || 'Não informado';
        const classified = classifyCodecImplementation(rawImpl);
        const badgeClass = s.hwBadgeClass || classified.hwBadgeClass || (s.hwState === 'hardware_confirmed' || s.isHardware ? 'diag-badge-hw' : (s.hwState === 'software_confirmed' || s.isSoftware ? 'diag-badge-sw' : 'diag-badge-neutral'));
        const badgeLabel = s.hwLabel || classified.hwLabel || (s.hwState === 'hardware_confirmed' ? 'GPU Hardware ⚡' : (s.hwState === 'software_confirmed' ? 'Software (CPU)' : 'Indeterminado'));
        const implBadge = `<span class="${badgeClass}" title="${escapeHtml(s.hwEvidence || '')}">${escapeHtml(badgeLabel)} — <code>${escapeHtml(rawImpl)}</code></span>`;

        const bitrateStr = s.bitrateMbps ? `${s.bitrateMbps} Mbps` : `${s.bitrateKbps || 0} kbps`;
        const fpsStr = (s.fps !== undefined && s.fps !== null && s.fps !== '') ? `${s.fps} fps` : '--';
        const jitterDisplay = s.jitterMs !== undefined ? `${s.jitterMs}ms` : `${((s.jitter || 0) * 1000).toFixed(0)}ms`;
        return `
          <tr>
            <td><strong>${escapeHtml(senderName)}</strong></td>
            <td>${escapeHtml(s.streamType || 'Tela / Desktop')}</td>
            <td><strong>${escapeHtml(s.codec || '---')}</strong></td>
            <td>${implBadge}</td>
            <td>${s.width}x${s.height} @ ${fpsStr}</td>
            <td>${bitrateStr}</td>
            <td>${s.packetLossPercent || '0.0'}% / ${jitterDisplay}</td>
          </tr>
        `;
      }).join('');
    }
  }

  await renderRtpSenderH264Section4();
}

async function collectRtpSenderH264AndNegotiated() {
  let allCodecs = [];
  try {
    if (typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function') {
      allCodecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
    }
  } catch (_) {}

  const h264Entries = allCodecs
    .filter(c => (c.mimeType || '').toLowerCase() === 'video/h264')
    .map((c, index) => {
      const sdpFmtpLine = c.sdpFmtpLine || '';
      const parsed = parseH264ProfileLevel(sdpFmtpLine);
      const pidMatch = sdpFmtpLine.match(/profile-level-id=([0-9a-fA-F]{6})/i);
      const pmMatch = sdpFmtpLine.match(/packetization-mode=([0-9]+)/i);
      const profileLevelId = pidMatch ? pidMatch[1].toLowerCase() : (parsed?.fullPid || null);
      const packetizationMode = pmMatch ? pmMatch[1] : null;
      const levelIdc = parsed ? parsed.levelIdc : (profileLevelId ? parseInt(profileLevelId.slice(4, 6), 16) : null);
      const levelHex = levelIdc !== null && !isNaN(levelIdc) ? `0x${levelIdc.toString(16).padStart(2, '0')}` : null;
      const isLevel42OrAbove = levelIdc !== null && !isNaN(levelIdc) && levelIdc >= 0x2a;
      const isLevel50OrAbove = levelIdc !== null && !isNaN(levelIdc) && levelIdc >= 0x32;

      return {
        index: index + 1,
        mimeType: c.mimeType,
        clockRate: c.clockRate ?? null,
        sdpFmtpLine,
        profileLevelId,
        packetizationMode,
        levelIdc,
        levelHex,
        isLevel42OrAbove,
        isLevel50OrAbove
      };
    });

  const hasLevelAtLeast42 = h264Entries.some(e => e.isLevel42OrAbove);
  const hasLevelAtLeast50 = h264Entries.some(e => e.isLevel50OrAbove);

  const rtpSenderH264Capabilities = {
    totalCount: h264Entries.length,
    hasLevelAtLeast42_0x2a: hasLevelAtLeast42,
    hasLevelAtLeast50_0x32: hasLevelAtLeast50,
    entries: h264Entries
  };

  const negotiatedOutbound = [];
  if (webrtc && webrtc.peers && webrtc.peers.size > 0) {
    for (const [peerId, pc] of webrtc.peers.entries()) {
      if (!pc || typeof pc.getStats !== 'function') continue;
      try {
        const stats = await pc.getStats();
        const codecsById = new Map();
        stats.forEach(report => {
          if (report.type === 'codec') {
            codecsById.set(report.id, report);
          }
        });
        stats.forEach(report => {
          if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            const isTransmitting = (report.framesEncoded > 0 || report.bytesSent > 0 || report.framesSent > 0);
            if (!isTransmitting && pc.connectionState !== 'connected') return;
            const codecReport = report.codecId ? codecsById.get(report.codecId) : null;
            const impl = report.encoderImplementation || null;
            const classified = classifyCodecImplementation(impl);
            negotiatedOutbound.push({
              peerId,
              peerName: roomState.participants.get(peerId)?.name || peerId,
              connectionState: pc.connectionState || null,
              reportId: report.id,
              mid: report.mid ?? null,
              mimeType: codecReport?.mimeType || null,
              payloadType: codecReport?.payloadType ?? report.payloadType ?? null,
              sdpFmtpLine: codecReport?.sdpFmtpLine || null,
              encoderImplementation: impl,
              powerEfficientEncoder: report.powerEfficientEncoder ?? null,
              hwState: classified.hwState,
              hwLabel: classified.hwLabel,
              frameWidth: report.frameWidth ?? null,
              frameHeight: report.frameHeight ?? null,
              framesPerSecond: report.framesPerSecond ?? null,
              framesEncoded: report.framesEncoded ?? 0,
              bytesSent: report.bytesSent ?? 0
            });
          }
        });
      } catch (_) {}
    }
  }

  return { rtpSenderH264Capabilities, negotiatedOutbound };
}

function highlightFmtpLineHtml(sdpFmtpLine = '') {
  if (!sdpFmtpLine) return '<span style="color: #64748b;">(sem sdpFmtpLine)</span>';
  return escapeHtml(sdpFmtpLine)
    .replace(
      /(profile-level-id=([0-9a-fA-F]{6}))/gi,
      '<strong style="color: #38bdf8; background: rgba(56, 189, 248, 0.15); padding: 0 4px; border-radius: 3px;">$1</strong>'
    )
    .replace(
      /(packetization-mode=([0-9]+))/gi,
      '<strong style="color: #a78bfa; background: rgba(167, 139, 250, 0.15); padding: 0 4px; border-radius: 3px;">$1</strong>'
    );
}

async function renderRtpSenderH264Section4(precollected = null) {
  const boxEl = document.getElementById('diagRtpSenderH264Box');
  if (!boxEl) return;

  const data = precollected || (await collectRtpSenderH264AndNegotiated());
  const caps = data.rtpSenderH264Capabilities;
  const negotiated = data.negotiatedOutbound || [];

  const level42Badge = caps.hasLevelAtLeast42_0x2a
    ? '<span class="diag-badge-hw" style="font-size: 0.68rem; padding: 1px 6px;">Sim (&gt;= 0x2a / Level 4.2) ✅</span>'
    : '<span class="diag-badge-sw" style="font-size: 0.68rem; padding: 1px 6px;">Não (&lt; 0x2a) ❌</span>';

  const level50Badge = caps.hasLevelAtLeast50_0x32
    ? '<span class="diag-badge-hw" style="font-size: 0.68rem; padding: 1px 6px;">Sim (&gt;= 0x32 / Level 5.0) ✅</span>'
    : '<span class="diag-badge-sw" style="font-size: 0.68rem; padding: 1px 6px;">Não (&lt; 0x32) ❌</span>';

  const entriesRowsHtml = caps.entries.length > 0
    ? caps.entries.map(e => {
        const lvlTag = e.isLevel50OrAbove
          ? '<span class="diag-badge-hw" style="font-size: 0.65rem; padding: 1px 5px;">&gt;= 0x32 (L5.0+)</span>'
          : (e.isLevel42OrAbove
            ? '<span class="diag-badge-hw" style="font-size: 0.65rem; padding: 1px 5px;">&gt;= 0x2a (L4.2+)</span>'
            : `<span class="diag-badge-neutral" style="font-size: 0.65rem; padding: 1px 5px;">${escapeHtml(e.levelHex || 'N/A')} (&lt; 0x2a)</span>`);
        return `
          <tr>
            <td style="font-family: monospace;">#${e.index}</td>
            <td style="font-family: monospace; font-weight: 600; color: #f8fafc;">${escapeHtml(e.mimeType)}</td>
            <td style="font-family: monospace; color: #38bdf8; font-weight: 600;">${escapeHtml(e.profileLevelId || '--')} ${lvlTag}</td>
            <td style="font-family: monospace; color: #a78bfa; font-weight: 600;">${escapeHtml(e.packetizationMode ?? '--')}</td>
            <td style="font-family: monospace; word-break: break-all;">${highlightFmtpLineHtml(e.sdpFmtpLine)}</td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="5" class="diag-empty">Nenhuma entrada H264 retornada por RTCRtpSender.getCapabilities("video").codecs.</td></tr>';

  let negotiatedHtml = '';
  if (negotiated.length > 0) {
    const negRows = negotiated.map(n => {
      const peStr = n.powerEfficientEncoder === null || n.powerEfficientEncoder === undefined
        ? 'null'
        : String(n.powerEfficientEncoder);
      const rawImpl = n.encoderImplementation || 'Não informado';
      const classified = classifyCodecImplementation(rawImpl);
      return `
        <tr>
          <td><strong>${escapeHtml(n.peerName)}</strong></td>
          <td style="font-family: monospace; font-weight: 600;">${escapeHtml(n.mimeType || '--')}</td>
          <td style="font-family: monospace; word-break: break-all;">${highlightFmtpLineHtml(n.sdpFmtpLine || '')}</td>
          <td><span class="${classified.hwBadgeClass}">${escapeHtml(classified.hwLabel)} — <code>${escapeHtml(rawImpl)}</code></span></td>
          <td style="font-family: monospace;"><strong>${escapeHtml(peStr)}</strong></td>
        </tr>
      `;
    }).join('');
    negotiatedHtml = `
      <div style="margin-top: 8px; margin-bottom: 4px; font-weight: 600; color: #38bdf8; font-size: 0.73rem;">
        Negociado na Transmissão Ativa (getStats outbound-rtp + codec):
      </div>
      <div class="diag-table-container">
        <table class="diag-table" style="font-size: 0.71rem;">
          <thead>
            <tr>
              <th>Peer</th>
              <th>Codec</th>
              <th>sdpFmtpLine Negociado</th>
              <th>encoderImplementation</th>
              <th>powerEfficientEncoder</th>
            </tr>
          </thead>
          <tbody>
            ${negRows}
          </tbody>
        </table>
      </div>
    `;
  } else {
    negotiatedHtml = `
      <div style="margin-top: 6px; color: #94a3b8; font-size: 0.71rem;">
        <em>Negociado (getStats outbound-rtp): nenhum peer conectado com transmissão de vídeo ativa no momento.</em>
      </div>
    `;
  }

  boxEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px;">
      <div style="font-weight: 600; color: #e2e8f0; font-size: 0.74rem;">
        Capacidades H.264 do RTCRtpSender (<code>RTCRtpSender.getCapabilities('video').codecs</code>):
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 0.71rem;">
        <span>Total H.264: <strong style="color: #f8fafc;">${caps.totalCount}</strong></span>
        <span>Nível &gt;= 0x2a (L4.2): ${level42Badge}</span>
        <span>Nível &gt;= 0x32 (L5.0): ${level50Badge}</span>
      </div>
    </div>
    <div class="diag-table-container">
      <table class="diag-table" style="font-size: 0.71rem;">
        <thead>
          <tr>
            <th>#</th>
            <th>mimeType</th>
            <th>profile-level-id</th>
            <th>packetization-mode</th>
            <th>sdpFmtpLine Completo</th>
          </tr>
        </thead>
        <tbody>
          ${entriesRowsHtml}
        </tbody>
      </table>
    </div>
    ${negotiatedHtml}
  `;
}

async function handleTestGpuWebCodecs() {
  const btn = document.getElementById('btnTestGpuWebCodecs');
  const probeListEl = document.getElementById('diagWebCodecsProbeList');
  const benchBoxEl = document.getElementById('diagWebCodecsBenchmarkBox');
  if (!probeListEl) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Testando Motor GPU WebCodecs...';
  }

  const renderAttemptsList = (attempts = []) => {
    if (!Array.isArray(attempts) || attempts.length === 0) {
      return '<div style="margin-top: 6px; color: #34d399; font-size: 0.72rem;">✅ Nenhuma tentativa falhou (o 1º candidato funcionou de imediato).</div>';
    }
    const rows = attempts.map((a, idx) => {
      const candDesc = a.candidato || (a.candidate
        ? `${a.candidate.codec} (${a.candidate.hardwareAcceleration}, bitrateMode=${a.candidate.bitrateMode || 'omitido'}, ${a.candidate.width}x${a.candidate.height})`
        : `Candidato #${idx + 1}`);
      const errDesc = a.error || a.erro || 'Erro desconhecido';
      return `
        <div style="padding: 4px 8px; margin-bottom: 3px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px; font-family: monospace; font-size: 0.7rem;">
          <div style="color: #fca5a5; font-weight: 600;">Tentativa #${idx + 1}: ${escapeHtml(candDesc)}</div>
          <div style="color: #f87171;">↳ Erro: ${escapeHtml(errDesc)}</div>
        </div>
      `;
    }).join('');
    return `
      <div style="margin-top: 8px;">
        <div style="font-weight: 600; color: #fca5a5; margin-bottom: 4px; font-size: 0.73rem;">
          ⚠️ Tentativas anteriores que falharam (${attempts.length}):
        </div>
        ${rows}
      </div>
    `;
  };

  try {
    probeListEl.innerHTML = '<span style="color: #38bdf8;">Sondando candidatos via VideoEncoder.isConfigSupported...</span>';
    const probeRes = await gpuEncoderEngine.probeHardware();

    if (!probeRes.webCodecsAvailable && !probeRes.supported) {
      probeListEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;">❌ API WebCodecs não disponível neste ambiente: ${escapeHtml(probeRes.reason || '')}</span>`;
      return;
    }

    const profilesHtml = (probeRes.profiles || []).map((p, idx) => {
      const peStr = p.powerEfficient === null || p.powerEfficient === undefined ? 'N/A' : String(p.powerEfficient);
      const badge = p.supported
        ? `<span class="diag-badge-neutral" style="font-size: 0.68rem; padding: 1px 6px;">supported: true • powerEfficient: ${peStr}</span>`
        : `<span class="diag-badge-sw" style="font-size: 0.68rem; padding: 1px 6px;">supported: false${p.error ? ' (' + escapeHtml(p.error) + ')' : ''}</span>`;
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; margin-bottom: 4px; background: rgba(0,0,0,0.3); border-radius: 4px; border: 1px solid rgba(255,255,255,0.06); font-family: monospace; gap: 6px; flex-wrap: wrap;">
          <span><strong style="color: #f8fafc;">#${idx + 1} ${escapeHtml(p.codec)}</strong> — <span style="color: #94a3b8;">${escapeHtml(p.label)} (bitrateMode: ${escapeHtml(p.bitrateMode || 'omitido')})</span></span>
          ${badge}
        </div>
      `;
    }).join('');

    probeListEl.innerHTML = `
      <div style="margin-bottom: 4px; font-size: 0.7rem; color: #fde68a;">
        ℹ️ <em>${escapeHtml(probeRes.probeDisclaimer || 'isConfigSupported apenas valida a configuração; o teste real ocorre no benchmark abaixo.')}</em>
      </div>
      <div style="margin-bottom: 6px; font-weight: 600; color: #e2e8f0;">
        1. Sondagem de Candidatos WebCodecs (isConfigSupported):
      </div>
      ${profilesHtml}
    `;

    const screenTrack = media && typeof media.getScreenVideoTrack === 'function' ? media.getScreenVideoTrack() : null;
    if (benchBoxEl) {
      benchBoxEl.classList.remove('hidden');
      if (!screenTrack || screenTrack.readyState !== 'live') {
        benchBoxEl.innerHTML = `
          <div style="color: #fbbf24; font-weight: 600;">
            ℹ️ Inicie o Compartilhamento de Tela (60 FPS) e clique novamente para rodar o Benchmark Real de 4 segundos na GPU via <code>MediaStreamTrackProcessor</code> + <code>VideoEncoder</code>!
          </div>
        `;
      } else {
        benchBoxEl.innerHTML = `
          <div style="color: #38bdf8; font-weight: 600;">
            ⚡ Lendo 1º quadro real para extrair resolução e testando candidatos sequencialmente no VideoEncoder (4 segundos)...
          </div>
        `;
        const bench = await gpuEncoderEngine.runBenchmark(screenTrack, 4000);
        if (!bench.supported || !bench.success) {
          benchBoxEl.innerHTML = `
            <div style="color: #ef4444; font-weight: 600; margin-bottom: 6px;">
              ❌ Todos os candidatos WebCodecs falharam na criação/encode real: ${escapeHtml(bench.error || 'Erro desconhecido')}
            </div>
            <div style="font-size: 0.72rem; color: #cbd5e1; margin-bottom: 6px; font-family: monospace;">
              Resolução Real do Frame: <strong>${bench.frameW || 0}x${bench.frameH || 0}</strong> • Dimensões Testadas no Encoder: <strong>${bench.encodedWidth || 0}x${bench.encodedHeight || 0}</strong>
            </div>
            ${renderAttemptsList(bench.attempts)}
          `;
        } else {
          const rendererCpu = bench.cpuUsage?.rendererPercent !== null && bench.cpuUsage?.rendererPercent !== undefined
            ? `${bench.cpuUsage.rendererPercent}%`
            : 'N/A';
          const gpuProcCpu = bench.cpuUsage?.gpuProcessPercent !== null && bench.cpuUsage?.gpuProcessPercent !== undefined
            ? `${bench.cpuUsage.gpuProcessPercent}%`
            : 'N/A';
          const totalAppCpu = bench.cpuUsage?.totalPercent !== null && bench.cpuUsage?.totalPercent !== undefined
            ? `${bench.cpuUsage.totalPercent}%`
            : 'N/A';

          const statusColor = bench.isHardwareConfirmed ? '#34d399' : (bench.usedNoPreferenceFallback ? '#fbbf24' : '#38bdf8');
          const statusHeading = bench.isHardwareConfirmed
            ? '✅ GPU Hardware Confirmado pelo Benchmark Real'
            : (bench.usedNoPreferenceFallback
              ? '⚠️ Fallback Diagnóstico (no-preference) Ativo — Codificador Software Provável'
              : 'ℹ️ Codificação WebCodecs Concluída');

          benchBoxEl.innerHTML = `
            <div style="margin-bottom: 8px; font-weight: 600; color: ${statusColor};">
              ${statusHeading} (${(bench.durationMs / 1000).toFixed(1)}s):
            </div>
            <div class="diag-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;">
              <div class="diag-card" style="padding: 6px 8px;">
                <span class="diag-label" style="font-size: 0.68rem;">Resolução Real (frameW x frameH):</span>
                <strong class="diag-val" style="color: #f8fafc; font-size: 0.84rem;">${bench.frameW}x${bench.frameH}</strong>
              </div>
              <div class="diag-card" style="padding: 6px 8px;">
                <span class="diag-label" style="font-size: 0.68rem;">Dimensões no Encoder:</span>
                <strong class="diag-val" style="color: #38bdf8; font-size: 0.84rem;">${bench.encodedWidth}x${bench.encodedHeight}${bench.resolutionScaled ? ' (Reduzido <=1080p)' : ' (Nativo)'}</strong>
              </div>
              <div class="diag-card" style="padding: 6px 8px;">
                <span class="diag-label" style="font-size: 0.68rem;">Candidato Aprovado:</span>
                <strong class="diag-val" style="color: #34d399; font-size: 0.8rem;">${escapeHtml(bench.codec)} (${escapeHtml(bench.hardwareAcceleration)}, br=${escapeHtml(bench.bitrateMode || 'omitido')})</strong>
              </div>
              <div class="diag-card" style="padding: 6px 8px;">
                <span class="diag-label" style="font-size: 0.68rem;">Caiu em no-preference?:</span>
                <strong class="diag-val" style="color: ${bench.usedNoPreferenceFallback ? '#fbbf24' : '#34d399'}; font-size: 0.82rem;">${bench.usedNoPreferenceFallback ? '⚠️ Sim (no-preference)' : '✅ Não (prefer-hardware)'}</strong>
              </div>
              <div class="diag-card" style="padding: 6px 8px;">
                <span class="diag-label" style="font-size: 0.68rem;">FPS &amp; Tempo de Encode:</span>
                <strong class="diag-val" style="color: #34d399; font-size: 0.84rem;">${bench.fpsEncoded} FPS • ${bench.avgHardwareEncodeTimeMs} ms/frame</strong>
              </div>
              <div class="diag-card" style="padding: 6px 8px;">
                <span class="diag-label" style="font-size: 0.68rem;">Fila Máx &amp; CPU (Tab/GPU/App):</span>
                <strong class="diag-val" style="color: #e2e8f0; font-size: 0.78rem;">fila máx: ${bench.maxQueueSize} | CPU: ${rendererCpu} / ${gpuProcCpu} / ${totalAppCpu}</strong>
              </div>
            </div>
            ${renderAttemptsList(bench.attempts)}
          `;
        }
      }
    }
  } catch (err) {
    console.error('[Diagnostics] Erro ao testar WebCodecs GPU:', err);
    probeListEl.innerHTML = `<span style="color: #ef4444;">Erro inesperado no teste WebCodecs: ${escapeHtml(err?.message || String(err))}</span>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Testar Motor WebCodecs GPU';
    }
  }
}

async function probeEnvReportWebCodecsMatrix() {
  const codecs = ['avc1.42e02a', 'avc1.4d002a', 'avc1.64002a'];
  const framerates = [30, 60];
  const avcVariants = [
    { key: 'sem annexb', avc: undefined },
    { key: 'com annexb', avc: { format: 'annexb' } }
  ];

  const matrix = [];
  const hasVideoEncoder = typeof globalThis.VideoEncoder !== 'undefined' &&
                          typeof globalThis.VideoEncoder.isConfigSupported === 'function';

  for (const codec of codecs) {
    for (const framerate of framerates) {
      for (const variant of avcVariants) {
        const config = {
          codec,
          width: 1920,
          height: 1080,
          bitrate: 8_000_000,
          framerate,
          hardwareAcceleration: 'prefer-hardware',
          latencyMode: 'realtime'
        };
        if (variant.avc) {
          config.avc = variant.avc;
        }

        let supported = false;
        let resolvedConfig = null;
        let error = null;

        if (!hasVideoEncoder) {
          error = 'VideoEncoder.isConfigSupported indisponível';
        } else {
          try {
            const res = await globalThis.VideoEncoder.isConfigSupported(config);
            supported = Boolean(res?.supported);
            resolvedConfig = res?.config || null;
          } catch (err) {
            supported = false;
            error = err?.message || String(err);
          }
        }

        matrix.push({
          codec,
          framerate,
          formato: variant.key,
          width: 1920,
          height: 1080,
          bitrate: 8_000_000,
          hardwareAcceleration: 'prefer-hardware',
          latencyMode: 'realtime',
          avc: variant.avc || null,
          supported,
          resolvedConfig,
          error
        });
      }
    }
  }

  return matrix;
}

function renderEnvReportMatrixTable(matrix = [], statusBannerHtml = '') {
  const matrixBoxEl = document.getElementById('diagEnvReportMatrixBox');
  if (!matrixBoxEl) return;

  const rowsHtml = matrix.map((item) => {
    const supBadge = item.supported
      ? '<span class="diag-badge-hw" style="font-size: 0.68rem; padding: 1px 6px;">true ✅</span>'
      : `<span class="diag-badge-sw" style="font-size: 0.68rem; padding: 1px 6px;">false ❌${item.error ? ' (' + escapeHtml(item.error) + ')' : ''}</span>`;
    return `
      <tr>
        <td style="font-family: monospace; font-weight: 600; color: #f8fafc;">${escapeHtml(item.codec)}</td>
        <td style="font-family: monospace;">${item.framerate} fps</td>
        <td style="font-family: monospace;">${escapeHtml(item.formato)}</td>
        <td>${supBadge}</td>
      </tr>
    `;
  }).join('');

  matrixBoxEl.classList.remove('hidden');
  matrixBoxEl.innerHTML = `
    ${statusBannerHtml}
    <div style="margin-bottom: 6px; font-weight: 600; color: #e2e8f0; font-size: 0.74rem;">
      Matriz VideoEncoder.isConfigSupported (1920x1080 • 8 Mbps • realtime • prefer-hardware):
    </div>
    <div class="diag-table-container">
      <table class="diag-table" style="font-size: 0.72rem;">
        <thead>
          <tr>
            <th>Codec</th>
            <th>FPS</th>
            <th>Formato AVC</th>
            <th>Supported</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

async function handleCopyEnvReport() {
  const btn = document.getElementById('btnCopyEnvReport');
  const origText = btn ? btn.textContent : '📋 Copiar relatório de ambiente';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Coletando relatório...';
  }

  try {
    let envData = {};
    if (window.desktopAPI && typeof window.desktopAPI.getEnvReport === 'function') {
      envData = await window.desktopAPI.getEnvReport();
    } else {
      envData = {
        note: 'Coletado no navegador (window.desktopAPI.getEnvReport indisponível fora do Electron)'
      };
    }

    const [matrix, rtpAndNegotiated] = await Promise.all([
      probeEnvReportWebCodecsMatrix(),
      collectRtpSenderH264AndNegotiated()
    ]);

    const fullReport = {
      collectedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      ...envData,
      rtpSenderH264Capabilities: rtpAndNegotiated.rtpSenderH264Capabilities,
      negotiatedOutbound: rtpAndNegotiated.negotiatedOutbound,
      videoEncoderIsConfigSupportedMatrix: matrix
    };

    const jsonString = JSON.stringify(fullReport, null, 2);
    let copiedOk = false;
    try {
      await navigator.clipboard.writeText(jsonString);
      copiedOk = true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = jsonString;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copiedOk = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    }

    const banner = copiedOk
      ? '<div style="margin-bottom: 8px; padding: 6px 10px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 4px; color: #34d399; font-weight: 600; font-size: 0.73rem;">✅ Relatório completo de ambiente (JSON) copiado para a área de transferência!</div>'
      : '<div style="margin-bottom: 8px; padding: 6px 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 4px; color: #fbbf24; font-weight: 600; font-size: 0.73rem;">⚠️ Matriz gerada (veja o console para o JSON completo caso a área de transferência esteja bloqueada).</div>';

    console.log('[EnvReport JSON]', fullReport);
    await renderRtpSenderH264Section4(rtpAndNegotiated);
    renderEnvReportMatrixTable(matrix, banner);

    if (btn) {
      btn.textContent = copiedOk ? '✅ Relatório copiado!' : '⚠️ Ver Console';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = origText;
      }, 2500);
    }
  } catch (err) {
    console.error('[Diagnostics] Erro ao gerar relatório de ambiente:', err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

async function openDiagnosticsModal() {
  const modal = document.getElementById('diagnosticsModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  await renderDiagnosticsData();
  probeEnvReportWebCodecsMatrix()
    .then((matrix) => renderEnvReportMatrixTable(matrix))
    .catch((err) => console.warn('[Diagnostics] Erro ao renderizar matriz inicial WebCodecs:', err));
  if (!diagnosticsInterval) {
    diagnosticsInterval = setInterval(() => {
      renderDiagnosticsData().catch(e => console.warn('[Diagnostics] Erro na atualização periódica:', e));
    }, 1500);
  }
}

function closeDiagnosticsModal() {
  const modal = document.getElementById('diagnosticsModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (diagnosticsInterval) {
    clearInterval(diagnosticsInterval);
    diagnosticsInterval = null;
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

  // Preenche automaticamente o campo de entrar com a última sala salva caso não haja sala na URL
  const last = RoomState.getLastRoom();
  if (roomFromUrl) {
    switchLobbyTab('join');
    if (joinRoomIdInput) joinRoomIdInput.value = roomFromUrl.trim().toLowerCase();
    if (pinFromUrl && joinPasswordInput) {
      joinPasswordInput.value = pinFromUrl;
      showLobbyAlert(`Convite recebido para a sala "${roomFromUrl}" com PIN automático preenchido. Clique em Entrar!`, 'info');
    } else {
      showLobbyAlert(`Convite recebido para a sala "${roomFromUrl}".`, 'info');
    }
  } else if (last && last.roomId) {
    if (joinRoomIdInput && !joinRoomIdInput.value) {
      joinRoomIdInput.value = last.roomId.toLowerCase();
    }
    if (last.roomPin && joinPasswordInput && !joinPasswordInput.value) {
      joinPasswordInput.value = last.roomPin;
    }
  }

  // Inicialização autônoma de diagnóstico de hardware e aceleração GPU
  (async () => {
    try {
      if (window.desktopAPI && typeof window.desktopAPI.getGpuDiagnostics === 'function') {
        const gpuDiag = await window.desktopAPI.getGpuDiagnostics();
        if (gpuDiag) {
          const gpuName = gpuDiag.systemGpu?.name || gpuDiag.gpuInfo?.gpuDevice?.[0]?.description || gpuDiag.gpuInfo?.gpuDevice?.[0]?.deviceString || 'GPU Dedicada (Desktop)';
          const evaluated = evaluateCodecCapabilities(
            { description: gpuName, vendor: gpuName },
            gpuDiag.featureStatus || {}
          );
          webrtc.setHardwareCapabilities(evaluated);
          console.log('[App] Diagnóstico inicial de GPU carregado com sucesso:', gpuName);
        }
      } else {
        const webGpu = WebRTCManager.detectGpuHardwareAcceleration();
        const evaluated = evaluateCodecCapabilities(
          { description: webGpu.renderer || '', vendor: webGpu.vendor || '' },
          { video_encode: 'enabled' }
        );
        webrtc.setHardwareCapabilities(evaluated);
      }
    } catch (err) {
      console.warn('[App] Erro na detecção inicial de hardware:', err);
    }
  })();

  // Sincronização em tempo real do nome de usuário entre as abas e persistência imediata
  const handleUsernameSync = (val) => {
    const trimmed = (val || '').trim();
    if (createUsernameInput && createUsernameInput.value !== val) {
      createUsernameInput.value = val;
    }
    if (joinUsernameInput && joinUsernameInput.value !== val) {
      joinUsernameInput.value = val;
    }
    if (trimmed) {
      try { localStorage.setItem('webrtc_username', trimmed); } catch (_) {}
      if (window.desktopAPI && typeof window.desktopAPI.savePreferences === 'function') {
        window.desktopAPI.savePreferences({ username: trimmed });
      }
    }
  };

  if (createUsernameInput) {
    createUsernameInput.addEventListener('input', (e) => handleUsernameSync(e.target.value));
    createUsernameInput.addEventListener('change', (e) => handleUsernameSync(e.target.value));
  }
  if (joinUsernameInput) {
    joinUsernameInput.addEventListener('input', (e) => handleUsernameSync(e.target.value));
    joinUsernameInput.addEventListener('change', (e) => handleUsernameSync(e.target.value));
  }

  setupEventListeners();
  setupSignalingEvents();
  setupWebRTCEvents();
  setupSettingsModal();
  updateLastRoomCardUI();

  // Detecção de Ambiente Desktop (Electron com WGC)
  if (window.desktopAPI) {
    console.log('[Desktop] Detectado ambiente nativo Desktop via Electron com WGC e aceleração GPU!');
    if (desktopAppBadge) {
      desktopAppBadge.classList.remove('hidden');
    }
    const lobbyDownloadApp = document.getElementById('lobbyDownloadApp');
    if (lobbyDownloadApp) {
      lobbyDownloadApp.classList.add('hidden');
    }

    if (typeof window.desktopAPI.getPreferences === 'function') {
      window.desktopAPI.getPreferences().then(prefs => {
        if (!prefs) return;
        if (prefs.username && (!savedUsername || createUsernameInput?.value?.startsWith('User_'))) {
          try { localStorage.setItem('webrtc_username', prefs.username); } catch (_) {}
          if (createUsernameInput) createUsernameInput.value = prefs.username;
          if (joinUsernameInput) joinUsernameInput.value = prefs.username;
        }
        if (prefs.lastRoom && !RoomState.getLastRoom()) {
          RoomState.saveLastRoom(prefs.lastRoom.roomId, prefs.lastRoom.username || prefs.username, prefs.lastRoom.roomPin);
          if (joinRoomIdInput && !joinRoomIdInput.value && !roomFromUrl) {
            joinRoomIdInput.value = prefs.lastRoom.roomId.toLowerCase();
          }
          if (prefs.lastRoom.roomPin && joinPasswordInput && !joinPasswordInput.value && !roomFromUrl) {
            joinPasswordInput.value = prefs.lastRoom.roomPin;
          }
          updateLastRoomCardUI();
        }
      }).catch(err => console.warn('[App] Erro ao carregar preferências do desktop:', err));
    }
  }

  // Configuração Inicial de Layout e Painel Lateral
  if (btnLayoutGrid) btnLayoutGrid.addEventListener('click', () => setLayoutMode('grid'));
  if (btnLayoutStage) btnLayoutStage.addEventListener('click', () => setLayoutMode('stage'));
  if (btnLayoutTheater) btnLayoutTheater.addEventListener('click', () => setLayoutMode('theater'));
  if (btnToggleParticipantsStrip) btnToggleParticipantsStrip.addEventListener('click', () => toggleParticipantsStrip());
  if (btnCollapseStrip) btnCollapseStrip.addEventListener('click', () => toggleParticipantsStrip(true));
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
  RoomState.saveLastRoom(sanitizedRoom, cleanUsername, cleanPassword);
  if (window.desktopAPI && typeof window.desktopAPI.savePreferences === 'function') {
    window.desktopAPI.savePreferences({
      username: cleanUsername,
      lastRoom: {
        roomId: sanitizedRoom.toUpperCase(),
        username: cleanUsername,
        roomPin: cleanPassword,
        timestamp: Date.now()
      }
    });
  }
  updateLastRoomCardUI();

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

  // --- BOTÕES DO CARD DE ÚLTIMA SALA (LOBBY) ---
  const btnRejoinLastRoom = document.getElementById('btnRejoinLastRoom');
  const btnClearLastRoom = document.getElementById('btnClearLastRoom');

  if (btnRejoinLastRoom) {
    btnRejoinLastRoom.addEventListener('click', () => {
      const last = RoomState.getLastRoom();
      const currentSavedUser = (() => {
        try { return localStorage.getItem('webrtc_username'); } catch (_) { return null; }
      })();
      const userToUse = (last && last.username) || currentSavedUser || (createUsernameInput ? createUsernameInput.value : '') || ('User_' + Math.floor(Math.random() * 900 + 100));

      if (last && last.roomId) {
        console.log(`[App] Reingressando na última sala: ${last.roomId} como ${userToUse}`);
        enterRoom({
          roomId: last.roomId,
          username: userToUse,
          isHost: false,
          password: last.roomPin,
          submitBtn: btnRejoinLastRoom
        });
      }
    });
  }

  if (btnClearLastRoom) {
    btnClearLastRoom.addEventListener('click', () => {
      RoomState.clearLastRoom();
      updateLastRoomCardUI();
    });
  }

  // --- BOTÕES DO BANNER DE RECONEXÃO AUTOMÁTICA ---
  const btnReconnectNow = document.getElementById('btnReconnectNow');
  const btnCancelReconnect = document.getElementById('btnCancelReconnect');
  const btnLeaveRoomReconnect = document.getElementById('btnLeaveRoomReconnect');

  if (btnReconnectNow) {
    btnReconnectNow.addEventListener('click', () => {
      console.log('[App] Reconexão manual solicitada pelo usuário');
      signaling.reconnectNow();
    });
  }
  if (btnCancelReconnect) {
    btnCancelReconnect.addEventListener('click', () => {
      console.log('[App] Tentativa de reconexão cancelada pelo usuário');
      signaling.cancelReconnect();
      hideReconnectBanner();
      updateConnectionStatus('', 'Reconexão Cancelada');
    });
  }
  if (btnLeaveRoomReconnect) {
    btnLeaveRoomReconnect.addEventListener('click', () => {
      console.log('[App] Usuário optou por sair durante tentativa de reconexão');
      signaling.cancelReconnect();
      hideReconnectBanner();
      leaveCurrentRoom();
    });
  }

  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', async () => {
      let baseUrl = window.location.origin;
      if (window.desktopAPI && typeof window.desktopAPI.getServerUrl === 'function') {
        try {
          const sUrl = await window.desktopAPI.getServerUrl();
          if (sUrl && (sUrl.startsWith('http://') || sUrl.startsWith('https://'))) {
            baseUrl = sUrl.replace(/\/$/, '');
          }
        } catch (_) {}
      } else if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        baseUrl = 'https://hyperstream-g9gz.onrender.com';
      }

      let inviteUrl = `${baseUrl}/?room=${encodeURIComponent(roomState.roomId)}`;
      if (roomState.hasPassword && roomState.roomPin) {
        inviteUrl += `&pin=${encodeURIComponent(roomState.roomPin)}`;
      }
      navigator.clipboard.writeText(inviteUrl).then(() => {
        btnCopyLink.innerHTML = `${Icons.check(13)} <span>Copiado!</span>`;
        setTimeout(() => {
          btnCopyLink.innerHTML = `${Icons.copy(13)} <span>Copiar Link</span>`;
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

  // --- BOTÃO DE DIAGNÓSTICO UNIFICADO EM TEMPO REAL ---
  const btnDiagnostics = document.getElementById('btnDiagnostics');
  const diagnosticsModal = document.getElementById('diagnosticsModal');
  const btnCloseDiagnostics = document.getElementById('btnCloseDiagnostics');
  const btnCloseDiagnosticsFooter = document.getElementById('btnCloseDiagnosticsFooter');
  const btnTestGpuWebCodecs = document.getElementById('btnTestGpuWebCodecs');
  const btnCopyEnvReport = document.getElementById('btnCopyEnvReport');
  const btnOpenChromeGpu = document.getElementById('btnOpenChromeGpu');
  const btnToggleFloatingHud = document.getElementById('btnToggleFloatingHud');

  if (btnToggleFloatingHud && telemetryHud) {
    btnToggleFloatingHud.addEventListener('click', () => {
      telemetryHud.classList.toggle('hidden');
    });
  }

  if (btnDiagnostics) {
    btnDiagnostics.addEventListener('click', openDiagnosticsModal);
  }
  if (btnCloseDiagnostics) {
    btnCloseDiagnostics.addEventListener('click', closeDiagnosticsModal);
  }
  if (btnCloseDiagnosticsFooter) {
    btnCloseDiagnosticsFooter.addEventListener('click', closeDiagnosticsModal);
  }
  if (btnTestGpuWebCodecs) {
    btnTestGpuWebCodecs.addEventListener('click', handleTestGpuWebCodecs);
  }
  if (btnCopyEnvReport) {
    btnCopyEnvReport.addEventListener('click', handleCopyEnvReport);
  }
  if (btnOpenChromeGpu) {
    if (window.desktopAPI && typeof window.desktopAPI.openChromeGpu === 'function') {
      btnOpenChromeGpu.addEventListener('click', async () => {
        try {
          await window.desktopAPI.openChromeGpu();
        } catch (err) {
          console.error('[Diagnostics] Erro ao abrir chrome://gpu:', err);
        }
      });
    } else {
      btnOpenChromeGpu.classList.add('hidden');
      btnOpenChromeGpu.disabled = true;
    }
  }
  if (diagnosticsModal) {
    diagnosticsModal.addEventListener('click', (e) => {
      if (e.target === diagnosticsModal) closeDiagnosticsModal();
    });
  }

  // Seletor de Perfil de Qualidade / Banda (Ultra 60, Equilibrado, Econômico)
  const profileBtns = document.querySelectorAll('.btn-profile');
  profileBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const profileKey = btn.getAttribute('data-profile');
      if (!profileKey) return;
      qualityController.setProfile(profileKey);
      profileBtns.forEach(b => b.classList.toggle('active', b === btn));
      appendSystemChat(`Perfil de transmissão alterado para: ${btn.textContent.trim()}`);
    });
  });

  if (chkAutoPauseLocalPreview) {
    chkAutoPauseLocalPreview.checked = autoPauseLocalPreview;
    chkAutoPauseLocalPreview.addEventListener('change', () => {
      autoPauseLocalPreview = chkAutoPauseLocalPreview.checked;
      try { localStorage.setItem('hyperstream_auto_pause_local_preview', autoPauseLocalPreview ? 'true' : 'false'); } catch (_) {}
      const screenPreview = localPreviews.get('screen');
      if (screenPreview && typeof screenPreview.togglePreviewVisibility === 'function') {
        screenPreview.togglePreviewVisibility(autoPauseLocalPreview);
      }
    });
  }

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
      if (tabChat) tabChat.classList.toggle('active', target === 'chat');
      if (tabParticipants) tabParticipants.classList.toggle('active', target === 'participants');
    });
  });

  // ========================================================
  // ENVIO DE IMAGENS EFÊMERAS NO CHAT & LIGHTBOX
  // ========================================================
  if (btnAttachImage && chatImageInput) {
    btnAttachImage.addEventListener('click', () => {
      chatImageInput.click();
    });
    chatImageInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        handleChatImageFile(file);
      }
    });
  }

  if (btnRemoveChatImage) {
    btnRemoveChatImage.addEventListener('click', clearPendingChatImage);
  }

  // Suporte a Colar Imagens diretamente da Área de Transferência (Ctrl+V) no input de chat
  if (chatInput) {
    chatInput.addEventListener('paste', (e) => {
      const file = extractImageFileFromClipboard(e);
      if (file) {
        e.preventDefault();
        handleChatImageFile(file);
      }
    });
  }

  // Suporte global a Colar Imagens (Ctrl+V) em qualquer lugar da tela da sala quando o chat estiver acessível
  document.addEventListener('paste', (e) => {
    const target = e.target;
    if (target === chatInput) return; // Já tratado pelo listener específico
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target.id !== 'chatInput') {
      return; // Não intercepta outros campos de formulário (ex: PIN)
    }

    if (roomScreen && roomScreen.classList.contains('active')) {
      const file = extractImageFileFromClipboard(e);
      if (file) {
        e.preventDefault();
        // Se a aba do chat não estiver ativa, ativa a aba do chat
        const tabBtnChat = document.querySelector('.sidebar-tabs .tab-btn[data-tab="chat"]');
        if (tabBtnChat && !tabBtnChat.classList.contains('active')) {
          tabBtnChat.click();
        }
        handleChatImageFile(file);
      }
    }
  });

  // Suporte a Arrastar e Soltar (Drag & Drop) imagens no chat
  if (tabChat) {
    tabChat.addEventListener('dragover', (e) => {
      e.preventDefault();
      tabChat.classList.add('drag-over');
    });
    tabChat.addEventListener('dragleave', (e) => {
      e.preventDefault();
      tabChat.classList.remove('drag-over');
    });
    tabChat.addEventListener('drop', (e) => {
      e.preventDefault();
      tabChat.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0 && isImageFile(files[0])) {
        handleChatImageFile(files[0]);
      }
    });
  }

  if (btnCloseLightbox) {
    btnCloseLightbox.addEventListener('click', closeImageLightbox);
  }
  if (imageLightboxModal) {
    imageLightboxModal.addEventListener('click', (e) => {
      if (e.target === imageLightboxModal) closeImageLightbox();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageLightboxModal && !imageLightboxModal.classList.contains('hidden')) {
      closeImageLightbox();
    }
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Se a imagem ainda estiver sendo comprimida, aguarda brevemente a conclusão
    if (isProcessingChatImage) {
      let attempts = 0;
      while (isProcessingChatImage && attempts < 25) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
    }

    const text = chatInput.value.trim();
    const image = pendingChatImage ? pendingChatImage.dataUrl : null;
    if (!text && !image) return;

    signaling.send('CHAT_MESSAGE', { text, image });
    chatInput.value = '';
    clearPendingChatImage();
  });

  // Botões de Iniciar Mídia
  if (btnShareScreen) btnShareScreen.addEventListener('click', handleToggleScreenShare);
  if (btnPromptShare) btnPromptShare.addEventListener('click', handleToggleScreenShare);

  if (btnToggleCamera) btnToggleCamera.addEventListener('click', handleToggleCamera);
  if (btnPromptCamera) btnPromptCamera.addEventListener('click', handleToggleCamera);

  // Mute / Unmute microfone
  btnToggleAudio.addEventListener('click', async () => {
    try {
      const { muted, stream } = await media.toggleMicrophone();
      micIcon.innerHTML = muted ? Icons.micOff(18) : Icons.mic(18);
      micLabel.textContent = muted ? 'Microfone Mutado' : 'Microfone Ativo';
      btnToggleAudio.classList.toggle('active', !muted);

      const otherIds = roomState.getOtherParticipantIds();
      await webrtc.syncLocalMedia(media, otherIds);
      await webrtc.renegotiateAllPeers(otherIds);

      signaling.send('MUTE', { muted });

      if (!muted && media.micStream) {
        vad.monitorStream(roomState.myUserId, media.micStream);
      } else {
        vad.setSpeaking(roomState.myUserId, false);
      }

      updateGridLayout();
    } catch (err) {
      alert('Não foi possível acessar o microfone: ' + err.message);
    }
  });

  // Tela Cheia Geral
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      if (isMobileDevice() && screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
      videoWrapper.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen().catch(err => console.warn(err));
    }
  });

  // Sair da Sala (Barra inferior e Barra superior)
  if (btnLeaveRoom) {
    btnLeaveRoom.addEventListener('click', () => {
      leaveCurrentRoom();
    });
  }
  if (btnLeaveRoomHeader) {
    btnLeaveRoomHeader.addEventListener('click', () => {
      leaveCurrentRoom();
    });
  }

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
    cameraIcon.innerHTML = active ? Icons.video(18) : Icons.videoOff(18);
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
      removeTile('local-camera');
      if (roomState.myUserId) {
        removeTile(`${roomState.myUserId}-camera`);
      }
      removeLocalPreview('camera');

      await webrtc.syncLocalMedia(media, otherIds);
      await webrtc.renegotiateAllPeers(otherIds);

      signaling.send('MEDIA_STATE', {
        type: 'camera',
        active: false
      });
      appendSystemChat('Você desativou sua câmera.');

      if (activeTiles.size === 0) {
        setLayoutMode('grid');
      }
    }
    updateGridLayout();
  } catch (err) {
    console.error('[App] Erro ao alternar câmera:', err);
    alert('Não foi possível acessar a câmera:\n' + err.message + '\n\nCertifique-se de que a webcam não está aberta em outro aplicativo.');
  }
}

// ========================================================
// ========================================================
// 4. FLUXO DE COMPARTILHAMENTO DE TELA (SELETOR DIRETO)
// ========================================================

const desktopSourceModal = document.getElementById('desktopSourceModal');
const btnCloseSourceModal = document.getElementById('btnCloseSourceModal');
const btnCancelSourcePicker = document.getElementById('btnCancelSourcePicker');
const btnStartTransmissionModal = document.getElementById('btnStartTransmissionModal');

// Subfiltros de fontes
const tabSourcesScreens = document.getElementById('tabSourcesScreens');
const tabSourcesWindows = document.getElementById('tabSourcesWindows');
const sourceSearchInput = document.getElementById('sourceSearchInput');
const sourcesGrid = document.getElementById('sourcesGrid');
const sourcesLoading = document.getElementById('sourcesLoading');
const webBrowserNotice = document.getElementById('webBrowserNotice');
const summarySourceName = document.getElementById('summarySourceName');

let cachedDesktopSources = [];
let currentSourceFilter = 'screen';
let selectedModalSource = null;

function promptDesktopSourcePicker() {
  return new Promise(async (resolve) => {
    // Se estiver em navegador Web (sem Electron), o diálogo nativo do navegador é disparado direto
    if (!window.desktopAPI || typeof window.desktopAPI.getSources !== 'function') {
      return resolve({ source: null, confirmed: true });
    }

    if (!desktopSourceModal) {
      return resolve({ source: null, confirmed: true });
    }

    desktopSourceModal.classList.remove('hidden');
    if (sourcesGrid) sourcesGrid.innerHTML = '';
    if (sourcesLoading) sourcesLoading.classList.remove('hidden');
    if (sourceSearchInput) sourceSearchInput.value = '';

    // Pré-seleciona padrão seguro
    selectedModalSource = { id: 'default', name: 'Monitor Principal' };
    if (btnStartTransmissionModal) btnStartTransmissionModal.disabled = false;
    if (summarySourceName) summarySourceName.textContent = 'Monitor Principal';

    function cleanup() {
      desktopSourceModal.classList.add('hidden');
      btnCloseSourceModal?.removeEventListener('click', onCancel);
      btnCancelSourcePicker?.removeEventListener('click', onCancel);
      btnStartTransmissionModal?.removeEventListener('click', onConfirm);
      tabSourcesScreens?.removeEventListener('click', onTabScreens);
      tabSourcesWindows?.removeEventListener('click', onTabWindows);
      sourceSearchInput?.removeEventListener('input', onSearchInput);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    async function onConfirm() {
      if (selectedModalSource && window.desktopAPI && typeof window.desktopAPI.setSelectedSource === 'function') {
        const sId = (selectedModalSource.id && !selectedModalSource.id.startsWith('browser-') && selectedModalSource.id !== 'default') 
          ? selectedModalSource.id 
          : null;
        try {
          await window.desktopAPI.setSelectedSource(sId);
        } catch (e) {
          console.warn('[Desktop] setSelectedSource:', e);
        }
      }
      cleanup();
      resolve({ source: selectedModalSource, confirmed: true });
    }

    function onTabScreens() {
      currentSourceFilter = 'screen';
      tabSourcesScreens?.classList.add('active');
      tabSourcesWindows?.classList.remove('active');
      renderSourceItems(onSourceItemClicked, onSourceItemDblClicked);
    }

    function onTabWindows() {
      currentSourceFilter = 'window';
      tabSourcesWindows?.classList.add('active');
      tabSourcesScreens?.classList.remove('active');
      renderSourceItems(onSourceItemClicked, onSourceItemDblClicked);
    }

    function onSearchInput() {
      renderSourceItems(onSourceItemClicked, onSourceItemDblClicked);
    }

    function onSourceItemClicked(source, element) {
      selectedModalSource = source;
      sourcesGrid?.querySelectorAll('.source-item').forEach(el => el.classList.remove('selected'));
      element.classList.add('selected');
      if (summarySourceName) summarySourceName.textContent = source.name;
      if (btnStartTransmissionModal) btnStartTransmissionModal.disabled = false;

      if (window.desktopAPI && typeof window.desktopAPI.setSelectedSource === 'function') {
        const sId = (source && source.id && !source.id.startsWith('browser-') && source.id !== 'default') ? source.id : null;
        window.desktopAPI.setSelectedSource(sId).catch(err => console.warn('[Desktop] setSelectedSource:', err));
      }
    }

    function onSourceItemDblClicked(source, element) {
      onSourceItemClicked(source, element);
      onConfirm();
    }

    // Registra listeners
    btnCloseSourceModal?.addEventListener('click', onCancel);
    btnCancelSourcePicker?.addEventListener('click', onCancel);
    btnStartTransmissionModal?.addEventListener('click', onConfirm);
    tabSourcesScreens?.addEventListener('click', onTabScreens);
    tabSourcesWindows?.addEventListener('click', onTabWindows);
    sourceSearchInput?.addEventListener('input', onSearchInput);

    // Carrega fontes no Desktop
    try {
      cachedDesktopSources = await window.desktopAPI.getSources({ types: ['screen', 'window'] });
    } catch (err) {
      console.error('[Desktop] Erro ao obter fontes:', err);
      cachedDesktopSources = [];
    } finally {
      if (sourcesLoading) sourcesLoading.classList.add('hidden');
    }

    if (cachedDesktopSources.length > 0) {
      const defaultScreen = cachedDesktopSources.find(s => s.id.startsWith('screen:')) || cachedDesktopSources[0];
      selectedModalSource = defaultScreen;
      if (summarySourceName) summarySourceName.textContent = defaultScreen.name;
      if (btnStartTransmissionModal) btnStartTransmissionModal.disabled = false;
      if (window.desktopAPI && typeof window.desktopAPI.setSelectedSource === 'function') {
        window.desktopAPI.setSelectedSource(defaultScreen.id).catch(() => {});
      }
    }
    renderSourceItems(onSourceItemClicked, onSourceItemDblClicked);
  });
}

function renderSourceItems(onClick, onDblClick) {
  if (!sourcesGrid) return;
  sourcesGrid.innerHTML = '';

  const search = sourceSearchInput ? sourceSearchInput.value.trim().toLowerCase() : '';

  const filtered = cachedDesktopSources.filter(s => {
    const isScreen = s.id.startsWith('screen:');
    if (currentSourceFilter === 'screen' && !isScreen) return false;
    if (currentSourceFilter === 'window' && isScreen) return false;
    if (search && !s.name.toLowerCase().includes(search)) return false;
    return true;
  });

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sources-empty';
    empty.textContent = search
      ? 'Nenhum resultado encontrado para a busca.'
      : (currentSourceFilter === 'screen' ? 'Nenhum monitor adicional detectado.' : 'Nenhuma janela detectada.');
    sourcesGrid.appendChild(empty);
    return;
  }

  filtered.forEach(source => {
    const item = document.createElement('div');
    item.className = 'source-item';
    if (selectedModalSource && selectedModalSource.id === source.id) {
      item.classList.add('selected');
    }
    item.title = source.name;

    const thumbContainer = document.createElement('div');
    thumbContainer.className = 'source-thumb-container';

    if (source.thumbnail) {
      const img = document.createElement('img');
      img.className = 'source-thumb';
      img.src = source.thumbnail;
      img.alt = source.name;
      thumbContainer.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'source-info';

    if (source.appIcon) {
      const icon = document.createElement('img');
      icon.className = 'source-app-icon';
      icon.src = source.appIcon;
      info.appendChild(icon);
    }

    const name = document.createElement('span');
    name.className = 'source-name';
    name.textContent = source.name;
    info.appendChild(name);

    item.appendChild(thumbContainer);
    item.appendChild(info);

    item.addEventListener('click', () => onClick(source, item));
    item.addEventListener('dblclick', () => onDblClick(source, item));
    sourcesGrid.appendChild(item);
  });
}

async function handleToggleScreenShare() {
  const isSharing = btnShareScreen.classList.contains('active') || media.hasActiveScreenStream() || !!media.screenStream;
  if (isSharing) {
    media.stopScreenCapture();
    handleStreamEnded();
  } else {
    try {
      const result = await promptDesktopSourcePicker();
      if (!result || !result.confirmed) {
        console.log('[App] Transmissão cancelada pelo usuário no seletor de tela.');
        return;
      }

      console.log(`[App] Iniciando compartilhamento de tela com perfil ${qualityController.activeProfile}...`);
      const stream = await media.startScreenCapture();

      addOrUpdateLocalPreview('screen', media.screenStream, 'Sua Tela (60 FPS)');

      btnShareScreen.classList.add('active');
      btnShareScreen.querySelector('.label').textContent = 'Parar Tela';

      const otherIds = roomState.getOtherParticipantIds();
      await webrtc.syncLocalMedia(media, otherIds);
      await qualityController.applyProfileToPeers();
      await webrtc.renegotiateAllPeers(otherIds);

      const hasAudio = media.getScreenAudioTrack() !== null;
      const trackId = media.getScreenVideoTrack()?.id;
      const streamId = media.screenStream?.id;

      signaling.send('START_STREAM', { type: 'screen', hasVideo: true, hasAudio, trackId, streamId, userId: roomState.myUserId });
      signaling.send('MEDIA_STATE', { type: 'screen', active: true, trackId, streamId, userId: roomState.myUserId });

      appendSystemChat(`Você iniciou o compartilhamento de tela.`);
      updateGridLayout();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        console.log('[App] Transmissão de tela cancelada pelo usuário ou permissão negada:', err.message);
        return;
      }
      console.error('[App] Falha ao compartilhar tela:', err);
      alert('Não foi possível iniciar o compartilhamento de tela:\n' + err.message);
    }
  }
}

function handleStreamEnded() {
  removeTile('local-screen');
  removeTile('local-desktop');
  if (roomState.myUserId) {
    removeTile(`${roomState.myUserId}-screen`);
    removeTile(`${roomState.myUserId}-desktop`);
  }
  removeLocalPreview('screen');

  btnShareScreen.classList.remove('active');
  btnShareScreen.querySelector('.label').textContent = 'Compartilhar Tela';

  const otherIds = roomState.getOtherParticipantIds();
  webrtc.syncLocalMedia(media, otherIds);
  webrtc.renegotiateAllPeers(otherIds).catch(() => {});

  signaling.send('STOP_STREAM', { userId: roomState.myUserId });
  signaling.send('MEDIA_STATE', { type: 'screen', active: false, userId: roomState.myUserId });
  appendSystemChat('Você encerrou o compartilhamento de tela.');

  if (activeTiles.size === 0) {
    setLayoutMode('grid');
  } else {
    updateGridLayout();
  }
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
      playRemoteAudioTrack(fromUserId, track);
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

  // Callback acionado quando um track remoto é mutado (o transmissor minimizou a janela ou pacotes pausaram)
  webrtc.onRemoteTrackMuted = (track, fromUserId) => {
    console.log(`[App] onRemoteTrackMuted recebido de ${fromUserId}: kind=${track.kind}`);
    // Não remove o tile nem destrói o estado remoto (userMedia) ao mutar temporariamente em background.
    // O WebRTC muta tracks automaticamente quando em segundo plano ou oscilação de rede;
    // O tile será retomado assim que novos frames chegarem (onunmute) ou o usuário focar a janela.
  };

  // Callback acionado quando um track remoto é finalizado
  webrtc.onRemoteTrackEnded = (track, fromUserId) => {
    console.log(`[App] onRemoteTrackEnded recebido de ${fromUserId}: kind=${track.kind}`);
    if (track.kind === 'video') {
      const userMedia = remoteUserMedia.get(fromUserId);
      const screenTrack = webrtc.getRemoteVideoTrack(fromUserId, 'screen');
      if (screenTrack === track) {
        if (userMedia) userMedia.screen = false;
        removeTile(`${fromUserId}-screen`);
      } else {
        if (userMedia) userMedia.camera = false;
        removeTile(`${fromUserId}-camera`);
      }
      updateGridLayout();
    }
  };

  // Notificação imediata quando a negociação SDP (Offer/Answer) conclui
  webrtc.onNegotiationComplete = (fromUserId) => {
    console.log(`[App] Negociação SDP concluída para ${fromUserId}. Sincronizando tiles e aplicando encoding...`);
    syncRemotePeerTiles(fromUserId);
    if (qualityController) {
      qualityController.applyEncodingParametersToSender(fromUserId).catch(err => {
        console.warn(`[App] Erro ao aplicar parâmetros após negociação com ${fromUserId}:`, err.message);
      });
    }
  };

  webrtc.onConnectionStateChange = (targetUserId, state) => {
    console.log(`[App] Status P2P com ${targetUserId}: ${state}`);
    if (state === 'connected') {
      updateConnectionStatus('connected', 'P2P Conectado (60 FPS)');
      syncRemotePeerTiles(targetUserId);
    } else if (state === 'connecting') {
      updateConnectionStatus('connecting', 'Conectando P2P...');
    } else if (state === 'disconnected' || state === 'failed') {
      updateConnectionStatus('', 'P2P Desconectado');
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
      btnSubmitCreate.textContent = 'Criar Sala e Iniciar';
    }
    if (btnSubmitJoin) {
      btnSubmitJoin.disabled = false;
      btnSubmitJoin.textContent = 'Entrar na Transmissão';
    }

    const roomId = msg.roomId || msg.data?.roomId || signaling.roomId;
    const { userId, username, isHost, users, iceServers, hostToken, hasPassword, streams } = msg.data || {};
    signaling.userId = userId;

    roomState.setRoomInfo(roomId, userId, username, isHost, users, {
      hostToken,
      hasPassword,
      roomPin: currentAttemptedPin,
      initialStreams: streams || []
    });
    RoomState.saveLastRoom(roomId, username, currentAttemptedPin);
    webrtc.setIceServers(iceServers);

    lobbyScreen.classList.remove('active');
    roomScreen.classList.add('active');

    displayRoomId.textContent = roomId;
    roleBadge.textContent = isHost ? 'Host' : 'Participante';
    roleBadge.className = isHost ? 'badge badge-host' : 'badge';

    if (roomLockBadge) {
      roomLockBadge.classList.toggle('hidden', !hasPassword);
    }

    updateConnectionStatus('connected', 'Sala Pronta');

    updateParticipantsUI();
    updateStreamCatalogBadge();
    renderStreamCatalogUI();

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
      if (hudConnectionType && metrics.connectionType) {
        hudConnectionType.textContent = metrics.connectionType;
        if (metrics.connectionType.includes('Relay')) {
          hudConnectionType.style.color = '#f39c12';
        } else if (metrics.connectionType.includes('STUN')) {
          hudConnectionType.style.color = '#00d2ff';
        } else {
          hudConnectionType.style.color = '#38ef7d';
        }
      }
    });

    appendSystemChat(`Você entrou na sala como ${isHost ? 'Host' : 'Participante'}.`);

    if (media && media.micStream && typeof media.isAudioMuted === 'function' && !media.isAudioMuted()) {
      vad.monitorStream(userId, media.micStream);
    }

    setupViewerActivityReporter();
  });

  /**
   * Monitora a visibilidade e o foco do espectador e sinaliza o Host
   * para redução automática de FPS e resolução (alívio de CPU/GPU do transmissor)
   */
  let viewerActivityCleanup = null;
  const setupViewerActivityReporter = () => {
    if (viewerActivityCleanup) {
      viewerActivityCleanup();
      viewerActivityCleanup = null;
    }

    let currentState = 'active';
    let backgroundTimer = null;
    const INACTIVE_TIMEOUT_MS = 45000; // 45s em segundo plano -> inativo

    const isMobileOrTouch = typeof navigator !== 'undefined' && (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') ||
      (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0)
    );

    const evaluateAndBroadcast = () => {
      const isDocHidden = typeof document !== 'undefined' ? (document.visibilityState === 'hidden') : false;
      const isDocFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true;

      let targetState = 'active';
      if (isDocHidden) {
        targetState = 'background';
      } else if (!isDocFocused && !isMobileOrTouch) {
        // Em desktop, janela desfocada vai para background.
        // Em mobile/touch, a tela ainda está visível para o usuário assistindo à stream, mantendo 'active'.
        targetState = 'background';
      } else {
        targetState = 'active';
      }

      if (targetState === 'background') {
        if (!backgroundTimer) {
          backgroundTimer = setTimeout(() => {
            const stillHidden = typeof document !== 'undefined' ? (document.visibilityState === 'hidden') : false;
            const stillUnfocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
            if (stillHidden || (stillUnfocused && !isMobileOrTouch)) {
              currentState = 'inactive';
              sendViewerState('inactive');
            }
          }, INACTIVE_TIMEOUT_MS);
        }
      } else {
        // Retornou para 'active': cancela imediatamente qualquer timer pendente de inatividade
        if (backgroundTimer) {
          clearTimeout(backgroundTimer);
          backgroundTimer = null;
        }
      }

      if (currentState !== targetState) {
        currentState = targetState;
        sendViewerState(currentState);
      }
    };

    const onUserInteraction = () => {
      const isDocHidden = typeof document !== 'undefined' ? (document.visibilityState === 'hidden') : false;
      if (!isDocHidden && (currentState !== 'active' || backgroundTimer)) {
        evaluateAndBroadcast();
      }
    };

    const sendViewerState = (state) => {
      if (!signaling || !signaling.isConnected || !roomState.roomId) return;
      const isDocHidden = typeof document !== 'undefined' ? (document.visibilityState === 'hidden') : false;
      const isDocFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true;

      signaling.send('VIEWER_STATE', {
        state,
        isVisible: !isDocHidden,
        isFocused: isDocFocused,
        userId: roomState.myUserId,
        timestamp: Date.now()
      });
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', evaluateAndBroadcast);
      window.addEventListener('focus', evaluateAndBroadcast);
      window.addEventListener('blur', evaluateAndBroadcast);
      window.addEventListener('pointerdown', onUserInteraction, { passive: true });
      window.addEventListener('touchstart', onUserInteraction, { passive: true });
      window.addEventListener('keydown', onUserInteraction, { passive: true });
    }

    viewerActivityCleanup = () => {
      if (backgroundTimer) {
        clearTimeout(backgroundTimer);
        backgroundTimer = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', evaluateAndBroadcast);
        window.removeEventListener('focus', evaluateAndBroadcast);
        window.removeEventListener('blur', evaluateAndBroadcast);
        window.removeEventListener('pointerdown', onUserInteraction);
        window.removeEventListener('touchstart', onUserInteraction);
        window.removeEventListener('keydown', onUserInteraction);
      }
    };

    // Dispara relatório inicial
    setTimeout(evaluateAndBroadcast, 1200);
  };

  signaling.on('VIEWER_STATE', async (msg) => {
    const { from, data } = msg;
    const viewerId = from || data?.userId;
    if (viewerId && qualityController) {
      await qualityController.updateViewerState(viewerId, data);
    }
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
    if (qualityController) {
      qualityController.removePeer(userId);
    }
    clearPeerSyncTimer(userId);
    peerRetryCounts.delete(userId);
    roomState.removeParticipant(userId);
    webrtc.closePeer(userId);

    vad.stopMonitoring(userId);
    const audioEl = peerAudioElements.get(userId);
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
      peerAudioElements.delete(userId);
    }

    // Remove todos os tiles pertencentes a este usuário do grid
    removeTile(`${userId}-screen`);
    removeTile(`${userId}-camera`);
    removeTile(`${userId}-desktop`);
    remoteUserMedia.delete(userId);

    updateParticipantsUI();
    updateStreamCatalogBadge();
    renderStreamCatalogUI();
    updateGridLayout();
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
    const { type, active, mid, streamId } = msg.data || {};
    const fromUserId = msg.from || msg.data?.userId;
    console.log(`[App] Evento MEDIA_STATE de ${fromUserId}: tipo=${type}, ativo=${active}, mid=${mid}`);

    if (fromUserId) {
      let userMedia = remoteUserMedia.get(fromUserId);
      if (!userMedia) {
        userMedia = { screen: false, camera: false };
        remoteUserMedia.set(fromUserId, userMedia);
      }
      if (type) {
        userMedia[type] = Boolean(active);
      }

      webrtc.updatePeerMediaState(fromUserId, type, Boolean(active), mid, streamId);

      if (!active && type) {
        removeTile(`${fromUserId}-${type}`);
      }
      syncRemotePeerTiles(fromUserId);
    }
  });

  signaling.on('START_STREAM', (msg) => {
    const fromUserId = msg.from || msg.data?.userId;
    console.log(`[App] Evento START_STREAM de ${fromUserId}`);
    if (fromUserId) {
      let userMedia = remoteUserMedia.get(fromUserId);
      if (!userMedia) {
        userMedia = { screen: false, camera: false };
        remoteUserMedia.set(fromUserId, userMedia);
      }
      userMedia.screen = true;

      webrtc.updatePeerMediaState(fromUserId, 'screen', true, msg.data?.mid, msg.data?.streamId);
      syncRemotePeerTiles(fromUserId);
    }
  });

  signaling.on('STOP_STREAM', (msg) => {
    const fromUserId = msg.from || msg.data?.userId;
    console.log(`[App] Evento STOP_STREAM recebido de ${fromUserId}`);
    if (fromUserId) {
      let userMedia = remoteUserMedia.get(fromUserId);
      if (userMedia) userMedia.screen = false;

      webrtc.updatePeerMediaState(fromUserId, 'screen', false);
      removeTile(`${fromUserId}-screen`);
      syncRemotePeerTiles(fromUserId);
    } else {
      // Se não especificou o remetente, remove todas as telas remotas
      remoteUserMedia.forEach((um, uid) => {
        um.screen = false;
        webrtc.updatePeerMediaState(uid, 'screen', false);
        removeTile(`${uid}-screen`);
      });
      updateGridLayout();
    }
  });

  signaling.on('STREAM_LIST', (msg) => {
    const streams = msg.data?.streams || [];
    roomState.setStreams(streams);
    streams.forEach(s => {
      let um = remoteUserMedia.get(s.hostId);
      if (!um) {
        um = { screen: false, camera: false };
        remoteUserMedia.set(s.hostId, um);
      }
      if (s.sourceType === 'desktop' || s.sourceType === 'screen') {
        um.screen = true;
        webrtc.updatePeerMediaState(s.hostId, 'screen', true, null, s.streamId);
      } else if (s.sourceType === 'camera') {
        um.camera = true;
        webrtc.updatePeerMediaState(s.hostId, 'camera', true, null, s.streamId);
      }
    });
    updateStreamCatalogBadge();
    renderStreamCatalogUI();
    updateGridLayout();
  });

  signaling.on('STREAM_PUBLISHED', (msg) => {
    const streamInfo = msg.data?.stream || msg.data;
    if (!streamInfo) return;
    roomState.addStream(streamInfo);

    let um = remoteUserMedia.get(streamInfo.hostId);
    if (!um) {
      um = { screen: false, camera: false };
      remoteUserMedia.set(streamInfo.hostId, um);
    }
    if (streamInfo.sourceType === 'desktop' || streamInfo.sourceType === 'screen') {
      um.screen = true;
      webrtc.updatePeerMediaState(streamInfo.hostId, 'screen', true, null, streamInfo.streamId);
    } else if (streamInfo.sourceType === 'camera') {
      um.camera = true;
      webrtc.updatePeerMediaState(streamInfo.hostId, 'camera', true, null, streamInfo.streamId);
    }

    updateStreamCatalogBadge();
    renderStreamCatalogUI();

    if (streamInfo.hostId !== roomState.myUserId) {
      appendSystemChat(`${streamInfo.hostName} iniciou uma transmissão: "${streamInfo.title}".`);
      // Auto-subscrição por conveniência quando há apenas 2 pessoas na sala (chamada direta 1-a-1)
      if (roomState.participants.size <= 2 && roomState.subscribedStreamIds.size === 0) {
        toggleStreamSubscription(streamInfo.streamId, true);
      }
    }
    updateGridLayout();
  });

  signaling.on('STREAM_ENDED', (msg) => {
    const { streamId, hostId, sourceType } = msg.data || {};
    if (streamId) {
      roomState.removeStream(streamId);
      removeTile(streamId);
      if (sourceType) {
        removeTile(`${hostId}-${sourceType === 'desktop' ? 'screen' : sourceType}`);
      }
      updateStreamCatalogBadge();
      renderStreamCatalogUI();
      updateGridLayout();
    }
  });

  signaling.on('SUBSCRIBE_STREAM', async (msg) => {
    const subscriberId = msg.data?.subscriberId || msg.from;
    const streamId = msg.data?.streamId;
    const sourceType = msg.data?.sourceType || (streamId && streamId.includes('camera') ? 'camera' : 'screen');
    console.log(`[App] Evento SUBSCRIBE_STREAM de ${subscriberId} para ${streamId} (${sourceType})`);
    if (subscriberId && subscriberId !== roomState.myUserId) {
      try {
        roomState.addLocalSubscriber(sourceType, subscriberId);
        await webrtc.syncPeerTracks(subscriberId, media);
        await webrtc.createOfferForPeer(subscriberId);
      } catch (err) {
        console.warn('[App] Erro ao sincronizar tracks com assinante:', err);
      }
    }
  });

  signaling.on('UNSUBSCRIBE_STREAM', async (msg) => {
    const subscriberId = msg.data?.subscriberId || msg.from;
    const sourceType = msg.data?.sourceType;
    console.log(`[App] Evento UNSUBSCRIBE_STREAM de ${subscriberId} para ${sourceType || 'todos'}`);
    if (subscriberId) {
      roomState.removeLocalSubscriber(sourceType, subscriberId);
      webrtc.unsubscribePeerFromStream(subscriberId, sourceType);
    }
  });

  signaling.on('MUTE', (msg) => {
    const fromUserId = msg.from || msg.data?.userId;
    const participant = roomState.participants.get(fromUserId);
    if (participant) {
      participant.isMuted = true;
      vad.setSpeaking(fromUserId, false);
      updateGridLayout();
    }
  });

  signaling.on('UNMUTE', (msg) => {
    const fromUserId = msg.from || msg.data?.userId;
    const participant = roomState.participants.get(fromUserId);
    if (participant) {
      participant.isMuted = false;
      updateGridLayout();
    }
  });

  signaling.on('CHAT_MESSAGE', (msg) => {
    const { author, userId, text, timestamp, image } = msg.data;
    appendChatMessage(author, text, timestamp, userId === roomState.myUserId, image);
  });

  signaling.on('ERROR', (msg) => {
    isConnecting = false;
    const errorMsg = msg.data?.message || 'Erro inesperado';
    const errorCode = msg.data?.code;

    if (btnSubmitCreate) {
      btnSubmitCreate.disabled = false;
      btnSubmitCreate.textContent = 'Criar Sala e Iniciar';
    }
    if (btnSubmitJoin) {
      btnSubmitJoin.disabled = false;
      btnSubmitJoin.textContent = 'Entrar na Transmissão';
    }

    if (lobbyScreen && lobbyScreen.classList.contains('active')) {
      showLobbyAlert(errorMsg, 'error');
    } else {
      console.warn(`[Signaling Error] [${errorCode || 'UNKNOWN'}]: ${errorMsg}`);
      if (errorCode === 'RATE_LIMIT_EXCEEDED') {
        appendSystemChat('⚠️ Alto volume de mensagens de sinalização detectado. Suavizado automaticamente.');
      } else {
        appendSystemChat(`⚠️ Aviso do Servidor: ${errorMsg}`);
      }
    }
  });

  signaling.on('reconnecting', ({ attempt, maxAttempts }) => {
    showReconnectBanner(`Conexão perdida. Tentando reconectar automaticamente (${attempt} de ${maxAttempts})...`);
    updateConnectionStatus('connecting', `Reconectando (${attempt}/${maxAttempts})...`);
  });

  signaling.on('reconnect_failed', () => {
    showReconnectBanner('Falha ao reconectar ao servidor de sinalização após várias tentativas.', true);
    updateConnectionStatus('', 'Desconectado');
  });

  signaling.on('connection_change', async ({ status }) => {
    console.log(`[App] Status da conexão de sinalização: ${status}`);
    if (status === 'connected') {
      hideReconnectBanner();
      if (roomState.roomId) {
        console.log(`[App] WebSocket de sinalização reconectado. Re-ingressando na sala ${roomState.roomId}...`);
        signaling.roomId = roomState.roomId;
        signaling.send('JOIN_ROOM', {
          roomId: roomState.roomId,
          username: roomState.myUserName,
          pin: roomState.roomPin
        });

        // Aguarda 1s para renegociar túneis de mídia com os demais participantes
        setTimeout(async () => {
          try {
            const otherIds = roomState.getOtherParticipantIds();
            if (otherIds.length > 0) {
              console.log(`[App] Re-sincronizando mídias locais com ${otherIds.length} participantes após reconexão...`);
              await webrtc.syncLocalMedia(media, otherIds);
              await webrtc.renegotiateAllPeers(otherIds);
            }
          } catch (syncErr) {
            console.warn('[App] Erro na renegociação pós-reconexão WebSocket:', syncErr);
          }
        }, 1000);
      }
    }
  });
}

// ========================================================
// 7. RENDERIZAÇÃO E ATUALIZAÇÃO DE UI
// ========================================================
function updateParticipantsUI() {
  const count = roomState.getParticipantCount();
  userCountBadge.innerHTML = `${Icons.users(14)} <span id="userCountText">${count} participante${count > 1 ? 's' : ''}</span>`;
  tabUserCount.textContent = count;

  participantsList.innerHTML = '';
  for (const user of roomState.participants.values()) {
    const li = document.createElement('li');
    li.className = 'participant-item';

    const isSelf = user.id === roomState.myUserId;
    const userColor = getParticipantColor(user);

    li.innerHTML = `
      <div class="participant-info">
        <span class="user-avatar-dot" style="background-color: ${userColor}; box-shadow: 0 0 8px ${userColor}60;"></span>
        <span class="participant-name">${escapeHtml(user.name)}${isSelf ? ' <em>(Você)</em>' : ''}</span>
      </div>
      <div>
        ${user.isHost ? '<span class="host-tag">HOST</span>' : ''}
      </div>
    `;
    participantsList.appendChild(li);
  }

  updateGridLayout();
}

function updateStreamCatalogBadge() {
  if (tabStreamCount) {
    tabStreamCount.textContent = roomState.availableStreams.size;
  }
}

function toggleStreamSubscription(streamId, forceSubscribe = null) {
  if (!streamId) return;
  const currentSubscribed = roomState.isSubscribed(streamId);
  const shouldSubscribe = (forceSubscribe !== null) ? forceSubscribe : !currentSubscribed;
  const streamInfo = roomState.getStream(streamId);

  if (shouldSubscribe) {
    roomState.subscribe(streamId);
    signaling.send('SUBSCRIBE_STREAM', { streamId });
    if (streamInfo && streamInfo.hostId) {
      let um = remoteUserMedia.get(streamInfo.hostId);
      if (!um) {
        um = { screen: false, camera: false };
        remoteUserMedia.set(streamInfo.hostId, um);
      }
      if (streamInfo.sourceType === 'desktop' || streamInfo.sourceType === 'screen') {
        um.screen = true;
      } else if (streamInfo.sourceType === 'camera') {
        um.camera = true;
      }
      syncRemotePeerTiles(streamInfo.hostId);
    }
  } else {
    roomState.unsubscribe(streamId);
    signaling.send('UNSUBSCRIBE_STREAM', { streamId });
    removeTile(streamId);
    if (streamId.endsWith('-screen')) removeTile(streamId.replace(/-screen$/, '-desktop'));
    if (streamId.endsWith('-desktop')) removeTile(streamId.replace(/-desktop$/, '-screen'));
  }

  updateGridLayout();
}

function renderStreamCatalogUI() {
  updateStreamCatalogBadge();
  updateGridLayout();
}

function appendSystemChat(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.innerHTML = `<span>${text}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ========================================================
// 7. ENVIO DE IMAGENS EFÊMERAS NO CHAT & LIGHTBOX
// ========================================================
// 7. ENVIO DE IMAGENS EFÊMERAS NO CHAT & LIGHTBOX
// ========================================================
let pendingChatImage = null; // { dataUrl, filename }
let isProcessingChatImage = false;

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name || '');
}

function extractImageFileFromClipboard(e) {
  const cd = e.clipboardData || window.clipboardData;
  if (!cd) return null;

  // 1. Arquivos na área de transferência (ex: Ctrl+C em arquivo no Windows Explorer)
  if (cd.files && cd.files.length > 0) {
    for (let i = 0; i < cd.files.length; i++) {
      const file = cd.files[i];
      if (isImageFile(file)) return file;
    }
  }

  // 2. Itens na área de transferência (ex: PrintScreen, Win+Shift+S, Copiar Imagem do navegador)
  if (cd.items && cd.items.length > 0) {
    for (let i = 0; i < cd.items.length; i++) {
      const item = cd.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && isImageFile(file)) return file;
      }
    }
  }

  return null;
}

function clearPendingChatImage() {
  pendingChatImage = null;
  isProcessingChatImage = false;
  if (chatImagePreview) chatImagePreview.classList.add('hidden');
  if (chatPreviewThumb) chatPreviewThumb.src = '';
  if (chatImageInput) chatImageInput.value = '';
}

function compressImage(dataUrl, maxDimension, quality, callback) {
  const img = new Image();
  img.onload = () => {
    let width = img.width;
    let height = img.height;

    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Tenta exportar para WebP mantendo canal alfa/transparência limpa
    try {
      ctx.drawImage(img, 0, 0, width, height);
      const webpData = canvas.toDataURL('image/webp', quality);
      if (webpData && webpData.startsWith('data:image/webp')) {
        return callback(webpData);
      }
    } catch (_) {}

    // Fallback: se JPEG for utilizado, preenche fundo branco para não escurecer transparência
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = width;
    fallbackCanvas.height = height;
    const fbCtx = fallbackCanvas.getContext('2d');
    fbCtx.fillStyle = '#ffffff';
    fbCtx.fillRect(0, 0, width, height);
    fbCtx.drawImage(img, 0, 0, width, height);
    const jpegData = fallbackCanvas.toDataURL('image/jpeg', quality);
    callback(jpegData);
  };
  img.onerror = () => callback(dataUrl);
  img.src = dataUrl;
}

function handleChatImageFile(file) {
  if (!isImageFile(file)) return;

  const fileName = file.name || `imagem_${Date.now()}.png`;
  isProcessingChatImage = true;

  if (chatImagePreview) {
    chatImagePreview.classList.remove('hidden');
    if (chatPreviewName) chatPreviewName.textContent = `Carregando ${fileName}...`;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const rawDataUrl = e.target.result;
    compressImage(rawDataUrl, 1280, 0.82, (optimizedDataUrl) => {
      pendingChatImage = {
        dataUrl: optimizedDataUrl,
        filename: fileName
      };
      isProcessingChatImage = false;
      if (chatPreviewThumb) chatPreviewThumb.src = optimizedDataUrl;
      if (chatPreviewName) chatPreviewName.textContent = fileName;
      if (chatImagePreview) chatImagePreview.classList.remove('hidden');
      if (chatInput) chatInput.focus();
    });
  };
  reader.onerror = () => {
    isProcessingChatImage = false;
    clearPendingChatImage();
  };
  reader.readAsDataURL(file);
}

function openImageLightbox(src, author) {
  if (!imageLightboxModal || !lightboxImg) return;
  lightboxImg.src = src;
  if (lightboxAuthor) lightboxAuthor.textContent = author || 'Imagem';
  imageLightboxModal.classList.remove('hidden');
  imageLightboxModal.setAttribute('aria-hidden', 'false');
}

function closeImageLightbox() {
  if (!imageLightboxModal) return;
  imageLightboxModal.classList.add('hidden');
  imageLightboxModal.setAttribute('aria-hidden', 'true');
  if (lightboxImg) lightboxImg.src = '';
}

function appendChatMessage(author, text, timestamp, isSelf, image = null) {
  const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'chat-message-item';

  let bodyHtml = '';
  if (text) {
    bodyHtml += `<div class="chat-msg-body">${escapeHtml(text)}</div>`;
  }
  if (image) {
    bodyHtml += `
      <div class="chat-msg-image-wrap">
        <img src="${image}" class="chat-msg-image" alt="Imagem efêmera enviada por ${escapeHtml(author)}" title="Clique para ampliar">
      </div>
    `;
  }

  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-author ${isSelf ? 'is-self' : ''}">${escapeHtml(author)}</span>
      <span class="chat-msg-time">${timeStr}</span>
    </div>
    ${bodyHtml}
  `;

  const imgEl = div.querySelector('.chat-msg-image');
  if (imgEl && image) {
    imgEl.addEventListener('click', () => {
      openImageLightbox(image, author);
    });
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function leaveCurrentRoom() {
  console.log('[App] Executando saída da sala...');
  try {
    currentAttemptedPin = null;
    hideLobbyAlert();
    try { qualityController.stop(); } catch (e) { console.warn('[App] Erro qualityController.stop:', e); }
    try { media.stopCamera(); } catch (e) { console.warn('[App] Erro media.stopCamera:', e); }
    try { media.stopScreenCapture(); } catch (e) { console.warn('[App] Erro media.stopScreenCapture:', e); }
    try { media.stopMicrophone(); } catch (e) { console.warn('[App] Erro media.stopMicrophone:', e); }
    try { webrtc.closeAllPeers(); } catch (e) { console.warn('[App] Erro webrtc.closeAllPeers:', e); }

    try { signaling.send('LEAVE_ROOM', {}); } catch (e) {}
    try { signaling.disconnect(); } catch (e) {}

    peerSyncTimers.forEach(t => clearTimeout(t));
    peerSyncTimers.clear();
    peerRetryCounts.clear();

    try { removeLocalPreview('screen'); } catch (e) {}
    try { removeLocalPreview('camera'); } catch (e) {}
    localPreviews.clear();
    remoteUserMedia.clear();
    try { updateLocalDockVisibility(); } catch (e) {}

    activeTiles.forEach(({ videoEl }) => {
      if (videoEl) {
        try {
          videoEl.pause();
          videoEl.srcObject = null;
          videoEl.load();
        } catch (_) {}
      }
    });
    activeTiles.clear();
    if (videoGrid) {
      videoGrid.innerHTML = '';
      videoGrid.classList.remove('spotlight-active');
    }
    currentSpotlightId = null;

    if (unmuteBanner) unmuteBanner.classList.add('hidden');
    try { clearPendingChatImage(); } catch (_) {}
    try { closeImageLightbox(); } catch (_) {}
    if (chatMessages) {
      chatMessages.innerHTML = `
        <div class="system-message">
          <span>Bem-vindo à sala! O tráfego de mídia é transmitido via P2P direto.</span>
        </div>
      `;
    }
    try {
      roomState.reset();
      updateStreamCatalogBadge();
      renderStreamCatalogUI();
    } catch (e) { console.warn('[App] Erro roomState.reset:', e); }

    // Redefinir botões e ícones da toolbar
    if (btnShareScreen) {
      btnShareScreen.classList.remove('active');
      const lbl = btnShareScreen.querySelector('.label');
      if (lbl) lbl.textContent = 'Compartilhar Tela';
    }
    if (btnToggleCamera) {
      btnToggleCamera.classList.remove('active');
      if (cameraIcon) cameraIcon.innerHTML = Icons.videoOff(18);
      if (cameraLabel) cameraLabel.textContent = 'Câmera';
    }
    if (btnToggleAudio) {
      btnToggleAudio.classList.remove('active');
      if (micIcon) micIcon.innerHTML = Icons.mic(18);
      if (micLabel) micLabel.textContent = 'Microfone';
    }
    if (document.fullscreenElement) {
      try { document.exitFullscreen().catch(() => {}); } catch (_) {}
    }

    // Limpar parâmetros da URL (remover ?room= e ?pin= do navegador)
    try {
      if (window.location.search) {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (_) {}

  } catch (err) {
    console.error('[App] Erro durante saída da sala:', err);
  } finally {
    hideReconnectBanner();
    closeDiagnosticsModal();
    updateLastRoomCardUI();
    const last = RoomState.getLastRoom();
    if (last && last.roomId && joinRoomIdInput && !joinRoomIdInput.value) {
      joinRoomIdInput.value = last.roomId.toLowerCase();
    }
    if (last && last.roomPin && joinPasswordInput && !joinPasswordInput.value) {
      joinPasswordInput.value = last.roomPin;
    }
    // Garante sem exceção a transição visual para o Lobby
    if (roomScreen) roomScreen.classList.remove('active');
    if (lobbyScreen) lobbyScreen.classList.add('active');
  }
}

// ========================================================
// 8. CONFIGURAÇÕES DA TRANSMISSÃO E ATUALIZADOR IN-APP
// ========================================================
let vuMeterAnimFrame = null;
let latestUpdateInfo = null;

function setupSettingsModal() {
  const btnOpenSettings = document.getElementById('btnOpenSettings');
  const btnOpenSettingsLobby = document.getElementById('btnOpenSettingsLobby');
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal');
  const btnSaveCloseSettings = document.getElementById('btnSaveCloseSettings');

  if (!settingsModal) return;

  // Abas de Configurações
  const settingsTabBtns = settingsModal.querySelectorAll('.settings-tab-btn');
  const settingsPanes = {
    video: document.getElementById('settingsTabVideo'),
    codecs: document.getElementById('settingsTabCodecs'),
    audio: document.getElementById('settingsTabAudio'),
    updates: document.getElementById('settingsTabUpdates')
  };

  function switchSettingsTab(tabKey) {
    settingsTabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabKey);
    });
    Object.entries(settingsPanes).forEach(([k, pane]) => {
      if (pane) pane.classList.toggle('active', k === tabKey);
    });
    if (tabKey === 'audio') {
      refreshMicrophoneList();
      loadAudioAppsInSettings();
      const settingEnableMic = document.getElementById('settingEnableMic');
      const settingMicDeviceSelect = document.getElementById('settingMicDeviceSelect');
      if (settingEnableMic && settingEnableMic.checked) {
        media.startMicrophonePreview(settingMicDeviceSelect?.value || null).catch(() => {});
      }
    }
  }

  settingsTabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });

  // Loop de Medição de Nível de Áudio (VU Meter)
  function startVuMeterLoop() {
    stopVuMeterLoop();
    const vuMeterSystem = document.getElementById('vuMeterSystem');
    const vuMeterMic = document.getElementById('vuMeterMic');

    function updateMeters() {
      if (settingsModal.classList.contains('hidden')) {
        return;
      }
      const { systemLevel, micLevel } = media.getAudioMeterLevels();
      if (vuMeterSystem) {
        vuMeterSystem.style.width = `${systemLevel}%`;
      }
      if (vuMeterMic) {
        vuMeterMic.style.width = `${micLevel}%`;
      }
      vuMeterAnimFrame = requestAnimationFrame(updateMeters);
    }
    vuMeterAnimFrame = requestAnimationFrame(updateMeters);
  }

  function stopVuMeterLoop() {
    if (vuMeterAnimFrame) {
      cancelAnimationFrame(vuMeterAnimFrame);
      vuMeterAnimFrame = null;
    }
    const vuMeterSystem = document.getElementById('vuMeterSystem');
    const vuMeterMic = document.getElementById('vuMeterMic');
    if (vuMeterSystem) vuMeterSystem.style.width = '0%';
    if (vuMeterMic) vuMeterMic.style.width = '0%';
  }

  // Lista de Dispositivos de Microfone
  async function refreshMicrophoneList() {
    const select = document.getElementById('settingMicDeviceSelect');
    if (!select) return;
    try {
      const mics = await media.enumerateMicrophones();
      const currentVal = select.value;
      select.innerHTML = '<option value="">Padrão do Sistema</option>';
      mics.forEach(mic => {
        const opt = document.createElement('option');
        opt.value = mic.deviceId;
        opt.textContent = mic.label || `Microfone (${mic.deviceId.substring(0, 6)}...)`;
        if (mic.deviceId === currentVal || mic.deviceId === media.selectedMicDeviceId) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    } catch (err) {
      console.warn('[Settings] Erro ao listar microfones:', err);
    }
  }

  // --- MIXER DE APLICATIVOS E JANELAS DETECTADOS NO PC ---
  const settingsAudioAppsList = document.getElementById('settingsAudioAppsList');
  const btnRefreshAudioApps = document.getElementById('btnRefreshAudioApps');
  const audioModeAllApps = document.getElementById('audioModeAllApps');
  const audioModeSelectiveApps = document.getElementById('audioModeSelectiveApps');

  let disabledAudioAppIds = new Set();
  let disabledAudioAppsMap = new Map(); // id -> { id, name, pid, processName }
  let audioAppsFilterMode = 'all'; // 'all' ou 'selective'

  function loadSavedAudioAppsState() {
    try {
      const raw = localStorage.getItem('hyperstream_audio_apps_config') || localStorage.getItem('hyperstream_audio_apps_filter');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode) audioAppsFilterMode = parsed.mode;
        if (Array.isArray(parsed.disabledIds)) {
          disabledAudioAppIds = new Set(parsed.disabledIds);
        }
        if (Array.isArray(parsed.disabledApps)) {
          disabledAudioAppsMap = new Map(parsed.disabledApps.map(a => [a.id, a]));
        }
      }
    } catch (_) {}
  }

  let cachedAudioApps = null;

  function renderAudioAppsList(apps) {
    if (!settingsAudioAppsList) return;

    const list = Array.isArray(apps) ? [...apps] : [];

    // Mantém aplicativos desativados pelo usuário visíveis na lista mesmo se pausarem o som momentaneamente
    const displayedAppIds = new Set(list.map(a => a.id));
    disabledAudioAppsMap.forEach((disabledApp, appId) => {
      if (!displayedAppIds.has(appId)) {
        list.push({
          id: appId,
          name: disabledApp.name || appId,
          processName: disabledApp.processName || appId,
          pid: disabledApp.pid || 0,
          rootPid: disabledApp.rootPid || disabledApp.pid || 0,
          windowTitle: '',
          state: 0,
          peak: 0,
          hasAudio: true,
          isActiveAudio: false,
          isSilentOrPaused: true,
          appIcon: null
        });
      }
    });

    if (list.length === 0) {
      settingsAudioAppsList.innerHTML = `
        <div class="audio-app-item" style="color: #94a3b8; font-size: 0.82rem; justify-content: center;">
          <span>Nenhum aplicativo com sessão de áudio detectado no momento. Abra seu jogo, música ou Discord e clique em Recarregar.</span>
        </div>
      `;
      return;
    }

    settingsAudioAppsList.innerHTML = '';
    list.forEach(app => {
      const item = document.createElement('div');
      item.className = 'audio-app-item';

      const isEnabled = !disabledAudioAppIds.has(app.id);

      const iconHtml = app.appIcon
        ? `<img src="${app.appIcon}" class="audio-app-icon" alt="" />`
        : `<svg class="icon-svg audio-app-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

      let statusBadge = '';
      if (!isEnabled) {
        statusBadge = `<span class="audio-app-pill" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);" title="Captura de áudio desativada para este aplicativo">🔇 Desmarcado</span>`;
      } else if (app.isActiveAudio) {
        statusBadge = `<span class="audio-app-pill active" title="Emitindo som ativo no Windows neste momento">🔊 Som Ativo</span>`;
      } else {
        statusBadge = `<span class="audio-app-pill idle" title="Sessão aberta no mixer de áudio">Mixer</span>`;
      }

      const pillText = app.processName ? app.processName.replace(/\.exe$/i, '') : 'App';
      const hasSubTitle = Boolean(app.windowTitle && app.windowTitle.trim() !== '' && app.windowTitle !== app.name);

      item.innerHTML = `
        <div class="audio-app-info">
          ${iconHtml}
          <div class="audio-app-text-group">
            <span class="audio-app-title" title="${escapeHtml(app.name)}">${escapeHtml(app.name)}</span>
            ${hasSubTitle ? `<span class="audio-app-subtitle" title="${escapeHtml(app.windowTitle)}">${escapeHtml(app.windowTitle)}</span>` : ''}
          </div>
          ${statusBadge}
          <span class="audio-app-pill" style="opacity: 0.85; font-size: 0.7rem;" title="${escapeHtml(pillText)}">${escapeHtml(pillText)}</span>
        </div>
        <label class="toggle-switch" title="Capturar áudio deste aplicativo">
          <input type="checkbox" class="app-audio-toggle"
            data-app-id="${escapeHtml(app.id)}"
            data-app-name="${escapeHtml(app.name)}"
            data-process-name="${escapeHtml(app.processName || '')}"
            data-pid="${app.pid || ''}"
            data-root-pid="${app.rootPid || app.pid || ''}"
            ${isEnabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      `;

      const toggleInput = item.querySelector('.app-audio-toggle');
      if (toggleInput) {
        toggleInput.addEventListener('change', () => {
          if (toggleInput.checked) {
            disabledAudioAppIds.delete(app.id);
            disabledAudioAppsMap.delete(app.id);
          } else {
            disabledAudioAppIds.add(app.id);
            disabledAudioAppsMap.set(app.id, {
              id: app.id,
              name: app.name,
              processName: app.processName,
              pid: app.pid,
              rootPid: app.rootPid || app.pid
            });
            audioAppsFilterMode = 'selective';
            if (audioModeSelectiveApps) audioModeSelectiveApps.checked = true;
            if (audioModeAllApps) audioModeAllApps.checked = false;
          }
          saveAudioAppsState();
        });
      }

      settingsAudioAppsList.appendChild(item);
    });
  }

  function saveAudioAppsState() {
    try {
      const disabledApps = Array.from(disabledAudioAppsMap.values());
      const disabledIds = Array.from(disabledAudioAppIds);
      const enabledApps = (cachedAudioApps || []).filter(a => !disabledAudioAppIds.has(a.id));

      if (disabledApps.length > 0) {
        audioAppsFilterMode = 'selective';
        if (audioModeSelectiveApps) audioModeSelectiveApps.checked = true;
        if (audioModeAllApps) audioModeAllApps.checked = false;
      } else {
        audioAppsFilterMode = 'all';
        if (audioModeAllApps) audioModeAllApps.checked = true;
        if (audioModeSelectiveApps) audioModeSelectiveApps.checked = false;
      }

      const stateObj = {
        mode: audioAppsFilterMode,
        disabledIds,
        disabledApps,
        enabledApps
      };

      localStorage.setItem('hyperstream_audio_apps_config', JSON.stringify(stateObj));
      localStorage.setItem('hyperstream_audio_apps_filter', JSON.stringify(stateObj));

      // Notifica imediatamente o MediaManager com os apps e PIDs excluídos
      if (media && typeof media.updateAudioAppFilter === 'function') {
        media.updateAudioAppFilter({
          mode: audioAppsFilterMode,
          disabledIds,
          disabledApps,
          enabledApps
        }).then(() => {
          // Atualiza em tempo real as conexões WebRTC ativas com a nova faixa filtrada
          if (webrtc && typeof webrtc.syncLocalMedia === 'function' && roomState) {
            const otherIds = typeof roomState.getOtherParticipantIds === 'function'
              ? roomState.getOtherParticipantIds()
              : [];
            webrtc.syncLocalMedia(media, otherIds);
          }
        });
      }
    } catch (_) {}
  }

  async function loadAudioAppsInSettings() {
    if (!settingsAudioAppsList) return;

    loadSavedAudioAppsState();
    if (audioModeAllApps && audioModeSelectiveApps) {
      audioModeAllApps.checked = (audioAppsFilterMode === 'all');
      audioModeSelectiveApps.checked = (audioAppsFilterMode === 'selective');
    }

    if (!window.desktopAPI || !window.desktopAPI.getAudioApplications) {
      settingsAudioAppsList.innerHTML = `
        <div class="audio-app-item" style="color: #94a3b8; font-size: 0.82rem; padding: 12px 14px;">
          <span>No app Desktop do Hyperstream, os aplicativos com áudio no mixer do Windows aparecem aqui com chaves seletivas. Na versão web, o áudio é transmitido pelo compartilhamento de tela.</span>
        </div>
      `;
      return;
    }

    // Se já temos cache recente em memória, renderiza instantaneamente
    if (Array.isArray(cachedAudioApps) && cachedAudioApps.length > 0) {
      renderAudioAppsList(cachedAudioApps);
    } else {
      settingsAudioAppsList.innerHTML = `
        <div class="audio-app-item" style="color: #94a3b8; font-size: 0.82rem; justify-content: center;">
          <span>Detectando aplicativos com som no Windows...</span>
        </div>
      `;
    }

    try {
      // Retorna em 0ms a partir do cache do processo principal
      const apps = await window.desktopAPI.getAudioApplications();
      cachedAudioApps = apps || [];
      renderAudioAppsList(cachedAudioApps);
    } catch (err) {
      console.warn('[Settings] Erro ao carregar aplicativos de áudio:', err);
      if (!cachedAudioApps) {
        settingsAudioAppsList.innerHTML = `
          <div class="audio-app-item" style="color: #ef4444; font-size: 0.82rem; justify-content: center;">
            <span>Falha ao consultar mixer: ${escapeHtml(err.message)}</span>
          </div>
        `;
      }
    }
  }

  // Ouvinte de atualizações automáticas em segundo plano vindas do Electron Main
  if (window.desktopAPI && typeof window.desktopAPI.onAudioAppsUpdated === 'function') {
    window.desktopAPI.onAudioAppsUpdated((apps) => {
      cachedAudioApps = apps || [];
      if (settingsModal && !settingsModal.classList.contains('hidden')) {
        const activeTabBtn = settingsModal.querySelector('.settings-tab-btn.active');
        if (activeTabBtn && activeTabBtn.dataset.tab === 'audio') {
          renderAudioAppsList(cachedAudioApps);
        }
      }
    });
  }

  if (btnRefreshAudioApps) {
    btnRefreshAudioApps.addEventListener('click', () => {
      loadAudioAppsInSettings();
    });
  }

  function updateAudioAppsMode(mode) {
    audioAppsFilterMode = mode;
    if (mode === 'all') {
      disabledAudioAppIds.clear();
      disabledAudioAppsMap.clear();
    }
    const toggles = settingsAudioAppsList?.querySelectorAll('.app-audio-toggle') || [];
    toggles.forEach(toggle => {
      if (mode === 'all') {
        toggle.checked = true;
      } else {
        const id = toggle.dataset.appId;
        toggle.checked = !disabledAudioAppIds.has(id);
      }
    });
    saveAudioAppsState();
  }

  if (audioModeAllApps) {
    audioModeAllApps.addEventListener('change', () => updateAudioAppsMode('all'));
  }
  if (audioModeSelectiveApps) {
    audioModeSelectiveApps.addEventListener('change', () => updateAudioAppsMode('selective'));
  }

  // Verificação e Diagnóstico de Aceleração por Hardware GPU dos Codecs
  async function refreshCodecsList() {
    try {
      const probe = webrtc.hardwareProbe || await webrtc.probeHardware();
      
      const badgeH264 = document.getElementById('badgeH264Status');
      const descH264 = document.getElementById('descH264Status');
      if (badgeH264 && probe) {
        if (probe.hasHardwareH264) {
          badgeH264.textContent = 'GPU Hardware ⚡';
          badgeH264.className = 'badge badge-success';
          if (descH264) {
            const bestFmtp = probe.bestH264Codec?.sdpFmtpLine || '42e01f';
            descH264.textContent = `Aceleração nativa por GPU confirmada no Chromium (powerEfficient: true). Perfil: ${bestFmtp}. Latência ultrabaixa para jogos a 60 FPS.`;
          }
        } else {
          badgeH264.textContent = 'Software CPU ⚠️';
          badgeH264.className = 'badge badge-secondary';
          if (descH264) {
            descH264.textContent = 'Codificação H.264 por software (OpenH264 / powerEfficient: false). Custo moderado de CPU.';
          }
        }
      }

      const badgeAv1 = document.getElementById('badgeAv1Status');
      const descAv1 = document.getElementById('descAv1Status');
      if (badgeAv1 && probe) {
        if (probe.hasHardwareAV1) {
          badgeAv1.textContent = 'GPU Hardware ⚡';
          badgeAv1.className = 'badge badge-success';
          if (descAv1) {
            descAv1.textContent = 'Aceleração nativa AV1 por hardware ativa na GPU (powerEfficient: true).';
          }
        } else {
          badgeAv1.textContent = 'Software CPU ⚠️';
          badgeAv1.className = 'badge badge-secondary';
          if (descAv1) {
            descAv1.textContent = 'No WebRTC do Chromium atual, AV1 opera via software (libaom CPU - powerEfficient: false).';
          }
        }
      }

      const badgeVp9 = document.getElementById('badgeVp9Status');
      if (badgeVp9 && probe) {
        if (probe.hasHardwareVP9) {
          badgeVp9.textContent = 'GPU Hardware ⚡';
          badgeVp9.className = 'badge badge-success';
        } else {
          badgeVp9.textContent = 'Software CPU ⚠️';
          badgeVp9.className = 'badge badge-secondary';
        }
      }

      const badgeVp8 = document.getElementById('badgeVp8Status');
      if (badgeVp8) {
        badgeVp8.textContent = 'Software ⚠️';
        badgeVp8.className = 'badge badge-secondary';
      }
    } catch (err) {
      console.warn('[Settings] Erro ao verificar aceleração de hardware dos codecs:', err);
    }
  }

  // Versão Instalada e Matriz de Compatibilidade em Tempo Real
  async function checkAppVersion() {
    const versionDisplay = document.getElementById('currentAppVersionDisplay');
    const matrixDesktopVal = document.getElementById('matrixDesktopVal');
    const matrixDesktopCommit = document.getElementById('matrixDesktopCommit');
    const matrixFrontendVal = document.getElementById('matrixFrontendVal');
    const matrixFrontendSub = document.getElementById('matrixFrontendSub');
    const matrixBackendVal = document.getElementById('matrixBackendVal');
    const matrixBackendSub = document.getElementById('matrixBackendSub');
    const matrixCompatVal = document.getElementById('matrixCompatVal');
    const matrixCompatSub = document.getElementById('matrixCompatSub');
    const matrixCompatCard = document.getElementById('matrixCompatCard');

    let clientVer = '1.4.0';
    let clientCommit = 'release';
    let clientProto = 2;

    // 1. Identificação do Desktop
    if (window.desktopAPI) {
      if (typeof window.desktopAPI.getVersionInfo === 'function') {
        try {
          const info = await window.desktopAPI.getVersionInfo();
          if (info) {
            clientVer = info.version || clientVer;
            clientCommit = info.gitCommit || clientCommit;
            clientProto = info.protocolVersion || clientProto;
            if (matrixDesktopVal) matrixDesktopVal.textContent = `v${clientVer}`;
            if (matrixDesktopCommit) matrixDesktopCommit.textContent = `Commit: ${clientCommit.slice(0, 7)}`;
          }
        } catch (_) {}
      } else if (typeof window.desktopAPI.getVersion === 'function') {
        try {
          const v = await window.desktopAPI.getVersion();
          if (v) {
            clientVer = v;
            if (matrixDesktopVal) matrixDesktopVal.textContent = `v${v}`;
          }
        } catch (_) {}
      }
    } else {
      if (matrixDesktopVal) matrixDesktopVal.textContent = 'Navegador Web';
      if (matrixDesktopCommit) matrixDesktopCommit.textContent = 'Modo Remoto';
    }

    if (versionDisplay) {
      versionDisplay.textContent = window.desktopAPI ? `v${clientVer}` : 'Versão Web (Navegador)';
    }

    // 2. Identificação do Frontend Embutido
    if (matrixFrontendVal) matrixFrontendVal.textContent = `v${clientVer}`;
    if (matrixFrontendSub) matrixFrontendSub.textContent = `Protocolo v${clientProto}`;

    // 3. Consulta ao Backend (Render ou Localhost) para verificar versão e compatibilidade
    let serverBaseUrl = '';
    if (window.desktopAPI && typeof window.desktopAPI.getServerUrl === 'function') {
      try { serverBaseUrl = await window.desktopAPI.getServerUrl(); } catch (_) {}
    }
    if (!serverBaseUrl || serverBaseUrl.startsWith('data:')) {
      serverBaseUrl = window.location.origin;
    }

    try {
      const resp = await fetch(`${serverBaseUrl.replace(/\/$/, '')}/api/version`, { cache: 'no-store' });
      if (resp.ok) {
        const serverMeta = await resp.json();
        const sVer = serverMeta.version || '1.4.0';
        const sCommit = serverMeta.gitCommit || 'online';
        const sProto = serverMeta.protocolVersion || 2;
        const minClientProto = serverMeta.minClientProtocolVersion || 1;

        if (matrixBackendVal) matrixBackendVal.textContent = `v${sVer}`;
        if (matrixBackendSub) matrixBackendSub.textContent = `Commit: ${sCommit.slice(0, 7)} | Proto v${sProto}`;

        // Política de Compatibilidade
        if (clientProto < minClientProto) {
          if (matrixCompatVal) matrixCompatVal.textContent = 'Incompatível';
          if (matrixCompatSub) matrixCompatSub.textContent = `Exige protocolo v${minClientProto}`;
          if (matrixCompatCard) {
            matrixCompatCard.className = 'version-matrix-card compat-danger';
          }
        } else if (isNewerVersion(clientVer, sVer)) {
          if (matrixCompatVal) matrixCompatVal.textContent = 'Atualização Disp.';
          if (matrixCompatSub) matrixCompatSub.textContent = `Servidor na v${sVer}`;
          if (matrixCompatCard) {
            matrixCompatCard.className = 'version-matrix-card compat-warning';
          }
        } else {
          if (matrixCompatVal) matrixCompatVal.textContent = '100% Compatível';
          if (matrixCompatSub) matrixCompatSub.textContent = `Protocolo v${clientProto} Sincronizado`;
          if (matrixCompatCard) {
            matrixCompatCard.className = 'version-matrix-card compat-ok';
          }
        }
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (e) {
      if (matrixBackendVal) matrixBackendVal.textContent = 'Offline';
      if (matrixBackendSub) matrixBackendSub.textContent = 'Servidor Inacessível';
      if (matrixCompatVal) matrixCompatVal.textContent = 'Indisponível';
      if (matrixCompatSub) matrixCompatSub.textContent = 'Não foi possível contatar';
      if (matrixCompatCard) {
        matrixCompatCard.className = 'version-matrix-card compat-warning';
      }
    }
  }

  function openSettings(initialTab = 'video') {
    switchSettingsTab(initialTab);
    settingsModal.classList.remove('hidden');
    refreshCodecsList();
    checkAppVersion();
    startVuMeterLoop();
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
    stopVuMeterLoop();
  }

  if (btnOpenSettings) btnOpenSettings.addEventListener('click', () => openSettings('video'));
  if (btnOpenSettingsLobby) btnOpenSettingsLobby.addEventListener('click', () => openSettings('video'));
  if (btnCloseSettingsModal) btnCloseSettingsModal.addEventListener('click', closeSettings);
  if (btnSaveCloseSettings) btnSaveCloseSettings.addEventListener('click', closeSettings);

  // Fecha clicando no backdrop
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettings();
    }
  });

  // --- CONTROLES DE VÍDEO & QUALIDADE ---
  const presetCards = settingsModal.querySelectorAll('.preset-card');
  const settingFpsSelect = document.getElementById('settingFpsSelect');
  const settingResSelect = document.getElementById('settingResSelect');
  const settingContentHint = document.getElementById('settingContentHint');
  const settingMaxBitrate = document.getElementById('settingMaxBitrate');
  const settingMinBitrate = document.getElementById('settingMinBitrate');
  const maxBitrateValueBadge = document.getElementById('maxBitrateValueBadge');
  const minBitrateValueBadge = document.getElementById('minBitrateValueBadge');

  function updateBitrateBadges() {
    if (settingMaxBitrate && maxBitrateValueBadge) {
      const mbps = (settingMaxBitrate.value / 1000000).toFixed(1);
      maxBitrateValueBadge.textContent = `${mbps} Mbps`;
    }
    if (settingMinBitrate && minBitrateValueBadge) {
      const mbps = (settingMinBitrate.value / 1000000).toFixed(1);
      minBitrateValueBadge.textContent = `${mbps} Mbps`;
    }
  }

  presetCards.forEach(card => {
    card.addEventListener('click', () => {
      const profile = card.dataset.profile;
      presetCards.forEach(c => c.classList.toggle('active', c === card));

      if (profile === 'ultra') {
        settingMaxBitrate.value = 8000000;
        settingMinBitrate.value = 4000000;
        settingFpsSelect.value = '60';
        media.setFpsPreference(60);
        qualityController.setProfile('ultra');
      } else if (profile === 'balanced') {
        settingMaxBitrate.value = 3500000;
        settingMinBitrate.value = 1500000;
        settingFpsSelect.value = '60';
        media.setFpsPreference(60);
        qualityController.setProfile('balanced');
      } else if (profile === 'eco') {
        settingMaxBitrate.value = 1800000;
        settingMinBitrate.value = 800000;
        settingFpsSelect.value = '30';
        media.setFpsPreference(30);
        qualityController.setProfile('eco');
      }
      updateBitrateBadges();
      saveSettingsState();
    });
  });

  if (settingFpsSelect) {
    settingFpsSelect.addEventListener('change', () => {
      const fps = parseInt(settingFpsSelect.value, 10);
      media.setFpsPreference(fps);
      saveSettingsState();
    });
  }

  if (settingResSelect) {
    settingResSelect.addEventListener('change', () => {
      const resVal = settingResSelect.value;
      media.setResolutionPreference(resVal);
      const encPref = document.getElementById('settingEncoderPreference')?.value || 'auto';
      if ((resVal === '4k' || resVal === '1440p') && encPref === 'cpu') {
        appendSystemChat(`Aviso: A resolução ${resVal.toUpperCase()} no modo CPU consome alto processamento. Recomenda-se modo GPU.`);
      }
      saveSettingsState();
    });
  }

  if (settingContentHint) {
    settingContentHint.addEventListener('change', () => {
      media.setContentHint(settingContentHint.value);
      saveSettingsState();
    });
  }

  if (settingMaxBitrate) {
    settingMaxBitrate.addEventListener('input', () => {
      updateBitrateBadges();
      presetCards.forEach(c => c.classList.toggle('active', c.dataset.profile === 'custom'));
      qualityController.setCustomQuality({
        maxBitrate: Number(settingMaxBitrate.value),
        minBitrate: Number(settingMinBitrate.value),
        maxFps: Number(settingFpsSelect.value)
      });
      saveSettingsState();
    });
  }

  if (settingMinBitrate) {
    settingMinBitrate.addEventListener('input', () => {
      updateBitrateBadges();
      presetCards.forEach(c => c.classList.toggle('active', c.dataset.profile === 'custom'));
      qualityController.setCustomQuality({
        maxBitrate: Number(settingMaxBitrate.value),
        minBitrate: Number(settingMinBitrate.value),
        maxFps: Number(settingFpsSelect.value)
      });
      saveSettingsState();
    });
  }

  // --- CONTROLES DE ACELERAÇÃO (GPU / CPU) E CODECS ---
  const settingEncoderPreference = document.getElementById('settingEncoderPreference');
  if (settingEncoderPreference) {
    settingEncoderPreference.addEventListener('change', async () => {
      const pref = settingEncoderPreference.value;
      console.log(`[Settings] Modo de codificador (CPU/GPU) selecionado: ${pref}`);
      await webrtc.setEncoderPreference(pref);
      saveSettingsState();
      const label = pref === 'gpu'
        ? 'GPU (Aceleração por Hardware ⚡)'
        : (pref === 'cpu' ? 'CPU (Modo Software ⚠️)' : 'Automático (Equilíbrio Inteligente)');
      appendSystemChat(`Modo de codificação alterado para: ${label}`);
      const diagModal = document.getElementById('diagnosticsModal');
      if (diagModal && !diagModal.classList.contains('hidden')) {
        renderDiagnosticsData().catch(() => {});
      }
    });
  }

  const settingPreferredCodec = document.getElementById('settingPreferredCodec');
  if (settingPreferredCodec) {
    settingPreferredCodec.addEventListener('change', async () => {
      const chosen = settingPreferredCodec.value;
      console.log(`[Settings] Codec preferencial selecionado: ${chosen}`);
      await webrtc.setPreferredCodec(chosen);
      saveSettingsState();
      appendSystemChat(`Codec de vídeo preferido alterado para: ${chosen.toUpperCase()}`);
      const diagModal = document.getElementById('diagnosticsModal');
      if (diagModal && !diagModal.classList.contains('hidden')) {
        renderDiagnosticsData().catch(() => {});
      }
    });
  }

  const settingPrioritizeH264High50 = document.getElementById('settingPrioritizeH264High50');
  if (settingPrioritizeH264High50) {
    settingPrioritizeH264High50.checked = Boolean(webrtc.getPrioritizeH264High50());
    settingPrioritizeH264High50.addEventListener('change', async () => {
      const enabled = Boolean(settingPrioritizeH264High50.checked);
      console.log(`[Settings] Priorizar H.264 High 5.0 (640032) para teste: ${enabled}`);
      await webrtc.setPrioritizeH264High50(enabled);
      saveSettingsState();
      appendSystemChat(`Priorizar H.264 High 5.0 (640032) para teste: ${enabled ? 'Ativado' : 'Desativado'}`);
      const diagModal = document.getElementById('diagnosticsModal');
      if (diagModal && !diagModal.classList.contains('hidden')) {
        renderDiagnosticsData().catch(() => {});
      }
    });
  }

  // Cartões Clicáveis de Codecs de Vídeo
  const codecCards = [
    { el: document.getElementById('codecCardH264'), val: 'H264' },
    { el: document.getElementById('codecCardAV1'), val: 'AV1' },
    { el: document.getElementById('codecCardVP9'), val: 'VP9' },
    { el: document.getElementById('codecCardVP8'), val: 'VP8' }
  ];

  codecCards.forEach(({ el, val }) => {
    if (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', async () => {
        if (settingPreferredCodec) settingPreferredCodec.value = val;
        await webrtc.setPreferredCodec(val);
        saveSettingsState();
        appendSystemChat(`Codec de vídeo priorizado: ${val.toUpperCase()}`);
        const diagModal = document.getElementById('diagnosticsModal');
        if (diagModal && !diagModal.classList.contains('hidden')) {
          renderDiagnosticsData().catch(() => {});
        }
      });
    }
  });

  // --- CONTROLES DE ÁUDIO DO SISTEMA (WASAPI LOOPBACK) ---
  const settingCaptureSystemAudio = document.getElementById('settingCaptureSystemAudio');
  const btnMuteSystemAudio = document.getElementById('btnMuteSystemAudio');
  const btnMuteSystemAudioText = document.getElementById('btnMuteSystemAudioText');
  let isSystemAudioMuted = false;

  if (settingCaptureSystemAudio) {
    settingCaptureSystemAudio.checked = media.captureSystemAudio;
    settingCaptureSystemAudio.addEventListener('change', async () => {
      const enabled = settingCaptureSystemAudio.checked;
      await media.setCaptureSystemAudio(enabled);
      if (window.desktopAPI && window.desktopAPI.setCaptureAudio) {
        window.desktopAPI.setCaptureAudio(enabled);
      }
      if (webrtc && typeof webrtc.syncLocalMedia === 'function' && roomState) {
        const otherIds = typeof roomState.getOtherParticipantIds === 'function'
          ? roomState.getOtherParticipantIds()
          : [];
        await webrtc.syncLocalMedia(media, otherIds);
      }
      saveSettingsState();
    });
  }

  // --- CONTROLE DE ÁUDIO DA CÂMERA (WEBCAM - Desativado por padrão) ---
  const settingCaptureCameraAudio = document.getElementById('settingCaptureCameraAudio');
  if (settingCaptureCameraAudio) {
    settingCaptureCameraAudio.checked = Boolean(media.captureCameraAudio);
    settingCaptureCameraAudio.addEventListener('change', async () => {
      const enabled = settingCaptureCameraAudio.checked;
      media.setCaptureCameraAudio(enabled);
      if (webrtc && typeof webrtc.syncLocalMedia === 'function' && roomState) {
        const otherIds = typeof roomState.getOtherParticipantIds === 'function'
          ? roomState.getOtherParticipantIds()
          : [];
        await webrtc.syncLocalMedia(media, otherIds);
      }
      saveSettingsState();
    });
  }

  if (btnMuteSystemAudio) {
    btnMuteSystemAudio.addEventListener('click', () => {
      isSystemAudioMuted = !isSystemAudioMuted;
      media.setSystemAudioMuted(isSystemAudioMuted);
      btnMuteSystemAudio.classList.toggle('btn-danger', isSystemAudioMuted);
      if (btnMuteSystemAudioText) {
        btnMuteSystemAudioText.textContent = isSystemAudioMuted ? 'Desmutar Som do Sistema' : 'Mutar Som do Sistema';
      }
    });
  }

  const settingEnableMic = document.getElementById('settingEnableMic');
  const settingMicDeviceSelect = document.getElementById('settingMicDeviceSelect');
  const btnMuteMicAudio = document.getElementById('btnMuteMicAudio');
  const btnMuteMicAudioText = document.getElementById('btnMuteMicAudioText');
  let isMicAudioMuted = false;

  if (settingEnableMic) {
    settingEnableMic.addEventListener('change', async () => {
      if (settingEnableMic.checked) {
        const deviceId = settingMicDeviceSelect ? settingMicDeviceSelect.value : null;
        try {
          await media.startMicrophone(deviceId);
          const otherIds = roomState.getOtherParticipantIds();
          await webrtc.syncLocalMedia(media, otherIds);
          await webrtc.renegotiateAllPeers(otherIds);
          btnToggleAudio.classList.add('active');
          micIcon.innerHTML = Icons.mic(18);
          micLabel.textContent = 'Microfone Ativo';
        } catch (err) {
          alert('Erro ao ativar microfone: ' + err.message);
          settingEnableMic.checked = false;
        }
      } else {
        media.stopMicrophone();
        const otherIds = roomState.getOtherParticipantIds();
        await webrtc.syncLocalMedia(media, otherIds);
        await webrtc.renegotiateAllPeers(otherIds);
        btnToggleAudio.classList.remove('active');
        micIcon.innerHTML = Icons.micOff(18);
        micLabel.textContent = 'Microfone';
      }
      saveSettingsState();
    });
  }

  if (settingMicDeviceSelect) {
    settingMicDeviceSelect.addEventListener('change', async () => {
      const deviceId = settingMicDeviceSelect.value;
      await media.setMicrophoneDevice(deviceId);
      saveSettingsState();
    });
  }

  if (btnMuteMicAudio) {
    btnMuteMicAudio.addEventListener('click', () => {
      isMicAudioMuted = !isMicAudioMuted;
      media.setMicMuted(isMicAudioMuted);
      btnMuteMicAudio.classList.toggle('btn-danger', isMicAudioMuted);
      if (btnMuteMicAudioText) {
        btnMuteMicAudioText.textContent = isMicAudioMuted ? 'Desmutar Microfone' : 'Mutar Microfone';
      }
    });
  }

  const filterEcho = document.getElementById('filterEchoCancellation');
  const filterNoise = document.getElementById('filterNoiseSuppression');
  const filterAutoGain = document.getElementById('filterAutoGain');

  function updateAudioFilters() {
    media.setAudioFilters({
      echoCancellation: filterEcho ? filterEcho.checked : true,
      noiseSuppression: filterNoise ? filterNoise.checked : true,
      autoGainControl: filterAutoGain ? filterAutoGain.checked : true
    });
    saveSettingsState();
  }

  if (filterEcho) filterEcho.addEventListener('change', updateAudioFilters);
  if (filterNoise) filterNoise.addEventListener('change', updateAudioFilters);
  if (filterAutoGain) filterAutoGain.addEventListener('change', updateAudioFilters);

  // --- SISTEMA DE ATUALIZAÇÕES AUTOMÁTICAS IN-APP ---
  const btnCheckUpdatesManual = document.getElementById('btnCheckUpdatesManual');
  const btnCheckUpdatesText = document.getElementById('btnCheckUpdatesText');
  const updateStatusBox = document.getElementById('updateStatusBox');
  const updateStatusIcon = document.getElementById('updateStatusIcon');
  const updateStatusTitle = document.getElementById('updateStatusTitle');
  const updateStatusDesc = document.getElementById('updateStatusDesc');
  const updateActionPanel = document.getElementById('updateActionPanel');
  const newVersionTag = document.getElementById('newVersionTag');
  const newVersionChangelog = document.getElementById('newVersionChangelog');
  const btnInstallUpdateNow = document.getElementById('btnInstallUpdateNow');
  const updateProgressContainer = document.getElementById('updateProgressContainer');
  const updateProgressLabel = document.getElementById('updateProgressLabel');
  const updateProgressPercent = document.getElementById('updateProgressPercent');
  const updateProgressBarFill = document.getElementById('updateProgressBarFill');
  const updateAvailableBadge = document.getElementById('updateAvailableBadge');

  async function checkForUpdates(isAuto = false) {
    if (!window.desktopAPI || !window.desktopAPI.checkForUpdates) {
      if (!isAuto) {
        if (updateStatusTitle) updateStatusTitle.textContent = 'Versão Web';
        if (updateStatusDesc) updateStatusDesc.textContent = 'O instalador nativo para Windows está disponível em GitHub Releases.';
      }
      return;
    }

    if (btnCheckUpdatesManual) btnCheckUpdatesManual.disabled = true;
    if (btnCheckUpdatesText) btnCheckUpdatesText.textContent = 'Verificando...';
    if (updateStatusIcon) updateStatusIcon.className = 'update-status-icon loading';

    try {
      const res = await window.desktopAPI.checkForUpdates();
      console.log('[Updater] Resultado da verificação:', res);

      if (res && res.hasUpdate) {
        latestUpdateInfo = res;
        if (updateAvailableBadge) updateAvailableBadge.classList.remove('hidden');

        // Exibe o banner flutuante no canto da tela
        const updateFloatingBanner = document.getElementById('updateFloatingBanner');
        const updateBannerVersion = document.getElementById('updateBannerVersion');
        if (updateFloatingBanner && updateBannerVersion) {
          updateBannerVersion.textContent = `v${res.latestVersion}`;
          updateFloatingBanner.classList.remove('hidden');
        }

        if (updateStatusTitle) updateStatusTitle.textContent = `Nova versão disponível: v${res.latestVersion}`;
        if (updateStatusDesc) updateStatusDesc.textContent = 'Uma atualização com melhorias de desempenho e correções está pronta para instalação.';
        if (updateStatusIcon) updateStatusIcon.className = 'update-status-icon has-update';

        if (updateActionPanel) {
          updateActionPanel.classList.remove('hidden');
          if (newVersionTag) newVersionTag.textContent = `v${res.latestVersion}`;
          if (newVersionChangelog) {
            newVersionChangelog.textContent = res.releaseNotes || 'Melhorias de estabilidade, gerenciamento de memória e novos recursos.';
          }
        }
      } else {
        const updateFloatingBanner = document.getElementById('updateFloatingBanner');
        if (updateFloatingBanner) updateFloatingBanner.classList.add('hidden');
        if (updateAvailableBadge) updateAvailableBadge.classList.add('hidden');
        if (updateActionPanel) updateActionPanel.classList.add('hidden');
        if (updateStatusTitle) updateStatusTitle.textContent = 'HyperStream está atualizado';
        if (updateStatusDesc) updateStatusDesc.textContent = `Você está na versão v${res?.currentVersion || '1.0.1'}, a mais recente e otimizada.`;
        if (updateStatusIcon) updateStatusIcon.className = 'update-status-icon success';
      }
    } catch (err) {
      console.warn('[Updater] Erro ao verificar atualizações:', err);
      if (!isAuto) {
        if (updateStatusTitle) updateStatusTitle.textContent = 'Não foi possível verificar atualizações';
        if (updateStatusDesc) updateStatusDesc.textContent = 'Verifique sua conexão com a internet ou o repositório no GitHub.';
      }
    } finally {
      if (btnCheckUpdatesManual) btnCheckUpdatesManual.disabled = false;
      if (btnCheckUpdatesText) btnCheckUpdatesText.textContent = 'Verificar Atualizações';
    }
  }

  // Banner flutuante de atualização
  const btnUpdateBannerInstall = document.getElementById('btnUpdateBannerInstall');
  const btnUpdateBannerDismiss = document.getElementById('btnUpdateBannerDismiss');
  const updateFloatingBanner = document.getElementById('updateFloatingBanner');

  if (btnUpdateBannerInstall) {
    btnUpdateBannerInstall.addEventListener('click', () => {
      openSettings('updates');
      updateFloatingBanner?.classList.add('hidden');
      if (btnInstallUpdateNow && !btnInstallUpdateNow.disabled) {
        btnInstallUpdateNow.click();
      }
    });
  }

  if (btnUpdateBannerDismiss) {
    btnUpdateBannerDismiss.addEventListener('click', () => {
      updateFloatingBanner?.classList.add('hidden');
    });
  }

  if (btnCheckUpdatesManual) {
    btnCheckUpdatesManual.addEventListener('click', () => checkForUpdates(false));
  }

  if (btnInstallUpdateNow) {
    btnInstallUpdateNow.addEventListener('click', async () => {
      if (!latestUpdateInfo || !latestUpdateInfo.downloadUrl) {
        alert('Nenhum link de download disponível para esta atualização.');
        return;
      }

      btnInstallUpdateNow.disabled = true;
      if (updateProgressContainer) updateProgressContainer.classList.remove('hidden');

      if (window.desktopAPI.onUpdateProgress) {
        window.desktopAPI.onUpdateProgress((data) => {
          if (data.status === 'downloading') {
            if (updateProgressLabel) updateProgressLabel.textContent = `Baixando atualização (${data.percent}%)...`;
            if (updateProgressPercent) updateProgressPercent.textContent = `${data.percent}%`;
            if (updateProgressBarFill) updateProgressBarFill.style.width = `${data.percent}%`;
          } else if (data.status === 'extracting') {
            if (updateProgressLabel) updateProgressLabel.textContent = 'Extraindo arquivos da atualização...';
            if (updateProgressBarFill) updateProgressBarFill.style.width = '100%';
          } else if (data.status === 'installing') {
            if (updateProgressLabel) updateProgressLabel.textContent = 'Reiniciando HyperStream para aplicar...';
          }
        });
      }

      try {
        const installResult = await window.desktopAPI.downloadAndInstallUpdate(latestUpdateInfo.downloadUrl);
        if (!installResult.success) {
          alert('Falha ao instalar atualização:\n' + (installResult.error || 'Erro desconhecido'));
          btnInstallUpdateNow.disabled = false;
        }
      } catch (err) {
        alert('Erro durante atualização:\n' + err.message);
        btnInstallUpdateNow.disabled = false;
      }
    });
  }

  // Persistência das Configurações no localStorage
  function saveSettingsState() {
    try {
      const state = {
        profile: qualityController ? qualityController.activeProfile : 'ultra',
        fps: settingFpsSelect ? settingFpsSelect.value : '60',
        res: settingResSelect ? settingResSelect.value : 'native',
        hint: settingContentHint ? settingContentHint.value : 'motion',
        maxBitrate: settingMaxBitrate ? settingMaxBitrate.value : '8000000',
        minBitrate: settingMinBitrate ? settingMinBitrate.value : '4000000',
        codec: settingPreferredCodec ? settingPreferredCodec.value : 'auto',
        encoderPreference: settingEncoderPreference ? settingEncoderPreference.value : 'auto',
        prioritizeH264High50: settingPrioritizeH264High50 ? Boolean(settingPrioritizeH264High50.checked) : false,
        captureSystemAudio: settingCaptureSystemAudio ? settingCaptureSystemAudio.checked : true,
        captureCameraAudio: settingCaptureCameraAudio ? settingCaptureCameraAudio.checked : false,
        micDeviceId: settingMicDeviceSelect ? settingMicDeviceSelect.value : '',
        echo: filterEcho ? filterEcho.checked : true,
        noise: filterNoise ? filterNoise.checked : true,
        gain: filterAutoGain ? filterAutoGain.checked : true
      };
      localStorage.setItem('webrtc_stream_settings', JSON.stringify(state));
    } catch (_) {}
  }

  function loadSettingsState() {
    try {
      const raw = localStorage.getItem('webrtc_stream_settings');
      if (!raw) {
        if (settingPrioritizeH264High50) {
          settingPrioritizeH264High50.checked = false;
        }
        webrtc.prioritizeH264High50 = false;
        if (settingCaptureSystemAudio) {
          settingCaptureSystemAudio.checked = true;
          media.setCaptureSystemAudio(true);
        }
        if (settingCaptureCameraAudio) {
          settingCaptureCameraAudio.checked = false;
          media.setCaptureCameraAudio(false);
        }
        return;
      }
      const s = JSON.parse(raw);

      if (s.profile) {
        qualityController.setProfile(s.profile);
        presetCards.forEach(c => c.classList.toggle('active', c.dataset.profile === s.profile));
      }
      if (s.fps && settingFpsSelect) {
        settingFpsSelect.value = s.fps;
        media.setFpsPreference(Number(s.fps));
      }
      if (s.res && settingResSelect) {
        settingResSelect.value = s.res;
        media.setResolutionPreference(s.res);
      }
      if (s.hint && settingContentHint) {
        settingContentHint.value = s.hint;
        media.setContentHint(s.hint);
      }
      if (s.maxBitrate && settingMaxBitrate) {
        settingMaxBitrate.value = s.maxBitrate;
      }
      if (s.minBitrate && settingMinBitrate) {
        settingMinBitrate.value = s.minBitrate;
      }
      const high50 = Boolean(s.prioritizeH264High50);
      if (settingPrioritizeH264High50) {
        settingPrioritizeH264High50.checked = high50;
      }
      webrtc.prioritizeH264High50 = high50;
      if (s.encoderPreference && settingEncoderPreference) {
        settingEncoderPreference.value = s.encoderPreference;
        webrtc.setEncoderPreference(s.encoderPreference);
      }
      if (s.codec && settingPreferredCodec) {
        let appliedCodec = s.codec;
        if (s.encoderPreference === 'gpu' && s.codec === 'AV1') {
          appliedCodec = 'auto';
        }
        settingPreferredCodec.value = appliedCodec;
        webrtc.setPreferredCodec(appliedCodec);
      }
      if (s.captureSystemAudio !== undefined && settingCaptureSystemAudio) {
        settingCaptureSystemAudio.checked = Boolean(s.captureSystemAudio);
        media.setCaptureSystemAudio(Boolean(s.captureSystemAudio));
      } else if (settingCaptureSystemAudio) {
        settingCaptureSystemAudio.checked = true;
        media.setCaptureSystemAudio(true);
      }
      if (s.captureCameraAudio !== undefined && settingCaptureCameraAudio) {
        settingCaptureCameraAudio.checked = Boolean(s.captureCameraAudio);
        media.setCaptureCameraAudio(Boolean(s.captureCameraAudio));
      } else if (settingCaptureCameraAudio) {
        settingCaptureCameraAudio.checked = false;
        media.setCaptureCameraAudio(false);
      }
      if (s.echo !== undefined && filterEcho) filterEcho.checked = s.echo;
      if (s.noise !== undefined && filterNoise) filterNoise.checked = s.noise;
      if (s.gain !== undefined && filterAutoGain) filterAutoGain.checked = s.gain;

      updateBitrateBadges();
      updateAudioFilters();
      loadSavedAudioAppsState();
      saveAudioAppsState();
    } catch (e) {
      console.warn('[Settings] Erro ao restaurar configurações:', e);
    }
  }

  loadSettingsState();

  // ========================================================
  // WATCHDOG & RECUPERAÇÃO DE REPRODUÇÃO EM SEGUNDO PLANO
  // ========================================================
  function resumeAllActiveVideos() {
    activeTiles.forEach((entry, tileId) => {
      if (entry.videoEl) {
        if (entry.videoEl.paused) {
          console.log(`[App Watchdog] Retomando reprodução pausada no tile: ${tileId}`);
          entry.videoEl.play().catch(err => {
            console.warn(`[App Watchdog] Erro ao retomar reprodução do tile ${tileId}:`, err.message);
          });
        }
      }
    });

    localPreviews.forEach((preview) => {
      if (preview.videoEl && preview.videoEl.paused && !preview.isHidden && !preview.isPinned && !isDockMinimized) {
        preview.videoEl.play().catch(() => {});
      }
    });
  }

  // 1. Recuperação imediata quando o aplicativo volta do segundo plano (e pausa de prévia local quando minimizado/oculto)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      localPreviews.forEach((preview) => {
        if (preview.videoEl && !preview.videoEl.paused) {
          try { preview.videoEl.pause(); } catch (_) {}
        }
      });
    } else {
      console.log('[App] Janela voltou a ficar visível. Executando recuperação defensiva de transmissões...');
      resumeAllActiveVideos();
      if (roomState.roomId) {
        roomState.getOtherParticipantIds().forEach(uid => {
          syncRemotePeerTiles(uid);
        });
      }
    }
  });

  window.addEventListener('focus', () => {
    resumeAllActiveVideos();
  });

  // 2. Watchdog periódico leve (a cada 3.5 segundos) para manter streams fluindo sem congelamento
  setInterval(() => {
    if (roomState.roomId) {
      resumeAllActiveVideos();
    }
  }, 3500);

  // Verificação silenciosa de atualização ao abrir em desktop
  if (window.desktopAPI) {
    setTimeout(() => {
      checkForUpdates(true);
    }, 2500);
  }
}

// Inicialização imediata
init();


