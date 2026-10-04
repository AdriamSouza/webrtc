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
http://localhost:3000
```

---

## 🌍 Testando com Amigos Fora da Rede Local (Internet)

Para testar com amigos pela internet sem precisar abrir portas no roteador e com **HTTPS oficial** (obrigatório pelos navegadores para liberar captura de tela a 60 FPS e webcam):

### 1. Criar o Túnel HTTPS com Cloudflare Tunnel (100% Gratuito)
Em um terminal separado:
```bash
# Se ainda não instalou o cloudflared: winget install Cloudflare.cloudflared
npm run tunnel
```
O Cloudflare Tunnel gerará uma URL pública segura (ex: `https://seu-subdominio.trycloudflare.com`).
Envie essa URL para seus amigos. Eles não precisam instalar nada!

### 2. Deploy na Nuvem no Render (24/7 Gratuito)
Para hospedar o servidor permanentemente no [Render.com](https://render.com):
1. Crie uma conta gratuita no Render e conecte este repositório do GitHub.
2. Crie um novo **Web Service**.
3. Defina as seguintes configurações (ou use o arquivo `render.yaml` já incluído):
   - **Environment / Runtime:** `Node`
   - **Build Command:** `npm --prefix backend install`
   - **Start Command:** `npm run backend`
4. O servidor oficial já está no ar em: **https://hyperstream-g9gz.onrender.com**
5. No App Desktop, ele já conecta automaticamente a essa URL na nuvem, ou você pode definir:
   ```bash
   $env:APP_URL="https://hyperstream-g9gz.onrender.com"; npm run desktop
   ```

### 3. Configurar Servidor TURN Gratuito (Para CGNAT e Redes 4G/5G)
Algumas redes móveis ou operadoras residenciais usam CGNAT / NAT Simétrico, bloqueando o P2P UDP direto. Para garantir 100% de conexões de vídeo:
1. Copie o arquivo de exemplo:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Crie uma conta gratuita em [Metered.ca OpenRelay](https://www.metered.ca/tools/openrelay/) (50 GB/mês grátis de TURN).
3. Preencha `TURN_URLS`, `TURN_USERNAME` e `TURN_PASSWORD` no `backend/.env`. O servidor carregará automaticamente na inicialização.

---

## 📊 Telemetria (HUD) e Perfis de Transmissão

O HyperStream inclui um painel de diagnóstico em tempo real (botão **Telemetria (HUD)**):
- **FPS Real e Resolução:** Monitoramento contínuo da taxa de quadros e tamanho do canvas.
- **Tipo de Conexão:** Diagnóstico automático do transporte ICE:
  - 🟢 **Direto LAN:** Computadores na mesma rede local.
  - 🌐 **P2P Direto (STUN):** Conexão direta entre amigos pela internet via UDP (menor latência).
  - 🔄 **Relay (TURN):** Tráfego retransmitido com segurança quando há bloqueio de firewall/CGNAT.
- **Perfis de Transmissão Ajustáveis:**
  - ⚡ **Ultra 60:** 1080p60 até 8 Mbps (para rede local ou conexões de fibra de alta velocidade).
  - ⚖️ **Equilibrado:** 60 FPS até 3.5 Mbps (ideal para transmissões de jogos pela internet).
  - 🍃 **Econômico:** 30 FPS até 1.8 Mbps (ideal para conexões instáveis ou dados móveis).

---

## 🔒 Segurança e Salas

- **PIN / Senha Opcional:** Salas podem ser criadas como públicas ou protegidas por senha/PIN de 4 a 20 dígitos.
- **Proteção de Host:** Prevenção de usurpação de liderança da sala através de tokens criptográficos gerados na criação.
- **Prevenção de Túnel de Espelho:** Prévia local compacta e discreta (Self-View flutuante com minimização).

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
