/**
 * Controle de Qualidade Adaptativa para Screen Worker Nativo (AMF GPU)
 * HyperStream — Versão Gradual Suavizada (Etapa 2)
 *
 * Características:
 * - Nova escada: 1440p60, 1080p60, 1080p30, 720p60, 720p30, 480p30 (com aliases legados L0–L3).
 * - Degraus finos: redução de bitrate em passos (100% -> 80% -> 65% do alvo) antes de reduzir FPS ou resolução.
 * - Suavização via EWMA (Média Móvel Ponderada Exponencial) e exigência de condição SUSTENTADA (janela de amostras).
 * - Imunidade a picos isolados de perda ou jitter transitório.
 * - Proteção contra tela estática (baixo tráfego sem perda não é interpretado como rede ruim).
 * - Dwell time mínimo de permanência e histerese assimétrica na recuperação.
 * - Instrumentação detalhada de cada decisão adaptativa.
 */

export const QUALITY_LADDER = {
  '1440p60': {
    id: '1440p60',
    label: '1440p60',
    width: 2560,
    height: 1440,
    fps: 60,
    minBitrateKbps: 8000,
    targetBitrateKbps: 16000,
    maxBitrateKbps: 20000,
    bitrateKbps: 16000,
    av1TargetKbps: 10000
  },
  '1080p60': {
    id: '1080p60',
    label: '1080p60',
    width: 1920,
    height: 1080,
    fps: 60,
    minBitrateKbps: 5000,
    targetBitrateKbps: 10000,
    maxBitrateKbps: 12000,
    bitrateKbps: 10000,
    av1TargetKbps: 6000
  },
  '1080p30': {
    id: '1080p30',
    label: '1080p30',
    width: 1920,
    height: 1080,
    fps: 30,
    minBitrateKbps: 3500,
    targetBitrateKbps: 6000,
    maxBitrateKbps: 8000,
    bitrateKbps: 6000,
    av1TargetKbps: 4000
  },
  '720p60': {
    id: '720p60',
    label: '720p60',
    width: 1280,
    height: 720,
    fps: 60,
    minBitrateKbps: 2500,
    targetBitrateKbps: 5000,
    maxBitrateKbps: 6000,
    bitrateKbps: 5000,
    av1TargetKbps: 3200
  },
  '720p30': {
    id: '720p30',
    label: '720p30',
    width: 1280,
    height: 720,
    fps: 30,
    minBitrateKbps: 1500,
    targetBitrateKbps: 3000,
    maxBitrateKbps: 4000,
    bitrateKbps: 3000,
    av1TargetKbps: 2000
  },
  '480p30': {
    id: '480p30',
    label: '480p30',
    width: 854,
    height: 480,
    fps: 30,
    minBitrateKbps: 800,
    targetBitrateKbps: 1500,
    maxBitrateKbps: 2000,
    bitrateKbps: 1500,
    av1TargetKbps: 1000
  }
};

// Aliases retrocompatíveis (L0..L3)
QUALITY_LADDER['L0'] = QUALITY_LADDER['1080p60'];
QUALITY_LADDER['L1'] = QUALITY_LADDER['720p60'];
QUALITY_LADDER['L2'] = QUALITY_LADDER['720p30'];
QUALITY_LADDER['L3'] = QUALITY_LADDER['480p30'];

export const LADDER_ORDER = ['1440p60', '1080p60', '1080p30', '720p60', '720p30', '480p30'];
export const LEGACY_LADDER_ORDER = ['L0', 'L1', 'L2', 'L3'];

export const BITRATE_STEPS = [1.0, 0.80, 0.65];

export const ADAPTATION_PROFILES = {
  conservative: {
    ewmaAlpha: 0.20,
    sustainedRequiredCount: 4,
    minDwellSeconds: 6,
    upgradeStabilitySeconds: 15,
    lossThresholdPercent: 2.5,
    jitterThresholdMs: 55,
    rttThresholdMs: 200
  },
  balanced: {
    ewmaAlpha: 0.30,
    sustainedRequiredCount: 3,
    minDwellSeconds: 4,
    upgradeStabilitySeconds: 12,
    lossThresholdPercent: 2.0,
    jitterThresholdMs: 45,
    rttThresholdMs: 150
  },
  reactive: {
    ewmaAlpha: 0.45,
    sustainedRequiredCount: 2,
    minDwellSeconds: 3,
    upgradeStabilitySeconds: 8,
    lossThresholdPercent: 1.5,
    jitterThresholdMs: 35,
    rttThresholdMs: 110
  }
};

export class AdaptiveLadder {
  constructor(options = {}) {
    this.ladder = options.customLadder || QUALITY_LADDER;
    this.order = options.ladderOrder || (options.useLegacyOrder ? LEGACY_LADDER_ORDER : LADDER_ORDER);
    this.defaultLevel = options.defaultLevel || (this.order.includes('1080p60') ? '1080p60' : this.order[0]);

    const profileName = options.adaptationProfile || 'conservative';
    const profileCfg = ADAPTATION_PROFILES[profileName] || ADAPTATION_PROFILES.conservative;

    this.ewmaAlpha = options.ewmaAlpha ?? profileCfg.ewmaAlpha;
    this.sustainedRequiredCount = options.sustainedRequiredCount ?? profileCfg.sustainedRequiredCount;
    this.minDwellSeconds = options.minDwellSeconds ?? profileCfg.minDwellSeconds;
    this.upgradeStabilitySeconds = options.upgradeStabilitySeconds ?? profileCfg.upgradeStabilitySeconds;
    this.lossThresholdPercent = options.lossThresholdPercent ?? profileCfg.lossThresholdPercent;
    this.jitterThresholdMs = options.jitterThresholdMs ?? profileCfg.jitterThresholdMs;
    this.rttThresholdMs = options.rttThresholdMs ?? profileCfg.rttThresholdMs;

    this.enableBitrateSteps = options.enableBitrateSteps !== false;
    this.viewers = new Map();
    this.onLevelChange = options.onLevelChange || null; // callback(viewerId, newLevel, reason, oldLevel, details)
    this.decisionLog = [];
  }

  initViewer(viewerId) {
    if (this.viewers.has(viewerId)) return this.viewers.get(viewerId);

    const initial = {
      viewerId,
      currentLevel: this.defaultLevel,
      currentBitrateStep: 0, // 0 = 100%, 1 = 80%, 2 = 65%
      effectiveBitrateKbps: this.calculateEffectiveBitrate(this.defaultLevel, 0),
      lastReason: 'Inicialização (Focado)',
      stableSeconds: 0,
      degradedSeconds: 0,
      bandwidthLowCount: 0,
      lastChangeTimestamp: Date.now(),
      lastChangeSecond: 0,
      ewmaLoss: 0,
      ewmaJitter: 0,
      ewmaRtt: 0,
      ewmaBandwidthKbps: null,
      lastReport: null,
      history: []
    };
    this.viewers.set(viewerId, initial);
    return initial;
  }

  removeViewer(viewerId) {
    this.viewers.delete(viewerId);
  }

  getViewerState(viewerId) {
    return this.viewers.get(viewerId) || null;
  }

  calculateEffectiveBitrate(level, stepIndex = 0) {
    const cfg = this.ladder[level] || this.ladder[this.defaultLevel];
    if (!cfg) return 10000;
    const baseTarget = cfg.targetBitrateKbps || cfg.bitrateKbps || 10000;
    const minBitrate = cfg.minBitrateKbps || Math.round(baseTarget * 0.5);
    const multiplier = BITRATE_STEPS[stepIndex] ?? 1.0;
    return Math.max(minBitrate, Math.round(baseTarget * multiplier));
  }

  logDecision(entry) {
    this.decisionLog.push({
      timestamp: Date.now(),
      ...entry
    });
    if (this.decisionLog.length > 100) this.decisionLog.shift();
  }

  getDecisionLog() {
    return this.decisionLog;
  }

  setLevel(viewerId, newLevel, reason, newStep = 0) {
    const v = this.initViewer(viewerId);
    if (!this.ladder[newLevel]) return false;

    const oldLevel = v.currentLevel;
    const oldStep = v.currentBitrateStep;
    const oldBitrate = v.effectiveBitrateKbps;
    const newBitrate = this.calculateEffectiveBitrate(newLevel, newStep);

    if (oldLevel === newLevel && oldStep === newStep) {
      v.lastReason = reason;
      return false;
    }

    v.currentLevel = newLevel;
    v.currentBitrateStep = newStep;
    v.effectiveBitrateKbps = newBitrate;
    v.lastReason = reason;
    v.stableSeconds = 0;
    v.degradedSeconds = 0;
    v.bandwidthLowCount = 0;
    v.lastChangeTimestamp = Date.now();
    v.lastChangeSecond = this._currentSecond || 0;

    const decisionDetails = {
      viewerId,
      fromLevel: oldLevel,
      toLevel: newLevel,
      fromStep: oldStep,
      toStep: newStep,
      fromBitrateKbps: oldBitrate,
      toBitrateKbps: newBitrate,
      ewmaLoss: v.ewmaLoss.toFixed(2),
      ewmaJitter: Math.round(v.ewmaJitter),
      reason
    };

    v.history.push({
      timestamp: Date.now(),
      second: this._currentSecond || 0,
      ...decisionDetails
    });
    if (v.history.length > 30) v.history.shift();

    this.logDecision(decisionDetails);

    if (typeof this.onLevelChange === 'function') {
      try {
        this.onLevelChange(viewerId, newLevel, reason, oldLevel, decisionDetails);
      } catch (_) {}
    }
    return true;
  }

  setBitrateStep(viewerId, newStep, reason) {
    const v = this.initViewer(viewerId);
    return this.setLevel(viewerId, v.currentLevel, reason, newStep);
  }

  getNextLowerLevel(level) {
    const idx = this.order.indexOf(level);
    if (idx >= 0 && idx < this.order.length - 1) {
      return this.order[idx + 1];
    }
    return level;
  }

  getNextHigherLevel(level) {
    const idx = this.order.indexOf(level);
    if (idx > 0) {
      return this.order[idx - 1];
    }
    return level;
  }

  /**
   * Processa o relatório QUALITY_REPORT de 1 segundo enviado pelo espectador
   * @param {string} viewerId 
   * @param {object} report - { packetsLost, totalPackets, jitterMs, framesDropped, decodeTimeMs, isFocused, state, estimatedBps, rttMs, isStatic }
   */
  processReport(viewerId, report = {}) {
    const v = this.initViewer(viewerId);
    v.lastReport = report;

    const isFocused = report.isFocused !== false;
    const state = report.state || (isFocused ? 'active' : 'background');
    const currentCfg = this.ladder[v.currentLevel] || {};
    const currentSec = this._currentSecond || Math.floor(Date.now() / 1000);

    // 1. Estado Inativo / Minimizada -> Trava no nível mais baixo (ex: 480p30 / L3)
    if (state === 'inactive') {
      const bottomLevel = this.order[this.order.length - 1];
      if (v.currentLevel !== bottomLevel || v.currentBitrateStep !== 0) {
        this.setLevel(viewerId, bottomLevel, 'Espectador inativo (pausando tráfego intensivo)', 0);
      }
      return v.currentLevel;
    }

    // 2. Segundo Plano (aba oculta) -> Trava em 720p30 (L2)
    if (state === 'background' || !isFocused) {
      const bgLevel = this.order.includes('720p30') ? '720p30' : (this.ladder['L2'] ? 'L2' : '720p30');
      const bottomLevel = this.order[this.order.length - 1];
      if (v.currentLevel !== bgLevel && v.currentLevel !== bottomLevel) {
        this.setLevel(viewerId, bgLevel, 'Aba em segundo plano (redução para 720p30)', 0);
      }
      return v.currentLevel;
    }

    // 3. Extração e cálculo de métricas brutas
    let lossPercent = 0;
    if (typeof report.lossPercent === 'number') {
      lossPercent = report.lossPercent;
    } else if (report.totalPackets > 0 && typeof report.packetsLost === 'number') {
      lossPercent = (report.packetsLost / report.totalPackets) * 100;
    }

    const jitterMs = report.jitterMs || (report.jitter ? report.jitter * 1000 : 0);
    const rttMs = report.rttMs || (report.roundTripTime ? report.roundTripTime * 1000 : 0);
    const estimatedKbps = report.estimatedBps ? Math.round(report.estimatedBps / 1000) : null;

    // Atualização com filtro EWMA (Exponential Weighted Moving Average)
    v.ewmaLoss = this.ewmaAlpha * lossPercent + (1 - this.ewmaAlpha) * v.ewmaLoss;
    v.ewmaJitter = this.ewmaAlpha * jitterMs + (1 - this.ewmaAlpha) * v.ewmaJitter;
    if (rttMs > 0) {
      v.ewmaRtt = this.ewmaAlpha * rttMs + (1 - this.ewmaAlpha) * v.ewmaRtt;
    }
    if (estimatedKbps !== null) {
      v.ewmaBandwidthKbps = v.ewmaBandwidthKbps === null
        ? estimatedKbps
        : (this.ewmaAlpha * estimatedKbps + (1 - this.ewmaAlpha) * v.ewmaBandwidthKbps);
    }

    // 4. Detecção de tela estática
    // Em telas estáticas, o encoder gera muito poucos dados e o bitrate cai naturalmente.
    // Se perda e jitter estão baixos, NÃO é sinal de rede degradada.
    const isStatic = Boolean(report.isStatic) || (lossPercent <= 0.5 && jitterMs <= 25 && (!report.framesEncoded || report.framesEncoded < 15));

    // 5. Avaliação de condições de degradação
    const isInstantLoss = lossPercent > this.lossThresholdPercent;
    const isInstantJitter = jitterMs > this.jitterThresholdMs;
    const isLossElevated = v.ewmaLoss > this.lossThresholdPercent || isInstantLoss;
    const isJitterElevated = v.ewmaJitter > this.jitterThresholdMs || isInstantJitter;
    const isRttElevated = (v.ewmaRtt > this.rttThresholdMs || rttMs > this.rttThresholdMs) && this.rttThresholdMs > 0;
    const isBandwidthLow = !isStatic && (v.ewmaBandwidthKbps !== null && v.ewmaBandwidthKbps < v.effectiveBitrateKbps * 0.85);

    const isDegraded = (isLossElevated || isJitterElevated || isRttElevated || isBandwidthLow) && !isStatic;

    // Checagem de dwell time mínimo
    const dwellElapsedSec = currentSec - (v.lastChangeSecond || 0);
    const canChange = dwellElapsedSec >= this.minDwellSeconds;

    if (isDegraded) {
      v.degradedSeconds++;
      v.stableSeconds = 0;

      if (v.degradedSeconds >= this.sustainedRequiredCount && canChange) {
        // Gera motivo descritivo baseado na métrica que sustentou a degradação
        let triggerMetric = 'Rede instável';
        if (isLossElevated) {
          triggerMetric = `Perda de pacotes sustentada (EWMA ${v.ewmaLoss.toFixed(1)}% > ${this.lossThresholdPercent}%)`;
        } else if (isJitterElevated) {
          triggerMetric = `Jitter sustentado (EWMA ${Math.round(v.ewmaJitter)}ms > ${this.jitterThresholdMs}ms)`;
        } else if (isBandwidthLow) {
          triggerMetric = `Banda estimada insuficiente (EWMA ${Math.round(v.ewmaBandwidthKbps)} kbps < ${v.effectiveBitrateKbps} kbps)`;
        }

        // Degraus finos: antes de reduzir resolução ou fps, reduz o bitrate em passos (100% -> 80% -> 65%)
        if (this.enableBitrateSteps && v.currentBitrateStep < BITRATE_STEPS.length - 1) {
          const nextStep = v.currentBitrateStep + 1;
          this.setBitrateStep(viewerId, nextStep, `${triggerMetric} — Reduzindo bitrate para ${Math.round(BITRATE_STEPS[nextStep] * 100)}%`);
          v.degradedSeconds = 0;
          return v.currentLevel;
        }

        // Se já está no menor passo de bitrate do nível atual, desce 1 degrau na escada (FPS ou Resolução)
        const lower = this.getNextLowerLevel(v.currentLevel);
        if (lower !== v.currentLevel) {
          this.setLevel(viewerId, lower, `${triggerMetric} — Reduzindo para ${lower}`, 0);
          v.degradedSeconds = 0;
          return v.currentLevel;
        }
      }
    } else {
      v.degradedSeconds = 0;

      // 6. Condições de subida (recuperação) com histerese e sondagem (probing)
      const isClean = v.ewmaLoss <= 0.4 && v.ewmaJitter <= (this.jitterThresholdMs * 0.45) &&
        (!v.ewmaBandwidthKbps || v.ewmaBandwidthKbps >= v.effectiveBitrateKbps * 1.25);

      if (isClean && canChange) {
        v.stableSeconds++;

        if (v.stableSeconds >= this.upgradeStabilitySeconds) {
          // Se estava com sub-passo de bitrate reduzido (65% ou 80%), sobe o bitrate primeiro (ordem inversa)
          if (this.enableBitrateSteps && v.currentBitrateStep > 0) {
            const prevStep = v.currentBitrateStep - 1;
            this.setBitrateStep(viewerId, prevStep, `Rede estável por ${this.upgradeStabilitySeconds}s — Recuperando bitrate para ${Math.round(BITRATE_STEPS[prevStep] * 100)}%`);
            v.stableSeconds = 0;
            return v.currentLevel;
          }

          // Se o bitrate já está em 100%, sobe 1 degrau na escada (FPS ou resolução)
          const higher = this.getNextHigherLevel(v.currentLevel);
          if (higher !== v.currentLevel) {
            this.setLevel(viewerId, higher, `Rede estável por ${this.upgradeStabilitySeconds}s — Promovendo para ${higher}`, 0);
            v.stableSeconds = 0;
            return v.currentLevel;
          }
        }
      } else {
        v.stableSeconds = 0;
      }
    }

    return v.currentLevel;
  }

  getGlobalEffectiveLevel() {
    if (this.viewers.size === 0) return this.defaultLevel;

    let lowestIdx = 0;
    for (const v of this.viewers.values()) {
      const idx = this.order.indexOf(v.currentLevel);
      if (idx > lowestIdx) {
        lowestIdx = idx;
      }
    }
    return this.order[lowestIdx] || this.defaultLevel;
  }

  getGlobalEffectiveBitrateKbps() {
    if (this.viewers.size === 0) {
      return this.calculateEffectiveBitrate(this.defaultLevel, 0);
    }
    let minBitrate = Infinity;
    for (const v of this.viewers.values()) {
      if (v.effectiveBitrateKbps < minBitrate) {
        minBitrate = v.effectiveBitrateKbps;
      }
    }
    return minBitrate === Infinity ? 10000 : minBitrate;
  }

  getDiagnosticsTable() {
    const rows = [];
    for (const [viewerId, v] of this.viewers.entries()) {
      const cfg = this.ladder[v.currentLevel] || {};
      const rep = v.lastReport || {};
      const width = cfg.width || 1920;
      const height = cfg.height || 1080;
      rows.push({
        viewerId,
        mode: 'Worker GPU (AMD AMF)',
        codec: rep.codec || 'H.264',
        level: v.currentLevel,
        label: cfg.label || v.currentLevel,
        capturedResolution: `${width}x${height}`,
        encodedResolution: `${width}x${height}`,
        receivedResolution: rep.receivedResolution || `${width}x${height}`,
        bitrateKbps: v.effectiveBitrateKbps || cfg.bitrateKbps || 10000,
        bitrateStep: `${Math.round((BITRATE_STEPS[v.currentBitrateStep] || 1.0) * 100)}%`,
        fps: rep.fps || cfg.fps || 60,
        lossPercent: typeof rep.lossPercent === 'number' ? rep.lossPercent.toFixed(1) : (rep.packetsLost ? `${rep.packetsLost}` : '0.0%'),
        ewmaLoss: v.ewmaLoss.toFixed(1) + '%',
        jitterMs: rep.jitterMs ? Math.round(rep.jitterMs) : 0,
        ewmaJitterMs: Math.round(v.ewmaJitter),
        lastReason: v.lastReason || 'Normal',
        gpuEncodeStatus: 'medido'
      });
    }
    return rows;
  }
}
