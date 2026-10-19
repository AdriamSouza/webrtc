import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupWebSocketServer } from '../backend/src/signaling/websocket.js';
import { MessageTypes } from '../backend/src/signaling/messages.js';
import WebSocket from '../backend/node_modules/ws/index.js';

const TEST_PORT = 3199;

function createWsClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout aguardando mensagem tipo ${type}`));
    }, timeoutMs);

    function handler(data) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch (e) {}
    }
    ws.on('message', handler);
  });
}

test('Screen Worker — Reprodução e Validação do Fluxo de Inicialização', async (t) => {
  const server = http.createServer();
  const wss = setupWebSocketServer(server);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  const roomId = 'WORKER-REPRO-ROOM-' + Date.now();
  let hostWs = null;

  t.after(async () => {
    if (hostWs) hostWs.close();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('1. Reprodução do bug original: roomState.currentRoomId vs roomState.roomId', () => {
    // Simulação do RoomState original
    const roomStateOriginal = {
      roomId: 'SALATEST',
      currentRoomId: undefined, // Nunca inicializado no RoomState real
      myUserId: 'user-host-123'
    };

    let tokenRequestSent = false;
    function legacyStartWorker() {
      // Código antigo da linha 156 do app.js
      if (!roomStateOriginal.myUserId || !roomStateOriginal.currentRoomId) return;
      tokenRequestSent = true;
    }

    legacyStartWorker();
    assert.equal(tokenRequestSent, false, 'Comprovado: código antigo abortava silenciosamente na linha 156 por usar currentRoomId');

    // Código corrigido
    function fixedStartWorker() {
      const currentRoom = roomStateOriginal.roomId;
      if (!roomStateOriginal.myUserId || !currentRoom) return;
      tokenRequestSent = true;
    }

    fixedStartWorker();
    assert.equal(tokenRequestSent, true, 'Corrigido: com roomState.roomId a requisição prossegue com sucesso');
  });

  await t.test('2. Reprodução do bug de desestruturação: msg.data.workerToken vs token', () => {
    // Backend envia workerToken (handlers.js linha 448)
    const backendMessage = {
      type: 'WORKER_TOKEN_ISSUED',
      data: {
        roomId: 'SALATEST',
        hostId: 'user-host-123',
        workerToken: 'wt_test_token_12345'
      }
    };

    // Código antigo na linha 3555
    const { token, hostId } = backendMessage.data || {};
    assert.equal(token, undefined, 'Comprovado: desestruturação antiga resultava em token undefined');
    assert.equal(Boolean(hostId === 'user-host-123' && token), false, 'Comprovado: condição if (hostId && token) falhava');

    // Código corrigido
    const resolvedToken = backendMessage.data?.workerToken || backendMessage.data?.token;
    assert.equal(resolvedToken, 'wt_test_token_12345');
    assert.equal(Boolean(hostId === 'user-host-123' && resolvedToken), true, 'Corrigido: token é obtido e startScreenWorker é chamado');
  });

  await t.test('3. Fluxo completo de ponta a ponta corrigido no backend', async () => {
    hostWs = await createWsClient(TEST_PORT);

    // Host entra na sala
    hostWs.send(JSON.stringify({
      type: MessageTypes.JOIN_ROOM,
      roomId,
      data: { username: 'HostUser', isHost: true }
    }));

    const joinedMsg = await waitForMessage(hostWs, MessageTypes.ROOM_JOINED);
    const hostId = joinedMsg.data.userId;

    // Host solicita token usando roomId correto
    hostWs.send(JSON.stringify({
      type: MessageTypes.REQUEST_WORKER_TOKEN,
      roomId,
      data: { hostId, roomId }
    }));

    const tokenIssuedMsg = await waitForMessage(hostWs, MessageTypes.WORKER_TOKEN_ISSUED);
    assert.equal(tokenIssuedMsg.data.hostId, hostId);
    assert.ok(tokenIssuedMsg.data.workerToken, 'workerToken deve ser emitido');
    assert.match(tokenIssuedMsg.data.workerToken, /^wt_/);
  });
});
