/**
 * Sistema de Controle Adaptativo de Qualidade (Quality Controller)
 * Documentação Arquitetural: Seção 8 e Seção 16
 *
 * Coleta métricas precisas via getStats() em malha P2P multi-usuário e ajusta dinamicamente
 * bitrate, resolução e FPS para garantir transmissão estável de até 60 FPS.
 */

export const QUALITY_PROFILES = {
  '4k_ultra': {
    id: '4k_ultra',
    label: '4K Ultra HD (60 FPS)',
    maxBitrate: 25000000,
    minBitrate: 10000000,
    maxFps: 60,
    description: '4K a 60 FPS com até 25 Mbps (Requer GPU dedicada e conexão gigabit)'
  },
  '1440p_ultra': {
    id: '1440p_ultra',
    label: '1440p / 2K Quad HD (60 FPS)',
    maxBitrate: 16000000,
    minBitrate: 6000000,
    maxFps: 60,
    description: '1440p a 60 FPS com até 16 Mbps (Qualidade extrema para monitores 2K)'
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra (60 FPS)',
    maxBitrate: 8000000,
    minBitrate: 4000000,
    maxFps: 60,
    description: '1080p a 60 FPS com até 8 Mbps (Rede local ou fibra óptica rápida)'
  },
  balanced: {
    id: 'balanced',
    label: 'Equilibrado (60 FPS)',
    maxBitrate: 5000000,
    minBitrate: 2500000,
    maxFps: 60,
    description: '60 FPS com até 5.0 Mbps (Ideal para jogar pela internet com amigos)'
  },
  eco: {
    id: 'eco',
    label: 'Econômico (30 FPS)',
    maxBitrate: 2000000,
    minBitrate: 1000000,
    maxFps: 30,
    description: '30 FPS com até 2.0 Mbps (Ideal para conexões instáveis ou 4G)'
  },
  custom: {
    id: 'custom',
    label: 'Personalizado',
    maxBitrate: 8000000,
    minBitrate: 2500000,
    maxFps: 60,
    description: 'Configuração manual definida pelo usuário'
  }
};

/**
 * Avalia se o nome da implementação de codificador/decodificador do Chromium
 * corresponde a aceleração por hardware GPU (NVENC, AMF, D3D11, MediaFoundation)
 */
export function isHardwareCodecImplementation(implName) {
  if (!implName) return false;
  const s = String(implName).toLowerCase();
  if (s.startsWith('externalencoder') || s.startsWith('externaldecoder')) return true;
  if (s.includes('d3d11') || s.includes('nvenc') || s.includes('amf') || s.includes('mediafoundation') || s.includes('qsv') || s.includes('hardware')) return true;
  if (s.includes('openh264') || s.includes('libvpx') || s.includes('libaom') || s.includes('dav1d') || s.includes('ffmpeg')) return false;
  return false;
}

/**
 * Análise técnica detalhada da implementação do codificador de vídeo
 * Taxonomia rigorosa de 3 estados operacionais + inativo:
 * - 'hardware_confirmed': Hardware confirmado por evidência direta (MFT, NVENC, AMF, D3D11, etc.)
 * - 'software_confirmed': Software confirmado por evidência direta (libaom, openh264, libvpx, dav1d, etc.)
 * - 'unknown': Implementação não informada pelo WebRTC ou não catalogada (sem suposição de CPU)
 * - 'inactive': Fluxo sem atividade de codificação
 */
export function analyzeEncoderImplementation(implName, codecName = '', isPowerEfficient = null, activityInfo = {}) {
  // Trata caso onde activityInfo foi passado como 3º argumento para compatibilidade reversa
  if (typeof isPowerEfficient === 'object' && isPowerEfficient !== null && Object.keys(activityInfo).length === 0) {
    activityInfo = isPowerEfficient;
    isPowerEfficient = null;
  }

  const { framesEncoded = null, bytesSent = null, framesDelta = null, qualityLimitationReason = 'none' } = activityInfo;
  const isInactive = (framesEncoded === 0 && bytesSent === 0) || (framesDelta === 0 && bytesSent === 0);

  if (isInactive) {
    return {
      state: 'inactive',
      category: 'inactive',
      label: 'Sem Atividade / Ocioso',
      badgeClass: 'diag-badge-neutral',
      isHardware: false,
      isSoftware: false,
      isUnknown: false,
      rawImplementation: implName || 'Nenhuma',
      powerEfficient: isPowerEfficient,
      qualityLimitationReason,
      evidence: 'Nenhum quadro codificado ou enviado nesta conexão (streaming sob demanda ou pausado)'
    };
  }

  const s = String(implName || '').toLowerCase();
  const isHwImpl = s.startsWith('externalencoder') || s.includes('d3d11') || s.includes('mediafoundation') || s.includes('nvenc') || s.includes('amf') || s.includes('vcn') || s.includes('qsv') || s.includes('vaapi') || s.includes('hardware');
  const isSwImpl = s.includes('openh264') || s.includes('libaom') || s.includes('libvpx') || s.includes('dav1d') || s.includes('ffmpeg') || s.includes('software');

  // 1. Hardware confirmado: powerEfficient === true OU nome comprovadamente de hardware (sem indicador de software)
  if (isPowerEfficient === true || (isHwImpl && !isSwImpl && isPowerEfficient !== false)) {
    const rawImpl = implName ? `${implName}${isPowerEfficient === true ? ' [powerEfficient]' : ''}` : 'Hardware GPU [powerEfficient]';
    return {
      state: 'hardware_confirmed',
      category: 'hardware',
      label: 'GPU Hardware ⚡',
      badgeClass: 'diag-badge-hw',
      isHardware: true,
      isSoftware: false,
      isUnknown: false,
      rawImplementation: rawImpl,
      powerEfficient: isPowerEfficient ?? true,
      qualityLimitationReason,
      evidence: `GPU Hardware Confirmado (${rawImpl}) via DirectX 11 / MediaFoundationVideoEncodeAccelerator`
    };
  }

  // 2. Software confirmado: powerEfficient === false (quando framesEncoded > 15) OU nome de software
  if (isPowerEfficient === false || isSwImpl) {
    const rawImpl = implName || `${codecName} Software`;
    let evidenceText = `Software / CPU (${rawImpl}) — Fallback ativo para codificador de software`;
    if (s.includes('libaom')) {
      evidenceText = `Software / CPU (${rawImpl}) — Hardware/driver não expôs codificador AV1 ao WebRTC; fallback ativo para biblioteca libaom multi-threaded`;
    } else if (s.includes('openh264')) {
      evidenceText = `Software / CPU (${rawImpl}) — Fallback ativo para OpenH264 (Cisco)`;
    } else if (s.includes('libvpx')) {
      evidenceText = `Software / CPU (${rawImpl}) — Codificador VP8/VP9 por CPU`;
    }
    return {
      state: 'software_confirmed',
      category: 'software',
      label: `Software (CPU: ${implName || codecName}) ⚠️`,
      badgeClass: 'diag-badge-sw',
      isHardware: false,
      isSoftware: true,
      isUnknown: false,
      rawImplementation: rawImpl,
      powerEfficient: false,
      qualityLimitationReason,
      evidence: evidenceText
    };
  }

  // 3. Ausência de implementação e de sinal de powerEfficient
  if (!implName) {
    return {
      state: 'unknown',
      category: 'inconclusive',
      label: 'Não determinado',
      badgeClass: 'diag-badge-neutral',
      isHardware: false,
      isSoftware: false,
      isUnknown: true,
      rawImplementation: 'Não informado pelo WebRTC',
      powerEfficient: null,
      qualityLimitationReason,
      evidence: 'A API getStats() do Chromium nesta plataforma não expôs encoderImplementation no relatório outbound-rtp. Não é possível determinar se a codificação é executada via GPU (MFT/D3D11) ou CPU.'
    };
  }

  return {
    state: 'unknown',
    category: 'inconclusive',
    label: `Não determinado (${implName})`,
    badgeClass: 'diag-badge-neutral',
    isHardware: false,
    isSoftware: false,
    isUnknown: true,
    rawImplementation: implName,
    powerEfficient: isPowerEfficient,
    qualityLimitationReason,
    evidence: `Implementação não catalogada: ${implName}`
  };
}

/**
 * Análise técnica detalhada da implementação do decodificador de vídeo
 */
export function analyzeDecoderImplementation(implName, powerEfficient = false, activityInfo = {}) {
  const { framesDecoded = null, bytesReceived = null, framesDelta = null } = activityInfo;
  const isInactive = (framesDecoded === 0 && bytesReceived === 0) || (framesDelta === 0 && bytesReceived === 0);

  if (isInactive) {
    return {
      state: 'inactive',
      category: 'inactive',
      label: 'Sem Atividade / Ocioso',
      badgeClass: 'diag-badge-neutral',
      isHardware: false,
      isSoftware: false,
      isUnknown: false,
      rawImplementation: implName || 'Nenhuma',
      evidence: 'Nenhum quadro recebido para decodificação no momento'
    };
  }

  if (!implName && !powerEfficient) {
    return {
      state: 'unknown',
      category: 'inconclusive',
      label: 'Não determinado',
      badgeClass: 'diag-badge-neutral',
      isHardware: false,
      isSoftware: false,
      isUnknown: true,
      rawImplementation: 'Não informado pelo WebRTC',
      evidence: 'A API getStats() do Chromium nesta plataforma não expôs decoderImplementation. Não é possível determinar se a decodificação é executada via GPU (D3D11/DXVA) ou CPU.'
    };
  }

  const s = String(implName || '').toLowerCase();
  if (s.startsWith('externaldecoder') || s.includes('d3d11') || s.includes('mediafoundation') || s.includes('hardware') || powerEfficient) {
    const raw = implName || (powerEfficient ? 'D3D11 [powerEfficient]' : 'MediaFoundation');
    return {
      state: 'hardware_confirmed',
      category: 'hardware',
      label: 'GPU Hardware ⚡',
      badgeClass: 'diag-badge-hw',
      isHardware: true,
      isSoftware: false,
      isUnknown: false,
      rawImplementation: raw,
      evidence: `GPU Hardware Confirmado (${raw}) via D3D11/MediaFoundationVideoDecoder`
    };
  }
  if (s.includes('dav1d')) {
    return {
      state: 'software_confirmed',
      category: 'software',
      label: 'Software (CPU: dav1d) ⚠️',
      badgeClass: 'diag-badge-sw',
      isHardware: false,
      isSoftware: true,
      isUnknown: false,
      rawImplementation: implName,
      evidence: `Software / CPU (${implName}) — Decodificador AV1 multi-threaded via CPU`
    };
  }
  if (s.includes('ffmpeg') || s.includes('openh264') || s.includes('libvpx')) {
    return {
      state: 'software_confirmed',
      category: 'software',
      label: `Software (CPU: ${implName}) ⚠️`,
      badgeClass: 'diag-badge-sw',
      isHardware: false,
      isSoftware: true,
      isUnknown: false,
      rawImplementation: implName,
      evidence: `Software / CPU (${implName})`
    };
  }
  return {
    state: 'unknown',
    category: 'inconclusive',
    label: `Não determinado (${implName || 'Padrão'})`,
    badgeClass: 'diag-badge-neutral',
    isHardware: false,
    isSoftware: false,
    isUnknown: true,
    rawImplementation: implName || 'Padrão',
    evidence: `Implementação de decodificação: ${implName || 'Padrão do Sistema'}`
  };
}

export class QualityController {
  constructor() {
    this.intervalId = null;
    this.pollIntervalMs = 1500; // Coleta de métricas a cada 1.5 segundos
    this.onStatsUpdate = null;
    this.webrtc = null;

    // Histórico individual por ID de relatório RTP para cálculo exato de deltas sem colisões
    this.streamStatsHistory = new Map();
    this.latestDiagnostics = null; // Diagnóstico completo acessível pelo painel de estatísticas

    // Gerenciador Adaptativo de Transmissão por Peer (Ativo, Segundo Plano e Inativo)
    this.peerAdaptiveStates = new Map(); // Map<userId, { userId, viewerState, currentMaxFps, currentMaxBitrate, currentScaleDown, estimatedCpuSavingsPercent, lastStateChange }>

    // Perfil ativo persistente (Ultra por padrão)
    const saved = (() => {
      try { return localStorage.getItem('hyperstream_active_profile') || 'ultra'; } catch (_) { return 'ultra'; }
    })();
    const profile = QUALITY_PROFILES[saved] || QUALITY_PROFILES.ultra;

    this.activeProfile = profile.id;
    this.currentMaxBitrate = profile.maxBitrate;
    this.currentMaxFps = profile.maxFps;

    // Histerese para evitar oscilações rápidas de bitrate e resolução
    this.lastAdaptationTimestamp = 0;
    this.lastAdaptationDirection = 'none';
    this.hysteresisDownCooldownMs = 4000;
    this.hysteresisUpCooldownMs = 8000;
  }

  setWebRTC(webrtcManager) {
    this.webrtc = webrtcManager;
  }

  getDetailedDiagnostics() {
    return this.latestDiagnostics;
  }

  start(webrtcManager, callback) {
    this.webrtc = webrtcManager;
    this.onStatsUpdate = callback;

    if (this.webrtc) {
      this.webrtc.targetMaxBitrate = this.currentMaxBitrate;
      this.webrtc.targetMaxFps = this.currentMaxFps;
    }

    this.stop(); // Garante que nenhum timer anterior continue rodando

    // Aplica imediatamente nos senders já existentes
    this.applyProfileToPeers();

    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, this.pollIntervalMs);

    console.log(`[QualityController] Monitoramento ativado. Perfil inicial: ${this.activeProfile} (${(this.currentMaxBitrate / 1000000).toFixed(1)} Mbps @ ${this.currentMaxFps} FPS)`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.streamStatsHistory.clear();
    this.peerAdaptiveStates.clear();
  }

  /**
   * Retorna os parâmetros de codificação ótimos para o estado de visibilidade do espectador
   * @param {string} state - 'active' | 'background' | 'inactive'
   */
  getEncodingParametersForState(state = 'active') {
    const profile = QUALITY_PROFILES[this.activeProfile] || QUALITY_PROFILES.ultra;
    const baseMaxBitrate = this.currentMaxBitrate || profile.maxBitrate;
    const baseMaxFps = this.currentMaxFps || profile.maxFps;

    switch (state) {
      case 'background': {
        // Redução substancial de CPU e GPU: 15 FPS e resolução dividida por 2 (540p)
        // Reduz o número de quadros processados pelo encoder em 75% e a contagem de pixels em 75%
        const maxFramerate = Math.min(15, Math.max(10, Math.round(baseMaxFps * 0.25)));
        const scaleResolutionDownBy = 2.0; // 1/4 dos pixels (ex: 1920x1080 -> 960x540)
        const maxBitrate = Math.min(1200000, Math.max(400000, Math.round(baseMaxBitrate * 0.20)));
        return {
          state: 'background',
          maxFramerate,
          scaleResolutionDownBy,
          maxBitrate,
          priority: 'low',
          networkPriority: 'low',
          estimatedSavingsPercent: 85,
          label: 'Segundo Plano (15 FPS @ 540p)',
          badgeClass: 'diag-badge-warn'
        };
      }
      case 'inactive': {
        // Modo ocioso / standby: 5 FPS e resolução dividida por 4 (270p)
        // Economia superior a 95% de processamento para essa conexão
        const maxFramerate = Math.min(5, Math.max(1, Math.round(baseMaxFps * 0.10)));
        const scaleResolutionDownBy = 4.0; // 1/16 dos pixels (ex: 1920x1080 -> 480x270)
        const maxBitrate = Math.min(300000, Math.max(150000, Math.round(baseMaxBitrate * 0.05)));
        return {
          state: 'inactive',
          maxFramerate,
          scaleResolutionDownBy,
          maxBitrate,
          priority: 'very-low',
          networkPriority: 'low',
          estimatedSavingsPercent: 95,
          label: 'Inativo (5 FPS @ 270p)',
          badgeClass: 'diag-badge-neutral'
        };
      }
      case 'active':
      default: {
        // Espectador ativo assistindo ativamente à transmissão: qualidade e fluidez total
        return {
          state: 'active',
          maxFramerate: baseMaxFps,
          scaleResolutionDownBy: 1.0,
          maxBitrate: baseMaxBitrate,
          priority: 'high',
          networkPriority: 'high',
          estimatedSavingsPercent: 0,
          label: 'Ativo (Focado)',
          badgeClass: 'diag-badge-hw'
        };
      }
    }
  }

  /**
   * Aplica parâmetros de codificação individualmente para o RTCRtpSender de um peer
   */
  async applyEncodingParametersToSender(targetId, overrideConfig = null) {
    if (!this.webrtc || !this.webrtc.peers) return;
    const pc = this.webrtc.peers.get(targetId);
    if (!pc || pc.connectionState === 'closed') return;

    let peerEntry = this.peerAdaptiveStates.get(targetId);
    if (!peerEntry) {
      peerEntry = {
        userId: targetId,
        viewerState: 'active',
        lastStateChange: Date.now(),
        currentMaxFps: this.currentMaxFps,
        currentMaxBitrate: this.currentMaxBitrate,
        currentScaleDown: 1.0,
        estimatedCpuSavingsPercent: 0
      };
      this.peerAdaptiveStates.set(targetId, peerEntry);
    }

    const config = overrideConfig || this.getEncodingParametersForState(peerEntry.viewerState);
    peerEntry.currentMaxFps = config.maxFramerate;
    peerEntry.currentMaxBitrate = config.maxBitrate;
    peerEntry.currentScaleDown = config.scaleResolutionDownBy;
    peerEntry.estimatedCpuSavingsPercent = config.estimatedSavingsPercent;

    const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
    for (const sender of senders) {
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = config.maxBitrate;
        params.encodings[0].maxFramerate = config.maxFramerate;
        params.encodings[0].scaleResolutionDownBy = config.scaleResolutionDownBy;
        params.encodings[0].priority = config.priority;
        params.encodings[0].networkPriority = config.networkPriority;
        params.degradationPreference = 'maintain-framerate';

        await sender.setParameters(params);
      } catch (err) {
        console.warn(`[QualityController] Falha ao ajustar encoding para peer ${targetId}:`, err.message);
      }
    }
  }

  /**
   * Atualiza o estado de um espectador e reconfigura seu encoder na GPU/CPU
   */
  async updateViewerState(userId, stateData = {}) {
    if (!userId) return null;
    const requestedState = typeof stateData === 'string' ? stateData : (stateData.state || 'active');
    const validState = (requestedState === 'background' || requestedState === 'inactive') ? requestedState : 'active';

    let peerEntry = this.peerAdaptiveStates.get(userId);
    if (!peerEntry) {
      peerEntry = {
        userId,
        viewerState: 'active',
        lastStateChange: Date.now(),
        currentMaxFps: this.currentMaxFps,
        currentMaxBitrate: this.currentMaxBitrate,
        currentScaleDown: 1.0,
        estimatedCpuSavingsPercent: 0
      };
      this.peerAdaptiveStates.set(userId, peerEntry);
    }

    const previousState = peerEntry.viewerState;
    peerEntry.viewerState = validState;
    if (previousState !== validState) {
      peerEntry.lastStateChange = Date.now();
      console.log(`[QualityController] Espectador ${userId} alterou estado: ${previousState} ➔ ${validState}`);
    }

    const config = this.getEncodingParametersForState(validState);
    await this.applyEncodingParametersToSender(userId, config);
    return peerEntry;
  }

  /**
   * Remove o rastreamento adaptativo de um espectador desconectado
   */
  removePeer(userId) {
    if (userId) {
      this.peerAdaptiveStates.delete(userId);
    }
  }

  /**
   * Altera manualmente o perfil de qualidade (Ultra, Equilibrado, Econômico, Personalizado)
   * Aplicado imediatamente em todos os senders de vídeo ativos em todas as conexões
   */
  async setProfile(profileKey) {
    const profile = QUALITY_PROFILES[profileKey];
    if (!profile) return;

    this.activeProfile = profileKey;
    this.currentMaxBitrate = profile.maxBitrate;
    this.currentMaxFps = profile.maxFps;

    try { localStorage.setItem('hyperstream_active_profile', profileKey); } catch (_) {}

    if (this.webrtc) {
      this.webrtc.targetMaxBitrate = this.currentMaxBitrate;
      this.webrtc.targetMaxFps = this.currentMaxFps;
    }

    console.log(`[QualityController] Perfil alterado para: ${profile.label} (Max: ${(profile.maxBitrate / 1000000).toFixed(1)} Mbps, FPS: ${profile.maxFps})`);
    await this.applyProfileToPeers();
  }

  /**
   * Aplica parâmetros do perfil ativo a todos os senders de vídeo de todos os peers,
   * respeitando os estados individuais de cada espectador (ativo, segundo plano ou inativo)
   */
  async applyProfileToPeers() {
    if (!this.webrtc || !this.webrtc.peers) return;

    for (const targetId of this.webrtc.peers.keys()) {
      await this.applyEncodingParametersToSender(targetId);
    }
  }

  /**
   * Define parâmetros customizados de qualidade e aplica imediatamente
   */
  async setCustomQuality({ maxBitrate, minBitrate, maxFps }) {
    if (maxBitrate !== undefined && maxBitrate > 0) {
      QUALITY_PROFILES.custom.maxBitrate = Number(maxBitrate);
    }
    if (minBitrate !== undefined && minBitrate > 0) {
      QUALITY_PROFILES.custom.minBitrate = Number(minBitrate);
    }
    if (maxFps !== undefined && maxFps > 0) {
      QUALITY_PROFILES.custom.maxFps = Number(maxFps);
    }
    await this.setProfile('custom');
  }

  async collectMetrics() {
    if (!this.webrtc) {
      return;
    }

    const activePcs = [];
    if (this.webrtc.peers) {
      for (const [userId, pc] of this.webrtc.peers.entries()) {
        if (pc && pc.connectionState !== 'closed' && pc.signalingState !== 'closed') {
          activePcs.push({ userId, pc });
        }
      }
    }

    // Se não há peers conectados, extrai métricas da captura local (se houver)
    if (activePcs.length === 0) {
      const localMedia = this.webrtc.mediaManager;
      const screenTrack = localMedia?.getScreenVideoTrack();
      const cameraTrack = localMedia?.getCameraVideoTrack();
      const hasScreen = Boolean(screenTrack && screenTrack.readyState === 'live');
      const hasCamera = Boolean(cameraTrack && cameraTrack.readyState === 'live');

      let width = null;
      let height = null;
      let fps = '--';
      const localCaptures = [];

      if (hasScreen) {
        const s = screenTrack.getSettings() || {};
        const w = s.width || 1920;
        const h = s.height || 1080;
        const f = s.frameRate ? Math.round(s.frameRate) : 60;
        localCaptures.push({
          type: 'screen',
          label: 'Tela / Desktop (60 FPS)',
          width: w,
          height: h,
          fps: f,
          status: 'Captura ativa no transmissor'
        });
        width = w;
        height = h;
        fps = f;
      }

      if (hasCamera) {
        const s = cameraTrack.getSettings() || {};
        const w = s.width || 1280;
        const h = s.height || 720;
        const f = s.frameRate ? Math.round(s.frameRate) : 30;
        localCaptures.push({
          type: 'camera',
          label: 'Câmera / Webcam',
          width: w,
          height: h,
          fps: f,
          status: 'Captura ativa no transmissor'
        });
        if (!width) { width = w; height = h; fps = f; }
      }

      const prefCodec = this.webrtc?.getPreferredCodec ? this.webrtc.getPreferredCodec().toUpperCase() : 'AUTO';

      this.latestDiagnostics = {
        outbound: [],
        outboundStreams: [],
        inbound: [],
        inboundStreams: [],
        localCaptures,
        hasLocalStream: localCaptures.length > 0,
        dominantConnectionType: localCaptures.length > 0 ? 'Transmissão Local Ativa (Aguardando Espectadores)' : 'Nenhum Fluxo Ativo',
        rtt: '--',
        packetLoss: '0.0',
        bitrateMbps: '0.00',
        bitrateKbps: 0,
        fps: fps || '--',
        resolution: width && height ? `${width}x${height}` : '--',
        preferredCodec: prefCodec,
        activeCodec: prefCodec !== 'AUTO' ? prefCodec : 'AV1 / H.264',
        timestamp: Date.now()
      };

      if (this.onStatsUpdate && localCaptures.length > 0) {
        this.onStatsUpdate({
          fps,
          resolution: width && height ? `${width}x${height}` : '--',
          rtt: '--',
          bitrateMbps: '0.00',
          packetLossPercent: '0.0',
          codec: prefCodec !== 'AUTO' ? prefCodec : 'AV1 / H.264',
          connectionType: 'Aguardando Amigos',
          activeProfile: this.activeProfile,
          diagnostics: this.latestDiagnostics
        });
      }
      return;
    }

    try {
      const rttValues = [];
      let totalPacketsLost = 0;
      let totalPacketsReceived = 0;
      const reportedFractionLostList = [];
      const calculatedFpsList = [];
      let width = null;
      let height = null;
      let totalBitrateBps = 0;
      let activeCodec = null;
      let dominantConnectionType = 'P2P Conectado';

      const seenReportIds = new Set();
      const outboundStreamsList = [];
      const inboundStreamsList = [];

      for (const { userId, pc } of activePcs) {
        let stats;
        try {
          stats = await pc.getStats();
        } catch (pcErr) {
          console.warn(`[QualityController] Falha ao executar getStats() no peer ${userId}:`, pcErr.message);
          continue;
        }

        // 1. Mapeamento de candidatos, codecs e media-sources deste peer
        const candidateReports = new Map();
        const codecMap = new Map();
        const codecDetailsMap = new Map();
        const codecByPayloadMap = new Map();
        const mediaSourcesMap = new Map();
        let activeCandidatePair = null;

        stats.forEach(report => {
          if (report.type === 'codec') {
            let mime = (report.mimeType || '').replace(/^video\//i, '').replace(/^audio\//i, '').toUpperCase();
            if (mime === 'AV01') mime = 'AV1';
            codecMap.set(report.id, mime);
            const detail = {
              mime,
              clockRate: report.clockRate,
              channels: report.channels,
              sdpFmtpLine: report.sdpFmtpLine || null,
              payloadType: report.payloadType
            };
            codecDetailsMap.set(report.id, detail);
            if (report.payloadType !== undefined) {
              codecByPayloadMap.set(report.payloadType, detail);
            }
          }
          if (report.type === 'media-source' && (report.kind === 'video' || report.mediaType === 'video')) {
            mediaSourcesMap.set(report.id, report);
          }
          if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
            candidateReports.set(report.id, report);
          }
          if (report.type === 'candidate-pair') {
            if ((report.state === 'succeeded' || report.nominated || report.selected) && (report.bytesSent > 0 || report.bytesReceived > 0)) {
              if (!activeCandidatePair || report.selected || report.nominated) {
                activeCandidatePair = report;
              }
            }
          }
        });

        // 2. Extrai RTT e Tipo de Conexão do par de candidatos ativo
        if (activeCandidatePair) {
          if (activeCandidatePair.currentRoundTripTime !== undefined) {
            rttValues.push(Math.round(activeCandidatePair.currentRoundTripTime * 1000));
          } else if (activeCandidatePair.roundTripTime !== undefined) {
            rttValues.push(Math.round(activeCandidatePair.roundTripTime * 1000));
          }

          const localCandidate = candidateReports.get(activeCandidatePair.localCandidateId);
          const remoteCandidate = candidateReports.get(activeCandidatePair.remoteCandidateId);
          const localType = localCandidate?.candidateType;
          const remoteType = remoteCandidate?.candidateType;
          const proto = (localCandidate?.protocol || activeCandidatePair?.protocol || 'udp').toUpperCase();

          if (localType === 'relay' || remoteType === 'relay') {
            dominantConnectionType = `Relay (TURN/${proto})`;
          } else if (localType === 'srflx' || remoteType === 'srflx' || localType === 'prflx' || remoteType === 'prflx') {
            dominantConnectionType = `P2P Direto (STUN/${proto})`;
          } else if (localType === 'host' && remoteType === 'host') {
            dominantConnectionType = `Direto LAN (${proto})`;
          }
        }

        // 3. Processamento de fluxos de vídeo (Outbound, Inbound, Media-Source e Remote-Inbound)
        const mediaMids = this.webrtc?.getMediaMids ? this.webrtc.getMediaMids(userId) : {};
        const localMedia = this.webrtc?.mediaManager;
        const screenTrack = localMedia?.getScreenVideoTrack();
        const cameraTrack = localMedia?.getCameraVideoTrack();
        const targetPeerName = this.webrtc?.roomState?.participants?.get(userId)?.name || userId;

        stats.forEach(report => {
          // A. VÍDEO DE SAÍDA (Host transmissor compartilhando tela/câmera)
          if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            seenReportIds.add(report.id);

            const codecDetail = report.codecId ? codecDetailsMap.get(report.codecId) : (report.payloadType !== undefined ? codecByPayloadMap.get(report.payloadType) : null);
            let cName = codecDetail ? codecDetail.mime : (report.codecId ? codecMap.get(report.codecId) : null);
            if (cName === 'AV01') cName = 'AV1';
            if (cName) activeCodec = cName;

            let streamType = 'Tela / Desktop';
            if (report.mid && mediaMids.camera && report.mid === mediaMids.camera) {
              streamType = 'Câmera';
            } else if (report.mid && mediaMids.screen && report.mid === mediaMids.screen) {
              streamType = 'Tela / Desktop';
            } else if (report.mediaSourceId && mediaSourcesMap.has(report.mediaSourceId)) {
              const ms = mediaSourcesMap.get(report.mediaSourceId);
              if (cameraTrack && ms.trackIdentifier === cameraTrack.id) {
                streamType = 'Câmera';
              } else if (screenTrack && ms.trackIdentifier === screenTrack.id) {
                streamType = 'Tela / Desktop';
              }
            } else if (cameraTrack && !screenTrack) {
              streamType = 'Câmera';
            }

            if (report.frameWidth && report.frameHeight) {
              width = report.frameWidth;
              height = report.frameHeight;
            }

            let streamFps = report.framesPerSecond ? Math.round(report.framesPerSecond) : null;
            let streamBitrateBps = 0;
            let avgEncodeTimeMs = null;
            let framesDelta = null;

            const prev = this.streamStatsHistory.get(report.id);
            if (prev && report.timestamp > prev.timestamp) {
              const dt = (report.timestamp - prev.timestamp) / 1000;
              if (dt > 0.1) {
                const bytesDelta = (report.bytesSent || 0) - prev.bytes;
                if (bytesDelta >= 0) {
                  streamBitrateBps = (bytesDelta * 8) / dt;
                  totalBitrateBps += streamBitrateBps;
                }

                // FPS via delta de frames enviados/codificados
                const currentFrames = report.framesSent ?? report.framesEncoded;
                if (currentFrames !== undefined && prev.frames !== undefined) {
                  framesDelta = currentFrames - prev.frames;
                  if (framesDelta >= 0) {
                    const calcFps = Math.round(framesDelta / dt);
                    calculatedFpsList.push(calcFps);
                    if (!streamFps) streamFps = calcFps;

                    if (report.totalEncodeTime !== undefined && prev.totalEncodeTime !== undefined && framesDelta > 0) {
                      const encodeDelta = report.totalEncodeTime - prev.totalEncodeTime;
                      if (encodeDelta >= 0) {
                        avgEncodeTimeMs = Number(((encodeDelta / framesDelta) * 1000).toFixed(2));
                      }
                    }
                  }
                }
              }
            }

            if (streamFps) {
              calculatedFpsList.push(streamFps);
            }

            const isPowerEfficient = typeof report.powerEfficientEncoder === 'boolean'
              ? report.powerEfficientEncoder
              : (typeof report.powerEfficient === 'boolean' ? report.powerEfficient : null);
            const encoderImpl = report.encoderImplementation || null;
            const analysis = analyzeEncoderImplementation(encoderImpl, cName, isPowerEfficient, {
              framesEncoded: report.framesEncoded ?? report.framesSent ?? 0,
              bytesSent: report.bytesSent || 0,
              framesDelta,
              qualityLimitationReason: report.qualityLimitationReason || 'none'
            });

            const streamWidth = report.frameWidth || (streamType === 'Tela / Desktop' ? screenTrack?.getSettings()?.width : cameraTrack?.getSettings()?.width) || width || '--';
            const streamHeight = report.frameHeight || (streamType === 'Tela / Desktop' ? screenTrack?.getSettings()?.height : cameraTrack?.getSettings()?.height) || height || '--';

            // FPS estritamente verificado sem valores fictícios
            let finalStreamFps = '--';
            if (streamFps !== null && streamFps !== undefined) {
              finalStreamFps = streamFps;
            } else if (report.framesEncoded === 0 || report.bytesSent === 0 || framesDelta === 0) {
              finalStreamFps = 0;
            }

            const streamBitrateMbps = (streamBitrateBps / 1000000).toFixed(2);
            const streamBitrateKbps = Math.round(streamBitrateBps / 1000);

            const peerEntry = this.peerAdaptiveStates.get(userId) || {
              viewerState: 'active',
              currentScaleDown: 1.0,
              estimatedCpuSavingsPercent: 0
            };
            const viewerConfig = this.getEncodingParametersForState(peerEntry.viewerState);

            outboundStreamsList.push({
              id: report.id,
              targetPeerId: userId,
              targetUserId: userId,
              targetPeerName,
              streamType,
              codec: cName || (this.webrtc?.getPreferredCodec ? this.webrtc.getPreferredCodec().toUpperCase() : 'AV1'),
              sdpFmtpLine: codecDetail?.sdpFmtpLine || '--',
              encoderImplementation: encoderImpl || 'Não informado',
              powerEfficientEncoder: isPowerEfficient,
              hwState: analysis.state,
              isHardware: analysis.isHardware,
              isSoftware: analysis.isSoftware,
              isUnknown: analysis.isUnknown,
              hwCategory: analysis.category,
              hwLabel: analysis.label,
              hwBadgeClass: analysis.badgeClass,
              hwEvidence: analysis.evidence,
              rawImplementation: analysis.rawImplementation,
              qualityLimitationReason: report.qualityLimitationReason || 'none',
              width: streamWidth,
              height: streamHeight,
              fps: finalStreamFps,
              bitrateMbps: streamBitrateMbps,
              bitrateKbps: streamBitrateKbps,
              framesEncoded: report.framesEncoded || 0,
              framesDropped: report.framesDropped || 0,
              avgEncodeTimeMs: avgEncodeTimeMs !== null ? `${avgEncodeTimeMs} ms` : '--',
              packetsSent: report.packetsSent || 0,
              bytesSent: report.bytesSent || 0,
              viewerState: peerEntry.viewerState,
              viewerStateLabel: viewerConfig.label,
              viewerBadgeClass: viewerConfig.badgeClass,
              scaleResolutionDownBy: peerEntry.currentScaleDown || 1.0,
              estimatedSavingsPercent: peerEntry.estimatedCpuSavingsPercent || 0
            });

            this.streamStatsHistory.set(report.id, {
              bytes: report.bytesSent || 0,
              timestamp: report.timestamp,
              frames: report.framesSent ?? report.framesEncoded,
              totalEncodeTime: report.totalEncodeTime || 0
            });
          }

          // B. FONTE DE MÍDIA LOCAL (Captura de tela / webcam no Host)
          if (report.type === 'media-source' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (!width && report.width) {
              width = report.width;
              height = report.height;
            }
            if (report.framesPerSecond) {
              calculatedFpsList.push(Math.round(report.framesPerSecond));
            }
          }

          // C. FEEDBACK RTCP DO RECEPTOR (Perda de pacotes e RTT do Host transmissor)
          if (report.type === 'remote-inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (report.packetsLost !== undefined) {
              totalPacketsLost += report.packetsLost;
            }
            if (report.fractionLost !== undefined) {
              reportedFractionLostList.push((report.fractionLost / 256) * 100);
            }
            if (report.roundTripTime !== undefined) {
              rttValues.push(Math.round(report.roundTripTime * 1000));
            }
          }

          // D. VÍDEO DE ENTRADA (Viewer espectador assistindo amigos)
          if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            seenReportIds.add(report.id);

            const codecDetail = report.codecId ? codecDetailsMap.get(report.codecId) : (report.payloadType !== undefined ? codecByPayloadMap.get(report.payloadType) : null);
            const cName = codecDetail ? codecDetail.mime : (report.codecId ? codecMap.get(report.codecId) : null);
            if (cName) activeCodec = cName;

            const mapping = this.webrtc?.peerMediaMap?.get(userId) || {};
            let streamType = 'Tela / Desktop';
            if (report.mid && mapping.cameraMid && report.mid === mapping.cameraMid) {
              streamType = 'Câmera';
            } else if (report.mid && mapping.screenMid && report.mid === mapping.screenMid) {
              streamType = 'Tela / Desktop';
            } else if (mapping.cameraActive && !mapping.screenActive) {
              streamType = 'Câmera';
            }

            if (report.frameWidth && report.frameHeight) {
              width = report.frameWidth;
              height = report.frameHeight;
            }

            let streamFps = report.framesPerSecond ? Math.round(report.framesPerSecond) : null;
            let streamBitrateBps = 0;
            let avgDecodeTimeMs = null;

            if (report.packetsLost !== undefined) {
              totalPacketsLost += report.packetsLost;
            }
            if (report.packetsReceived !== undefined) {
              totalPacketsReceived += report.packetsReceived;
            }

            const prev = this.streamStatsHistory.get(report.id);
            if (prev && report.timestamp > prev.timestamp) {
              const dt = (report.timestamp - prev.timestamp) / 1000;
              if (dt > 0.1) {
                const bytesDelta = (report.bytesReceived || 0) - prev.bytes;
                if (bytesDelta >= 0) {
                  streamBitrateBps = (bytesDelta * 8) / dt;
                  totalBitrateBps += streamBitrateBps;
                }

                const currentFrames = report.framesDecoded ?? report.framesReceived;
                if (currentFrames !== undefined && prev.frames !== undefined) {
                  const framesDelta = currentFrames - prev.frames;
                  if (framesDelta >= 0) {
                    const calcFps = Math.round(framesDelta / dt);
                    calculatedFpsList.push(calcFps);
                    if (!streamFps) streamFps = calcFps;

                    if (report.totalDecodeTime !== undefined && prev.totalDecodeTime !== undefined && framesDelta > 0) {
                      const decodeDelta = report.totalDecodeTime - prev.totalDecodeTime;
                      if (decodeDelta >= 0) {
                        avgDecodeTimeMs = Number(((decodeDelta / framesDelta) * 1000).toFixed(2));
                      }
                    }
                  }
                }
              }
            }

            let framesDelta = null;
            if (prev && prev.frames !== undefined && (report.framesDecoded ?? report.framesReceived) !== undefined) {
              framesDelta = (report.framesDecoded ?? report.framesReceived) - prev.frames;
            }

            const decoderImpl = report.decoderImplementation || null;
            const isPowerEfficient = Boolean(report.powerEfficientDecoder);
            const analysis = analyzeDecoderImplementation(decoderImpl, isPowerEfficient, {
              framesDecoded: report.framesDecoded ?? report.framesReceived ?? 0,
              bytesReceived: report.bytesReceived || 0,
              framesDelta
            });

            const streamBitrateMbps = (streamBitrateBps / 1000000).toFixed(2);
            const streamBitrateKbps = Math.round(streamBitrateBps / 1000);

            // FPS estritamente verificado sem valores fictícios
            let finalStreamFps = '--';
            if (streamFps !== null && streamFps !== undefined) {
              finalStreamFps = streamFps;
            } else if (report.framesDecoded === 0 || report.bytesReceived === 0 || framesDelta === 0) {
              finalStreamFps = 0;
            }

            const pktReceived = report.packetsReceived || 0;
            const pktLost = report.packetsLost || 0;
            const lossPercent = (pktReceived + pktLost > 0) ? ((pktLost / (pktReceived + pktLost)) * 100).toFixed(1) : '0.0';
            const jitterMs = report.jitter ? Math.round(report.jitter * 1000) : 0;
            const senderName = this.webrtc?.roomState?.participants?.get(userId)?.name || userId;

            inboundStreamsList.push({
              id: report.id,
              peerId: userId,
              senderName,
              streamType,
              codec: cName || 'DESCONHECIDO',
              sdpFmtpLine: codecDetail?.sdpFmtpLine || '--',
              decoderImplementation: decoderImpl || (isPowerEfficient ? 'Hardware D3D11' : 'Não informado'),
              powerEfficientDecoder: isPowerEfficient,
              hwState: analysis.state,
              isHardware: analysis.isHardware,
              isSoftware: analysis.isSoftware,
              isUnknown: analysis.isUnknown,
              hwCategory: analysis.category,
              hwLabel: analysis.label,
              hwBadgeClass: analysis.badgeClass,
              hwEvidence: analysis.evidence,
              rawImplementation: analysis.rawImplementation,
              width: report.frameWidth || width || '--',
              height: report.frameHeight || height || '--',
              fps: finalStreamFps,
              bitrateMbps: streamBitrateMbps,
              bitrateKbps: streamBitrateKbps,
              framesDecoded: report.framesDecoded || 0,
              framesDropped: report.framesDropped || 0,
              avgDecodeTimeMs: avgDecodeTimeMs !== null ? `${avgDecodeTimeMs} ms` : '--',
              packetsReceived: pktReceived,
              packetsLost: pktLost,
              packetLossPercent: lossPercent,
              jitterMs,
              jitter: report.jitter || 0
            });

            this.streamStatsHistory.set(report.id, {
              bytes: report.bytesReceived || 0,
              timestamp: report.timestamp,
              frames: report.framesDecoded ?? report.framesReceived,
              totalDecodeTime: report.totalDecodeTime || 0
            });
          }
        });
      }

      // Limpeza de streams antigos do histórico de cálculo de delta para evitar vazamento de memória
      for (const id of this.streamStatsHistory.keys()) {
        if (!seenReportIds.has(id)) {
          this.streamStatsHistory.delete(id);
        }
      }

      // AUTO-RECOVERY OBRIGATÓRIO ANTI-CPU:
      // Se algum stream de saída estiver ativo (framesEncoded > 20) e classificado como software_confirmed,
      // e o usuário não selecionou deliberadamente o modo CPU, aciona o WebRTCManager para migrar para GPU
      if (this.webrtc && this.webrtc.encoderPreference !== 'cpu' && typeof this.webrtc.handleSoftwareFallbackDetected === 'function') {
        for (const s of outboundStreamsList) {
          if (s.hwState === 'software_confirmed' && (s.framesEncoded > 20 || s.bytesSent > 50000)) {
            this.webrtc.handleSoftwareFallbackDetected(s.targetUserId, s.codec, s.sdpFmtpLine, s.rawImplementation);
          }
        }
      }

      // Fallback robusto para resolução
      if (!width || !height) {
        const localTrack = this.webrtc.mediaManager?.getScreenVideoTrack() || this.webrtc.mediaManager?.getCameraVideoTrack();
        if (localTrack && localTrack.readyState === 'live') {
          const s = localTrack.getSettings() || {};
          if (s.width && s.height) {
            width = s.width;
            height = s.height;
          }
        }
        if (!width || !height) {
          const domVideo = typeof document !== 'undefined' ? document.querySelector('.stream-tile video, .local-media-card video') : null;
          if (domVideo && domVideo.videoWidth && domVideo.videoHeight) {
            width = domVideo.videoWidth;
            height = domVideo.videoHeight;
          }
        }
      }

      // Fallback robusto para FPS
      let finalFps = '--';
      if (calculatedFpsList.length > 0) {
        const validFps = calculatedFpsList.filter(f => f > 0 && f <= 144);
        if (validFps.length > 0) {
          const avgFps = Math.round(validFps.reduce((a, b) => a + b, 0) / validFps.length);
          finalFps = avgFps;
        }
      }
      if (finalFps === '--') {
        const localTrack = this.webrtc.mediaManager?.getScreenVideoTrack();
        if (localTrack && localTrack.readyState === 'live') {
          const rate = localTrack.getSettings()?.frameRate;
          finalFps = rate ? Math.round(rate) : 60;
        }
      }

      // Média de RTT
      let finalRtt = '--';
      if (rttValues.length > 0) {
        const validRtts = rttValues.filter(r => r >= 0 && r < 5000);
        if (validRtts.length > 0) {
          finalRtt = Math.round(validRtts.reduce((a, b) => a + b, 0) / validRtts.length);
        }
      }

      // Cálculo de Perda de Pacotes
      let finalPacketLoss = '0.0';
      if (reportedFractionLostList.length > 0) {
        const maxLoss = Math.max(...reportedFractionLostList);
        finalPacketLoss = maxLoss.toFixed(1);
      } else if (totalPacketsReceived + totalPacketsLost > 0) {
        const lossRate = (totalPacketsLost / (totalPacketsReceived + totalPacketsLost)) * 100;
        finalPacketLoss = lossRate.toFixed(1);
      }

      // Formatação de Bitrate
      const bitrateMbps = totalBitrateBps > 0
        ? (totalBitrateBps / 1000000).toFixed(2)
        : '0.00';
      const bitrateKbps = Math.round(totalBitrateBps / 1000);

      // Identifica o codec efetivo e se a codificação/decodificação é por hardware ou software
      let formattedCodec = '--';
      if (outboundStreamsList.length > 0) {
        const uniqueCodecs = [...new Set(outboundStreamsList.map(s => s.codec).filter(Boolean))];
        const allHw = outboundStreamsList.every(s => s.hwState === 'hardware_confirmed' || s.isHardware);
        const allSw = outboundStreamsList.every(s => s.hwState === 'software_confirmed' || s.isSoftware);
        const anyHw = outboundStreamsList.some(s => s.hwState === 'hardware_confirmed' || s.isHardware);
        const anySw = outboundStreamsList.some(s => s.hwState === 'software_confirmed' || s.isSoftware);

        const codecBase = uniqueCodecs.join(' / ') || outboundStreamsList[0].codec || '--';
        if (allHw) {
          const raw = outboundStreamsList[0]?.rawImplementation || 'ExternalEncoder';
          formattedCodec = `${codecBase} (GPU: ${raw} ⚡)`;
        } else if (allSw) {
          const raw = outboundStreamsList[0]?.rawImplementation || 'OpenH264';
          formattedCodec = `${codecBase} (CPU: ${raw} ⚠️)`;
        } else if (anyHw && anySw) {
          formattedCodec = `${codecBase} (Misto GPU/CPU)`;
        } else if (anyHw) {
          const hwStream = outboundStreamsList.find(s => s.isHardware);
          const raw = hwStream?.rawImplementation || 'Hardware';
          formattedCodec = `${codecBase} (GPU: ${raw} ⚡)`;
        } else {
          // Estado 'unknown': NUNCA emitir alarme falso de software!
          formattedCodec = codecBase;
        }
      } else if (inboundStreamsList.length > 0) {
        const uniqueCodecs = [...new Set(inboundStreamsList.map(s => s.codec).filter(Boolean))];
        const allHw = inboundStreamsList.every(s => s.hwState === 'hardware_confirmed' || s.isHardware);
        const allSw = inboundStreamsList.every(s => s.hwState === 'software_confirmed' || s.isSoftware);
        const anyHw = inboundStreamsList.some(s => s.hwState === 'hardware_confirmed' || s.isHardware);
        const anySw = inboundStreamsList.some(s => s.hwState === 'software_confirmed' || s.isSoftware);

        const codecBase = uniqueCodecs.join(' / ') || inboundStreamsList[0].codec || '--';
        if (allHw) {
          formattedCodec = `${codecBase} (GPU ⚡)`;
        } else if (allSw) {
          formattedCodec = `${codecBase} (Software CPU ⚠️)`;
        } else if (anyHw && anySw) {
          formattedCodec = `${codecBase} (Misto GPU/CPU)`;
        } else if (anyHw) {
          formattedCodec = `${codecBase} (GPU ⚡)`;
        } else {
          formattedCodec = codecBase;
        }
      } else if (activeCodec) {
        formattedCodec = activeCodec;
      }

      let activeCount = 0;
      let bgCount = 0;
      let inactiveCount = 0;
      let totalSavingsSum = 0;

      outboundStreamsList.forEach(s => {
        if (s.viewerState === 'background') bgCount++;
        else if (s.viewerState === 'inactive') inactiveCount++;
        else activeCount++;
        totalSavingsSum += (s.estimatedSavingsPercent || 0);
      });

      const avgSavingsPercent = outboundStreamsList.length > 0
        ? Math.round(totalSavingsSum / outboundStreamsList.length)
        : 0;

      // Limpa espectadores que se desconectaram do mapa adaptativo
      if (this.webrtc?.peers) {
        for (const uid of this.peerAdaptiveStates.keys()) {
          if (!this.webrtc.peers.has(uid)) {
            this.peerAdaptiveStates.delete(uid);
          }
        }
      }

      // Atualiza snapshot de diagnóstico detalhado
      this.latestDiagnostics = {
        outbound: outboundStreamsList,
        outboundStreams: outboundStreamsList,
        inbound: inboundStreamsList,
        inboundStreams: inboundStreamsList,
        localCaptures: [],
        hasLocalStream: outboundStreamsList.length > 0,
        dominantConnectionType,
        rtt: finalRtt,
        packetLoss: finalPacketLoss,
        bitrateMbps,
        bitrateKbps,
        fps: finalFps,
        resolution: width && height ? `${width}x${height}` : '--',
        preferredCodec: this.webrtc?.getPreferredCodec ? this.webrtc.getPreferredCodec().toUpperCase() : 'AUTO',
        activeCodec: formattedCodec,
        activeViewersCount: activeCount,
        backgroundViewersCount: bgCount,
        inactiveViewersCount: inactiveCount,
        averageHostSavingsPercent: avgSavingsPercent,
        timestamp: Date.now()
      };

      const metrics = {
        fps: finalFps,
        resolution: width && height ? `${width}x${height}` : '--',
        rtt: finalRtt,
        bitrateMbps,
        packetLossPercent: finalPacketLoss,
        codec: formattedCodec,
        connectionType: dominantConnectionType,
        activeProfile: this.activeProfile,
        activeViewersCount: activeCount,
        backgroundViewersCount: bgCount,
        inactiveViewersCount: inactiveCount,
        averageHostSavingsPercent: avgSavingsPercent,
        diagnostics: this.latestDiagnostics
      };

      let dominantAvgEncodeTime = null;
      let dominantQualityLimitation = 'none';
      if (outboundStreamsList.length > 0) {
        dominantQualityLimitation = outboundStreamsList[0].qualityLimitationReason || 'none';
        const rawTime = parseFloat(outboundStreamsList[0].avgEncodeTimeMs);
        if (!isNaN(rawTime)) dominantAvgEncodeTime = rawTime;
      }

      // Dispara lógica adaptativa de bitrate em todas as conexões ativas com histerese
      this.evaluateAdaptation(
        activePcs.map(item => item.pc),
        typeof finalRtt === 'number' ? finalRtt : null,
        parseFloat(finalPacketLoss),
        dominantAvgEncodeTime,
        dominantQualityLimitation
      );

      if (this.onStatsUpdate) {
        this.onStatsUpdate(metrics);
      }
    } catch (err) {
      console.warn('[QualityController] Erro ao coletar stats multi-peer:', err);
    }
  }

  /**
   * Avalia a saúde da conexão e do encoder, aplicando histerese para evitar oscilações rápidas
   */
  async evaluateAdaptation(pcs, rtt, packetLoss, avgEncodeTime = null, qualityLimitation = 'none') {
    if (!pcs || pcs.length === 0) return;

    const now = Date.now();
    const profile = QUALITY_PROFILES[this.activeProfile] || QUALITY_PROFILES.ultra;
    let needsUpdate = false;
    let direction = 'none';

    // Condição A: Degradação de rede ou saturação de CPU do encoder
    const isNetworkDegraded = (packetLoss > 3.0 || (rtt && rtt > 200));
    const isCpuThrottled = (qualityLimitation === 'cpu' || (avgEncodeTime !== null && avgEncodeTime > 25));

    if ((isNetworkDegraded || isCpuThrottled) && this.currentMaxBitrate > profile.minBitrate) {
      if (now - this.lastAdaptationTimestamp >= this.hysteresisDownCooldownMs) {
        const factor = isCpuThrottled ? 0.75 : 0.85;
        this.currentMaxBitrate = Math.max(profile.minBitrate, Math.round(this.currentMaxBitrate * factor));
        this.currentMaxFps = Math.min(this.currentMaxFps, isCpuThrottled ? 30 : 45);
        needsUpdate = true;
        direction = 'down';
        console.warn(`[QualityController] Degradação detectada (${isCpuThrottled ? 'Sobrecarga de CPU/Encoder' : 'Rede'}). Reduzindo bitrate para ${(this.currentMaxBitrate / 1000000).toFixed(1)} Mbps.`);
      }
    }
    // Condição B: Estabilidade sustentada (baixo loss, RTT estável e tempo de encode saudável)
    else if (packetLoss < 0.5 && (!rtt || rtt < 70) && (!avgEncodeTime || avgEncodeTime < 14) && this.currentMaxBitrate < profile.maxBitrate) {
      if (now - this.lastAdaptationTimestamp >= this.hysteresisUpCooldownMs) {
        this.currentMaxBitrate = Math.min(profile.maxBitrate, Math.round(this.currentMaxBitrate * 1.15));
        this.currentMaxFps = profile.maxFps;
        needsUpdate = true;
        direction = 'up';
        console.log(`[QualityController] Rede e CPU estabilizados. Recuperando bitrate para ${(this.currentMaxBitrate / 1000000).toFixed(1)} Mbps.`);
      }
    }

    if (needsUpdate) {
      this.lastAdaptationTimestamp = now;
      this.lastAdaptationDirection = direction;
      await this.applyProfileToPeers();
      console.log(`[QualityController] Parâmetros adaptados em ${pcs.length} conexões: Bitrate=${(this.currentMaxBitrate / 1000000).toFixed(1)}Mbps, MaxFPS=${this.currentMaxFps}`);
    }
  }
}
