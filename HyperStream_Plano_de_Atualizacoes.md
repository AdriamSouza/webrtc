# HyperStream --- Plano de próximas atualizações

> Documento de planejamento vivo. Edite, reorganize e marque os itens
> conforme as decisões e a implementação evoluírem.
>
> **Status:** rascunho de planejamento\
> **Projeto:** HyperStream --- transmissão de tela e áudio via WebRTC\
> **Repositório:** https://github.com/AdriamSouza/webrtc

## 1. Objetivo do projeto

Evoluir o HyperStream como uma plataforma de transmissão de tela e áudio
em tempo real, priorizando:

-   Baixa carga de processamento para quem transmite.
-   Reprodução fluida para quem assiste, com o mínimo possível de
    quadros perdidos.
-   Seleção explícita das transmissões que o espectador deseja receber.
-   Suporte a mais de uma transmissão simultânea, com gerenciamento
    adaptativo de recursos.
-   Privacidade: evitar armazenamento persistente de dados quando não
    for necessário.
-   Compatibilidade entre navegador, dispositivos móveis e aplicativo
    desktop.
-   Aproveitamento da arquitetura e dos componentes já existentes,
    evitando reescrever partes funcionais sem necessidade.

## 2. Diretrizes e decisões já definidas

### Catálogo de transmissões selecionáveis

-   [x] O escopo inicial do catálogo será **somente dentro da mesma
    sala**.
-   [x] A seleção de transmissões será **manual**: o usuário escolhe
    quais quer assistir.
-   [x] O limite de transmissões simultâneas **não será um número fixo
    codificado**.
-   [x] A quantidade de transmissões ativas deverá ser condicionada ao
    desempenho e aos recursos disponíveis.
-   [x] O tipo de fonte inicialmente considerado inclui `desktop`.
-   [x] Confirmar se o catálogo inicial deve listar somente desktops ou
    todas as fontes de mídia publicadas na sala (Definido: lista `desktop` e `camera`).
-   [x] Definir se a seleção manual permitirá ativar várias fontes de
    uma vez ou se a primeira versão será liberada progressivamente após
    validar uma fonte (Definido: seleção individual sob demanda no catálogo, com suporte a múltiplas transmissões ativas simultâneas).

### Princípios técnicos

-   [x] Reaproveitar o WebRTC e a sinalização existentes.
-   [x] Manter o catálogo efêmero/em memória no backend, sem adicionar
    banco de dados apenas para essa funcionalidade.
-   [x] Não criar conexões WebRTC para todas as fontes só porque
    aparecem no catálogo.
-   [x] Encerrar assinaturas e liberar recursos que deixarem de ser
    necessários.
-   [x] Preservar Grid, Stage, controles de volume, tela cheia, chat e
    demais funcionalidades existentes.
-   [x] Auditar o código antes de decidir como cada conexão será criada,
    reutilizada ou encerrada (Concluído: 1 RTCPeerConnection por par remoto com MIDs determinísticos).

## 3. Funcionalidades existentes a preservar

Conforme a documentação atual do projeto, o HyperStream já contempla
componentes e recursos como:

-   [x] Sinalização com Node.js, Express e WebSocket.
-   [x] Transmissão de mídia com WebRTC P2P.
-   [x] Compartilhamento de tela pelo navegador e pelo aplicativo
    desktop.
-   [x] Aplicativo desktop com captura de tela no Windows por Windows
    Graphics Capture (WGC), conforme a implementação atual.
-   [x] Captura/seleção de áudio de aplicativos no Windows por meio do
    helper e do mixer existentes.
-   [x] Controles de volume individuais por transmissão.
-   [x] Layouts Grid/Mosaic e Stage/Spotlight.
-   [x] Interface responsiva e suporte a navegadores móveis.
-   [x] Chat com imagens efêmeras, sem persistência.
-   [x] Tela cheia imersiva com controles que se ocultam
    automaticamente.
-   [x] HUD de telemetria para dados como FPS, resolução e tipo de
    conexão.
-   [x] Perfis de transmissão existentes, como Ultra, Balanced e
    Economy.
-   [x] Filosofia de privacidade e ausência de armazenamento persistente
    por padrão.

> Antes de alterar qualquer um desses componentes, conferir o código e
> os testes atuais. Esta lista é um inventário de referência baseado na
> documentação do projeto, não uma auditoria do estado atual de cada
> função.

## 4. Atualização prioritária: catálogo e seleção de transmissões

### 4.1 Comportamento esperado

1.  Um participante inicia uma transmissão.
2.  O backend registra temporariamente a fonte na sala.
3.  O catálogo dos participantes da sala é atualizado.
4.  O espectador escolhe manualmente uma ou mais fontes.
5.  O gerenciador de assinaturas solicita e coordena a recepção das
    fontes selecionadas.
6.  A interface mostra o estado de conexão e, quando disponível,
    reproduz a mídia.
7.  Ao cancelar a seleção, a assinatura é encerrada e os recursos
    desnecessários são liberados.
8.  Quando uma transmissão termina ou seu publicador sai, o catálogo e
    as assinaturas relacionadas são atualizados.

### 4.2 Modelo de transmissão proposto

Os nomes e campos abaixo são uma proposta inicial e devem ser adaptados
às convenções reais do código:

``` js
{
  streamId: "identificador-unico",
  roomId: "identificador-da-sala",
  hostId: "identificador-do-publicador",
  sourceType: "desktop",
  title: "Área de trabalho",
  status: "live",
  publishedAt: 0
}
```

Regras:

-   `streamId` deve ser único; não usar apenas `desktop`, pois vários
    participantes podem publicar o mesmo tipo de fonte.
-   O backend deve determinar ou validar `roomId`, `hostId`, status e
    horário.
-   O catálogo deve incluir somente fontes da sala atual.
-   Não persistir o catálogo em disco por padrão.
-   Uma fonte listada não deve ser considerada automaticamente
    conectada.

### 4.3 Estados de assinatura

Ciclo de vida sugerido:

`idle → subscribing → active → unsubscribing → idle`

Estado adicional de falha:

`failed`

A interface deve diferenciar, pelo menos:

-   Disponível.
-   Conectando.
-   Em reprodução.
-   Encerrando assinatura.
-   Falha/reconexão.
-   Transmissão encerrada.

### 4.4 Mensagens de sinalização a avaliar

Os nomes abaixo são sugestões. Reutilizar mensagens existentes quando já
houver equivalente.

  -----------------------------------------------------------------------
  Mensagem                            Responsabilidade
  ----------------------------------- -----------------------------------
  `LIST_STREAMS`                      Solicitar o catálogo atual da sala.

  `STREAM_LIST`                       Receber a lista inicial de fontes.

  `STREAM_PUBLISHED`                  Anunciar uma fonte nova.

  `STREAM_ENDED`                      Informar que uma fonte foi
                                      encerrada.

  `SUBSCRIBE_STREAM`                  Solicitar assinatura de uma fonte.

  `UNSUBSCRIBE_STREAM`                Cancelar uma assinatura.

  `SUBSCRIPTION_STATUS`               Informar aceitação, recusa, falha
                                      ou mudança de estado.
  -----------------------------------------------------------------------

As mensagens WebRTC já existentes, como `OFFER`, `ANSWER` e
`ICE_CANDIDATE`, devem continuar sendo usadas para a negociação da
conexão.

### 4.5 Regras do backend

-   [x] Validar que o participante está na sala correta.
-   [x] Validar que o `streamId` existe e pertence à sala atual.
-   [x] Impedir que uma mensagem manipulada acesse fontes de outra sala.
-   [x] Evitar inscrições duplicadas.
-   [x] Atualizar o catálogo quando uma fonte começar ou terminar.
-   [x] Remover fontes quando o publicador desconectar ou sair da sala.
-   [x] Limpar inscrições e referências que se tornarem inválidas.
-   [x] Tratar mensagens repetidas e eventos fora de ordem sem corromper
    o estado.

## 5. Gerenciador de assinaturas e conexões WebRTC

Criar ou adaptar um `SubscriptionManager` para coordenar as seleções do
usuário.

Responsabilidades esperadas:

-   Manter a lista de fontes selecionadas pelo espectador.
-   Solicitar e cancelar assinaturas.
-   Acompanhar o estado de cada assinatura.
-   Associar trilhas de mídia ao `streamId` correto.
-   Integrar com Grid/Stage e controles de volume.
-   Evitar conexões, trilhas e listeners órfãos.
-   Recuperar-se de falhas sem deixar a interface em um estado falso.

### Decisão técnica obrigatória antes da implementação

Auditar se a implementação atual utiliza uma conexão `RTCPeerConnection`
por participante, por transmissão ou outra organização. Não escolher
automaticamente uma conexão por fonte sem verificar a arquitetura
existente.

Ao cancelar uma assinatura:

-   Encerrar a conexão somente se ela não for mais necessária.
-   Se uma conexão transportar outras trilhas ainda utilizadas, remover
    apenas os recursos associados à assinatura cancelada, conforme o
    modelo atual.
-   Não interromper a captura do publicador se outros espectadores ainda
    estiverem usando a mesma fonte.
-   Limpar elementos de vídeo, referências, eventos e estatísticas
    associados à assinatura encerrada.

## 6. Interface do catálogo

### Comportamento esperado

-   [x] Exibir as transmissões disponíveis na sala.
-   [x] Mostrar título, publicador, tipo de fonte e estado.
-   [x] Permitir selecionar e desmarcar fontes manualmente.
-   [x] Indicar visualmente quais fontes estão selecionadas, conectando
    ou reproduzindo.
-   [x] Mostrar erros de conexão e oferecer nova tentativa.
-   [x] Remover ou marcar fontes encerradas.
-   [x] Integrar as fontes selecionadas com Grid e Stage.
-   [x] Preservar volume individual, tela cheia e demais controles.
-   [x] Funcionar em navegador, dispositivos móveis e aplicativo
    desktop, conforme os recursos de cada plataforma.

### Considerações de interface

-   Não conectar automaticamente a todas as fontes listadas.
-   Não confundir uma miniatura visualmente pequena com economia de
    banda: reduzir o tamanho por CSS não reduz, por si só, o bitrate nem
    o custo de decodificação.
-   Evitar que a falha de uma fonte derrube a reprodução das demais.
-   Manter estados e mensagens compreensíveis durante conexão, reconexão
    e encerramento.

## 7. Escalabilidade adaptativa e desempenho

A meta é não estabelecer um teto fixo de transmissões selecionadas. Na
prática, a capacidade será limitada por rede, decodificação, GPU/CPU,
memória, resolução e características do dispositivo.

### 7.1 Métricas a avaliar

-   FPS efetivos de reprodução.
-   Quadros decodificados e descartados.
-   Bitrate recebido por fonte.
-   Pacotes perdidos e jitter.
-   RTT estimado da conexão.
-   Estado ICE e estado da conexão.
-   Uso de CPU/GPU e memória, quando houver uma forma confiável de
    medi-los.
-   Carga de codificação no computador publicador.
-   Resolução e taxa de quadros de cada transmissão.

Usar `RTCPeerConnection.getStats()` e métricas de reprodução disponíveis
na plataforma. Nem todas as plataformas expõem dados de CPU/GPU com a
mesma precisão.

### 7.2 Estados de desempenho

Proposta inicial, com limiares configuráveis a validar em testes:

-   **Normal:** manter a qualidade solicitada e continuar monitorando.
-   **Degradado:** detectar degradação persistente; reduzir qualidade
    quando possível e avisar o usuário.
-   **Crítico:** evitar novas ativações que agravem o problema e
    recomendar reduzir fluxos selecionados.

Não tratar uma única métrica como prova definitiva da causa de uma queda
de desempenho. Perda de pacotes, jitter, FPS baixo e quadros descartados
podem ter causas diferentes.

### 7.3 Política adaptativa sugerida

1.  Detectar degradação persistente em vez de reagir a picos
    momentâneos.
2.  Reduzir resolução ou FPS de fontes secundárias quando o protocolo e
    o publicador permitirem.
3.  Usar camadas de vídeo ou controle de bitrate, se a arquitetura atual
    suportar isso.
4.  Evitar novas assinaturas quando a estimativa de capacidade estiver
    esgotada.
5.  Exibir aviso quando a experiência continuar degradada.
6.  Restaurar qualidade gradualmente depois de um período estável.
7.  Não remover silenciosamente fontes selecionadas pelo usuário.

Importante: em P2P mesh, cada novo espectador pode aumentar o upload do
publicador. É necessário avaliar o impacto da quantidade de receptores,
não apenas o desempenho do computador que assiste. Se uma codificação
for compartilhada entre receptores, a adaptação por espectador pode
exigir decisões específicas para não duplicar desnecessariamente o
trabalho de codificação.

## 8. Metas de qualidade do projeto

-   [ ] Baixa carga de CPU/GPU no publicador.
-   [ ] Reprodução fluida, com o mínimo possível de quadros descartados.
-   [ ] Latência baixa e estável.
-   [ ] Seleção e cancelamento sem vazamentos de recursos.
-   [ ] Falha de uma transmissão isolada das demais.
-   [ ] Catálogo e assinaturas consistentes após desconexões.
-   [ ] Privacidade preservada e sem persistência desnecessária.
-   [ ] Compatibilidade com funcionalidades existentes.
-   [ ] Comportamento previsível em redes ruins e dispositivos modestos.

Essas metas precisam ser transformadas em benchmarks com cenários,
hardware, resolução, bitrate e critérios de aprovação documentados.

## 9. Captura e codificação de vídeo no desktop

Objetivo futuro: manter a captura de tela eficiente e investigar opções
de codificação acelerada por hardware para reduzir a carga do
publicador.

### Tecnologias a avaliar

-   **NVIDIA NVENC:** codificação por hardware em GPUs NVIDIA
    compatíveis.
-   **AMD AMF:** codificação por hardware em GPUs AMD compatíveis.
-   **Intel Quick Sync Video (QSV):** codificação por hardware em
    plataformas Intel compatíveis.
-   **Codecs:** H.264 como opção de ampla compatibilidade; avaliar AV1
    quando hardware, navegador, sistema operacional e caminho WebRTC
    suportarem o codec adequadamente.

### Cuidados

-   Não assumir que todos os codecs ou codificadores estão disponíveis
    em todos os computadores.
-   Detectar compatibilidade e oferecer fallback.
-   Medir qualidade visual, bitrate, latência, carga de CPU/GPU e
    estabilidade.
-   Verificar como a aplicação Electron, o navegador e a pilha WebRTC
    atual expõem codificação por hardware.
-   Não prometer suporte a NVENC/AMF/QSV apenas por selecionar um codec
    no frontend; o caminho de codificação precisa realmente utilizar o
    backend compatível.
-   Priorizar uma experiência estável antes de adicionar opções
    avançadas à interface.

## 10. P2P mesh e possível evolução para SFU

### Nesta atualização

-   Manter a arquitetura P2P existente.
-   Medir o custo de upload do publicador à medida que aumenta o número
    de espectadores.
-   Evitar introduzir uma infraestrutura SFU antes de haver evidência de
    que ela é necessária.

### Possível evolução futura

Avaliar um SFU se o modelo mesh limitar a quantidade de espectadores ou
elevar excessivamente o upload e a carga de codificação do publicador.

Essa decisão envolve custo de infraestrutura, roteamento de mídia,
segurança, implantação, monitoramento e mudanças na arquitetura. Não faz
parte automaticamente da implementação do catálogo.

### 11. Privacidade e ciclo de vida dos dados

-   [x] Manter o catálogo em memória.
-   [x] Não adicionar persistência de mídia ou imagens do chat.
-   [x] Remover registros temporários de fontes encerradas.
-   [x] Limpar estado de participantes ao desconectar.
-   [x] Evitar logs com conteúdo de mídia ou dados desnecessários.
-   [x] Validar sala e permissões em toda operação de
    catálogo/assinatura.
-   [x] Documentar quais metadados são transitórios e quando são
    removidos.

## 12. Plano de execução recomendado

### Fase 1 --- Auditoria

-   [x] Mapear os arquivos e módulos do backend relacionados a salas,
    participantes e WebSocket.
-   [x] Mapear o frontend responsável pela lista de participantes,
    Grid/Stage e reprodução.
-   [x] Encontrar os pontos de criação e encerramento de
    `RTCPeerConnection`.
-   [x] Documentar como as trilhas de mídia são identificadas.
-   [x] Registrar testes existentes e comportamentos que não podem
    regredir.

### Fase 2 --- Catálogo mínimo

-   [x] Implementar modelo de fonte e estado em memória.
-   [x] Implementar lista inicial e atualizações ao vivo.
-   [x] Filtrar fontes por sala.
-   [x] Construir a interface de seleção manual.
-   [x] Testar publicação, encerramento e desconexão.

### Fase 3 --- Assinaturas

-   [x] Integrar seleção com a negociação WebRTC atual.
-   [x] Implementar inscrição e cancelamento.
-   [x] Associar corretamente mídia e `streamId`.
-   [x] Limpar recursos e tratar falhas.
-   [x] Validar que fontes não selecionadas não geram recepção
    desnecessária de mídia.

### Fase 4 --- Múltiplos fluxos e interface

-   [x] Integrar com Grid e Stage.
-   [x] Preservar controles individuais de volume.
-   [x] Testar seleção, desmarcação e troca rápida.
-   [x] Verificar isolamento de falhas entre fontes.
-   [x] Testar desktop, navegador e dispositivos móveis.

### Fase 5 --- Monitoramento adaptativo

-   [ ] Coletar métricas por conexão e por fonte.
-   [ ] Definir estados de desempenho.
-   [ ] Implementar avisos e política de novas ativações.
-   [ ] Implementar redução/restauração gradual da qualidade, se
    suportada.
-   [ ] Calibrar limiares por benchmark.

### Fase 6 --- Otimização do desktop

-   [ ] Medir carga de captura e codificação.
-   [ ] Investigar NVENC, AMF e QSV.
-   [ ] Comparar H.264 e AV1 nos equipamentos compatíveis.
-   [ ] Implementar detecção de capacidade e fallback.
-   [ ] Documentar resultados e limitações.

### Fase 7 --- Estabilização e release

-   [x] Testes de regressão de Grid, Stage, áudio, chat e tela cheia.
-   [x] Testes de desconexão, rede instável e publicador encerrado.
-   [ ] Testes de uso prolongado para detectar vazamentos.
-   [ ] Atualizar README, instruções de configuração e documentação
    técnica.
-   [x] Registrar mudanças e limitações conhecidas na release.

## 13. Testes de aceitação

### Catálogo e permissões

-   [x] Uma fonte publicada aparece para os participantes da mesma sala.
-   [x] Uma fonte de outra sala nunca aparece nem pode ser assinada.
-   [x] Uma fonte encerrada deixa de ser apresentada como ativa.
-   [x] Desconexões não deixam registros temporários órfãos.

### Assinaturas e reprodução

-   [x] Selecionar uma fonte inicia a recepção correta.
-   [x] Desmarcar uma fonte interrompe a assinatura correspondente.
-   [x] Selecionar e desmarcar repetidamente não acumula conexões ou
    listeners.
-   [x] Uma falha em uma fonte não encerra as demais.
-   [x] O vídeo correto é associado ao card correto.
-   [x] O volume individual continua funcionando.

### Desempenho

-   [ ] Testar diferentes quantidades de fontes, resoluções e FPS.
-   [ ] Medir upload do publicador e download do espectador.
-   [ ] Medir FPS e quadros descartados.
-   [ ] Simular jitter, perda de pacotes e banda limitada.
-   [ ] Confirmar que a política adaptativa não oscila agressivamente.
-   [ ] Verificar recuperação depois de um período degradado.

### Regressão

-   [x] Grid e Stage continuam funcionando.
-   [x] Tela cheia e controles imersivos continuam funcionando.
-   [x] Chat e imagens efêmeras continuam funcionando.
-   [x] Mixer e seleção de áudio de aplicativos continuam funcionando no
    desktop.
-   [x] Navegadores móveis continuam utilizáveis.

## 14. Questões em aberto

Use esta seção para registrar decisões que ainda precisam ser tomadas.

-   [x] **O catálogo inicial lista apenas `desktop` ou também câmera e outras fontes?**\
    *Definido:* O catálogo lista `desktop` (telas) e `camera` (webcams), cada um com seu identificador canônico `${userId}-${sourceType}`.
-   [x] **Como o projeto atual organiza `RTCPeerConnection`: por participante, por fonte ou de outra forma?**\
    *Definido:* 1 `RTCPeerConnection` por participante remoto (`webrtc.peers.get(targetUserId)`), com transceivers e MIDs determinísticos mapeados via WebRTC Unified Plan. A subscrição controla se a mídia é decodificada/montada no grid e solicita recepção sob demanda.
-   [x] **Qual a política de qualidade inicial para fontes adicionais?**\
    *Definido:* Streaming sob demanda. O transmissor apenas envia pacotes de vídeo codificados para participantes inscritos (`SUBSCRIBE_STREAM`). Para espectadores não inscritos, aplica-se `replaceTrack(null)`, encerrando instâncias ociosas de codificação na GPU/CPU.
-   [x] **Como medir de maneira confiável a pressão de CPU/GPU em cada plataforma?**\
    *Definido:* Em desktop, via IPC nativo `desktopAPI.getGpuDiagnostics()` (`app.getGPUFeatureStatus()`, `app.getGPUInfo('basic')`, CPU % e memória). Na camada WebRTC, via inspeção estrita de `report.encoderImplementation` e `report.decoderImplementation` (`ExternalEncoder` D3D11/MediaFoundation vs `OpenH264`/`libvpx`).
-   [x] **Quais codecs estarão habilitados inicialmente em cada plataforma?**\
    *Definido:* H.264, AV1, VP9 e VP8, com preferências de codec aplicadas via `setCodecPreferences()` na oferta e na resposta (Answer).

## 15. Registro de alterações do plano

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Data                    Alteração                                                               Motivo / decisão
  ----------------------- ----------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------
  2026-10-10              Definido catálogo dentro da mesma sala, seleção manual e                Planejamento da próxima atualização.
                          capacidade adaptativa sem teto numérico fixo.

  2026-10-10              Implementadas Fases 1, 2, 3 e 4: Catálogo efêmero de transmissões na   Catálogo de Transmissões / Subscrição Sob Demanda implementado no backend Node.js e frontend (HTML/CSS/JS).
                          sala, subscrição sob demanda, aba na sidebar e sincronização de tiles.

  2026-10-11              Evolução da Interface Inspirada no Discord: Transmissões no Menu        Eliminação da aba lateral de transmissões em prol de uma experiência unificada e intuitiva. Todos os
                          Principal, Call Grid de Participantes, Miniatura Interativa com botão   participantes aparecem na chamada com cores vibrantes; lives recebem badge "AO VIVO" e botão para assistir.
                          "Assistir Transmissão", Modos Teatro e Palco com Tira Ocultável         Modos Palco e Teatro ganham tira de miniaturas recolhível com 1 clique para foco total no vídeo.
                          de Participantes e Cores Aleatórias/Consistentes para Participantes.

  2026-10-11              Resolução do erro isAudioMuted e Aprimoramento da Chamada Discord/Meet: Correção do método isAudioMuted/isaudioMuted em MediaManager e fallback resiliente. Participantes
                          Sincronização de Mute Remoto, Foco Interativo e Expansão no Palco       sempre visíveis no Mosaico ou na Tira inferior recolhível. Usuário que transmite pode expandir
                          (Versão 1.2.1).                                                         sua live no Palco/Teatro. Suporte a clique direto no card para assistir live e toggle da tira.

  2026-10-11              Correção de Encerramento de Transmissão e Indicador de Voz Ativa (VAD): Resolução do problema em que a tela ficava preta ao desativar live/câmera (retorno automático
                          Contorno Verde no Avatar/Card ao Falar e Áudio P2P Contínuo             ao grid sem tela preta). Implementação de VAD em tempo real via Web Audio API com contorno e badge
                          (Versão 1.2.3).                                                         verde (#10b981) quando o participante fala, e reprodução contínua de áudio na chamada P2P.

  2026-10-11              Correção de Acesso à Transmissão (Sem Tela Preta) e Remoção de Teatro:  Remoção definitiva do botão/modo Teatro (permanecendo Mosaico e Palco). Resolução completa da tela preta
                          Sincronização de Stream IDs (-desktop e -screen), Fallback Autoplay      ao clicar em "Assistir Transmissão" via normalização de aliases, registro no remoteUserMedia e fallback
                          e Reprodução Estável no Desktop, Navegador e Mobile (Versão 1.2.4).      de reprodução com áudio/mudo em navegadores e dispositivos móveis.

  2026-10-13              Auditoria Completa, Otimização de CPU e Estabilização WebRTC:           Streaming de vídeo sob demanda com replaceTrack(null) para participantes não inscritos,
                          Streaming Sob Demanda, Token Bucket Rate Limiter, Aceleração Real       eliminando instâncias duplicadas de encoders na GPU/CPU. Token Bucket com burst de 160 tokens
                          por Hardware e Reconexão Automática Resiliente (Versão 1.3.1).          e taxa de 60/s no backend, loteamento de candidatos ICE e remoção de alert() bloqueante.
                                                                                                  Telemetria fidedigna via getStats() e IPC do Electron, com modal de diagnóstico em tempo real.
                                                                                                  Reconexão automática com backoff exponencial + jitter e histórico da última sala no Lobby.
  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 16. Próximas Atualizações Planejadas (Backlog de Personalização de Usuário)

1. **Fotos de Perfil / Avatares Customizados**:
   - Permitir que cada participante envie uma foto de perfil local ou selecione um ícone de usuário.
   - Envio da imagem de perfil compactada via sinalização P2P para todos os participantes da sala.
2. **Extração Automática da Cor Dominante da Imagem**:
   - Processamento via Canvas 2D no cliente para extrair a cor média/dominante do avatar enviado.
   - Aplicação dinâmica dessa cor como a cor da miniatura, do anel de atividade de voz e da borda do card do participante (substituindo a paleta randômica atual).
3. **Alternância de Posição da Tira de Participantes (Horizontal vs. Vertical)**:
   - Permitir alternar a tira de participantes entre a posição inferior (horizontal, padrão Meet) e a lateral (vertical, padrão Discord) nos modos Palco e Teatro.

## 17. Princípio orientador

**Implementar primeiro a correção do ciclo de vida das transmissões e
assinaturas; depois otimizar a quantidade e a qualidade dos fluxos.** O
objetivo não é simplesmente colocar mais vídeos na tela, mas permitir
que o usuário escolha o que recebe, com consumo de recursos controlado,
reprodução fluida e sem comprometer as funcionalidades já existentes.
