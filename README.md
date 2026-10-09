# ⚡ HyperStream

> Plataforma de Transmissão P2P de Alta Performance a 60 FPS via WebRTC Mesh, com Aceleração por Hardware (Windows Graphics Capture - WGC), Mixer Seletivo de Áudio, Suporte Mobile Completo e Privacidade Absoluta (Zero Armazenamento de Dados).

[![Versão](https://img.shields.io/badge/versão-v1.1.7-blue.svg)](https://github.com/AdriamSouza/webrtc/releases)
[![Licença](https://img.shields.io/badge/licença-MIT-green.svg)](LICENSE)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P%20Mesh-orange.svg)](https://webrtc.org/)
[![60 FPS](https://img.shields.io/badge/taxa%20de%20quadros-60%20FPS-purple.svg)]()
[![Mobile Friendly](https://img.shields.io/badge/mobile-Android%20%7C%20iOS-brightgreen.svg)]()
[![Privacidade](https://img.shields.io/badge/privacidade-100%25%20Zero%20Storage-red.svg)]()

---

## 🚀 Visão Geral

O **HyperStream** é uma solução de transmissão ponto a ponto (Peer-to-Peer) de ultrabaixa latência projetada especificamente para streamers, gamers, amigos e equipes que buscam máxima fidelidade audiovisual com total privacidade e sem dependência de plataformas proprietárias:

- **🎮 60 FPS Nativos e Estáveis:** Pipeline otimizado para captura e envio de jogos rápidos e telas em alta taxa de quadros e baixa latência.
- **🛡️ Privacidade Absoluta (Zero Dados Armazenados):** Nenhuma mensagem de chat, áudio, vídeo ou imagem enviada é gravada em disco ou banco de dados no servidor. Todo o tráfego de mídia é direto P2P criptografado (SRTP/DTLS).
- **📱 Suporte Mobile Completo (Celulares e Tablets):** Acesse diretamente pelo navegador do smartphone (Android e iOS Safari) sem precisar baixar aplicativo. Possui layout responsivo touch-friendly e rotação inteligente em tela cheia na vertical.
- **🎚️ Mixer de Áudio do Windows com Isolamento Seletivo (Desktop):** No aplicativo Desktop, detecta em tempo real os programas com som ativo no Windows (jogos, navegadores, reprodutores) e permite escolher exatamente quais aplicativos transmitir e quais mutar (ex: transmite o som do jogo sem vazar o Discord, Spotify ou notificações).
- **⚡ Aceleração por Hardware (Windows Graphics Capture):** No app Desktop, captura jogos DirectX 11/12 e Vulkan em tela cheia exclusiva sem tela preta e com impacto mínimo de CPU.
- **🔊 Controle Individual de Volume:** Cada transmissão recebida possui seu próprio controle deslizante de volume (0 a 100%) em tempo real diretamente no card de vídeo.
- **🖥️ Tela Cheia Imersiva (Auto-Hide):** Oculta controles, botões e identificadores após 2,5 segundos de inatividade para uma visualização cinematográfica limpa.
- **🖼️ Imagens Efêmeras no Chat:** Envie capturas de tela e imagens no chat via botão de anexo, Ctrl+V (colar da área de transferência) ou arrastar e soltar. As imagens são comprimidas localmente no Canvas, transmitidas apenas em memória e destruídas ao sair da sala.

---

## 🛡️ Privacidade e Arquitetura de Rede

O HyperStream foi construído sob a premissa de **Zero-Knowledge** e **Privacidade por Design**:

1. **Sem Banco de Dados:** Não há MongoDB, PostgreSQL, SQLite ou qualquer armazenamento persistente. O servidor atua estritamente como sinalizador em tempo real (via WebSocket em memória).
2. **Criptografia P2P de Ponta a Ponta:** Áudio e vídeo não passam pelo servidor em situações normais de rede — eles trafegam diretamente entre os navegadores criptografados ponta a ponta com **SRTP (Secure Real-time Transport Protocol)** e chaves negociadas via **DTLS**.
3. **Imagens Efêmeras e Temporárias:** Todas as imagens compartilhadas no chat são mantidas exclusivamente na memória RAM da sessão do navegador e descartadas permanentemente assim que a sala é encerrada ou a página é recarregada.
4. **Sem Rastreamento ou Contas:** Nenhum cadastro de e-mail, senha, número de telefone ou identificação pessoal é exigido. As salas podem ser protegidas com PIN de segurança opcional.

---

## 📱 Experiência no Celular (Mobile-Friendly)

O HyperStream oferece paridade de recursos em dispositivos móveis diretamente pelo navegador web:

- **Acesso Instantâneo:** Abra o link da sala no Chrome, Safari, Samsung Internet ou Firefox do celular.
- **Reprodução Inline Nativa:** Totalmente otimizado para iOS Safari e Android com suporte a `playsinline` (sem bloqueio de tela cheia forçada).
- **Gaveta Lateral de Chat (Drawer):** O chat e a lista de participantes deslizam suavemente sobre a tela como gaveta, garantindo que o vídeo principal nunca seja espremido ou cortado.
- **🔄 Rotação Automática em Tela Cheia no Modo Vertical:** Ao colocar uma transmissão horizontal em tela cheia segurando o smartphone em pé (retrato), o vídeo se expande automaticamente em 90 graus ocupando 100% da tela do aparelho (`100dvh` por `100vw`) sem barras pretas gigantes. Ao virar o aparelho para a horizontal, ele se adapta dinamicamente.
- **Controles Touch-Friendly:** Botões aumentados (44px+) e espaçamento pensado para toques na tela.

---

## 🎨 Modos de Layout

O HyperStream possui um sistema adaptativo de layouts com persistência local:

| Layout | Modo | Descrição |
| :---: | :--- | :--- |
| 🔲 | **Mosaico (Grid)** | Distribui todas as transmissões ativas em uma grade adaptativa equilibrada (1x1, 1x2, 2x2, 3x2). |
| 🎭 | **Palco (Stage / Spotlight)** | Transmissão principal (jogo ou tela) em tamanho expandido central, com miniaturas secundárias alinhadas em régua inferior para troca rápida com um clique. |
| 💬 | **Gaveta Lateral (Sidebar Toggle)** | Permite abrir e fechar o chat e a lista de participantes a qualquer momento com transição fluida, expandindo o vídeo para largura total. |

---

## 🎚️ Mixer de Áudio e Captura Nativa (Desktop Windows)

No cliente Desktop, o HyperStream integra-se diretamente ao **WASAPI (Windows Audio Session API)**:

- **Loopback Limpo a 48 kHz:** Áudio estéreo de alta definição capturado diretamente do subsistema de áudio do sistema.
- **Seleção Individual de Aplicativos:** O painel de configurações lista todos os programas com som ativo no Windows. Você pode ativar o modo **Selecionar Apps** e desmarcar programas específicos (ex: não transmitir chamadas do Discord, músicas do Spotify ou conversas de outros navegadores).
- **Sem Necessidade de Cabos Virtuais:** Todo o isolamento é feito de forma transparente por PID de processo em nível de driver de áudio nativo.
- **VU Meters em Tempo Real:** Medidores de volume visual responsivos para monitorar o áudio do sistema e do microfone em tempo real.

---

## 🛠️ Tecnologias Utilizadas

### Frontend & Interface
- **WebRTC API:** Unified Plan com múltiplos senders/receivers simultâneos para telas e webcams.
- **HTML5 & CSS3 Moderno:** CSS Grid dinâmico, Glassmorphism, responsividade móvel e tema escuro de alto contraste.
- **JavaScript Moderno (ES Modules):** Código limpo, modular e de altíssimo desempenho sem sobrecarga de frameworks externos.

### Cliente Desktop (Windows)
- **Electron:** Empacotamento nativo de baixa latência com flags Chromium para aceleração de GPU DXGI/D3D11.
- **Windows Graphics Capture (WGC):** Captura de vídeo a 60 FPS com DXGI Zero-Copy.
- **C# / WASAPI Helper:** Utilitário nativo de consulta e isolamento de sessões de áudio do Windows Mixer com codificação UTF-8 pura.

### Backend & Sinalização
- **Node.js & Express:** Servidor HTTP/HTTPS ultraleve para distribuição estática e orquestração.
- **WebSocket (`ws`):** Troca de mensagens de sinalização em tempo real (SDP offers/answers, ICE candidates e controle de salas).
- **SSL/TLS Seguro:** Suporte nativo a HTTPS e WSS.

---

## 📦 Como Executar Localmente

### Pré-requisitos
- [Node.js](https://nodejs.org/) v18 ou superior instalado.
- [Git](https://git-scm.com/) instalado.

### 1. Clonar o Repositório
```bash
git clone https://github.com/AdriamSouza/webrtc.git
cd webrtc
```

### 2. Instalar Dependências
```bash
# Servidor de sinalização e backend
npm --prefix backend install

# Cliente Desktop
npm --prefix desktop install
```

### 3. Iniciar o Servidor
```bash
npm run backend
```
O servidor estará disponível em `http://localhost:3000` (e nos endereços IP locais exibidos no terminal para acesso via Wi-Fi no celular).

### 4. Iniciar o Cliente Desktop (WGC 60 FPS)
Em outro terminal:
```bash
npm run desktop
```

---

## 🌍 Acesso pela Internet e Servidor Público

### 1. Servidor Público Oficial na Nuvem
O servidor oficial já está publicado 24/7 na nuvem no Render:
- **Web / Celular:** [https://hyperstream-g9gz.onrender.com](https://hyperstream-g9gz.onrender.com)

No App Desktop, ele já conecta automaticamente a essa URL na nuvem, ou você pode definir:
```powershell
$env:APP_URL="https://hyperstream-g9gz.onrender.com"; npm run desktop
```

### 2. Túnel Gratuito com Cloudflare Tunnel (HTTPS)
Para rodar seu servidor local e compartilhar com amigos pela internet com HTTPS oficial (necessário para liberar 60 FPS e câmera):
```bash
npm run tunnel
```

### 3. Servidor TURN para Redes Móveis (4G/5G) e CGNAT
Algumas operadoras utilizam CGNAT simétrico, exigindo retransmissão ICE. Para configurar um servidor TURN gratuito:
1. Copie o arquivo de exemplo:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Crie uma conta gratuita em [Metered.ca OpenRelay](https://www.metered.ca/tools/openrelay/) (50 GB/mês grátis de TURN).
3. Preencha `TURN_URLS`, `TURN_USERNAME` e `TURN_PASSWORD` no `backend/.env`.

---

## 📊 Telemetria (HUD) e Perfis de Transmissão

O HyperStream inclui um painel de diagnóstico em tempo real (botão **Telemetria (HUD)**):
- **FPS Real e Resolução:** Monitoramento contínuo da taxa de quadros e tamanho da transmissão.
- **Tipo de Conexão:** Diagnóstico automático do transporte ICE:
  - 🟢 **Direto LAN:** Computadores na mesma rede local.
  - 🌐 **P2P Direto (STUN):** Conexão direta entre amigos pela internet via UDP (menor latência).
  - 🔄 **Relay (TURN):** Tráfego retransmitido com segurança quando há bloqueio de firewall/CGNAT.
- **Perfis de Transmissão Ajustáveis:**
  - ⚡ **Ultra 60:** 1080p60 até 8 Mbps (para rede local ou conexões de fibra de alta velocidade).
  - ⚖️ **Equilibrado:** 60 FPS até 3.5 Mbps (ideal para transmissões de jogos pela internet).
  - 🍃 **Econômico:** 30 FPS até 1.8 Mbps (ideal para conexões instáveis ou dados móveis).

---

## 📥 Download do App Desktop (Windows)

Você pode baixar os executáveis pré-compilados do aplicativo Desktop diretamente na aba de **[Releases do GitHub](https://github.com/AdriamSouza/webrtc/releases)**.

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
