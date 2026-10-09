# Plano de Implementação — HyperStream (Melhorias e Otimizações)

Este plano abrange todas as implementações solicitadas pelo usuário, estruturadas em 6 etapas incrementais para implementação e validação passo a passo.

---

## 📋 Resumo dos Requisitos

1. **Áudio da Câmera Desativado por Padrão**:
   - Evitar áudio duplicado e captura indesejada do microfone da webcam.
   - `getUserMedia` não deve requisitar áudio da câmera por padrão.
   - Opção configurável nas configurações para quem desejar ativar manualmente.

2. **Remoção da Opção de Teatro**:
   - Remover o botão e o modo "Teatro", pois já é redundante com o recolhimento do painel lateral/chat.
   - Manter os layouts "Mosaico" (Grid) e "Palco" (Stage).

3. **Slider de Volume por Transmissão**:
   - Adicionar controle de volume deslizante individual para cada card de transmissão ativa.
   - Permitir ajustar o volume (0% a 100%) e mutar/desmutar com restauração do volume prévio.

4. **Tela Cheia com Ocultação Automática (Auto-Hide)**:
   - Quando em tela cheia, ocultar nome da transmissão, botão de fechar, volume e botões de controle.
   - Torná-los visíveis imediatamente quando o usuário mover o mouse, clicar ou tocar na tela.
   - Fading suave de ocultação após 2,5 segundos de inatividade, ocultando também o cursor.

5. **Envio de Imagens Efêmeras no Chat**:
   - Permitir enviar imagens no chat através de botão de upload, Ctrl+V (colar da área de transferência) ou arrastar e soltar.
   - Compressão/otimização client-side com Canvas antes do envio para máxima velocidade.
   - Transmissão direta e em memória via WebSocket, sem gravar em disco ou banco de dados.
   - Exclusão total ao encerrar a sessão/sala ou recarregar a página.
   - Visualização ampliada das imagens (lightbox/modal).

6. **Acesso e Visualização Prioritária pelo Celular (Mobile-Friendly)**:
   - Exibir no terminal os endereços IP da rede local (Wi-Fi) para acesso direto pelo celular.
   - Suporte estrito a reprodução inline no iOS/Android (`playsinline`, `webkit-playsinline`).
   - Layout responsivo no CSS priorizando 100% a área de reprodução do vídeo.
   - Sidebar como gaveta/drawer deslizante no celular sem espremer a transmissão.
   - Controles touch-friendly adaptados para dedos e telas sensíveis ao toque.

---

## 🛠️ Status das Etapas

- [x] **Etapa 1**: Câmera sem captura de microfone por padrão + Configuração opcional.
- [x] **Etapa 2**: Remoção do Modo Teatro do HTML, JS e CSS.
- [x] **Etapa 3**: Slider de volume individual e controle de mute em cada transmissão.
- [x] **Etapa 4**: Auto-hide de cabeçalho e controles em tela cheia por inatividade.
- [x] **Etapa 5**: Envio de imagens no chat (efêmeras em memória via WebSocket + lightbox).
- [x] **Etapa 6**: Responsividade e priorização mobile completa (reprodução, touch e IP local).
- [x] **Etapa 7**: Verificação e testes integrados finais.
