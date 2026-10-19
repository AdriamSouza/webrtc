import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupWebSocketServer } from '../backend/src/signaling/websocket.js';
import { roomManager } from '../backend/src/rooms/roomManager.js';
import { MessageTypes } from '../backend/src/signaling/messages.js';
import WebSocket from '../backend/node_modules/ws/index.js';

const TEST_PORT = 3388;

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
      reject(new Error(`Timeout esperando mensagem do tipo ${type}`));
    }, timeoutMs);

    function handler(raw) {
      try {
        const msg = JSON.parse(raw.toString());
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

test('Screen Worker — Integração de Sinalização no Backend', async (t) => {
  const server = http.createServer();
  const wss = setupWebSocketServer(server);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  const roomId = 'WORKER-TEST-ROOM-' + Date.now();
  let hostWs = null;
  let viewerWs = null;
  let workerWs = null;

  t.after(async () => {
    if (hostWs) hostWs.close();
    if (viewerWs) viewerWs.close();
    if (workerWs) workerWs.close();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('1. Host entra na sala e emite token de screen-worker', async () => {
    hostWs = await createWsClient(TEST_PORT);

    // Host entra na sala
    hostWs.send(JSON.stringify({
      type: MessageTypes.JOIN_ROOM,
      roomId,
      data: { username: 'HostUser', isHost: true }
    }));

    const joinedMsg = await waitForMessage(hostWs, MessageTypes.ROOM_JOINED);
    assert.equal(joinedMsg.data.isHost, true);
    const hostId = joinedMsg.data.userId;

    // Host solicita token para seu worker
    hostWs.send(JSON.stringify({
      type: MessageTypes.REQUEST_WORKER_TOKEN,
      roomId,
      data: {}
    }));

    const tokenMsg = await waitForMessage(hostWs, MessageTypes.WORKER_TOKEN_ISSUED);
    assert.equal(tokenMsg.data.hostId, hostId);
    assert.ok(tokenMsg.data.workerToken);
    assert.ok(tokenMsg.data.workerToken.startsWith('wt_'));

    // Viewer entra na sala
    viewerWs = await createWsClient(TEST_PORT);
    viewerWs.send(JSON.stringify({
      type: MessageTypes.JOIN_ROOM,
      roomId,
      data: { username: 'ViewerUser', isHost: false }
    }));
    await waitForMessage(viewerWs, MessageTypes.ROOM_JOINED);

    const room = roomManager.getRoom(roomId);
    assert.equal(room.getUserCount(), 2, 'A sala deve ter exatamente 2 usuários normais');
  });

  await t.test('2. Screen-worker autentica com sucesso sem inflar a contagem de usuários', async () => {
    const room = roomManager.getRoom(roomId);
    const hostId = room.hostId;
    const workerToken = room.createWorkerToken(hostId);

    // Configura listeners para WORKER_JOINED no viewer e no host
    const hostWorkerJoinedPromise = waitForMessage(hostWs, MessageTypes.WORKER_JOINED);
    const viewerWorkerJoinedPromise = waitForMessage(viewerWs, MessageTypes.WORKER_JOINED);

    workerWs = await createWsClient(TEST_PORT);
    workerWs.send(JSON.stringify({
      type: MessageTypes.JOIN_ROOM,
      roomId,
      data: {
        role: 'screen-worker',
        hostId,
        workerToken
      }
    }));

    const workerJoinedMsg = await waitForMessage(workerWs, MessageTypes.ROOM_JOINED);
    assert.equal(workerJoinedMsg.data.role, 'screen-worker');
    assert.equal(workerJoinedMsg.data.hostId, hostId);

    const hostNotif = await hostWorkerJoinedPromise;
    assert.equal(hostNotif.data.hostId, hostId);

    const viewerNotif = await viewerWorkerJoinedPromise;
    assert.equal(viewerNotif.data.hostId, hostId);

    // Validação estrita da regra de isolamento do worker
    assert.equal(room.getUserCount(), 2, 'Contagem de usuários NÃO deve incluir o worker');
    const userIds = room.getAllUsers().map(u => u.id);
    assert.ok(!userIds.includes(workerJoinedMsg.data.userId), 'getAllUsers NÃO deve conter o workerId');
  });

  await t.test('3. Roteamento P2P entre Viewer e Worker (OFFER, ANSWER, ICE, GPU_STREAM_READY)', async () => {
    const room = roomManager.getRoom(roomId);
    const hostId = room.hostId;
    const workerId = room.getWorkersByHost(hostId)[0].id;
    const viewerId = room.getAllUsers().find(u => u.id !== hostId).id;

    // Worker envia OFFER para o Viewer
    const viewerOfferPromise = waitForMessage(viewerWs, MessageTypes.OFFER);
    workerWs.send(JSON.stringify({
      type: MessageTypes.OFFER,
      roomId,
      to: viewerId,
      data: { sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n', type: 'offer' }
    }));

    const receivedOffer = await viewerOfferPromise;
    assert.equal(receivedOffer.from, workerId);
    assert.equal(receivedOffer.data.type, 'offer');

    // Viewer responde com ANSWER para o Worker
    const workerAnswerPromise = waitForMessage(workerWs, MessageTypes.ANSWER);
    viewerWs.send(JSON.stringify({
      type: MessageTypes.ANSWER,
      roomId,
      to: workerId,
      data: { sdp: 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n', type: 'answer' }
    }));

    const receivedAnswer = await workerAnswerPromise;
    assert.equal(receivedAnswer.from, viewerId);
    assert.equal(receivedAnswer.data.type, 'answer');

    // Viewer envia GPU_STREAM_READY
    const hostGpuReadyPromise = waitForMessage(hostWs, MessageTypes.GPU_STREAM_READY);
    viewerWs.send(JSON.stringify({
      type: MessageTypes.GPU_STREAM_READY,
      roomId,
      to: hostId,
      data: { workerId, resolution: '1080p', fps: 60 }
    }));

    const gpuReady = await hostGpuReadyPromise;
    assert.equal(gpuReady.from, viewerId);
    assert.equal(gpuReady.data.fps, 60);

    // Viewer envia QUALITY_REPORT para o Worker
    const workerReportPromise = waitForMessage(workerWs, MessageTypes.QUALITY_REPORT);
    viewerWs.send(JSON.stringify({
      type: MessageTypes.QUALITY_REPORT,
      roomId,
      to: workerId,
      data: { fpsDecoded: 60, framesDropped: 0, packetLoss: 0, jitterMs: 2, rttMs: 15 }
    }));

    const qualityReport = await workerReportPromise;
    assert.equal(qualityReport.from, viewerId);
    assert.equal(qualityReport.data.fpsDecoded, 60);
  });

  await t.test('4. Desconexão do Worker emite WORKER_LEFT e não quebra a sala', async () => {
    const hostWorkerLeftPromise = waitForMessage(hostWs, MessageTypes.WORKER_LEFT);
    const viewerWorkerLeftPromise = waitForMessage(viewerWs, MessageTypes.WORKER_LEFT);

    workerWs.close();

    const hostLeft = await hostWorkerLeftPromise;
    const viewerLeft = await viewerWorkerLeftPromise;
    assert.ok(hostLeft.data.workerId);
    assert.ok(viewerLeft.data.workerId);

    const room = roomManager.getRoom(roomId);
    assert.equal(room.getUserCount(), 2, 'Usuários continuam na sala normalmente');
  });
});
