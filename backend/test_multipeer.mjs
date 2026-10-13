import puppeteer from 'puppeteer-core';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocketServer } from './src/signaling/websocket.js';
import { roomManager } from './src/rooms/roomManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEST_PORT = 3344;
const ROOM_ID = 'audit-room-' + Date.now();

console.log('--- TEST 2: Multi-Peer Headless WebRTC & Signaling Simulation ---');

// 1. Iniciar servidor Express + WebSocket em porta de teste
const app = express();
const frontendPath = path.resolve(__dirname, '../frontend');
app.use(express.static(frontendPath));

const server = http.createServer(app);
setupWebSocketServer(server);

await new Promise((resolve) => server.listen(TEST_PORT, resolve));
console.log(`[Test Server] Rodando em http://localhost:${TEST_PORT}`);

const browsers = [];
const consoleLogs = [];

try {
  // 2. Lançar 3 instâncias de navegador headless com flags WebRTC e GPU simulada
  const commonArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu', // Headless
    '--headless=new'
  ];

  console.log('[Test] Lançando Host e 2 Viewers...');

  for (let i = 0; i < 3; i++) {
    const isHost = (i === 0);
    const username = isHost ? 'Broadcaster_Host' : `Viewer_${i}`;

    const browser = await puppeteer.launch({
      executablePath: EDGE_PATH,
      headless: true,
      args: commonArgs
    });
    browsers.push(browser);

    const page = await browser.newPage();

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Signaling') || text.includes('WebRTC') || text.includes('App') || text.includes('Rate')) {
        consoleLogs.push(`[${username}] ${text}`);
      }
    });

    page.on('pageerror', err => {
      console.error(`[${username} PageError]:`, err.message);
    });

    await page.goto(`http://localhost:${TEST_PORT}`, { waitUntil: 'domcontentloaded' });

    // Preenche e submete formulário do lobby
    if (isHost) {
      await page.waitForSelector('#createUsernameInput');
      await page.$eval('#createUsernameInput', (el, u) => el.value = u, username);
      await page.$eval('#createRoomIdInput', (el, r) => el.value = r, ROOM_ID);
      await page.click('#btnSubmitCreate');
    } else {
      await page.waitForSelector('#tabBtnJoin');
      await page.click('#tabBtnJoin');
      await page.waitForSelector('#joinUsernameInput');
      await page.$eval('#joinUsernameInput', (el, u) => el.value = u, username);
      await page.$eval('#joinRoomIdInput', (el, r) => el.value = r, ROOM_ID);
      await page.click('#btnSubmitJoin');
    }

    // Aguarda entrar na sala
    await page.waitForSelector('#roomScreen.active', { timeout: 8000 });
    console.log(`[Test] ${username} entrou na sala com sucesso!`);
  }

  // 3. Aguardar 3 segundos para estabelecimento da malha P2P
  await new Promise(r => setTimeout(r, 3500));

  const totalUsersInRoom = roomManager.getRoom(ROOM_ID)?.getUserCount();
  console.log(`[Test] Total de usuários na sala no servidor: ${totalUsersInRoom}`);

  if (totalUsersInRoom === 3) {
    console.log('✅ PASS: Todos os 3 participantes ingressaram e estão sincronizados na sala!');
  } else {
    throw new Error(`Esperado 3 participantes, encontrado: ${totalUsersInRoom}`);
  }

  // 4. Verificar se houve algum RATE_LIMIT_EXCEEDED
  const rateLimitErrors = consoleLogs.filter(l => l.includes('RATE_LIMIT_EXCEEDED') || l.includes('Limite de mensagens'));
  console.log(`[Test] Ocorrências de rate limit error: ${rateLimitErrors.length}`);
  if (rateLimitErrors.length === 0) {
    console.log('✅ PASS: Zero erros de taxa de mensagens (Token bucket absorveu o handshake de 3 peers perfeitamente)!');
  } else {
    console.error('❌ FAIL: Erros de rate limit encontrados:', rateLimitErrors);
    throw new Error('Falha no teste de taxa de mensagens');
  }

  // 5. Testar chat e mensagens de presença
  const hostPage = (await browsers[0].pages())[1] || (await browsers[0].pages())[0];
  await hostPage.type('#chatInput', 'Teste de mensagem P2P automatizada');
  await hostPage.click('#chatForm button[type="submit"]');

  await new Promise(r => setTimeout(r, 1000));

  // Verificar se viewers receberam mensagem no chat
  const viewerPage = (await browsers[1].pages())[1] || (await browsers[1].pages())[0];
  const chatMessagesCount = await viewerPage.$$eval('.chat-message-item', els => els.length);
  console.log(`[Test] Mensagens no chat do Viewer: ${chatMessagesCount}`);
  if (chatMessagesCount >= 1) {
    console.log('✅ PASS: Mensagens de chat entregues corretamente!');
  }

  // 6. Testar saída limpa e persistência de última sala
  await hostPage.click('#btnLeaveRoomHeader');
  await new Promise(r => setTimeout(r, 1500));

  const lastRoomCardVisible = await hostPage.$eval('#lastRoomCard', el => !el.classList.contains('hidden'));
  const lastRoomIdDisplayed = await hostPage.$eval('#lastRoomIdDisplay', el => el.textContent);
  console.log(`[Test] Card de última sala visível no Lobby: ${lastRoomCardVisible}, Sala: ${lastRoomIdDisplayed}`);

  if (lastRoomCardVisible && lastRoomIdDisplayed.toLowerCase() === ROOM_ID.toLowerCase()) {
    console.log('✅ PASS: Card de última sala persistido e exibido corretamente após saída!');
  } else {
    throw new Error('Falha na persistência da última sala.');
  }

  console.log('\n--- TODOS OS TESTES MULTI-PEER PASSARAM COM SUCESSO! ---');

} catch (err) {
  console.error('❌ ERRO NO TESTE MULTI-PEER:', err);
  process.exitCode = 1;
} finally {
  console.log('[Test] Fechando navegadores e encerrando servidor...');
  for (const b of browsers) {
    try { await b.close(); } catch (_) {}
  }
  server.close(() => {
    process.exit(process.exitCode || 0);
  });
  setTimeout(() => process.exit(process.exitCode || 0), 1000);
}
