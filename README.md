# ⚡ HyperStream

> Plataforma de Transmissão P2P de Alta Performance a 60 FPS via WebRTC Mesh com Aceleração por Hardware (Windows Graphics Capture - WGC) e Suporte Híbrido Web & Desktop.

---

## 🚀 Visão Geral

O **HyperStream** é uma solução de transmissão ponto a ponto (Peer-to-Peer) de ultrabaixa latência projetada especificamente para streamers, gamers e chamadas interativas de alta fidelidade:

- **60 FPS Nativos e Estáveis:** Pipeline otimizado para captura e envio de jogos e telas em alta taxa de quadros.
- **Arquitetura 100% P2P Mesh (Zero Media Relay):** O servidor de sinalização atua exclusivamente na orquestração inicial (SDP/ICE) e chat via WebSocket. O tráfego de vídeo e áudio trafega diretamente entre os participantes criptografado via SRTP/DTLS.
- **Multi-Stream Simultâneo:** Transmissão de Tela (60 FPS) e Câmera (Webcam) de forma independente e simultânea por usuário.
- **Otimização de Hardware (Windows Graphics Capture):** No aplicativo Desktop, utiliza o framework WGC e DXGI Zero-Copy para capturar jogos DirectX 11/12 e Vulkan em tela cheia exclusiva sem tela preta e sem impacto de CPU.
- **Interface e Layouts Unificados:** Paridade visual total entre Web e Desktop com alternância dinâmica de layouts.

---

## 🎨 Modos de Layout

O HyperStream possui um sistema adaptativo de layouts com persistência local:

| Layout | Modo | Descrição |
| :---: | :--- | :--- |
| 🔲 | **Mosaico (Grid)** | Distribui todas as transmissões ativas em uma grade adaptativa equilibrada (1x1, 1x2, 2x2, 3x2). |
| 🎭 | **Palco (Stage / Spotlight)** | Transmissão principal (jogo ou tela) em tamanho expandido central, com miniaturas secundárias alinhadas em régua inferior para troca rápida com um clique. |
| 🎬 | **Modo Teatro (Cinema)** | Expande a área visual do vídeo para 100% da tela, recolhendo o painel lateral de chat/participantes para imersão total. |
| 💬 | **Toggle Sidebar** | Permite abrir e fechar o chat e lista de participantes com transição fluida a qualquer momento. |

---

## 🛠️ Tecnologias Utilizadas

### Frontend & Desktop
- **WebRTC API:** Unified Plan com múltiplos senders/receivers simultâneos.
- **Electron:** Empacotamento desktop nativo com flags Chromium de aceleração gráfica por GPU e WGC.
- **HTML5 / CSS3 Moderno:** CSS Grid de 2 níveis, Glassmorphism, responsividade e modo escuro nativo.
- **JavaScript (ES Modules):** Arquitetura modular sem dependência de frameworks pesados.

### Backend & Sinalização
- **Node.js & Express:** Servidor HTTP/HTTPS e entrega de assets estáticos.
- **WebSocket (`ws`):** Troca de mensagens de sinalização em tempo real (SDP offers/answers, ICE candidates, chat e controle de salas).
- **SSL/TLS Seguro:** Suporte nativo a HTTPS e WSS.

---

## 📦 Como Executar

### Pré-requisitos
- [Node.js](https://nodejs.org/) v18 ou superior instalado.

### 1. Clonar o Repositório
```bash
git clone https://github.com/SEU_USUARIO/hyperstream.git
cd hyperstream
```

### 2. Instalar Dependências
```bash
# Dependências do servidor de sinalização
npm --prefix backend install

# Dependências do cliente Desktop
npm --prefix desktop install
```

### 3. Iniciar o Servidor de Sinalização
```bash
npm run backend
```
*O servidor estará acessível em `https://localhost:3000`.*

### 4. Iniciar o Cliente Desktop Nativo (WGC 60 FPS)
Em outro terminal:
```bash
npm run desktop
```

### 5. Acesso via Web (Navegador)
Basta abrir o navegador e acessar:
```text
https://localhost:3000
```

---

## 🔒 Segurança e Salas

- **PIN / Senha Opcional:** Salas podem ser criadas como públicas ou protegidas por senha/PIN de 4 a 20 dígitos.
- **Proteção de Host:** Prevenção de usurpação de liderança da sala através de tokens criptográficos gerados na criação.
- **Prevenção de Túnel de Espelho:** Prévia local compacta e discreta (Self-View flutuante com minimização).

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
