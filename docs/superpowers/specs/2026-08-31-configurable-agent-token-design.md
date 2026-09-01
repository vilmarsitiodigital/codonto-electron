# Codonto Sync — configuração segura do token do agente

**Data:** 2026-08-31
**Status:** aprovado

## Contexto

O Codonto Sync depende de `AGENT_TOKEN` para autenticar as chamadas ao backend. Hoje o valor só pode ser informado em `.env`, o que obriga quem instala o aplicativo a editar arquivos fora da interface.

## Objetivos

- Permitir que o usuário informe o token na tela inicial quando ele não estiver definido no ambiente.
- Persistir o token usando a criptografia segura do sistema operacional, sem gravá-lo em texto puro.
- Aplicar o token salvo imediatamente às próximas requisições, sem reiniciar o aplicativo.
- Não iniciar o agente enquanto não houver um token utilizável.
- Manter `AGENT_TOKEN` do `.env` como fonte prioritária e não editável pela interface.

## Experiência na tela inicial

A área de configurações terá um campo de senha **Token do agente**, um indicador de estado e o botão **Salvar token**.

- Sem token, a interface mostrará **Não configurado** e o agente permanecerá parado com o estado **Configuração necessária**.
- Depois de salvar, o campo será esvaziado, o indicador mostrará **Configurado** e o agente será iniciado automaticamente.
- Quando `AGENT_TOKEN` estiver definido no `.env`, o campo e o botão ficarão desabilitados e o indicador mostrará **Definido pelo ambiente**.
- O valor atual nunca será devolvido ao renderer. Um novo valor poderá substituir o valor persistido digitando e salvando novamente.
- Falhas de validação ou criptografia serão mostradas como mensagens claras, sem revelar o token.

## Persistência e segurança

O processo principal usará `safeStorage` do Electron. O token será criptografado e salvo em Base64 no `config.json` já localizado em `app.getPath('userData')`. Base64 será apenas o formato de transporte do conteúdo criptografado, não o mecanismo de proteção.

Se `safeStorage.isEncryptionAvailable()` for falso, o aplicativo recusará o salvamento. Não haverá fallback para texto puro. Tokens vazios ou compostos apenas por espaços também serão recusados.

O estado exposto ao renderer conterá apenas:

- `configurado`;
- `fixoViaEnv`;
- `disponivelParaSalvar`;
- uma mensagem segura opcional.

## Autenticação e ciclo de vida

O cliente HTTP deixará de capturar o token na criação do módulo. Um interceptor obterá o valor efetivo antes de cada requisição, priorizando o ambiente e depois a configuração criptografada.

Na inicialização, o processo principal consultará o estado do token. O worker só será iniciado automaticamente quando o token estiver configurado. As ações de iniciar pelo renderer ou pela bandeja usarão a mesma verificação para impedir execução sem credencial.

Ao salvar um token válido, o processo principal iniciará o worker e publicará o novo estado para a janela e a bandeja.

## Fora do escopo

- Remover o token persistido pela interface.
- Mostrar, copiar ou recuperar o token já salvo.
- Validar antecipadamente o token com uma chamada específica ao servidor.
- Armazenar o token em serviço externo ou sincronizá-lo entre computadores.

## Verificação

Testes automatizados cobrirão prioridade do ambiente, criptografia e descriptografia, recusa de texto puro, autenticação dinâmica, bloqueio e início do agente, contratos IPC/preload e os estados visuais da configuração.
