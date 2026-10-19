import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveLadder, QUALITY_LADDER } from '../desktop/screen-worker/adaptive_ladder.mjs';

test('Screen Worker — Lógica de Decisão da Escada Adaptativa (L0–L3)', async (t) => {
  await t.test('1. Espectador focado inicia em L0 (1080p60, 10 Mbps)', () => {
    const ladder = new AdaptiveLadder();
    const v = ladder.initViewer('viewer-1');
    assert.equal(v.currentLevel, 'L0');
    assert.equal(ladder.getGlobalEffectiveLevel(), 'L0');
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 10000);
  });

  await t.test('2. Aba em segundo plano reduz nível para L2 (720p30, 3 Mbps)', () => {
    const ladder = new AdaptiveLadder();
    ladder.initViewer('viewer-1');
    const level = ladder.processReport('viewer-1', {
      isFocused: false,
      state: 'background'
    });
    assert.equal(level, 'L2');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /segundo plano/i);
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 3000);
  });

  await t.test('3. Espectador inativo desce para L3 (480p30, 1.5 Mbps)', () => {
    const ladder = new AdaptiveLadder();
    ladder.initViewer('viewer-1');
    const level = ladder.processReport('viewer-1', {
      state: 'inactive'
    });
    assert.equal(level, 'L3');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /inativo/i);
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 1500);
  });

  await t.test('4. Perda de pacotes > 2% desce 1 nível (L0 -> L1)', () => {
    const ladder = new AdaptiveLadder();
    ladder.initViewer('viewer-1');
    const level = ladder.processReport('viewer-1', {
      isFocused: true,
      lossPercent: 2.5
    });
    assert.equal(level, 'L1');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /Perda de pacotes/i);
  });

  await t.test('5. Jitter alto (> 50ms) desce 1 nível', () => {
    const ladder = new AdaptiveLadder();
    ladder.initViewer('viewer-1');
    const level = ladder.processReport('viewer-1', {
      isFocused: true,
      lossPercent: 0,
      jitterMs: 75
    });
    assert.equal(level, 'L1');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /Jitter/i);
  });

  await t.test('6. Banda insuficiente por 3 segundos consecutivos desce 1 nível', () => {
    const ladder = new AdaptiveLadder();
    ladder.initViewer('viewer-1');
    // L0 requer 10000 kbps. Reportamos 4000 kbps (4 Mbps)
    ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0, estimatedBps: 4000000 });
    assert.equal(ladder.getViewerState('viewer-1').currentLevel, 'L0'); // 1s
    ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0, estimatedBps: 4000000 });
    assert.equal(ladder.getViewerState('viewer-1').currentLevel, 'L0'); // 2s
    ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0, estimatedBps: 4000000 });
    assert.equal(ladder.getViewerState('viewer-1').currentLevel, 'L1'); // 3s dispara descida
    assert.match(ladder.getViewerState('viewer-1').lastReason, /Banda estimada insuficiente/i);
  });

  await t.test('7. 15 segundos estáveis sobem 1 nível com histerese (L1 -> L0)', () => {
    const ladder = new AdaptiveLadder();
    ladder.initViewer('viewer-1');
    ladder.setLevel('viewer-1', 'L1', 'Teste');

    for (let s = 1; s <= 14; s++) {
      ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0.1, jitterMs: 10, estimatedBps: 15000000 });
      assert.equal(ladder.getViewerState('viewer-1').currentLevel, 'L1');
    }
    // No 15º segundo: sobe para L0
    ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0.1, jitterMs: 10, estimatedBps: 15000000 });
    assert.equal(ladder.getViewerState('viewer-1').currentLevel, 'L0');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /15s estáveis/i);
  });

  await t.test('8. Multi-viewer: menor nível comum (lowest-common-denominator) para o encoder global', () => {
    const ladder = new AdaptiveLadder();
    ladder.initViewer('viewer-A');
    ladder.initViewer('viewer-B');
    ladder.setLevel('viewer-A', 'L0', 'Excelente rede');
    ladder.setLevel('viewer-B', 'L2', 'Rede 4G instável');

    assert.equal(ladder.getGlobalEffectiveLevel(), 'L2');
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 3000);

    const table = ladder.getDiagnosticsTable();
    assert.equal(table.length, 2);
    assert.equal(table[0].gpuEncodeStatus, 'medido');
  });
});
