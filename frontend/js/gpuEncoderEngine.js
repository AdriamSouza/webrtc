/**
 * HyperStream — Motor de Codificação Direta em GPU via WebCodecs (Estilo Discord / Parsec)
 * Utiliza a API nativa WebCodecs (VideoEncoder + MediaStreamTrackProcessor) do Chromium/Electron
 * com seleção progressiva de candidatos, redimensionamento par automático para Level 4.2 (<= 1920x1080)
 * e validação real de encode por candidato (sem falso positivo do isConfigSupported).
 */

export const WEBCODECS_PROBE_CODECS = [
  {
    codec: 'avc1.42e02a',
    label: 'H.264 Constrained Baseline Level 4.2 (prefer-hardware, sem bitrateMode)',
    shortName: 'H264_CBP_L42_AUTO_BR',
    hardwareAcceleration: 'prefer-hardware',
    isAvc: true
  },
  {
    codec: 'avc1.42e02a',
    label: 'H.264 Constrained Baseline Level 4.2 (prefer-hardware, VBR)',
    shortName: 'H264_CBP_L42_VBR',
    hardwareAcceleration: 'prefer-hardware',
    bitrateMode: 'variable',
    isAvc: true
  },
  {
    codec: 'avc1.42e02a',
    label: 'H.264 Constrained Baseline Level 4.2 (prefer-hardware, CBR)',
    shortName: 'H264_CBP_L42_CBR',
    hardwareAcceleration: 'prefer-hardware',
    bitrateMode: 'constant',
    isAvc: true
  },
  {
    codec: 'avc1.4d002a',
    label: 'H.264 Main Profile Level 4.2 (prefer-hardware)',
    shortName: 'H264_MAIN_L42',
    hardwareAcceleration: 'prefer-hardware',
    isAvc: true
  },
  {
    codec: 'avc1.64002a',
    label: 'H.264 High Profile Level 4.2 (prefer-hardware)',
    shortName: 'H264_HIGH_L42',
    hardwareAcceleration: 'prefer-hardware',
    isAvc: true
  },
  {
    codec: 'avc1.4d0028',
    label: 'H.264 Main Profile Level 4.0 (prefer-hardware)',
    shortName: 'H264_MAIN_L40',
    hardwareAcceleration: 'prefer-hardware',
    isAvc: true
  },
  {
    codec: 'avc1.42e02a',
    label: 'H.264 Constrained Baseline Level 4.2 (no-preference — Diagnóstico)',
    shortName: 'H264_CBP_L42_DIAG_NOPREF',
    hardwareAcceleration: 'no-preference',
    isDiagnosticFallback: true,
    isAvc: true
  }
];

function toEvenDimension(value, fallback = 1920) {
  const num = Math.max(2, Math.floor(Number(value) || fallback));
  return num % 2 === 0 ? num : num - 1;
}

function computeScaled1080pDimensions(width, height) {
  const evenW = toEvenDimension(width, 1920);
  const evenH = toEvenDimension(height, 1080);
  if (evenW <= 1920 && evenH <= 1080) {
    return { width: evenW, height: evenH, scaled: false };
  }
  const scale = Math.min(1920 / evenW, 1080 / evenH);
  const scaledW = toEvenDimension(Math.round(evenW * scale), 1920);
  const scaledH = toEvenDimension(Math.round(evenH * scale), 1080);
  return { width: scaledW, height: scaledH, scaled: true };
}

function buildCandidateDefinitions(width, height, framerate = 60, bitrate = 8_000_000) {
  const w = toEvenDimension(width, 1920);
  const h = toEvenDimension(height, 1080);
  const fps = Number(framerate) || 60;
  const bps = Number(bitrate) || 8_000_000;

  return WEBCODECS_PROBE_CODECS.map((item, idx) => {
    const config = {
      codec: item.codec,
      width: w,
      height: h,
      framerate: fps,
      bitrate: bps,
      hardwareAcceleration: item.hardwareAcceleration || 'prefer-hardware',
      latencyMode: 'realtime',
      avc: { format: 'annexb' }
    };
    if (item.bitrateMode) {
      config.bitrateMode = item.bitrateMode;
    }
    return {
      index: idx + 1,
      codec: item.codec,
      label: item.label,
      shortName: item.shortName,
      hardwareAcceleration: config.hardwareAcceleration,
      bitrateMode: item.bitrateMode || null,
      isDiagnosticFallback: Boolean(item.isDiagnosticFallback),
      width: w,
      height: h,
      config
    };
  });
}

/**
 * 2.1 Seleciona e valida candidatos de configuração para o VideoEncoder.
 * - Força largura/altura pares.
 * - Se width > 1920 ou height > 1080, calcula também versão reduzida proporcional par <= 1920x1080.
 * - Testa primeiro as dimensões nativas; se nenhum candidato for suportado, repete com as reduzidas.
 * - Retorna a LISTA de todos os candidatos suportados na ordem.
 */
export async function pickEncoderConfig(width, height, framerate = 60, bitrate = 8_000_000) {
  if (typeof globalThis.VideoEncoder === 'undefined' || typeof globalThis.VideoEncoder.isConfigSupported !== 'function') {
    return [];
  }

  const nativeW = toEvenDimension(width, 1920);
  const nativeH = toEvenDimension(height, 1080);
  const scaledInfo = computeScaled1080pDimensions(nativeW, nativeH);

  const testDimensionSet = async (targetW, targetH, isScaled) => {
    const candidates = buildCandidateDefinitions(targetW, targetH, framerate, bitrate);
    const supportedList = [];

    for (const cand of candidates) {
      try {
        const res = await globalThis.VideoEncoder.isConfigSupported(cand.config);
        const isSupported = Boolean(res?.supported);
        console.log(
          `[WebCodecs pickEncoderConfig] #${cand.index} codec=${cand.codec} ` +
          `res=${targetW}x${targetH}${isScaled ? ' (scaled<=1080p)' : ''} ` +
          `hw=${cand.hardwareAcceleration} bitrateMode=${cand.bitrateMode || 'omitido'} -> supported=${isSupported}`
        );
        if (isSupported) {
          supportedList.push({
            ...cand,
            scaled: isScaled,
            nativeWidth: nativeW,
            nativeHeight: nativeH,
            encodedWidth: targetW,
            encodedHeight: targetH,
            resolvedConfig: res.config || cand.config
          });
        }
      } catch (err) {
        console.log(
          `[WebCodecs pickEncoderConfig] #${cand.index} codec=${cand.codec} ` +
          `res=${targetW}x${targetH} hw=${cand.hardwareAcceleration} ` +
          `bitrateMode=${cand.bitrateMode || 'omitido'} -> ERRO: ${err.name || 'Error'}: ${err.message}`
        );
      }
    }

    return supportedList;
  };

  const nativeSupported = await testDimensionSet(nativeW, nativeH, false);
  if (nativeSupported.length > 0) {
    return nativeSupported;
  }

  if (scaledInfo.scaled) {
    console.log(
      `[WebCodecs pickEncoderConfig] Nenhum candidato suportado em resolução nativa ${nativeW}x${nativeH}. ` +
      `Repetindo sondagem com dimensões reduzidas proporcionalmente (${scaledInfo.width}x${scaledInfo.height})...`
    );
    return await testDimensionSet(scaledInfo.width, scaledInfo.height, true);
  }

  return [];
}

/**
 * 2.4 Sondagem de candidatos via VideoEncoder.isConfigSupported.
 * Nota técnica: isConfigSupported apenas ecoa o hardwareAcceleration solicitado na config retornada;
 * portanto supported === true NÃO prova aceleração por hardware (apenas que a config é aceita).
 */
export async function probeWebCodecsHardware(options = {}) {
  const width = toEvenDimension(options.width || 1920, 1920);
  const height = toEvenDimension(options.height || 1080, 1080);
  const framerate = options.framerate || 60;
  const bitrate = options.bitrate || 8_000_000;

  if (typeof globalThis.VideoEncoder === 'undefined' || typeof globalThis.VideoEncoder.isConfigSupported !== 'function') {
    return {
      supported: false,
      webCodecsAvailable: false,
      profiles: [],
      bestHardwareCodec: null,
      preferredCodec: null,
      hardwareConfirmedByProbe: false,
      probeDisclaimer: 'VideoEncoder.isConfigSupported não está disponível neste ambiente.',
      reason: 'API WebCodecs (VideoEncoder) não disponível neste navegador/ambiente.'
    };
  }

  const candidates = buildCandidateDefinitions(width, height, framerate, bitrate);
  const profiles = [];

  for (const cand of candidates) {
    try {
      const res = await globalThis.VideoEncoder.isConfigSupported(cand.config);
      const isSupported = Boolean(res && res.supported);
      const echoedHw = res?.config?.hardwareAcceleration || cand.config.hardwareAcceleration;
      const powerEfficient = typeof res?.config?.powerEfficient === 'boolean' ? res.config.powerEfficient : null;

      console.log(
        `[WebCodecs Probe] codec=${cand.codec} bitrateMode=${cand.bitrateMode || 'omitido'} ` +
        `hw=${cand.hardwareAcceleration} -> supported=${isSupported}`
      );

      profiles.push({
        codec: cand.codec,
        label: cand.label,
        shortName: cand.shortName,
        width,
        height,
        framerate,
        bitrate,
        bitrateMode: cand.bitrateMode || null,
        hardwareAcceleration: echoedHw,
        supported: isSupported,
        powerEfficient,
        // Fato técnico #2: isConfigSupported ecoa o hardwareAcceleration passado; não afirma hardware só por supported === true
        isHardwareAccelerated: false,
        requiresBenchmarkForHardwareProof: true,
        isDiagnosticFallback: cand.isDiagnosticFallback,
        resolvedConfig: res?.config || null,
        error: null
      });
    } catch (err) {
      const errMsg = `${err?.name || 'Error'}: ${err?.message || String(err)}`;
      console.log(
        `[WebCodecs Probe] codec=${cand.codec} bitrateMode=${cand.bitrateMode || 'omitido'} ` +
        `hw=${cand.hardwareAcceleration} -> erro=${errMsg}`
      );
      profiles.push({
        codec: cand.codec,
        label: cand.label,
        shortName: cand.shortName,
        width,
        height,
        framerate,
        bitrate,
        bitrateMode: cand.bitrateMode || null,
        hardwareAcceleration: cand.hardwareAcceleration,
        supported: false,
        powerEfficient: null,
        isHardwareAccelerated: false,
        requiresBenchmarkForHardwareProof: true,
        isDiagnosticFallback: cand.isDiagnosticFallback,
        resolvedConfig: null,
        error: errMsg
      });
    }
  }

  const bestCandidate = profiles.find((p) => p.supported && !p.isDiagnosticFallback) ||
                        profiles.find((p) => p.supported) ||
                        null;

  return {
    supported: Boolean(bestCandidate),
    webCodecsAvailable: true,
    profiles,
    bestHardwareCodec: bestCandidate,
    preferredCodec: bestCandidate ? bestCandidate.codec : null,
    hardwareConfirmedByProbe: false,
    probeDisclaimer: 'Nota: isConfigSupported devolve o hardwareAcceleration solicitado. A confirmação real de GPU exige o Teste de Encode (tempo/fila) ou chrome://gpu.',
    reason: bestCandidate
      ? `Configuração aceita por isConfigSupported: ${bestCandidate.label} (${bestCandidate.codec}). Execute o benchmark para comprovar hardware.`
      : 'Nenhum candidato H.264 Level 4.2/4.0 foi aceito por VideoEncoder.isConfigSupported.'
  };
}

/**
 * 2.2 Benchmark Real na GPU via WebCodecs (runRealGpuEncodeBenchmark)
 * - NÃO configura encoder antes de ler o primeiro frame.
 * - Usa track.clone() e encerra o clone no finally.
 * - Cria MediaStreamTrackProcessor({ track: clone }), pega UM reader e reutiliza entre os candidatos.
 * - Lê o primeiro frame para extrair frameW / frameH reais.
 * - Testa candidatos em ordem com um VideoEncoder NOVO por candidato, aguardando até ~1500ms pelo 1º chunk.
 * - Fecha TODO frame lido com frame.close() em bloco finally.
 */
export async function runRealGpuEncodeBenchmark(mediaStreamTrack, durationMs = 4000, options = {}) {
  if (!mediaStreamTrack || mediaStreamTrack.readyState === 'ended') {
    return {
      supported: false,
      success: false,
      frameW: 0,
      frameH: 0,
      attempts: [],
      error: 'Nenhuma MediaStreamTrack de vídeo ativa fornecida para o benchmark da GPU.'
    };
  }

  if (typeof globalThis.VideoEncoder === 'undefined') {
    return {
      supported: false,
      success: false,
      frameW: 0,
      frameH: 0,
      attempts: [],
      error: 'API WebCodecs (VideoEncoder) não está disponível neste ambiente.'
    };
  }

  if (typeof globalThis.MediaStreamTrackProcessor === 'undefined') {
    return {
      supported: false,
      success: false,
      frameW: 0,
      frameH: 0,
      attempts: [],
      error: 'API MediaStreamTrackProcessor não está disponível neste ambiente.'
    };
  }

  const targetBitrate = options.bitrate || 8_000_000;
  const targetFps = options.framerate || 60;
  const keyFrameInterval = options.keyFrameInterval || 120;

  const clone = typeof mediaStreamTrack.clone === 'function'
    ? mediaStreamTrack.clone()
    : mediaStreamTrack;

  let reader = null;
  let pendingFirstFrame = null;
  let activeEncoder = null;

  try {
    const processor = new globalThis.MediaStreamTrackProcessor({ track: clone });
    reader = processor.readable.getReader();

    // 1. Lê o primeiro frame ANTES de configurar qualquer encoder
    const firstRead = await reader.read();
    if (firstRead.done || !firstRead.value) {
      return {
        supported: false,
        success: false,
        frameW: 0,
        frameH: 0,
        attempts: [],
        error: 'A faixa de vídeo não entregou nenhum quadro (stream encerrada ou inativa).'
      };
    }

    pendingFirstFrame = firstRead.value;
    const settings = typeof clone.getSettings === 'function' ? clone.getSettings() : {};
    const frameW = toEvenDimension(
      pendingFirstFrame.displayWidth || pendingFirstFrame.codedWidth || settings.width || 1920,
      1920
    );
    const frameH = toEvenDimension(
      pendingFirstFrame.displayHeight || pendingFirstFrame.codedHeight || settings.height || 1080,
      1080
    );

    // 2. Obtém lista de candidatos suportados para as dimensões reais do frame
    let candidates = await pickEncoderConfig(frameW, frameH, targetFps, targetBitrate);

    // Se a resolução nativa for > 1080p e o isConfigSupported aceitou a nativa,
    // anexa também os candidatos reduzidos (<= 1920x1080) como fallback caso o MFT falhe na criação em >1080p
    const scaledInfo = computeScaled1080pDimensions(frameW, frameH);
    if (scaledInfo.scaled && candidates.length > 0 && !candidates[0].scaled) {
      const scaledCandidates = await pickEncoderConfig(scaledInfo.width, scaledInfo.height, targetFps, targetBitrate);
      for (const sc of scaledCandidates) {
        candidates.push({
          ...sc,
          scaled: true,
          nativeWidth: frameW,
          nativeHeight: frameH,
          encodedWidth: scaledInfo.width,
          encodedHeight: scaledInfo.height
        });
      }
    }

    if (candidates.length === 0) {
      return {
        supported: false,
        success: false,
        frameW,
        frameH,
        encodedWidth: scaledInfo.width,
        encodedHeight: scaledInfo.height,
        attempts: [],
        error: `Nenhum candidato WebCodecs foi aceito por isConfigSupported para ${frameW}x${frameH}.`
      };
    }

    const attempts = [];
    let approvedCandidate = null;
    let streamExhausted = false;

    // Medições do candidato aprovado
    let framesRead = 0;
    let framesEncoded = 0;
    let droppedByBackpressure = 0;
    let totalBytesEncoded = 0;
    let maxQueueSize = 0;
    let queueSamplesSum = 0;
    let queueSamplesCount = 0;
    const encodeDurationsMs = [];
    const frameStartMap = new Map();
    const cpuSamples = [];
    let cpuPollTimer = null;
    let benchmarkStartPerf = 0;

    const getNextFrame = async () => {
      if (pendingFirstFrame) {
        const f = pendingFirstFrame;
        pendingFirstFrame = null;
        return { done: false, value: f };
      }
      return await reader.read();
    };

    // 3. Testa cada candidato suportado em ordem, criando um VideoEncoder NOVO por candidato
    for (const cand of candidates) {
      if (streamExhausted) break;

      let candidateError = null;
      let candidateChunks = 0;
      const candFrameStartMap = new Map();
      const candEncodeDurations = [];
      let candFramesRead = 0;
      let candDropped = 0;
      let candBytes = 0;
      let candMaxQueue = 0;
      let candQueueSum = 0;
      let candQueueCount = 0;

      const encoder = new globalThis.VideoEncoder({
        output: (chunk) => {
          const now = performance.now();
          candidateChunks++;
          candBytes += chunk.byteLength || 0;
          const startTs = candFrameStartMap.get(chunk.timestamp);
          if (startTs !== undefined) {
            candFrameStartMap.delete(chunk.timestamp);
            candEncodeDurations.push(Math.max(0, now - startTs));
          }
        },
        error: (err) => {
          candidateError = err || new Error('Erro assíncrono no VideoEncoder');
          console.warn(
            `[WebCodecs Benchmark] Callback error no candidato ${cand.codec} ` +
            `(${cand.hardwareAcceleration}, bitrateMode=${cand.bitrateMode || 'omitido'}, ${cand.config.width}x${cand.config.height}):`,
            candidateError
          );
        }
      });

      activeEncoder = encoder;

      try {
        encoder.configure(cand.config);
      } catch (syncErr) {
        candidateError = syncErr;
      }

      if (!candidateError && encoder.state === 'configured') {
        // Lê e envia quadros reais aguardando até ~1500ms pelo primeiro chunk de saída
        const probeDeadline = performance.now() + 1500;
        let firstProbeFrameSent = false;

        while (
          !candidateError &&
          encoder.state === 'configured' &&
          candidateChunks === 0 &&
          performance.now() < probeDeadline
        ) {
          const readRes = await Promise.race([
            getNextFrame(),
            new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 400))
          ]);

          if (readRes && readRes.timeout) {
            if (firstProbeFrameSent) {
              try {
                await Promise.race([
                  encoder.flush(),
                  new Promise((resolve) => setTimeout(resolve, 600))
                ]);
              } catch (flushErr) {
                candidateError = candidateError || flushErr;
              }
            }
            continue;
          }

          if (!readRes || readRes.done || !readRes.value) {
            streamExhausted = true;
            break;
          }

          const frame = readRes.value;
          try {
            if (candidateError || encoder.state !== 'configured') {
              break;
            }
            const frameIndex = candFramesRead++;
            const forceKeyFrame = (frameIndex % keyFrameInterval) === 0;
            candFrameStartMap.set(frame.timestamp, performance.now());
            encoder.encode(frame, { keyFrame: forceKeyFrame });
            firstProbeFrameSent = true;

            const qSize = encoder.encodeQueueSize || 0;
            if (qSize > candMaxQueue) candMaxQueue = qSize;
            candQueueSum += qSize;
            candQueueCount++;
          } catch (encErr) {
            candidateError = candidateError || encErr;
          } finally {
            try { frame.close(); } catch (_) {}
          }

          if (firstProbeFrameSent && candidateChunks === 0 && !candidateError && encoder.state === 'configured') {
            try {
              await Promise.race([
                encoder.flush(),
                new Promise((resolve) => setTimeout(resolve, 1200))
              ]);
            } catch (flushErr) {
              candidateError = candidateError || flushErr;
            }
          }
        }
      }

      // Verifica se houve erro, se foi para 'closed' ou se não gerou nenhum chunk
      if (candidateError || encoder.state === 'closed' || candidateChunks === 0) {
        const errName = candidateError?.name || (encoder.state === 'closed' ? 'EncoderClosedError' : 'EncoderTimeoutError');
        const errMessage = candidateError?.message ||
          (encoder.state === 'closed'
            ? 'O VideoEncoder mudou para state="closed" durante a inicialização/encode.'
            : 'Nenhum chunk foi emitido em até 1500ms após configure/encode/flush.');
        const formattedErr = `${errName}: ${errMessage}`;

        attempts.push({
          candidate: {
            codec: cand.codec,
            label: cand.label,
            width: cand.config.width,
            height: cand.config.height,
            hardwareAcceleration: cand.hardwareAcceleration,
            bitrateMode: cand.bitrateMode || 'omitido'
          },
          candidato: `${cand.codec} | hw=${cand.hardwareAcceleration} | bitrateMode=${cand.bitrateMode || 'omitido'} | ${cand.config.width}x${cand.config.height}`,
          error: formattedErr,
          erro: formattedErr
        });

        try {
          if (encoder.state !== 'closed') encoder.close();
        } catch (_) {}
        activeEncoder = null;

        // Se a stream acabou durante o primeiro frame de um mock curto (ex.: 1 frame), não há mais frames para testar
        if (streamExhausted) {
          break;
        }
        continue;
      }

      // 4. Funcionou! Promove este candidato e executa o benchmark pelo restante de durationMs
      approvedCandidate = cand;
      framesRead = candFramesRead;
      framesEncoded = candidateChunks;
      droppedByBackpressure = candDropped;
      totalBytesEncoded = candBytes;
      maxQueueSize = candMaxQueue;
      queueSamplesSum = candQueueSum;
      queueSamplesCount = candQueueCount;
      for (const d of candEncodeDurations) encodeDurationsMs.push(d);
      for (const [k, v] of candFrameStartMap.entries()) frameStartMap.set(k, v);

      // Inicia amostragem de CPU no Electron se disponível
      if (typeof window !== 'undefined' && window.desktopAPI?.getCpuUsage) {
        cpuPollTimer = setInterval(async () => {
          try {
            const sample = await window.desktopAPI.getCpuUsage();
            if (sample && typeof sample.cpuUsagePercent === 'number') {
              cpuSamples.push(sample);
            }
          } catch (_) {}
        }, 500);
      }

      benchmarkStartPerf = performance.now();
      const deadline = benchmarkStartPerf + Math.max(200, durationMs);

      while (performance.now() < deadline && !candidateError && encoder.state === 'configured') {
        const remainingMs = deadline - performance.now();
        if (remainingMs <= 0) break;

        const readResult = await Promise.race([
          getNextFrame(),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), Math.min(250, Math.max(20, remainingMs))))
        ]);

        if (!readResult || readResult.timeout) {
          continue;
        }
        if (readResult.done || !readResult.value) {
          break;
        }

        const frame = readResult.value;
        try {
          const currentQueue = encoder.encodeQueueSize || 0;
          if (currentQueue > maxQueueSize) maxQueueSize = currentQueue;
          queueSamplesSum += currentQueue;
          queueSamplesCount++;

          if (currentQueue > 8) {
            droppedByBackpressure++;
          } else if (encoder.state === 'configured') {
            const frameIndex = framesRead;
            const forceKeyFrame = (frameIndex % keyFrameInterval) === 0;
            candFrameStartMap.set(frame.timestamp, performance.now());
            encoder.encode(frame, { keyFrame: forceKeyFrame });

            const postQueue = encoder.encodeQueueSize || 0;
            if (postQueue > maxQueueSize) maxQueueSize = postQueue;
          }
          framesRead++;
        } catch (loopErr) {
          candidateError = candidateError || loopErr;
        } finally {
          // Fecha o VideoFrame imediatamente após encode() para zero vazamento de VRAM
          try { frame.close(); } catch (_) {}
        }
      }

      if (cpuPollTimer) {
        clearInterval(cpuPollTimer);
        cpuPollTimer = null;
      }

      if (encoder.state === 'configured') {
        try {
          await Promise.race([
            encoder.flush(),
            new Promise((resolve) => setTimeout(resolve, 1000))
          ]);
        } catch (_) {}
      }

      // Sincroniza contadores finais do candidato aprovado
      framesEncoded = candidateChunks;
      totalBytesEncoded = candBytes;
      if (candMaxQueue > maxQueueSize) maxQueueSize = candMaxQueue;
      encodeDurationsMs.length = 0;
      for (const d of candEncodeDurations) encodeDurationsMs.push(d);

      try {
        if (encoder.state !== 'closed') encoder.close();
      } catch (_) {}
      activeEncoder = null;
      break;
    }

    if (!approvedCandidate) {
      const lastAttemptError = attempts.length > 0
        ? attempts[attempts.length - 1].error
        : 'Nenhum candidato WebCodecs conseguiu produzir chunks de vídeo.';
      return {
        supported: false,
        success: false,
        frameW,
        frameH,
        encodedWidth: scaledInfo.width,
        encodedHeight: scaledInfo.height,
        attempts,
        error: `Todos os ${attempts.length} candidato(s) falharam na criação/codificação real. Último erro: ${lastAttemptError}`
      };
    }

    const elapsedMs = Math.max(1, performance.now() - (benchmarkStartPerf || performance.now()));
    const elapsedSec = elapsedMs / 1000;
    const fpsEncoded = Number((framesEncoded / Math.max(0.1, elapsedSec)).toFixed(1));

    const avgHardwareEncodeTimeMs = encodeDurationsMs.length > 0
      ? Number((encodeDurationsMs.reduce((a, b) => a + b, 0) / encodeDurationsMs.length).toFixed(2))
      : 0;
    const minEncodeTimeMs = encodeDurationsMs.length > 0
      ? Number(Math.min(...encodeDurationsMs).toFixed(2))
      : 0;
    const maxEncodeTimeMs = encodeDurationsMs.length > 0
      ? Number(Math.max(...encodeDurationsMs).toFixed(2))
      : 0;
    const avgQueueSize = queueSamplesCount > 0
      ? Number((queueSamplesSum / queueSamplesCount).toFixed(2))
      : 0;

    let avgCpuPercent = null;
    let avgGpuProcessCpuPercent = null;
    let avgRendererCpuPercent = null;
    if (cpuSamples.length > 0) {
      avgCpuPercent = Number((cpuSamples.reduce((acc, s) => acc + (s.cpuUsagePercent || 0), 0) / cpuSamples.length).toFixed(1));
      avgGpuProcessCpuPercent = Number((cpuSamples.reduce((acc, s) => acc + (s.gpuProcessCpuPercent || 0), 0) / cpuSamples.length).toFixed(1));
      avgRendererCpuPercent = Number((cpuSamples.reduce((acc, s) => acc + (s.rendererCpuPercent || 0), 0) / cpuSamples.length).toFixed(1));
    }

    const usedNoPreferenceFallback = Boolean(
      approvedCandidate.hardwareAcceleration === 'no-preference' || approvedCandidate.isDiagnosticFallback
    );

    // isHardwareConfirmed só pode ser true se o candidato aprovado NÃO for o de no-preference,
    // avgEncodeMs for baixo (<= 12ms) E a fila estiver estável (maxQueueSize <= 6)
    const isHardwareConfirmed =
      !usedNoPreferenceFallback &&
      framesEncoded > 0 &&
      avgHardwareEncodeTimeMs <= 12.0 &&
      maxQueueSize <= 6;

    return {
      supported: true,
      success: true,
      codec: approvedCandidate.codec,
      candidateLabel: approvedCandidate.label,
      hardwareAcceleration: approvedCandidate.hardwareAcceleration,
      usedNoPreferenceFallback,
      bitrateMode: approvedCandidate.bitrateMode || 'omitido',
      frameW,
      frameH,
      width: approvedCandidate.config.width,
      height: approvedCandidate.config.height,
      encodedWidth: approvedCandidate.config.width,
      encodedHeight: approvedCandidate.config.height,
      resolutionScaled: Boolean(approvedCandidate.scaled),
      targetFps,
      targetBitrateMbps: Number((targetBitrate / 1_000_000).toFixed(1)),
      durationMs: Math.round(elapsedMs),
      framesRead,
      framesEncoded,
      droppedByBackpressure,
      fpsEncoded,
      avgHardwareEncodeTimeMs,
      minEncodeTimeMs,
      maxEncodeTimeMs,
      maxQueueSize,
      encoderQueueSize: {
        avg: avgQueueSize,
        max: maxQueueSize,
        final: 0,
        instantDequeue: avgQueueSize <= 1.5
      },
      encodedBitrateMbps: Number(((totalBytesEncoded * 8) / elapsedSec / 1_000_000).toFixed(2)),
      cpuUsage: {
        totalPercent: avgCpuPercent,
        gpuProcessPercent: avgGpuProcessCpuPercent,
        rendererPercent: avgRendererCpuPercent
      },
      attempts,
      isHardwareConfirmed,
      encoderError: null,
      verdict: isHardwareConfirmed
        ? `GPU Hardware Confirmado (${approvedCandidate.codec} @ ${approvedCandidate.config.width}x${approvedCandidate.config.height}, ${avgHardwareEncodeTimeMs} ms/frame, ${fpsEncoded} FPS)`
        : usedNoPreferenceFallback
          ? `Fallback Diagnóstico (no-preference) Ativo (${approvedCandidate.codec} @ ${avgHardwareEncodeTimeMs} ms/frame — provável software)`
          : `Codificação concluída (${approvedCandidate.codec} @ ${avgHardwareEncodeTimeMs} ms/frame, fila máx ${maxQueueSize})`
    };
  } finally {
    if (pendingFirstFrame) {
      try { pendingFirstFrame.close(); } catch (_) {}
      pendingFirstFrame = null;
    }
    if (activeEncoder) {
      try {
        if (activeEncoder.state !== 'closed') activeEncoder.close();
      } catch (_) {}
      activeEncoder = null;
    }
    if (reader) {
      try { await reader.cancel(); } catch (_) {}
      try { reader.releaseLock(); } catch (_) {}
    }
    if (clone && clone !== mediaStreamTrack && typeof clone.stop === 'function') {
      try { clone.stop(); } catch (_) {}
    }
  }
}

/**
 * 2.3 Classe GpuHardwareEncoderEngine
 * Lê o primeiro frame real antes de configurar, seleciona candidatos via pickEncoderConfig
 * com dimensões reais e testa cada candidato com um VideoEncoder novo.
 */
export class GpuHardwareEncoderEngine {
  constructor() {
    this.lastProbeResult = null;
    this.lastBenchmarkResult = null;
    this.isBenchmarking = false;

    this.encoder = null;
    this.processor = null;
    this.reader = null;
    this.running = false;
    this.paused = false;
    this.activeCodec = 'avc1.42e02a';
    this.activeCandidate = null;
    this.framesRead = 0;
    this.framesEncoded = 0;
    this.droppedFrames = 0;
    this.encodeDurationsMs = [];
    this.frameTimestamps = new Map();
    this.startedAt = 0;
    this.lastFpsWindowStart = 0;
    this.framesInCurrentWindow = 0;
    this.currentFps = 0;
    this.hardwareActive = false;
    this.lastError = null;
    this.attempts = [];
    this.frameW = 0;
    this.frameH = 0;
    this.encodedWidth = 0;
    this.encodedHeight = 0;
    this._loopPromise = null;
  }

  async probeHardware(options = {}) {
    this.lastProbeResult = await probeWebCodecsHardware(options);
    return this.lastProbeResult;
  }

  async start(mediaStreamTrack, options = {}) {
    if (this.running) {
      await this.stop();
    }

    if (!mediaStreamTrack || mediaStreamTrack.readyState === 'ended') {
      throw new Error('MediaStreamTrack inválida ou encerrada para iniciar o GpuHardwareEncoderEngine.');
    }

    if (typeof globalThis.VideoEncoder === 'undefined' || typeof globalThis.MediaStreamTrackProcessor === 'undefined') {
      throw new Error('WebCodecs (VideoEncoder / MediaStreamTrackProcessor) não suportado neste ambiente.');
    }

    const framerate = options.framerate || 60;
    const bitrate = options.bitrate || 8_000_000;
    const keyFrameInterval = options.keyFrameInterval || 120;
    const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;

    this.framesRead = 0;
    this.framesEncoded = 0;
    this.droppedFrames = 0;
    this.encodeDurationsMs = [];
    this.frameTimestamps.clear();
    this.lastError = null;
    this.attempts = [];
    this.hardwareActive = false;
    this.activeCandidate = null;

    this.processor = new globalThis.MediaStreamTrackProcessor({ track: mediaStreamTrack });
    this.reader = this.processor.readable.getReader();

    // 1. Lê o primeiro frame real ANTES de configurar o encoder
    const firstRead = await this.reader.read();
    if (firstRead.done || !firstRead.value) {
      await this.stop();
      return {
        started: false,
        codec: this.activeCodec,
        hardwareActive: false,
        error: 'A faixa de vídeo não entregou quadros ao iniciar o motor.'
      };
    }

    let pendingFirstFrame = firstRead.value;
    const settings = typeof mediaStreamTrack.getSettings === 'function' ? mediaStreamTrack.getSettings() : {};
    const frameW = toEvenDimension(
      pendingFirstFrame.displayWidth || pendingFirstFrame.codedWidth || options.width || settings.width || 1920,
      1920
    );
    const frameH = toEvenDimension(
      pendingFirstFrame.displayHeight || pendingFirstFrame.codedHeight || options.height || settings.height || 1080,
      1080
    );
    this.frameW = frameW;
    this.frameH = frameH;

    let candidates = await pickEncoderConfig(frameW, frameH, framerate, bitrate);
    const scaledInfo = computeScaled1080pDimensions(frameW, frameH);
    if (scaledInfo.scaled && candidates.length > 0 && !candidates[0].scaled) {
      const scaledCandidates = await pickEncoderConfig(scaledInfo.width, scaledInfo.height, framerate, bitrate);
      for (const sc of scaledCandidates) {
        candidates.push({
          ...sc,
          scaled: true,
          nativeWidth: frameW,
          nativeHeight: frameH,
          encodedWidth: scaledInfo.width,
          encodedHeight: scaledInfo.height
        });
      }
    }

    const getNextFrame = async () => {
      if (pendingFirstFrame) {
        const f = pendingFirstFrame;
        pendingFirstFrame = null;
        return { done: false, value: f };
      }
      return await this.reader.read();
    };

    let approvedEncoder = null;
    let approvedCand = null;
    let streamEndedDuringInit = false;

    try {
      for (const cand of candidates) {
        if (streamEndedDuringInit) break;

        let candError = null;
        let candChunks = 0;

        const encoder = new globalThis.VideoEncoder({
          output: (chunk, meta) => {
            const now = performance.now();
            candChunks++;
            this.framesEncoded++;
            const startTs = this.frameTimestamps.get(chunk.timestamp);
            if (startTs !== undefined) {
              this.frameTimestamps.delete(chunk.timestamp);
              const dur = Math.max(0, now - startTs);
              this.encodeDurationsMs.push(dur);
              if (this.encodeDurationsMs.length > 120) {
                this.encodeDurationsMs.shift();
              }
            }
            this.framesInCurrentWindow++;
            if (now - this.lastFpsWindowStart >= 1000) {
              this.currentFps = Number(((this.framesInCurrentWindow * 1000) / (now - this.lastFpsWindowStart)).toFixed(1));
              this.framesInCurrentWindow = 0;
              this.lastFpsWindowStart = now;
            }
            if (onChunk) {
              try { onChunk(chunk, meta); } catch (_) {}
            }
          },
          error: (err) => {
            candError = err || new Error('Erro no VideoEncoder');
            this.lastError = candError.message || String(candError);
          }
        });

        try {
          encoder.configure(cand.config);
        } catch (syncErr) {
          candError = syncErr;
        }

        if (!candError && encoder.state === 'configured') {
          const readRes = await getNextFrame();
          if (readRes.done || !readRes.value) {
            streamEndedDuringInit = true;
          } else {
            const frame = readRes.value;
            try {
              const idx = this.framesRead++;
              this.frameTimestamps.set(frame.timestamp, performance.now());
              encoder.encode(frame, { keyFrame: (idx % keyFrameInterval) === 0 });
            } catch (encErr) {
              candError = candError || encErr;
            } finally {
              try { frame.close(); } catch (_) {}
            }

            if (!candError && candChunks === 0 && encoder.state === 'configured') {
              try {
                await Promise.race([
                  encoder.flush(),
                  new Promise((resolve) => setTimeout(resolve, 1200))
                ]);
              } catch (flushErr) {
                candError = candError || flushErr;
              }
            }
          }
        }

        if (candError || encoder.state === 'closed' || candChunks === 0) {
          const errText = candError
            ? `${candError.name || 'Error'}: ${candError.message || String(candError)}`
            : 'Nenhum chunk produzido na inicialização';
          this.attempts.push({
            candidate: cand.config,
            error: errText
          });
          try {
            if (encoder.state !== 'closed') encoder.close();
          } catch (_) {}
          continue;
        }

        approvedEncoder = encoder;
        approvedCand = cand;
        break;
      }
    } finally {
      if (pendingFirstFrame) {
        try { pendingFirstFrame.close(); } catch (_) {}
        pendingFirstFrame = null;
      }
    }

    if (!approvedEncoder || !approvedCand) {
      await this.stop();
      return {
        started: false,
        codec: this.activeCodec,
        hardwareActive: false,
        attempts: this.attempts,
        error: this.lastError || 'Nenhum candidato WebCodecs pôde ser iniciado.'
      };
    }

    this.encoder = approvedEncoder;
    this.activeCandidate = approvedCand;
    this.activeCodec = approvedCand.codec;
    this.encodedWidth = approvedCand.config.width;
    this.encodedHeight = approvedCand.config.height;
    this.running = true;
    this.paused = false;
    this.startedAt = performance.now();
    this.lastFpsWindowStart = this.startedAt;
    this.framesInCurrentWindow = this.framesEncoded;
    this.hardwareActive = approvedCand.hardwareAcceleration === 'prefer-hardware' && !approvedCand.isDiagnosticFallback;

    this._loopPromise = (async () => {
      try {
        while (this.running && this.reader) {
          const { done, value: frame } = await this.reader.read();
          if (done || !frame) break;

          try {
            if (!this.running || this.paused || !this.encoder || this.encoder.state !== 'configured') {
              continue;
            }
            if ((this.encoder.encodeQueueSize || 0) > 8) {
              this.droppedFrames++;
              continue;
            }
            const idx = this.framesRead++;
            const forceKeyFrame = (idx % keyFrameInterval) === 0;
            this.frameTimestamps.set(frame.timestamp, performance.now());
            this.encoder.encode(frame, { keyFrame: forceKeyFrame });
          } finally {
            try { frame.close(); } catch (_) {}
          }
        }
      } catch (err) {
        this.lastError = err.message || String(err);
      }
    })();

    return {
      started: true,
      codec: this.activeCodec,
      width: this.encodedWidth,
      height: this.encodedHeight,
      frameW: this.frameW,
      frameH: this.frameH,
      hardwareActive: this.hardwareActive,
      attempts: this.attempts
    };
  }

  pause() {
    if (this.running) {
      this.paused = true;
      this.currentFps = 0;
    }
    return this.getStatus();
  }

  resume() {
    if (this.running && this.paused) {
      this.paused = false;
      this.lastFpsWindowStart = performance.now();
      this.framesInCurrentWindow = 0;
    }
    return this.getStatus();
  }

  async stop() {
    this.running = false;
    this.paused = false;
    this.hardwareActive = false;
    this.currentFps = 0;

    if (this.reader) {
      try { await this.reader.cancel(); } catch (_) {}
      try { this.reader.releaseLock(); } catch (_) {}
      this.reader = null;
    }

    if (this._loopPromise) {
      try { await this._loopPromise; } catch (_) {}
      this._loopPromise = null;
    }

    if (this.encoder) {
      try {
        if (this.encoder.state === 'configured') {
          await Promise.race([
            this.encoder.flush(),
            new Promise((resolve) => setTimeout(resolve, 500))
          ]);
        }
      } catch (_) {}
      try {
        if (this.encoder.state !== 'closed') {
          this.encoder.close();
        }
      } catch (_) {}
      this.encoder = null;
    }

    this.processor = null;
    this.frameTimestamps.clear();
    return this.getStatus();
  }

  getStatus() {
    const avgEncodeTimeMs = this.encodeDurationsMs.length > 0
      ? Number((this.encodeDurationsMs.reduce((a, b) => a + b, 0) / this.encodeDurationsMs.length).toFixed(2))
      : (this.lastBenchmarkResult?.avgHardwareEncodeTimeMs || 0);

    if (this.running) {
      const elapsedSec = Math.max(0.1, (performance.now() - this.startedAt) / 1000);
      const fps = this.paused
        ? 0
        : (this.currentFps > 0 ? this.currentFps : Number((this.framesEncoded / elapsedSec).toFixed(1)));
      const queueSize = this.encoder ? (this.encoder.encodeQueueSize || 0) : 0;
      const hardwareActive = Boolean(
        this.hardwareActive &&
        !this.paused &&
        this.encoder &&
        this.encoder.state === 'configured' &&
        (this.encodeDurationsMs.length === 0 || avgEncodeTimeMs <= 12.0)
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
        codec: this.lastBenchmarkResult.codec || this.activeCodec,
        fps: this.lastBenchmarkResult.fpsEncoded || 0,
        avgEncodeTimeMs: this.lastBenchmarkResult.avgHardwareEncodeTimeMs || 0,
        hardwareActive: Boolean(this.lastBenchmarkResult.isHardwareConfirmed),
        framesEncoded: this.lastBenchmarkResult.framesEncoded || 0,
        encoderQueueSize: this.lastBenchmarkResult.encoderQueueSize?.final || 0
      };
    }

    return {
      running: false,
      paused: false,
      codec: this.activeCodec,
      fps: 0,
      avgEncodeTimeMs: 0,
      hardwareActive: false,
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
      this.lastBenchmarkResult = await runRealGpuEncodeBenchmark(mediaStreamTrack, durationMs, options);
      return this.lastBenchmarkResult;
    } finally {
      this.isBenchmarking = false;
    }
  }
}
