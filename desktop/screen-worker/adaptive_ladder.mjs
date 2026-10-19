/**
 * Controle de Qualidade Adaptativa para Screen Worker Nativo (Escada L0–L3)
 * Documentação da Tarefa: FASE 2
 *
 * Escada:
 * - L0: 1080p60 10 Mbps (10.000 kbps)
 * - L1: 720p60 5 Mbps (5.000 kbps)
 * - L2: 720p30 3 Mbps (3.000 kbps)
 * - L3: 480p30 1,5 Mbps (1.500 kbps)
 */

export const QUALITY_LADDER = {
  L0: { id: 'L0', label: '1080p60', width: 1920, height: 1080, fps: 60, bitrateKbps: 10000 },
  L1: { id: 'L1', label: '720p60', width: 1280, height: 720, fps: 60, bitrateKbps: 5000 },
  L2: { id: 'L2', label: '720p30', width: 1280, height: 720, fps: 30, bitrateKbps: 3000 },
  L3: { id: 'L3', label: '480p30', width: 854, height: 480, fps: 30, bitrateKbps: 1500 }
};

export const LADDER_ORDER = ['L0', 'L1', 'L2', 'L3'];

export class AdaptiveLadder {
  constructor(options = {}) {
    this.ladder = options.customLadder || QUALITY_LADDER;
    this.viewers = new Map(); // Map<viewerId, ViewerState>
    this.onLevelChange = options.onLevelChange || null; // callback(viewerId, newLevel, reason)
    this.upgradeStabilitySeconds = options.upgradeStabilitySeconds || 15;
    this.bandwidthLowSeconds = options.bandwidthLowSeconds || 3;
    this.lossThresholdPercent = options.lossThresholdPercent || 2.0;
    this.jitterThresholdMs = options.jitterThresholdMs || 50;
  }

  initViewer(viewerId) {
    if (this.viewers.has(viewerId)) return this.viewers.get(viewerId);

    const initial = {
      viewerId,
      currentLevel: 'L0',
      lastReason: 'Inicialização (Focado)',
      stableSeconds: 0,
      bandwidthLowCount: 0,
      lastChangeTimestamp: Date.now(),
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

  setLevel(viewerId, newLevel, reason) {
    const v = this.initViewer(viewerId);
    if (!this.ladder[newLevel]) return false;
    if (v.currentLevel === newLevel) {
      v.lastReason = reason;
      return false;
    }

    const oldLevel = v.currentLevel;
    v.currentLevel = newLevel;
    v.lastReason = reason;
    v.stableSeconds = 0;
    v.bandwidthLowCount = 0;
    v.lastChangeTimestamp = Date.now();

    v.history.push({
      timestamp: Date.now(),
      from: oldLevel,
      to: newLevel,
      reason
    });
    if (v.history.length > 20) v.history.shift();

    if (typeof this.onLevelChange === 'function') {
      try {
        this.onLevelChange(viewerId, newLevel, reason, oldLevel);
      } catch (_) {}
    }
    return true;
  }

  getNextLowerLevel(level) {
    const idx = LADDER_ORDER.indexOf(level);
    if (idx >= 0 && idx < LADDER_ORDER.length - 1) {
      return LADDER_ORDER[idx + 1];
    }
    return level;
  }

  getNextHigherLevel(level) {
    const idx = LADDER_ORDER.indexOf(level);
    if (idx > 0) {
      return LADDER_ORDER[idx - 1];
    }
    return level;
  }

  /**
   * Processa o relatório QUALITY_REPORT de 1 segundo enviado pelo espectador
   * @param {string} viewerId 
   * @param {object} report - { packetsLost, totalPackets, jitterMs, framesDropped, decodeTimeMs, isFocused, state, estimatedBps }
   */
  processReport(viewerId, report = {}) {
    const v = this.initViewer(viewerId);
    v.lastReport = report;

    const isFocused = report.isFocused !== false;
    const state = report.state || (isFocused ? 'active' : 'background');
    const currentCfg = this.ladder[v.currentLevel];

    // 1. Estado Inativo / Minimizada
    if (state === 'inactive') {
      if (v.currentLevel !== 'L3') {
        this.setLevel(viewerId, 'L3', 'Espectador inativo (pausando tráfego intensivo)');
      }
      return v.currentLevel;
    }

    // 2. Segundo Plano (aba oculta) -> Trava em L2
    if (state === 'background' || !isFocused) {
      if (v.currentLevel !== 'L2' && v.currentLevel !== 'L3') {
        this.setLevel(viewerId, 'L2', 'Aba em segundo plano (redução para L2 720p30)');
      }
      return v.currentLevel;
    }

    // 3. Estado Ativo / Focado -> Avaliação adaptativa
    let lossPercent = 0;
    if (typeof report.lossPercent === 'number') {
      lossPercent = report.lossPercent;
    } else if (report.totalPackets > 0 && typeof report.packetsLost === 'number') {
      lossPercent = (report.packetsLost / report.totalPackets) * 100;
    }

    const jitterMs = report.jitterMs || (report.jitter ? report.jitter * 1000 : 0);
    const estimatedKbps = report.estimatedBps ? Math.round(report.estimatedBps / 1000) : null;

    // Checagem de condições de descida
    let triggerDropReason = null;
    if (lossPercent > this.lossThresholdPercent) {
      triggerDropReason = `Perda de pacotes elevada (${lossPercent.toFixed(1)}% > ${this.lossThresholdPercent}%)`;
    } else if (jitterMs > this.jitterThresholdMs) {
      triggerDropReason = `Jitter de rede instável (${Math.round(jitterMs)}ms > ${this.jitterThresholdMs}ms)`;
    } else if (estimatedKbps && estimatedKbps < currentCfg.bitrateKbps) {
      v.bandwidthLowCount++;
      if (v.bandwidthLowCount >= this.bandwidthLowSeconds) {
        triggerDropReason = `Banda estimada insuficiente (${estimatedKbps} kbps < ${currentCfg.bitrateKbps} kbps por 3s)`;
      }
    } else {
      v.bandwidthLowCount = 0;
    }

    if (triggerDropReason) {
      const lower = this.getNextLowerLevel(v.currentLevel);
      if (lower !== v.currentLevel) {
        this.setLevel(viewerId, lower, triggerDropReason);
        return v.currentLevel;
      }
    }

    // Checagem de condições de subida: 15s estáveis com histerese
    const isStable = lossPercent <= 0.5 && jitterMs <= (this.jitterThresholdMs / 2) && (!estimatedKbps || estimatedKbps >= currentCfg.bitrateKbps * 1.2);
    if (isStable) {
      v.stableSeconds++;
      if (v.stableSeconds >= this.upgradeStabilitySeconds) {
        const higher = this.getNextHigherLevel(v.currentLevel);
        if (higher !== v.currentLevel) {
          this.setLevel(viewerId, higher, `15s estáveis sem perda e banda suficiente`);
          return v.currentLevel;
        }
      }
    } else {
      v.stableSeconds = 0;
    }

    return v.currentLevel;
  }

  /**
   * Retorna o menor nível entre todos os espectadores ativos (estratégia lowest-common-denominator para encoder único)
   */
  getGlobalEffectiveLevel() {
    if (this.viewers.size === 0) return 'L0';

    let lowestIdx = 0;
    for (const v of this.viewers.values()) {
      const idx = LADDER_ORDER.indexOf(v.currentLevel);
      if (idx > lowestIdx) {
        lowestIdx = idx;
      }
    }
    return LADDER_ORDER[lowestIdx] || 'L0';
  }

  getGlobalEffectiveBitrateKbps() {
    const level = this.getGlobalEffectiveLevel();
    return this.ladder[level]?.bitrateKbps || 10000;
  }

  /**
   * Gera relatório diagnóstico estruturado por espectador
   */
  getDiagnosticsTable() {
    const rows = [];
    for (const [viewerId, v] of this.viewers.entries()) {
      const cfg = this.ladder[v.currentLevel] || {};
      const rep = v.lastReport || {};
      rows.push({
        viewerId,
        mode: 'Worker GPU (AMD AMF)',
        level: v.currentLevel,
        label: cfg.label || '1080p60',
        bitrateKbps: cfg.bitrateKbps || 10000,
        fps: cfg.fps || 60,
        lossPercent: typeof rep.lossPercent === 'number' ? rep.lossPercent.toFixed(1) : (rep.packetsLost ? `${rep.packetsLost}` : '0.0%'),
        jitterMs: rep.jitterMs ? Math.round(rep.jitterMs) : 0,
        lastReason: v.lastReason || 'Normal',
        gpuEncodeStatus: 'medido'
      });
    }
    return rows;
  }
}
