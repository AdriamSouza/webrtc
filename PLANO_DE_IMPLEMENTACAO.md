# Plataforma de Transmissão WebRTC P2P (60 FPS) — Plano de Implementação

Documento mestre consolidado a partir de todos os 5 PDFs de arquitetura presentes no workspace:
1. `relatorio_arquitetura_sistema_webrtc_p2p.pdf`
2. `Arquitetura do Sistema webRTC.pdf`
3. `Arquitetura do Sistema.pdf`
4. `Documento de Arquitetura — Plataforma de Transmissão P2P (1).pdf`
5. `Documento de Arquitetura — Plataforma de Transmissão P2P.pdf`

---

## 1. Visão Geral e Princípios Fundamentais

1. **Backend Não Transporta Vídeo (P2P Puro na v1):** O servidor Node.js atua estritamente na sinalização WebSocket (controle de salas, troca de Offer/Answer/ICE e chat). O tráfego pesado de mídia é direto entre pares.
2. **Separação Rígida em 3 Canais:**
   - **Canal 1 (HTTP/HTTPS):** Entrega da aplicação e arquivos estáticos (HTML/CSS/JS).
   - **Canal 2 (WebSocket - WSS):** Sinalização e mensagens JSON estruturadas.
   - **Canal 3 (WebRTC - RTP/SRTP):** Transporte direto e criptografado de tela e áudio.
3. **Fluidez em 60 FPS:** Pipeline sincronizado de ponta a ponta (Captura 60 -> Encodificação HW 60 -> Rede com controle de congestionamento -> Decodificação HW 60 -> Display 60Hz+).
4. **Camada de Abstração de Encoders (EAL):** NVIDIA NVENC, AMD AMF, Intel QSV e CPU fallback.
5. **Codecs:** Negociação com preferência para AV1 e fallback universal para H.264.
6. **Quality Controller:** Monitoramento de RTT, perda de pacotes e FPS via `getStats()` para ajuste adaptativo de bitrate e resolução.
7. **Evolução Gradual:** Início rápido com Web/Navegador (`getDisplayMedia`) -> Evolução Desktop Windows nativa (Windows Graphics Capture / Desktop Duplication) -> Migração futura para SFU.

---

## 2. Estrutura Canônica do Projeto

```text
webrtc-platform/
├── backend/
│   ├── package.json
│   ├── README.md
│   └── src/
│       ├── server.js               # Entry point Express/HTTP + WebSocket Server
│       ├── config/
│       │   └── config.js           # Portas, STUN/TURN, limites (maxUsers, rate limits)
│       ├── signaling/
│       │   ├── websocket.js        # Ciclo de vida WS, conexões e heartbeats
│       │   ├── messages.js         # Validação de schema e gerador de JSON
│       │   └── handlers.js         # Handlers dos eventos (join, offer, answer, ice, etc.)
│       ├── rooms/
│       │   ├── room.js             # Entidade Room (id, host, viewers, status, metadata)
│       │   └── roomManager.js      # Map em memória das salas ativas
│       └── users/
│           └── user.js             # Entidade User (id, name, ws, roomId, role)
├── frontend/
│   ├── index.html                  # Interface unificada (Home de entrada + Sala)
│   ├── css/
│   │   └── style.css               # Estilo moderno, dark theme, responsivo
│   └── js/
│       ├── app.js                  # Inicialização e fluxo de UI
│       ├── room.js                 # Gerenciamento de estado da sala no cliente
│       ├── signaling.js            # Cliente WebSocket e dispatch de mensagens
│       ├── webrtc.js               # RTCPeerConnection, negotiation e ICE handling
│       ├── media.js                # getDisplayMedia, áudio, webcam e tracks
│       └── qualityController.js    # Monitor getStats() e ajuste adaptativo (Fase 5)
├── docker/
│   ├── docker-compose.yml          # coturn + backend + nginx
│   ├── coturn/turnserver.conf      # Configuração coturn
│   └── nginx/nginx.conf            # Reverse proxy TLS/HTTPS e WSS
├── desktop/                        # [Fases 6 & 7] Módulo nativo Windows Graphics Capture
└── PLANO_DE_IMPLEMENTACAO.md       # Este documento de rastreamento
```

---

## 3. Checklist de Implementação Passo a Passo (Fases 1 a 8)

### Fase 1: WebRTC Básico no Navegador (P2P Local)
- [x] Criar estrutura base do frontend (`index.html`, `style.css`, scripts)
- [x] Implementar captura de tela com `navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } }, audio: true })`
- [x] Configurar conexão WebRTC local em memória
- [x] Validar renderização no elemento `<video>` a 60 FPS com áudio
- *Status:* **Concluído e Validado**

### Fase 2: Servidor de Sinalização Node.js + WebSocket
- [x] Inicializar `backend/package.json` com `ws`, `express`, `uuid`
- [x] Implementar `backend/src/config/config.js`
- [x] Implementar `backend/src/rooms/room.js` e `backend/src/rooms/roomManager.js`
- [x] Implementar `backend/src/signaling/messages.js` com catálogo JSON padronizado
- [x] Implementar `backend/src/signaling/handlers.js` e `backend/src/signaling/websocket.js`
- [x] Conectar frontend ao WebSocket e realizar handshake WebRTC completo entre dois computadores
- *Status:* **Concluído e Validado**

### Fase 3: Infraestrutura de Rede, STUN/TURN e HTTPS
- [x] Configurar STUN público (Google STUN + Cloudflare)
- [x] Configurar `docker-compose.yml` e `coturn/turnserver.conf` para relay TURN
- [x] Configurar HTTPS nativo com certificados SSL para desbloquear `getDisplayMedia` em todos os computadores da rede
- [x] Suporte automático a WSS (WebSocket Seguro)
- *Status:* **Concluído e Ativo**

### Fase 4: Interface do Usuário Completa, Multi-Stream e Chat
- [x] Dashboard de entrada: criar sala ou entrar com link/código
- [x] View da Sala: player de vídeo principal, barra de controles (mute microfone, ligar/desligar tela, tela cheia, sair)
- [x] Painel lateral com lista de participantes (Host / Viewer)
- [x] Chat de texto distribuído via WebSocket (`CHAT_MESSAGE`)
- [x] Notificações visuais de entrada e saída de usuários (`USER_JOINED`, `USER_LEFT`)
- [x] Banner interativo de áudio com animação de pulso para contornar bloqueio de autoplay
- [x] Grid adaptativo multi-stream (câmeras + telas simultâneas) com modo Spotlight e tela cheia individual
- [x] Dock flutuante de Prévia Local (Self-View discreto estilo Discord/Meet) com opção de ocultar prévia ou fixar no grid, eliminando o efeito túnel de espelho
- [x] Mapeamento determinístico via MIDs do SDP (RFC 8829) e streamIds: Câmera e Tela transmitem e são identificadas de forma 100% independente, sem nunca duplicar ou confundir uma com a outra
- [x] Sincronização reativa contínua (`syncRemotePeerTiles`): abrir, fechar, alternar ou reabrir câmeras e telas é detectado dinamicamente em tempo real, sem necessidade de sair e entrar na sala
- *Status:* **Concluído e Validado**

### Fase 5: Sistema de Controle Adaptativo de Qualidade (Quality Controller)
- [x] Implementar `frontend/js/qualityController.js` consultando `peerConnection.getStats()` a cada 2s
- [x] Exibir overlay (HUD) de telemetria em tempo real (RTT, FPS real, Bitrate, Perda de pacotes, Codec)
- [x] Implementar ajuste dinâmico de taxa de envio via `RTCRtpSender.setParameters`
- [x] Degradação suave e recuperação de bitrate/FPS sob congestionamento de rede
- *Status:* **Concluído e Ativo**

### Fase 6: Aplicativo Desktop Nativo (Windows Graphics Capture)
- [ ] Módulo Desktop para captura acelerada via Windows Graphics Capture / Desktop Duplication
- [ ] Pipeline de textura direta na GPU (VRAM) sem cópia para a RAM
- *Status:* **Pendente**

### Fase 7: Aceleração por Hardware & Codecs Modernos
- [ ] Camada de Abstração de Encoders (NVENC, AMF, QSV e fallback CPU x264)
- [ ] Priorização de codec AV1 e fallback automático para H.264
- *Status:* **Pendente**

### Fase 8: Escalabilidade & Integração SFU (Futuro)
- [ ] Migração do modelo P2P Mesh para SFU (LiveKit, mediasoup ou Pion) para suporte a grandes audiências
- [ ] Banco de dados PostgreSQL para persistência de salas e histórico
- *Status:* **Pendente**
