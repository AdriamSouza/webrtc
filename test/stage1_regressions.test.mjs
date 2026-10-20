import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../backend/src/rooms/room.js';
import { WebRTCManager } from '../frontend/js/webrtc.js';

test('Etapa 1 — Regressão: Validação e consumo de tokens de uso único no Room', async (t) => {
  await t.test('1. Token é consumido e deletado imediatamente na primeira validação', () => {
    const room = new Room('TEST-ROOM-1', 'host-1');
    const token = room.createWorkerToken('host-1');
    assert.equal(typeof token, 'string');
    assert.ok(token.startsWith('wt_'));

    // Primeira validação deve ter sucesso
    const valid = room.validateAndConsumeWorkerToken('host-1', token);
    assert.equal(valid, true, 'Primeira validação deve retornar true');

    // Segunda validação com o mesmo token deve falhar (single-use garantido)
    const secondValid = room.validateAndConsumeWorkerToken('host-1', token);
    assert.equal(secondValid, false, 'Segunda validação com token já consumido deve retornar false');

    // Token foi deletado da memória (sem vazamento de memória)
    assert.equal(room.workerTokens.has(token), false, 'Token consumido deve ser removido do Map');
  });

  await t.test('2. Token expirado (>60s) é purgado e rejeitado', () => {
    const room = new Room('TEST-ROOM-2', 'host-1');
    const token = room.createWorkerToken('host-1');

    // Simula expiração alterando createdAt para 65 segundos atrás
    const entry = room.workerTokens.get(token);
    entry.createdAt = Date.now() - 65000;

    const valid = room.validateAndConsumeWorkerToken('host-1', token);
    assert.equal(valid, false, 'Token expirado deve ser rejeitado');
    assert.equal(room.workerTokens.has(token), false, 'Token expirado deve ser purgado');
  });

  await t.test('3. Substituição limpa de worker para o mesmo hostId em addWorker', () => {
    const room = new Room('TEST-ROOM-3', 'host-1');
    const mockUser1 = { id: 'worker-1', send: () => {} };
    const mockUser2 = { id: 'worker-2', send: () => {} };

    room.addWorker(mockUser1, 'host-1');
    assert.equal(room.workers.size, 1);
    assert.ok(room.workers.has('worker-1'));

    // Host reinicia transmissão gerando novo worker
    room.addWorker(mockUser2, 'host-1');
    assert.equal(room.workers.size, 1, 'Deve manter apenas o worker mais recente ativo para o host');
    assert.ok(room.workers.has('worker-2'));
    assert.equal(room.workers.has('worker-1'), false, 'Worker anterior deve ter sido removido');
  });
});

test('Etapa 1 — Regressão: Limpeza de workerPeers em closeAllPeers do WebRTCManager', () => {
  const webrtc = new WebRTCManager({
    userId: 'user-local',
    signaling: { send: () => {}, sendIceCandidate: () => {} }
  });

  // Registra um worker peer
  webrtc.registerWorkerPeer('screen-worker-123', 'host-456');
  assert.equal(webrtc.workerPeers.size, 1);
  assert.ok(webrtc.workerPeers.has('screen-worker-123'));

  // Executa encerramento de todas as conexões
  webrtc.closeAllPeers();
  assert.equal(webrtc.workerPeers.size, 0, 'workerPeers deve estar completamente vazio após closeAllPeers()');
});

test('Etapa 1 — Regressão: Link de convite público quando executando no Desktop com localhost', () => {
  function computeInviteUrl(desktopServerUrl, windowOrigin, roomId, pin = null) {
    let baseUrl = windowOrigin;
    if (desktopServerUrl && (desktopServerUrl.startsWith('http://') || desktopServerUrl.startsWith('https://'))) {
      baseUrl = desktopServerUrl.replace(/\/$/, '');
    }
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
      baseUrl = 'https://hyperstream-g9gz.onrender.com';
    }
    let inviteUrl = `${baseUrl}/?room=${encodeURIComponent(roomId)}`;
    if (pin) inviteUrl += `&pin=${encodeURIComponent(pin)}`;
    return inviteUrl;
  }

  // 1. Desktop conectado ao backend local em desenvolvimento
  const linkLocal = computeInviteUrl('http://localhost:3000', 'http://127.0.0.1:38385', 'minha-sala');
  assert.equal(linkLocal, 'https://hyperstream-g9gz.onrender.com/?room=minha-sala', 'Deve gerar link utilizável por terceiros na nuvem');

  // 2. Desktop conectado ao servidor de produção
  const linkProd = computeInviteUrl('https://meu-dominio.com', 'http://127.0.0.1:38385', 'sala-teste', '1234');
  assert.equal(linkProd, 'https://meu-dominio.com/?room=sala-teste&pin=1234', 'Deve preservar URL pública customizada quando configurada');
});
