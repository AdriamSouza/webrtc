/**
 * Sistema de Controle Adaptativo de Qualidade (Quality Controller)
 * Coleta métricas via getStats() em malha P2P multi-usuário e ajusta dinamicamente
 * bitrate, resolução e FPS para garantir transmissão estável de até 60 FPS.
 */

import { classifyCodecImplementation } from './hardwareDetector.js';

export { classifyCodecImplementation };

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
 * corresponde a aceleração por GPU.
 */
export function isHardwareCodecImplementation(implName) {
  return classifyCodecImplementation(implName, true).isHardware;
}

/**
 * Classifica o encoder em uso segundo a regra simples (Etapa 2.2):
 * - GPU: MediaFoundation, ExternalEncoder, NVENC, AMF, QSV, VideoToolbox, VAAPI
 * - CPU: OpenH264, libaom, libvpx, SW, software
 * - Qualquer outro: texto cru, sem rótulo
 * - Sem tráfego: "aguardando movimento"
 */
export function analyzeEncoderImplementation(implName, codecOrContext = {}, maybeContext = null) {
  const activityInfo = (typeof maybeContext === 'object' && maybeContext !== null)
    ? maybeContext
    : ((typeof codecOrContext === 'object' && codecOrContext !== null) ? codecOrContext : {});

  const {
    framesEncoded = null,
    bytesSent = null,
    framesDelta = null,
    qualityLimitationReason = 'none'
  } = activityInfo;

  const isInactive = (framesEncoded === 0 && bytesSent === 0) || (framesDelta === 0 && bytesSent === 0);
  const classified = classifyCodecImplementation(implName, !isInactive);
  return {
    ...classified,
    qualityLimitationReason
  };
}

/**
 * Classifica o decoder em uso segundo a mesma regra simples (Etapa 2.2).
 */
export function analyzeDecoderImplementation(implName, activityOrPower = {}, maybeContext = null) {
  const activityInfo = (typeof maybeContext === 'object' && maybeContext !== null)
    ? maybeContext
    : ((typeof activityOrPower === 'object' && activityOrPower !== null) ? activityOrPower : {});

  const {
    framesDecoded = null,
    bytesReceived = null,
    framesDelta = null
  } = activityInfo;

  const isInactive = (framesDecoded === 0 && bytesReceived === 0) || (framesDelta === 0 && bytesReceived === 0);
  return classifyCodecImplementation(implName, !isInactive);
}

export class QualityController {
  constructor() {
    this.intervalId = null;
    this.pollIntervalMs = 1500;
    this.onStatsUpdate = null;
    this.webrtc = null;

    this.streamStatsHistory = new Map();
    this.latestDiagnostics = null;
    this.peerAdaptiveStates = new Map();

    const saved = (() => {
      try { return localStorage.getItem('hyperstream_active_profile') || 'ultra'; } catch (_) { return 'ultra'; }
    })();
    const profile = QUALITY_PROFILES[saved] || QUALITY_PROFILES.ultra;

    this.activeProfile = profile.id;
    this.currentMaxBitrate = profile.maxBitrate;
    this.currentMaxFps = profile.maxFps;

    this.lastAdaptationTimestamp = 0;
    this.lastAdaptationDirection = 'none';
    this.hysteresisDownCooldownMs = 4000;
    this.hysteresisUpCooldownMs = 8000;

    this._isCollecting = false;
    this._peerLocks = new Map();
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

    this.stop();
    this.applyProfileToPeers();

    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isCollecting = false;
    this.streamStatsHistory.clear();
    this.peerAdaptiveStates.clear();
    this._peerLocks.clear();
  }

  /**
   * Retorna os parâmetros de codificação para o estado de visibilidade do espectador
   * @param {string} state - 'active' | 'background' | 'inactive'
   */
  getEncodingParametersForState(state = 'active') {
    const profile = QUALITY_PROFILES[this.activeProfile] || QUALITY_PROFILES.ultra;
    const baseMaxBitrate = this.currentMaxBitrate || profile.maxBitrate;
    const baseMaxFps = this.currentMaxFps || profile.maxFps;

    switch (state) {
      case 'background': {
        const maxFramerate = Math.min(15, Math.max(10, Math.round(baseMaxFps * 0.25)));
        const scaleResolutionDownBy = 2.0;
        const maxBitrate = Math.min(1200000, Math.max(400000, Math.round(baseMaxBitrate * 0.20)));
        return {
          state: 'background',
          maxFramerate,
          scaleResolutionDownBy,
          maxBitrate,
          priority: 'low',
          networkPriority: 'low',
          label: 'Segundo Plano (15 FPS @ 540p)',
          badgeClass: 'diag-badge-warn'
        };
      }
      case 'inactive': {
        const maxFramerate = Math.min(5, Math.max(1, Math.round(baseMaxFps * 0.10)));
        const scaleResolutionDownBy = 4.0;
        const maxBitrate = Math.min(300000, Math.max(150000, Math.round(baseMaxBitrate * 0.05)));
        return {
          state: 'inactive',
          maxFramerate,
          scaleResolutionDownBy,
          maxBitrate,
          priority: 'very-low',
          networkPriority: 'low',
          label: 'Inativo (5 FPS @ 270p)',
          badgeClass: 'diag-badge-neutral'
        };
      }
      case 'active':
      default: {
        return {
          state: 'active',
          maxFramerate: baseMaxFps,
          scaleResolutionDownBy: 1.0,
          maxBitrate: baseMaxBitrate,
          priority: 'high',
          networkPriority: 'high',
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
    if (!targetId) return;

    const run = async () => {
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
          requested: null,
          applied: null,
          observed: null,
          lastError: null
        };
        this.peerAdaptiveStates.set(targetId, peerEntry);
      }

      const config = overrideConfig || this.getEncodingParametersForState(peerEntry.viewerState);
      peerEntry.currentMaxFps = config.maxFramerate;
      peerEntry.currentMaxBitrate = config.maxBitrate;
      peerEntry.currentScaleDown = config.scaleResolutionDownBy;

      peerEntry.requested = {
        state: peerEntry.viewerState,
        maxFramerate: config.maxFramerate,
        scaleResolutionDownBy: config.scaleResolutionDownBy,
        maxBitrate: config.maxBitrate,
        label: config.label,
        timestamp: Date.now()
      };

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

          try {
            const verified = sender.getParameters();
            const enc = verified?.encodings?.[0] || {};
            peerEntry.applied = {
              maxBitrate: enc.maxBitrate ?? config.maxBitrate,
              maxFramerate: enc.maxFramerate ?? config.maxFramerate,
              scaleResolutionDownBy: enc.scaleResolutionDownBy ?? config.scaleResolutionDownBy,
              degradationPreference: verified?.degradationPreference || 'maintain-framerate',
              timestamp: Date.now()
            };
            peerEntry.lastError = null;
          } catch (_) {
            peerEntry.applied = {
              maxBitrate: config.maxBitrate,
              maxFramerate: config.maxFramerate,
              scaleResolutionDownBy: config.scaleResolutionDownBy,
              timestamp: Date.now()
            };
          }
        } catch (err) {
          peerEntry.lastError = err.message;
        }
      }
    };

    const prevPromise = this._peerLocks.get(targetId) || Promise.resolve();
    const nextPromise = prevPromise.then(run, run);
    this._peerLocks.set(targetId, nextPromise);
    try {
      await nextPromise;
    } finally {
      if (this._peerLocks.get(targetId) === nextPromise) {
        this._peerLocks.delete(targetId);
      }
    }
  }

  /**
   * Atualiza o estado de um espectador e reconfigura seu sender
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
        requested: null,
        applied: null,
        observed: null,
        lastError: null
      };
      this.peerAdaptiveStates.set(userId, peerEntry);
    }

    const previousState = peerEntry.viewerState;
    peerEntry.viewerState = validState;
    if (previousState !== validState) {
      peerEntry.lastStateChange = Date.now();
    }

    const config = this.getEncodingParametersForState(validState);
    await this.applyEncodingParametersToSender(userId, config);
    return peerEntry;
  }

  removePeer(userId) {
    if (userId) {
      this.peerAdaptiveStates.delete(userId);
      this._peerLocks.delete(userId);
    }
  }

  removePeerState(userId) {
    this.removePeer(userId);
  }

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

    await this.applyProfileToPeers();
  }

  async setCustomProfile(maxBitrateMbps, maxFps) {
    const bps = Math.max(500000, Math.min(35000000, Math.round(maxBitrateMbps * 1000000)));
    const fps = Number(maxFps) === 30 ? 30 : 60;

    QUALITY_PROFILES.custom.maxBitrate = bps;
    QUALITY_PROFILES.custom.minBitrate = Math.max(500000, Math.round(bps * 0.35));
    QUALITY_PROFILES.custom.maxFps = fps;

    await this.setProfile('custom');
  }

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

  async applyProfileToPeers() {
    if (!this.webrtc || !this.webrtc.peers) return;

    for (const [userId, pc] of this.webrtc.peers.entries()) {
      if (!pc || pc.connectionState === 'closed') continue;
      await this.applyEncodingParametersToSender(userId);
    }
  }

  async collectMetrics() {
    if (!this.webrtc || this._isCollecting) return;
    this._isCollecting = true;

    try {
      const activePcs = [];
      for (const [userId, pc] of this.webrtc.peers.entries()) {
        if (pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')) {
          activePcs.push({ userId, pc });
        }
      }

      if (activePcs.length === 0) {
        let width = null;
        let height = null;
        let fps = null;
        const localCaptures = [];

        const screenTrack = this.webrtc.mediaManager?.getScreenVideoTrack();
        const cameraTrack = this.webrtc.mediaManager?.getCameraVideoTrack();

        if (screenTrack && screenTrack.readyState === 'live') {
          const s = screenTrack.getSettings() || {};
          const w = s.width || 1920;
          const h = s.height || 1080;
          const f = s.frameRate ? Math.round(s.frameRate) : 60;
          localCaptures.push({
            type: 'screen',
            label: 'Tela / Desktop',
            width: w,
            height: h,
            fps: f,
            status: 'Captura ativa no transmissor'
          });
          width = w; height = h; fps = f;
        }

        if (cameraTrack && cameraTrack.readyState === 'live') {
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
          activeEncoderInfo: null,
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

      const rttValues = [];
      let totalPacketsLost = 0;
      let totalPacketsReceived = 0;
      const reportedFractionLostList = [];
      const calculatedFpsList = [];
      let width = null;
      let height = null;
      let totalBitrateBps = 0;
      let activeCodec = null;
      let dominantEncoderInfo = null;
      let dominantConnectionType = 'P2P Conectado';

      const seenReportIds = new Set();
      const outboundStreamsList = [];
      const inboundStreamsList = [];

      for (const { userId, pc } of activePcs) {
        let stats;
        try {
          stats = await pc.getStats();
        } catch (_) {
          continue;
        }

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

        const mediaMids = this.webrtc?.getMediaMids ? this.webrtc.getMediaMids(userId) : {};
        const localMedia = this.webrtc?.mediaManager;
        const screenTrack = localMedia?.getScreenVideoTrack();
        const cameraTrack = localMedia?.getCameraVideoTrack();
        const targetPeerName = this.webrtc?.roomState?.participants?.get(userId)?.name || userId;

        stats.forEach(report => {
          // A. VÍDEO DE SAÍDA
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

            const encoderImpl = report.encoderImplementation || null;
            const encoderInfo = analyzeEncoderImplementation(encoderImpl, {
              framesEncoded: report.framesEncoded ?? report.framesSent ?? 0,
              bytesSent: report.bytesSent || 0,
              framesDelta,
              qualityLimitationReason: report.qualityLimitationReason || 'none'
            });

            if (!dominantEncoderInfo || encoderInfo.type !== 'idle') {
              dominantEncoderInfo = encoderInfo;
            }

            const streamWidth = report.frameWidth || (streamType === 'Tela / Desktop' ? screenTrack?.getSettings()?.width : cameraTrack?.getSettings()?.width) || width || '--';
            const streamHeight = report.frameHeight || (streamType === 'Tela / Desktop' ? screenTrack?.getSettings()?.height : cameraTrack?.getSettings()?.height) || height || '--';

            let finalStreamFps = '--';
            if (streamFps !== null && streamFps !== undefined) {
              finalStreamFps = streamFps;
            } else if (report.framesEncoded === 0 || report.bytesSent === 0 || framesDelta === 0) {
              finalStreamFps = 0;
            }

            const streamBitrateMbps = (streamBitrateBps / 1000000).toFixed(2);
            const streamBitrateKbps = Math.round(streamBitrateBps / 1000);

            let peerEntry = this.peerAdaptiveStates.get(userId);
            if (!peerEntry) {
              peerEntry = {
                userId,
                viewerState: 'active',
                lastStateChange: Date.now(),
                currentMaxFps: this.currentMaxFps,
                currentMaxBitrate: this.currentMaxBitrate,
                currentScaleDown: 1.0,
                requested: null,
                applied: null,
                observed: null,
                lastError: null
              };
              this.peerAdaptiveStates.set(userId, peerEntry);
            }
            const viewerConfig = this.getEncodingParametersForState(peerEntry.viewerState);

            if (!peerEntry.requested) {
              peerEntry.requested = {
                state: peerEntry.viewerState,
                maxFramerate: viewerConfig.maxFramerate,
                scaleResolutionDownBy: viewerConfig.scaleResolutionDownBy,
                maxBitrate: viewerConfig.maxBitrate,
                label: viewerConfig.label,
                timestamp: Date.now()
              };
            }

            const videoSenders = (typeof pc.getSenders === 'function')
              ? pc.getSenders().filter(s => s.track && s.track.kind === 'video')
              : [];
            let senderNeedsReapply = false;
            for (const vs of videoSenders) {
              try {
                const curParams = vs.getParameters();
                const enc = curParams?.encodings?.[0];
                if (enc) {
                  peerEntry.applied = {
                    maxBitrate: enc.maxBitrate ?? null,
                    maxFramerate: enc.maxFramerate ?? null,
                    scaleResolutionDownBy: enc.scaleResolutionDownBy ?? 1.0,
                    degradationPreference: curParams.degradationPreference || 'maintain-framerate',
                    timestamp: Date.now()
                  };
                  if (
                    !enc.maxBitrate ||
                    !enc.maxFramerate ||
                    (peerEntry.viewerState === 'active' && (enc.maxBitrate < viewerConfig.maxBitrate || enc.maxFramerate < viewerConfig.maxFramerate))
                  ) {
                    senderNeedsReapply = true;
                  }
                } else {
                  senderNeedsReapply = true;
                }
              } catch (_) {
                senderNeedsReapply = true;
              }
            }

            if (senderNeedsReapply && videoSenders.length > 0 && !this._peerLocks.has(userId)) {
              this.applyEncodingParametersToSender(userId, viewerConfig).catch(() => {});
            }

            peerEntry.observed = {
              width: streamWidth,
              height: streamHeight,
              fps: finalStreamFps,
              bitrateMbps: streamBitrateMbps,
              bitrateKbps: streamBitrateKbps,
              avgEncodeTimeMs: avgEncodeTimeMs !== null ? `${avgEncodeTimeMs} ms` : '--',
              qualityLimitationReason: report.qualityLimitationReason || 'none',
              timestamp: Date.now()
            };

            const limitReason = report.qualityLimitationReason || 'none';
            const limitLabels = {
              none: 'Nenhuma',
              cpu: 'CPU',
              bandwidth: 'Banda',
              other: 'Outra'
            };

            outboundStreamsList.push({
              id: report.id,
              targetPeerId: userId,
              targetUserId: userId,
              targetPeerName,
              streamType,
              codec: cName || (this.webrtc?.getPreferredCodec ? this.webrtc.getPreferredCodec().toUpperCase() : 'AV1'),
              sdpFmtpLine: codecDetail?.sdpFmtpLine || '--',
              encoderImplementation: encoderImpl || 'Não informado',
              encoderInfo,
              isHardware: encoderInfo.isHardware,
              isSoftware: encoderInfo.isSoftware,
              hwBadgeClass: encoderInfo.badgeClass,
              rawImplementation: encoderInfo.raw,
              qualityLimitationReason: limitReason,
              qualityLimitation: limitLabels[limitReason] || limitReason,
              width: streamWidth,
              height: streamHeight,
              fps: finalStreamFps,
              resolutionAndFps: (streamWidth !== '--' && streamHeight !== '--')
                ? `${streamWidth}x${streamHeight} @ ${finalStreamFps !== '--' ? finalStreamFps : 0} fps`
                : '—',
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
              requested: peerEntry.requested || {
                state: peerEntry.viewerState,
                maxFramerate: viewerConfig.maxFramerate,
                scaleResolutionDownBy: viewerConfig.scaleResolutionDownBy,
                maxBitrate: viewerConfig.maxBitrate,
                label: viewerConfig.label
              },
              applied: peerEntry.applied || null,
              observed: peerEntry.observed,
              adaptationError: peerEntry.lastError || null
            });

            this.streamStatsHistory.set(report.id, {
              bytes: report.bytesSent || 0,
              timestamp: report.timestamp,
              frames: report.framesSent ?? report.framesEncoded,
              totalEncodeTime: report.totalEncodeTime || 0
            });
          }

          // B. FONTE DE MÍDIA LOCAL
          if (report.type === 'media-source' && (report.kind === 'video' || report.mediaType === 'video')) {
            if (!width && report.width) {
              width = report.width;
              height = report.height;
            }
            if (report.framesPerSecond) {
              calculatedFpsList.push(Math.round(report.framesPerSecond));
            }
          }

          // C. FEEDBACK RTCP DO RECEPTOR
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

          // D. VÍDEO DE ENTRADA
          if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            seenReportIds.add(report.id);

            const codecDetail = report.codecId ? codecDetailsMap.get(report.codecId) : (report.payloadType !== undefined ? codecByPayloadMap.get(report.payloadType) : null);
            let cName = codecDetail ? codecDetail.mime : (report.codecId ? codecMap.get(report.codecId) : null);
            if (cName === 'AV01') cName = 'AV1';
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
            const decoderInfo = analyzeDecoderImplementation(decoderImpl, {
              framesDecoded: report.framesDecoded ?? report.framesReceived ?? 0,
              bytesReceived: report.bytesReceived || 0,
              framesDelta
            });

            const streamBitrateMbps = (streamBitrateBps / 1000000).toFixed(2);
            const streamBitrateKbps = Math.round(streamBitrateBps / 1000);

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
            const streamWidth = report.frameWidth || width || '--';
            const streamHeight = report.frameHeight || height || '--';

            inboundStreamsList.push({
              id: report.id,
              peerId: userId,
              sourcePeerId: userId,
              senderPeerId: userId,
              sourcePeerName: senderName,
              senderName,
              streamType,
              codec: cName || 'DESCONHECIDO',
              sdpFmtpLine: codecDetail?.sdpFmtpLine || '--',
              decoderImplementation: decoderImpl || 'Não informado',
              decoderInfo,
              isHardware: decoderInfo.isHardware,
              isSoftware: decoderInfo.isSoftware,
              hwBadgeClass: decoderInfo.badgeClass,
              rawImplementation: decoderInfo.raw,
              width: streamWidth,
              height: streamHeight,
              fps: finalStreamFps,
              resolutionAndFps: (streamWidth !== '--' && streamHeight !== '--')
                ? `${streamWidth}x${streamHeight} @ ${finalStreamFps !== '--' ? finalStreamFps : 0} fps`
                : '—',
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

      for (const id of this.streamStatsHistory.keys()) {
        if (!seenReportIds.has(id)) {
          this.streamStatsHistory.delete(id);
        }
      }

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

      let finalRtt = '--';
      if (rttValues.length > 0) {
        const validRtts = rttValues.filter(r => r >= 0 && r < 5000);
        if (validRtts.length > 0) {
          finalRtt = Math.round(validRtts.reduce((a, b) => a + b, 0) / validRtts.length);
        }
      }

      let finalPacketLoss = '0.0';
      if (reportedFractionLostList.length > 0) {
        const maxLoss = Math.max(...reportedFractionLostList);
        finalPacketLoss = maxLoss.toFixed(1);
      } else if (totalPacketsReceived + totalPacketsLost > 0) {
        const lossRate = (totalPacketsLost / (totalPacketsReceived + totalPacketsLost)) * 100;
        finalPacketLoss = lossRate.toFixed(1);
      }

      const bitrateMbps = totalBitrateBps > 0
        ? (totalBitrateBps / 1000000).toFixed(2)
        : '0.00';
      const bitrateKbps = Math.round(totalBitrateBps / 1000);

      let formattedCodec = '--';
      if (outboundStreamsList.length > 0) {
        const uniqueCodecs = [...new Set(outboundStreamsList.map(s => s.codec).filter(Boolean))];
        const allHw = outboundStreamsList.every(s => s.isHardware);
        const allSw = outboundStreamsList.every(s => s.isSoftware);
        const anyHw = outboundStreamsList.some(s => s.isHardware);
        const anySw = outboundStreamsList.some(s => s.isSoftware);

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
          formattedCodec = codecBase;
        }
      } else if (inboundStreamsList.length > 0) {
        const uniqueCodecs = [...new Set(inboundStreamsList.map(s => s.codec).filter(Boolean))];
        const allHw = inboundStreamsList.every(s => s.isHardware);
        const allSw = inboundStreamsList.every(s => s.isSoftware);
        const anyHw = inboundStreamsList.some(s => s.isHardware);
        const anySw = inboundStreamsList.some(s => s.isSoftware);

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

      outboundStreamsList.forEach(s => {
        if (s.viewerState === 'background') bgCount++;
        else if (s.viewerState === 'inactive') inactiveCount++;
        else activeCount++;
      });

      if (this.webrtc?.peers) {
        for (const uid of this.peerAdaptiveStates.keys()) {
          if (!this.webrtc.peers.has(uid)) {
            this.peerAdaptiveStates.delete(uid);
            this._peerLocks.delete(uid);
          }
        }
      }

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
        activeEncoderInfo: dominantEncoderInfo,
        activeViewersCount: activeCount,
        backgroundViewersCount: bgCount,
        inactiveViewersCount: inactiveCount,
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
        diagnostics: this.latestDiagnostics
      };

      let dominantAvgEncodeTime = null;
      let dominantQualityLimitation = 'none';
      if (outboundStreamsList.length > 0) {
        dominantQualityLimitation = outboundStreamsList[0].qualityLimitationReason || 'none';
        const rawTime = parseFloat(outboundStreamsList[0].avgEncodeTimeMs);
        if (!isNaN(rawTime)) dominantAvgEncodeTime = rawTime;
      }

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
    } finally {
      this._isCollecting = false;
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

    const isNetworkDegraded = (packetLoss > 3.0 || (rtt && rtt > 200));
    const isCpuThrottled = (qualityLimitation === 'cpu' || (avgEncodeTime !== null && avgEncodeTime > 25));

    if ((isNetworkDegraded || isCpuThrottled) && this.currentMaxBitrate > profile.minBitrate) {
      if (now - this.lastAdaptationTimestamp >= this.hysteresisDownCooldownMs) {
        const factor = isCpuThrottled ? 0.75 : 0.85;
        this.currentMaxBitrate = Math.max(profile.minBitrate, Math.round(this.currentMaxBitrate * factor));
        this.currentMaxFps = Math.min(this.currentMaxFps, isCpuThrottled ? 30 : 45);
        needsUpdate = true;
        direction = 'down';
      }
    } else if (packetLoss < 0.5 && (!rtt || rtt < 70) && (!avgEncodeTime || avgEncodeTime < 14) && this.currentMaxBitrate < profile.maxBitrate) {
      if (now - this.lastAdaptationTimestamp >= this.hysteresisUpCooldownMs) {
        this.currentMaxBitrate = Math.min(profile.maxBitrate, Math.round(this.currentMaxBitrate * 1.15));
        this.currentMaxFps = profile.maxFps;
        needsUpdate = true;
        direction = 'up';
      }
    }

    if (needsUpdate) {
      this.lastAdaptationTimestamp = now;
      this.lastAdaptationDirection = direction;
      await this.applyProfileToPeers();
    }
  }
}
