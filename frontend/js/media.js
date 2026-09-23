/**
 * Gerenciador de Mídia Local (Screen Capture API, Câmera e Microfone)
 * Documentação Arquitetural: Seção 3.A, Seção 5 e Seção 10
 */

export class MediaManager {
  constructor() {
    this.screenStream = null;
    this.cameraStream = null;
    this.micStream = null;
    this.combinedStream = null;
    this.isMuted = false;
    this.onStreamEnded = null;
  }

  /**
   * Solicita captura da tela com fallbacks robustos para garantir fluidez a 60 FPS
   */
  async startScreenCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error(
        'A API getDisplayMedia não é suportada ou requer contexto seguro (HTTPS ou localhost).'
      );
    }

    console.log('[MediaManager] Solicitando captura de tela via getDisplayMedia...');

    let stream = null;

    // Tentativa 1: Captura com vídeo a 60 FPS + áudio do sistema
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 60, max: 60 }
        },
        audio: true
      });
      console.log('[MediaManager] Tela capturada com áudio do sistema.');
    } catch (errAudio) {
      console.warn('[MediaManager] Falha na captura com áudio, tentando apenas vídeo:', errAudio.message);

      // Tentativa 2: Fallback apenas vídeo a 60 FPS
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60, max: 60 }
          },
          audio: false
        });
        console.log('[MediaManager] Tela capturada (apenas vídeo a 60 FPS).');
      } catch (errVideo60) {
        console.warn('[MediaManager] Tentando fallback padrão do navegador:', errVideo60.message);

        // Tentativa 3: Parâmetros padrão do navegador
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true
        });
      }
    }

    this.screenStream = stream;

    // Marca o track como tela para identificação precisa
    const videoTracks = this.screenStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const videoTrack = videoTracks[0];
      videoTrack.contentHint = 'detail'; // Otimização de renderização de tela

      videoTrack.onended = () => {
        console.log('[MediaManager] Compartilhamento de tela encerrado pelo navegador.');
        this.stopScreenCapture();
        if (this.onStreamEnded) {
          this.onStreamEnded();
        }
      };
    }

    // Tenta capturar microfone silenciosamente em background se ainda não ativo
    if (!this.micStream && !this.cameraStream) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('[MediaManager] Microfone local capturado com sucesso.');
      } catch (micErr) {
        console.warn('[MediaManager] Microfone não disponível ou recusado:', micErr.message);
      }
    }

    return this.buildCombinedStream();
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
        videoTracks[0].contentHint = 'motion'; // Otimização de renderização de rosto/movimento
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
    this.buildCombinedStream();
  }

  /**
   * Ativa ou desativa o microfone do usuário
   */
  async toggleMicrophone() {
    const allAudioTracks = this.getAudioTracks();

    if (allAudioTracks.length === 0) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.isMuted = false;
        this.buildCombinedStream();
        return { active: true, muted: false, stream: this.combinedStream };
      } catch (err) {
        console.error('[MediaManager] Erro ao acessar microfone:', err);
        throw err;
      }
    } else {
      this.isMuted = !this.isMuted;
      allAudioTracks.forEach(track => {
        track.enabled = !this.isMuted;
      });
      return { active: true, muted: this.isMuted, stream: this.combinedStream };
    }
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

  hasActiveCamera() {
    return !!this.cameraStream && this.cameraStream.active && (this.getCameraVideoTrack()?.readyState === 'live');
  }

  hasActiveMic() {
    return !!this.micStream && this.micStream.active && (this.getMicAudioTrack()?.readyState === 'live');
  }
}

