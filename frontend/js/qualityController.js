/**
 * Sistema de Controle Adaptativo de Qualidade (Quality Controller)
 * Documentação Arquitetural: Seção 8 e Seção 16
 *
 * Coleta métricas precisas via getStats() em malha P2P multi-usuário e ajusta dinamicamente
 * bitrate, resolução e FPS para garantir transmissão estável de até 60 FPS.
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

export class QualityController {
  constructor() {
    this.intervalId = null;
    this.pollIntervalMs = 1500; // Coleta de métricas a cada 1.5 segundos
    this.onStatsUpdate = null;
    this.webrtc = null;

    // Histórico individual por ID de relatório RTP para cálculo exato de deltas sem colisões
    this.streamStatsHistory = new Map();
    this.latestDiagnostics = null; // Diagnóstico completo acessível pelo painel de estatísticas

    // Perfil ativo persistente (Ultra por padrão)
    const saved = (() => {
      try { return localStorage.getItem('hyperstream_active_profile') || 'ultra'; } catch (_) { return 'ultra'; }
    })();
    const profile = QUALITY_PROFILES[saved] || QUALITY_PROFILES.ultra;

    this.activeProfile = profile.id;
    this.currentMaxBitrate = profile.maxBitrate;
    this.currentMaxFps = profile.maxFps;
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
   * Aplica parâmetros do perfil ativo a todos os senders de vídeo de todos os peers
   */
  async applyProfileToPeers() {
    if (!this.webrtc || !this.webrtc.peers) return;

    for (const [targetId, pc] of this.webrtc.peers.entries()) {
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
      for (const sender of senders) {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = this.currentMaxBitrate;
          params.encodings[0].maxFramerate = this.currentMaxFps;
          params.encodings[0].scaleResolutionDownBy = 1.0;
          params.encodings[0].priority = 'high';
          params.encodings[0].networkPriority = 'high';
          params.degradationPreference = 'maintain-framerate';

          await sender.setParameters(params);
        } catch (err) {
          console.warn(`[QualityController] Erro ao aplicar perfil no peer ${targetId}:`, err.message);
        }
      }
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

    const connectedPcs = [];
    if (this.webrtc.peers) {
      for (const [userId, pc] of this.webrtc.peers.entries()) {
        if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          connectedPcs.push({ userId, pc });
        }
      }
    }

    // Se não há peers conectados, extrai métricas locais preliminares da transmissão (se houver)
    if (connectedPcs.length === 0) {
      const localMedia = this.webrtc.mediaManager;
      const screenTrack = localMedia?.getScreenVideoTrack();
      const cameraTrack = localMedia?.getCameraVideoTrack();
      const activeTrack = (screenTrack && screenTrack.readyState === 'live') ? screenTrack : (cameraTrack && cameraTrack.readyState === 'live' ? cameraTrack : null);

      if (activeTrack) {
        const settings = activeTrack.getSettings() || {};
        const width = settings.width || null;
        const height = settings.height || null;
        const fps = settings.frameRate ? Math.round(settings.frameRate) : (activeTrack === screenTrack ? 60 : 30);

        if (this.onStatsUpdate) {
          this.onStatsUpdate({
            fps,
            resolution: width && height ? `${width}x${height}` : '--',
            rtt: '--',
            bitrateMbps: '--',
            packetLossPercent: '0.0',
            codec: 'H.264 / AV1',
            connectionType: 'Aguardando Amigos',
            activeProfile: this.activeProfile
          });
        }
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

      for (const { userId, pc } of connectedPcs) {
        const stats = await pc.getStats();

        // 1. Mapeamento de candidatos e codecs deste peer
        const candidateReports = new Map();
        const codecMap = new Map();
        const codecDetailsMap = new Map();
        let activeCandidatePair = null;

        stats.forEach(report => {
          if (report.type === 'codec') {
            const mime = (report.mimeType || '').replace(/^video\//i, '').replace(/^audio\//i, '').toUpperCase();
            codecMap.set(report.id, mime);
            codecDetailsMap.set(report.id, {
              mime,
              clockRate: report.clockRate,
              channels: report.channels,
              sdpFmtpLine: report.sdpFmtpLine || null,
              payloadType: report.payloadType
            });
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
        stats.forEach(report => {
          // A. VÍDEO DE SAÍDA (Host transmissor compartilhando tela/câmera)
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            seenReportIds.add(report.id);

            const codecDetail = report.codecId ? codecDetailsMap.get(report.codecId) : null;
            const cName = codecDetail ? codecDetail.mime : (report.codecId ? codecMap.get(report.codecId) : null);
            if (cName) activeCodec = cName;

            if (report.frameWidth && report.frameHeight) {
              width = report.frameWidth;
              height = report.frameHeight;
            }

            let streamFps = report.framesPerSecond ? Math.round(report.framesPerSecond) : null;
            let streamBitrateBps = 0;
            let avgEncodeTimeMs = null;

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
                  const framesDelta = currentFrames - prev.frames;
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
            const isHw = isHardwareCodecImplementation(encoderImpl);

            outboundStreamsList.push({
              id: report.id,
              targetUserId: userId,
              codec: cName || 'DESCONHECIDO',
              sdpFmtpLine: codecDetail?.sdpFmtpLine || '--',
              encoderImplementation: encoderImpl || 'Padrão do Sistema',
              isHardware: isHw,
              qualityLimitationReason: report.qualityLimitationReason || 'none',
              width: report.frameWidth || width || '--',
              height: report.frameHeight || height || '--',
              fps: streamFps || '--',
              bitrateMbps: (streamBitrateBps / 1000000).toFixed(2),
              framesEncoded: report.framesEncoded || 0,
              framesDropped: report.framesDropped || 0,
              avgEncodeTimeMs: avgEncodeTimeMs !== null ? `${avgEncodeTimeMs} ms` : '--',
              packetsSent: report.packetsSent || 0,
              bytesSent: report.bytesSent || 0
            });

            this.streamStatsHistory.set(report.id, {
              bytes: report.bytesSent || 0,
              timestamp: report.timestamp,
              frames: report.framesSent ?? report.framesEncoded,
              totalEncodeTime: report.totalEncodeTime || 0
            });
          }

          // B. FONTE DE MÍDIA LOCAL (Captura de tela / webcam no Host)
          if (report.type === 'media-source' && report.kind === 'video') {
            if (!width && report.width) {
              width = report.width;
              height = report.height;
            }
            if (report.framesPerSecond) {
              calculatedFpsList.push(Math.round(report.framesPerSecond));
            }
          }

          // C. FEEDBACK RTCP DO RECEPTOR (Perda de pacotes e RTT do Host transmissor)
          if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
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
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            seenReportIds.add(report.id);

            const codecDetail = report.codecId ? codecDetailsMap.get(report.codecId) : null;
            const cName = codecDetail ? codecDetail.mime : (report.codecId ? codecMap.get(report.codecId) : null);
            if (cName) activeCodec = cName;

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

            if (streamFps) {
              calculatedFpsList.push(streamFps);
            }

            const decoderImpl = report.decoderImplementation || null;
            const isPowerEfficient = Boolean(report.powerEfficientDecoder);
            const isHw = isHardwareCodecImplementation(decoderImpl) || isPowerEfficient;

            inboundStreamsList.push({
              id: report.id,
              peerId: userId,
              codec: cName || 'DESCONHECIDO',
              sdpFmtpLine: codecDetail?.sdpFmtpLine || '--',
              decoderImplementation: decoderImpl || 'Padrão do Sistema',
              powerEfficientDecoder: isPowerEfficient,
              isHardware: isHw,
              width: report.frameWidth || width || '--',
              height: report.frameHeight || height || '--',
              fps: streamFps || '--',
              bitrateMbps: (streamBitrateBps / 1000000).toFixed(2),
              framesDecoded: report.framesDecoded || 0,
              framesDropped: report.framesDropped || 0,
              avgDecodeTimeMs: avgDecodeTimeMs !== null ? `${avgDecodeTimeMs} ms` : '--',
              packetsReceived: report.packetsReceived || 0,
              packetsLost: report.packetsLost || 0,
              jitterMs: report.jitter ? Math.round(report.jitter * 1000) : 0
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
          const domVideo = document.querySelector('.stream-tile video, .local-media-card video');
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
        : '--';

      // Identifica o codec efetivo e se a codificação/decodificação é por hardware ou software
      let formattedCodec = '--';
      if (outboundStreamsList.length > 0) {
        const s = outboundStreamsList[0];
        formattedCodec = `${s.codec} (${s.isHardware ? 'GPU ⚡' : 'Software ⚠️'})`;
      } else if (inboundStreamsList.length > 0) {
        const s = inboundStreamsList[0];
        formattedCodec = `${s.codec} (${s.isHardware ? 'GPU ⚡' : 'Software ⚠️'})`;
      } else if (activeCodec) {
        formattedCodec = activeCodec;
      }

      // Atualiza snapshot de diagnóstico detalhado
      this.latestDiagnostics = {
        outbound: outboundStreamsList,
        inbound: inboundStreamsList,
        dominantConnectionType,
        rtt: finalRtt,
        packetLoss: finalPacketLoss,
        bitrateMbps,
        fps: finalFps,
        resolution: width && height ? `${width}x${height}` : '--',
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
        diagnostics: this.latestDiagnostics
      };

      // Dispara lógica adaptativa de bitrate em todas as conexões ativas
      this.evaluateAdaptation(connectedPcs.map(item => item.pc), typeof finalRtt === 'number' ? finalRtt : null, parseFloat(finalPacketLoss));

      if (this.onStatsUpdate) {
        this.onStatsUpdate(metrics);
      }
    } catch (err) {
      console.warn('[QualityController] Erro ao coletar stats multi-peer:', err);
    }
  }

  /**
   * Avalia a saúde da conexão e ajusta dinamicamente a taxa de envio dentro dos limites do perfil
   * Aplicado em todos os peers simultaneamente
   */
  async evaluateAdaptation(pcs, rtt, packetLoss) {
    if (!pcs || pcs.length === 0) return;

    const profile = QUALITY_PROFILES[this.activeProfile] || QUALITY_PROFILES.ultra;
    let needsUpdate = false;

    // Regra 1: Perda de pacotes elevada (> 3.5%) ou RTT crítico (> 220ms)
    if ((packetLoss > 3.5 || (rtt && rtt > 220)) && this.currentMaxBitrate > profile.minBitrate) {
      console.warn('[QualityController] Degradação de rede detectada. Reduzindo bitrate adaptativo...');
      this.currentMaxBitrate = Math.max(profile.minBitrate, Math.round(this.currentMaxBitrate * 0.8));
      this.currentMaxFps = Math.min(this.currentMaxFps, 45);
      needsUpdate = true;
    }
    // Regra 2: Rede excelente e estável (< 0.5% loss e RTT < 65ms)
    else if (packetLoss < 0.5 && rtt && rtt < 65 && this.currentMaxBitrate < profile.maxBitrate) {
      this.currentMaxBitrate = Math.min(profile.maxBitrate, Math.round(this.currentMaxBitrate * 1.15));
      this.currentMaxFps = profile.maxFps;
      needsUpdate = true;
    }

    if (needsUpdate) {
      for (const pc of pcs) {
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
            // Silencia erros transitórios no WebRTC
          }
        }
      }
      console.log(`[QualityController] Parâmetros adaptados em ${pcs.length} conexões: Bitrate=${(this.currentMaxBitrate / 1000000).toFixed(1)}Mbps, MaxFPS=${this.currentMaxFps}`);
    }
  }
}
