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
  getResolutionConstraints,
  classifyCodecImplementation
} from '../frontend/js/hardwareDetector.js';
import {
  isHardwareCodecImplementation,
  analyzeEncoderImplementation,
  analyzeDecoderImplementation,
  QUALITY_PROFILES,
  QualityController
} from '../frontend/js/qualityController.js';
import { WebRTCManager } from '../frontend/js/webrtc.js';

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
  test('Em GPU com video_encode ativo, deve identificar aceleração de vídeo habilitada e disponibilidade dos codecs', () => {
    const gpuInfo = { description: 'AMD Radeon RX 7600', vendor: 'AMD' };
    const featureStatus = { video_encode: 'enabled', video_decode: 'enabled' };

    const caps = evaluateCodecCapabilities(gpuInfo, featureStatus);
    assert.equal(caps.isVideoEncodeAccelerated, true);
    assert.equal(caps.codecs.H264.available, true);
    assert.equal(caps.codecs.AV1.available, true);
  });

  test('Em máquina sem aceleração por hardware, isVideoEncodeAccelerated deve ser false', () => {
    const gpuInfo = { description: 'Software Rasterizer', vendor: 'Generic' };
    const featureStatus = { video_encode: 'disabled', video_decode: 'disabled' };

    const caps = evaluateCodecCapabilities(gpuInfo, featureStatus);
    assert.equal(caps.isVideoEncodeAccelerated, false);
    assert.equal(caps.codecs.H264.available, true);
    assert.equal(caps.codecs.AV1.available, true);
  });
});

describe('3. Matriz de Decisão: Seleção de Codecs (Automático, H.264, AV1, VP9, VP8)', () => {
  const mockCapabilitiesList = [
    { mimeType: 'video/AV1', clockRate: 90000 },
    { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
    { mimeType: 'video/VP9', clockRate: 90000 },
    { mimeType: 'video/VP8', clockRate: 90000 },
    { mimeType: 'video/rtx', clockRate: 90000 },
    { mimeType: 'video/red', clockRate: 90000 },
    { mimeType: 'video/ulpfec', clockRate: 90000 }
  ];

  test('Modo Automático: deve priorizar H.264 no topo', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'AMD Radeon RX 7600', vendor: 'AMD' },
      { video_encode: 'enabled' }
    );

    const result = determineOptimalCodecOrder({
      preferredCodec: 'auto',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    assert.equal(result.selectedCodec, 'H264');
    assert.equal(result.preferredOrder[0].mimeType, 'video/H264');
  });

  test('Quando AV1 for escolhido: deve colocar AV1 no topo e manter H.264 logo abaixo como fallback de negociação, com rtx/red/ulpfec no fim', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'AMD Radeon RX 7600', vendor: 'AMD' },
      { video_encode: 'enabled' }
    );

    const result = determineOptimalCodecOrder({
      preferredCodec: 'AV1',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    assert.equal(result.selectedCodec, 'AV1');
    assert.equal(result.preferredOrder[0].mimeType, 'video/AV1');
    assert.equal(result.preferredOrder[1].mimeType, 'video/H264');
    assert.deepEqual(
      result.preferredOrder.slice(-3).map(c => c.mimeType),
      ['video/rtx', 'video/red', 'video/ulpfec']
    );
  });

  test('Sistema sem GPU dedicada: Modo Automático deve operar com codec disponível sem erros', () => {
    const caps = evaluateCodecCapabilities(
      { description: 'Basic Display', vendor: 'Unknown' },
      { video_encode: 'disabled' }
    );

    const result = determineOptimalCodecOrder({
      preferredCodec: 'auto',
      availableCodecs: mockCapabilitiesList,
      capabilities: caps
    });

    assert.ok(result.preferredOrder.length > 0);
    assert.equal(result.preferredOrder[0].mimeType, 'video/H264');
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

describe('5. Telemetria e Classificação do Encoder (Regra Etapa 2.2)', () => {
  test('ExternalEncoder / MediaFoundation deve ser classificado com badge GPU', () => {
    const analysis = analyzeEncoderImplementation(
      'ExternalEncoder (MediaFoundationVideoEncodeAccelerator)',
      'H264',
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );

    assert.equal(analysis.type, 'gpu');
    assert.equal(analysis.badge, 'GPU');
    assert.equal(analysis.isHardware, true);
    assert.equal(analysis.isSoftware, false);
  });

  test('libaom deve ser classificado com badge CPU', () => {
    const analysis = analyzeEncoderImplementation(
      'libaom',
      'AV1',
      { framesEncoded: 120, bytesSent: 400000, framesDelta: 60 }
    );

    assert.equal(analysis.type, 'cpu');
    assert.equal(analysis.badge, 'CPU');
    assert.equal(analysis.isHardware, false);
    assert.equal(analysis.isSoftware, true);
    assert.equal(analysis.label, 'CPU');
  });

  test('Fluxo sem tráfego deve retornar aguardando movimento', () => {
    const analysis = analyzeEncoderImplementation(
      'libaom',
      'AV1',
      { framesEncoded: 0, bytesSent: 0, framesDelta: 0 }
    );

    assert.equal(analysis.type, 'idle');
    assert.equal(analysis.badge, null);
    assert.equal(analysis.label, 'aguardando movimento');
    assert.equal(analysis.isHardware, false);
    assert.equal(analysis.isSoftware, false);
  });

  test('OpenH264 e SimulcastEncoderAdapter (OpenH264) devem ser classificados com badge CPU', () => {
    const analysisOpen = analyzeEncoderImplementation(
      'OpenH264',
      'H264',
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );

    assert.equal(analysisOpen.type, 'cpu');
    assert.equal(analysisOpen.badge, 'CPU');
    assert.equal(analysisOpen.isHardware, false);
    assert.equal(analysisOpen.isSoftware, true);
    assert.equal(analysisOpen.badgeClass, 'diag-badge-sw');

    const analysisSimulcast = analyzeEncoderImplementation(
      'SimulcastEncoderAdapter (OpenH264)',
      'H264',
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );
    assert.equal(analysisSimulcast.type, 'cpu');
    assert.equal(analysisSimulcast.badge, 'CPU');
    assert.equal(analysisSimulcast.badgeClass, 'diag-badge-sw');
  });

  test('Implementação desconhecida deve retornar texto cru sem badge', () => {
    const analysisIndet = analyzeEncoderImplementation(
      'GenericUnknownEncoder',
      'H264',
      { framesEncoded: 120, bytesSent: 500000, framesDelta: 60 }
    );
    assert.equal(analysisIndet.type, 'raw');
    assert.equal(analysisIndet.badge, null);
    assert.equal(analysisIndet.label, 'GenericUnknownEncoder');
    assert.equal(analysisIndet.isHardware, false);
    assert.equal(analysisIndet.isSoftware, false);
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

  test('Em modo Automático, mungeSdpBandwidth deve priorizar H.264 sobre AV1 nos payloads', () => {
    const wm = new WebRTCManager(null);
    wm.preferredCodec = 'auto';

    const munged = wm.mungeSdpBandwidth(sampleSdp, 8000000);
    const mLine = munged.split('\r\n').find(l => l.startsWith('m=video'));
    assert.ok(mLine, 'm=video deve existir no SDP');

    const payloads = mLine.split(' ').slice(3);
    const h264Idx = payloads.indexOf('102');
    const av1Idx = payloads.indexOf('45');

    assert.ok(h264Idx !== -1, 'Payload H.264 (102) deve estar presente');
    assert.ok(av1Idx !== -1, 'Payload AV1 (45) deve estar presente');
    assert.ok(h264Idx < av1Idx, `H.264 (pos ${h264Idx}) deve vir antes de AV1 (pos ${av1Idx}) no modo Automático`);
  });

  test('Quando AV1 é selecionado em preferredCodec, mungeSdpBandwidth deve colocar AV1 à frente com H.264 logo abaixo', () => {
    const wm = new WebRTCManager(null);
    wm.preferredCodec = 'AV1';

    const munged = wm.mungeSdpBandwidth(sampleSdp, 8000000);
    const mLine = munged.split('\r\n').find(l => l.startsWith('m=video'));
    const payloads = mLine.split(' ').slice(3);
    const h264Idx = payloads.indexOf('102');
    const av1Idx = payloads.indexOf('45');

    assert.ok(av1Idx < h264Idx, 'AV1 deve vir antes de H.264 quando usuário seleciona AV1');
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

describe('8. Opção Priorizar H.264 High 5.0 (640032) e preferência de AV1 em configureCodecPreferences', () => {
  const sampleCapabilities = {
    codecs: [
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
    ]
  };

  test('Padrão (desativada): mantém 42e01f (pm=1) no topo, seguido de 4d001f (pm=1)', () => {
    const origSender = globalThis.RTCRtpSender;
    globalThis.RTCRtpSender = { getCapabilities: () => sampleCapabilities };
    try {
      const wm = new WebRTCManager(null);
      assert.equal(wm.getPrioritizeH264High50(), false);

      let appliedOrder = null;
      const mockTransceiver = {
        setCodecPreferences: (codecs) => { appliedOrder = codecs; }
      };

      wm.configureCodecPreferences(mockTransceiver);
      assert.ok(appliedOrder);
      assert.equal(appliedOrder.length, sampleCapabilities.codecs.length);
      assert.ok(appliedOrder[0].sdpFmtpLine.includes('profile-level-id=42e01f'));
      assert.ok(appliedOrder[0].sdpFmtpLine.includes('packetization-mode=1'));
      assert.ok(appliedOrder[1].sdpFmtpLine.includes('profile-level-id=4d001f'));
      assert.ok(appliedOrder[1].sdpFmtpLine.includes('packetization-mode=1'));
    } finally {
      globalThis.RTCRtpSender = origSender;
    }
  });

  test('Ativada: coloca no topo H.264 640032 (pm=1), depois 42e01f (pm=1) e 4d001f (pm=1), mantendo rtx/red/ulpfec', () => {
    const origSender = globalThis.RTCRtpSender;
    globalThis.RTCRtpSender = { getCapabilities: () => sampleCapabilities };
    try {
      const wm = new WebRTCManager(null);
      wm.prioritizeH264High50 = true;
      assert.equal(wm.getPrioritizeH264High50(), true);

      let appliedOrder = null;
      const mockTransceiver = {
        setCodecPreferences: (codecs) => { appliedOrder = codecs; }
      };

      wm.configureCodecPreferences(mockTransceiver);
      assert.ok(appliedOrder);
      assert.equal(appliedOrder.length, sampleCapabilities.codecs.length);
      assert.ok(appliedOrder[0].sdpFmtpLine.includes('profile-level-id=640032'));
      assert.ok(appliedOrder[0].sdpFmtpLine.includes('packetization-mode=1'));
      assert.ok(appliedOrder[1].sdpFmtpLine.includes('profile-level-id=42e01f'));
      assert.ok(appliedOrder[1].sdpFmtpLine.includes('packetization-mode=1'));
      assert.ok(appliedOrder[2].sdpFmtpLine.includes('profile-level-id=4d001f'));
      assert.ok(appliedOrder[2].sdpFmtpLine.includes('packetization-mode=1'));

      const lastThreeMimes = appliedOrder.slice(-3).map(c => c.mimeType);
      assert.deepEqual(lastThreeMimes, ['video/rtx', 'video/red', 'video/ulpfec']);
    } finally {
      globalThis.RTCRtpSender = origSender;
    }
  });

  test('Quando AV1 é escolhido, coloca video/AV1 no topo e mantém H.264 (42e01f, 4d001f) logo abaixo como fallback de negociação', () => {
    const origSender = globalThis.RTCRtpSender;
    globalThis.RTCRtpSender = { getCapabilities: () => sampleCapabilities };
    try {
      const wm = new WebRTCManager(null);
      wm.preferredCodec = 'AV1';

      let appliedOrder = null;
      const mockTransceiver = {
        setCodecPreferences: (codecs) => { appliedOrder = codecs; }
      };

      wm.configureCodecPreferences(mockTransceiver);
      assert.ok(appliedOrder);
      assert.equal(appliedOrder.length, sampleCapabilities.codecs.length);
      assert.equal(appliedOrder[0].mimeType, 'video/AV1');
      assert.equal(appliedOrder[1].mimeType, 'video/H264');
      assert.ok(appliedOrder[1].sdpFmtpLine.includes('profile-level-id=42e01f'));
      assert.equal(appliedOrder[2].mimeType, 'video/H264');
      assert.ok(appliedOrder[2].sdpFmtpLine.includes('profile-level-id=4d001f'));

      const lastThreeMimes = appliedOrder.slice(-3).map(c => c.mimeType);
      assert.deepEqual(lastThreeMimes, ['video/rtx', 'video/red', 'video/ulpfec']);
    } finally {
      globalThis.RTCRtpSender = origSender;
    }
  });
});

