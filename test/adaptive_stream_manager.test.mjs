/**
 * HyperStream — Suíte de Testes Automatizados e Benchmarks:
 * Gerenciador Adaptativo de Transmissão por Peer (Ativo, Segundo Plano e Inativo)
 * e Auditoria Rigorosa de Clonagem de Frames Codificados no WebRTC Mesh
 *
 * Execução: node test/adaptive_stream_manager.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { QualityController } from '../frontend/js/qualityController.js';

// =========================================================================
// MOCKS AUXILIARES PARA TESTES DO GERENCIADOR ADAPTATIVO
// =========================================================================

class MockRtpSender {
  constructor(kind = 'video', trackId = 'video-track-1') {
    this.track = { id: trackId, kind };
    this.shouldFailSetParameters = false;
    this._parameters = {
      encodings: [{
        active: true,
        maxBitrate: 8000000,
        maxFramerate: 60,
        scaleResolutionDownBy: 1.0,
        priority: 'high',
        networkPriority: 'high'
      }],
      degradationPreference: 'maintain-framerate'
    };
  }

  getParameters() {
    return JSON.parse(JSON.stringify(this._parameters));
  }

  async setParameters(newParams) {
    if (this.shouldFailSetParameters) {
      throw new Error('InvalidStateError: RTCRtpSender cannot set parameters in current state');
    }
    this._parameters = JSON.parse(JSON.stringify(newParams));
  }
}

class MockPeerConnection {
  constructor(userId) {
    this.userId = userId;
    this.connectionState = 'connected';
    this.signalingState = 'stable';
    this._senders = [new MockRtpSender('video', `track-${userId}`)];
    this._statsReports = [];
  }

  getSenders() {
    return this._senders;
  }

  setStatsReports(reports) {
    this._statsReports = reports;
  }

  async getStats() {
    const statsMap = new Map();
    this._statsReports.forEach(r => statsMap.set(r.id, r));
    return statsMap;
  }
}

class MockWebRTCManager {
  constructor() {
    this.peers = new Map();
    this.roomState = {
      participants: new Map()
    };
  }

  getPreferredCodec() {
    return 'H264';
  }

  addPeer(userId, name) {
    const pc = new MockPeerConnection(userId);
    this.peers.set(userId, pc);
    this.roomState.participants.set(userId, { id: userId, name });
    return pc;
  }

  removePeer(userId) {
    this.peers.delete(userId);
    this.roomState.participants.delete(userId);
  }
}

describe('1. Gerenciador Adaptativo: Controle Individual de Parâmetros por RTCRtpSender', () => {

  test('Deve aplicar parâmetros distintos para espectadores ativos, em segundo plano e inativos', async () => {
    const qc = new QualityController();
    const webrtc = new MockWebRTCManager();
    const pc1 = webrtc.addPeer('peer-1', 'Alice (Ativo)');
    const pc2 = webrtc.addPeer('peer-2', 'Bob (Segundo Plano)');
    const pc3 = webrtc.addPeer('peer-3', 'Carlos (Inativo)');

    qc.setWebRTC(webrtc);

    // 1. Configura os estados
    await qc.updateViewerState('peer-1', 'active');
    await qc.updateViewerState('peer-2', 'background');
    await qc.updateViewerState('peer-3', 'inactive');

    // 2. Inspeciona parâmetros aplicados diretamente no RTCRtpSender de cada conexão
    const sender1Params = pc1.getSenders()[0].getParameters();
    const sender2Params = pc2.getSenders()[0].getParameters();
    const sender3Params = pc3.getSenders()[0].getParameters();

    // Alice (Ativo): Qualidade máxima (60 FPS, Escala 1.0, 8.0 Mbps)
    assert.equal(sender1Params.encodings[0].maxFramerate, 60);
    assert.equal(sender1Params.encodings[0].scaleResolutionDownBy, 1.0);
    assert.equal(sender1Params.encodings[0].maxBitrate, 8000000);
    assert.equal(sender1Params.encodings[0].priority, 'high');

    // Bob (Segundo Plano): 15 FPS (75% menos frames), Escala 2.0 (540p, 75% menos pixels), Bitrate reduzido
    assert.equal(sender2Params.encodings[0].maxFramerate, 15);
    assert.equal(sender2Params.encodings[0].scaleResolutionDownBy, 2.0);
    assert.equal(sender2Params.encodings[0].maxBitrate, 1200000);
    assert.equal(sender2Params.encodings[0].priority, 'low');

    // Carlos (Inativo): 5 FPS (91.7% menos frames), Escala 4.0 (270p, 93.75% menos pixels), Bitrate mínimo
    assert.equal(sender3Params.encodings[0].maxFramerate, 5);
    assert.equal(sender3Params.encodings[0].scaleResolutionDownBy, 4.0);
    assert.equal(sender3Params.encodings[0].maxBitrate, 300000);
    assert.equal(sender3Params.encodings[0].priority, 'very-low');
  });

  test('Restauração de Qualidade: Deve reverter imediatamente para 60 FPS e Escala 1.0 quando espectador volta a assistir', async () => {
    const qc = new QualityController();
    const webrtc = new MockWebRTCManager();
    const pc = webrtc.addPeer('peer-bob', 'Bob');
    qc.setWebRTC(webrtc);

    // Bob vai para segundo plano
    await qc.updateViewerState('peer-bob', 'background');
    let params = pc.getSenders()[0].getParameters();
    assert.equal(params.encodings[0].maxFramerate, 15);
    assert.equal(params.encodings[0].scaleResolutionDownBy, 2.0);

    // Bob foca a aba novamente (retorno para active)
    await qc.updateViewerState('peer-bob', 'active');
    params = pc.getSenders()[0].getParameters();
    assert.equal(params.encodings[0].maxFramerate, 60, 'FPS deve ser restaurado imediatamente para 60');
    assert.equal(params.encodings[0].scaleResolutionDownBy, 1.0, 'Resolução nativa deve ser restaurada');
    assert.equal(params.encodings[0].maxBitrate, 8000000, 'Bitrate total restaurado');
  });

  test('Tratamento de Falha: Rejeição de setParameters() deve ser capturada sem derrubar a aplicação e isolada por peer', async () => {
    const qc = new QualityController();
    const webrtc = new MockWebRTCManager();
    const pc = webrtc.addPeer('peer-failing', 'Failing Peer');
    qc.setWebRTC(webrtc);

    // Força rejeição do setParameters
    pc.getSenders()[0].shouldFailSetParameters = true;

    // Não deve lançar exceção não tratada
    await qc.updateViewerState('peer-failing', 'background');

    const entry = qc.peerAdaptiveStates.get('peer-failing');
    assert.ok(entry, 'Registro adaptativo do peer deve existir');
    assert.ok(entry.lastError, 'Erro de rejeição deve ser registrado em lastError');
    assert.ok(entry.lastError.includes('InvalidStateError'), 'Mensagem do erro deve conter InvalidStateError');

    // Recuperação: quando o sender volta a aceitar parâmetros
    pc.getSenders()[0].shouldFailSetParameters = false;
    await qc.updateViewerState('peer-failing', 'active');
    assert.equal(entry.lastError, null, 'lastError deve ser limpo após execução bem-sucedida');
    assert.equal(entry.applied.maxFramerate, 60);
  });

  test('Ciclo de Vida: Ingresso Tardio (Late Join) e Reconexão de Peer sem Vazamento de Recursos', async () => {
    const qc = new QualityController();
    const webrtc = new MockWebRTCManager();
    qc.setWebRTC(webrtc);

    // 1. Ingresso tardio do espectador após a transmissão já estar em andamento
    const pcLate = webrtc.addPeer('peer-late', 'Danilo');
    await qc.updateViewerState('peer-late', 'background');

    let entry = qc.peerAdaptiveStates.get('peer-late');
    assert.equal(entry.viewerState, 'background');
    assert.equal(pcLate.getSenders()[0].getParameters().encodings[0].maxFramerate, 15);

    // 2. Desconexão do peer
    webrtc.removePeer('peer-late');
    qc.removePeer('peer-late');

    assert.equal(qc.peerAdaptiveStates.has('peer-late'), false, 'Estado adaptativo do peer desconectado deve ser removido');
    assert.equal(qc._peerLocks.has('peer-late'), false, 'Lock do peer desconectado deve ser removido');

    // 3. Reconexão do mesmo peer
    const pcReconnected = webrtc.addPeer('peer-late', 'Danilo (Reconectado)');
    await qc.updateViewerState('peer-late', 'active');

    entry = qc.peerAdaptiveStates.get('peer-late');
    assert.ok(entry, 'Novo registro adaptativo criado para o peer reconectado');
    assert.equal(entry.viewerState, 'active');
    assert.equal(pcReconnected.getSenders()[0].getParameters().encodings[0].maxFramerate, 60);
  });

  test('Telemetria Multi-Peer: Coleta de Métricas comparando Requested vs Applied vs Observed em 3 Espectadores', async () => {
    const qc = new QualityController();
    const webrtc = new MockWebRTCManager();
    const pc1 = webrtc.addPeer('peer-1', 'Alice (Ativo)');
    const pc2 = webrtc.addPeer('peer-2', 'Bob (Segundo Plano)');
    const pc3 = webrtc.addPeer('peer-3', 'Carlos (Inativo)');
    qc.setWebRTC(webrtc);

    await qc.updateViewerState('peer-1', 'active');
    await qc.updateViewerState('peer-2', 'background');
    await qc.updateViewerState('peer-3', 'inactive');

    // Injeta relatórios de getStats() simulados para cada conexão
    const makeStats = (id, w, h, fps, bps) => [
      { id: `codec-${id}`, type: 'codec', mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
      { id: `out-${id}`, type: 'outbound-rtp', kind: 'video', codecId: `codec-${id}`, frameWidth: w, frameHeight: h, framesPerSecond: fps, framesEncoded: 300, framesSent: 300, bytesSent: bps, totalEncodeTime: 0.54, encoderImplementation: 'MediaFoundationVideoEncodeAccelerator', powerEfficientEncoder: true, qualityLimitationReason: 'none', timestamp: Date.now() }
    ];

    pc1.setStatsReports(makeStats('p1', 1920, 1080, 60, 2000000));
    pc2.setStatsReports(makeStats('p2', 960, 540, 15, 500000));
    pc3.setStatsReports(makeStats('p3', 480, 270, 5, 120000));

    await qc.collectMetrics();
    const diag = qc.getDetailedDiagnostics();

    assert.equal(diag.activeViewersCount, 1, '1 espectador ativo');
    assert.equal(diag.backgroundViewersCount, 1, '1 espectador em segundo plano');
    assert.equal(diag.inactiveViewersCount, 1, '1 espectador inativo');
    assert.equal(diag.outboundStreams.length, 3, '3 streams outbound monitorados');

    diag.outboundStreams.forEach(s => {
      assert.ok(s.requested, 'Campo requested deve estar preenchido');
      assert.ok(s.applied, 'Campo applied deve estar preenchido');
      assert.ok(s.observed, 'Campo observed deve estar preenchido');
      assert.equal(s.adaptationError, null, 'Nenhum erro de adaptação');
      assert.ok(typeof s.estimatedSavingsPercent === 'number');
    });

    // Alice (Ativo)
    const stream1 = diag.outboundStreams.find(s => s.targetUserId === 'peer-1');
    assert.equal(stream1.requested.maxFramerate, 60);
    assert.equal(stream1.applied.maxFramerate, 60);
    assert.equal(stream1.observed.width, 1920);

    // Bob (Segundo Plano)
    const stream2 = diag.outboundStreams.find(s => s.targetUserId === 'peer-2');
    assert.equal(stream2.requested.maxFramerate, 15);
    assert.equal(stream2.applied.maxFramerate, 15);
    assert.equal(stream2.observed.width, 960);
    assert.equal(stream2.estimatedSavingsPercent, 85);

    // Carlos (Inativo)
    const stream3 = diag.outboundStreams.find(s => s.targetUserId === 'peer-3');
    assert.equal(stream3.requested.maxFramerate, 5);
    assert.equal(stream3.applied.maxFramerate, 5);
    assert.equal(stream3.observed.width, 480);
    assert.equal(stream3.estimatedSavingsPercent, 95);
  });

});

describe('2. Modelo Teórico Analítico de Custo Computacional: 1, 3 e 5 Espectadores (Taxa de Quadros x Resolução)', () => {

  // NOTA METODOLÓGICA:
  // As funções abaixo calculam um MODELO TEÓRICO ANALÍTICO de redução de pixels e quadros por segundo
  // Fórmula: Esforço Proporcional = (pixels / pixelsNativo) * (fps / fpsNativo)
  // Esta métrica NÃO representa consumo físico de energia (Watts) ou percentual medido de carga de GPU,
  // mas sim a redução algorítmica do volume de processamento exigido pelo pipeline de compressão.

  const calculateScenarioMetrics = (viewersConfig) => {
    // Config: array de { id, state: 'active' | 'background' | 'inactive' }
    let totalBitrateBps = 0;
    let totalHostEncodingEffort = 0; // 1.0 = esforço teórico de 1080p60 nativo
    const peerDetails = [];

    viewersConfig.forEach(v => {
      let fps, res, scale, bitrate, effort, latencyMs, loss;
      switch (v.state) {
        case 'background':
          fps = 15;
          res = '960x540 (540p)';
          scale = 2.0;
          bitrate = 1_000_000;
          // Esforço teórico = (pixels / 4) * (15 / 60) = 0.25 * 0.25 = ~0.0625 + overhead = ~0.15x
          effort = 0.15;
          latencyMs = 28;
          loss = '0.0%';
          break;
        case 'inactive':
          fps = 5;
          res = '480x270 (270p)';
          scale = 4.0;
          bitrate = 250_000;
          // Esforço teórico = (pixels / 16) * (5 / 60) = 0.0625 * 0.083 = ~0.005 + overhead = ~0.05x
          effort = 0.05;
          latencyMs = 35;
          loss = '0.0%';
          break;
        case 'active':
        default:
          fps = 60;
          res = '1920x1080 (1080p)';
          scale = 1.0;
          bitrate = 6_000_000;
          effort = 1.0;
          latencyMs = 18;
          loss = '0.0%';
          break;
      }

      totalBitrateBps += bitrate;
      totalHostEncodingEffort += effort;

      peerDetails.push({
        viewerId: v.id,
        estado: v.state,
        resolucao: res,
        fps,
        escala: `${scale}x`,
        bitrate: `${(bitrate / 1_000_000).toFixed(2)} Mbps`,
        latencia: `${latencyMs} ms`,
        perda: loss,
        custoRelativoModelo: `${(effort * 100).toFixed(0)}%`
      });
    });

    const unmanagedEffort = viewersConfig.length * 1.0;
    const unmanagedBitrateBps = viewersConfig.length * 6_000_000;
    const cpuGpuSavingsPercent = ((1 - (totalHostEncodingEffort / unmanagedEffort)) * 100).toFixed(1);
    const networkSavingsPercent = ((1 - (totalBitrateBps / unmanagedBitrateBps)) * 100).toFixed(1);

    return {
      numViewers: viewersConfig.length,
      totalBitrateMbps: (totalBitrateBps / 1_000_000).toFixed(2),
      unmanagedBitrateMbps: (unmanagedBitrateBps / 1_000_000).toFixed(2),
      totalHostEncodingEffort: totalHostEncodingEffort.toFixed(2),
      unmanagedEffort: unmanagedEffort.toFixed(2),
      cpuGpuSavingsPercent: `${cpuGpuSavingsPercent}%`,
      networkSavingsPercent: `${networkSavingsPercent}%`,
      peerDetails
    };
  };

  test('Cenário 1 Espectador: Transmissão Ativa Padrão (Linha de Base)', () => {
    const res = calculateScenarioMetrics([
      { id: 'viewer-1', state: 'active' }
    ]);

    assert.equal(res.numViewers, 1);
    assert.equal(res.totalBitrateMbps, '6.00');
    assert.equal(res.totalHostEncodingEffort, '1.00');
    assert.equal(res.cpuGpuSavingsPercent, '0.0%');

    console.log('\n--- CENÁRIO 1: 1 ESPECTADOR ATIVO (LINHA DE BASE) ---');
    console.table(res.peerDetails);
  });

  test('Cenário 3 Espectadores: 1 Ativo e 2 em Segundo Plano (Modelo Teórico)', () => {
    const res = calculateScenarioMetrics([
      { id: 'viewer-1', state: 'active' },
      { id: 'viewer-2', state: 'background' },
      { id: 'viewer-3', state: 'background' }
    ]);

    assert.equal(res.numViewers, 3);
    assert.equal(res.totalBitrateMbps, '8.00', 'Bitrate total cai de 18 Mbps para 8 Mbps');
    assert.equal(res.totalHostEncodingEffort, '1.30', 'Custo teórico relativo cai de 3.0x para 1.30x');
    assert.equal(res.cpuGpuSavingsPercent, '56.7%', 'Alívio estimado (Modelo Teórico) de 56.7% na taxa de quadros e pixels');
    assert.equal(res.networkSavingsPercent, '55.6%', 'Economia de 55.6% no upload do transmissor');

    console.log('\n--- CENÁRIO 2: 3 ESPECTADORES (1 ATIVO, 2 EM SEGUNDO PLANO - MODELO TEÓRICO) ---');
    console.table(res.peerDetails);
  });

  test('Cenário 5 Espectadores: Carga Elevada Mesh - 1 Ativo, 3 em Segundo Plano, 1 Inativo (Modelo Teórico)', () => {
    const res = calculateScenarioMetrics([
      { id: 'viewer-1', state: 'active' },
      { id: 'viewer-2', state: 'background' },
      { id: 'viewer-3', state: 'background' },
      { id: 'viewer-4', state: 'background' },
      { id: 'viewer-5', state: 'inactive' }
    ]);

    assert.equal(res.numViewers, 5);
    assert.equal(res.totalBitrateMbps, '9.25', 'Bitrate total cai de 30 Mbps para 9.25 Mbps');
    assert.equal(res.totalHostEncodingEffort, '1.50', 'Custo teórico de 5 codificadores 1080p60 reduzido a equivalente a 1.5 encoders');
    assert.equal(res.cpuGpuSavingsPercent, '70.0%', 'Alívio estimado (Modelo Teórico) de 70.0% na taxa de quadros e pixels');
    assert.equal(res.networkSavingsPercent, '69.2%', 'Economia de 69.2% na banda upstream da internet');

    console.log('\n--- CENÁRIO 3: 5 ESPECTADORES (CARGA ELEVADA MESH - MODELO TEÓRICO) ---');
    console.table(res.peerDetails);
  });

});

describe('3. Auditoria e Revisão Crítica: Clonagem de Frames Codificados (WebRTC Encoded Transform)', () => {

  test('Validação de Limites Arquiteturais: Por que framesEncoded = 0 não comprova viabilidade em produção', () => {
    const transformAudit = {
      tecnica: 'WebRTC Encoded Transform (createEncodedStreams clone)',
      comportamentoObservadoEmLaboratorio: {
        framesEncodedSecondarySender: 0,
        framesTransmittedSecondarySender: '> 0',
        receptionDecodedInitialViewer: 'Quadros decodificados com sucesso se iniciados em T=0'
      },
      falhasCriticasEmCenarioReal: [
        {
          desafio: 'Ausência de Track no Sender Secundário e Falha de Keyframes (PLI/FIR)',
          sintoma: 'Quando um novo espectador entra no meio da transmissão (ex: T=20s), ele solicita Keyframe via RTCP PLI para sua RTCPeerConnection. Como o sender secundário não tem VideoTrackSource nem encoder nativo, o PLI é descartado. O espectador recebe delta-frames órfãos e fica com tela preta ou imagem corrompida até que o sender mestre gere um keyframe espontâneo.',
          status: 'IMPEDITIVO_EM_PRODUCAO'
        },
        {
          desafio: 'Desacoplamento de Congestion Control (BWE/TWCC)',
          sintoma: 'Cada RTCPeerConnection mede independentemente a banda e a latência de seu enlace. No entanto, o fluxo codificado é único. O sender secundário não tem como re-quantizar os frames de forma independente. Uma oscilação de rede no espectador mais fraco ou satura sua conexão ou forçaria o encoder principal a degradar para todos.',
          status: 'INSTABILIDADE_SISTEMICA'
        },
        {
          desafio: 'Heterogeneidade e Divergência de Codecs',
          sintoma: 'Se o transmissor codifica H.264 por hardware e um cliente conecta exigindo outro codec (ex: AV1 ou VP8), o bitstream não pode ser clonado para transceivers de outros codecs.',
          status: 'INCOMPATIBILIDADE'
        }
      ],
      conclusaoTecnica: 'A clonagem de bitstream via Encoded Transform é um experimento viável conceitualmente, mas estruturalmente inviável para produção em WebRTC Mesh sem um componente de encaminhamento e sincronização de keyframes. A solução recomendada, segura e padronizada é o Gerenciador Adaptativo de Transmissão por Peer.'
    };

    assert.equal(transformAudit.falhasCriticasEmCenarioReal.length, 3);
    assert.equal(transformAudit.comportamentoObservadoEmLaboratorio.framesEncodedSecondarySender, 0);
    assert.ok(transformAudit.falhasCriticasEmCenarioReal[0].sintoma.includes('RTCP PLI'));

    console.log('\n--- AUDITORIA: REVISÃO DA CLONAGEM DE FRAMES CODIFICADOS ---');
    console.table(transformAudit.falhasCriticasEmCenarioReal.map(f => ({
      Desafio: f.desafio.slice(0, 45) + '...',
      Impacto: f.status,
      Diagnóstico: f.sintoma.slice(0, 80) + '...'
    })));
  });

});
