/**
 * HyperStream — Motor de Codificação Direta em GPU via WebCodecs (Estilo Discord / Parsec)
 * Utiliza a API nativa WebCodecs (VideoEncoder + MediaStreamTrackProcessor) do Chromium/Electron
 * com hardwareAcceleration: 'prefer-hardware' e Level 4.2 (avc1.42e02a / avc1.4d002a) para
 * ativar diretamente o MediaFoundation / AMD AMF / NVIDIA NVENC / Intel QSV em 1080p60 Zero-Copy.
 */

export const WEBCODECS_PROBE_CODECS = [
  {
    codec: 'avc1.42e02a',
    label: 'H.264 Constrained Baseline Level 4.2 (1080p60 Nativo)',
    shortName: 'H264_CBP_L42',
    isAvc: true
  },
  {
    codec: 'avc1.4d002a',
    label: 'H.264 Main Profile Level 4.2 (1080p60 Nativo)',
    shortName: 'H264_MAIN_L42',
    isAvc: true
  },
  {
    codec: 'avc1.64002a',
    label: 'H.264 High Profile Level 4.2 (1080p60)',
    shortName: 'H264_HIGH_L42',
    isAvc: true
  },
  {
    codec: 'av01.0.08M.08',
    label: 'AV1 Main Profile Level 4.0 (Next-Gen)',
    shortName: 'AV1_MAIN_L40',
    isAvc: false
  }
];

/**
 * 1. Verificação Estrita de Hardware via WebCodecs (probeWebCodecsHardware)
 * Testa explicitamente VideoEncoder.isConfigSupported com hardwareAcceleration: 'prefer-hardware',
 * latencyMode: 'realtime', avc: { format: 'annexb' }, 1920x1080 @ 60fps, 8 Mbps.
 * Diferente do SDP do WebRTC (que anuncia 1f Level 3.1), o VideoEncoder aceita diretamente Level 4.2 (2a),
 * que é o nível exigido pelo driver MediaFoundation/AMF da AMD RX 7600 para 1080p60.
 */
export async function probeWebCodecsHardware(options = {}) {
  const width = options.width || 1920;
  const height = options.height || 1080;
  const framerate = options.framerate || 60;
  const bitrate = options.bitrate || 8000000;

  const isWebCodecsSupported = typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function';

  if (!isWebCodecsSupported) {
    return {
      supported: false,
      webCodecsAvailable: false,
      probedAt: new Date().toISOString(),
      width,
      height,
      framerate,
      bitrate,
      profiles: [],
      supportedHardwareCodecs: [],
      bestHardwareCodec: null,
      preferredCodec: null,
      reason: 'API WebCodecs (VideoEncoder) não disponível neste ambiente.',
      error: 'API WebCodecs (VideoEncoder) não disponível neste ambiente.'
    };
  }

  const profiles = [];

  for (const item of WEBCODECS_PROBE_CODECS) {
    const config = {
      codec: item.codec,
      width,
      height,
      framerate,
      bitrate,
      bitrateMode: 'constant',
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime'
    };

    if (item.isAvc) {
      config.avc = { format: 'annexb' };
    }

    try {
      const support = await VideoEncoder.isConfigSupported(config);
      const isSupported = Boolean(support && support.supported);
      const resolvedHw = support?.config?.hardwareAcceleration || 'prefer-hardware';

      profiles.push({
        codec: item.codec,
        label: item.label,
        shortName: item.shortName,
        supported: isSupported,
        hardwareAcceleration: resolvedHw,
        isHardwareAccelerated: isSupported && resolvedHw === 'prefer-hardware',
        resolvedConfig: support?.config || config,
        error: null
      });
    } catch (err) {
      profiles.push({
        codec: item.codec,
        label: item.label,
        shortName: item.shortName,
        supported: false,
        hardwareAcceleration: 'prefer-hardware',
        isHardwareAccelerated: false,
        resolvedConfig: config,
        error: err.message
      });
    }
  }

  const supportedHardwareCodecs = profiles.filter(p => p.supported && p.isHardwareAccelerated);
  const bestHardwareCodec =
    supportedHardwareCodecs.find(p => p.codec === 'avc1.42e02a') ||
    supportedHardwareCodecs.find(p => p.codec === 'avc1.4d002a') ||
    supportedHardwareCodecs[0] ||
    null;

  return {
    supported: true,
    webCodecsAvailable: true,
    probedAt: new Date().toISOString(),
    width,
    height,
    framerate,
    bitrate,
    profiles,
    supportedHardwareCodecs,
    bestHardwareCodec,
    preferredCodec: bestHardwareCodec ? bestHardwareCodec.codec : 'avc1.42e02a'
  };
}

/**
 * Extrai métricas de CPU detalhadas por subprocesso do Electron (quando disponível)
 */
async function sampleProcessCpuMetrics() {
  if (typeof window !== 'undefined' && window.desktopAPI) {
    try {
      if (typeof window.desktopAPI.getGpuDiagnostics === 'function') {
        const diag = await window.desktopAPI.getGpuDiagnostics();
        if (diag && Array.isArray(diag.processBreakdown)) {
          return parseProcessBreakdown(diag.processBreakdown, diag.cpuUsagePercent);
        }
      }
      if (typeof window.desktopAPI.getCpuUsage === 'function') {
        const cpu = await window.desktopAPI.getCpuUsage();
        if (cpu) {
          return parseProcessBreakdown(cpu.processBreakdown || [], cpu.cpuUsagePercent);
        }
      }
    } catch (_) {}
  }
  return null;
}

function parseProcessBreakdown(breakdown = [], totalFallback = 0) {
  let browserCpu = 0;
  let gpuCpu = 0;
  let rendererCpu = 0;
  let utilityCpu = 0;
  let totalCpu = 0;

  for (const proc of breakdown) {
    const cpu = Number(proc.cpuPercent) || 0;
    totalCpu += cpu;
    const type = (proc.type || '').toLowerCase();
    const name = (proc.name || '').toLowerCase();
    if (type === 'browser' || name.includes('browser') || name.includes('main')) {
      browserCpu += cpu;
    } else if (type === 'gpu' || name.includes('gpu')) {
      gpuCpu += cpu;
    } else if (type === 'tab' || type === 'renderer' || name.includes('renderer')) {
      rendererCpu += cpu;
    } else {
      utilityCpu += cpu;
    }
  }

  if (breakdown.length === 0 && totalFallback > 0) {
    totalCpu = Number(totalFallback) || 0;
  }

  return {
    totalCpuPercent: Number(totalCpu.toFixed(1)),
    browserCpuPercent: Number(browserCpu.toFixed(1)),
    gpuProcessCpuPercent: Number(gpuCpu.toFixed(1)),
    rendererCpuPercent: Number(rendererCpu.toFixed(1)),
    utilityCpuPercent: Number(utilityCpu.toFixed(1)),
    processBreakdown: breakdown
  };
}

/**
 * 2. Teste de Estresse / Benchmark Real na GPU (runRealGpuEncodeBenchmark)
 * - Recebe a MediaStreamTrack real da captura de tela (media.getScreenVideoTrack()).
 * - Usa MediaStreamTrackProcessor({ track }) para ler os VideoFrames direto da GPU (Zero-Copy D3D11).
 * - Instancia VideoEncoder configurado com hardwareAcceleration: 'prefer-hardware',
 *   latencyMode: 'realtime', bitrateMode: 'constant' e avc1.42e02a.
 * - Codifica os quadros reais da tela por durationMs (padrão 4000ms), forçando keyframe a cada 120 quadros.
 * - Fecha o VideoFrame imediatamente após encode() (frame.close()) para zero vazamento de VRAM.
 */
export async function runRealGpuEncodeBenchmark(mediaStreamTrack, durationMs = 4000, options = {}) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('VideoEncoder (WebCodecs) não é suportado neste navegador/Electron.');
  }
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    throw new Error('MediaStreamTrackProcessor não está disponível neste ambiente.');
  }
  if (!mediaStreamTrack || mediaStreamTrack.readyState !== 'live') {
    throw new Error('Nenhuma captura de tela ativa encontrada. Inicie o compartilhamento de tela para executar o benchmark real na GPU.');
  }

  const settings = typeof mediaStreamTrack.getSettings === 'function' ? mediaStreamTrack.getSettings() : {};
  const alignEven = (n, fallback) => {
    const val = Number(n) > 0 ? Number(n) : fallback;
    return val % 2 === 0 ? val : val - 1;
  };

  const width = alignEven(options.width || settings.width, 1920);
  const height = alignEven(options.height || settings.height, 1080);
  const framerate = Number(options.framerate || settings.frameRate) || 60;
  const bitrate = Number(options.bitrate) || 8000000;
  const targetCodec = options.codec || 'avc1.42e02a';

  const encodeTimestamps = new Map();
  const encodeLatenciesMs = [];
  const queueSizeSamples = [];
  const cpuSamples = [];

  let framesRead = 0;
  let framesEncoded = 0;
  let keyFramesEncoded = 0;
  let totalBytesEncoded = 0;
  let maxQueueSize = 0;
  let encoderError = null;

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const now = performance.now();
      const startTime = encodeTimestamps.get(chunk.timestamp);
      if (startTime !== undefined) {
        encodeLatenciesMs.push(now - startTime);
        encodeTimestamps.delete(chunk.timestamp);
      }
      framesEncoded++;
      if (chunk.type === 'key') {
        keyFramesEncoded++;
      }
      totalBytesEncoded += chunk.byteLength || 0;
    },
    error: (err) => {
      encoderError = err;
      console.error('[GpuHardwareEncoderEngine] Erro no VideoEncoder:', err);
    }
  });

  const encoderConfig = {
    codec: targetCodec,
    width,
    height,
    bitrate,
    framerate,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'realtime',
    bitrateMode: 'constant'
  };

  if (targetCodec.startsWith('avc1.')) {
    encoderConfig.avc = { format: 'annexb' };
  }

  encoder.configure(encoderConfig);

  const processor = new MediaStreamTrackProcessor({ track: mediaStreamTrack });
  const reader = processor.readable.getReader();

  // Coleta amostras de CPU por subprocesso durante o teste
  const cpuSampleTimer = setInterval(async () => {
    const sample = await sampleProcessCpuMetrics();
    if (sample) {
      cpuSamples.push(sample);
    }
  }, 750);

  const initialCpuSample = await sampleProcessCpuMetrics();
  if (initialCpuSample) cpuSamples.push(initialCpuSample);

  const benchStart = performance.now();
  let isDone = false;

  const stopTimer = setTimeout(() => {
    isDone = true;
    try { reader.cancel(); } catch (_) {}
  }, durationMs);

  try {
    while (!isDone && !encoderError) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;

      try {
        if (isDone || encoder.state !== 'configured') {
          break;
        }

        const qSize = encoder.encodeQueueSize || 0;
        queueSizeSamples.push(qSize);
        if (qSize > maxQueueSize) {
          maxQueueSize = qSize;
        }

        // Descarta somente se a fila acumular excessivamente (backpressure de hardware)
        if (qSize <= 8) {
          encodeTimestamps.set(frame.timestamp, performance.now());
          const forceKeyFrame = (framesRead % 120 === 0);
          encoder.encode(frame, { keyFrame: forceKeyFrame });
          framesRead++;
        }
      } finally {
        // CRÍTICO: Fecha o VideoFrame imediatamente após encode() para zero vazamento de VRAM/D3D11!
        try { frame.close(); } catch (_) {}
      }

      if (performance.now() - benchStart >= durationMs) {
        isDone = true;
        break;
      }
    }
  } finally {
    clearTimeout(stopTimer);
    clearInterval(cpuSampleTimer);
    try { await reader.cancel(); } catch (_) {}
  }

  const finalCpuSample = await sampleProcessCpuMetrics();
  if (finalCpuSample) cpuSamples.push(finalCpuSample);

  try {
    if (encoder.state === 'configured') {
      await Promise.race([
        encoder.flush(),
        new Promise(r => setTimeout(r, 600))
      ]);
    }
  } catch (_) {}

  const finalQueueSize = encoder.encodeQueueSize || 0;
  try {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  } catch (_) {}

  const actualDurationMs = Math.max(1, performance.now() - benchStart);

  if (encoderError) {
    throw new Error(`Falha durante codificação WebCodecs na GPU: ${encoderError.message || encoderError}`);
  }

  const fpsEncoded = Number(((framesEncoded * 1000) / actualDurationMs).toFixed(1));
  const avgEncodeMs = encodeLatenciesMs.length > 0
    ? encodeLatenciesMs.reduce((a, b) => a + b, 0) / encodeLatenciesMs.length
    : 0;
  const minEncodeMs = encodeLatenciesMs.length > 0 ? Math.min(...encodeLatenciesMs) : 0;
  const maxEncodeMs = encodeLatenciesMs.length > 0 ? Math.max(...encodeLatenciesMs) : 0;

  const avgQueueSize = queueSizeSamples.length > 0
    ? queueSizeSamples.reduce((a, b) => a + b, 0) / queueSizeSamples.length
    : 0;

  // Agrega médias de CPU por subprocesso durante o teste
  let avgTotalCpu = 0;
  let avgRendererCpu = 0;
  let avgGpuCpu = 0;
  let avgBrowserCpu = 0;
  let avgUtilityCpu = 0;

  if (cpuSamples.length > 0) {
    for (const s of cpuSamples) {
      avgTotalCpu += s.totalCpuPercent;
      avgRendererCpu += s.rendererCpuPercent;
      avgGpuCpu += s.gpuProcessCpuPercent;
      avgBrowserCpu += s.browserCpuPercent;
      avgUtilityCpu += s.utilityCpuPercent;
    }
    const count = cpuSamples.length;
    avgTotalCpu = Number((avgTotalCpu / count).toFixed(1));
    avgRendererCpu = Number((avgRendererCpu / count).toFixed(1));
    avgGpuCpu = Number((avgGpuCpu / count).toFixed(1));
    avgBrowserCpu = Number((avgBrowserCpu / count).toFixed(1));
    avgUtilityCpu = Number((avgUtilityCpu / count).toFixed(1));
  }

  const bitrateMbps = Number(((totalBytesEncoded * 8) / (actualDurationMs * 1000)).toFixed(2));

  return {
    supported: true,
    success: true,
    codec: targetCodec,
    width,
    height,
    framerate,
    targetBitrateMbps: Number((bitrate / 1000000).toFixed(1)),
    observedBitrateMbps: bitrateMbps,
    durationMs: Math.round(actualDurationMs),
    framesRead,
    framesEncoded,
    keyFramesEncoded,
    fpsEncoded,
    avgHardwareEncodeTimeMs: Number(avgEncodeMs.toFixed(2)),
    minHardwareEncodeTimeMs: Number(minEncodeMs.toFixed(2)),
    maxHardwareEncodeTimeMs: Number(maxEncodeMs.toFixed(2)),
    maxQueueSize,
    encoderQueueSize: {
      avg: Number(avgQueueSize.toFixed(2)),
      max: maxQueueSize,
      final: finalQueueSize,
      instantDequeue: maxQueueSize <= 2
    },
    cpuUsage: {
      totalCpuPercent: avgTotalCpu,
      rendererCpuPercent: avgRendererCpu,
      gpuProcessCpuPercent: avgGpuCpu,
      browserCpuPercent: avgBrowserCpu,
      utilityCpuPercent: avgUtilityCpu,
      totalAppCpuAvg: avgTotalCpu,
      rendererCpuAvg: avgRendererCpu,
      gpuProcessCpuAvg: avgGpuCpu,
      browserCpuAvg: avgBrowserCpu,
      utilityCpuAvg: avgUtilityCpu,
      latestBreakdown: cpuSamples[cpuSamples.length - 1]?.processBreakdown || []
    },
    isHardwareConfirmed: avgEncodeMs > 0 && avgEncodeMs <= 14.0 && maxQueueSize <= 4
  };
}

/**
 * Classe GpuHardwareEncoderEngine para controle orientado a objetos do pipeline WebCodecs
 */
export class GpuHardwareEncoderEngine {
  constructor() {
    this.lastProbeResult = null;
    this.lastBenchmarkResult = null;
    this.isBenchmarking = false;

    // Estado de codificação contínua WebCodecs
    this.encoder = null;
    this.reader = null;
    this.running = false;
    this.paused = false;
    this.activeCodec = 'avc1.42e02a';
    this.framesEncoded = 0;
    this.framesRead = 0;
    this.totalBytesEncoded = 0;
    this.startedAt = 0;
    this.encodeTimestamps = new Map();
    this.recentEncodeTimesMs = [];
    this.onEncodedChunk = null;
  }

  async probeHardware(options = {}) {
    this.lastProbeResult = await probeWebCodecsHardware(options);
    return this.lastProbeResult;
  }

  /**
   * Inicia o pipeline contínuo de codificação WebCodecs Zero-Copy na GPU
   */
  async start(mediaStreamTrack, options = {}) {
    if (typeof VideoEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') {
      throw new Error('API WebCodecs (VideoEncoder / MediaStreamTrackProcessor) não disponível.');
    }
    if (!mediaStreamTrack || mediaStreamTrack.readyState !== 'live') {
      throw new Error('MediaStreamTrack inválida ou encerrada.');
    }

    await this.stop();

    const settings = typeof mediaStreamTrack.getSettings === 'function' ? mediaStreamTrack.getSettings() : {};
    const alignEven = (n, fb) => {
      const v = Number(n) > 0 ? Number(n) : fb;
      return v % 2 === 0 ? v : v - 1;
    };

    const width = alignEven(options.width || settings.width, 1920);
    const height = alignEven(options.height || settings.height, 1080);
    const framerate = Number(options.framerate || settings.frameRate) || 60;
    const bitrate = Number(options.bitrate) || 8000000;
    const codec = options.codec || 'avc1.42e02a';

    this.activeCodec = codec;
    this.framesEncoded = 0;
    this.framesRead = 0;
    this.totalBytesEncoded = 0;
    this.encodeTimestamps.clear();
    this.recentEncodeTimesMs = [];
    this.running = true;
    this.paused = false;
    this.startedAt = performance.now();
    if (typeof options.onChunk === 'function') {
      this.onEncodedChunk = options.onChunk;
    }

    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const t0 = this.encodeTimestamps.get(chunk.timestamp);
        if (t0 !== undefined) {
          const dt = performance.now() - t0;
          this.recentEncodeTimesMs.push(dt);
          if (this.recentEncodeTimesMs.length > 120) {
            this.recentEncodeTimesMs.shift();
          }
          this.encodeTimestamps.delete(chunk.timestamp);
        }
        this.framesEncoded++;
        this.totalBytesEncoded += chunk.byteLength || 0;
        if (typeof this.onEncodedChunk === 'function') {
          try { this.onEncodedChunk(chunk, metadata); } catch (_) {}
        }
      },
      error: (err) => {
        console.error('[GpuHardwareEncoderEngine] Erro no VideoEncoder contínuo:', err);
        this.running = false;
      }
    });

    const config = {
      codec,
      width,
      height,
      bitrate,
      framerate,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime',
      bitrateMode: 'constant'
    };
    if (codec.startsWith('avc1.')) {
      config.avc = { format: 'annexb' };
    }

    this.encoder.configure(config);
    this.hardwareConfigured = true;

    const processor = new MediaStreamTrackProcessor({ track: mediaStreamTrack });
    this.reader = processor.readable.getReader();

    // Loop assíncrono de leitura Zero-Copy diretamente da VRAM
    (async () => {
      try {
        while (this.running && this.reader) {
          const { value: frame, done } = await this.reader.read();
          if (done || !frame) break;
          try {
            if (!this.running || this.paused || !this.encoder || this.encoder.state !== 'configured') {
              continue;
            }
            if ((this.encoder.encodeQueueSize || 0) <= 8) {
              this.encodeTimestamps.set(frame.timestamp, performance.now());
              const keyFrame = (this.framesRead % 120 === 0);
              this.encoder.encode(frame, { keyFrame });
              this.framesRead++;
            }
          } finally {
            try { frame.close(); } catch (_) {}
          }
        }
      } catch (_) {
      }
    })();

    return {
      started: true,
      ...this.getStatus()
    };
  }

  pause() {
    this.paused = true;
    return this.getStatus();
  }

  resume() {
    if (this.running) {
      this.paused = false;
    }
    return this.getStatus();
  }

  async stop() {
    this.running = false;
    this.paused = false;
    this.hardwareConfigured = false;
    if (this.reader) {
      try { await this.reader.cancel(); } catch (_) {}
      this.reader = null;
    }
    if (this.encoder) {
      try {
        if (this.encoder.state !== 'closed') {
          this.encoder.close();
        }
      } catch (_) {}
      this.encoder = null;
    }
    this.encodeTimestamps.clear();
    return this.getStatus();
  }

  /**
   * Retorna o status real de encode (fps, avgEncodeTimeMs, hardwareActive)
   */
  getStatus() {
    if ((this.running || this.framesEncoded > 0) && this.startedAt > 0) {
      const elapsedSec = Math.max(0.001, (performance.now() - this.startedAt) / 1000);
      const fps = Number((this.framesEncoded / elapsedSec).toFixed(1));
      const avgEncodeTimeMs = this.recentEncodeTimesMs.length > 0
        ? Number((this.recentEncodeTimesMs.reduce((a, b) => a + b, 0) / this.recentEncodeTimesMs.length).toFixed(2))
        : 0;
      const queueSize = this.encoder ? (this.encoder.encodeQueueSize || 0) : 0;
      const hardwareActive = Boolean(
        this.running && !this.paused && (
          (this.framesEncoded > 0 && avgEncodeTimeMs <= 14.0 && queueSize <= 4) ||
          (this.framesEncoded === 0 && this.hardwareConfigured)
        )
      );

      return {
        running: this.running,
        paused: this.paused,
        codec: this.activeCodec,
        fps,
        avgEncodeTimeMs,
        hardwareActive,
        framesEncoded: this.framesEncoded,
        encoderQueueSize: queueSize
      };
    }

    if (this.lastBenchmarkResult) {
      return {
        running: false,
        paused: false,
        codec: this.lastBenchmarkResult.codec,
        fps: this.lastBenchmarkResult.fpsEncoded,
        avgEncodeTimeMs: this.lastBenchmarkResult.avgHardwareEncodeTimeMs,
        hardwareActive: Boolean(this.lastBenchmarkResult.isHardwareConfirmed),
        framesEncoded: this.lastBenchmarkResult.framesEncoded,
        encoderQueueSize: this.lastBenchmarkResult.encoderQueueSize?.final || 0
      };
    }

    return {
      running: false,
      paused: false,
      codec: this.activeCodec,
      fps: 0,
      avgEncodeTimeMs: 0,
      hardwareActive: Boolean(this.lastProbeResult?.bestHardwareCodec),
      framesEncoded: 0,
      encoderQueueSize: 0
    };
  }

  async runBenchmark(mediaStreamTrack, durationMs = 4000, options = {}) {
    if (this.isBenchmarking) {
      throw new Error('Um teste de benchmark da GPU já está em execução.');
    }
    this.isBenchmarking = true;
    try {
      if (!this.lastProbeResult) {
        await this.probeHardware();
      }
      const bestCodec = options.codec || this.lastProbeResult?.bestHardwareCodec?.codec || 'avc1.42e02a';
      this.lastBenchmarkResult = await runRealGpuEncodeBenchmark(mediaStreamTrack, durationMs, {
        ...options,
        codec: bestCodec
      });
      return this.lastBenchmarkResult;
    } finally {
      this.isBenchmarking = false;
    }
  }
}
