/**
 * HyperStream — Perfis de Qualidade, Detecção de Capacidades WebRTC e Ordenação de Codecs
 */

/**
 * Identifica o fabricante da GPU e a API de codificação de hardware correspondente.
 */
export function identifyGpuVendor(renderer = '', vendor = '') {
  const combined = `${renderer} ${vendor}`.toLowerCase();

  if (combined.includes('amd') || combined.includes('radeon') || combined.includes('advanced micro devices')) {
    return {
      vendor: 'AMD',
      hwApi: 'AMD AMF / VCN (MediaFoundation)',
      hasDedicatedHardware: true,
      renderer: renderer || 'AMD Radeon Graphics'
    };
  }
  if (combined.includes('nvidia') || combined.includes('geforce') || combined.includes('quadro') || combined.includes('rtx') || combined.includes('gtx')) {
    return {
      vendor: 'NVIDIA',
      hwApi: 'NVIDIA NVENC (MediaFoundation)',
      hasDedicatedHardware: true,
      renderer: renderer || 'NVIDIA GeForce Graphics'
    };
  }
  if (combined.includes('intel') || combined.includes('arc') || combined.includes('iris') || combined.includes('uhd graphics') || combined.includes('hd graphics')) {
    return {
      vendor: 'INTEL',
      hwApi: 'Intel QuickSync QSV (MediaFoundation)',
      hasDedicatedHardware: true,
      renderer: renderer || 'Intel Graphics'
    };
  }
  if (combined.includes('apple') || combined.includes('m1') || combined.includes('m2') || combined.includes('m3') || combined.includes('m4')) {
    return {
      vendor: 'APPLE',
      hwApi: 'Apple VideoToolbox',
      hasDedicatedHardware: true,
      renderer: renderer || 'Apple Silicon GPU'
    };
  }

  return {
    vendor: 'UNKNOWN',
    hwApi: 'Generic / Software',
    hasDedicatedHardware: false,
    renderer: renderer || 'Desconhecido'
  };
}

/**
 * Avalia os codecs disponíveis no ambiente WebRTC (RTCRtpSender.getCapabilities('video')).
 */
export function evaluateCodecCapabilities(gpuInfo = {}, featureStatus = {}) {
  const vendorInfo = identifyGpuVendor(gpuInfo.description || gpuInfo.renderer || '', gpuInfo.vendor || '');

  let isVideoEncodeAccelerated = false;
  if (featureStatus.video_encode === 'enabled' || featureStatus.video_encode === 'hardware_accelerated' ||
      featureStatus.accelerated_video_encode === 'enabled' || featureStatus.accelerated_video_encode === 'hardware_accelerated') {
    isVideoEncodeAccelerated = true;
  } else if (featureStatus.video_encode === 'disabled' || featureStatus.accelerated_video_encode === 'disabled') {
    isVideoEncodeAccelerated = false;
  } else {
    isVideoEncodeAccelerated = vendorInfo.hasDedicatedHardware;
  }

  const supported = {
    H264: true,
    AV1: true,
    VP9: true,
    VP8: true
  };
  const rawCodecs = [];

  try {
    if (typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function') {
      const caps = RTCRtpSender.getCapabilities('video');
      if (caps && Array.isArray(caps.codecs) && caps.codecs.length > 0) {
        supported.H264 = false;
        supported.AV1 = false;
        supported.VP9 = false;
        supported.VP8 = false;
        for (const c of caps.codecs) {
          const mime = String(c.mimeType || '').toUpperCase();
          rawCodecs.push(c);
          if (mime === 'VIDEO/H264') supported.H264 = true;
          else if (mime === 'VIDEO/AV1' || mime === 'VIDEO/AV01') supported.AV1 = true;
          else if (mime === 'VIDEO/VP9') supported.VP9 = true;
          else if (mime === 'VIDEO/VP8') supported.VP8 = true;
        }
      }
    }
  } catch (_) {}

  return {
    vendorInfo,
    isVideoEncodeAccelerated,
    supported,
    rawCodecs,
    codecs: {
      H264: { codec: 'H264', mimeType: 'video/H264', available: supported.H264 },
      AV1:  { codec: 'AV1',  mimeType: 'video/AV1',  available: supported.AV1 },
      VP9:  { codec: 'VP9',  mimeType: 'video/VP9',  available: supported.VP9 },
      VP8:  { codec: 'VP8',  mimeType: 'video/VP8',  available: supported.VP8 }
    }
  };
}

/**
 * Extrai informações do profile-level-id e packetization-mode de uma linha fmtp H.264.
 */
export function parseH264ProfileLevel(sdpFmtpLine = '') {
  const fmtp = String(sdpFmtpLine || '');
  const match = fmtp.match(/profile-level-id=([0-9a-fA-F]{6})/i);
  const packetizationMatch = fmtp.match(/packetization-mode=(\d)/i);
  const packetizationMode = packetizationMatch ? packetizationMatch[1] : null;

  if (!match) {
    return {
      profileLevelId: null,
      profileIdc: null,
      levelIdc: null,
      packetizationMode
    };
  }

  const profileLevelId = match[1].toLowerCase();
  const profileIdc = profileLevelId.slice(0, 2);
  const levelHex = profileLevelId.slice(4, 6);
  const levelIdc = parseInt(levelHex, 16);

  return {
    profileLevelId,
    profileIdc,
    levelIdc: Number.isNaN(levelIdc) ? null : levelIdc,
    packetizationMode
  };
}

/**
 * Pontua codecs H.264 para priorizar perfis com suporte nativo por GPU (MediaFoundation MFT):
 * 1º lugar: profile-level-id=42e01f (Constrained Baseline) -> score 10
 * 2º lugar: profile-level-id=4d001f (Main Profile) -> score 20
 * 3º lugar: profile-level-id=640032 (High Profile) -> score 100
 * 4º lugar: profile-level-id=42001f (Baseline unconstrained) -> score 200
 * Penaliza packetization-mode=0 com +5000 e OpenH264 explícito com +8000.
 */
export function scoreH264Candidate(c) {
  const fmtp = (c?.sdpFmtpLine || '').toLowerCase();
  const isMode1 = fmtp.includes('packetization-mode=1');
  const isMode0 = fmtp.includes('packetization-mode=0') || !isMode1;
  const basePenalty = isMode0 ? 5000 : 0;
  const openH264Penalty = String(c?.implementation || '').toLowerCase().includes('openh264') ? 8000 : 0;

  const match = fmtp.match(/profile-level-id=([0-9a-fA-F]{6})/i);
  const pid = match ? match[1].toLowerCase() : '';

  let profileScore = 300;
  if (pid === '42e01f' || pid.startsWith('42e0')) {
    profileScore = 10;
  } else if (pid === '4d001f' || pid.startsWith('4d00')) {
    profileScore = 20;
  } else if (pid === '640032' || pid.startsWith('6400')) {
    profileScore = 100;
  } else if (pid === '42001f' || pid.startsWith('4200')) {
    profileScore = 200;
  }

  const powerBonus = c?.powerEfficient === true ? -5 : 0;
  return basePenalty + openH264Penalty + profileScore + powerBonus;
}

/**
 * Classifica o nome de implementação de encoder ou decoder (getStats) em um rótulo simples:
 * - contém MediaFoundation, ExternalEncoder, ExternalDecoder, NVENC, AMF, QSV, VideoToolbox, VAAPI => "GPU" (verde)
 * - contém OpenH264, libaom, libvpx, dav1d, SW, software => "CPU" (âmbar)
 * - qualquer outro valor => texto cru, sem rótulo
 * - sem tráfego => "aguardando movimento"
 */
export function classifyCodecImplementation(implName, hasTraffic = true) {
  const raw = typeof implName === 'string' ? implName.trim() : '';
  if (!hasTraffic) {
    return {
      type: 'idle',
      badge: null,
      label: 'aguardando movimento',
      raw,
      badgeClass: 'diag-badge-neutral',
      isHardware: false,
      isSoftware: false
    };
  }

  if (!raw || raw.toLowerCase() === 'unknown' || raw === '—') {
    return {
      type: 'raw',
      badge: null,
      label: '—',
      raw: '',
      badgeClass: 'diag-badge-neutral',
      isHardware: false,
      isSoftware: false
    };
  }

  if (/mediafoundation|externalencoder|externaldecoder|nvenc|nvdec|amf|qsv|videotoolbox|vaapi|d3d11|dxva/i.test(raw)) {
    return {
      type: 'gpu',
      badge: 'GPU',
      label: 'GPU',
      raw,
      badgeClass: 'diag-badge-hw',
      isHardware: true,
      isSoftware: false
    };
  }

  if (/openh264|libaom|libvpx|dav1d|ffmpeg|software|\bsw\b/i.test(raw)) {
    return {
      type: 'cpu',
      badge: 'CPU',
      label: 'CPU',
      raw,
      badgeClass: 'diag-badge-sw',
      isHardware: false,
      isSoftware: true
    };
  }

  return {
    type: 'raw',
    badge: null,
    label: raw,
    raw,
    badgeClass: 'diag-badge-neutral',
    isHardware: false,
    isSoftware: false
  };
}

/**
 * Ordena a lista de codecs do RTCRtpSender conforme a preferência do usuário:
 * - auto: H.264 (42e01f, 4d001f) primeiro, depois VP9, AV1, VP8 e H.264 fallback (42001f, 640032, pm=0)
 * - H264: H.264 (42e01f, 4d001f) primeiro, depois VP9, AV1, VP8 e H.264 fallback
 * - AV1:  AV1 no topo, mantendo H.264 logo abaixo como fallback de negociação, depois VP9, VP8
 * - VP9:  VP9 primeiro, depois H.264, AV1, VP8
 * - VP8:  VP8 primeiro, depois H.264, VP9, AV1
 * Mantém rtx/red/ulpfec ao final para resiliência de pacotes.
 */
export function determineOptimalCodecOrder({
  preferredCodec = 'auto',
  availableCodecs,
  capabilities,
  prioritizeH264High50 = false
} = {}) {
  const rawCodecs = Array.isArray(availableCodecs)
    ? availableCodecs
    : (Array.isArray(capabilities)
      ? capabilities
      : (Array.isArray(capabilities?.rawCodecs) ? capabilities.rawCodecs : []));

  if (rawCodecs.length === 0) {
    return {
      preferredOrder: [],
      selectedCodec: 'H264',
      primaryCodec: null,
      reason: 'Nenhum codec de vídeo disponível'
    };
  }

  const h264Primary = [];
  const h264Fallback = [];
  const av1Codecs = [];
  const vp9Codecs = [];
  const vp8Codecs = [];
  const otherCodecs = [];
  const resilienceCodecs = [];

  for (const codec of rawCodecs) {
    const mime = String(codec.mimeType || '').toLowerCase();
    if (mime === 'video/rtx' || mime === 'video/red' || mime === 'video/ulpfec' || mime.includes('flexfec')) {
      resilienceCodecs.push(codec);
      continue;
    }
    if (mime === 'video/h264') {
      const fmtp = String(codec.sdpFmtpLine || '').toLowerCase();
      const isMode1 = fmtp.includes('packetization-mode=1');
      const isMode0 = fmtp.includes('packetization-mode=0') || !isMode1;
      const pidMatch = fmtp.match(/profile-level-id=([0-9a-fA-F]{6})/i);
      const pid = pidMatch ? pidMatch[1].toLowerCase() : '';
      const isOpenH264 = String(codec.implementation || '').toLowerCase().includes('openh264');
      const isFallbackProfile = (pid === '42001f' || pid.startsWith('4200') || (pid === '640032' && !prioritizeH264High50));

      if (isMode0 || isOpenH264 || isFallbackProfile) {
        h264Fallback.push(codec);
      } else {
        h264Primary.push(codec);
      }
    } else if (mime === 'video/av1' || mime === 'video/av01') {
      av1Codecs.push(codec);
    } else if (mime === 'video/vp9') {
      vp9Codecs.push(codec);
    } else if (mime === 'video/vp8') {
      vp8Codecs.push(codec);
    } else {
      otherCodecs.push(codec);
    }
  }

  const rankH264 = (c) => {
    if (prioritizeH264High50) {
      const fmtp = String(c.sdpFmtpLine || '').toLowerCase();
      if (fmtp.includes('profile-level-id=640032') && fmtp.includes('packetization-mode=1')) {
        return 1;
      }
    }
    return scoreH264Candidate(c);
  };

  h264Primary.sort((a, b) => rankH264(a) - rankH264(b));
  h264Fallback.sort((a, b) => rankH264(a) - rankH264(b));

  const pref = String(preferredCodec || 'auto').toUpperCase();
  let ordered = [];
  let reason = '';

  if (pref === 'AV1' && av1Codecs.length > 0) {
    ordered = [...av1Codecs, ...h264Primary, ...vp9Codecs, ...vp8Codecs, ...otherCodecs, ...h264Fallback];
    reason = 'AV1 selecionado pelo usuário (com H.264 logo abaixo como fallback de negociação)';
  } else if (pref === 'VP9' && vp9Codecs.length > 0) {
    ordered = [...vp9Codecs, ...h264Primary, ...av1Codecs, ...vp8Codecs, ...otherCodecs, ...h264Fallback];
    reason = 'VP9 selecionado pelo usuário (com H.264 como fallback)';
  } else if (pref === 'VP8' && vp8Codecs.length > 0) {
    ordered = [...vp8Codecs, ...h264Primary, ...vp9Codecs, ...av1Codecs, ...otherCodecs, ...h264Fallback];
    reason = 'VP8 selecionado pelo usuário (com H.264 como fallback)';
  } else {
    ordered = [...h264Primary, ...vp9Codecs, ...av1Codecs, ...vp8Codecs, ...otherCodecs, ...h264Fallback];
    reason = pref === 'H264'
      ? 'H.264 selecionado pelo usuário'
      : 'Automático (H.264 primeiro, depois VP9/AV1/VP8)';
  }

  const topVideo = ordered[0] || null;
  let primaryCodec = 'H264';
  if (topVideo && topVideo.mimeType) {
    const m = topVideo.mimeType.split('/')[1]?.toUpperCase() || 'H264';
    primaryCodec = m === 'AV01' ? 'AV1' : m;
  }

  ordered.push(...resilienceCodecs);

  return {
    preferredOrder: ordered,
    selectedCodec: primaryCodec,
    primaryCodec,
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
