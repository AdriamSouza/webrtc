/**
 * Gerenciador de Conexões WebRTC P2P (Canal 3: RTP/SRTP)
 * Documentação Arquitetural: Seções 4.B, 6, 8, 14 e 20
 *
 * Inclui:
 * - Fila de candidatos ICE (elimina race condition entre Offer e Candidates)
 * - Mídia combinada (Stream dinâmico persistente no receptor)
 * - Negociação inteligente de codecs (AV1 preferencial com fallback H.264)
 * - Compatibilidade robusta com Chrome, Edge e Firefox
 */

import { determineOptimalCodecOrder, evaluateCodecCapabilities, probeRealHardwareEncoders } from './hardwareDetector.js';

export class WebRTCManager {
  constructor(signalingClient, iceServers = []) {
    this.signaling = signalingClient;
    this.iceServers = iceServers.length > 0 ? iceServers : [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    this.peers = new Map(); // Map<targetUserId, RTCPeerConnection>
    this.peerSenders = new Map(); // Map<targetUserId, { screenVideo, screenAudio, cameraVideo, cameraAudio, micAudio }>
    this.peerMediaMap = new Map(); // Map<targetUserId, { screenMid, cameraMid, screenStreamId, cameraStreamId, screenActive, cameraActive, screenFirst }>
    this.candidateQueues = new Map(); // Map<targetUserId, RTCIceCandidateInit[]>
    this.remoteStreams = new Map(); // Map<targetUserId, MediaStream>
    this.remotePeerTracks = new Map(); // Map<targetUserId, { screenVideoTrack, cameraVideoTrack, audioTracks: Set<MediaStreamTrack> }>
    this.remoteStreamByTrackId = new Map(); // Map<trackId, MediaStream>
    this.tileStreams = new Map(); // Map<"${targetUserId}:${type}", MediaStream>
    this.localStream = null;
    this.mediaManager = null;
    this.onRemoteStream = null;
    this.onConnectionStateChange = null;
    this.onRemoteTrack = null;
    this.onRemoteTrackUnmuted = null;
    this.onNegotiationComplete = null;
    this.preferredCodec = (() => {
      try { return localStorage.getItem('hyperstream_preferred_codec') || 'H264'; } catch (_) { return 'H264'; }
    })();
    this.encoderPreference = (() => {
      try { return localStorage.getItem('hyperstream_encoder_preference') || 'gpu'; } catch (_) { return 'gpu'; }
    })();
    this.rejectedHardwareProfiles = new Set();
    this.attemptedFallbacks = new Map();
    this.hardwareProbe = null;
    this.lastPreferredCodecs = null;
    this.hardwareCapabilities = evaluateCodecCapabilities();
    this.targetMaxBitrate = 8000000; // 8 Mbps padrão (Ultra 60 FPS)
    this.targetMaxFps = 60; // 60 FPS padrão
    this.iceDisconnectTimers = new Map(); // Map<targetUserId, timerId>
    this.roomState = null;

    // Dispara sondagem assíncrona de hardware imediatamente na inicialização
    this.probeHardware().catch(err => {
      console.warn('[WebRTC] Erro inicial ao sondar hardware:', err.message);
    });
  }

  setIceServers(servers) {
    if (Array.isArray(servers) && servers.length > 0) {
      this.iceServers = servers;
    }
  }

  setMediaManager(mediaManager) {
    this.mediaManager = mediaManager;
  }

  setRoomState(roomState) {
    this.roomState = roomState;
  }

  /**
   * Sincroniza todas as mídias locais (tela, câmera, microfone) para todos os peers conectados
   * Usa replaceTrack defensivo para reconexões instantâneas e sem congelamentos
   */
  async syncLocalMedia(mediaManager = this.mediaManager, participantIds = null) {
    if (!mediaManager) return;
    this.mediaManager = mediaManager;
    this.localStream = mediaManager.buildCombinedStream();

    const targets = (participantIds && participantIds.length > 0)
      ? Array.from(participantIds)
      : Array.from(this.peers.keys());

    for (const targetId of targets) {
      await this.syncPeerTracks(targetId, mediaManager);
    }
  }

  /**
   * Obtém os Media IDs (MIDs) dos transceivers locais para diferenciar Tela vs Câmera
   */
  getMediaMids(targetUserId) {
    const senders = this.peerSenders.get(targetUserId);
    const pc = this.peers.get(targetUserId);
    if (!pc || !senders) return { screen: null, camera: null, mic: null };

    const transceivers = pc.getTransceivers();
    return {
      screen: transceivers.find(t => t.sender === senders.screenVideo)?.mid || null,
      camera: transceivers.find(t => t.sender === senders.cameraVideo)?.mid || null,
      mic: transceivers.find(t => t.sender === senders.micAudio)?.mid || null
    };
  }

  /**
   * Atualiza metadados de transmissão de um peer remoto
   */
  updatePeerMediaState(fromUserId, type, active, mid = null, streamId = null) {
    let mapping = this.peerMediaMap.get(fromUserId);
    if (!mapping) {
      mapping = { screenMid: null, cameraMid: null, screenStreamId: null, cameraStreamId: null, screenActive: false, cameraActive: false };
      this.peerMediaMap.set(fromUserId, mapping);
    }

    if (type === 'screen') {
      mapping.screenActive = Boolean(active);
      if (!active) {
        mapping.screenStreamId = null;
      } else {
        if (mid) mapping.screenMid = mid;
        if (streamId) mapping.screenStreamId = streamId;
        if (!mapping.cameraActive) mapping.screenFirst = true;
      }
    } else if (type === 'camera') {
      mapping.cameraActive = Boolean(active);
      if (!active) {
        mapping.cameraStreamId = null;
      } else {
        if (mid) mapping.cameraMid = mid;
        if (streamId) mapping.cameraStreamId = streamId;
        if (!mapping.screenActive) mapping.screenFirst = false;
      }
    }
  }

  /**
   * Sincroniza tracks com um peer individual com suporte a entrega sob demanda (on-demand streaming)
   * Reduz maciçamente o uso de CPU/GPU do host evitando instâncias de codificadores redundantes
   */
  async syncPeerTracks(targetUserId, mediaManager = this.mediaManager) {
    if (!mediaManager) return;
    const pc = this.getOrCreatePeer(targetUserId);

    let senders = this.peerSenders.get(targetUserId);
    if (!senders) {
      senders = {};
      this.peerSenders.set(targetUserId, senders);
    }

    const screenVideo = mediaManager.getScreenVideoTrack();
    const screenAudio = mediaManager.getScreenAudioTrack();
    const cameraVideo = mediaManager.getCameraVideoTrack();
    const cameraAudio = mediaManager.getCameraAudioTrack();
    const micAudio = mediaManager.getMicAudioTrack();

    // Em chamada direta (<= 2 participantes), transmissão direta automática fica habilitada
    const totalParticipants = this.roomState?.getParticipantCount() || 0;
    const isDirectCall = totalParticipants <= 2;

    const wantsScreen = isDirectCall || Boolean(this.roomState?.isPeerSubscribedToLocal('screen', targetUserId));
    const wantsCamera = isDirectCall || Boolean(this.roomState?.isPeerSubscribedToLocal('camera', targetUserId));

    const effectiveScreenVideo = wantsScreen ? screenVideo : null;
    const effectiveScreenAudio = wantsScreen ? screenAudio : null;
    const effectiveCameraVideo = wantsCamera ? cameraVideo : null;
    const effectiveCameraAudio = wantsCamera ? cameraAudio : null;

    const updateSender = async (key, track, stream, isVideo) => {
      const existingSender = senders[key];
      if (existingSender) {
        if (track && track.readyState === 'live') {
          try {
            console.log(`[WebRTC] Atualizando sender (${key}) com novo track para ${targetUserId}`);
            await existingSender.replaceTrack(track);
            if (isVideo) {
              const transceivers = pc.getTransceivers();
              const vt = transceivers.find(t => t.sender === existingSender);
              if (vt) this.configureCodecPreferences(vt);
              await this.applyVideoSenderLimits(existingSender);
            }
          } catch (err) {
            console.warn(`[WebRTC] Erro ao substituir track no sender ${key}:`, err.message);
          }
        } else {
          try {
            console.log(`[WebRTC] Desativando sender (${key}) com null para ${targetUserId}`);
            await existingSender.replaceTrack(null);
          } catch (err) {
            console.warn(`[WebRTC] Erro ao zerar track no sender ${key}:`, err.message);
          }
        }
      } else if (track && track.readyState === 'live' && stream) {
        console.log(`[WebRTC] Criando novo sender (${key}) para ${targetUserId}`);
        const sender = pc.addTrack(track, stream);
        senders[key] = sender;
        if (isVideo) {
          const transceivers = pc.getTransceivers();
          const vt = transceivers.find(t => t.sender === sender);
          if (vt) this.configureCodecPreferences(vt);
          await this.applyVideoSenderLimits(sender);
        }
      }
    };

    await updateSender('screenVideo', effectiveScreenVideo, mediaManager.screenStream, true);
    await updateSender('screenAudio', effectiveScreenAudio, mediaManager.screenStream, false);
    await updateSender('cameraVideo', effectiveCameraVideo, mediaManager.cameraStream, true);
    await updateSender('cameraAudio', effectiveCameraAudio, mediaManager.cameraStream, false);
    await updateSender('micAudio', micAudio, mediaManager.micStream, false);
  }

  /**
   * Desativa imediatamente o envio de vídeo para um peer específico quando este encerra a inscrição
   * Desliga a instância do codificador na GPU/CPU do transmissor instantaneamente
   */
  async unsubscribePeerFromStream(targetUserId, sourceType) {
    const senders = this.peerSenders.get(targetUserId);
    if (!senders) return;

    if (sourceType === 'desktop' || sourceType === 'screen') {
      if (senders.screenVideo) {
        try {
          console.log(`[WebRTC] Desativando encoder de tela para ${targetUserId} (unsubscribe)`);
          await senders.screenVideo.replaceTrack(null);
        } catch (_) {}
      }
      if (senders.screenAudio) {
        try { await senders.screenAudio.replaceTrack(null); } catch (_) {}
      }
    } else if (sourceType === 'camera') {
      if (senders.cameraVideo) {
        try {
          console.log(`[WebRTC] Desativando encoder de câmera para ${targetUserId} (unsubscribe)`);
          await senders.cameraVideo.replaceTrack(null);
        } catch (_) {}
      }
      if (senders.cameraAudio) {
        try { await senders.cameraAudio.replaceTrack(null); } catch (_) {}
      }
    }
  }

  /**
   * Aplica configurações de codificação de alto desempenho no RTCRtpSender
   * Remove o limite padrão de 2.5 Mbps do Chromium e prioriza 60 FPS ininterruptos
   */
  async applyVideoSenderLimits(sender) {
    if (!sender || !sender.track || sender.track.kind !== 'video') return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = this.targetMaxBitrate || 8000000;
      params.encodings[0].maxFramerate = this.targetMaxFps || 60;
      params.encodings[0].scaleResolutionDownBy = 1.0;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
      params.degradationPreference = 'maintain-framerate'; // Garante 60 FPS contínuo sem queda de quadros

      await sender.setParameters(params);
      console.log(`[WebRTC] Limites de vídeo aplicados no sender: ${(this.targetMaxBitrate / 1000000).toFixed(1)} Mbps @ ${this.targetMaxFps} FPS`);
    } catch (err) {
      console.warn('[WebRTC] Aviso ao aplicar parâmetros no sender:', err.message);
    }
  }

  /**
   * Altera bitrate e taxa de quadros e propaga para todos os peers conectados
   */
  async setBitrateAndFps(maxBitrate, maxFps) {
    if (maxBitrate) this.targetMaxBitrate = Number(maxBitrate);
    if (maxFps) this.targetMaxFps = Number(maxFps);

    for (const [targetId, pc] of this.peers.entries()) {
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
      for (const sender of senders) {
        await this.applyVideoSenderLimits(sender);
      }
    }
  }

  /**
   * Munging de SDP para sinalizar banda máxima suportada ao BWE (Bandwidth Estimator),
   * reordenar payloads para forçar o codec preferido (AV1 / H.264 / VP9) e ativar Opus Estéreo 128 kbps
   */
  mungeSdpBandwidth(sdp, bitrateBps = this.targetMaxBitrate) {
    if (!sdp) return sdp;
    const bps = bitrateBps || 8000000;
    const bitrateKbps = Math.round(bps / 1000);
    const pref = (this.preferredCodec || 'auto').toUpperCase();

    // Divide SDP em seções de mídia
    const rawSections = sdp.split(/\r\n(?=m=)/);
    const modifiedSections = [];

    for (const section of rawSections) {
      if (section.startsWith('m=video')) {
        let lines = section.split('\r\n');
        let mLine = lines[0];
        let hasAS = false;
        let hasTIAS = false;
        const codecPayloadMap = new Map(); // pt -> codecName
        const rtxAptMap = new Map(); // rtxPt -> aptPt

        // 1. Mapeia codecs e rtx desta seção de vídeo
        for (const line of lines) {
          if (line.startsWith('a=rtpmap:')) {
            const match = line.match(/^a=rtpmap:(\d+)\s+([^\/]+)/i);
            if (match) {
              let cName = match[2].toUpperCase();
              if (cName === 'AV01') cName = 'AV1';
              codecPayloadMap.set(match[1], cName);
            }
          }
          if (line.startsWith('a=fmtp:')) {
            const match = line.match(/^a=fmtp:(\d+)\s+apt=(\d+)/i);
            if (match) {
              rtxAptMap.set(match[1], match[2]);
            }
          }
          if (line.startsWith('b=AS:')) hasAS = true;
          if (line.startsWith('b=TIAS:')) hasTIAS = true;
        }

        // 2. Preserva a ordem exata de codecs gerada pelo transceiver.setCodecPreferences()
        // NÃO reagrupa payloads por nome genérico de codec ('H264') para não destruir o profile-level-id e packetization-mode=1
        const mParts = mLine.split(' ');
        if (mParts.length > 3 && codecPayloadMap.size > 0) {
          const header = mParts.slice(0, 3);
          const payloads = mParts.slice(3);

          // Se transceiver.setCodecPreferences não foi suportado, aplica ordenação defensiva priorizando packetization-mode=1
          if (!this.lastPreferredCodecs || this.lastPreferredCodecs.length === 0) {
            const isCpuPref = this.encoderPreference === 'cpu';
            const scorePayload = (pt) => {
              const cName = codecPayloadMap.get(pt) || '';
              if (isCpuPref && pref !== 'AUTO' && cName === pref) return 5;
              if (cName === 'H264') return 10;
              if (cName === 'AV1') return 20;
              if (cName === 'VP9') return 30;
              if (cName === 'VP8') return 40;
              return 90;
            };
            const sortedPayloads = [...payloads].sort((a, b) => scorePayload(a) - scorePayload(b));
            lines[0] = [...header, ...sortedPayloads].join(' ');
          } else {
            // Mantém a ordem cirúrgica do setCodecPreferences já refletida no SDP
            lines[0] = [...header, ...payloads].join(' ');
          }
          console.log('[WebRTC SDP] m=video mantido na ordem de perfil do hardware:', payloads.slice(0, 4).map(p => `${p}(${codecPayloadMap.get(p) || 'rtx'})`));
        }

        // 3. Aplica limites de banda b=AS e b=TIAS na seção
        const newLines = [];
        let bInserted = false;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (l.startsWith('b=AS:')) {
            newLines.push(`b=AS:${bitrateKbps}`);
            bInserted = true;
            continue;
          }
          if (l.startsWith('b=TIAS:')) {
            newLines.push(`b=TIAS:${bps}`);
            bInserted = true;
            continue;
          }
          if (i === 1 && !bInserted) {
            newLines.push(`b=AS:${bitrateKbps}`);
            newLines.push(`b=TIAS:${bps}`);
            bInserted = true;
          }
          newLines.push(l);
        }
        modifiedSections.push(newLines.join('\r\n'));
      } else {
        modifiedSections.push(section);
      }
    }

    let modified = modifiedSections.join('\r\n');

    // Munge de Bitrates para x-google (Apenas em formatos de vídeo, NUNCA em RTX ou Áudio)
    modified = modified.replace(/(a=fmtp:(\d+)\s+.*)([\r\n]+)/g, (match, p1, pt, p2) => {
      if (p1.includes('apt=') || p1.includes('minptime=') || p1.includes('maxplaybackrate=')) {
        return match;
      }
      if (!p1.includes('x-google-max-bitrate')) {
        return `${p1};x-google-min-bitrate=2000;x-google-start-bitrate=4000;x-google-max-bitrate=${bitrateKbps}${p2}`;
      }
      return match;
    });

    // Munge de Áudio: Ativa Opus Estéreo 128 kbps com FEC para som cristalino de jogo e música
    modified = modified.replace(/(a=fmtp:\d+ .*minptime=\d+.*)([\r\n]+)/gi, (match, p1, p2) => {
      let res = p1;
      if (!res.includes('stereo=1')) res += ';stereo=1;sprop-stereo=1';
      if (!res.includes('maxaveragebitrate=')) res += ';maxaveragebitrate=128000';
      return `${res}${p2}`;
    });

    return modified;
  }

  setLocalStream(stream) {
    this.localStream = stream;
  }

  /**
   * Força renegociação SDP com os peers quando uma nova mídia (câmera/tela) é ativada
   */
  async renegotiateAllPeers(participantIds = null) {
    const targets = (participantIds && participantIds.length > 0)
      ? Array.from(participantIds)
      : Array.from(this.peers.keys());

    for (const targetId of targets) {
      console.log(`[WebRTC] Sincronizando tracks e renegociando SDP para ${targetId}...`);
      await this.syncPeerTracks(targetId, this.mediaManager);
      await this.createOfferForPeer(targetId);
    }
  }

  /**
   * Avalia o suporte a codecs e verifica o estado de aceleração da GPU
   * Diferencia o formato do codec do mecanismo real de codificação (Hardware vs Software)
   */
  static detectGpuHardwareAcceleration(gpuDiagnostics = null) {
    const caps = typeof RTCRtpSender.getCapabilities === 'function' ? RTCRtpSender.getCapabilities('video') : null;
    const codecs = caps ? caps.codecs : [];

    const hasH264 = codecs.some(c => c.mimeType.toLowerCase() === 'video/h264');
    const hasAV1 = codecs.some(c => c.mimeType.toLowerCase() === 'video/av1');
    const hasVP9 = codecs.some(c => c.mimeType.toLowerCase() === 'video/vp9');
    const hasVP8 = codecs.some(c => c.mimeType.toLowerCase() === 'video/vp8');

    const featureStatus = gpuDiagnostics?.featureStatus || {};
    const gpuInfo = gpuDiagnostics?.gpuInfo || {};
    const isDesktop = Boolean(gpuDiagnostics);
    const hwEncodeActive = featureStatus.video_encode === 'enabled';
    const hwDecodeActive = featureStatus.video_decode === 'enabled';

    let gpuDevice = null;
    if (gpuInfo.gpuDevice && gpuInfo.gpuDevice[0] && gpuInfo.gpuDevice[0].deviceString) {
      gpuDevice = gpuInfo.gpuDevice[0].deviceString;
    }

    return {
      gpuDevice,
      isDesktop,
      hwEncodeActive,
      hwDecodeActive,
      h264: {
        supported: hasH264,
        gpuAccelerated: hwEncodeActive && hasH264,
        label: 'H.264 / AVC',
        badge: hwEncodeActive && hasH264 ? 'GPU ⚡ (Hardware)' : (hasH264 ? 'Suportado' : 'Não Suportado'),
        description: 'Padrão com ampla aceleração por GPU (NVENC, AMD AMF, Intel QuickSync).'
      },
      av1: {
        supported: hasAV1,
        gpuAccelerated: hwEncodeActive && hasAV1,
        label: 'AV1 (Next-Gen)',
        badge: hwEncodeActive && hasAV1 ? 'GPU / Hardware 🚀' : (hasAV1 ? 'Suportado' : 'Não Suportado'),
        description: 'Compressão ultra-eficiente a 60 FPS com 40% menos dados.'
      },
      vp9: {
        supported: hasVP9,
        gpuAccelerated: hwEncodeActive && hasVP9,
        label: 'VP9',
        badge: hasVP9 ? 'HD' : 'Não Suportado',
        description: 'Excelente equilíbrio de cores e transições de cena dinâmicas.'
      },
      vp8: {
        supported: hasVP8,
        gpuAccelerated: false,
        label: 'VP8',
        badge: 'Básico',
        description: 'Modo de compatibilidade para dispositivos sem aceleradores dedicados de vídeo.'
      }
    };
  }

  /**
   * Retorna a lista de codecs de vídeo disponíveis e suportados pelo dispositivo/navegador
   */
  static getAvailableCodecs(gpuDiagnostics = null) {
    if (typeof RTCRtpReceiver.getCapabilities !== 'function') {
      return [
        { codec: 'H264', name: 'H264', label: 'H.264 (AVC)', description: 'Compatibilidade GPU', badge: 'H.264', gpu: true },
        { codec: 'VP8', name: 'VP8', label: 'VP8', description: 'Compatibilidade padrão universal', badge: 'Básico', gpu: false }
      ];
    }

    try {
      const caps = RTCRtpReceiver.getCapabilities('video');
      if (!caps || !caps.codecs) return [];

      const hwEncodeActive = gpuDiagnostics?.featureStatus?.video_encode === 'enabled';
      const seen = new Set();
      const result = [];

      for (const c of caps.codecs) {
        const mime = c.mimeType.replace(/^video\//i, '').toUpperCase();
        if (!['RTX', 'RED', 'ULPFEC', 'FLEXFEC-03'].includes(mime) && !seen.has(mime)) {
          seen.add(mime);
          let label = mime;
          let description = 'Codec de vídeo WebRTC';
          let badge = '';
          let gpu = false;

          if (mime === 'AV1') {
            label = 'AV1 (Ultra Eficiente / Next-Gen)';
            description = 'Altíssima fidelidade a 60 FPS com 40% menos banda';
            badge = hwEncodeActive ? 'GPU 🚀 (Hardware)' : 'Suportado';
            gpu = hwEncodeActive;
          } else if (mime === 'H264') {
            label = 'H.264 (AVC)';
            description = 'Compatibilidade universal e aceleração em GPUs NVIDIA, AMD e Intel';
            badge = hwEncodeActive ? 'GPU ⚡ (Hardware)' : 'Suportado';
            gpu = hwEncodeActive;
          } else if (mime === 'VP9') {
            label = 'VP9 (Google HD)';
            description = 'Excelente fidelidade de cores e transições suaves';
            badge = 'HD';
            gpu = hwEncodeActive;
          } else if (mime === 'VP8') {
            label = 'VP8 (Legado)';
            description = 'Compatibilidade com todos os dispositivos e navegadores';
            badge = 'Básico';
            gpu = false;
          }

          result.push({ codec: mime, name: mime, label, description, badge, gpu });
        }
      }

      return result;
    } catch (err) {
      console.warn('[WebRTC] Erro ao listar codecs disponíveis:', err);
      return [
        { codec: 'H264', name: 'H264', label: 'H.264 (AVC)', description: 'Compatibilidade ampla', badge: 'H.264', gpu: true },
        { codec: 'AV1', name: 'AV1', label: 'AV1', description: 'Ultra eficiente', badge: 'AV1', gpu: true }
      ];
    }
  }

  /**
   * Altera a preferência de codec (Automático, AV1, H.264, VP9, VP8)
   */
  async setPreferredCodec(codec) {
    this.preferredCodec = codec;
    try { localStorage.setItem('hyperstream_preferred_codec', codec); } catch (_) {}
    console.log(`[WebRTC] Preferência de codec alterada para: ${codec}`);
    await this.applyCodecPreferencesToAllPeers();
  }

  getPreferredCodec() {
    return this.preferredCodec || 'auto';
  }

  /**
   * Aplica a ordem de codecs preferenciais a todos os transceivers ativos e renegocia
   */
  async applyCodecPreferencesToAllPeers() {
    for (const [userId, pc] of this.peers.entries()) {
      if (pc.signalingState === 'closed') continue;
      const senders = this.peerSenders.get(userId) || {};
      const transceivers = pc.getTransceivers().filter(t => {
        const isVideoSender = t.sender && t.sender.track && t.sender.track.kind === 'video';
        const isVideoReceiver = t.receiver && t.receiver.track && t.receiver.track.kind === 'video';
        const isRegisteredVideoSender = t.sender === senders.screenVideo || t.sender === senders.cameraVideo;
        return isVideoSender || isVideoReceiver || isRegisteredVideoSender;
      });
      for (const t of transceivers) {
        this.configureCodecPreferences(t);
      }
    }
    await this.renegotiateAllPeers();
  }

  setHardwareCapabilities(caps) {
    this.hardwareCapabilities = caps;
  }

  getEncoderPreference() {
    return this.encoderPreference || 'auto';
  }

  async setEncoderPreference(pref) {
    this.encoderPreference = pref;
    try { localStorage.setItem('hyperstream_encoder_preference', pref); } catch (_) {}
    console.log(`[WebRTC] Preferência de codificador (CPU/GPU) alterada para: ${pref}`);
    await this.applyCodecPreferencesToAllPeers();
  }

  /**
   * Executa sondagem real de hardware com probeRealHardwareEncoders
   */
  async probeHardware(options = {}) {
    try {
      this.hardwareProbe = await probeRealHardwareEncoders(
        options.width || 1920,
        options.height || 1080,
        options.framerate || 60,
        options.bitrate || this.targetMaxBitrate || 8000000
      );
      this.hardwareCapabilities = evaluateCodecCapabilities({}, {}, this.hardwareProbe);
      return this.hardwareProbe;
    } catch (err) {
      console.warn('[WebRTC] Erro durante probeRealHardwareEncoders:', err.message);
      return null;
    }
  }

  /**
   * Configura preferência de codecs no Transceiver WebRTC conforme seleção do usuário,
   * capacidades reais de hardware (GPU vs CPU) e descarte de perfis com falha de runtime.
   */
  configureCodecPreferences(transceiver) {
    if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') {
      return;
    }

    try {
      // 1. Obtém lista real de codecs de envio com RTCRtpSender.getCapabilities (fallback para Receiver)
      const capabilities = (typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function')
        ? RTCRtpSender.getCapabilities('video')
        : (typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function' ? RTCRtpReceiver.getCapabilities('video') : null);

      if (!capabilities || !capabilities.codecs) return;

      const caps = this.hardwareCapabilities || evaluateCodecCapabilities();
      const optimal = determineOptimalCodecOrder({
        preference: this.encoderPreference || 'gpu',
        preferredCodec: this.preferredCodec || 'H264',
        availableCodecs: capabilities.codecs,
        capabilities: caps,
        hardwareProbe: this.hardwareProbe,
        rejectedProfiles: this.rejectedHardwareProfiles
      });

      if (optimal.preferredOrder && optimal.preferredOrder.length > 0) {
        transceiver.setCodecPreferences(optimal.preferredOrder);
        this.lastPreferredCodecs = optimal.preferredOrder;
        const top = optimal.preferredOrder[0];
        console.log(`[WebRTC] Ordem de codecs aplicada (${this.encoderPreference}/${this.preferredCodec}): 1º ${top?.mimeType} [${top?.sdpFmtpLine || 'default'}] (${optimal.reason})`);
      }
    } catch (err) {
      console.warn('[WebRTC] Não foi possível definir preferência de codecs (usando padrão):', err.message);
    }
  }

  /**
   * Auto-recovery obrigatório anti-CPU: disparado quando o QualityController detecta que
   * um stream ativo (framesEncoded > 20) caiu em software_confirmed (OpenH264 / libaom).
   */
  async handleSoftwareFallbackDetected(targetUserId, failedCodec, failedFmtp = '', implName = '') {
    if (this.encoderPreference === 'cpu') return;

    const lockKey = `${targetUserId}:${failedCodec}:${failedFmtp || 'default'}`;
    const attempts = this.attemptedFallbacks.get(lockKey) || 0;
    if (attempts >= 2) {
      console.warn(`[WebRTC Anti-Fallback] Limite de tentativas atingido para ${lockKey}. Mantendo stream.`);
      return;
    }
    this.attemptedFallbacks.set(lockKey, attempts + 1);

    console.warn(`[WebRTC Anti-Fallback] Detectado fallback para CPU (${implName || failedCodec}) com peer ${targetUserId}. Disparando recuperação para GPU...`);

    // Registra perfil rejeitado
    if (failedFmtp) {
      this.rejectedHardwareProfiles.add(failedFmtp);
    }
    if (failedCodec === 'AV1' || failedCodec === 'VP8' || failedCodec === 'VP9') {
      this.preferredCodec = 'H264';
    }

    const pc = this.peers.get(targetUserId);
    if (!pc || pc.signalingState === 'closed') return;

    // Reaplica configureCodecPreferences nos transceivers de vídeo do peer
    const transceivers = pc.getTransceivers().filter(t => {
      return (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
             (t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
    });

    for (const t of transceivers) {
      this.configureCodecPreferences(t);
    }

    // Dispara nova oferta SDP para migrar a codificação para a GPU
    try {
      console.log(`[WebRTC Anti-Fallback] Renegociando com ${targetUserId} para perfil acelerado por GPU...`);
      await this.createOfferForPeer(targetUserId);
    } catch (err) {
      console.error(`[WebRTC Anti-Fallback] Falha ao renegociar com ${targetUserId}:`, err.message);
    }
  }

  /**
   * Cria e configura um novo RTCPeerConnection para um participante
   */
  getOrCreatePeer(targetUserId) {
    if (this.peers.has(targetUserId)) {
      return this.peers.get(targetUserId);
    }

    console.log(`[WebRTC] Criando RTCPeerConnection para peer: ${targetUserId}`);

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    this.peers.set(targetUserId, pc);

    // Se temos mídias ativas no mediaManager, sincroniza imediatamente
    if (this.mediaManager) {
      this.syncPeerTracks(targetUserId, this.mediaManager).catch(err => {
        console.warn('[WebRTC] Erro inicial ao sincronizar tracks no novo peer:', err);
      });
    }

    // Disparo de candidatos ICE locais para o peer através da sinalização (com batching inteligente)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const cand = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
        if (this.signaling && typeof this.signaling.sendIceCandidate === 'function') {
          this.signaling.sendIceCandidate(cand, targetUserId);
        } else {
          this.signaling.send('ICE_CANDIDATE', cand, targetUserId);
        }
      }
    };

    // Recepção de stream remoto (áudio e vídeo)
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Track remoto recebido (${event.track.kind}, id=${event.track.id}) do peer: ${targetUserId}`);

      let stream = this.remoteStreams.get(targetUserId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(targetUserId, stream);
      }

      if (event.streams && event.streams[0]) {
        this.remoteStreamByTrackId.set(event.track.id, event.streams[0]);
      }

      // Registro do track nas estruturas internas de cache por peer
      let peerTracks = this.remotePeerTracks.get(targetUserId);
      if (!peerTracks) {
        peerTracks = { screenVideoTrack: null, cameraVideoTrack: null, audioTracks: new Set() };
        this.remotePeerTracks.set(targetUserId, peerTracks);
      }

      if (event.track.kind === 'audio') {
        peerTracks.audioTracks.add(event.track);
      }

      // Adiciona o track ao MediaStream geral se ainda não estiver presente
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach(t => {
          if (!stream.getTracks().some(existing => existing.id === t.id)) {
            stream.addTrack(t);
          }
        });
      } else if (event.track) {
        if (!stream.getTracks().some(existing => existing.id === event.track.id)) {
          stream.addTrack(event.track);
        }
      }

      // Monitor de reativação (unmute) para quando uma transmissão pausada volta a transmitir quadros
      event.track.onunmute = () => {
        console.log(`[WebRTC] Track remoto ${event.track.kind} de ${targetUserId} UNMUTED (transmissão reativada)`);
        if (this.onRemoteTrackUnmuted) {
          this.onRemoteTrackUnmuted(event.track, targetUserId);
        }
      };

      event.track.onmute = () => {
        console.log(`[WebRTC] Track remoto ${event.track.kind} de ${targetUserId} MUTED (transmissão pausada ou finalizada)`);
        if (this.onRemoteTrackMuted) {
          this.onRemoteTrackMuted(event.track, targetUserId);
        }
      };

      event.track.onended = () => {
        console.log(`[WebRTC] Track remoto ${event.track.kind} de ${targetUserId} ENDED (transmissão encerrada)`);
        if (this.onRemoteTrackEnded) {
          this.onRemoteTrackEnded(event.track, targetUserId);
        }
      };

      if (this.onRemoteStream) {
        this.onRemoteStream(stream, targetUserId);
      }

      if (this.onRemoteTrack) {
        this.onRemoteTrack(event.track, stream, targetUserId);
      }
    };

    // Monitoramento do estado da conexão
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Estado da conexão com ${targetUserId}: ${pc.connectionState}`);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(targetUserId, pc.connectionState);
      }
      if (pc.connectionState === 'failed') {
        console.warn(`[WebRTC] Conexão com ${targetUserId} falhou. Disparando ICE Restart...`);
        this.restartPeerConnection(targetUserId);
      } else if (pc.connectionState === 'closed') {
        this.closePeer(targetUserId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state com ${targetUserId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (this.iceDisconnectTimers.has(targetUserId)) {
          clearTimeout(this.iceDisconnectTimers.get(targetUserId));
          this.iceDisconnectTimers.delete(targetUserId);
        }
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(targetUserId, 'connected');
        }
      } else if (pc.iceConnectionState === 'disconnected') {
        // Se a conexão ICE permanecer desconectada por mais de 5s, força ICE restart defensivo
        if (!this.iceDisconnectTimers.has(targetUserId)) {
          const timer = setTimeout(() => {
            this.iceDisconnectTimers.delete(targetUserId);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
              console.warn(`[WebRTC] ICE permaneceu desconectado com ${targetUserId}. Disparando ICE Restart...`);
              this.restartPeerConnection(targetUserId);
            }
          }, 5000);
          this.iceDisconnectTimers.set(targetUserId, timer);
        }
      } else if (pc.iceConnectionState === 'failed') {
        if (this.iceDisconnectTimers.has(targetUserId)) {
          clearTimeout(this.iceDisconnectTimers.get(targetUserId));
          this.iceDisconnectTimers.delete(targetUserId);
        }
        console.warn(`[WebRTC] ICE falhou com ${targetUserId}. Disparando ICE Restart...`);
        this.restartPeerConnection(targetUserId);
      }
    };

    return pc;
  }

  /**
   * Obtém a faixa de vídeo remota ativa (tela ou câmera) para um usuário
   * Utiliza mapeamento determinístico por MID e streamId para garantir que
   * Tela e Câmera NUNCA sejam confundidas como a mesma transmissão.
   */
  getRemoteVideoTrack(targetUserId, type = 'screen') {
    const pc = this.peers.get(targetUserId);
    if (!pc) return null;

    const mapping = this.peerMediaMap.get(targetUserId) || {};
    const targetMid = type === 'screen' ? mapping.screenMid : mapping.cameraMid;
    const targetStreamId = type === 'screen' ? mapping.screenStreamId : mapping.cameraStreamId;

    // 1. Busca por MID exato do SDP (RFC 8829 WebRTC Unified Plan)
    if (targetMid !== undefined && targetMid !== null) {
      const t = pc.getTransceivers().find(tr => tr.mid === targetMid);
      if (t && t.receiver && t.receiver.track && t.receiver.track.kind === 'video') {
        return t.receiver.track;
      }
    }

    // 2. Busca por Stream ID recebido nos eventos ontrack
    if (targetStreamId) {
      for (const r of pc.getReceivers()) {
        if (r.track && r.track.kind === 'video') {
          const stream = this.remoteStreamByTrackId.get(r.track.id);
          if (stream && stream.id === targetStreamId) {
            return r.track;
          }
        }
      }
    }

    // 3. Mapeamento por lista de transceivers de vídeo recebidos
    const videoTransceivers = pc.getTransceivers().filter(
      t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video'
    );

    if (videoTransceivers.length === 0) {
      const fallbackReceiver = pc.getReceivers().find(r => r.track && r.track.kind === 'video');
      return fallbackReceiver?.track || null;
    }

    // Se só há 1 transceiver de vídeo ativo, verifica se ele pertence ao tipo solicitado
    if (videoTransceivers.length === 1) {
      const singleTr = videoTransceivers[0];
      if (type === 'screen' && mapping.cameraMid && singleTr.mid === mapping.cameraMid) {
        return null;
      }
      if (type === 'camera' && mapping.screenMid && singleTr.mid === mapping.screenMid) {
        return null;
      }
      if (type === 'screen' && mapping.cameraActive && !mapping.screenActive) {
        return null;
      }
      if (type === 'camera' && mapping.screenActive && !mapping.cameraActive) {
        return null;
      }
      return singleTr.receiver.track;
    }

    // Se há 2 vídeos simultâneos (Câmera + Tela):
    // Garante que cada tipo pegue seu transceiver específico sem nunca duplicar
    const screenIndex = mapping.screenFirst ? 0 : 1;
    const cameraIndex = screenIndex === 0 ? 1 : 0;

    if (type === 'screen' && videoTransceivers[screenIndex]) {
      return videoTransceivers[screenIndex].receiver.track;
    }
    if (type === 'camera' && videoTransceivers[cameraIndex]) {
      return videoTransceivers[cameraIndex].receiver.track;
    }

    return null;
  }

  /**
   * Retorna MediaStream persistente para um tile remoto específico, sincronizando tracks in-place
   * Evita a recriação excessiva de instâncias de MediaStream e vazamento de memória de decodificadores GPU
   */
  getRemoteStreamForTile(targetUserId, type = 'screen') {
    const key = `${targetUserId}:${type}`;
    let stream = this.tileStreams.get(key);
    if (!stream) {
      stream = new MediaStream();
      this.tileStreams.set(key, stream);
    }

    const videoTrack = this.getRemoteVideoTrack(targetUserId, type);
    const currentVideoTracks = stream.getVideoTracks();

    // Sincroniza track de vídeo se mudou
    if (videoTrack) {
      if (!currentVideoTracks.includes(videoTrack)) {
        currentVideoTracks.forEach(t => stream.removeTrack(t));
        stream.addTrack(videoTrack);
      }
    } else {
      currentVideoTracks.forEach(t => stream.removeTrack(t));
    }

    // Sincroniza tracks de áudio disponíveis
    const pc = this.peers.get(targetUserId);
    const targetAudioTracks = [];
    if (pc) {
      pc.getReceivers().forEach(r => {
        if (r.track && r.track.kind === 'audio') {
          targetAudioTracks.push(r.track);
        }
      });
    }

    const currentAudioTracks = stream.getAudioTracks();
    currentAudioTracks.forEach(t => {
      if (!targetAudioTracks.includes(t)) {
        stream.removeTrack(t);
      }
    });
    targetAudioTracks.forEach(t => {
      if (!currentAudioTracks.includes(t)) {
        stream.addTrack(t);
      }
    });

    return stream;
  }

  /**
   * Executa reinicialização completa de ICE gerando nova oferta SDP conforme RFC 8829
   */
  async restartPeerConnection(targetUserId) {
    const pc = this.peers.get(targetUserId);
    if (!pc || pc.signalingState === 'closed') return;

    try {
      console.log(`[WebRTC] Disparando ICE Restart completo para peer ${targetUserId}...`);
      if (typeof pc.restartIce === 'function') {
        pc.restartIce();
      }
      await this.createOfferForPeer(targetUserId, { iceRestart: true });
    } catch (err) {
      console.warn(`[WebRTC] Falha ao executar restartPeerConnection para ${targetUserId}:`, err.message);
    }
  }

  /**
   * Inicia o processo de oferta SDP (Host para Viewer)
   * Inclui mapeamento de MIDs para diferenciação determinística de transmissões
   */
  async createOfferForPeer(targetUserId, options = {}) {
    const pc = this.getOrCreatePeer(targetUserId);

    try {
      if (pc.signalingState === 'closed') return;

      if (pc.signalingState !== 'stable') {
        console.log(`[WebRTC] Peer ${targetUserId} em estado '${pc.signalingState}'. Aguardando estabilização antes de ofertar...`);
        await new Promise((resolve) => {
          const checkState = () => {
            if (pc.signalingState === 'stable' || pc.signalingState === 'closed') {
              pc.removeEventListener('signalingstatechange', checkState);
              resolve();
            }
          };
          pc.addEventListener('signalingstatechange', checkState);
          setTimeout(() => {
            pc.removeEventListener('signalingstatechange', checkState);
            resolve();
          }, 3000);
        });
      }

      if (pc.signalingState === 'closed') return;

      const offerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        ...options
      };

      // Garante que TODOS os transceivers de vídeo tenham a ordem de codecs configurada antes de gerar o SDP Offer
      const videoTransceivers = pc.getTransceivers().filter(t => {
        const isVideoSender = t.sender && t.sender.track && t.sender.track.kind === 'video';
        const isVideoReceiver = t.receiver && t.receiver.track && t.receiver.track.kind === 'video';
        const isUntrackedVideo = (t.sender && !t.sender.track) || (t.receiver && !t.receiver.track);
        return isVideoSender || isVideoReceiver || isUntrackedVideo;
      });
      for (const vt of videoTransceivers) {
        this.configureCodecPreferences(vt);
      }

      const offer = await pc.createOffer(offerOptions);

      if (pc.signalingState === 'closed') return;

      const mungedOfferSdp = this.mungeSdpBandwidth(offer.sdp, this.targetMaxBitrate);
      await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: mungedOfferSdp }));

      const mediaMids = this.getMediaMids(targetUserId);
      const streamIds = {
        screen: this.mediaManager?.screenStream?.id || null,
        camera: this.mediaManager?.cameraStream?.id || null
      };

      console.log(`[WebRTC] SDP Offer gerada para ${targetUserId}${options.iceRestart ? ' (ICE Restart)' : ''}. MIDs:`, mediaMids);
      this.signaling.send('OFFER', {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp,
        mediaMids,
        streamIds
      }, targetUserId);
    } catch (err) {
      console.error(`[WebRTC] Erro ao criar oferta para ${targetUserId}:`, err);
    }
  }

  /**
   * Processa oferta SDP recebida e devolve resposta SDP (Viewer para Host)
   */
  async handleOffer(fromUserId, offerData) {
    const pc = this.getOrCreatePeer(fromUserId);

    try {
      let sdpInit = offerData;
      if (offerData && offerData.sdp) {
        sdpInit = typeof offerData.sdp === 'object' ? offerData.sdp : { type: 'offer', sdp: offerData.sdp };
      }
      if (!sdpInit.type) sdpInit.type = 'offer';

      // Atualiza mapeamento determinístico de MIDs recebidos na oferta
      if (offerData.mediaMids || offerData.streamIds) {
        let mapping = this.peerMediaMap.get(fromUserId);
        if (!mapping) {
          mapping = { screenMid: null, cameraMid: null, screenStreamId: null, cameraStreamId: null, screenActive: false, cameraActive: false };
          this.peerMediaMap.set(fromUserId, mapping);
        }
        if (offerData.mediaMids) {
          if (offerData.mediaMids.screen !== undefined) mapping.screenMid = offerData.mediaMids.screen;
          if (offerData.mediaMids.camera !== undefined) mapping.cameraMid = offerData.mediaMids.camera;
        }
        if (offerData.streamIds) {
          if (offerData.streamIds.screen) mapping.screenStreamId = offerData.streamIds.screen;
          if (offerData.streamIds.camera) mapping.cameraStreamId = offerData.streamIds.camera;
        }
      }

      if (pc.signalingState === 'have-local-offer') {
        console.log(`[WebRTC] Glare detectado com ${fromUserId}. Fazendo rollback da oferta local...`);
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdpInit));
      console.log(`[WebRTC] SDP Offer de ${fromUserId} aplicada com sucesso.`);

      // Configura preferências de codecs nos transceivers de vídeo recebidos antes de gerar Answer
      const videoTransceivers = pc.getTransceivers().filter(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
      for (const vt of videoTransceivers) {
        this.configureCodecPreferences(vt);
      }

      // Drena candidatos ICE que porventura chegaram antes do SDP Offer
      await this.drainCandidateQueue(fromUserId, pc);

      const answer = await pc.createAnswer();
      const mungedAnswerSdp = this.mungeSdpBandwidth(answer.sdp, this.targetMaxBitrate);
      await pc.setLocalDescription(new RTCSessionDescription({ type: answer.type, sdp: mungedAnswerSdp }));

      console.log(`[WebRTC] SDP Answer gerada para ${fromUserId}. Enviando de volta...`);
      this.signaling.send('ANSWER', {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp
      }, fromUserId);

      // Notifica conclusão de negociação para sincronização imediata dos tiles
      if (this.onNegotiationComplete) {
        this.onNegotiationComplete(fromUserId);
      }
    } catch (err) {
      console.error(`[WebRTC] Erro ao responder oferta de ${fromUserId}:`, err);
    }
  }

  /**
   * Processa a resposta SDP recebida do Viewer (Host)
   */
  async handleAnswer(fromUserId, answerData) {
    const pc = this.peers.get(fromUserId);
    if (!pc) return;

    try {
      let sdpInit = answerData;
      if (answerData && answerData.sdp) {
        sdpInit = typeof answerData.sdp === 'object' ? answerData.sdp : { type: 'answer', sdp: answerData.sdp };
      }
      if (!sdpInit.type) sdpInit.type = 'answer';

      await pc.setRemoteDescription(new RTCSessionDescription(sdpInit));
      console.log(`[WebRTC] SDP Answer de ${fromUserId} aplicada com sucesso.`);

      // Drena candidatos ICE que chegaram antes da resposta
      await this.drainCandidateQueue(fromUserId, pc);

      if (this.onNegotiationComplete) {
        this.onNegotiationComplete(fromUserId);
      }
    } catch (err) {
      console.error(`[WebRTC] Erro ao aplicar SDP Answer de ${fromUserId}:`, err);
    }
  }

  /**
   * Adiciona candidato ICE com suporte a lotes e enfileiramento defensivo
   */
  async handleIceCandidate(fromUserId, candidateData) {
    if (!candidateData) return;

    // Suporte a lote de candidatos agrupados (batch)
    if (Array.isArray(candidateData.candidates)) {
      for (const cand of candidateData.candidates) {
        await this._applySingleIceCandidate(fromUserId, cand);
      }
      return;
    }

    await this._applySingleIceCandidate(fromUserId, candidateData);
  }

  async _applySingleIceCandidate(fromUserId, candidateData) {
    if (!candidateData) return;
    const pc = this.peers.get(fromUserId);

    // Se o peer ainda não existe ou ainda não possui remoteDescription aplicada, enfileira
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      if (!this.candidateQueues.has(fromUserId)) {
        this.candidateQueues.set(fromUserId, []);
      }
      this.candidateQueues.get(fromUserId).push(candidateData);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (err) {
      console.warn(`[WebRTC] Falha ao adicionar ICE Candidate de ${fromUserId}:`, err.message);
    }
  }

  /**
   * Descarrega e aplica todos os candidatos ICE acumulados na fila
   */
  async drainCandidateQueue(userId, pc) {
    const queue = this.candidateQueues.get(userId) || [];
    if (queue.length === 0) return;

    console.log(`[WebRTC] Descarregando ${queue.length} candidatos ICE acumulados para ${userId}...`);
    while (queue.length > 0) {
      const cand = queue.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn(`[WebRTC] Erro ao aplicar candidato enfileirado para ${userId}:`, err.message);
      }
    }
  }

  closePeer(targetUserId) {
    const pc = this.peers.get(targetUserId);
    if (pc) {
      pc.close();
      this.peers.delete(targetUserId);
    }
    this.candidateQueues.delete(targetUserId);
    this.remoteStreams.delete(targetUserId);
    this.peerSenders.delete(targetUserId);
    this.remotePeerTracks.delete(targetUserId);
    this.peerMediaMap.delete(targetUserId);
    this.tileStreams.delete(`${targetUserId}:screen`);
    this.tileStreams.delete(`${targetUserId}:camera`);
    console.log(`[WebRTC] Peer ${targetUserId} fechado e limpo.`);
  }

  closeAllPeers() {
    for (const [id, pc] of this.peers.entries()) {
      pc.close();
    }
    this.peers.clear();
    this.candidateQueues.clear();
    this.remoteStreams.clear();
    this.peerSenders.clear();
    this.remotePeerTracks.clear();
    this.peerMediaMap.clear();
    this.remoteStreamByTrackId.clear();
    this.tileStreams.clear();
  }
}
