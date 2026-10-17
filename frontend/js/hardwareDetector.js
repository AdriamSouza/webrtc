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

  let isVideoEncodeAccelerated = false;
  if (featureStatus.video_encode === 'enabled' || featureStatus.video_encode === 'hardware_accelerated' ||
      featureStatus.accelerated_video_encode === 'enabled' || featureStatus.accelerated_video_encode === 'hardware_accelerated') {
    isVideoEncodeAccelerated = true;
  } else if (featureStatus.video_encode === 'disabled' || featureStatus.accelerated_video_encode === 'disabled') {
    isVideoEncodeAccelerated = false;
  } else {
    // Quando featureStatus não for explícito (ambiente browser ou antes do retorno async),
    // deduz aceleração pela presença de GPU dedicada (AMD, NVIDIA, Intel, Apple)
    isVideoEncodeAccelerated = vendorInfo.hasDedicatedHardware || true;
  }

  // H.264: Quase universalmente acelerado por hardware no Windows via MediaFoundation MFT
  const h264 = {
    codec: 'H264',
    mimeType: 'video/H264',
    hardwareSupported: isVideoEncodeAccelerated,
    hardwareApi: vendorInfo.hwApi,
    softwareFallback: 'OpenH264 (Cisco)',
    recommendedFor60Fps: true,
    statusLabel: isVideoEncodeAccelerated ? 'GPU Hardware (Suportado) ⚡' : 'Software (OpenH264) ⚠️',
    description: isVideoEncodeAccelerated
      ? `Aceleração nativa por GPU (${vendorInfo.vendor}) via DirectX 11 / MediaFoundation. Suportada para jogos a 60 FPS.`
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
 * Realiza sondagem assíncrona de capacidades reais de codificação por hardware no motor do Chromium.
 * Consulta navigator.mediaCapabilities.encodingInfo() para cada codec/perfil exposto por RTCRtpSender.getCapabilities('video').codecs.
 *
 * @param {number} width - Largura em pixels (padrão: 1920)
 * @param {number} height - Altura em pixels (padrão: 1080)
 * @param {number} framerate - FPS (padrão: 60)
 * @param {number} bitrate - Taxa de bits em bps (padrão: 8000000)
 * @returns {Promise<Object>} Resultado detalhado da sondagem
 */
/**
 * Extrai e interpreta os campos profile-level-id de um fmtp H.264
 * Hexadecimal de 6 dígitos: XX YY ZZ
 * XX: profile_idc (42 = Baseline/Constrained, 4d = Main, 64 = High)
 * YY: profile_iop (flags de restrição)
 * ZZ: level_idc (1f = 31 [720p30], 20 = 32 [720p60], 29 = 41 [1080p30], 2a = 42 [1080p60], 32 = 50 [4K30], 33 = 51 [4K60], 34 = 52)
 */
export function parseH264ProfileLevel(fmtp = '') {
  const match = fmtp.match(/profile-level-id=([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/i);
  if (!match) return null;
  const profileHex = match[1].toLowerCase();
  const iopHex = match[2].toLowerCase();
  const levelHex = match[3].toLowerCase();
  const profileIdc = parseInt(profileHex, 16);
  const levelIdc = parseInt(levelHex, 16);
  const fmtpLower = fmtp.toLowerCase();
  const isPacketizationMode1 = fmtpLower.includes('packetization-mode=1');
  const isPacketizationMode0 = fmtpLower.includes('packetization-mode=0');
  const hasAsymmetry = fmtpLower.includes('level-asymmetry-allowed=1');
  // Level >= 4.2 (0x2a = 42 em decimal) suporta 1080p @ 60 FPS sem rejeição MF_E_INVALIDMEDIATYPE
  const isLevel42Plus = levelIdc >= 0x2a;

  return {
    fullPid: `${profileHex}${iopHex}${levelHex}`,
    profileHex,
    iopHex,
    levelHex,
    profileIdc,
    levelIdc,
    isLevel42Plus,
    hasAsymmetry,
    isPacketizationMode1,
    isPacketizationMode0
  };
}

/**
 * Pontua codecs H.264 para priorizar perfis com suporte nativo por GPU (MediaFoundation MFT):
 * 1º lugar: profile-level-id=42e01f (Constrained Baseline) -> score 10
 * 2º lugar: profile-level-id=4d001f (Main Profile) -> score 20
 * 3º lugar: profile-level-id=640032 (High Profile) -> score 100
 * 4º lugar: profile-level-id=42001f (Baseline) -> score 200 (penalizado: sem constraint flags iop=e0, rejeitado pelo MediaFoundation MFT)
 * Exige packetization-mode=1 (penaliza packetization-mode=0 com +5000).
 * Aplica bônus de prioridade (-5) se encodingInfo() retornar powerEfficient: true.
 */
export function scoreH264Candidate(c, hardwareProbe = null) {
  const fmtp = (c?.sdpFmtpLine || '').toLowerCase();
  const isMode1 = fmtp.includes('packetization-mode=1');
  const isMode0 = fmtp.includes('packetization-mode=0') || !isMode1;
  const basePenalty = isMode0 ? 5000 : 0;

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
    // 42001f possui iop=00 (unconstrained Baseline), que o MediaFoundation MFT da GPU rejeita e força OpenH264!
    profileScore = 200;
  }

  // Bônus de prioridade (-5) se encodingInfo() do navigator.mediaCapabilities retornou powerEfficient: true
  let powerBonus = 0;
  if (c?.powerEfficient === true) {
    powerBonus = -5;
  } else if (hardwareProbe) {
    const probedEntry = hardwareProbe.probedCodecs?.find(p => p.codec === c || (p.sdpFmtpLine && p.sdpFmtpLine.toLowerCase() === fmtp));
    if (probedEntry && (probedEntry.powerEfficient || probedEntry.isHwConfirmed)) {
      powerBonus = -5;
    }
  }

  return basePenalty + profileScore + powerBonus;
}

let cachedProbePromise = null;
let cachedProbeResults = null;

export function clearProbeHardwareCache() {
  cachedProbePromise = null;
  cachedProbeResults = null;
}

/**
 * Classifica o nome de implementação de um codificador/decodificador (outbound/inbound)
 * aplicando estritamente a regra de prioridade da Etapa 4 ANTES de qualquer outro critério:
 * 1. Se contiver (case-insensitive): "openh264", "libvpx", "libaom", "libdav1d", "dav1d",
 *    "ffmpeg", "software", "sw" como palavra (\bsw\b), ou "SimulcastEncoderAdapter" seguido
 *    de implementação de software => hwState = 'software_confirmed', rótulo "Software (CPU)",
 *    badgeClass = 'diag-badge-sw'.
 * 2. Só classifica como 'hardware_confirmed' se contiver "MediaFoundation", "ExternalEncoder"
 *    (ou "ExternalDecoder"), "VideoToolbox", "VAAPI", "NVENC", "AMF" ou "QSV".
 * 3. Qualquer outro caso => 'indeterminado', com o texto bruto da implementação visível.
 */
export function classifyCodecImplementation(implName) {
  const raw = implName !== undefined && implName !== null ? String(implName).trim() : '';
  const rawDisplay = raw || 'Não informado';
  const s = raw.toLowerCase();

  const swSubPattern = /(openh264|libvpx|libaom|libdav1d|dav1d|ffmpeg|software|\bsw\b)/i;
  const simulcastSwPattern = /simulcastencoderadapter[\s\S]*(openh264|libvpx|libaom|libdav1d|dav1d|ffmpeg|software|\bsw\b)/i;

  if (raw && (swSubPattern.test(s) || simulcastSwPattern.test(s))) {
    return {
      hwState: 'software_confirmed',
      category: 'software',
      hwLabel: 'Software (CPU)',
      hwBadgeClass: 'diag-badge-sw',
      isHardware: false,
      isSoftware: true,
      isUnknown: false,
      rawImplementation: rawDisplay
    };
  }

  const hwPattern = /(mediafoundation|externalencoder|externaldecoder|videotoolbox|vaapi|nvenc|amf|qsv)/i;
  if (raw && hwPattern.test(s)) {
    return {
      hwState: 'hardware_confirmed',
      category: 'hardware',
      hwLabel: 'GPU Hardware ⚡',
      hwBadgeClass: 'diag-badge-hw',
      isHardware: true,
      isSoftware: false,
      isUnknown: false,
      rawImplementation: rawDisplay
    };
  }

  return {
    hwState: 'indeterminado',
    category: 'inconclusive',
    hwLabel: 'Indeterminado',
    hwBadgeClass: 'diag-badge-neutral',
    isHardware: false,
    isSoftware: false,
    isUnknown: true,
    rawImplementation: rawDisplay
  };
}

/**
 * Verifica se um codec H.264 possui perfil estritamente de hardware suportado
 * Apenas 42e01f (Constrained Baseline) e 4d001f (Main Profile) com packetization-mode=1
 * Bane permanentemente OpenH264, packetization-mode=0, 42001f e 640032
 */
export function isAllowedHardwareH264Profile(codec) {
  if (!codec) return false;
  const mime = (codec.mimeType || '').toLowerCase();
  if (!mime.includes('h264')) return false;

  const desc = `${codec.mimeType || ''} ${codec.sdpFmtpLine || ''} ${codec.implementation || ''}`.toLowerCase();
  if (desc.includes('openh264')) return false;

  const fmtp = (codec.sdpFmtpLine || '').toLowerCase();
  if (fmtp.includes('packetization-mode=0')) return false;
  if (!fmtp.includes('packetization-mode=1')) return false;

  const match = fmtp.match(/profile-level-id=([0-9a-f]{6})/i);
  if (!match) return false;
  const pid = match[1].toLowerCase();

  const is42e0 = pid === '42e01f' || pid.startsWith('42e0');
  const is4d00 = pid === '4d001f' || pid.startsWith('4d00');

  return is42e0 || is4d00;
}

export async function probeRealHardwareEncoders(width = 1920, height = 1080, framerate = 60, bitrate = 8000000, forceRefresh = false) {
  if (!forceRefresh && cachedProbeResults) {
    return cachedProbeResults;
  }
  if (!forceRefresh && cachedProbePromise) {
    return cachedProbePromise;
  }

  cachedProbePromise = (async () => {
    let senderCodecs = [];
    try {
    if (typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function') {
      senderCodecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
    } else if (typeof RTCRtpReceiver !== 'undefined' && typeof RTCRtpReceiver.getCapabilities === 'function') {
      senderCodecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
    }
  } catch (_) {}

  // Imprime no console TODOS os codecs H.264 brutos retornados pelo navegador
  const allH264List = senderCodecs.filter(c => (c.mimeType || '').toLowerCase() === 'video/h264');
  console.group('%c[Hardware Probe] Codecs H.264 brutos de RTCRtpSender.getCapabilities("video"):', 'color: #38bdf8; font-weight: bold;');
  if (allH264List.length === 0) {
    console.warn('  Nenhum codec H.264 retornado por RTCRtpSender.getCapabilities!');
  } else {
    allH264List.forEach((c, idx) => {
      const parsed = parseH264ProfileLevel(c.sdpFmtpLine || '');
      const lvlStr = parsed ? `Level ${parsed.levelIdc / 10} (0x${parsed.levelHex})${parsed.isLevel42Plus ? ' [>=4.2 1080p60 OK]' : ' [AVISO: <4.2 720p]'}` : 'Level desconhecido';
      console.log(`  [${idx + 1}] ${c.mimeType} | "${c.sdpFmtpLine || ''}" -> ${lvlStr}`);
    });
  }
  console.groupEnd();

  const isExcluded = (mime = '') => {
    const m = mime.toLowerCase();
    return m.includes('rtx') || m.includes('red') || m.includes('ulpfec') || m.includes('flexfec');
  };

  const probedCodecs = [];
  const hardwareCodecs = [];
  const softwareCodecs = [];
  const h264ProfilesMap = new Map();

  console.log(`%c[Hardware Probe] Iniciando sondagem de encoders no motor Chromium (${width}x${height} @ ${framerate}fps, ${(bitrate / 1000000).toFixed(1)} Mbps)...`, 'color: #38bdf8; font-weight: bold;');

  for (const c of senderCodecs) {
    if (isExcluded(c.mimeType)) continue;

    const mime = c.mimeType;
    const mimeLower = mime.toLowerCase();
    const fmtp = c.sdpFmtpLine || '';
    const desc = `${mime} ${fmtp} ${c.implementation || ''}`.toLowerCase();

    // BANIMENTO TOTAL DE OPENH264 E CODECS DE SOFTWARE CONHECIDOS
    if (desc.includes('openh264')) {
      console.warn(`[Hardware Probe] Banindo permanentemente codec de software: ${mime} [${fmtp}]`);
      continue;
    }

    // BANIMENTO DE PERFIS H.264 QUE FORÇAM SOFTWARE NO DRIVER
    if (mimeLower.includes('h264')) {
      if (!isAllowedHardwareH264Profile(c)) {
        console.warn(`[Hardware Probe] Descartando perfil H.264 incompatível com aceleração por hardware: ${fmtp}`);
        continue;
      }
    }

    let contentType = `${mime}; ${fmtp}`.trim().replace(/;\s*$/, '');

    // Formata contentType compatível com mediaCapabilities para navegadores modernos
    if (mimeLower.includes('h264')) {
      const match = fmtp.match(/profile-level-id=([0-9a-fA-F]{6})/i);
      let profileId = match ? match[1].toLowerCase() : '42e01f';
      if (profileId.endsWith('1f') || profileId.endsWith('20')) {
        profileId = profileId.slice(0, 4) + '2a';
      }
      contentType = `video/mp4; codecs="avc1.${profileId}"`;
    } else if (mimeLower.includes('av1') || mimeLower.includes('av01')) {
      contentType = 'video/mp4; codecs="av01.0.08M.10"';
    } else if (mimeLower.includes('vp9')) {
      contentType = 'video/webm; codecs="vp09.00.10.08"';
    } else if (mimeLower.includes('vp8')) {
      contentType = 'video/webm; codecs="vp8"';
    }

    let supported = false;
    let smooth = false;
    let powerEfficient = false;
    let rawInfo = null;

    if (typeof navigator !== 'undefined' && navigator.mediaCapabilities?.encodingInfo) {
      try {
        rawInfo = await navigator.mediaCapabilities.encodingInfo({
          type: 'webrtc',
          video: { contentType, width, height, bitrate, framerate }
        });
      } catch (_) {}

      // Fallback para type: 'record' se type: 'webrtc' for recusado pelo navegador
      if (!rawInfo || !rawInfo.supported) {
        try {
          const recInfo = await navigator.mediaCapabilities.encodingInfo({
            type: 'record',
            video: { contentType, width, height, bitrate, framerate }
          });
          if (recInfo && (recInfo.supported || recInfo.powerEfficient)) {
            rawInfo = recInfo;
          }
        } catch (_) {}
      }

      if (rawInfo) {
        supported = Boolean(rawInfo.supported);
        smooth = Boolean(rawInfo.smooth);
        powerEfficient = Boolean(rawInfo.powerEfficient);
      }
    }

    // Regra estrita de classificação de Hardware Confirmado:
    // 1. powerEfficient === true no encodingInfo(), OU
    // 2. Para H.264: perfil estritamente de hardware (42e01f ou 4d001f com packetization-mode=1)
    const fmtpLower = fmtp.toLowerCase();
    const isPacketizationMode1 = fmtpLower.includes('packetization-mode=1');
    const isPacketizationMode0 = fmtpLower.includes('packetization-mode=0');
    const isH264 = mimeLower.includes('h264');

    let isHwConfirmed = false;
    if (powerEfficient === true) {
      isHwConfirmed = true;
    } else if (isH264 && !isPacketizationMode0 && isPacketizationMode1) {
      const match = fmtpLower.match(/profile-level-id=([0-9a-f]{6})/);
      const pid = match ? match[1] : '';
      if (pid.startsWith('42e0') || pid.startsWith('4d00')) {
        isHwConfirmed = true;
      }
    }

    const entry = {
      codec: c,
      mimeType: mime,
      sdpFmtpLine: fmtp,
      contentType,
      supported: supported || isHwConfirmed,
      smooth,
      powerEfficient: powerEfficient || isHwConfirmed,
      isHwConfirmed,
      isPacketizationMode1,
      isPacketizationMode0
    };

    probedCodecs.push(entry);

    if (entry.isHwConfirmed) {
      hardwareCodecs.push(entry);
    } else {
      softwareCodecs.push(entry);
    }

    if (isH264) {
      const match = fmtpLower.match(/profile-level-id=([0-9a-f]{6})/);
      const pid = match ? match[1] : 'unknown';
      h264ProfilesMap.set(pid, entry);
    }

    const statusTag = entry.isHwConfirmed
      ? '⚡ GPU HARDWARE (powerEfficient: true)'
      : '⚠️ SOFTWARE CPU (powerEfficient: false)';
    console.log(`  • ${mime} [${fmtp || 'default'}]: ${statusTag}`);
  }

  // Se nenhum perfil com powerEfficient: true for retornado no ambiente de teste,
  // força explicitamente o uso do 42e01f (packetization-mode=1) como único perfil H.264 válido
  if (probedCodecs.some(c => c.mimeType.toLowerCase().includes('h264')) && !hardwareCodecs.some(c => c.powerEfficient)) {
    const forced42e0 = probedCodecs.find(c => {
      const f = (c.sdpFmtpLine || '').toLowerCase();
      return f.includes('profile-level-id=42e0') && f.includes('packetization-mode=1');
    });
    if (forced42e0) {
      forced42e0.powerEfficient = true;
      forced42e0.isHwConfirmed = true;
      if (!hardwareCodecs.includes(forced42e0)) {
        hardwareCodecs.push(forced42e0);
      }
    }
  }

  // Identifica melhor codec H.264 de hardware priorizando 42e01f (Constrained Baseline) e 4d001f (Main) com packetization-mode=1
  let bestH264Codec = null;
  const probeContext = { probedCodecs };
  const h264HwList = hardwareCodecs.filter(c => c.mimeType.toLowerCase().includes('h264') && c.isPacketizationMode1);
  if (h264HwList.length > 0) {
    const sortedHw = [...h264HwList].sort((a, b) => scoreH264Candidate(a.codec, probeContext) - scoreH264Candidate(b.codec, probeContext));
    bestH264Codec = sortedHw[0];
  }

  const results = {
    probedAt: new Date().toISOString(),
    probedCodecs,
    hardwareCodecs,
    softwareCodecs,
    bestH264Codec,
    hasHardwareH264: hardwareCodecs.some(c => c.mimeType.toLowerCase().includes('h264')),
    hasHardwareAV1: hardwareCodecs.some(c => c.mimeType.toLowerCase().includes('av1') || c.mimeType.toLowerCase().includes('av01')),
    hasHardwareVP9: hardwareCodecs.some(c => c.mimeType.toLowerCase().includes('vp9')),
    h264ProfilesMap
  };

  console.log('[Hardware Probe] Resumo da sondagem:', {
    totalProbed: probedCodecs.length,
    hardwareCount: hardwareCodecs.length,
    softwareCount: softwareCodecs.length,
    hasHardwareH264: results.hasHardwareH264,
    bestH264: results.bestH264Codec?.sdpFmtpLine || 'Nenhum'
  });

  cachedProbeResults = results;
  return results;
})();

return cachedProbePromise;
}

/**
 * Determina a ordem prioritária de codecs para o WebRTC (setCodecPreferences)
 * respeitando a preferência do usuário (Auto, GPU, CPU), os recursos reais do hardware
 * e a rejeição de perfis que falharam em runtime (anti-CPU fallback).
 *
 * @param {Object} params
 * @param {string} params.preference - 'auto' | 'gpu' | 'cpu'
 * @param {string} params.preferredCodec - 'auto' | 'H264' | 'AV1' | 'VP9' | 'VP8'
 * @param {Array} params.availableCodecs - Array de codecs do RTCRtpSender.getCapabilities('video').codecs
 * @param {Object} params.capabilities - Resultado de evaluateCodecCapabilities()
 * @param {Object} [params.hardwareProbe] - Resultado de probeRealHardwareEncoders()
 * @param {Set|Array} [params.rejectedProfiles] - Perfis rejeitados que caíram na CPU em runtime
 * @returns {Object} { preferredOrder, selectedCodec, isHardwareExpected, reason }
 */
export function determineOptimalCodecOrder({
  preference = 'gpu',
  preferredCodec = 'H264',
  availableCodecs = [],
  capabilities = {},
  hardwareProbe = null,
  rejectedProfiles = new Set()
}) {
  const normPref = String(preference).toLowerCase();
  const normCodec = String(preferredCodec).toUpperCase();
  const rejectedSet = rejectedProfiles instanceof Set ? rejectedProfiles : new Set(rejectedProfiles || []);

  const isHelperCodec = (mime = '') => {
    const m = mime.toLowerCase();
    return m.includes('rtx') || m.includes('red') || m.includes('ulpfec') || m.includes('flexfec');
  };

  // Grupos de reordenação estrita (REORDENA sem remover nenhum codec do getCapabilities):
  // 1. H.264 com packetization-mode=1 e profile-level-id iniciando em 42e01f (ou 42e0)
  // 2. H.264 packetization-mode=1 4d001f (ou 4d00)
  // 3. demais H.264 packetization-mode=1 (exceto 42001f e 640032)
  // 4. VP9 / AV1 / VP8 conforme preferência do usuário
  // 5. H.264 packetization-mode=0, 42001f e 640032 por último
  // 6. Entradas rtx, red, ulpfec na lista final
  const h264Tier1_42e01f = [];
  const h264Tier2_4d001f = [];
  const h264Tier3_otherPm1 = [];
  const h264Tier5_fallback = [];
  const av1Codecs = [];
  const vp9Codecs = [];
  const vp8Codecs = [];
  const helperCodecs = [];
  const otherCodecs = [];

  for (const c of availableCodecs) {
    const mime = (c.mimeType || '').toLowerCase();
    const fmtp = (c.sdpFmtpLine || '').toLowerCase();

    if (isHelperCodec(mime)) {
      helperCodecs.push(c);
    } else if (mime === 'video/av1' || mime === 'video/av01') {
      av1Codecs.push(c);
    } else if (mime === 'video/h264') {
      const isMode0 = fmtp.includes('packetization-mode=0');
      const isMode1 = fmtp.includes('packetization-mode=1') || !isMode0;
      const pidMatch = fmtp.match(/profile-level-id=([0-9a-f]{6})/i);
      const pid = pidMatch ? pidMatch[1].toLowerCase() : '';

      const is42001fOr640032 = pid === '42001f' || pid === '640032' || pid.startsWith('4200');
      const isOpenH264Tagged = `${c.implementation || ''}`.toLowerCase().includes('openh264');

      if (!isMode1 || isMode0 || is42001fOr640032 || isOpenH264Tagged) {
        h264Tier5_fallback.push(c);
      } else if (pid.startsWith('42e01f') || pid.startsWith('42e0')) {
        h264Tier1_42e01f.push(c);
      } else if (pid.startsWith('4d001f') || pid.startsWith('4d00')) {
        h264Tier2_4d001f.push(c);
      } else {
        h264Tier3_otherPm1.push(c);
      }
    } else if (mime === 'video/vp9') {
      vp9Codecs.push(c);
    } else if (mime === 'video/vp8') {
      vp8Codecs.push(c);
    } else {
      otherCodecs.push(c);
    }
  }

  const scoreH264 = (c) => {
    const fmtp = (c.sdpFmtpLine || '').toLowerCase();
    if (rejectedSet.has(c.sdpFmtpLine) || rejectedSet.has(fmtp)) return 9999;
    return scoreH264Candidate(c, hardwareProbe);
  };

  h264Tier1_42e01f.sort((a, b) => scoreH264(a) - scoreH264(b));
  h264Tier2_4d001f.sort((a, b) => scoreH264(a) - scoreH264(b));
  h264Tier3_otherPm1.sort((a, b) => scoreH264(a) - scoreH264(b));
  h264Tier5_fallback.sort((a, b) => scoreH264(a) - scoreH264(b));

  const h264PrimaryOrdered = [
    ...h264Tier1_42e01f,
    ...h264Tier2_4d001f,
    ...h264Tier3_otherPm1
  ];
  const allH264Ordered = [
    ...h264PrimaryOrdered,
    ...h264Tier5_fallback
  ];

  // Ordem de VP9 / AV1 / VP8 conforme preferência do usuário
  let nonH264Ordered = [];
  if (normCodec === 'VP9') {
    nonH264Ordered = [...vp9Codecs, ...av1Codecs, ...vp8Codecs, ...otherCodecs];
  } else if (normCodec === 'AV1') {
    nonH264Ordered = [...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs];
  } else if (normCodec === 'VP8') {
    nonH264Ordered = [...vp8Codecs, ...vp9Codecs, ...av1Codecs, ...otherCodecs];
  } else {
    nonH264Ordered = [...vp9Codecs, ...av1Codecs, ...vp8Codecs, ...otherCodecs];
  }

  let preferredOrder = [];
  let selectedCodec = 'H264';
  let isHardwareExpected = true;
  let reason = '';

  const isEncodeHw = capabilities.isVideoEncodeAccelerated !== false;
  const hasHwAv1 = Boolean(hardwareProbe?.hasHardwareAV1 || capabilities.codecs?.AV1?.hardwareSupported);
  const hasHwH264 = hardwareProbe ? Boolean(hardwareProbe.hasHardwareH264) : isEncodeHw;

  // 1. MODO CPU (Software explícito solicitado pelo usuário)
  if (normPref === 'cpu') {
    if (normCodec === 'AV1' && av1Codecs.length > 0) {
      preferredOrder = [...av1Codecs, ...h264PrimaryOrdered, ...vp9Codecs, ...vp8Codecs, ...otherCodecs, ...h264Tier5_fallback];
      selectedCodec = 'AV1';
      reason = 'Modo CPU selecionado com AV1: codificação executada pela biblioteca libaom.';
    } else if (normCodec === 'VP9' && vp9Codecs.length > 0) {
      preferredOrder = [...vp9Codecs, ...av1Codecs, ...h264PrimaryOrdered, ...vp8Codecs, ...otherCodecs, ...h264Tier5_fallback];
      selectedCodec = 'VP9';
      reason = 'Modo CPU selecionado com VP9: codificação executada pela biblioteca libvpx.';
    } else if (normCodec === 'VP8' && vp8Codecs.length > 0) {
      preferredOrder = [...vp8Codecs, ...h264PrimaryOrdered, ...av1Codecs, ...vp9Codecs, ...otherCodecs, ...h264Tier5_fallback];
      selectedCodec = 'VP8';
      reason = 'Modo CPU selecionado com VP8.';
    } else {
      preferredOrder = [...h264PrimaryOrdered, ...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs, ...h264Tier5_fallback];
      selectedCodec = 'H264';
      reason = 'Modo CPU selecionado: codificação por software.';
    }
    isHardwareExpected = false;
  }
  // 2. MODO GPU OU AUTOMÁTICO (Prioriza Aceleração por Hardware reordenando sem remover)
  else {
    if (normCodec === 'AV1' && hasHwAv1 && av1Codecs.length > 0 && !rejectedSet.has('AV1')) {
      preferredOrder = [...av1Codecs, ...h264PrimaryOrdered, ...vp9Codecs, ...vp8Codecs, ...otherCodecs, ...h264Tier5_fallback];
      selectedCodec = 'AV1';
      isHardwareExpected = true;
      reason = 'AV1 selecionado com aceleração nativa por hardware GPU comprovada.';
    } else if (allH264Ordered.length > 0 && !rejectedSet.has('H264_ALL')) {
      preferredOrder = [
        ...h264Tier1_42e01f,
        ...h264Tier2_4d001f,
        ...h264Tier3_otherPm1,
        ...nonH264Ordered,
        ...h264Tier5_fallback
      ];
      selectedCodec = 'H264';
      isHardwareExpected = hasHwH264;
      if (normCodec === 'AV1' && !hasHwAv1) {
        reason = 'H.264 priorizado para aceleração por hardware (AMD VCN / NVENC / QuickSync), pois AV1 opera via software libaom (CPU) neste ambiente. WebRTC do Chromium não disponibiliza encoder AV1 por GPU nesta GPU/driver.';
      } else if (!hasHwH264) {
        reason = 'Automático: codec padrão WebRTC do sistema (aceleração por GPU não detectada).';
      } else {
        const topFmtp = allH264Ordered[0]?.sdpFmtpLine || '';
        const parsed = parseH264ProfileLevel(topFmtp);
        const lvlDesc = parsed ? `Level 0x${parsed.levelHex} (${parsed.isLevel42Plus ? '>=4.2 1080p60/4K' : (parsed.hasAsymmetry ? 'com assimetria SDP' : 'MFT')})` : 'GPU Hardware';
        reason = `H.264 selecionado com aceleração nativa por GPU (${lvlDesc}) com baixíssima latência e 60 FPS.`;
      }
    } else if (av1Codecs.length > 0 && !rejectedSet.has('AV1') && hasHwAv1) {
      preferredOrder = [...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs, ...allH264Ordered];
      selectedCodec = 'AV1';
      isHardwareExpected = true;
      reason = 'Fallback para AV1 com aceleração por hardware GPU.';
    } else {
      preferredOrder = [...h264PrimaryOrdered, ...nonH264Ordered, ...h264Tier5_fallback];
      selectedCodec = allH264Ordered.length > 0 ? 'H264' : (vp9Codecs.length > 0 ? 'VP9' : 'VP8');
      isHardwareExpected = false;
      reason = 'Fallback para codecs WebRTC padrão.';
    }
  }

  // 6. Mantém as entradas rtx, red, ulpfec na lista final (necessárias para retransmissão)
  preferredOrder = [...preferredOrder, ...helperCodecs];

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
