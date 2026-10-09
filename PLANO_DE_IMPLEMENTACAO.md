# Plano de Implementação & Histórico de Otimizações — HyperStream

Este documento consolida o histórico completo de melhorias, refatorações e otimizações arquiteturais implementadas no HyperStream.

---

## 📋 Resumo das Funcionalidades e Melhorias

1. **Áudio da Câmera Desativado por Padrão**:
   - Evita áudio duplicado e captura indesejada do microfone da webcam.
   - `getUserMedia` requisita estritamente vídeo por padrão; o microfone é acionado apenas quando explicitamente solicitado.
   - Opção configurável nas configurações para ativar áudio da câmera manualmente se desejado.

2. **Remoção da Opção de Teatro (Simplificação de Layouts)**:
   - Removido o botão e o modo redundante "Teatro" do HTML, JS e CSS.
   - Mantidos os layouts de alta performance "Mosaico" (Grid) e "Palco" (Stage / Spotlight), com alternância dinâmica da barra lateral (Drawer de chat/participantes).

3. **Slider de Volume Individual por Transmissão**:
   - Cada card de transmissão possui seu próprio controle de volume deslizante (0% a 100%) em tempo real.
   - Permite equalizar volumes individuais de participantes e mutar/desmutar com restauração instantânea do volume anterior.

4. **Tela Cheia Imersiva com Ocultação Automática (Auto-Hide)**:
   - Em tela cheia, o cabeçalho, nome da transmissão, botões de ação e cursor do mouse são ocultados automaticamente após 2,5 segundos de inatividade.
   - Reaparecem suavemente ao mover o mouse, clicar ou tocar na tela.

5. **Imagens Efêmeras no Chat com Privacidade Absoluta**:
   - Envio de imagens via botão de anexo, Ctrl+V (colar direto da área de transferência) ou arrastar e soltar.
   - Compressão local via Canvas antes do envio.
   - Transmissão exclusivamente em memória via WebSocket — **nenhuma imagem é gravada em disco ou banco de dados**.
   - Destruição total das imagens da memória ao encerrar a sessão, sair da sala ou recarregar a página.
   - Lightbox modal com zoom e botão de fechamento acessível.

6. **Experiência e Visualização Mobile de Primeira Classe**:
   - Funciona direto no navegador do smartphone (Android Chrome, iOS Safari) sem instalação de aplicativo.
   - Exibição dos endereços IP locais da rede Wi-Fi no terminal ao iniciar o servidor para facilitar o pareamento com o celular.
   - Suporte estrito a reprodução inline no iOS/Android (`playsinline`, `webkit-playsinline`).
   - Gaveta lateral (Drawer) sobreposta com animação suave que não espreme nem reduz a área do vídeo.
   - Botões touch-friendly (44px+) e prevenção de zoom acidental no iOS (`font-size: 16px`).

7. **Rotação Automática Inteligente de Tela Cheia no Celular (Modo Retrato)** *(v1.1.7)*:
   - Em telas cheias no celular, detecta se o aparelho está sendo segurado na vertical (retrato).
   - Trava a orientação para paisagem via API nativa ou gira o vídeo automaticamente em 90 graus (`100dvh` por `100vw`), permitindo que a transmissão ocupe 100% da tela do celular sem barras pretas gigantes.
   - Reversão automática ao girar o aparelho para a horizontal ou ao sair do modo tela cheia.

8. **Mixer de Áudio do Windows e Correção de Renderização** *(v1.1.7)*:
   - Captura loopback estéreo nativa via WASAPI.
   - Isolamento seletivo de aplicativos por PID (permite transmitir o jogo sem vazar Discord, Spotify ou navegadores).
   - Correção de quebra de linha e elipse CSS (`display: block`, `flex: 1`, `min-width: 0`), eliminando o corte de caracteres no nome e descrição dos apps.
   - Codificação de saída do utilitário C# (`AudioSessionHelper.cs`) em UTF-8 estrito com escape JSON `\uXXXX` para caracteres acentuados.

---

## 🛠️ Status das Etapas de Implementação

- [x] **Etapa 1**: Câmera sem microfone por padrão + Configuração opcional.
- [x] **Etapa 2**: Remoção do Modo Teatro do HTML, JS e CSS.
- [x] **Etapa 3**: Slider de volume individual e controle de mute em cada transmissão.
- [x] **Etapa 4**: Auto-hide de cabeçalho e controles em tela cheia por inatividade.
- [x] **Etapa 5**: Envio de imagens efêmeras no chat com privacidade total.
- [x] **Etapa 6**: Responsividade e priorização mobile completa (touch, drawer e IPs locais).
- [x] **Etapa 7**: Correção do fluxo de saída de sala e botão no cabeçalho (v1.1.6).
- [x] **Etapa 8**: Rotação automática de tela cheia vertical no celular e renderização correta de nomes de apps no mixer (v1.1.7).
- [x] **Etapa 9**: Atualização da documentação do GitHub e empacotamento do release executável.
