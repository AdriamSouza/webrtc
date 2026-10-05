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
      try { return localStorage.getItem('hyperstream_preferred_codec') || 'auto'; } catch (_) { return 'auto'; }
    })();
    this.targetMaxBitrate = 8000000; // 8 Mbps padrão (Ultra 60 FPS)
    this.targetMaxFps = 60; // 60 FPS padrão
  }

  setIceServers(servers) {
    if (Array.isArray(servers) && servers.length > 0) {
      this.iceServers = servers;
    }
  }

  setMediaManager(mediaManager) {
    this.mediaManager = mediaManager;
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
      if (mid) mapping.screenMid = mid;
      if (streamId) mapping.screenStreamId = streamId;
      if (active && !mapping.cameraActive) mapping.screenFirst = true;
    } else if (type === 'camera') {
      mapping.cameraActive = Boolean(active);
      if (mid) mapping.cameraMid = mid;
      if (streamId) mapping.cameraStreamId = streamId;
      if (active && !mapping.screenActive) mapping.screenFirst = false;
    }
  }

  /**
   * Sincroniza tracks com um peer individual
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

    const updateSender = async (key, track, stream, isVideo) => {
      const existingSender = senders[key];
      if (existingSender) {
        if (track && track.readyState === 'live') {
          try {
            console.log(`[WebRTC] Atualizando sender (${key}) com novo track para ${targetUserId}`);
            await existingSender.replaceTrack(track);
            if (isVideo) {
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

    await updateSender('screenVideo', screenVideo, mediaManager.screenStream, true);
    await updateSender('screenAudio', screenAudio, mediaManager.screenStream, false);
    await updateSender('cameraVideo', cameraVideo, mediaManager.cameraStream, true);
    await updateSender('cameraAudio', cameraAudio, mediaManager.cameraStream, false);
    await updateSender('micAudio', micAudio, mediaManager.micStream, false);
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
   * Munging de SDP para sinalizar banda máxima suportada ao BWE (Bandwidth Estimator)
   * Garante que conexões locais e via internet não fiquem presas aos 2.5 Mbps padrão
   */
  mungeSdpBandwidth(sdp, bitrateBps = this.targetMaxBitrate) {
    if (!sdp) return sdp;
    const bps = bitrateBps || 8000000;
    const bitrateKbps = Math.round(bps / 1000);

    let lines = sdp.split('\r\n');
    let inVideo = false;
    let hasAS = false;
    let hasTIAS = false;
    let newLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('m=video')) {
        inVideo = true;
        hasAS = false;
        hasTIAS = false;
        newLines.push(line);
        continue;
      }
      if (line.startsWith('m=') && !line.startsWith('m=video')) {
        inVideo = false;
      }

      if (inVideo) {
        if (line.startsWith('b=AS:')) {
          newLines.push(`b=AS:${bitrateKbps}`);
          hasAS = true;
          continue;
        }
        if (line.startsWith('b=TIAS:')) {
          newLines.push(`b=TIAS:${bps}`);
          hasTIAS = true;
          continue;
        }
        if (line.startsWith('a=') && !hasAS) {
          newLines.push(`b=AS:${bitrateKbps}`);
          newLines.push(`b=TIAS:${bps}`);
          hasAS = true;
          hasTIAS = true;
        }
      }
      newLines.push(line);
    }

    let modified = newLines.join('\r\n');
    modified = modified.replace(/(a=fmtp:\d+ .*)([\r\n]+)/g, (match, p1, p2) => {
      if (!p1.includes('x-google-max-bitrate')) {
        return `${p1};x-google-min-bitrate=2000;x-google-start-bitrate=4000;x-google-max-bitrate=${bitrateKbps}${p2}`;
      }
      return match;
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
   * Retorna a lista de codecs de vídeo disponíveis e suportados pelo dispositivo/navegador
   */
  static getAvailableCodecs() {
    if (typeof RTCRtpReceiver.getCapabilities !== 'function') {
      return [
        { codec: 'H264', label: 'H.264 (AVC)', description: 'Aceleração de hardware universal (NVidia / AMD / Intel)' },
        { codec: 'VP8', label: 'VP8', description: 'Compatibilidade padrão universal' }
      ];
    }

    try {
      const caps = RTCRtpReceiver.getCapabilities('video');
      if (!caps || !caps.codecs) return [];

      const seen = new Set();
      const result = [];

      for (const c of caps.codecs) {
        const mime = c.mimeType.replace(/^video\//i, '').toUpperCase();
        if (!['RTX', 'RED', 'ULPFEC', 'FLEXFEC-03'].includes(mime) && !seen.has(mime)) {
          seen.add(mime);
          let label = mime;
          let description = 'Codec de vídeo WebRTC';
          let badge = '';

          if (mime === 'AV1') {
            label = 'AV1 (Ultra Eficiente / Next-Gen)';
            description = 'Altíssima fidelidade a 60 FPS com bitrate reduzido';
            badge = 'Recomendado';
          } else if (mime === 'H264') {
            label = 'H.264 (Aceleração Nativa GPU)';
            description = 'Aceleração total por hardware em placas NVidia, AMD e Intel';
            badge = 'Mais Rápido';
          } else if (mime === 'VP9') {
            label = 'VP9 (Google)';
            description = 'Excelente fidelidade de cores e transições suaves';
            badge = 'HD';
          } else if (mime === 'VP8') {
            label = 'VP8 (Legado)';
            description = 'Compatibilidade com todos os dispositivos e navegadores';
            badge = 'Básico';
          }

          result.push({ codec: mime, label, description, badge });
        }
      }

      return result;
    } catch (err) {
      console.warn('[WebRTC] Erro ao listar codecs disponíveis:', err);
      return [
        { codec: 'H264', label: 'H.264 (AVC)', description: 'Compatibilidade GPU' },
        { codec: 'AV1', label: 'AV1', description: 'Ultra eficiente' }
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
      const transceivers = pc.getTransceivers().filter(t => t.sender && t.sender.track && t.sender.track.kind === 'video');
      for (const t of transceivers) {
        this.configureCodecPreferences(t);
      }
    }
    await this.renegotiateAllPeers();
  }

  /**
   * Configura preferência de codecs no Transceiver WebRTC conforme seleção do usuário
   */
  configureCodecPreferences(transceiver) {
    if (!transceiver || typeof transceiver.setCodecPreferences !== 'function') {
      return;
    }

    if (typeof RTCRtpReceiver.getCapabilities !== 'function') {
      return;
    }

    try {
      const capabilities = RTCRtpReceiver.getCapabilities('video');
      if (!capabilities || !capabilities.codecs) return;

      const av1Codecs = [];
      const h264Codecs = [];
      const vp9Codecs = [];
      const vp8Codecs = [];
      const otherCodecs = [];

      for (const codec of capabilities.codecs) {
        const mime = codec.mimeType.toLowerCase();
        if (mime === 'video/av1') {
          av1Codecs.push(codec);
        } else if (mime === 'video/h264') {
          h264Codecs.push(codec);
        } else if (mime === 'video/vp9') {
          vp9Codecs.push(codec);
        } else if (mime === 'video/vp8') {
          vp8Codecs.push(codec);
        } else {
          otherCodecs.push(codec);
        }
      }

      const pref = (this.preferredCodec || 'auto').toUpperCase();
      let preferredOrder = [];

      if (pref === 'AV1') {
        preferredOrder = [...av1Codecs, ...h264Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      } else if (pref === 'H264') {
        preferredOrder = [...h264Codecs, ...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      } else if (pref === 'VP9') {
        preferredOrder = [...vp9Codecs, ...av1Codecs, ...h264Codecs, ...vp8Codecs, ...otherCodecs];
      } else if (pref === 'VP8') {
        preferredOrder = [...vp8Codecs, ...h264Codecs, ...av1Codecs, ...otherCodecs];
      } else {
        // Modo Automático: AV1 prioritário se disponível, senão H.264
        preferredOrder = [...av1Codecs, ...h264Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      }

      if (preferredOrder.length > 0) {
        transceiver.setCodecPreferences(preferredOrder);
        console.log(`[WebRTC] Ordem de codecs aplicada (${pref}): 1º ${preferredOrder[0]?.mimeType}`);
      }
    } catch (err) {
      console.warn('[WebRTC] Não foi possível definir preferência de codecs (usando padrão):', err.message);
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

    // Disparo de candidatos ICE locais para o peer através da sinalização
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send('ICE_CANDIDATE', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate, targetUserId);
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
        console.warn(`[WebRTC] Conexão com ${targetUserId} falhou. Tentando reconexão ICE...`);
        pc.restartIce();
      } else if (pc.connectionState === 'closed') {
        this.closePeer(targetUserId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state com ${targetUserId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(targetUserId, 'connected');
        }
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

    if (videoTransceivers.length === 0) return null;

    // Se só há 1 transceiver de vídeo ativo
    if (videoTransceivers.length === 1) {
      return videoTransceivers[0].receiver.track;
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

    return videoTransceivers[0]?.receiver?.track || null;
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
   * Inicia o processo de oferta SDP (Host para Viewer)
   * Inclui mapeamento de MIDs para diferenciação determinística de transmissões
   */
  async createOfferForPeer(targetUserId) {
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

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      if (pc.signalingState === 'closed') return;

      const mungedOfferSdp = this.mungeSdpBandwidth(offer.sdp, this.targetMaxBitrate);
      await pc.setLocalDescription(new RTCSessionDescription({ type: offer.type, sdp: mungedOfferSdp }));

      const mediaMids = this.getMediaMids(targetUserId);
      const streamIds = {
        screen: this.mediaManager?.screenStream?.id || null,
        camera: this.mediaManager?.cameraStream?.id || null
      };

      console.log(`[WebRTC] SDP Offer gerada para ${targetUserId}. MIDs:`, mediaMids);
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
   * Adiciona candidato ICE com enfileiramento defensivo caso remoteDescription ainda não esteja pronta
   */
  async handleIceCandidate(fromUserId, candidateData) {
    const pc = this.peers.get(fromUserId);

    // Se o peer ainda não existe ou ainda não possui remoteDescription aplicada, enfileira
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      if (!this.candidateQueues.has(fromUserId)) {
        this.candidateQueues.set(fromUserId, []);
      }
      this.candidateQueues.get(fromUserId).push(candidateData);
      console.log(`[WebRTC] Candidato ICE de ${fromUserId} enfileirado (aguardando remoteDescription)`);
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
