/**
 * Gerenciador de Mídia Local (Screen Capture API, Câmera e Microfone)
 * Suporte a controle seletivo de áudio (Sistema/Jogo vs Microfone), seletor de dispositivos,
 * VU meter em tempo real e configurações adaptativas de resolução/FPS.
 */

export class MediaManager {
  constructor() {
    this.screenStream = null;
    this.cameraStream = null;
    this.micStream = null;
    this.combinedStream = null;
    this.isMuted = false;
    this.onStreamEnded = null;

    // Configurações persistentes de áudio (ativada por padrão para capturar som do sistema normalmente)
    this.captureSystemAudio = (() => {
      try { return localStorage.getItem('hyperstream_capture_system_audio') !== 'false'; } catch (_) { return true; }
    })();
    this.selectedMicDeviceId = (() => {
      try { return localStorage.getItem('hyperstream_mic_device') || 'default'; } catch (_) { return 'default'; }
    })();
    this.echoCancellation = (() => {
      try { return localStorage.getItem('hyperstream_echo_cancel') !== 'false'; } catch (_) { return true; }
    })();
    this.noiseSuppression = (() => {
      try { return localStorage.getItem('hyperstream_noise_suppress') !== 'false'; } catch (_) { return true; }
    })();
    this.autoGainControl = (() => {
      try { return localStorage.getItem('hyperstream_auto_gain') !== 'false'; } catch (_) { return true; }
    })();

    // Estados de mudo específicos
    this.systemAudioMuted = false;
    this.micMuted = false;
    this.gameAudioMuted = false;

    // Modo de áudio do jogo: 'loopback' (WASAPI geral do sistema) ou 'dedicated' (Dispositivo virtual / VB-Cable)
    this.gameAudioMode = (() => {
      try { return localStorage.getItem('hyperstream_game_audio_mode') || 'loopback'; } catch (_) { return 'loopback'; }
    })();
    this.selectedGameAudioDeviceId = (() => {
      try { return localStorage.getItem('hyperstream_game_audio_device') || ''; } catch (_) { return ''; }
    })();
    this.dedicatedGameAudioStream = null;

    // Captura nativa seletiva por processo / WASAPI Loopback (Electron)
    this.processAudioTrack = null;
    this.nativePcmCleanup = null;
    this.nativeAudioDestNode = null;
    this.nativeAudioMixerNode = null;
    this.isNativePcmActive = false;
    this.nextPcmPlayTime = 0;

    // Filtro seletivo de apps carregado do localStorage
    const savedFilter = (() => {
      try {
        const raw = localStorage.getItem('hyperstream_audio_apps_filter');
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    })();
    this.audioFilterMode = savedFilter?.mode || 'all';
    this.disabledAudioApps = savedFilter?.disabledApps || [];

    // Configurações de qualidade de vídeo
    this.targetFps = (() => {
      try { return parseInt(localStorage.getItem('hyperstream_target_fps'), 10) || 60; } catch (_) { return 60; }
    })();
    this.targetResolution = (() => {
      try { return localStorage.getItem('hyperstream_target_res') || 'native'; } catch (_) { return 'native'; }
    })();
    this.contentHint = (() => {
      try { return localStorage.getItem('hyperstream_content_hint') || 'motion'; } catch (_) { return 'motion'; }
    })();

    // Analisadores Web Audio para VU Meter em tempo real
    this.audioContext = null;
    this.systemAnalyser = null;
    this.micAnalyser = null;
    this.gameAudioAnalyser = null;
    this.systemDataArray = null;
    this.micDataArray = null;
    this.gameDataArray = null;
  }

  /**
   * Solicita captura da tela com suporte a resolução, FPS e áudio configuráveis
   */
  async startScreenCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error(
        'A API getDisplayMedia não é suportada ou requer contexto seguro (HTTPS ou localhost).'
      );
    }

    console.log('[MediaManager] Solicitando captura de tela via getDisplayMedia...');

    const fps = this.targetFps || 60;
    
    // Constraints para getDisplayMedia com framerate explícito (ideal e max)
    // O Chromium requer 'max' explícito para não limitar a captura a 30 FPS padrão
    const displayConstraints = {
      video: {
        frameRate: { ideal: fps, max: fps }
      }
    };

    // Recarrega filtros salvos do localStorage para garantir sincronismo com o painel de configurações
    try {
      const raw = localStorage.getItem('hyperstream_audio_apps_filter');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode) this.audioFilterMode = parsed.mode;
        if (Array.isArray(parsed.disabledApps)) this.disabledAudioApps = parsed.disabledApps;
      }
    } catch (_) {}

    const isDesktopApp = typeof window !== 'undefined' && Boolean(window.desktopAPI?.startLoopbackCapture);
    const hasExcludedApps = (this.audioFilterMode === 'selective' && Array.isArray(this.disabledAudioApps) && this.disabledAudioApps.length > 0);

    if (isDesktopApp && this.captureSystemAudio) {
      displayConstraints.audio = false; // Chromium não faz loopback interno (WASAPI captura tudo de forma nativa)
      try {
        const mode = hasExcludedApps ? 'exclude' : 'system';
        let targetApp = hasExcludedApps
          ? (this.disabledAudioApps.find(a => (a.name || a.processName || '').toLowerCase().includes('discord')) || this.disabledAudioApps[0])
          : null;

        await this.startNativePcmAudioStream({
          mode,
          pid: targetApp?.pid || null,
          rootPid: targetApp?.rootPid || targetApp?.pid || null,
          name: targetApp?.name || targetApp?.processName || '',
          processName: targetApp?.processName || ''
        });
      } catch (nativeErr) {
        console.warn('[MediaManager] Falha ao iniciar WASAPI loopback, usando áudio Chromium:', nativeErr);
        displayConstraints.audio = true;
      }
    } else if (this.captureSystemAudio) {
      displayConstraints.audio = true;
    }

    // Chamada com fallback automático caso o áudio falhe no dispositivo
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
    } catch (captureErr) {
      // Se falhou e tinha áudio solicitado via configs, tenta fallback imediato apenas com vídeo
      if (displayConstraints.audio) {
        console.warn('[MediaManager] Falha ao capturar tela com áudio, tentando fallback somente vídeo:', captureErr.message);
        displayConstraints.audio = false;
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: fps, max: fps }
          }
        });
      } else {
        throw captureErr;
      }
    }

    if (!stream) {
      throw new Error('Nenhuma transmissão de tela foi capturada.');
    }

    this.screenStream = stream;

    // Se o áudio nativo filtrado estiver ativo, cancela qualquer track de áudio residual anexado pelo Chromium
    if (this.isNativePcmActive && this.screenStream) {
      this.screenStream.getAudioTracks().forEach(t => {
        t.enabled = false;
        t.stop();
      });
    }

    // Configura track de vídeo com taxa de quadros e resolução ajustadas downstream
    const videoTracks = this.screenStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const videoTrack = videoTracks[0];
      videoTrack.contentHint = this.contentHint || 'motion';

      const trackConstraints = {
        frameRate: { ideal: fps, max: fps }
      };

      if (this.targetResolution === '1080p') {
        trackConstraints.width = { ideal: 1920 };
        trackConstraints.height = { ideal: 1080 };
      } else if (this.targetResolution === '720p') {
        trackConstraints.width = { ideal: 1280 };
        trackConstraints.height = { ideal: 720 };
      } else if (this.targetResolution === '480p') {
        trackConstraints.width = { ideal: 854 };
        trackConstraints.height = { ideal: 480 };
      }

      videoTrack.applyConstraints(trackConstraints).catch(err => {
        console.warn('[MediaManager] Aviso ao aplicar constraints no track:', err.message);
      });

      videoTrack.onended = () => {
        console.log('[MediaManager] Compartilhamento de tela encerrado pelo navegador.');
        this.stopScreenCapture();
        if (this.onStreamEnded) {
          this.onStreamEnded();
        }
      };
    }

    // Configura analisador de áudio do sistema se houver áudio
    this.setupSystemAudioAnalyser();

    // Constrói e sincroniza stream combinado
    this.buildCombinedStream();
    return this.screenStream;
  }

  /**
   * Inicia ou reconfigura a captura de microfone com cancelamento de ruído e seleção de dispositivo
   */
  async startMicrophone(deviceId = null) {
    if (deviceId) {
      this.selectedMicDeviceId = deviceId;
      try { localStorage.setItem('hyperstream_mic_device', deviceId); } catch (_) {}
    }

    const audioConstraints = {
      echoCancellation: this.echoCancellation,
      noiseSuppression: this.noiseSuppression,
      autoGainControl: this.autoGainControl
    };

    if (this.selectedMicDeviceId && this.selectedMicDeviceId !== 'default') {
      audioConstraints.deviceId = { exact: this.selectedMicDeviceId };
    }

    // Encerra stream anterior de mic se houver
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const micTrack = this.getMicAudioTrack();
      if (micTrack) {
        micTrack.enabled = !this.micMuted && !this.isMuted;
      }
      this.setupMicAudioAnalyser();
      console.log(`[MediaManager] Microfone ativado: ${micTrack?.label || 'Padrão'}`);
      this.buildCombinedStream();
      return this.micStream;
    } catch (err) {
      console.warn('[MediaManager] Erro ao iniciar microfone:', err.message);
      throw err;
    }
  }

  /**
   * Lista todos os dispositivos de entrada de áudio (microfones) conectados ao sistema
   */
  async enumerateMicrophones() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Microfone (${d.deviceId.substring(0, 5)})`
        }));
    } catch (err) {
      console.warn('[MediaManager] Erro ao listar microfones:', err);
      return [];
    }
  }

  /**
   * Altera o dispositivo de microfone em tempo real
   */
  async setMicrophoneDevice(deviceId) {
    this.selectedMicDeviceId = deviceId;
    try { localStorage.setItem('hyperstream_mic_device', deviceId); } catch (_) {}
    if (this.hasActiveMic()) {
      await this.startMicrophone(deviceId);
    }
  }

  /**
   * Lista todos os dispositivos de entrada de áudio do sistema (Microfones, Cabos Virtuais, Linhas, Stereo Mix)
   */
  async enumerateAudioInputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Dispositivo de Áudio (${d.deviceId.substring(0, 5)})`
        }));
    } catch (err) {
      console.warn('[MediaManager] Erro ao enumerar dispositivos de áudio:', err);
      return [];
    }
  }

  /**
   * Inicia a captura de áudio dedicado do jogo / cabo virtual (VB-Cable / Stereo Mix / Linha)
   * Captura estéreo 48 kHz sem filtros de voz destrutivos (som puro e cristalino do jogo)
   */
  async startDedicatedGameAudio(deviceId = null) {
    if (deviceId) {
      this.selectedGameAudioDeviceId = deviceId;
      try { localStorage.setItem('hyperstream_game_audio_device', deviceId); } catch (_) {}
    }

    this.stopDedicatedGameAudio();

    if (!this.selectedGameAudioDeviceId) {
      console.log('[MediaManager] Nenhum dispositivo de áudio dedicado especificado.');
      return null;
    }

    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 }
    };

    if (this.selectedGameAudioDeviceId !== 'default') {
      audioConstraints.deviceId = { exact: this.selectedGameAudioDeviceId };
    }

    try {
      console.log(`[MediaManager] Iniciando captura de áudio dedicado de jogo (${this.selectedGameAudioDeviceId})...`);
      this.dedicatedGameAudioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const track = this.getDedicatedGameAudioTrack();
      if (track) {
        track.enabled = !this.gameAudioMuted && !this.systemAudioMuted;
      }
      this.setupGameAudioAnalyser();
      console.log(`[MediaManager] Áudio dedicado de jogo ativo: ${track?.label || 'Dispositivo Virtual'}`);
      this.buildCombinedStream();
      return this.dedicatedGameAudioStream;
    } catch (err) {
      console.warn('[MediaManager] Falha ao iniciar áudio dedicado de jogo:', err.message);
      this.dedicatedGameAudioStream = null;
      throw err;
    }
  }

  /**
   * Interrompe a captura de áudio dedicado de jogo
   */
  stopDedicatedGameAudio() {
    if (this.dedicatedGameAudioStream) {
      this.dedicatedGameAudioStream.getTracks().forEach(t => t.stop());
      this.dedicatedGameAudioStream = null;
    }
    this.teardownGameAudioAnalyser();
    this.buildCombinedStream();
  }

  /**
   * Altera o modo de áudio do jogo ('loopback' ou 'dedicated')
   */
  async setGameAudioMode(mode) {
    this.gameAudioMode = mode === 'dedicated' ? 'dedicated' : 'loopback';
    try { localStorage.setItem('hyperstream_game_audio_mode', this.gameAudioMode); } catch (_) {}
    console.log(`[MediaManager] Modo de áudio do jogo alterado para: ${this.gameAudioMode}`);

    if (this.gameAudioMode === 'dedicated') {
      if (this.selectedGameAudioDeviceId) {
        await this.startDedicatedGameAudio(this.selectedGameAudioDeviceId);
      }
    } else {
      this.stopDedicatedGameAudio();
    }
    this.buildCombinedStream();
  }

  /**
   * Altera o dispositivo de áudio dedicado do jogo
   */
  async setGameAudioDevice(deviceId) {
    this.selectedGameAudioDeviceId = deviceId || '';
    try { localStorage.setItem('hyperstream_game_audio_device', this.selectedGameAudioDeviceId); } catch (_) {}
    if (this.gameAudioMode === 'dedicated' && this.selectedGameAudioDeviceId) {
      await this.startDedicatedGameAudio(this.selectedGameAudioDeviceId);
    }
  }

  /**
   * Muta ou desmuta o áudio dedicado do jogo
   */
  setGameAudioMuted(muted) {
    this.gameAudioMuted = Boolean(muted);
    const track = this.getDedicatedGameAudioTrack();
    if (track) {
      track.enabled = !this.gameAudioMuted && !this.systemAudioMuted;
    }
  }

  /**
   * Ativa ou desativa a câmera (Webcam) do usuário estilo Meet / Discord
   */
  async toggleCamera() {
    if (this.cameraStream && this.cameraStream.active) {
      this.stopCamera();
      return { active: false, stream: null };
    }

    console.log('[MediaManager] Solicitando acesso à câmera e microfone...');
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: true
      });

      const videoTracks = this.cameraStream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks[0].contentHint = 'motion';
      }

      console.log('[MediaManager] Câmera ativada com sucesso.');
      this.buildCombinedStream();
      return { active: true, stream: this.cameraStream };
    } catch (err) {
      console.error('[MediaManager] Falha ao acessar a câmera:', err);
      throw err;
    }
  }

  /**
   * Interrompe a câmera
   */
  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getVideoTracks().forEach(track => track.stop());
      this.cameraStream = null;
      console.log('[MediaManager] Câmera desativada.');
    }
    this.buildCombinedStream();
  }

  /**
   * Constrói e retorna o MediaStream unificado contendo tela, câmera e todas as faixas de áudio
   */
  buildCombinedStream() {
    const tracks = [];

    // Vídeo da tela
    if (this.screenStream && this.screenStream.active) {
      const screenVideoTracks = this.screenStream.getVideoTracks();
      if (screenVideoTracks.length > 0) tracks.push(screenVideoTracks[0]);

      // Áudio de tela (Loopback do sistema, jogos e isolamento de processo)
      if (this.captureSystemAudio) {
        const screenAudio = this.getScreenAudioTrack();
        if (screenAudio) tracks.push(screenAudio);
      }
    }

    // Vídeo da câmera
    if (this.cameraStream && this.cameraStream.active) {
      const camVideoTracks = this.cameraStream.getVideoTracks();
      if (camVideoTracks.length > 0) tracks.push(camVideoTracks[0]);

      const camAudio = this.cameraStream.getAudioTracks();
      if (camAudio.length > 0) tracks.push(...camAudio);
    }

    // Microfone isolado (se não tiver pego pela câmera)
    if (this.micStream && (!this.cameraStream || this.cameraStream.getAudioTracks().length === 0)) {
      const micAudio = this.micStream.getAudioTracks();
      if (micAudio.length > 0) tracks.push(...micAudio);
    }

    this.combinedStream = new MediaStream(tracks);
    return this.combinedStream;
  }

  /**
   * Interrompe a captura de tela
   */
  stopScreenCapture() {
    this.stopNativePcmAudioStream();
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    this.teardownSystemAudioAnalyser();
    this.buildCombinedStream();
  }

  /**
   * Ativa ou desativa o microfone global do usuário
   */
  async toggleMicrophone() {
    const allAudioTracks = this.getAudioTracks();

    if (allAudioTracks.length === 0) {
      try {
        await this.startMicrophone(this.selectedMicDeviceId);
        this.isMuted = false;
        this.micMuted = false;
        this.buildCombinedStream();
        return { active: true, muted: false, stream: this.combinedStream };
      } catch (err) {
        console.error('[MediaManager] Erro ao acessar microfone:', err);
        throw err;
      }
    } else {
      this.isMuted = !this.isMuted;
      this.micMuted = this.isMuted;
      allAudioTracks.forEach(track => {
        track.enabled = !this.isMuted;
      });
      return { active: true, muted: this.isMuted, stream: this.combinedStream };
    }
  }

  /**
   * Muta ou desmuta apenas o áudio do sistema/jogo de forma independente
   */
  setSystemAudioMuted(muted) {
    this.systemAudioMuted = Boolean(muted);
    const track = this.getScreenAudioTrack();
    if (track) {
      track.enabled = !this.systemAudioMuted;
    }
  }

  /**
   * Muta ou desmuta apenas o microfone de forma independente
   */
  setMicMuted(muted) {
    this.micMuted = Boolean(muted);
    const track = this.getMicAudioTrack();
    if (track) {
      track.enabled = !this.micMuted && !this.isMuted;
    }
  }

  async setCaptureSystemAudio(enabled) {
    this.captureSystemAudio = Boolean(enabled);
    try { localStorage.setItem('hyperstream_capture_system_audio', this.captureSystemAudio); } catch (_) {}
    if (window.desktopAPI && typeof window.desktopAPI.setCaptureAudio === 'function') {
      window.desktopAPI.setCaptureAudio(this.captureSystemAudio);
    }

    if (this.screenStream && this.screenStream.active) {
      if (this.captureSystemAudio) {
        if (!this.isNativePcmActive || !this.processAudioTrack || this.processAudioTrack.readyState !== 'live') {
          await this.startNativePcmAudioStream();
        } else {
          this.processAudioTrack.enabled = !this.systemAudioMuted;
        }
      } else {
        const track = this.getScreenAudioTrack();
        if (track) {
          track.enabled = false;
        }
      }
      this.buildCombinedStream();
    }
  }

  /**
   * Inicia a captura nativa de áudio do sistema com isolamento de processo via WASAPI (Desktop)
   */
  async startNativePcmAudioStream(initialOpts = null) {
    if (!window.desktopAPI || typeof window.desktopAPI.startLoopbackCapture !== 'function') {
      return null;
    }

    const hasExcluded = (this.audioFilterMode === 'selective' && Array.isArray(this.disabledAudioApps) && this.disabledAudioApps.length > 0);
    const mode = initialOpts?.mode || (hasExcluded ? 'exclude' : 'system');
    let targetApp = null;
    if (mode === 'exclude') {
      targetApp = (Array.isArray(this.disabledAudioApps) && this.disabledAudioApps.length > 0)
        ? (this.disabledAudioApps.find(a => (a.name || a.processName || '').toLowerCase().includes('discord')) || this.disabledAudioApps[0])
        : null;
    }

    const captureOpts = {
      mode: targetApp ? 'exclude' : 'system',
      pid: targetApp?.pid || initialOpts?.pid || null,
      rootPid: targetApp?.rootPid || initialOpts?.rootPid || targetApp?.pid || null,
      name: targetApp?.name || initialOpts?.name || '',
      processName: targetApp?.processName || initialOpts?.processName || ''
    };

    // Se o pipeline já existe e o track está vivo, apenas troca a captura nativa no Electron sem reiniciar Web Audio
    if (this.isNativePcmActive && this.processAudioTrack && this.processAudioTrack.readyState === 'live') {
      console.log('[MediaManager] Atualizando captura WASAPI dinamicamente ao vivo:', captureOpts);
      this.nextPcmPlayTime = 0;
      await window.desktopAPI.startLoopbackCapture(captureOpts);
      return this.processAudioTrack;
    }

    this.stopNativePcmAudioStream();

    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    this.nativeAudioDestNode = ctx.createMediaStreamDestination();
    this.nativeAudioMixerNode = ctx.createGain();
    this.nativeAudioMixerNode.connect(this.nativeAudioDestNode);
    this.nextPcmPlayTime = 0;

    console.log('[MediaManager] Solicitando LoopbackCapture nativo com:', captureOpts);
    await window.desktopAPI.startLoopbackCapture(captureOpts);

    this.nativePcmCleanup = window.desktopAPI.onAudioPcmChunk((chunk) => {
      if (this.systemAudioMuted || !this.captureSystemAudio || !this.nativeAudioMixerNode) return;
      try {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        if (!bytes || bytes.length < 4) return;

        const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        const numFrames = int16.length / 2;
        if (numFrames <= 0) return;

        const audioBuf = ctx.createBuffer(2, numFrames, 48000);
        const leftChannel = audioBuf.getChannelData(0);
        const rightChannel = audioBuf.getChannelData(1);

        for (let i = 0; i < numFrames; i++) {
          leftChannel[i] = int16[i * 2] / 32768.0;
          rightChannel[i] = int16[i * 2 + 1] / 32768.0;
        }

        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = audioBuf;
        sourceNode.connect(this.nativeAudioMixerNode);

        const now = ctx.currentTime;
        if (this.nextPcmPlayTime < now || this.nextPcmPlayTime > now + 0.25) {
          this.nextPcmPlayTime = now + 0.02;
        }

        sourceNode.start(this.nextPcmPlayTime);
        this.nextPcmPlayTime += audioBuf.duration;
      } catch (err) {
        console.warn('[MediaManager] Erro ao agendar PCM nativo:', err);
      }
    });

    const tracks = this.nativeAudioDestNode.stream.getAudioTracks();
    if (tracks.length > 0) {
      this.processAudioTrack = tracks[0];
      this.processAudioTrack.enabled = !this.systemAudioMuted;
      this.isNativePcmActive = true;
      console.log('[MediaManager] Pipeline nativo de áudio WASAPI configurado com sucesso!');
      this.setupSystemAudioAnalyser();
    }

    return this.processAudioTrack;
  }

  /**
   * Encerra a captura nativa de áudio do sistema
   */
  stopNativePcmAudioStream() {
    if (this.nativePcmCleanup) {
      this.nativePcmCleanup();
      this.nativePcmCleanup = null;
    }
    if (window.desktopAPI && typeof window.desktopAPI.stopLoopbackCapture === 'function') {
      window.desktopAPI.stopLoopbackCapture().catch(() => {});
    }
    if (this.processAudioTrack) {
      this.processAudioTrack.stop();
      this.processAudioTrack = null;
    }
    if (this.nativeAudioMixerNode) {
      try { this.nativeAudioMixerNode.disconnect(); } catch (_) {}
      this.nativeAudioMixerNode = null;
    }
    this.nativeAudioDestNode = null;
    this.isNativePcmActive = false;
    this.nextPcmPlayTime = 0;
  }

  /**
   * Atualiza configurações de filtro seletivo de aplicativos de forma 100% dinâmica em tempo real
   */
  async updateAudioAppFilter({ mode, disabledApps }) {
    this.audioFilterMode = mode || 'all';
    this.disabledAudioApps = disabledApps || [];
    console.log(`[MediaManager] Filtro de aplicativos atualizado: modo=${this.audioFilterMode}, desativados=${this.disabledAudioApps.length}`);

    // Se estiver transmitindo tela ao vivo no app desktop
    if (this.screenStream && this.screenStream.active) {
      const isDesktopApp = typeof window !== 'undefined' && Boolean(window.desktopAPI?.startLoopbackCapture);

      if (isDesktopApp && this.captureSystemAudio) {
        const hasExcludedApps = (this.audioFilterMode === 'selective' && this.disabledAudioApps.length > 0);
        let targetApp = hasExcludedApps
          ? (this.disabledAudioApps.find(a => (a.name || a.processName || '').toLowerCase().includes('discord')) || this.disabledAudioApps[0])
          : null;

        const captureOpts = {
          mode: targetApp ? 'exclude' : 'system',
          pid: targetApp?.pid || null,
          rootPid: targetApp?.rootPid || targetApp?.pid || null,
          name: targetApp?.name || targetApp?.processName || '',
          processName: targetApp?.processName || ''
        };

        if (this.isNativePcmActive && this.processAudioTrack && this.processAudioTrack.readyState === 'live') {
          console.log('[MediaManager] Alternando modo do LoopbackCapture ao vivo para:', captureOpts.mode, captureOpts);
          await window.desktopAPI.startLoopbackCapture(captureOpts);
        } else {
          // Desativa faixas de áudio residuais do Chromium para que apenas o loopback WASAPI filtrado seja ouvido
          this.screenStream.getAudioTracks().forEach(t => {
            t.enabled = false;
            t.stop();
          });
          await this.startNativePcmAudioStream(captureOpts);
        }

        this.setupSystemAudioAnalyser();
        this.buildCombinedStream();
      }
    }
  }

  /**
   * Salva e atualiza parâmetros de qualidade de vídeo
   */
  setVideoQualityConfig({ targetFps, targetResolution, contentHint }) {
    if (targetFps) {
      this.targetFps = parseInt(targetFps, 10);
      try { localStorage.setItem('hyperstream_target_fps', this.targetFps); } catch (_) {}
    }
    if (targetResolution) {
      this.targetResolution = targetResolution;
      try { localStorage.setItem('hyperstream_target_res', this.targetResolution); } catch (_) {}
    }
    if (contentHint) {
      this.contentHint = contentHint;
      try { localStorage.setItem('hyperstream_content_hint', this.contentHint); } catch (_) {}
      const track = this.getScreenVideoTrack();
      if (track) track.contentHint = this.contentHint;
    }
  }

  setFpsPreference(fps) {
    this.targetFps = parseInt(fps, 10) || 60;
    try { localStorage.setItem('hyperstream_target_fps', this.targetFps); } catch (_) {}
    const track = this.getScreenVideoTrack();
    if (track && track.readyState === 'live') {
      track.applyConstraints({ frameRate: { ideal: this.targetFps, max: this.targetFps } }).catch(() => {});
    }
  }

  setResolutionPreference(res) {
    this.targetResolution = res || 'native';
    try { localStorage.setItem('hyperstream_target_res', this.targetResolution); } catch (_) {}
  }

  setContentHint(hint) {
    this.contentHint = hint || 'motion';
    try { localStorage.setItem('hyperstream_content_hint', this.contentHint); } catch (_) {}
    const track = this.getScreenVideoTrack();
    if (track) {
      track.contentHint = this.contentHint;
    }
  }

  stopMicrophone() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    this.teardownMicAudioAnalyser?.();
    this.buildCombinedStream();
  }

  setAudioFilters(filters) {
    return this.setAudioProcessing(filters);
  }

  /**
   * Atualiza filtros de processamento de áudio
   */
  async setAudioProcessing({ echoCancellation, noiseSuppression, autoGainControl }) {
    if (echoCancellation !== undefined) {
      this.echoCancellation = Boolean(echoCancellation);
      try { localStorage.setItem('hyperstream_echo_cancel', this.echoCancellation); } catch (_) {}
    }
    if (noiseSuppression !== undefined) {
      this.noiseSuppression = Boolean(noiseSuppression);
      try { localStorage.setItem('hyperstream_noise_suppress', this.noiseSuppression); } catch (_) {}
    }
    if (autoGainControl !== undefined) {
      this.autoGainControl = Boolean(autoGainControl);
      try { localStorage.setItem('hyperstream_auto_gain', this.autoGainControl); } catch (_) {}
    }

    if (this.hasActiveMic()) {
      await this.startMicrophone(this.selectedMicDeviceId);
    }
  }

  // ========================================================
  // ANALISADORES DE ÁUDIO PARA VU METER (TEMPO REAL)
  // ========================================================
  ensureAudioContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  setupSystemAudioAnalyser() {
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      this.teardownSystemAudioAnalyser();

      this.systemAnalyser = ctx.createAnalyser();
      this.systemAnalyser.fftSize = 128;
      this.systemAnalyser.smoothingTimeConstant = 0.2;
      this.systemDataArray = new Uint8Array(this.systemAnalyser.frequencyBinCount);

      if (this.isNativePcmActive && this.nativeAudioMixerNode) {
        // Conexão direta do áudio WASAPI filtrado ao analisador de VU meter
        this.nativeAudioMixerNode.connect(this.systemAnalyser);
        // Conexão inaudível (0.00001) para forçar o Chromium/WebAudio a processar continuamente os buffers
        const dummyGain = ctx.createGain();
        dummyGain.gain.setValueAtTime(0.00001, ctx.currentTime);
        this.systemAnalyser.connect(dummyGain);
        dummyGain.connect(ctx.destination);
      } else {
        const track = this.getScreenAudioTrack();
        if (!track) {
          this.teardownSystemAudioAnalyser();
          return;
        }
        const stream = new MediaStream([track]);
        const source = ctx.createMediaStreamSource(stream);
        source.connect(this.systemAnalyser);

        // Conexão inaudível (0.00001) para forçar o Chromium a processar continuamente os buffers sem eco
        const dummyGain = ctx.createGain();
        dummyGain.gain.setValueAtTime(0.00001, ctx.currentTime);
        this.systemAnalyser.connect(dummyGain);
        dummyGain.connect(ctx.destination);

        track.onunmute = () => {
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        };
      }
    } catch (e) {
      console.warn('[MediaManager] Falha ao configurar analisador de áudio do sistema:', e);
    }
  }

  teardownSystemAudioAnalyser() {
    this.systemAnalyser = null;
    this.systemDataArray = null;
  }

  setupGameAudioAnalyser() {
    const track = this.getDedicatedGameAudioTrack();
    if (!track) {
      this.teardownGameAudioAnalyser();
      return;
    }
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      this.teardownGameAudioAnalyser();

      const stream = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(stream);
      this.gameAudioAnalyser = ctx.createAnalyser();
      this.gameAudioAnalyser.fftSize = 128;
      this.gameAudioAnalyser.smoothingTimeConstant = 0.2;
      this.gameDataArray = new Uint8Array(this.gameAudioAnalyser.frequencyBinCount);
      source.connect(this.gameAudioAnalyser);

      const dummyGain = ctx.createGain();
      dummyGain.gain.setValueAtTime(0.00001, ctx.currentTime);
      this.gameAudioAnalyser.connect(dummyGain);
      dummyGain.connect(ctx.destination);

      track.onunmute = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      };
    } catch (e) {
      console.warn('[MediaManager] Falha ao configurar analisador de áudio do jogo:', e);
    }
  }

  teardownGameAudioAnalyser() {
    this.gameAudioAnalyser = null;
    this.gameDataArray = null;
  }

  setupMicAudioAnalyser() {
    const track = this.getMicAudioTrack();
    if (!track) {
      this.teardownMicAudioAnalyser();
      return;
    }
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      this.teardownMicAudioAnalyser();

      const stream = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(stream);
      this.micAnalyser = ctx.createAnalyser();
      this.micAnalyser.fftSize = 128;
      this.micAnalyser.smoothingTimeConstant = 0.2;
      this.micDataArray = new Uint8Array(this.micAnalyser.frequencyBinCount);
      source.connect(this.micAnalyser);

      // Conexão inaudível (0.00001) para forçar processamento contínuo
      const dummyGain = ctx.createGain();
      dummyGain.gain.setValueAtTime(0.00001, ctx.currentTime);
      this.micAnalyser.connect(dummyGain);
      dummyGain.connect(ctx.destination);

      track.onunmute = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      };
    } catch (e) {
      console.warn('[MediaManager] Falha ao configurar analisador de microfone:', e);
    }
  }

  teardownMicAudioAnalyser() {
    this.micAnalyser = null;
    this.micDataArray = null;
  }

  async startMicrophonePreview(deviceId = null) {
    if (!this.micStream) {
      await this.startMicrophone(deviceId || this.selectedMicDeviceId);
    } else {
      this.setupMicAudioAnalyser();
    }
    return this.micStream;
  }

  /**
   * Retorna os níveis sonoros instantâneos (0 a 100%) para os medidores visuais
   */
  getAudioMeterLevels() {
    let systemLevel = 0;
    let micLevel = 0;
    let gameLevel = 0;

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    if (this.systemAnalyser && this.systemDataArray && !this.systemAudioMuted) {
      this.systemAnalyser.getByteFrequencyData(this.systemDataArray);
      let max = 0;
      let sum = 0;
      const len = this.systemDataArray.length;
      for (let i = 0; i < len; i++) {
        const val = this.systemDataArray[i];
        if (val > max) max = val;
        sum += val;
      }
      const avg = sum / len;
      systemLevel = Math.min(100, Math.round(((max * 0.75) + (avg * 1.5)) / 255 * 100));
    }

    if (this.gameAudioAnalyser && this.gameDataArray && !this.gameAudioMuted && !this.systemAudioMuted) {
      this.gameAudioAnalyser.getByteFrequencyData(this.gameDataArray);
      let max = 0;
      let sum = 0;
      const len = this.gameDataArray.length;
      for (let i = 0; i < len; i++) {
        const val = this.gameDataArray[i];
        if (val > max) max = val;
        sum += val;
      }
      const avg = sum / len;
      gameLevel = Math.min(100, Math.round(((max * 0.75) + (avg * 1.5)) / 255 * 100));
    }

    if (this.micAnalyser && this.micDataArray && !this.micMuted && !this.isMuted) {
      this.micAnalyser.getByteFrequencyData(this.micDataArray);
      let max = 0;
      let sum = 0;
      const len = this.micDataArray.length;
      for (let i = 0; i < len; i++) {
        const val = this.micDataArray[i];
        if (val > max) max = val;
        sum += val;
      }
      const avg = sum / len;
      micLevel = Math.min(100, Math.round(((max * 0.75) + (avg * 1.5)) / 255 * 100));
    }

    return { systemLevel, micLevel, gameLevel };
  }

  getAudioStatus() {
    const screenAudio = this.getScreenAudioTrack();
    const micAudio = this.getMicAudioTrack();
    const gameAudio = this.getDedicatedGameAudioTrack();

    return {
      hasSystemAudio: Boolean(screenAudio && screenAudio.readyState === 'live'),
      systemAudioName: screenAudio ? (screenAudio.label || 'Áudio do Sistema / Jogo') : 'Nenhum áudio de tela',
      systemAudioMuted: this.systemAudioMuted,
      captureSystemAudio: this.captureSystemAudio,
      gameAudioMode: this.gameAudioMode,
      hasDedicatedGameAudio: Boolean(gameAudio && gameAudio.readyState === 'live'),
      gameAudioName: gameAudio ? (gameAudio.label || 'Dispositivo de Jogo') : 'Nenhum dispositivo dedicado',
      gameAudioMuted: this.gameAudioMuted,
      hasMicAudio: Boolean(micAudio && micAudio.readyState === 'live'),
      micName: micAudio ? (micAudio.label || 'Microfone') : 'Nenhum microfone ativo',
      micMuted: this.micMuted || this.isMuted,
      selectedMicDeviceId: this.selectedMicDeviceId
    };
  }

  getCameraVideoTrack() {
    if (!this.cameraStream) return null;
    const tracks = this.cameraStream.getVideoTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  getCameraAudioTrack() {
    if (!this.cameraStream) return null;
    const tracks = this.cameraStream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  getScreenVideoTrack() {
    if (!this.screenStream) return null;
    const tracks = this.screenStream.getVideoTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  getDedicatedGameAudioTrack() {
    if (!this.dedicatedGameAudioStream) return null;
    const tracks = this.dedicatedGameAudioStream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  getScreenAudioTrack() {
    if (this.gameAudioMode === 'dedicated' && this.dedicatedGameAudioStream) {
      const dedicatedTrack = this.getDedicatedGameAudioTrack();
      if (dedicatedTrack && dedicatedTrack.readyState === 'live') return dedicatedTrack;
    }
    if (this.processAudioTrack && this.processAudioTrack.readyState === 'live') {
      return this.processAudioTrack;
    }
    if (!this.screenStream) return null;
    const tracks = this.screenStream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  getMicAudioTrack() {
    if (!this.micStream) return null;
    const tracks = this.micStream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  getAudioTracks() {
    const tracks = [];
    const screenAudio = this.getScreenAudioTrack();
    if (screenAudio) {
      tracks.push(screenAudio);
    }
    if (this.cameraStream) {
      tracks.push(...this.cameraStream.getAudioTracks());
    }
    if (this.micStream) {
      tracks.push(...this.micStream.getAudioTracks());
    }
    return tracks;
  }

  hasActiveScreenStream() {
    return !!this.screenStream && this.screenStream.active && (this.getScreenVideoTrack()?.readyState === 'live');
  }

  hasActiveScreenAudio() {
    return !!this.screenStream && this.screenStream.active && (this.getScreenAudioTrack()?.readyState === 'live');
  }

  hasActiveCamera() {
    return !!this.cameraStream && this.cameraStream.active && (this.getCameraVideoTrack()?.readyState === 'live');
  }

  hasActiveMic() {
    return !!this.micStream && this.micStream.active && (this.getMicAudioTrack()?.readyState === 'live');
  }
}
