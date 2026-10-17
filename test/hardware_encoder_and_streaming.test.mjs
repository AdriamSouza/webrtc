/**
 * HyperStream — Suíte de Testes Automatizados:
 * Hardware Encoder, Seleção CPU/GPU, Codecs e Streaming de Alta Qualidade (1440p / 4K / 60 FPS)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  identifyGpuVendor,
  evaluateCodecCapabilities,
  determineOptimalCodecOrder,
  scoreH264Candidate,
  STREAM_RESOLUTIONS,
  getResolutionConstraints
} from '../frontend/js/hardwareDetector.js';
import {
  isHardwareCodecImplementation,
  analyzeEncoderImplementation,
  analyzeDecoderImplementation,
  QUALITY_PROFILES,
  QualityController
} from '../frontend/js/qualityController.js';
import { WebRTCManager } from '../frontend/js/webrtc.js';
import {
  WEBCODECS_PROBE_CODECS,
  probeWebCodecsHardware,
  runRealGpuEncodeBenchmark,
  GpuHardwareEncoderEngine
} from '../frontend/js/gpuEncoderEngine.js';

describe('1. Detecção e Classificação de Fabricante / Arquitetura de GPU', () => {
  test('Deve identificar GPU AMD Radeon (AMF / VCN) corretamente', () => {
    const res = identifyGpuVendor('AMD Radeon RX 7600 Direct3D11', 'Advanced Micro Devices, Inc.');
    assert.equal(res.vendor, 'AMD');
    assert.match(res.hwApi, /AMD AMF/);
    assert.equal(res.hasDedicatedHardware, true);
  });

  test('Deve identificar GPU NVIDIA GeForce (NVENC) corretamente', () => {
    const res = identifyGpuVendor('NVIDIA GeForce RTX 4070', 'NVIDIA Corporation');
    assert.equal(res.vendor, 'NVIDIA');
    assert.match(res.hwApi, /NVENC/);
    assert.equal(res.hasDedicatedHardware, true);
  });

  test('Deve identificar GPU Intel (Arc / Iris / QuickSync) corretamente', () => {
    const res = identifyGpuVendor('Intel Arc A770 Graphics', 'Intel Corporation');
    assert.equal(res.vendor, 'INTEL');
    assert.match(res.hwApi, /QuickSync/);
    assert.equal(res.hasDedicatedHardware, true);
  });

  test('Deve identificar Apple Silicon (VideoToolbox) em plataformas Apple', () => {
    const res = identifyGpuVendor('Apple M3 Max', 'Apple Inc.');
    assert.equal(res.vendor, 'APPLE');
    assert.match(res.hwApi, /VideoToolbox/);
    assert.equal(res.hasDedicatedHardware, true);
  });

  test('Deve classificar GPU genérica desconhecida com segurança', () => {
    const res = identifyGpuVendor('Microsoft Basic Render Driver', 'Microsoft');
    assert.equal(res.vendor, 'UNKNOWN');
    assert.equal(res.hasDedicatedHardware, false);
  });
});

describe('2. Avaliação de Suporte Real a Codecs no Ambiente WebRTC', () => {
  test('Em GPU com video_encode ativo, H.264 deve ser confirmado como Hardware e AV1 como CPU/Software se não houver MFT', () => {
    const gpuInfo = { description: 'AMD Radeon RX 7600', vendor: 'AMD' };
    const featureStatus = { video_encode: 'enabled', video_decode: 'enabled' };

    const caps = evaluateCodecCapabilities(gpuInfo, featureStatus);
    assert.equal(caps.isVideoEncodeAccelerated, true);
    assert.equal(caps.codecs.H264.hardwareSupported, true);
    assert.match(caps.codecs.H264.statusLabel, /GPU Hardware/);

    // AV1 sem flag explícita deve ser classificado com precisão como CPU libaom
    assert.equal(caps.codecs.AV1.hardwareSupported, false);
    assert.match(caps.codecs.AV1.statusLabel, /Software \(CPU: libaom\)/);
  });

  test('Em máquina sem aceleração por hardware, todos os codecs devem apontar para Software seguro', () => {
    const gpuInfo = { description: 'Software Rasterizer', vendor: 'Generic' };
    const featureStatus = { video_encode: 'disabled', video_decode: 'disabled' };

    const caps = evaluateCodecCapabilities(gpuInfo, featureStatus);
    assert.equal(caps.isVideoEncodeAccelerated, false);
    assert.equal(caps.codecs.H264.hardwareSupported, false);
    assert.match(caps.codecs.H264.statusLabel, /Software/);
    assert.equal(caps.codecs.AV1.hardwareSupported, false);
  });
});

describe('3. Matriz de Decisão: Seleção Inteligente de Codecs (Automático, GPU, CPU)', () => {
  const mockCapabilitiesList = [
    { mimeType: 'video/AV1', clockRate: 90000 },
    { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
    { mimeType: 'video/VP9', clockRate: 90000 },
    { mimeType: 'video/VP8', clockRate: 90000 }
  ];

  test('Modo Automático: deve priorizar H.264 se GPU tiver suporte a hardware, evitando libaom na CPU', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'AMD Radeon RX 7600', vendor: 'AMD' },
      { video_encode: 'enabled' }
    );

    const result = determineOptimalCodecOrder({
      preference: 'auto',
      preferredCodec: 'auto',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    assert.equal(result.selectedCodec, 'H264');
    assert.equal(result.preferredOrder[0].mimeType, 'video/H264');
    assert.equal(result.isHardwareExpected, true);
    assert.match(result.reason, /aceleração nativa por GPU/);
  });

  test('Modo GPU: deve selecionar H.264 por hardware mesmo se usuário escolher Auto', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'NVIDIA GeForce RTX 3060', vendor: 'NVIDIA' },
      { video_encode: 'enabled' }
    );

    const result = determineOptimalCodecOrder({
      preference: 'gpu',
      preferredCodec: 'auto',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    assert.equal(result.selectedCodec, 'H264');
    assert.equal(result.preferredOrder[0].mimeType, 'video/H264');
    assert.equal(result.isHardwareExpected, true);
  });

  test('Modo GPU com AV1 solicitado mas sem suporte de hardware: deve realizar fallback seguro para H.264 hardware', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'AMD Radeon RX 7600', vendor: 'AMD' },
      { video_encode: 'enabled' } // sem av1_encode_hardware
    );

    const result = determineOptimalCodecOrder({
      preference: 'gpu',
      preferredCodec: 'AV1',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    // Quando o usuário força GPU, deve priorizar o codec com hardware real (H.264) e alertar
    assert.equal(result.selectedCodec, 'H264');
    assert.equal(result.preferredOrder[0].mimeType, 'video/H264');
    assert.equal(result.isHardwareExpected, true);
    assert.match(result.reason, /WebRTC do Chromium não disponibiliza encoder AV1 por GPU/);
  });

  test('Modo CPU explícito: deve selecionar software e nunca declarar aceleração de hardware', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'AMD Radeon RX 7600', vendor: 'AMD' },
      { video_encode: 'enabled' }
    );

    const result = determineOptimalCodecOrder({
      preference: 'cpu',
      preferredCodec: 'AV1',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    assert.equal(result.selectedCodec, 'AV1');
    assert.equal(result.preferredOrder[0].mimeType, 'video/AV1');
    assert.equal(result.isHardwareExpected, false);
    assert.match(result.reason, /Modo CPU/);
  });

  test('Sistema sem GPU dedicada: Modo Automático deve operar com codec disponível sem erros', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'Basic Display', vendor: 'Unknown' },
      { video_encode: 'disabled' }
    );

    const result = determineOptimalCodecOrder({
      preference: 'auto',
      preferredCodec: 'auto',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    assert.equal(result.isHardwareExpected, false);
    assert.ok(result.preferredOrder.length > 0);
  });

  test('scoreH264Candidate deve priorizar Constrained Baseline (42e01f) e Main (4d001f) e penalizar packetization-mode=0 e Baseline unconstrained (42001f)', () => {
    const p1 = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f' };
    const p2 = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f' };
    const p3 = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' };
    const p4 = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f' };
    const p5 = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f' };
    const p6 = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f' };
    const p7 = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032' };

    // 1º lugar: 42e01f -> score 10
    assert.equal(scoreH264Candidate(p3), 10);
    // 2º lugar: 4d001f -> score 20
    assert.equal(scoreH264Candidate(p5), 20);
    // 3º lugar: 640032 -> score 100
    assert.equal(scoreH264Candidate(p7), 100);
    // 4º lugar: 42001f -> score 200 (penalizado: sem constraint flags iop=e0)
    assert.equal(scoreH264Candidate(p1), 200);

    // Penalidade de +5000 para packetization-mode=0
    assert.equal(scoreH264Candidate(p4), 5010);
    assert.equal(scoreH264Candidate(p6), 5020);
    assert.equal(scoreH264Candidate(p2), 5200);

    // Bônus de prioridade (-5) para powerEfficient: true
    assert.equal(scoreH264Candidate({ ...p3, powerEfficient: true }), 5);
  });
});

describe('4. Resoluções Avançadas e Perfis de Streaming (4K, 1440p, 1080p, 60 FPS)', () => {
  test('Deve fornecer restrições corretas de 4K (3840x2160) com limites altos de bitrate', () => {
    const res = getResolutionConstraints('4k');
    assert.equal(res.width.ideal, 3840);
    assert.equal(res.height.ideal, 2160);

    const profile4k = QUALITY_PROFILES['4k_ultra'];
    assert.ok(profile4k);
    assert.equal(profile4k.maxFps, 60);
    assert.equal(profile4k.maxBitrate, 25000000);
    assert.equal(profile4k.minBitrate, 10000000);
  });

  test('Deve fornecer restrições corretas de 1440p / 2K (2560x1440) para 60 FPS', () => {
    const res = getResolutionConstraints('1440p');
    assert.equal(res.width.ideal, 2560);
    assert.equal(res.height.ideal, 1440);

    const profile1440p = QUALITY_PROFILES['1440p_ultra'];
    assert.ok(profile1440p);
    assert.equal(profile1440p.maxFps, 60);
    assert.equal(profile1440p.maxBitrate, 16000000);
  });

  test('Resoluções 4k e 1440p devem sinalizar obrigatoriedade ou recomendação de GPU', () => {
    assert.equal(STREAM_RESOLUTIONS['4k'].requiresGpu, true);
    assert.equal(STREAM_RESOLUTIONS['1440p'].requiresGpu, true);
    assert.equal(STREAM_RESOLUTIONS['1080p'].requiresGpu, false);
  });
});

describe('5. Telemetria e Comprovação Real do Encoder', () => {
  test('ExternalEncoder / MediaFoundation deve ser classificado como GPU Hardware com evidência', () => {
    const analysis = analyzeEncoderImplementation(
      'ExternalEncoder (MediaFoundationVideoEncodeAccelerator)',
      'H264',
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );

    assert.equal(analysis.category, 'hardware');
    assert.equal(analysis.isHardware, true);
    assert.equal(analysis.isSoftware, false);
    assert.match(analysis.label, /GPU Hardware/);
    assert.match(analysis.evidence, /DirectX 11/);
  });

  test('libaom deve ser categorizado estritamente como Software (CPU) sem falsos positivos de GPU', () => {
    const analysis = analyzeEncoderImplementation(
      'libaom',
      'AV1',
      { framesEncoded: 120, bytesSent: 400000, framesDelta: 60 }
    );

    assert.equal(analysis.category, 'software');
    assert.equal(analysis.isHardware, false);
    assert.equal(analysis.isSoftware, true);
    assert.equal(analysis.label, 'Software (CPU)');
    assert.match(analysis.evidence, /fallback ativo para biblioteca libaom/);
  });

  test('Fluxo inativo / sem dados transmitidos não deve declarar aceleração falsa', () => {
    const analysis = analyzeEncoderImplementation(
      'libaom',
      'AV1',
      { framesEncoded: 0, bytesSent: 0, framesDelta: 0 }
    );

    assert.equal(analysis.category, 'inactive');
    assert.equal(analysis.isHardware, false);
    assert.equal(analysis.isSoftware, false);
  });

  test('Regra prioritária Etapa 4: OpenH264 ou SimulcastEncoderAdapter + software deve declarar software_confirmed MESMO com powerEfficient=true', () => {
    const analysisOpen = analyzeEncoderImplementation(
      'OpenH264',
      'H264',
      true,
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60, avgEncodeTimeMs: 4.91, cpuUsagePercent: 12.0 }
    );

    assert.equal(analysisOpen.category, 'software');
    assert.equal(analysisOpen.isHardware, false);
    assert.equal(analysisOpen.isSoftware, true);
    assert.equal(analysisOpen.state, 'software_confirmed');
    assert.equal(analysisOpen.label, 'Software (CPU)');
    assert.equal(analysisOpen.badgeClass, 'diag-badge-sw');

    const analysisSimulcast = analyzeEncoderImplementation(
      'SimulcastEncoderAdapter (OpenH264)',
      'H264',
      true,
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );
    assert.equal(analysisSimulcast.state, 'software_confirmed');
    assert.equal(analysisSimulcast.label, 'Software (CPU)');
    assert.equal(analysisSimulcast.badgeClass, 'diag-badge-sw');
  });

  test('Regra Etapa 4: só classifica como hardware_confirmed para MediaFoundation, ExternalEncoder, VideoToolbox, VAAPI, NVENC, AMF ou QSV; outros são indeterminado', () => {
    const analysisHw = analyzeEncoderImplementation(
      'ExternalEncoder (MediaFoundation)',
      'H264',
      true,
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );

    assert.equal(analysisHw.category, 'hardware');
    assert.equal(analysisHw.isHardware, true);
    assert.equal(analysisHw.state, 'hardware_confirmed');

    const analysisIndet = analyzeEncoderImplementation(
      'GenericUnknownEncoder',
      'H264',
      true,
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );
    assert.equal(analysisIndet.state, 'indeterminado');
    assert.equal(analysisIndet.isHardware, false);
    assert.equal(analysisIndet.isSoftware, false);
    assert.equal(analysisIndet.rawImplementation, 'GenericUnknownEncoder');
  });
});

describe('6. Controle Adaptativo de Qualidade com Histerese e Proteção de CPU', () => {
  test('Deve aplicar redução de bitrate sob sobrecarga de CPU (avgEncodeTime > 25ms)', async () => {
    const qc = new QualityController();
    await qc.setProfile('ultra');
    const initialBitrate = qc.currentMaxBitrate;

    let updatedParams = null;
    const mockSender = {
      track: { kind: 'video' },
      getParameters: () => ({ encodings: [{ maxBitrate: initialBitrate, maxFramerate: 60 }] }),
      setParameters: async (p) => { updatedParams = p; }
    };
    const mockPc = {
      getSenders: () => [mockSender]
    };

    // Simula CPU throttling do encoder (tempo médio por frame de 32ms)
    await qc.evaluateAdaptation([mockPc], 40, 0.0, 32, 'cpu');

    assert.ok(qc.currentMaxBitrate < initialBitrate, 'Bitrate deve ser reduzido para aliviar a CPU');
    assert.equal(qc.currentMaxFps, 30, 'FPS deve ser reduzido para 30 FPS para manter estabilidade sob sobrecarga de CPU');
    assert.equal(qc.lastAdaptationDirection, 'down');
  });

  test('Histerese deve bloquear oscilações rápidas em períodos inferiores ao tempo de resfriamento', async () => {
    const qc = new QualityController();
    await qc.setProfile('ultra');

    const mockSender = {
      track: { kind: 'video' },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => {}
    };
    const mockPc = { getSenders: () => [mockSender] };

    // Primeira redução
    await qc.evaluateAdaptation([mockPc], 250, 4.0, null, 'none');
    const bitrateAfterFirstDrop = qc.currentMaxBitrate;

    // Tentativa imediata (sem esperar cooldown)
    await qc.evaluateAdaptation([mockPc], 250, 4.0, null, 'none');
    assert.equal(qc.currentMaxBitrate, bitrateAfterFirstDrop, 'Histerese deve impedir redução consecutiva sem intervalo mínimo');
  });
});

describe('7. Munging de SDP e Priorização de Codecs na Negociação', () => {
  const sampleSdp = [
    'v=0',
    'o=- 12345 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=video 9 UDP/TLS/RTP/SAVPF 45 46 102 103 96 97',
    'a=rtpmap:45 AV1/90000',
    'a=rtpmap:46 rtx/90000',
    'a=fmtp:46 apt=45',
    'a=rtpmap:102 H264/90000',
    'a=rtpmap:103 rtx/90000',
    'a=fmtp:103 apt=102',
    'a=rtpmap:96 VP8/90000',
    'a=rtpmap:97 rtx/90000',
    'a=fmtp:97 apt=96'
  ].join('\r\n');

  test('Em modo GPU ou Automático, mungeSdpBandwidth deve priorizar H.264 sobre AV1 nos payloads', () => {
    const wm = new WebRTCManager(null);
    wm.encoderPreference = 'gpu';
    wm.preferredCodec = 'auto';

    const munged = wm.mungeSdpBandwidth(sampleSdp, 8000000);
    const mLine = munged.split('\r\n').find(l => l.startsWith('m=video'));
    assert.ok(mLine, 'm=video deve existir no SDP');

    const payloads = mLine.split(' ').slice(3);
    const h264Idx = payloads.indexOf('102');
    const av1Idx = payloads.indexOf('45');

    assert.ok(h264Idx !== -1, 'Payload H.264 (102) deve estar presente');
    assert.ok(av1Idx !== -1, 'Payload AV1 (45) deve estar presente');
    assert.ok(h264Idx < av1Idx, `H.264 (pos ${h264Idx}) deve vir antes de AV1 (pos ${av1Idx}) no modo GPU para evitar libaom CPU`);
  });

  test('Em modo CPU com AV1 solicitado, mungeSdpBandwidth deve colocar AV1 à frente', () => {
    const wm = new WebRTCManager(null);
    wm.encoderPreference = 'cpu';
    wm.preferredCodec = 'AV1';

    const munged = wm.mungeSdpBandwidth(sampleSdp, 8000000);
    const mLine = munged.split('\r\n').find(l => l.startsWith('m=video'));
    const payloads = mLine.split(' ').slice(3);
    const h264Idx = payloads.indexOf('102');
    const av1Idx = payloads.indexOf('45');

    assert.ok(av1Idx < h264Idx, 'AV1 deve vir antes de H.264 quando usuário solicita explicitamente CPU + AV1');
  });

  test('mungeSdpBandwidth NÃO deve alterar profile-level-id (mantendo fidelidade estrita com RTCRtpSender capabilities)', () => {
    const wm = new WebRTCManager(null);
    wm.targetMaxBitrate = 8000000;
    const testSdp = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 100',
      'a=rtpmap:100 H264/90000',
      'a=fmtp:100 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'
    ].join('\r\n');

    const munged = wm.mungeSdpBandwidth(testSdp, 8000000);
    assert.ok(munged.includes('profile-level-id=42e01f'), 'profile-level-id=42e01f deve ser preservado intacto');
    assert.ok(!munged.includes('profile-level-id=42e02a'), 'NÃO deve modificar level para 2a');
    assert.ok(!munged.includes('profile-level-id=42e033'), 'NÃO deve modificar level para 33');
  });

  test('Link de convite deve resolver URL pública no Desktop e nunca apontar para localhost', () => {
    const serverUrl = 'https://hyperstream-g9gz.onrender.com';
    const roomId = 'SALA-TESTE-123';
    const pin = '4321';

    const resolveInviteUrl = (origin, serverApiUrl, rId, rPin) => {
      let baseUrl = origin;
      if (serverApiUrl && (serverApiUrl.startsWith('http://') || serverApiUrl.startsWith('https://'))) {
        baseUrl = serverApiUrl.replace(/\/$/, '');
      } else if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        baseUrl = 'https://hyperstream-g9gz.onrender.com';
      }
      let url = `${baseUrl}/?room=${encodeURIComponent(rId)}`;
      if (rPin) url += `&pin=${encodeURIComponent(rPin)}`;
      return url;
    };

    const linkFromDesktop = resolveInviteUrl('http://127.0.0.1:51234', serverUrl, roomId, pin);
    assert.ok(!linkFromDesktop.includes('127.0.0.1'), 'Link de convite do Desktop não deve conter 127.0.0.1');
    assert.ok(!linkFromDesktop.includes('localhost'), 'Link de convite do Desktop não deve conter localhost');
    assert.equal(linkFromDesktop, 'https://hyperstream-g9gz.onrender.com/?room=SALA-TESTE-123&pin=4321');
  });

  test('Deve REORDENAR (sem remover) os perfis H.264, VP9/AV1/VP8 e auxiliares rtx/red/ulpfec conforme Etapa 3', () => {
    const chromiumCodecs = [
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032' },
      { mimeType: 'video/VP9', clockRate: 90000 },
      { mimeType: 'video/AV1', clockRate: 90000 },
      { mimeType: 'video/VP8', clockRate: 90000 },
      { mimeType: 'video/rtx', clockRate: 90000 },
      { mimeType: 'video/red', clockRate: 90000 },
      { mimeType: 'video/ulpfec', clockRate: 90000 }
    ];

    const caps = evaluateCodecCapabilities(
      { description: 'AMD Radeon RX 7600', vendor: 'AMD' },
      { video_encode: 'enabled' }
    );

    const result = determineOptimalCodecOrder({
      preference: 'gpu',
      preferredCodec: 'H264',
      availableCodecs: chromiumCodecs,
      capabilities: caps
    });

    // Todos os 13 codecs devem continuar presentes (REORDENAR, não remover)
    assert.equal(result.preferredOrder.length, chromiumCodecs.length);

    // 1º lugar: H.264 packetization-mode=1 e profile-level-id iniciando em 42e01f
    assert.ok(result.preferredOrder[0].sdpFmtpLine.includes('profile-level-id=42e01f'));
    assert.ok(result.preferredOrder[0].sdpFmtpLine.includes('packetization-mode=1'));

    // 2º lugar: H.264 packetization-mode=1 e profile-level-id 4d001f
    assert.ok(result.preferredOrder[1].sdpFmtpLine.includes('profile-level-id=4d001f'));
    assert.ok(result.preferredOrder[1].sdpFmtpLine.includes('packetization-mode=1'));

    // VP9 / AV1 / VP8 vêm antes dos H.264 fallback (packetization-mode=0, 42001f, 640032)
    const idxVp9 = result.preferredOrder.findIndex(c => c.mimeType === 'video/VP9');
    const idx42001f = result.preferredOrder.findIndex(c => (c.sdpFmtpLine || '').includes('42001f'));
    const idx640032 = result.preferredOrder.findIndex(c => (c.sdpFmtpLine || '').includes('640032'));
    assert.ok(idxVp9 < idx42001f, 'VP9 deve vir antes de 42001f');
    assert.ok(idxVp9 < idx640032, 'VP9 deve vir antes de 640032');

    // rtx, red, ulpfec permanecem no final da lista
    const lastThreeMimes = result.preferredOrder.slice(-3).map(c => c.mimeType);
    assert.deepEqual(lastThreeMimes, ['video/rtx', 'video/red', 'video/ulpfec']);
  });

  test('Deve rebaixar qualquer codec marcado com OpenH264 para o final dos codecs de vídeo sem removê-lo', () => {
    const listWithOpenH264 = [
      { mimeType: 'video/H264', implementation: 'OpenH264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' }
    ];
    const caps = evaluateCodecCapabilities({ description: 'AMD Radeon RX 7600', vendor: 'AMD' }, { video_encode: 'enabled' });
    const result = determineOptimalCodecOrder({
      preference: 'gpu',
      preferredCodec: 'H264',
      availableCodecs: listWithOpenH264,
      capabilities: caps
    });
    assert.equal(result.preferredOrder.length, 2);
    assert.ok(!result.preferredOrder[0].implementation);
    assert.equal(result.preferredOrder[1].implementation, 'OpenH264');
  });

  test('mungeSdpBandwidth deve garantir que 42e01f precede 42001f no m=video mesmo se 42001f vier antes no SDP bruto', () => {
    const wm = new WebRTCManager(null);
    wm.targetMaxBitrate = 8000000;
    // Simula SDP onde Chromium colocou 42001f (payload 101) antes de 42e01f (payload 103)
    const rawSdp = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 101 103 105 107',
      'a=rtpmap:101 H264/90000',
      'a=fmtp:101 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
      'a=rtpmap:103 H264/90000',
      'a=fmtp:103 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
      'a=rtpmap:105 H264/90000',
      'a=fmtp:105 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f',
      'a=rtpmap:107 H264/90000',
      'a=fmtp:107 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032'
    ].join('\r\n');

    const munged = wm.mungeSdpBandwidth(rawSdp, 8000000);
    const mLineMatch = munged.match(/m=video \d+ [^\r\n]+/);
    assert.ok(mLineMatch);
    const payloads = mLineMatch[0].split(' ').slice(3);

    // 103 (42e01f) deve vir ANTES de 101 (42001f)!
    const idx42e01f = payloads.indexOf('103');
    const idx4d001f = payloads.indexOf('105');
    const idx640032 = payloads.indexOf('107');
    const idx42001f = payloads.indexOf('101');

    assert.equal(idx42e01f, 0, '42e01f (payload 103) deve ser rigorosamente o primeiro na linha m=video');
    assert.equal(idx4d001f, 1, '4d001f (payload 105) deve ser o segundo na linha m=video');
    assert.equal(idx640032, 2, '640032 (payload 107) deve ser o terceiro na linha m=video');
    assert.equal(idx42001f, 3, '42001f (payload 101) deve ser rebaixado para a quarta posição');
  });
});

describe('8. Motor de Codificação Direta em GPU via WebCodecs (GpuHardwareEncoderEngine)', () => {
  test('probeWebCodecsHardware testa os 7 candidatos em ordem e não declara isHardwareAccelerated=true apenas por supported=true', async () => {
    const origVideoEncoder = globalThis.VideoEncoder;
    const testedConfigs = [];

    globalThis.VideoEncoder = {
      isConfigSupported: async (cfg) => {
        testedConfigs.push(cfg);
        return {
          supported: cfg.codec === 'avc1.42e02a' || cfg.codec === 'avc1.4d002a',
          config: cfg
        };
      }
    };

    try {
      const res = await probeWebCodecsHardware();
      assert.equal(res.supported, true);
      assert.equal(testedConfigs.length, 7);
      // 1º candidato: avc1.42e02a, prefer-hardware, annexb, SEM bitrateMode
      assert.equal(testedConfigs[0].codec, 'avc1.42e02a');
      assert.equal(testedConfigs[0].hardwareAcceleration, 'prefer-hardware');
      assert.equal(testedConfigs[0].bitrateMode, undefined);
      assert.equal(testedConfigs[0].latencyMode, 'realtime');
      assert.equal(testedConfigs[0].width, 1920);
      assert.equal(testedConfigs[0].height, 1080);
      assert.equal(testedConfigs[0].framerate, 60);
      assert.equal(testedConfigs[0].bitrate, 8000000);
      assert.deepEqual(testedConfigs[0].avc, { format: 'annexb' });
      // Fato técnico #2: isHardwareAccelerated é false no probe até que o benchmark confirme
      assert.equal(res.profiles[0].isHardwareAccelerated, false);
      assert.equal(res.preferredCodec, 'avc1.42e02a');
    } finally {
      globalThis.VideoEncoder = origVideoEncoder;
    }
  });

  test('runRealGpuEncodeBenchmark codifica VideoFrames com prefer-hardware, recupera de Encoder creation error tentando o próximo candidato e fecha todos os frames', async () => {
    const origVideoEncoder = globalThis.VideoEncoder;
    const origProcessor = globalThis.MediaStreamTrackProcessor;

    let closedFramesCount = 0;
    let keyFramesCount = 0;
    let configuredWith = null;
    let encoderInstancesCreated = 0;

    globalThis.VideoEncoder = class MockVideoEncoder {
      constructor({ output, error }) {
        encoderInstancesCreated++;
        this._instanceId = encoderInstancesCreated;
        this._output = output;
        this._error = error;
        this.state = 'unconfigured';
        this.encodeQueueSize = 0;
      }
      static async isConfigSupported(cfg) {
        return { supported: true, config: cfg };
      }
      configure(cfg) {
        configuredWith = cfg;
        this.state = 'configured';
      }
      encode(frame, opts) {
        // Simula falha assíncrona "Encoder creation error" no 1º candidato
        if (this._instanceId === 1) {
          this.state = 'closed';
          this._error(new DOMException('Encoder creation error.', 'OperationError'));
          return;
        }
        if (opts?.keyFrame) keyFramesCount++;
        this.encodeQueueSize = 1;
        this._output({
          timestamp: frame.timestamp,
          byteLength: 16384,
          type: opts?.keyFrame ? 'key' : 'delta'
        });
        this.encodeQueueSize = 0;
      }
      async flush() {}
      close() {
        this.state = 'closed';
      }
    };

    globalThis.MediaStreamTrackProcessor = class MockProcessor {
      constructor() {
        let frameIndex = 0;
        this.readable = {
          getReader() {
            return {
              async read() {
                if (frameIndex >= 131) {
                  return { done: true, value: undefined };
                }
                const idx = frameIndex++;
                return {
                  done: false,
                  value: {
                    displayWidth: 1920,
                    displayHeight: 1080,
                    timestamp: idx * 16666,
                    close() {
                      closedFramesCount++;
                    }
                  }
                };
              },
              async cancel() {},
              releaseLock() {}
            };
          }
        };
      }
    };

    try {
      const mockTrack = {
        readyState: 'live',
        getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 })
      };

      const engine = new GpuHardwareEncoderEngine();
      const result = await engine.runBenchmark(mockTrack, 500);

      assert.equal(result.supported, true);
      assert.equal(result.success, true);
      assert.equal(result.attempts.length, 1, 'Deve registrar a 1ª tentativa que falhou com Encoder creation error');
      assert.match(result.attempts[0].error, /Encoder creation error/);
      assert.equal(configuredWith.hardwareAcceleration, 'prefer-hardware');
      assert.equal(configuredWith.latencyMode, 'realtime');
      assert.equal(configuredWith.bitrateMode, 'variable', '2º candidato aprovado deve usar bitrateMode: variable');
      assert.equal(configuredWith.codec, 'avc1.42e02a');
      assert.equal(result.framesRead, 130);
      assert.equal(result.framesEncoded, 130);
      assert.equal(closedFramesCount, 131, 'Todos os 131 VideoFrames lidos (1 da tentativa falha + 130 do aprovado) devem receber frame.close()');
      assert.equal(keyFramesCount, 2, 'Deve forçar keyframe no quadro 0 e no quadro 120 do candidato aprovado');
    } finally {
      globalThis.VideoEncoder = origVideoEncoder;
      globalThis.MediaStreamTrackProcessor = origProcessor;
    }
  });

  test('GpuHardwareEncoderEngine expõe start(), pause(), resume(), stop() e getStatus() com fps, avgEncodeTimeMs e hardwareActive', async () => {
    const origVideoEncoder = globalThis.VideoEncoder;
    const origProcessor = globalThis.MediaStreamTrackProcessor;

    let closedFramesCount = 0;

    globalThis.VideoEncoder = class MockVideoEncoder {
      constructor({ output }) {
        this._output = output;
        this.state = 'unconfigured';
        this.encodeQueueSize = 0;
      }
      static async isConfigSupported(cfg) {
        return { supported: true, config: cfg };
      }
      configure() {
        this.state = 'configured';
      }
      encode(frame, opts) {
        this._output({
          timestamp: frame.timestamp,
          byteLength: 8192,
          type: opts?.keyFrame ? 'key' : 'delta'
        });
      }
      async flush() {}
      close() {
        this.state = 'closed';
      }
    };

    globalThis.MediaStreamTrackProcessor = class MockProcessor {
      constructor() {
        let frameIndex = 0;
        this.readable = {
          getReader() {
            return {
              async read() {
                if (frameIndex >= 10) {
                  return { done: true, value: undefined };
                }
                const idx = frameIndex++;
                return {
                  done: false,
                  value: {
                    timestamp: idx * 16666,
                    close() {
                      closedFramesCount++;
                    }
                  }
                };
              },
              async cancel() {},
              releaseLock() {}
            };
          }
        };
      }
    };

    try {
      const mockTrack = {
        readyState: 'live',
        getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 })
      };

      const engine = new GpuHardwareEncoderEngine();
      const startRes = await engine.start(mockTrack);
      assert.equal(startRes.started, true);
      assert.equal(startRes.codec, 'avc1.42e02a');
      assert.equal(startRes.hardwareActive, true);

      // Aguarda processamento da fila simulada
      await new Promise((r) => setTimeout(r, 25));

      const status = engine.getStatus();
      assert.equal(typeof status.fps, 'number');
      assert.equal(typeof status.avgEncodeTimeMs, 'number');
      assert.equal(status.hardwareActive, true);
      assert.equal(status.framesEncoded, 10);
      assert.equal(closedFramesCount, 10);

      const pausedState = engine.pause();
      assert.equal(pausedState.paused, true);

      const resumedState = engine.resume();
      assert.equal(resumedState.paused, false);

      const finalStatus = await engine.stop();
      assert.equal(finalStatus.running, false);
    } finally {
      globalThis.VideoEncoder = origVideoEncoder;
      globalThis.MediaStreamTrackProcessor = origProcessor;
    }
  });
});


