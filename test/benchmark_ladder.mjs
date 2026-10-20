import { AdaptiveLadder as NewAdaptiveLadder } from '../desktop/screen-worker/adaptive_ladder.mjs';

export function createTraces() {
  return {
    isolatedSpike: Array.from({ length: 60 }, (_, i) => ({
      second: i + 1,
      lossPercent: i === 15 ? 8.0 : 0.0,
      jitterMs: i === 15 ? 120 : 15,
      estimatedBps: 15000000,
      isFocused: true,
      state: 'active'
    })),
    sustainedLoss: Array.from({ length: 60 }, (_, i) => ({
      second: i + 1,
      lossPercent: (i >= 10 && i < 30) ? 4.5 : 0.1,
      jitterMs: (i >= 10 && i < 30) ? 65 : 12,
      estimatedBps: (i >= 10 && i < 30) ? 4000000 : 15000000,
      isFocused: true,
      state: 'active'
    })),
    oscillation: Array.from({ length: 60 }, (_, i) => ({
      second: i + 1,
      lossPercent: (i % 4 < 2) ? 4.0 : 0.0,
      jitterMs: (i % 4 < 2) ? 80 : 10,
      estimatedBps: (i % 4 < 2) ? 3000000 : 15000000,
      isFocused: true,
      state: 'active'
    })),
    staticScreen: Array.from({ length: 60 }, (_, i) => ({
      second: i + 1,
      lossPercent: 0.0,
      jitterMs: 5,
      estimatedBps: 800000, // tela estática consome pouco bitrate
      isStatic: true,
      isFocused: true,
      state: 'active'
    })),
    recovery: Array.from({ length: 60 }, (_, i) => ({
      second: i + 1,
      lossPercent: i < 20 ? 4.0 : 0.0,
      jitterMs: i < 20 ? 70 : 8,
      estimatedBps: i < 20 ? 3000000 : 18000000,
      isFocused: true,
      state: 'active'
    }))
  };
}

export function runSimulation(LadderClass, trace, options = {}) {
  let switches = 0;
  let lastLevel = null;
  const history = [];

  const ladder = new LadderClass({
    defaultLevel: '1080p60',
    ...options,
    onLevelChange: (viewerId, newLevel, reason, oldLevel, details) => {
      switches++;
      history.push({ second: ladder._currentSecond, oldLevel, newLevel, reason, details });
    }
  });
  ladder.initViewer('sim-viewer');
  lastLevel = ladder.getViewerState('sim-viewer').currentLevel;

  for (const sample of trace) {
    ladder._currentSecond = sample.second;
    ladder.processReport('sim-viewer', sample);
  }

  const durationMin = trace.length / 60;
  const switchesPerMinute = (switches / durationMin).toFixed(1);
  return { switches, switchesPerMinute, history, finalLevel: ladder.getViewerState('sim-viewer').currentLevel, finalBitrate: ladder.getGlobalEffectiveBitrateKbps() };
}

if (process.argv[1]?.endsWith('benchmark_ladder.mjs')) {
  const traces = createTraces();
  console.log('=== BENCHMARK DE QUALIDADE ADAPTATIVA: NOVA ESCADA SUAVIZADA ===\n');

  for (const [name, trace] of Object.entries(traces)) {
    const res = runSimulation(NewAdaptiveLadder, trace);
    console.log(`Trace [${name}]:`);
    console.log(`  - Total de trocas de nível/passo: ${res.switches} (${res.switchesPerMinute} trocas/min)`);
    console.log(`  - Nível final: ${res.finalLevel} (${res.finalBitrate} kbps)`);
    if (res.history.length > 0) {
      console.log('  - Histórico de eventos:');
      res.history.forEach(h => console.log(`    s=${h.second} | ${h.oldLevel} -> ${h.newLevel} | ${h.reason}`));
    } else {
      console.log('  - Estável! Zero quedas indevidas.');
    }
    console.log('');
  }
}
