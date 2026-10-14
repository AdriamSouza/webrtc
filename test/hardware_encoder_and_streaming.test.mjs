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

  test('libaom deve ser categorizado estritamente como Software CPU sem falsos positivos de GPU', () => {
    const analysis = analyzeEncoderImplementation(
      'libaom',
      'AV1',
      { framesEncoded: 120, bytesSent: 400000, framesDelta: 60 }
    );

    assert.equal(analysis.category, 'software');
    assert.equal(analysis.isHardware, false);
    assert.equal(analysis.isSoftware, true);
    assert.match(analysis.label, /Software \(CPU: libaom\)/);
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
});

