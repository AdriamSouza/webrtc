# Backend de Sinalização WebRTC P2P

Servidor de sinalização e orquestração leve desenvolvido em Node.js com WebSockets nativos, em conformidade com as especificações arquiteturais da plataforma de transmissão de tela P2P a 60 FPS.

## Filosofia
- **Zero-Media Relay:** Este servidor NUNCA recebe nem retransmite tráfego de áudio ou vídeo. Ele atua unicamente na coordenação das salas e na troca de metadados SDP e ICE entre os pares.
- **Gerenciamento em Memória:** Estrutura `Map` de alta performance sem necessidade inicial de banco de dados.

## Como Executar

### 1. Instalar dependências
```bash
npm install
```

### 2. Iniciar servidor em desenvolvimento
```bash
npm run dev
```

### 3. Iniciar servidor em produção
```bash
npm start
```

O servidor estará disponível por padrão em `http://localhost:3000` (e o WebSocket em `ws://localhost:3000/ws`).
Ao abrir o link no navegador, a aplicação frontend já será servida automaticamente.
