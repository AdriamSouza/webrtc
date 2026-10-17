/**
 * Suíte de Testes Automatizados da Telemetria e Diagnóstico do HyperStream
 * Execução: node test/telemetry.test.mjs
 *
 * Valida o processamento do coletor QualityController, cálculo de deltas,
 * identificação determinística de codecs, taxonomia de aceleração por GPU vs CPU
 * e tratamento defensivo de falhas de comunicação e relatórios ausentes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QualityController,
  analyzeEncoderImplementation,
  analyzeDecoderImplementation,
  isHardwareCodecImplementation
} from '../frontend/js/qualityController.js';

// ========================================================
// MOCKS AUXILIARES PARA TESTES DO RUNTIME WEBRTC
// ========================================================

class MockMediaManager {
  constructor({ hasScreen = true, hasCamera = false } = {}) {
    this.screenStream = hasScreen ? { id: 'stream-screen-123' } : null;
    this.cameraStream = hasCamera ? { id: 'stream-camera-456' } : null;
  }

  getScreenVideoTrack() {
    return this.screenStream ? {
      id: 'track-screen-1',
      kind: 'video',
      readyState: 'live',
      getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 })
    } : null;
  }

  getCameraVideoTrack() {
    return this.cameraStream ? {
      id: 'track-camera-1',
      kind: 'video',
      readyState: 'live',
      getSettings: () => ({ width: 1280, height: 720, frameRate: 30 })
    } : null;
  }
}

class MockPeerConnection {
  constructor(statsMap = new Map()) {
    this.connectionState = 'connected';
    this.signalingState = 'stable';
    this._statsMap = statsMap;
    this.shouldThrow = false;
  }

  setReports(reports) {
    this._statsMap = new Map();
    reports.forEach(r => this._statsMap.set(r.id, r));
  }

  async getStats() {
    if (this.shouldThrow) {
      throw new Error('Falha simulada na chamada interna getStats() do WebRTC');
    }
    return this._statsMap;
  }
}

class MockWebRTCManager {
  constructor() {
    this.peers = new Map();
    this.mediaManager = new MockMediaManager({ hasScreen: true, hasCamera: false });
    this.roomState = {
      participants: new Map([
        ['peer-1', { id: 'peer-1', name: 'Alice' }],
        ['peer-2', { id: 'peer-2', name: 'Bob' }],
        ['peer-3', { id: 'peer-3', name: 'Carlos' }]
      ])
    };
    this.peerMediaMap = new Map();
  }

  getPreferredCodec() {
    return 'AV1';
  }

  getMediaMids(userId) {
    return { screen: '0', camera: '1' };
  }
}

// ========================================================
// 1. TESTES UNITÁRIOS DE TAXONOMIA DE CODECS E ENCODERS
// ========================================================

test('1. Taxonomia de Codificadores: Hardware vs Software vs Inconclusivo vs Inativo', () => {
  // A. Aceleração por Hardware confirmada
  const hwMf = analyzeEncoderImplementation('ExternalEncoder (MediaFoundation)', 'AV1', { framesEncoded: 120, bytesSent: 50000 });
  assert.equal(hwMf.category, 'hardware');
  assert.equal(hwMf.isHardware, true);
  assert.equal(hwMf.isSoftware, false);
  assert.match(hwMf.evidence, /DirectX 11/);

  const hwNvenc = analyzeEncoderImplementation('NVENC', 'H264', { framesEncoded: 60, bytesSent: 30000 });
  assert.equal(hwNvenc.category, 'hardware');
  assert.equal(hwNvenc.isHardware, true);

  // B. Fallback de Software confirmado
  const swAom = analyzeEncoderImplementation('libaom', 'AV1', { framesEncoded: 90, bytesSent: 40000 });
  assert.equal(swAom.category, 'software');
  assert.equal(swAom.isHardware, false);
  assert.equal(swAom.isSoftware, true);
  assert.equal(swAom.label, 'Software (CPU)');
  assert.match(swAom.evidence, /libaom/);

  const swOpenH264 = analyzeEncoderImplementation('OpenH264', 'H264', { framesEncoded: 30, bytesSent: 15000 });
  assert.equal(swOpenH264.category, 'software');
  assert.equal(swOpenH264.isSoftware, true);
  assert.equal(swOpenH264.label, 'Software (CPU)');

  // C. Inativo / Ocioso (sem frames codificados)
  const inactive = analyzeEncoderImplementation('ExternalEncoder (MediaFoundation)', 'AV1', { framesEncoded: 0, bytesSent: 0 });
  assert.equal(inactive.category, 'inactive');
  assert.equal(inactive.isHardware, false);
  assert.equal(inactive.label, 'Sem Atividade / Ocioso');

  // D. Inconclusivo / Indeterminado
  const unknown = analyzeEncoderImplementation('CustomUnknownEncoderV3', 'VP9', { framesEncoded: 10, bytesSent: 5000 });
  assert.equal(unknown.category, 'inconclusive');
  assert.equal(unknown.state, 'indeterminado');
  assert.equal(unknown.isHardware, false);
  assert.equal(unknown.isSoftware, false);
});

test('2. Taxonomia de Decodificadores: Hardware vs Software vs Inativo', () => {
  const hwDec = analyzeDecoderImplementation('ExternalDecoder', false, { framesDecoded: 100, bytesReceived: 80000 });
  assert.equal(hwDec.category, 'hardware');
  assert.equal(hwDec.isHardware, true);

  const indetPower = analyzeDecoderImplementation(null, true, { framesDecoded: 50, bytesReceived: 40000 });
  assert.equal(indetPower.category, 'inconclusive');
  assert.equal(indetPower.state, 'indeterminado');
  assert.equal(indetPower.isHardware, false);

  const swDav1d = analyzeDecoderImplementation('dav1d', false, { framesDecoded: 120, bytesReceived: 60000 });
  assert.equal(swDav1d.category, 'software');
  assert.equal(swDav1d.isSoftware, true);
  assert.equal(swDav1d.label, 'Software (CPU)');

  const inactive = analyzeDecoderImplementation('dav1d', false, { framesDecoded: 0, bytesReceived: 0 });
  assert.equal(inactive.category, 'inactive');
});

// ========================================================
// 2. TESTE DE COLETOR EM STANDBY (CAPTURA LOCAL SEM PARES)
// ========================================================

test('3. Coletor em Standby: Captura local ativa sem pares conectados', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();
  mockWebRtc.peers.clear(); // Nenhum peer conectado ainda

  qc.setWebRTC(mockWebRtc);
  await qc.collectMetrics();

  const diag = qc.getDetailedDiagnostics();
  assert.ok(diag, 'latestDiagnostics não deve ser nulo em standby');
  assert.equal(diag.outboundStreams.length, 0, 'Não deve haver outbound RTP sem peers');
  assert.equal(diag.localCaptures.length, 1, 'Deve reportar a captura de tela local');
  assert.equal(diag.localCaptures[0].type, 'screen');
  assert.equal(diag.localCaptures[0].width, 1920);
  assert.equal(diag.localCaptures[0].height, 1080);
  assert.equal(diag.localCaptures[0].fps, 60);
  assert.equal(diag.dominantConnectionType, 'Transmissão Local Ativa (Aguardando Espectadores)');
});

// ========================================================
// 3. TESTE DE STREAM OUTBOUND COM AV1 POR HARDWARE
// ========================================================

test('4. Stream Outbound com AV1 e Aceleração de Hardware Confirmada', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();
  const pc = new MockPeerConnection();

  pc.setReports([
    {
      id: 'codec-av1',
      type: 'codec',
      mimeType: 'video/AV01',
      clockRate: 90000,
      payloadType: 96
    },
    {
      id: 'cp-1',
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      currentRoundTripTime: 0.015,
      bytesSent: 1500000,
      localCandidateId: 'cand-local',
      remoteCandidateId: 'cand-remote'
    },
    {
      id: 'cand-local',
      type: 'local-candidate',
      candidateType: 'host',
      protocol: 'udp'
    },
    {
      id: 'cand-remote',
      type: 'remote-candidate',
      candidateType: 'host',
      protocol: 'udp'
    },
    {
      id: 'outbound-video-1',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-av1',
      encoderImplementation: 'ExternalEncoder (MediaFoundation)',
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 60,
      framesSent: 120,
      framesEncoded: 120,
      bytesSent: 1500000,
      timestamp: 1000
    }
  ]);

  mockWebRtc.peers.set('peer-1', pc);
  qc.setWebRTC(mockWebRtc);

  await qc.collectMetrics();
  const diag = qc.getDetailedDiagnostics();

  assert.equal(diag.outboundStreams.length, 1);
  const stream = diag.outboundStreams[0];
  assert.equal(stream.codec, 'AV1', 'Deve normalizar AV01 para AV1');
  assert.equal(stream.isHardware, true);
  assert.equal(stream.hwCategory, 'hardware');
  assert.equal(stream.targetPeerName, 'Alice');
  assert.equal(stream.streamType, 'Tela / Desktop');
  assert.match(stream.hwEvidence, /MediaFoundation/);
});

// ========================================================
// 4. TESTE DE STREAM OUTBOUND COM FALLBACK DE SOFTWARE (libaom)
// ========================================================

test('5. Stream Outbound com Fallback de Software (libaom)', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();
  const pc = new MockPeerConnection();

  pc.setReports([
    {
      id: 'codec-av1',
      type: 'codec',
      mimeType: 'video/AV1',
      clockRate: 90000,
      payloadType: 96
    },
    {
      id: 'outbound-video-sw',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-av1',
      encoderImplementation: 'libaom',
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 30,
      framesSent: 60,
      framesEncoded: 60,
      bytesSent: 450000,
      timestamp: 1000
    }
  ]);

  mockWebRtc.peers.set('peer-1', pc);
  qc.setWebRTC(mockWebRtc);

  await qc.collectMetrics();
  const diag = qc.getDetailedDiagnostics();

  assert.equal(diag.outboundStreams.length, 1);
  const stream = diag.outboundStreams[0];
  assert.equal(stream.codec, 'AV1');
  assert.equal(stream.isHardware, false);
  assert.equal(stream.isSoftware, true);
  assert.equal(stream.hwCategory, 'software');
  assert.match(stream.hwEvidence, /fallback ativo para biblioteca libaom/);
});

// ========================================================
// 5. TESTE DE MÚLTIPLOS FLUXOS NA MESMA CONEXÃO (TELA + CÂMERA)
// ========================================================

test('6. Múltiplos Fluxos de Vídeo na Mesma Conexão (Tela + Câmera)', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();
  mockWebRtc.mediaManager = new MockMediaManager({ hasScreen: true, hasCamera: true });

  const pc = new MockPeerConnection();
  pc.setReports([
    {
      id: 'codec-av1',
      type: 'codec',
      mimeType: 'video/AV1'
    },
    {
      id: 'codec-h264',
      type: 'codec',
      mimeType: 'video/H264'
    },
    {
      id: 'out-screen',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-av1',
      encoderImplementation: 'ExternalEncoder',
      frameWidth: 1920,
      frameHeight: 1080,
      framesSent: 120,
      bytesSent: 1000000,
      timestamp: 1000
    },
    {
      id: 'out-camera',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '1',
      codecId: 'codec-h264',
      encoderImplementation: 'ExternalEncoder',
      frameWidth: 1280,
      frameHeight: 720,
      framesSent: 60,
      bytesSent: 300000,
      timestamp: 1000
    }
  ]);

  mockWebRtc.peers.set('peer-1', pc);
  qc.setWebRTC(mockWebRtc);

  await qc.collectMetrics();
  const diag = qc.getDetailedDiagnostics();

  assert.equal(diag.outboundStreams.length, 2, 'Deve registrar os 2 fluxos de vídeo na conexão');

  const screenStream = diag.outboundStreams.find(s => s.streamType === 'Tela / Desktop');
  const cameraStream = diag.outboundStreams.find(s => s.streamType === 'Câmera');

  assert.ok(screenStream, 'Fluxo de tela deve estar presente');
  assert.ok(cameraStream, 'Fluxo de câmera deve estar presente');
  assert.equal(screenStream.codec, 'AV1');
  assert.equal(cameraStream.codec, 'H264');
  assert.equal(screenStream.width, 1920);
  assert.equal(cameraStream.width, 1280);
});

// ========================================================
// 6. TESTE DE CÁLCULO DE DELTAS AO LONGO DO TEMPO
// ========================================================

test('7. Cálculo de Deltas de Bitrate e FPS ao Longo do Tempo', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();
  const pc = new MockPeerConnection();

  // Amostra 1 (T = 0s)
  pc.setReports([
    {
      id: 'codec-av1',
      type: 'codec',
      mimeType: 'video/AV1'
    },
    {
      id: 'out-rtp-1',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-av1',
      encoderImplementation: 'ExternalEncoder',
      frameWidth: 1920,
      frameHeight: 1080,
      framesSent: 100,
      framesEncoded: 100,
      bytesSent: 1000000,
      totalEncodeTime: 0.5,
      timestamp: 1000
    }
  ]);

  mockWebRtc.peers.set('peer-1', pc);
  qc.setWebRTC(mockWebRtc);

  await qc.collectMetrics();

  // Amostra 2 (T = 1.5s): +1.500.000 bytes (8 Mbps) e +90 frames (60 FPS)
  pc.setReports([
    {
      id: 'codec-av1',
      type: 'codec',
      mimeType: 'video/AV1'
    },
    {
      id: 'out-rtp-1',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-av1',
      encoderImplementation: 'ExternalEncoder',
      frameWidth: 1920,
      frameHeight: 1080,
      framesSent: 190,
      framesEncoded: 190,
      bytesSent: 2500000,
      totalEncodeTime: 0.95,
      timestamp: 2500
    }
  ]);

  await qc.collectMetrics();
  const diag = qc.getDetailedDiagnostics();

  assert.equal(diag.outboundStreams.length, 1);
  const stream = diag.outboundStreams[0];

  // 1.500.000 bytes * 8 bits / 1.5s = 8.000.000 bps = 8.00 Mbps
  assert.equal(stream.bitrateMbps, '8.00');
  assert.equal(stream.fps, 60, 'FPS deve ser calculado exatamente como 60 via delta de frames');
  assert.match(stream.avgEncodeTimeMs, /ms/, 'Deve calcular tempo médio de codificação');
});

// ========================================================
// 7. TESTE DE RESILIÊNCIA A ERROS EM getStats()
// ========================================================

test('8. Resiliência: Tratamento de exceção em getStats() de um peer', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();

  const brokenPc = new MockPeerConnection();
  brokenPc.shouldThrow = true; // Simula peer com WebRTC crashando

  const healthyPc = new MockPeerConnection();
  healthyPc.setReports([
    {
      id: 'codec-av1',
      type: 'codec',
      mimeType: 'video/AV1'
    },
    {
      id: 'out-healthy',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-av1',
      encoderImplementation: 'ExternalEncoder',
      frameWidth: 1920,
      frameHeight: 1080,
      framesSent: 60,
      bytesSent: 500000,
      timestamp: 1000
    }
  ]);

  mockWebRtc.peers.set('broken-peer', brokenPc);
  mockWebRtc.peers.set('healthy-peer', healthyPc);
  qc.setWebRTC(mockWebRtc);

  // Não deve lançar exceção
  await assert.doesNotReject(async () => {
    await qc.collectMetrics();
  });

  const diag = qc.getDetailedDiagnostics();
  assert.ok(diag, 'Diagnostics deve continuar funcionando');
  assert.equal(diag.outboundStreams.length, 1, 'Deve conter métricas do peer saudável');
  assert.equal(diag.outboundStreams[0].targetPeerId, 'healthy-peer');
});

// ========================================================
// 8. TESTE DE CONEXÃO COM MÚLTIPLOS PEERS
// ========================================================

test('9. Múltiplos Participantes: Segregação correta de transmissões por peer', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();

  ['peer-1', 'peer-2', 'peer-3'].forEach((id, idx) => {
    const pc = new MockPeerConnection();
    pc.setReports([
      { id: 'codec-1', type: 'codec', mimeType: 'video/AV1' },
      {
        id: `out-${id}`,
        type: 'outbound-rtp',
        kind: 'video',
        mid: '0',
        codecId: 'codec-1',
        encoderImplementation: 'ExternalEncoder',
        frameWidth: 1920,
        frameHeight: 1080,
        framesSent: 60 * (idx + 1),
        bytesSent: 400000 * (idx + 1),
        timestamp: 1000
      }
    ]);
    mockWebRtc.peers.set(id, pc);
  });

  qc.setWebRTC(mockWebRtc);
  await qc.collectMetrics();

  const diag = qc.getDetailedDiagnostics();
  assert.equal(diag.outboundStreams.length, 3, 'Deve haver uma linha de envio para cada participante');
  assert.equal(diag.outboundStreams[0].targetPeerName, 'Alice');
  assert.equal(diag.outboundStreams[1].targetPeerName, 'Bob');
  assert.equal(diag.outboundStreams[2].targetPeerName, 'Carlos');
});

// ========================================================
// 9. TESTE DE encoderImplementation AUSENTE (ESTADO UNKNOWN)
// ========================================================

test('10. encoderImplementation ausente: Deve classificar como unknown sem alarme falso de CPU', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();
  const pc = new MockPeerConnection();

  // Simula Chromium 130 no Windows/AMD onde encoderImplementation é undefined
  pc.setReports([
    { id: 'codec-h264', type: 'codec', mimeType: 'video/H264', clockRate: 90000 },
    {
      id: 'out-h264-no-impl',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-h264',
      // encoderImplementation propositalmente omitido / undefined
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 60,
      framesSent: 120,
      framesEncoded: 120,
      bytesSent: 2000000,
      timestamp: 1000
    }
  ]);

  mockWebRtc.peers.set('peer-1', pc);
  qc.setWebRTC(mockWebRtc);

  let reportedMetrics = null;
  qc.onStatsUpdate = (m) => { reportedMetrics = m; };

  await qc.collectMetrics();
  const diag = qc.getDetailedDiagnostics();

  assert.equal(diag.outboundStreams.length, 1);
  const stream = diag.outboundStreams[0];
  assert.equal(stream.codec, 'H264');
  assert.equal(stream.hwState, 'indeterminado', 'Deve estar no estado estrito indeterminado');
  assert.equal(stream.isHardware, false, 'Não deve declarar hardware sem prova');
  assert.equal(stream.isSoftware, false, 'NÃO deve declarar software/CPU por falta de informação!');
  assert.equal(stream.isUnknown, true, 'Deve sinalizar isUnknown como true');
  assert.equal(stream.hwCategory, 'inconclusive');
  assert.equal(stream.hwBadgeClass, 'diag-badge-neutral', 'Badge deve ser neutro e não de aviso de CPU');
  assert.equal(stream.hwLabel, 'Indeterminado');

  // Verifica que formattedCodec NÃO inclui 'Software ⚠️'
  assert.equal(reportedMetrics.codec, 'H264', 'Codec formatado não deve acusar Software CPU falsamente');
  assert.doesNotMatch(reportedMetrics.codec, /Software/, 'NÃO deve conter Software');
});

// ========================================================
// 10. TESTE DE ISOLAMENTO DE DIFERENTES CODECS POR CONEXÃO
// ========================================================

test('11. Isolamento Multi-Peer: Conexões independentes com codecs distintos não se contaminam', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();

  // Peer 1 (Alice): AV1 via software libaom
  const pcAlice = new MockPeerConnection();
  pcAlice.setReports([
    { id: 'codec-alice', type: 'codec', mimeType: 'video/AV1' },
    {
      id: 'out-alice',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-alice',
      encoderImplementation: 'libaom',
      framesSent: 60,
      framesEncoded: 60,
      bytesSent: 300000,
      timestamp: 1000
    }
  ]);

  // Peer 2 (Bob): H264 via hardware MediaFoundation
  const pcBob = new MockPeerConnection();
  pcBob.setReports([
    { id: 'codec-bob', type: 'codec', mimeType: 'video/H264' },
    {
      id: 'out-bob',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-bob',
      encoderImplementation: 'ExternalEncoder (MediaFoundation)',
      framesSent: 120,
      framesEncoded: 120,
      bytesSent: 800000,
      timestamp: 1000
    }
  ]);

  // Peer 3 (Carlos): H264 com encoderImplementation ausente (indeterminado)
  const pcCarlos = new MockPeerConnection();
  pcCarlos.setReports([
    { id: 'codec-carlos', type: 'codec', mimeType: 'video/H264' },
    {
      id: 'out-carlos',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-carlos',
      framesSent: 120,
      framesEncoded: 120,
      bytesSent: 800000,
      timestamp: 1000
    }
  ]);

  mockWebRtc.peers.set('peer-1', pcAlice);
  mockWebRtc.peers.set('peer-2', pcBob);
  mockWebRtc.peers.set('peer-3', pcCarlos);
  qc.setWebRTC(mockWebRtc);

  let reportedMetrics = null;
  qc.onStatsUpdate = (m) => { reportedMetrics = m; };

  await qc.collectMetrics();
  const diag = qc.getDetailedDiagnostics();

  assert.equal(diag.outboundStreams.length, 3);

  const streamAlice = diag.outboundStreams.find(s => s.targetPeerId === 'peer-1');
  const streamBob = diag.outboundStreams.find(s => s.targetPeerId === 'peer-2');
  const streamCarlos = diag.outboundStreams.find(s => s.targetPeerId === 'peer-3');

  // Alice: Software confirmado
  assert.equal(streamAlice.codec, 'AV1');
  assert.equal(streamAlice.hwState, 'software_confirmed');
  assert.equal(streamAlice.isSoftware, true);
  assert.equal(streamAlice.isHardware, false);

  // Bob: Hardware confirmado
  assert.equal(streamBob.codec, 'H264');
  assert.equal(streamBob.hwState, 'hardware_confirmed');
  assert.equal(streamBob.isHardware, true);
  assert.equal(streamBob.isSoftware, false);

  // Carlos: Indeterminado
  assert.equal(streamCarlos.codec, 'H264');
  assert.equal(streamCarlos.hwState, 'indeterminado');
  assert.equal(streamCarlos.isHardware, false);
  assert.equal(streamCarlos.isSoftware, false);

  // Conexão mista não corrompe a telemetria agregada
  assert.match(reportedMetrics.codec, /Misto GPU\/CPU/);
});

// ========================================================
// 11. TESTE DE CICLO DE ENTRADA E SAÍDA DE ESPECTADORES
// ========================================================

test('12. Entrada e saída de espectadores: Não altera diagnóstico dos peers existentes e limpa histórico', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();

  // 1. Apenas Alice conectada com H264 Hardware
  const pcAlice = new MockPeerConnection();
  pcAlice.setReports([
    { id: 'codec-h264', type: 'codec', mimeType: 'video/H264' },
    {
      id: 'out-alice',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-h264',
      encoderImplementation: 'ExternalEncoder (MediaFoundation)',
      framesSent: 60,
      framesEncoded: 60,
      bytesSent: 500000,
      timestamp: 1000
    }
  ]);
  mockWebRtc.peers.set('peer-1', pcAlice);
  qc.setWebRTC(mockWebRtc);

  await qc.collectMetrics();
  let diag = qc.getDetailedDiagnostics();
  assert.equal(diag.outboundStreams.length, 1);
  assert.equal(diag.outboundStreams[0].hwState, 'hardware_confirmed');

  // 2. Bob (celular) entra na sala com encoderImplementation desconhecido (indeterminado)
  const pcBob = new MockPeerConnection();
  pcBob.setReports([
    { id: 'codec-bob', type: 'codec', mimeType: 'video/H264' },
    {
      id: 'out-bob',
      type: 'outbound-rtp',
      kind: 'video',
      mid: '0',
      codecId: 'codec-bob',
      // Sem encoderImplementation
      framesSent: 30,
      framesEncoded: 30,
      bytesSent: 200000,
      timestamp: 1000
    }
  ]);
  mockWebRtc.peers.set('peer-2', pcBob);

  await qc.collectMetrics();
  diag = qc.getDetailedDiagnostics();
  assert.equal(diag.outboundStreams.length, 2);

  // O diagnóstico de Alice DEVE PERMANECER INTACTO (hardware_confirmed)!
  const aliceAfterBob = diag.outboundStreams.find(s => s.targetPeerId === 'peer-1');
  assert.equal(aliceAfterBob.hwState, 'hardware_confirmed', 'Entrada de Bob não deve alterar o diagnóstico de Alice!');
  assert.equal(aliceAfterBob.isHardware, true);

  // Bob deve estar como indeterminado
  const bobStream = diag.outboundStreams.find(s => s.targetPeerId === 'peer-2');
  assert.equal(bobStream.hwState, 'indeterminado');
  assert.equal(bobStream.isSoftware, false);

  // 3. Bob sai da sala
  mockWebRtc.peers.delete('peer-2');
  await qc.collectMetrics();
  diag = qc.getDetailedDiagnostics();

  assert.equal(diag.outboundStreams.length, 1, 'Deve restar apenas o fluxo de Alice');
  assert.equal(diag.outboundStreams[0].targetPeerId, 'peer-1');
  assert.equal(diag.outboundStreams[0].hwState, 'hardware_confirmed');

  // Histórico de deltas de Bob deve ter sido expurgado
  assert.equal(qc.streamStatsHistory.has('out-bob'), false, 'ID de Bob deve ser expurgado do histórico');
});

// ========================================================
// 12. TESTE DE ESTATÍSTICAS INCOMPLETAS OU VAZIAS
// ========================================================

test('13. Estatísticas Incompletas: Tolera relatórios RTP com campos omitidos com segurança', async () => {
  const qc = new QualityController();
  const mockWebRtc = new MockWebRTCManager();
  const pc = new MockPeerConnection();

  // Relatório com dados esparsos/ausentes
  pc.setReports([
    {
      id: 'sparse-report',
      type: 'outbound-rtp',
      kind: 'video'
      // Sem codecId, sem frameWidth, sem bytesSent, sem framesEncoded
    }
  ]);
  mockWebRtc.peers.set('peer-1', pc);
  qc.setWebRTC(mockWebRtc);

  await assert.doesNotReject(async () => {
    await qc.collectMetrics();
  });

  const diag = qc.getDetailedDiagnostics();
  assert.equal(diag.outboundStreams.length, 1);
  const stream = diag.outboundStreams[0];
  assert.equal(stream.hwState, 'inactive', 'Sem dados transmitidos, deve categorizar como inativo');
  assert.equal(stream.isHardware, false);
  assert.equal(stream.isSoftware, false);
  assert.equal(stream.bitrateMbps, '0.00');
  assert.ok(stream.fps === '--' || stream.fps === 0, 'FPS deve ser seguro (-- ou 0)');
});

console.log('Todos os testes automatizados da telemetria definidos.');
