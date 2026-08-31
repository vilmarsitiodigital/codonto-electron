# Codonto Sync — versão visível e atualização automática no Windows

**Data:** 2026-08-31  
**Status:** aprovado

## Contexto

O Codonto Sync está na versão `3.0.0`, mas a tela inicial não mostra essa versão e o aplicativo não possui um fluxo de atualização. O repositório `vilmarsitiodigital/codonto-electron` já é público e pode distribuir instaladores e metadados por GitHub Releases.

Esta mudança adapta para JavaScript a estratégia já usada no projeto `unosystem-balanca`: `electron-updater`, GitHub Releases, ações explícitas do usuário para baixar e instalar, e verificação periódica em segundo plano.

## Objetivos

- Mostrar a versão instalada na tela inicial.
- Permitir que o usuário verifique, baixe e instale uma nova versão sem procurar manualmente um instalador.
- Verificar silenciosamente por atualizações ao iniciar e a cada quatro horas.
- Publicar releases Windows reproduzíveis por GitHub Actions.
- Manter a atualização isolada da automação principal do Codonto.

## Fora do escopo

- Atualização automática no macOS ou Linux.
- Assinatura digital do instalador Windows.
- Canal beta, rollout gradual ou servidor próprio de atualizações.
- Instalação silenciosa sem consentimento do usuário.

## Experiência na tela inicial

O canto superior direito exibirá `Versão X.Y.Z` e o botão **Atualizar versão**. A versão virá de `app.getVersion()`, que lê a versão empacotada definida em `package.json`.

Um aviso de atualização ficará logo abaixo do cabeçalho e aparecerá somente quando houver informação relevante:

1. Ao verificar, o botão indicará que a consulta está em andamento e não aceitará um segundo clique.
2. Se a versão estiver atualizada, a tela mostrará uma confirmação breve e voltará ao estado normal.
3. Se houver uma versão nova, o aviso mostrará a versão disponível e o botão **Atualizar**.
4. Durante o download, o aviso mostrará a porcentagem recebida.
5. Após o download, o aviso mostrará **Reiniciar agora**.
6. Em caso de erro, o aviso exibirá uma mensagem compreensível e permitirá uma nova tentativa.

No macOS, Linux ou em `pnpm run dev`, a versão continuará visível. O botão explicará que a atualização automática só está disponível no aplicativo Windows instalado, sem tentar acessar ou instalar pacotes.

## Arquitetura

### Serviço de atualização

Um módulo dedicado em `src/main/updater/` será o único componente que acessa `electron-updater`. Ele será inicializado depois que o aplicativo estiver pronto e receberá uma função para enviar eventos à janela principal.

Configuração:

- `autoDownload = false`: a atualização só baixa após o clique do usuário.
- `autoInstallOnAppQuit = true`: uma atualização já baixada será instalada ao fechar normalmente o aplicativo.
- Verificação inicial cinco segundos após a janela estar pronta.
- Nova verificação a cada quatro horas enquanto o aplicativo estiver aberto.
- Operações de atualização habilitadas somente quando `app.isPackaged` for verdadeiro e `process.platform` for `win32`.
- Apenas uma verificação ou download poderá estar ativo por vez.
- Timers e listeners serão registrados uma única vez e removidos no encerramento.

### IPC e preload

O processo principal oferecerá quatro operações com nomes próprios do Codonto:

- obter a versão atual;
- verificar atualizações;
- baixar a atualização encontrada;
- instalar e reiniciar.

O preload exporá somente essas operações e uma assinatura de eventos ao renderer. A assinatura retornará uma função de remoção para impedir listeners órfãos. Objetos do `electron-updater` não serão enviados diretamente; o serviço emitirá payloads serializáveis e mínimos.

### Estados e eventos

O renderer tratará os seguintes estados:

- `idle`;
- `unsupported`;
- `checking`;
- `up-to-date`;
- `available`, com a nova versão;
- `downloading`, com percentual normalizado entre 0 e 100;
- `downloaded`, com a versão pronta;
- `error`, com mensagem segura para exibição.

O processo principal é a fonte de verdade. O renderer apenas transforma os eventos recebidos em texto, botões e progresso.

## Tratamento de erros e isolamento

Falhas de rede, ausência de release, metadados inválidos ou erros de download serão capturados pelo serviço e convertidos para o estado `error`. Elas não poderão encerrar o aplicativo, alterar o status do agente ou interromper a fila de automações.

Mensagens técnicas completas irão para os logs locais. A interface mostrará uma versão curta, sem tokens, caminhos internos ou dados de exceção potencialmente sensíveis. Uma falha automática em segundo plano não abrirá diálogos modais.

## Publicação

O `electron-builder` será configurado com o provedor GitHub, proprietário `vilmarsitiodigital` e repositório `codonto-electron`. Um script de release Windows publicará o instalador NSIS e os metadados exigidos pelo `electron-updater`.

Um workflow em `.github/workflows/release.yml` será executado por tags `v*` em um runner Windows. Ele instalará o pnpm, instalará dependências com lockfile, executará as verificações do projeto e publicará os artefatos usando o `GITHUB_TOKEN` com permissão `contents: write`.

O processo de lançamento será:

1. alterar a versão do `package.json`;
2. executar testes e build local aplicáveis;
3. fazer commit e push;
4. criar e enviar a tag `vX.Y.Z` correspondente;
5. verificar a conclusão do workflow e os arquivos da GitHub Release.

Não existem tags atualmente. A primeira versão que contém o atualizador poderá ser `3.0.1`; ela funciona como versão inicial instalada. Uma versão posterior será necessária para validar uma atualização completa de ponta a ponta.

## Testes e verificação

Os testes automatizados cobrirão:

- versão retornada pelo processo principal;
- bloqueio em desenvolvimento e em plataformas não Windows;
- configuração de download manual e instalação ao sair;
- tradução de todos os eventos do updater para estados serializáveis;
- prevenção de verificações e downloads concorrentes;
- registro e remoção dos listeners expostos pelo preload;
- transições e ações da interface para atualização disponível, progresso, conclusão e erro;
- preservação das funções existentes da tela inicial e da automação.

A verificação final incluirá testes automatizados, checagem de sintaxe/build e inspeção visual da tela em desenvolvimento. A instalação e atualização reais serão validadas com duas releases Windows sucessivas.

## Critérios de aceite

- A tela inicial mostra exatamente a versão retornada pelo Electron.
- O botão não inicia atualizações fora do Windows empacotado e explica o motivo.
- Uma release superior pode ser detectada, baixada e instalada após confirmação do usuário.
- O progresso e os erros ficam visíveis sem bloquear o restante do aplicativo.
- Verificações periódicas não criam timers, downloads ou listeners duplicados.
- Uma tag de versão produz automaticamente os artefatos Windows necessários em uma GitHub Release.
