/**
 * Sistema de Controle Adaptativo de Qualidade (Quality Controller)
 * Documentação Arquitetural: Seção 8 e Seção 16
 *
 * Coleta métricas via getStats() e ajusta dinamicamente bitrate, resolução e FPS
 * para garantir transmissão estável de até 60 FPS.
 */

export const QUALITY_PROFILES = {
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
    maxBitrate: 3500000,
    minBitrate: 1500000,
    maxFps: 60,
    description: '60 FPS com até 3.5 Mbps (Ideal para jogar pela internet com amigos)'
  },
  eco: {
    id: 'eco',
    label: 'Econômico (30 FPS)',
    maxBitrate: 1800000,
    minBitrate: 800000,
    maxFps: 30,
    description: '30 FPS com até 1.8 Mbps (Ideal para conexões instáveis ou 4G)'
  }
};

export class QualityController {
  constructor() {
    this.intervalId = null;
    this.pollIntervalMs = 2000; // Coleta de métricas a cada 2 segundos
    this.onStatsUpdate = null;
    this.webrtc = null;

    // Histórico para cálculo de deltas
    this.prevBytesSent = 0;
    this.prevBytesReceived = 0;
    this.prevTimestamp = 0;

    // Perfil ativo e limites de adaptação
    this.activeProfile = 'ultra';
    this.currentMaxBitrate = QUALITY_PROFILES.ultra.maxBitrate;
    this.currentMaxFps = QUALITY_PROFILES.ultra.maxFps;
  }

  start(webrtcManager, callback) {
    this.webrtc = webrtcManager;
    this.onStatsUpdate = callback;

    this.stop(); // Garante que nenhum timer anterior continue rodando

    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, this.pollIntervalMs);

    console.log('[QualityController] Monitoramento adaptativo de 60 FPS ativado.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Altera manualmente o perfil de qualidade (Ultra, Equilibrado, Econômico)
   * Aplicado imediatamente em todos os senders de vídeo ativos
   */
  async setProfile(profileKey) {
    const profile = QUALITY_PROFILES[profileKey];
    if (!profile) return;

    this.activeProfile = profileKey;
    this.currentMaxBitrate = profile.maxBitrate;
    this.currentMaxFps = profile.maxFps;

    console.log(`[QualityController] Perfil alterado para: ${profile.label} (Max: ${(profile.maxBitrate / 1000000).toFixed(1)} Mbps, FPS: ${profile.maxFps})`);

    if (this.webrtc && this.webrtc.peers) {
      for (const [targetId, pc] of this.webrtc.peers.entries()) {
        const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
        for (const sender of senders) {
          try {
            const params = sender.getParameters();
            if (params.encodings && params.encodings.length > 0) {
              params.encodings[0].maxBitrate = this.currentMaxBitrate;
              params.encodings[0].maxFramerate = this.currentMaxFps;
              await sender.setParameters(params);
            }
          } catch (err) {
            console.warn(`[QualityController] Erro ao aplicar perfil no peer ${targetId}:`, err);
          }
        }
      }
    }
  }

  async collectMetrics() {
    if (!this.webrtc || this.webrtc.peers.size === 0) {
      return;
    }

    // Analisa a primeira conexão ativa (ou computa média se houver múltiplos)
    const pc = this.webrtc.peers.values().next().value;
    if (!pc || pc.connectionState !== 'connected') {
      return;
    }

    try {
      const stats = await pc.getStats();
      let rtt = null;
      let packetsLost = 0;
      let totalPackets = 0;
      let fps = null;
      let width = null;
      let height = null;
      let currentBitrateBps = 0;
      let activeCodec = 'H.264 / AV1';

      let candidatePair = null;
      const candidateReports = new Map();

      stats.forEach(report => {
        // Mapeia candidatos e o par ativo selecionado
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
          candidatePair = report;
          if (report.currentRoundTripTime !== undefined) {
            rtt = Math.round(report.currentRoundTripTime * 1000); // ms
          }
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidateReports.set(report.id, report);
        }

        // Métricas de vídeo de saída (Host transmissor)
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          fps = report.framesPerSecond || fps;

          if (this.prevTimestamp && report.bytesSent !== undefined) {
            const timeDelta = (report.timestamp - this.prevTimestamp) / 1000;
            const bytesDelta = report.bytesSent - this.prevBytesSent;
            currentBitrateBps = (bytesDelta * 8) / timeDelta;
          }

          this.prevBytesSent = report.bytesSent || 0;
          this.prevTimestamp = report.timestamp;
        }

        // Métricas de vídeo de entrada (Viewer espectador)
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          fps = report.framesPerSecond || fps;
          packetsLost = report.packetsLost || 0;
          totalPackets = (report.packetsReceived || 0) + packetsLost;

          if (this.prevTimestamp && report.bytesReceived !== undefined) {
            const timeDelta = (report.timestamp - this.prevTimestamp) / 1000;
            const bytesDelta = report.bytesReceived - this.prevBytesReceived;
            currentBitrateBps = (bytesDelta * 8) / timeDelta;
          }

          this.prevBytesReceived = report.bytesReceived || 0;
          this.prevTimestamp = report.timestamp;
        }

        // Resolução atual do quadro
        if (report.type === 'track' && report.kind === 'video') {
          if (report.frameWidth && report.frameHeight) {
            width = report.frameWidth;
            height = report.frameHeight;
          }
        }

        // Identificação de Codec
        if (report.type === 'codec') {
          if (report.mimeType) {
            activeCodec = report.mimeType.replace('video/', '');
          }
        }
      });

      // Identifica o Tipo de Conexão (LAN vs P2P STUN vs TURN Relay)
      let connectionType = 'P2P Conectado';
      if (candidatePair) {
        const localCandidate = candidateReports.get(candidatePair.localCandidateId);
        const remoteCandidate = candidateReports.get(candidatePair.remoteCandidateId);

        const localType = localCandidate?.candidateType;
        const remoteType = remoteCandidate?.candidateType;
        const proto = (localCandidate?.protocol || candidatePair?.protocol || 'udp').toUpperCase();

        if (localType === 'relay' || remoteType === 'relay') {
          connectionType = `Relay (TURN/${proto})`;
        } else if (localType === 'srflx' || remoteType === 'srflx' || localType === 'prflx' || remoteType === 'prflx') {
          connectionType = `P2P Direto (STUN/${proto})`;
        } else if (localType === 'host' && remoteType === 'host') {
          connectionType = `Direto LAN (${proto})`;
        } else if (localType) {
          connectionType = `${localType.toUpperCase()} (${proto})`;
        }
      }

      // Cálculo da porcentagem de perda de pacotes
      const packetLossPercent = totalPackets > 0
        ? ((packetsLost / totalPackets) * 100).toFixed(1)
        : '0.0';

      const bitrateMbps = (currentBitrateBps / 1000000).toFixed(2);

      const metrics = {
        fps: fps !== null ? Math.round(fps) : '--',
        resolution: width && height ? `${width}x${height}` : '--',
        rtt: rtt !== null ? rtt : '--',
        bitrateMbps: currentBitrateBps > 0 ? bitrateMbps : '--',
        packetLossPercent,
        codec: activeCodec,
        connectionType,
        activeProfile: this.activeProfile
      };

      // Dispara lógica adaptativa de bitrate se detectada instabilidade
      this.evaluateAdaptation(pc, rtt, parseFloat(packetLossPercent));

      if (this.onStatsUpdate) {
        this.onStatsUpdate(metrics);
      }
    } catch (err) {
      console.warn('[QualityController] Erro ao coletar stats:', err);
    }
  }

  /**
   * Avalia a saúde da conexão e ajusta dinamicamente a taxa de envio dentro dos limites do perfil
   */
  async evaluateAdaptation(pc, rtt, packetLoss) {
    const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
    if (senders.length === 0) return;

    const sender = senders[0];
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;

    const profile = QUALITY_PROFILES[this.activeProfile] || QUALITY_PROFILES.ultra;
    let needsUpdate = false;

    // Regra 1: Perda de pacotes elevada (> 3%) ou RTT crítico (> 200ms)
    if ((packetLoss > 3.0 || (rtt && rtt > 200)) && this.currentMaxBitrate > profile.minBitrate) {
      console.warn('[QualityController] Degradação de rede detectada. Reduzindo bitrate...');
      this.currentMaxBitrate = Math.max(profile.minBitrate, this.currentMaxBitrate * 0.75); // Reduz 25%
      this.currentMaxFps = Math.min(this.currentMaxFps, 45);
      needsUpdate = true;
    }
    // Regra 2: Rede excelente e estável (< 0.5% loss e RTT < 60ms)
    else if (packetLoss < 0.5 && rtt && rtt < 60 && this.currentMaxBitrate < profile.maxBitrate) {
      this.currentMaxBitrate = Math.min(profile.maxBitrate, this.currentMaxBitrate * 1.15); // Aumenta 15%
      this.currentMaxFps = profile.maxFps;
      needsUpdate = true;
    }

    if (needsUpdate) {
      params.encodings[0].maxBitrate = this.currentMaxBitrate;
      params.encodings[0].maxFramerate = this.currentMaxFps;
      try {
        await sender.setParameters(params);
        console.log(`[QualityController] Parâmetros adaptados: Bitrate=${(this.currentMaxBitrate / 1000000).toFixed(1)}Mbps, MaxFPS=${this.currentMaxFps}`);
      } catch (err) {
        console.warn('[QualityController] Falha ao aplicar setParameters:', err);
      }
    }
  }
}
