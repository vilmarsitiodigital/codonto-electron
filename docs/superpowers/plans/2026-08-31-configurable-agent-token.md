# Configurable Agent Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o usuário configure e persista com segurança o `AGENT_TOKEN` na tela inicial, mantendo a precedência do `.env` e bloqueando o agente sem credencial.

**Architecture:** Um store isolado resolve a precedência e encapsula `safeStorage`; o cliente Axios consulta esse store antes de cada requisição; e um serviço do agente centraliza o bloqueio, o início automático e o estado enviado por IPC. Um controlador renderer independente gerencia o formulário sem jamais receber o token persistido.

**Tech Stack:** Electron 28, CommonJS, Axios, Node.js test runner, HTML/CSS/JavaScript, pnpm 10.19.0.

**Spec:** `docs/superpowers/specs/2026-08-31-configurable-agent-token-design.md`

## Global Constraints

- `AGENT_TOKEN` não vazio no ambiente sempre tem prioridade e bloqueia a edição na interface.
- O token persistido usa exclusivamente `safeStorage.encryptString()` e `safeStorage.decryptString()`.
- Se a criptografia segura não estiver disponível, o token não será salvo.
- Nenhuma API do preload ou payload IPC devolverá o token em texto puro ou criptografado.
- O cliente HTTP obtém o token efetivo novamente antes de cada requisição.
- O worker não inicia sem token; depois de salvar um token válido, inicia automaticamente.
- Não adicionar remoção, exibição, cópia ou validação remota do token.

## File Map

- `src/main/config.js`: torna leitura e gravação do `config.json` reutilizáveis pelo store.
- `src/main/agentTokenStore.js`: resolve ambiente, criptografa, persiste e devolve somente estado seguro.
- `src/main/apiClient.js`: injeta dinamicamente o cabeçalho `Authorization` em cada requisição.
- `src/main/agentService.js`: combina token e worker para expor início, parada e estado consistentes.
- `src/main/agentIpc.js`: registra operações do agente e da configuração do token.
- `src/main/index.js`: monta os serviços, integra bandeja e inicia somente quando configurado.
- `src/preload/index.js`: expõe `obterEstadoToken` e `salvarToken`.
- `src/renderer/agentTokenUi.js`: controla estados e salvamento do formulário.
- `src/renderer/index.html`: inclui marcação, estilos e integração do controlador.
- `tests/agentTokenStore.test.js`: cobre segurança, precedência e validação.
- `tests/apiClient.test.js`: cobre o token dinâmico no cabeçalho.
- `tests/agentService.test.js`: cobre bloqueio, início e estado.
- `tests/agentIpc.test.js`: cobre os contratos IPC sem vazamento.
- `tests/preload.test.js`: cobre os novos canais do preload.
- `tests/agentTokenUi.test.js`: cobre os estados visuais e ações do formulário.
- `README.md` e `.env.example`: documentam a configuração pela tela e a precedência do ambiente.

---

### Task 1: Store criptografado do token

**Files:**
- Modify: `src/main/config.js`
- Create: `src/main/agentTokenStore.js`
- Create: `tests/agentTokenStore.test.js`

**Interfaces:**
- Consumes: `readConfig(): object`, `saveConfig(partial): object`, `safeStorage.isEncryptionAvailable()`, `safeStorage.encryptString(string)` e `safeStorage.decryptString(Buffer)`.
- Produces: `createAgentTokenStore({ env, safeStorage, readConfig, saveConfig })` com `getToken()`, `getState()` e `saveToken(token)`.

- [ ] **Step 1: Write failing tests for precedence, encrypted persistence and validation**

```js
test('prioriza AGENT_TOKEN do ambiente e não permite substituí-lo', () => {
  const store = createAgentTokenStore(dependencies({ AGENT_TOKEN: 'token-env' }));
  assert.equal(store.getToken(), 'token-env');
  assert.deepEqual(store.getState(), {
    configurado: true,
    fixoViaEnv: true,
    disponivelParaSalvar: false,
  });
  assert.throws(() => store.saveToken('outro'), /definido no ambiente/);
});

test('criptografa o token antes de persistir e consegue recuperá-lo', () => {
  const fixture = dependencies();
  const store = createAgentTokenStore(fixture);
  store.saveToken('segredo');
  assert.equal(fixture.saved.agentTokenEncrypted, Buffer.from('encrypted:segredo').toString('base64'));
  assert.equal(JSON.stringify(fixture.saved).includes('segredo'), false);
  assert.equal(store.getToken(), 'segredo');
});

test('recusa token vazio e armazenamento sem criptografia segura', () => {
  assert.throws(() => createAgentTokenStore(dependencies()).saveToken('   '), /Informe um token/);
  assert.throws(
    () => createAgentTokenStore(dependencies({}, { encryptionAvailable: false })).saveToken('segredo'),
    /criptografia segura/,
  );
});
```

- [ ] **Step 2: Run `pnpm test tests/agentTokenStore.test.js` and verify RED because the module does not exist**
- [ ] **Step 3: Implement the minimal store and export `lerConfig`/`salvarConfig` from `config.js`**
- [ ] **Step 4: Run `pnpm test tests/agentTokenStore.test.js` and verify GREEN**
- [ ] **Step 5: Refactor names and messages while keeping the focused test green**

### Task 2: Autorização dinâmica por requisição

**Files:**
- Modify: `src/main/apiClient.js`
- Create: `tests/apiClient.test.js`

**Interfaces:**
- Consumes: `getAgentToken(): string | null` from the production token store.
- Produces: `createApiClient({ axiosLib, baseURL, getAgentToken, logger })` and the existing six API methods.

- [ ] **Step 1: Write a failing test that changes the token between two real Axios requests**

```js
test('consulta o token novamente antes de cada requisição', async () => {
  let token = 'primeiro';
  const received = [];
  const client = createApiClient({
    axiosLib: axiosWithAdapter((config) => received.push(config.headers.Authorization)),
    baseURL: 'https://api.example.test',
    getAgentToken: () => token,
    logger: { info() {} },
  });
  await client.buscarStatus('2026-08-31');
  token = 'segundo';
  await client.buscarStatus('2026-08-31');
  assert.deepEqual(received, ['Bearer primeiro', 'Bearer segundo']);
});
```

- [ ] **Step 2: Run `pnpm test tests/apiClient.test.js` and verify RED because the factory is absent**
- [ ] **Step 3: Add an Axios request interceptor that rejects missing tokens and preserve all endpoint methods**
- [ ] **Step 4: Run `pnpm test tests/apiClient.test.js` and verify GREEN**
- [ ] **Step 5: Run the store and API tests together**

### Task 3: Serviço do agente e IPC seguro

**Files:**
- Create: `src/main/agentService.js`
- Create: `src/main/agentIpc.js`
- Modify: `src/main/index.js`
- Create: `tests/agentService.test.js`
- Create: `tests/agentIpc.test.js`

**Interfaces:**
- Consumes: token store `getState()`/`saveToken()` and worker `iniciar()`/`parar()`/status methods.
- Produces: `createAgentService({ tokenStore, worker })` with `iniciar()`, `iniciarSeConfigurado()`, `parar()`, `status()`, `obterEstadoToken()` and `salvarToken(token)`; `registerAgentIpc({ ipcMain, service, onStateChanged })` returning cleanup.

- [ ] **Step 1: Write failing service tests for missing-token blocking and auto-start after save**

```js
test('não inicia o worker quando falta o token', () => {
  const service = createAgentService(fixture({ configurado: false }));
  assert.deepEqual(service.iniciarSeConfigurado(), {
    rodando: false,
    aguardandoLogin: false,
    configuracaoNecessaria: true,
  });
});

test('salva um token válido e inicia o worker', () => {
  const fixture = mutableFixture();
  const service = createAgentService(fixture);
  const result = service.salvarToken('novo-token');
  assert.equal(result.configurado, true);
  assert.equal(result.rodando, true);
});
```

- [ ] **Step 2: Run `pnpm test tests/agentService.test.js` and verify RED**
- [ ] **Step 3: Implement the minimal service and verify GREEN**
- [ ] **Step 4: Write failing IPC tests asserting only safe state is returned and cleanup removes handlers**
- [ ] **Step 5: Implement IPC registration, replace inline handlers in `index.js`, gate tray actions and startup, then verify GREEN**

### Task 4: Preload and token form controller

**Files:**
- Modify: `src/preload/index.js`
- Modify: `tests/preload.test.js`
- Create: `src/renderer/agentTokenUi.js`
- Create: `tests/agentTokenUi.test.js`

**Interfaces:**
- Consumes: IPC channels `config:obterAgentToken` and `config:salvarAgentToken`.
- Produces: `window.codonto.obterEstadoToken()`, `window.codonto.salvarToken(token)` and `createAgentTokenController({ api, elements, onAgentState })`.

- [ ] **Step 1: Extend the preload test and verify RED for the missing methods**
- [ ] **Step 2: Add the two invokes and verify the preload test GREEN**
- [ ] **Step 3: Write failing controller tests for unconfigured, configured, environment-fixed, saving and error states**

```js
test('limpa o campo e publica o estado do agente depois de salvar', async () => {
  const fixture = createUiFixture({ configurado: false });
  fixture.elements.input.value = 'novo-token';
  await fixture.controller.save();
  assert.equal(fixture.elements.input.value, '');
  assert.equal(fixture.elements.status.textContent, 'Configurado');
  assert.deepEqual(fixture.agentStates, [{ rodando: true, configuracaoNecessaria: false }]);
});
```

- [ ] **Step 4: Implement the minimal renderer controller and verify GREEN**
- [ ] **Step 5: Refactor rendering without exposing the saved value**

### Task 5: Integrate the initial screen and documentation

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `window.CodontoAgentTokenUi`, the two preload operations and agent state payloads.
- Produces: visible password input, status text, save button and `Configuração necessária` agent badge.

- [ ] **Step 1: Add the token form markup and styles to the existing settings area**
- [ ] **Step 2: Initialize the controller before loading agent status and connect `onAgentState` to `setStatus`**
- [ ] **Step 3: Make `setStatus` disable Start when `configuracaoNecessaria` is true**
- [ ] **Step 4: Document screen configuration, environment precedence and encrypted persistence**
- [ ] **Step 5: Run `pnpm test` and manually start `pnpm run dev` to inspect the screen**

### Task 6: Final verification and delivery

**Files:**
- Review: all files changed by Tasks 1–5

**Interfaces:**
- Consumes: complete feature branch.
- Produces: verified branch ready for pull request and a subsequent release.

- [ ] **Step 1: Run `pnpm test` from a clean process and record total pass/fail counts**
- [ ] **Step 2: Run `git diff --check` and inspect `git diff --stat`**
- [ ] **Step 3: Verify no plaintext token or accidental worktree file appears in the diff**
- [ ] **Step 4: Review mutations: environment precedence, missing-token branch, encryption unavailable and second-request token refresh**
- [ ] **Step 5: Commit, push and open a pull request to `main`; create a release only after the PR is merged and the release workflow is green**
