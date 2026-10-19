import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupWebSocketServer } from '../backend/src/signaling/websocket.js';
import { config } from '../backend/src/config/config.js';
import { MessageTypes } from '../backend/src/signaling/messages.js';
import WebSocket from '../backend/node_modules/ws/index.js';

const TEST_PORT = 3389;

function createWsClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, type, timeoutMs = 2000) {
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

test('WebSocket Keepalive & Heartbeat — Resiliência contra queda 1006', async (t) => {
  // Configura heartbeat rápido (150ms) para execução célere do teste
  const originalInterval = config.websocket?.heartbeatIntervalMs;
  config.websocket = config.websocket || {};
  config.websocket.heartbeatIntervalMs = 150;

  const server = http.createServer();
  const wss = setupWebSocketServer(server);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  t.after(async () => {
    config.websocket.heartbeatIntervalMs = originalInterval || 30000;
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('1. Cliente ativo enviando application PING permanece conectado através de múltiplos ciclos de heartbeat', async () => {
    const ws = await createWsClient(TEST_PORT);

    let closed = false;
    let closeCode = null;
    ws.on('close', (code) => {
      closed = true;
      closeCode = code;
    });

    // Desativa respostas automáticas a opcode 0x9 ping para simular comportamento atrás de reverse proxy
    ws.pong = () => {};

    // Envia PING a cada 100ms (antes do segundo tick de 150ms) por 600ms (4 ciclos de heartbeat)
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MessageTypes.PING }));
      }
    }, 100);

    // Aguarda pelo menos 4 ciclos de heartbeat
    await new Promise((resolve) => setTimeout(resolve, 550));
    clearInterval(pingInterval);

    assert.equal(closed, false, 'Cliente ativo não deve ser desconectado');
    assert.equal(ws.readyState, WebSocket.OPEN, 'Socket deve permanecer OPEN');

    ws.close();
  });

  await t.test('2. Cliente inativo (sem respostas ou pings) é encerrado pelo heartbeat após expirar', async () => {
    const ws = await createWsClient(TEST_PORT);

    // Suprime resposta a opcode 0x9 ping (como uma conexão morta ou travada)
    ws.pong = () => {};

    const closePromise = new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
    });

    // O servidor deve detectar inatividade e chamar ws.terminate() em ~300ms (2 ticks de 150ms)
    const code = await Promise.race([
      closePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout aguardando desconexão por inatividade')), 1000))
    ]);

    assert.equal(code, 1006, 'Socket inativo deve ser encerrado abruptamente (1006)');
  });
});
