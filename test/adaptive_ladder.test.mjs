import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveLadder, QUALITY_LADDER, LADDER_ORDER } from '../desktop/screen-worker/adaptive_ladder.mjs';

test('Screen Worker — Lógica de Decisão da Escada Adaptativa Gradual e Suavizada', async (t) => {
  await t.test('1. Espectador focado inicia no nível padrão (1080p60 / L0, 10 Mbps)', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60' });
    const v = ladder.initViewer('viewer-1');
    assert.equal(v.currentLevel, '1080p60');
    assert.equal(ladder.getGlobalEffectiveLevel(), '1080p60');
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 10000);
  });

  await t.test('2. Aba em segundo plano reduz nível para 720p30 (L2, 3 Mbps)', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60' });
    ladder.initViewer('viewer-1');
    const level = ladder.processReport('viewer-1', {
      isFocused: false,
      state: 'background'
    });
    assert.equal(level, '720p30');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /segundo plano/i);
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 3000);
  });

  await t.test('3. Espectador inativo desce para 480p30 (L3, 1.5 Mbps)', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60' });
    ladder.initViewer('viewer-1');
    const level = ladder.processReport('viewer-1', {
      state: 'inactive'
    });
    assert.equal(level, '480p30');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /inativo/i);
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 1500);
  });

  await t.test('4. Imunidade a pico isolado: perda alta de 1 segundo NÃO derruba a qualidade', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60' });
    ladder.initViewer('viewer-1');
    // Pico isolado extremo de 8.0% em uma única amostra
    const level = ladder.processReport('viewer-1', {
      isFocused: true,
      lossPercent: 8.0,
      jitterMs: 120
    });
    // Deve continuar em 1080p60 graças à filtragem EWMA
    assert.equal(level, '1080p60');
    assert.equal(ladder.getViewerState('viewer-1').currentBitrateStep, 0, 'Passo de bitrate deve permanecer em 100%');
  });

  await t.test('5. Perda sustentada (>2.5% por 4s) reduz gradualmente o bitrate antes do nível', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60', minDwellSeconds: 0 });
    ladder.initViewer('viewer-1');

    // 4 segundos consecutivos de perda sustentada a 4.5%
    for (let s = 1; s <= 3; s++) {
      ladder._currentSecond = s;
      ladder.processReport('viewer-1', { isFocused: true, lossPercent: 4.5, jitterMs: 20 });
    }
    // Nos primeiros 3s ainda acumula EWMA e janela sustentada
    assert.equal(ladder.getViewerState('viewer-1').currentLevel, '1080p60');

    // No 4º segundo sustentado, ativa primeiro passo de descida fina (100% -> 80%)
    ladder._currentSecond = 4;
    ladder.processReport('viewer-1', { isFocused: true, lossPercent: 4.5, jitterMs: 20 });
    assert.equal(ladder.getViewerState('viewer-1').currentBitrateStep, 1, 'Primeiro passo deve ser redução para 80% do bitrate');
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 8000);
  });

  await t.test('6. Jitter alto sustentado (>55ms por 4s) aciona degrau adaptativo', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60', minDwellSeconds: 0 });
    ladder.initViewer('viewer-1');

    for (let s = 1; s <= 4; s++) {
      ladder._currentSecond = s;
      ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0, jitterMs: 80 });
    }
    assert.equal(ladder.getViewerState('viewer-1').currentBitrateStep, 1);
    assert.match(ladder.getViewerState('viewer-1').lastReason, /Jitter sustentado/i);
  });

  await t.test('7. Proteção contra tela estática: baixo bitrate com zero perda NÃO reduz qualidade', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60' });
    ladder.initViewer('viewer-1');

    for (let s = 1; s <= 10; s++) {
      ladder._currentSecond = s;
      ladder.processReport('viewer-1', {
        isFocused: true,
        lossPercent: 0.0,
        jitterMs: 5,
        estimatedBps: 800000, // tela estática consome pouco tráfego
        isStatic: true
      });
    }
    // Permanece intacto em 1080p60 sem quedas indevidas
    assert.equal(ladder.getViewerState('viewer-1').currentLevel, '1080p60');
    assert.equal(ladder.getViewerState('viewer-1').currentBitrateStep, 0);
  });

  await t.test('8. 15 segundos estáveis recuperam o nível com histerese (1080p30 -> 1080p60)', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60', minDwellSeconds: 0 });
    ladder.initViewer('viewer-1');
    ladder.setLevel('viewer-1', '1080p30', 'Teste manual', 0);

    for (let s = 1; s <= 14; s++) {
      ladder._currentSecond = s;
      ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0.1, jitterMs: 10, estimatedBps: 15000000 });
      assert.equal(ladder.getViewerState('viewer-1').currentLevel, '1080p30');
    }
    // No 15º segundo: sobe para 1080p60
    ladder._currentSecond = 15;
    ladder.processReport('viewer-1', { isFocused: true, lossPercent: 0.1, jitterMs: 10, estimatedBps: 15000000 });
    assert.equal(ladder.getViewerState('viewer-1').currentLevel, '1080p60');
    assert.match(ladder.getViewerState('viewer-1').lastReason, /Rede estável por 15s/i);
  });

  await t.test('9. Multi-viewer: menor nível comum (lowest-common-denominator) para o encoder global', () => {
    const ladder = new AdaptiveLadder({ defaultLevel: '1080p60' });
    ladder.initViewer('viewer-A');
    ladder.initViewer('viewer-B');
    ladder.setLevel('viewer-A', '1080p60', 'Excelente rede', 0);
    ladder.setLevel('viewer-B', '720p30', 'Rede 4G instável', 0);

    assert.equal(ladder.getGlobalEffectiveLevel(), '720p30');
    assert.equal(ladder.getGlobalEffectiveBitrateKbps(), 3000);

    const table = ladder.getDiagnosticsTable();
    assert.equal(table.length, 2);
    assert.equal(table[0].gpuEncodeStatus, 'medido');
  });

  await t.test('10. Aliases legados L0–L3 mantêm total retrocompatibilidade', () => {
    assert.ok(QUALITY_LADDER['L0']);
    assert.ok(QUALITY_LADDER['L1']);
    assert.ok(QUALITY_LADDER['L2']);
    assert.ok(QUALITY_LADDER['L3']);
    assert.equal(QUALITY_LADDER['L0'].fps, 60);
    assert.equal(QUALITY_LADDER['L3'].fps, 30);
  });
});
