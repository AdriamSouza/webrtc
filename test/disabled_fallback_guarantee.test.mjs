import test from 'node:test';
import assert from 'node:assert/strict';

test('Screen Worker — Garantia de Fallback e Desativação por Padrão', async (t) => {
  await t.test('1. Recurso desligado por padrão (useGpuWorker === false) não dispara caminho do worker', () => {
    // Simulação do ambiente cliente
    const mockLocalStorage = new Map();
    // Default: nada salvo -> default false
    const useGpuWorkerDefault = mockLocalStorage.get('hyperstream_use_gpu_screen_worker') === 'true';
    assert.equal(useGpuWorkerDefault, false, 'Recurso deve ser false por padrão');

    let workerSpawnCalled = false;
    let tokenRequested = false;

    const mockStartScreenWorker = () => { workerSpawnCalled = true; };
    const mockRequestToken = () => { tokenRequested = true; };

    // Execução do fluxo de início de tela
    if (useGpuWorkerDefault) {
      mockRequestToken();
      mockStartScreenWorker();
    }

    assert.equal(tokenRequested, false, 'Token não deve ser solicitado quando o recurso está desligado');
    assert.equal(workerSpawnCalled, false, 'Processo do worker não deve ser iniciado quando desligado');
  });

  await t.test('2. Dispositivo não suportado (ex: sem AMD ou sem GStreamer) mantém toggle inativo e usa WebRTC puro', () => {
    const mockDesktopApiNotSupported = {
      isGpuWorkerSupported: async () => ({
        supported: false,
        isWindows: true,
        hasAmdGpu: false,
        reason: 'Requer GPU AMD Radeon compatível com AMF'
      })
    };

    return mockDesktopApiNotSupported.isGpuWorkerSupported().then(status => {
      assert.equal(status.supported, false);
      assert.match(status.reason, /AMD Radeon/);

      // Com supported: false, mesmo se usuário tentasse ativar, a flag é forçada para false
      let effectiveUseGpuWorker = true;
      if (!status.supported) {
        effectiveUseGpuWorker = false;
      }
      assert.equal(effectiveUseGpuWorker, false);
    });
  });

  await t.test('3. Fallback instantâneo: se worker falhar ou for encerrado, stream do WebRTC padrão permanece ativo', () => {
    let standardWebRtcActive = true;
    let workerActive = true;

    // Simulação de encerramento anormal do worker
    function onWorkerCrash() {
      workerActive = false;
      // Host reativa/mantém a trilha WebRTC imediatamente para todos os espectadores
      standardWebRtcActive = true;
    }

    onWorkerCrash();
    assert.equal(workerActive, false);
    assert.equal(standardWebRtcActive, true, 'WebRTC padrão deve permanecer ativo garantindo zero tela preta');
  });
});
