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

9. **Correção de Imagens no Chat & Prevenção de Congelamento em Background** *(v1.1.8)*:
   - Captura global de imagens coladas via Ctrl+V e arquivos copiados diretamente do Windows Explorer.
   - Compressão Canvas com suporte limpo a transparência WebP e envio assíncrono sincronizado.
   - Preservação de estado WebRTC ao silenciar/desmutar tracks em background sem remoção destrutiva de tiles.
   - Watchdog e recuperação de reprodução instantânea ao restaurar a janela em primeiro plano (`visibilitychange` / `window.focus`).
   - Reconexão resiliente com auto-rejoin de sala e ICE Restart completo conforme RFC 8829.
   - Flags Chromium contra congelamento de janelas ocluídas no desktop.

10. **Layout Unificado de Chamada Estilo Discord & Transmissões na Tela Principal** *(v1.2.0)*:
    - **Remoção da aba lateral de transmissões**: As transmissões foram migradas da sidebar para a área principal da sala onde ficam os controles de câmera e compartilhamento de tela.
    - **Call Grid de Participantes**: Todos os participantes conectados à sala aparecem como cards no grid principal, mesmo que não estejam transmitindo vídeo ou tela (exibindo iniciais, nome, badges de Host/Você e status de microfone).
    - **Paleta de Cores Aleatórias e Consistentes**: Atribuição automática de cores vibrantes e modernas (estilo Discord) para cada participante.
    - **Miniaturas de Live Interativas ("Assistir Transmissão")**: Quando alguém transmite tela ou câmera, seu card ganha o badge "AO VIVO" pulsante e um botão em destaque convidando para assistir a transmissão com 1 clique sob demanda via WebRTC.
    - **Reintrodução e Otimização dos Modos Palco e Teatro**:
      - **Mosaico (Grid)**: Distribuição harmoniosa de todos os participantes e streams ativas lado a lado.
      - **Palco (Stage)**: Transmissão em foco ampliada no centro e os outros participantes organizados em uma tira inferior (filmstrip).
      - **Teatro (Theater)**: Visual imersivo sem bordas no formato cinema.
      - **Tela Cheia (Fullscreen)**: Tela cheia com auto-hide de controles e cursor após 2.5s.
    - **Tira de Participantes Ocultável**: Botão ("Ocultar Participantes" / "Mostrar Participantes") que permite ocultar as miniaturas dos participantes para a transmissão ocupar 100% da tela sem nenhuma distração.

---

## 🛠️ Status das Etapas de Implementação

- [x] **Etapa 1**: Câmera sem microfone por padrão + Configuração opcional.
- [x] **Etapa 2**: Simplificação inicial de Layouts.
- [x] **Etapa 3**: Slider de volume individual e controle de mute em cada transmissão.
- [x] **Etapa 4**: Auto-hide de cabeçalho e controles em tela cheia por inatividade.
- [x] **Etapa 5**: Envio de imagens efêmeras no chat com privacidade total.
- [x] **Etapa 6**: Responsividade e priorização mobile completa (touch, drawer e IPs locais).
- [x] **Etapa 7**: Correção do fluxo de saída de sala e botão no cabeçalho (v1.1.6).
- [x] **Etapa 8**: Rotação automática de tela cheia vertical no celular e renderização correta de nomes de apps no mixer (v1.1.7).
- [x] **Etapa 9**: Correção de imagens no chat (Ctrl+V/anexo) e prevenção de congelamento em background (v1.1.8).
- [x] **Etapa 10**: Empacotamento do release executável desktop e sincronização no Git.
- [x] **Etapa 11**: Interface inspirada no Discord: Call Grid com participantes, cards interativos de Live ("Assistir Transmissão"), modos Palco e Teatro com tira de participantes ocultável e cores automáticas (v1.2.0).

---

## 🚀 Próximas Atualizações Planejadas (Backlog)

1. **Fotos de Perfil / Avatares Customizados**:
   - Permitir aos participantes fazer upload ou selecionar fotos de perfil / avatares customizados.
2. **Extração Automática da Cor Dominante da Imagem**:
   - Analisar a foto de perfil via Canvas para extrair a paleta de cores dominante do ícone/foto.
   - Aplicar dinamicamente a cor da foto como a cor de destaque da miniatura e do card do participante (substituindo a cor aleatória padrão).
3. **Alternância de Posição da Tira de Participantes**:
   - Opção para o usuário escolher entre exibir a tira de participantes embaixo (horizontal) ou ao lado (vertical) nos modos Palco e Teatro.
