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

    // Configurações persistentes de áudio (desativada por padrão para simplificar a transmissão)
    this.captureSystemAudio = (() => {
      try { return localStorage.getItem('hyperstream_capture_system_audio') === 'true'; } catch (_) { return false; }
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
    this.systemDataArray = null;
    this.micDataArray = null;
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
    
    // Constraints limpos para getDisplayMedia
    const displayConstraints = {
      video: {
        frameRate: { ideal: fps }
      }
    };

    if (this.captureSystemAudio) {
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
            frameRate: { ideal: fps }
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

    // Configura track de vídeo com taxa de quadros e resolução ajustadas downstream
    const videoTracks = this.screenStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const videoTrack = videoTracks[0];
      videoTrack.contentHint = this.contentHint || 'motion';

      const trackConstraints = {
        frameRate: { ideal: fps }
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

      const screenAudio = this.screenStream.getAudioTracks();
      if (screenAudio.length > 0) tracks.push(...screenAudio);
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

  /**
   * Configura se o áudio do sistema deve ser capturado ao compartilhar a tela
   */
  setCaptureSystemAudio(enabled) {
    this.captureSystemAudio = Boolean(enabled);
    try { localStorage.setItem('hyperstream_capture_system_audio', this.captureSystemAudio); } catch (_) {}
    if (window.desktopAPI && typeof window.desktopAPI.setCaptureAudio === 'function') {
      window.desktopAPI.setCaptureAudio(this.captureSystemAudio);
    }
    const track = this.getScreenAudioTrack();
    if (track) {
      track.enabled = this.captureSystemAudio && !this.systemAudioMuted;
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
    const track = this.getScreenAudioTrack();
    if (!track) {
      this.teardownSystemAudioAnalyser();
      return;
    }
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      this.teardownSystemAudioAnalyser();

      const stream = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(stream);
      this.systemAnalyser = ctx.createAnalyser();
      this.systemAnalyser.fftSize = 128;
      this.systemAnalyser.smoothingTimeConstant = 0.2;
      this.systemDataArray = new Uint8Array(this.systemAnalyser.frequencyBinCount);
      source.connect(this.systemAnalyser);

      // Conexão inaudível (0.00001) para forçar o Chromium a processar continuamente os buffers sem eco
      const dummyGain = ctx.createGain();
      dummyGain.gain.setValueAtTime(0.00001, ctx.currentTime);
      this.systemAnalyser.connect(dummyGain);
      dummyGain.connect(ctx.destination);

      track.onunmute = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      };
    } catch (e) {
      console.warn('[MediaManager] Falha ao configurar analisador de áudio do sistema:', e);
    }
  }

  teardownSystemAudioAnalyser() {
    this.systemAnalyser = null;
    this.systemDataArray = null;
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

    return { systemLevel, micLevel };
  }

  getAudioStatus() {
    const screenAudio = this.getScreenAudioTrack();
    const micAudio = this.getMicAudioTrack();

    return {
      hasSystemAudio: Boolean(screenAudio && screenAudio.readyState === 'live'),
      systemAudioName: screenAudio ? (screenAudio.label || 'Áudio do Sistema / Jogo') : 'Nenhum áudio de tela',
      systemAudioMuted: this.systemAudioMuted,
      captureSystemAudio: this.captureSystemAudio,
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

  getScreenAudioTrack() {
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
    if (this.screenStream) {
      tracks.push(...this.screenStream.getAudioTracks());
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
