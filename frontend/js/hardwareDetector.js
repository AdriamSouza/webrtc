/**
 * HyperStream — Detecção Real de Capacidades de Hardware e Seleção Inteligente de Codecs/Encoders
 * Documentação Arquitetural: Seção 1 e Seção 2
 *
 * Responsável por:
 * 1. Mapear fabricante, modelo e arquitetura da GPU (AMD AMF/VCN, NVIDIA NVENC, Intel QSV, Apple VideoToolbox, CPU).
 * 2. Avaliar quais codecs possuem aceleração real por hardware no ambiente Chromium/WebRTC atual.
 * 3. Determinar a ordem ótima de codecs para o WebRTC (setCodecPreferences) conforme o modo (Automático, GPU, CPU).
 * 4. Definir restrições seguras de resolução (4K, 1440p, 1080p, etc.) e taxas de quadros para evitar sobrecarga.
 */

export const HARDWARE_VENDORS = {
  AMD: 'AMD (Radeon / VCN / AMF)',
  NVIDIA: 'NVIDIA (GeForce / RTX / NVENC)',
  INTEL: 'Intel (Arc / Iris / QuickSync)',
  APPLE: 'Apple Silicon (VideoToolbox)',
  UNKNOWN: 'Genérico / Desconhecido'
};

/**
 * Identifica o fabricante e a arquitetura da GPU a partir de informações do sistema ou WebGL
 */
export function identifyGpuVendor(gpuString = '', vendorString = '') {
  const combined = `${gpuString} ${vendorString}`.toLowerCase();

  if (combined.includes('amd') || combined.includes('radeon') || combined.includes('0x1002')) {
    return {
      vendor: 'AMD',
      label: HARDWARE_VENDORS.AMD,
      hwApi: 'AMD AMF / Direct3D 11 / MediaFoundation',
      hasDedicatedHardware: true
    };
  }
  if (combined.includes('nvidia') || combined.includes('geforce') || combined.includes('quadro') || combined.includes('rtx') || combined.includes('gtx') || combined.includes('0x10de')) {
    return {
      vendor: 'NVIDIA',
      label: HARDWARE_VENDORS.NVIDIA,
      hwApi: 'NVIDIA NVENC / Direct3D 11 / MediaFoundation',
      hasDedicatedHardware: true
    };
  }
  if (combined.includes('intel') || combined.includes('arc') || combined.includes('iris') || combined.includes('uhd') || combined.includes('hd graphics') || combined.includes('0x8086')) {
    return {
      vendor: 'INTEL',
      label: HARDWARE_VENDORS.INTEL,
      hwApi: 'Intel QuickSync / Direct3D 11 / MediaFoundation',
      hasDedicatedHardware: true
    };
  }
  if (combined.includes('apple') || combined.includes('m1') || combined.includes('m2') || combined.includes('m3') || combined.includes('m4')) {
    return {
      vendor: 'APPLE',
      label: HARDWARE_VENDORS.APPLE,
      hwApi: 'Apple VideoToolbox',
      hasDedicatedHardware: true
    };
  }

  return {
    vendor: 'UNKNOWN',
    label: HARDWARE_VENDORS.UNKNOWN,
    hwApi: 'Direct3D 11 / MediaFoundation Genérico',
    hasDedicatedHardware: false
  };
}

/**
 * Avalia o suporte real de codificação de cada codec para o hardware e ambiente
 */
export function evaluateCodecCapabilities(gpuInfo = {}, featureStatus = {}) {
  const vendorInfo = identifyGpuVendor(
    gpuInfo.description || gpuInfo.renderer || '',
    gpuInfo.vendor || ''
  );

  const isVideoEncodeAccelerated = featureStatus.video_encode === 'enabled' ||
    featureStatus.video_encode === 'hardware_accelerated' ||
    featureStatus.accelerated_video_encode === 'enabled' ||
    featureStatus.accelerated_video_encode === 'hardware_accelerated';

  // H.264: Quase universalmente acelerado por hardware no Windows via MediaFoundation MFT
  const h264 = {
    codec: 'H264',
    mimeType: 'video/H264',
    hardwareSupported: isVideoEncodeAccelerated,
    hardwareApi: vendorInfo.hwApi,
    softwareFallback: 'OpenH264 (Cisco)',
    recommendedFor60Fps: true,
    statusLabel: isVideoEncodeAccelerated ? 'GPU Hardware Confirmado ⚡' : 'Software (OpenH264) ⚠️',
    description: isVideoEncodeAccelerated
      ? `Aceleração nativa por GPU (${vendorInfo.vendor}) via DirectX 11 / MediaFoundation. Latência ultrabaixa para jogos a 60 FPS.`
      : 'Codificação via processador (OpenH264). Custo moderado de CPU.'
  };

  // AV1: Embora GPUs modernas como AMD RX 7000 e RTX 40 tenham encoder de hardware,
  // o WebRTC do Chromium no Windows não expõe o MFT de AV1 para a maioria dos drivers,
  // operando por padrão via libaom na CPU.
  const isAv1HwExposedInChromium = Boolean(featureStatus.av1_encode_hardware);
  const av1 = {
    codec: 'AV1',
    mimeType: 'video/AV1',
    hardwareSupported: isAv1HwExposedInChromium,
    hardwareApi: isAv1HwExposedInChromium ? `${vendorInfo.vendor} AV1 MFT` : null,
    softwareFallback: 'libaom (Google multi-threaded)',
    recommendedFor60Fps: isAv1HwExposedInChromium,
    statusLabel: isAv1HwExposedInChromium ? 'GPU Hardware ⚡' : 'Software (CPU: libaom) ⚠️',
    description: isAv1HwExposedInChromium
      ? 'Aceleração AV1 nativa por hardware ativa na GPU.'
      : 'No Chromium/WebRTC atual, AV1 opera via software (libaom CPU). Máxima qualidade visual, mas consome alto uso de processador.'
  };

  // VP9: Quase sempre software no Chromium WebRTC (libvpx)
  const vp9 = {
    codec: 'VP9',
    mimeType: 'video/VP9',
    hardwareSupported: false,
    hardwareApi: null,
    softwareFallback: 'libvpx (Google)',
    recommendedFor60Fps: false,
    statusLabel: 'Software (CPU: libvpx) ⚠️',
    description: 'Codificador VP9 por software (libvpx). Ótima fidelidade de cores, uso de CPU moderado a alto.'
  };

  // VP8: Software histórico (libvpx)
  const vp8 = {
    codec: 'VP8',
    mimeType: 'video/VP8',
    hardwareSupported: false,
    hardwareApi: null,
    softwareFallback: 'libvpx (Google)',
    recommendedFor60Fps: false,
    statusLabel: 'Software (CPU: libvpx) ⚠️',
    description: 'Padrão histórico de compatibilidade universal. Codificação leve por software.'
  };

  return {
    vendorInfo,
    isVideoEncodeAccelerated,
    codecs: { H264: h264, AV1: av1, VP9: vp9, VP8: vp8 }
  };
}

/**
 * Determina a ordem prioritária de codecs para o WebRTC (setCodecPreferences)
 * respeitando a preferência do usuário (Auto, GPU, CPU) e os recursos reais do hardware.
 *
 * @param {Object} params
 * @param {string} params.preference - 'auto' | 'gpu' | 'cpu'
 * @param {string} params.preferredCodec - 'auto' | 'H264' | 'AV1' | 'VP9' | 'VP8'
 * @param {Array} params.availableCodecs - Array de codecs do RTCRtpReceiver.getCapabilities('video').codecs
 * @param {Object} params.capabilities - Resultado de evaluateCodecCapabilities()
 * @returns {Object} { preferredOrder, selectedCodec, isHardwareExpected, reason }
 */
export function determineOptimalCodecOrder({
  preference = 'auto',
  preferredCodec = 'auto',
  availableCodecs = [],
  capabilities = {}
}) {
  const normPref = String(preference).toLowerCase();
  const normCodec = String(preferredCodec).toUpperCase();
  const isEncodeHw = capabilities.isVideoEncodeAccelerated !== false;

  // Agrupa os codecs disponíveis por família
  const av1Codecs = [];
  const h264Codecs = [];
  const vp9Codecs = [];
  const vp8Codecs = [];
  const otherCodecs = [];

  for (const c of availableCodecs) {
    const mime = (c.mimeType || '').toLowerCase();
    if (mime === 'video/av1' || mime === 'video/av01') {
      av1Codecs.push(c);
    } else if (mime === 'video/h264') {
      h264Codecs.push(c);
    } else if (mime === 'video/vp9') {
      vp9Codecs.push(c);
    } else if (mime === 'video/vp8') {
      vp8Codecs.push(c);
    } else {
      otherCodecs.push(c);
    }
  }

  let preferredOrder = [];
  let selectedCodec = 'H264';
  let isHardwareExpected = false;
  let reason = '';

  // 1. MODO CPU (Software explícito)
  if (normPref === 'cpu') {
    if (normCodec === 'AV1' && av1Codecs.length > 0) {
      preferredOrder = [...av1Codecs, ...h264Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = 'AV1';
      reason = 'Modo CPU selecionado com AV1: codificação executada pela biblioteca libaom (multi-threaded).';
    } else if (normCodec === 'VP9' && vp9Codecs.length > 0) {
      preferredOrder = [...vp9Codecs, ...av1Codecs, ...h264Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = 'VP9';
      reason = 'Modo CPU selecionado com VP9: codificação executada pela biblioteca libvpx.';
    } else if (normCodec === 'VP8' && vp8Codecs.length > 0) {
      preferredOrder = [...vp8Codecs, ...h264Codecs, ...av1Codecs, ...otherCodecs];
      selectedCodec = 'VP8';
      reason = 'Modo CPU selecionado com VP8: codificação legada via libvpx.';
    } else {
      // Padrão no modo CPU: H.264 via software (OpenH264) ou AV1 libaom
      preferredOrder = [...h264Codecs, ...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = 'H264';
      reason = 'Modo CPU selecionado: codificação prioritária por processador com limites de conservação de energia.';
    }
    isHardwareExpected = false;
  }
  // 2. MODO GPU (Hardware explícito)
  else if (normPref === 'gpu') {
    if (normCodec === 'AV1' && capabilities.codecs?.AV1?.hardwareSupported && av1Codecs.length > 0) {
      preferredOrder = [...av1Codecs, ...h264Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = 'AV1';
      isHardwareExpected = true;
      reason = 'GPU selecionada: codificador AV1 acelerado por hardware ativo.';
    } else if (h264Codecs.length > 0 && isEncodeHw) {
      preferredOrder = [...h264Codecs, ...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = 'H264';
      isHardwareExpected = true;
      if (normCodec === 'AV1' && !capabilities.codecs?.AV1?.hardwareSupported) {
        reason = 'GPU selecionada: H.264 priorizado com aceleração por hardware (NVENC/AMF/DirectX 11), pois o WebRTC do Chromium não disponibiliza encoder AV1 por GPU para este driver.';
      } else {
        reason = 'GPU selecionada: codificação H.264 acelerada por hardware via MediaFoundation / DirectX 11.';
      }
    } else {
      // Fallback seguro se não houver H.264 por hardware
      preferredOrder = [...h264Codecs, ...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = h264Codecs.length > 0 ? 'H264' : (av1Codecs.length > 0 ? 'AV1' : 'VP8');
      isHardwareExpected = false;
      reason = 'Aviso: aceleração por hardware não detectada no ambiente. Operando com codificador de software seguro.';
    }
  }
  // 3. MODO AUTOMÁTICO (Recomendado)
  else {
    // Se o usuário selecionou manualmente um codec específico (ex: AV1 explícito no dropdown de codecs)
    if (normCodec === 'AV1' && av1Codecs.length > 0) {
      preferredOrder = [...av1Codecs, ...h264Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = 'AV1';
      isHardwareExpected = Boolean(capabilities.codecs?.AV1?.hardwareSupported);
      reason = isHardwareExpected
        ? 'AV1 selecionado com aceleração de hardware GPU.'
        : 'AV1 selecionado manualmente: codificação via software libaom (atenção ao uso de CPU).';
    } else if (normCodec === 'VP9' && vp9Codecs.length > 0) {
      preferredOrder = [...vp9Codecs, ...h264Codecs, ...av1Codecs, ...vp8Codecs, ...otherCodecs];
      selectedCodec = 'VP9';
      isHardwareExpected = false;
      reason = 'VP9 selecionado manualmente: codificação via software libvpx.';
    } else if (normCodec === 'VP8' && vp8Codecs.length > 0) {
      preferredOrder = [...vp8Codecs, ...h264Codecs, ...av1Codecs, ...otherCodecs];
      selectedCodec = 'VP8';
      isHardwareExpected = false;
      reason = 'VP8 selecionado manualmente.';
    }
    // Caso padrão do Modo Automático: escolhe a melhor implementação real
    else {
      // Se houver aceleração por GPU no Chromium, H.264 é a escolha de máxima performance (zero CPU, 60 FPS)
      if (isEncodeHw && h264Codecs.length > 0) {
        preferredOrder = [...h264Codecs, ...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
        selectedCodec = 'H264';
        isHardwareExpected = true;
        reason = 'Automático: H.264 selecionado por dispor de aceleração nativa por GPU (DirectX 11 / NVENC / AMF) com baixíssima latência e 60 FPS.';
      } else if (av1Codecs.length > 0) {
        preferredOrder = [...av1Codecs, ...h264Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
        selectedCodec = 'AV1';
        isHardwareExpected = false;
        reason = 'Automático: AV1 selecionado como fallback de alta eficiência (libaom CPU).';
      } else {
        preferredOrder = [...h264Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
        selectedCodec = h264Codecs.length > 0 ? 'H264' : 'VP8';
        isHardwareExpected = false;
        reason = 'Automático: codec padrão WebRTC do sistema.';
      }
    }
  }

  // Garante fallback se a lista filtrada estiver vazia
  if (preferredOrder.length === 0 && availableCodecs.length > 0) {
    preferredOrder = [...availableCodecs];
  }

  return {
    preferredOrder,
    selectedCodec,
    isHardwareExpected,
    reason
  };
}

/**
 * Resoluções e limites de bitrate seguros para streaming
 */
export const STREAM_RESOLUTIONS = {
  '4k': {
    id: '4k',
    label: '4K Ultra HD (3840x2160)',
    width: 3840,
    height: 2160,
    idealBitrate: 18000000,
    maxBitrate: 25000000,
    minBitrate: 8000000,
    requiresGpu: true,
    warning: '4K requer GPU dedicada compatível e conexão com upload acima de 25 Mbps.'
  },
  '1440p': {
    id: '1440p',
    label: '1440p / 2K Quad HD (2560x1440)',
    width: 2560,
    height: 1440,
    idealBitrate: 10000000,
    maxBitrate: 16000000,
    minBitrate: 5000000,
    requiresGpu: true,
    warning: '1440p requer aceleração por hardware GPU e upload acima de 15 Mbps.'
  },
  '1080p': {
    id: '1080p',
    label: '1080p Full HD (1920x1080)',
    width: 1920,
    height: 1080,
    idealBitrate: 6000000,
    maxBitrate: 10000000,
    minBitrate: 3000000,
    requiresGpu: false,
    warning: null
  },
  '720p': {
    id: '720p',
    label: '720p HD (1280x720)',
    width: 1280,
    height: 720,
    idealBitrate: 3000000,
    maxBitrate: 5000000,
    minBitrate: 1500000,
    requiresGpu: false,
    warning: null
  },
  '480p': {
    id: '480p',
    label: '480p SD (854x480)',
    width: 854,
    height: 480,
    idealBitrate: 1200000,
    maxBitrate: 2000000,
    minBitrate: 600000,
    requiresGpu: false,
    warning: null
  },
  'native': {
    id: 'native',
    label: 'Nativa (Original da Tela)',
    width: null,
    height: null,
    idealBitrate: 8000000,
    maxBitrate: 15000000,
    minBitrate: 3000000,
    requiresGpu: false,
    warning: null
  }
};

/**
 * Retorna as constraints de resolução para a API de mídia
 */
export function getResolutionConstraints(resKey) {
  const info = STREAM_RESOLUTIONS[resKey] || STREAM_RESOLUTIONS.native;
  if (!info.width || !info.height) {
    return {};
  }
  return {
    width: { ideal: info.width },
    height: { ideal: info.height }
  };
}
