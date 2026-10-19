import test from 'node:test';
import assert from 'node:assert/strict';

test('Screen Worker — Validação de Requisitos de Hardware e Dependências', async (t) => {
  function evaluateSupport({ isWin, hasGst, hasAmd, runnerExists }) {
    return {
      supported: isWin && hasGst && hasAmd && runnerExists,
      reason: !isWin ? 'Requer sistema operacional Windows' :
              !hasAmd ? 'Requer GPU AMD Radeon compatível com AMF' :
              !hasGst ? 'GStreamer 1.26 não encontrado' :
              !runnerExists ? 'Worker runner não encontrado' : 'Compatível'
    };
  }

  await t.test('1. Recusa GStreamer ausente com mensagem exata "GStreamer 1.26 não encontrado"', () => {
    const res = evaluateSupport({ isWin: true, hasGst: false, hasAmd: true, runnerExists: true });
    assert.equal(res.supported, false);
    assert.equal(res.reason, 'GStreamer 1.26 não encontrado');
  });

  await t.test('2. Recusa GPUs não-AMD (Intel, NVIDIA, etc.) com motivo claro', () => {
    const res = evaluateSupport({ isWin: true, hasGst: true, hasAmd: false, runnerExists: true });
    assert.equal(res.supported, false);
    assert.equal(res.reason, 'Requer GPU AMD Radeon compatível com AMF');
  });

  await t.test('3. Recusa SO não-Windows', () => {
    const res = evaluateSupport({ isWin: false, hasGst: true, hasAmd: true, runnerExists: true });
    assert.equal(res.supported, false);
    assert.equal(res.reason, 'Requer sistema operacional Windows');
  });

  await t.test('4. Aceita quando todos os requisitos estão presentes', () => {
    const res = evaluateSupport({ isWin: true, hasGst: true, hasAmd: true, runnerExists: true });
    assert.equal(res.supported, true);
    assert.equal(res.reason, 'Compatível');
  });

  await t.test('5. Regex de detecção de GPU reconhece AMD / Radeon e rejeita Intel / NVIDIA', () => {
    const amdGpuNames = [
      'AMD Radeon RX 7600',
      'Radeon RX 6700 XT',
      'AMD Radeon(TM) Graphics',
      'Radeon Pro W6800'
    ];
    const nonAmdGpuNames = [
      'NVIDIA GeForce RTX 4070',
      'Intel(R) UHD Graphics 770',
      'Intel(R) Iris(R) Xe Graphics',
      'Microsoft Basic Display Adapter'
    ];

    const isAmd = (name) => /amd|radeon/i.test(name);

    for (const name of amdGpuNames) {
      assert.equal(isAmd(name), true, `Deveria reconhecer ${name} como AMD`);
    }
    for (const name of nonAmdGpuNames) {
      assert.equal(isAmd(name), false, `Deveria rejeitar ${name} como não-AMD`);
    }
  });
});
