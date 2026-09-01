# Windows Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir a versão do Codonto Sync e permitir verificar, baixar e instalar atualizações Windows publicadas em GitHub Releases.

**Architecture:** Um serviço injetável no processo principal encapsula `electron-updater`; um adaptador IPC expõe quatro operações seguras pelo preload; e um controlador isolado transforma eventos do updater nos estados visuais da tela inicial. O `electron-builder` publica instaladores NSIS e metadados pelo workflow de tags do GitHub Actions.

**Tech Stack:** Electron 28, CommonJS, Node.js test runner, Playwright, electron-updater 6.6.2, Winston, electron-builder 24, pnpm 10.19.0, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-31-windows-auto-update-design.md`

## Global Constraints

- Atualização automática funciona somente quando `app.isPackaged === true` e `process.platform === 'win32'`.
- `autoDownload` deve permanecer `false` e `autoInstallOnAppQuit` deve permanecer `true`.
- A primeira verificação ocorre 5.000 ms após a inicialização; as seguintes ocorrem a cada 14.400.000 ms.
- A interface usa os textos **Atualizar versão**, **Atualizar** e **Reiniciar agora**.
- A versão inicial desta funcionalidade é `3.0.1`; nenhuma release ou tag será publicada durante a implementação.
- Logs técnicos usam `src/main/logger.js`; a interface nunca exibe stack traces, tokens ou caminhos internos.
- O repositório e o provedor de publicação são `vilmarsitiodigital/codonto-electron` e GitHub Releases.
- Não adicionar suporte de atualização para macOS/Linux, assinatura de código, canal beta ou servidor próprio.
- Preservar sem staging acidental as alterações preexistentes em `src/main/automation/codontoSelectors.js` e `tests/codontoSelectors.test.js`.

## File Map

- `src/main/updater/updaterService.js`: encapsula configuração, eventos, concorrência, timers, download e instalação.
- `src/main/updater/updaterIpc.js`: registra e remove os quatro handlers IPC do updater.
- `src/main/index.js`: cria o serviço, envia eventos à janela e encerra timers/listeners.
- `src/preload/index.js`: constrói e expõe a API segura `window.codonto`.
- `src/renderer/updaterUi.js`: controla exclusivamente os estados visuais do updater.
- `src/renderer/index.html`: contém a marcação/CSS do cabeçalho e do aviso de atualização.
- `tests/packageConfig.test.js`: valida versão, gerenciador, scripts e configuração de publicação.
- `tests/updaterService.test.js`: valida o serviço com updater, logger e relógio falsos.
- `tests/updaterIpc.test.js`: valida canais, retornos e remoção de handlers.
- `tests/preload.test.js`: valida invokes e remoção do listener do preload.
- `tests/updaterUi.test.js`: valida estados e ações do controlador com elementos falsos.
- `tests/releaseWorkflow.test.js`: valida os requisitos do workflow de release.
- `.github/workflows/release.yml`: testa e publica o instalador Windows em tags `v*`.
- `README.md`: documenta pnpm, atualização e processo de release.
- `package.json` e `pnpm-lock.yaml`: fixam a versão, dependência e publicação.
- `package-lock.json`: removido após importação, tornando pnpm a única fonte de lock.

---

### Task 1: Metadados, dependência e lockfile de distribuição

**Files:**
- Modify: `package.json`
- Create: `pnpm-lock.yaml`
- Delete: `package-lock.json`
- Create: `tests/packageConfig.test.js`

**Interfaces:**
- Consumes: configuração atual do `electron-builder` e pnpm `10.19.0` instalado.
- Produces: versão `3.0.1`, script `test`, script `release:win`, dependência `electron-updater` e configuração `build.publish`.

- [ ] **Step 1: Write the failing package configuration test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('configura versão, pnpm e atualização pelo GitHub', () => {
  assert.equal(pkg.version, '3.0.1');
  assert.equal(pkg.packageManager, 'pnpm@10.19.0');
  assert.equal(pkg.dependencies['electron-updater'], '^6.6.2');
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.equal(pkg.scripts['release:win'], 'electron-builder --win --x64 --publish always');
  assert.deepEqual(pkg.build.publish, [{
    provider: 'github',
    owner: 'vilmarsitiodigital',
    repo: 'codonto-electron',
    releaseType: 'release',
  }]);
});
```

- [ ] **Step 2: Run the focused test and verify the current config fails**

Run: `node --test tests/packageConfig.test.js`

Expected: FAIL because `package.json` still reports `3.0.0` and has no `packageManager`, updater dependency, test/release scripts, or publish provider.

- [ ] **Step 3: Update package metadata and standardize pnpm**

Set these exact values in `package.json` while preserving existing fields:

```json
{
  "version": "3.0.1",
  "packageManager": "pnpm@10.19.0",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev",
    "test": "node --test tests/*.test.js",
    "build": "electron-builder --win --x64",
    "build:mac": "electron-builder --mac",
    "release:win": "electron-builder --win --x64 --publish always"
  }
}
```

Add the exact publish entry under `build`:

```json
"publish": [
  {
    "provider": "github",
    "owner": "vilmarsitiodigital",
    "repo": "codonto-electron",
    "releaseType": "release"
  }
]
```

Create the pnpm lock from the existing npm lock, add the updater, and then delete `package-lock.json` with `apply_patch` so only one lockfile remains:

```bash
pnpm import
pnpm add electron-updater@^6.6.2 --save-prod
```

- [ ] **Step 4: Run the package test and the complete suite**

Run: `node --test tests/packageConfig.test.js`

Expected: PASS.

Run: `pnpm test`

Expected: all package and existing Playwright selector tests PASS.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add package.json pnpm-lock.yaml package-lock.json tests/packageConfig.test.js
git commit -m "build: configure GitHub update releases"
```

---

### Task 2: Serviço de atualização isolado e testável

**Files:**
- Create: `src/main/updater/updaterService.js`
- Create: `tests/updaterService.test.js`

**Interfaces:**
- Consumes: `{ updater, logger, isPackaged, platform, sendEvent, setTimeoutFn, clearTimeoutFn, setIntervalFn, clearIntervalFn }`.
- Produces: `createUpdaterService(dependencies)` retornando `{ init, check, download, install, dispose, isSupported }`.
- Produces: `createProductionUpdater(options)`, a única função que carrega `electron-updater` e o injeta no serviço.
- Produces: eventos `{ type: 'unsupported' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error', ... }`.
- Produces: operações com retorno `{ success: true }` ou `{ success: false, code: 'unsupported' | 'busy' | 'error', error: string }`.

- [ ] **Step 1: Write failing service tests with injected fakes**

Create a fake updater based on `EventEmitter`, a logger that records `info`/`error`, and fake timer functions. Cover these exact cases:

```js
test('desabilita atualização fora do Windows empacotado', () => {
  const harness = createHarness({ isPackaged: false, platform: 'darwin' });
  harness.service.init();

  assert.equal(harness.service.isSupported(), false);
  assert.deepEqual(harness.events, [{
    type: 'unsupported',
    message: 'Atualização automática disponível somente no aplicativo Windows instalado.',
  }]);
  assert.equal(harness.timeoutCalls.length, 0);
});

test('configura updater e agenda verificações sem duplicar init', () => {
  const harness = createHarness();
  harness.service.init();
  harness.service.init();

  assert.equal(harness.updater.autoDownload, false);
  assert.equal(harness.updater.autoInstallOnAppQuit, true);
  assert.equal(harness.timeoutCalls[0].delay, 5000);
  assert.equal(harness.updater.listenerCount('update-available'), 1);
});

test('traduz eventos e normaliza progresso', () => {
  const harness = createHarness();
  harness.service.init();
  harness.updater.emit('checking-for-update');
  harness.updater.emit('update-not-available');
  harness.updater.emit('update-available', { version: '3.0.2' });
  harness.updater.emit('download-progress', { percent: 105.4 });
  harness.updater.emit('update-downloaded', { version: '3.0.2' });

  assert.deepEqual(harness.events.slice(-5), [
    { type: 'checking' },
    { type: 'up-to-date' },
    { type: 'available', version: '3.0.2' },
    { type: 'downloading', percent: 100 },
    { type: 'downloaded', version: '3.0.2' },
  ]);
});

test('bloqueia duas operações simultâneas', async () => {
  const harness = createHarness({ pendingCheck: true });
  harness.service.init();
  const first = harness.service.check();
  const second = await harness.service.download();

  assert.deepEqual(second, {
    success: false,
    code: 'busy',
    error: 'Já existe uma operação de atualização em andamento.',
  });
  harness.resolveCheck();
  assert.deepEqual(await first, { success: true });
});
```

Also assert that `download()` calls `updater.downloadUpdate()`, `install()` calls `updater.quitAndInstall()`, network errors emit the friendly connection message, unexpected errors emit a generic safe message, and `dispose()` clears both timers and removes every updater listener installed by `init()`.

- [ ] **Step 2: Run the focused service tests and verify they fail**

Run: `node --test tests/updaterService.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `src/main/updater/updaterService.js`.

- [ ] **Step 3: Implement the updater service factory**

Use these exact constants and public contract:

```js
const INITIAL_CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
const UNSUPPORTED_MESSAGE = 'Atualização automática disponível somente no aplicativo Windows instalado.';
const BUSY_MESSAGE = 'Já existe uma operação de atualização em andamento.';

function formatUpdaterError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.';
  }
  return 'Não foi possível concluir a atualização. Tente novamente mais tarde.';
}

function createUpdaterService({
  updater,
  logger,
  isPackaged,
  platform,
  sendEvent,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let initialized = false;
  let operation = null;
  let initialTimer = null;
  let checkInterval = null;
  const listeners = [];
  const supported = isPackaged === true && platform === 'win32';

  function emit(payload) {
    sendEvent(payload);
  }

  function addListener(eventName, handler) {
    updater.on(eventName, handler);
    listeners.push([eventName, handler]);
  }

  async function runOperation(name, action) {
    if (!supported) return { success: false, code: 'unsupported', error: UNSUPPORTED_MESSAGE };
    if (operation) return { success: false, code: 'busy', error: BUSY_MESSAGE };
    operation = name;
    try {
      await action();
      return { success: true };
    } catch (error) {
      logger.error(`[updater] Falha em ${name}`, { error });
      const safeMessage = formatUpdaterError(error);
      emit({ type: 'error', message: safeMessage });
      return { success: false, code: 'error', error: safeMessage };
    } finally {
      operation = null;
    }
  }
```

`init()` must emit `unsupported` and return on unsupported platforms. On Windows packaged, set the two updater flags, attach handlers for `checking-for-update`, `update-not-available`, `update-available`, `download-progress`, `update-downloaded`, and `error`, then schedule `check()` after 5 seconds. That timeout creates the four-hour interval after the initial call. Clamp progress with `Math.max(0, Math.min(100, Math.round(progress.percent || 0)))`.

Expose these operations:

```js
return {
  init,
  check: () => runOperation('verificação', () => updater.checkForUpdates()),
  download: () => runOperation('download', () => updater.downloadUpdate()),
  install() {
    if (!supported) return { success: false, code: 'unsupported', error: UNSUPPORTED_MESSAGE };
    if (operation) return { success: false, code: 'busy', error: BUSY_MESSAGE };
    logger.info('[updater] Reiniciando para instalar atualização');
    updater.quitAndInstall();
    return { success: true };
  },
  dispose,
  isSupported: () => supported,
};
```

`dispose()` clears `initialTimer`, clears `checkInterval`, removes the stored listeners with `updater.removeListener`, empties the listener list, and resets `initialized` and `operation`.

Keep the production dependency inside this updater module so `src/main/index.js` never imports `electron-updater` directly:

```js
function createProductionUpdater({ logger, isPackaged, platform, sendEvent }) {
  const { autoUpdater } = require('electron-updater');
  return createUpdaterService({
    updater: autoUpdater,
    logger,
    isPackaged,
    platform,
    sendEvent,
  });
}
```

Export `createUpdaterService`, `createProductionUpdater`, `formatUpdaterError`, `INITIAL_CHECK_DELAY_MS`, `CHECK_INTERVAL_MS`, `UNSUPPORTED_MESSAGE`, and `BUSY_MESSAGE`.

- [ ] **Step 4: Run focused and complete tests**

Run: `node --test tests/updaterService.test.js`

Expected: all updater service tests PASS.

Run: `pnpm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit the service and its tests**

```bash
git add src/main/updater/updaterService.js tests/updaterService.test.js
git commit -m "feat: add isolated Windows updater service"
```

---

### Task 3: IPC e integração com o ciclo de vida do Electron

**Files:**
- Create: `src/main/updater/updaterIpc.js`
- Create: `tests/updaterIpc.test.js`
- Modify: `src/main/index.js:1-168`

**Interfaces:**
- Consumes: serviço da Task 2 e `app`, `ipcMain`, `logger` do processo principal.
- Produces: canais `app:version`, `updater:check`, `updater:download`, `updater:install`, `updater:event`.
- Produces: `registerUpdaterIpc({ ipcMain, app, service })` retornando uma função de cleanup.

- [ ] **Step 1: Write failing IPC tests**

Use a fake `ipcMain` with a `Map` of handlers:

```js
test('registra versão e operações do updater', async () => {
  const harness = createHarness();
  const cleanup = registerUpdaterIpc(harness.dependencies);

  assert.equal(await harness.invoke('app:version'), '3.0.1');
  assert.deepEqual(await harness.invoke('updater:check'), { success: true });
  assert.deepEqual(await harness.invoke('updater:download'), { success: true });
  assert.deepEqual(await harness.invoke('updater:install'), { success: true });
  assert.deepEqual(harness.calls, ['check', 'download', 'install']);

  cleanup();
  assert.deepEqual([...harness.handlers.keys()], []);
});

test('não registra os mesmos handlers duas vezes', () => {
  const harness = createHarness();
  registerUpdaterIpc(harness.dependencies);
  assert.throws(
    () => registerUpdaterIpc(harness.dependencies),
    /IPC do updater já registrado/,
  );
});
```

- [ ] **Step 2: Run the IPC test and verify it fails**

Run: `node --test tests/updaterIpc.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `src/main/updater/updaterIpc.js`.

- [ ] **Step 3: Implement exact IPC registration and cleanup**

```js
const CHANNELS = Object.freeze({
  version: 'app:version',
  check: 'updater:check',
  download: 'updater:download',
  install: 'updater:install',
  event: 'updater:event',
});

const registeredIpcMains = new WeakSet();

function registerUpdaterIpc({ ipcMain, app, service }) {
  if (registeredIpcMains.has(ipcMain)) throw new Error('IPC do updater já registrado');
  registeredIpcMains.add(ipcMain);

  ipcMain.handle(CHANNELS.version, () => app.getVersion());
  ipcMain.handle(CHANNELS.check, () => service.check());
  ipcMain.handle(CHANNELS.download, () => service.download());
  ipcMain.handle(CHANNELS.install, () => service.install());

  return () => {
    for (const channel of [CHANNELS.version, CHANNELS.check, CHANNELS.download, CHANNELS.install]) {
      ipcMain.removeHandler(channel);
    }
    registeredIpcMains.delete(ipcMain);
  };
}

module.exports = { CHANNELS, registerUpdaterIpc };
```

- [ ] **Step 4: Wire the service into `src/main/index.js`**

Add imports:

```js
const { createProductionUpdater } = require('./updater/updaterService');
const { CHANNELS, registerUpdaterIpc } = require('./updater/updaterIpc');
```

Add lifecycle state beside `mainWindow` and `tray`:

```js
let updaterService = null;
let cleanupUpdaterIpc = null;
let isQuitting = false;
```

Update the current window close handler so a normal click still hides the app, while `quitAndInstall()` can close the window after `before-quit` begins:

```js
mainWindow.on('close', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  mainWindow.hide();
});
```

After `criarJanela()` and `criarTray()` inside `app.whenReady()`, create and initialize the service:

```js
updaterService = createProductionUpdater({
  logger,
  isPackaged: app.isPackaged,
  platform: process.platform,
  sendEvent: (payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(CHANNELS.event, payload);
  },
});
cleanupUpdaterIpc = registerUpdaterIpc({ ipcMain, app, service: updaterService });
updaterService.init();
```

At the beginning of `before-quit`, dispose synchronously before the existing worker/browser cleanup:

```js
isQuitting = true;
updaterService?.dispose();
cleanupUpdaterIpc?.();
cleanupUpdaterIpc = null;
```

- [ ] **Step 5: Verify IPC tests and main-process syntax**

Run: `node --test tests/updaterIpc.test.js`

Expected: PASS.

Run: `node --check src/main/updater/updaterIpc.js && node --check src/main/index.js`

Expected: both files exit with status 0 and no output.

Run: `pnpm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit IPC and lifecycle integration**

```bash
git add src/main/updater/updaterIpc.js tests/updaterIpc.test.js src/main/index.js
git commit -m "feat: connect updater to Electron lifecycle"
```

---

### Task 4: API segura no preload

**Files:**
- Modify: `src/preload/index.js:1-22`
- Create: `tests/preload.test.js`

**Interfaces:**
- Consumes: os cinco canais definidos na Task 3.
- Produces: `createCodontoApi(ipcRenderer)` e as funções `obterVersao`, `verificarAtualizacao`, `baixarAtualizacao`, `instalarAtualizacao`, `onAtualizacao` em `window.codonto`.

- [ ] **Step 1: Write failing preload bridge tests**

```js
test('encaminha operações do updater aos canais corretos', async () => {
  const ipc = createFakeIpcRenderer();
  const api = createCodontoApi(ipc);

  await api.obterVersao();
  await api.verificarAtualizacao();
  await api.baixarAtualizacao();
  await api.instalarAtualizacao();

  assert.deepEqual(ipc.invocations, [
    ['app:version'],
    ['updater:check'],
    ['updater:download'],
    ['updater:install'],
  ]);
});

test('assina eventos sem expor o evento Electron e remove o listener', () => {
  const ipc = createFakeIpcRenderer();
  const api = createCodontoApi(ipc);
  const received = [];
  const unsubscribe = api.onAtualizacao((payload) => received.push(payload));

  ipc.emit('updater:event', { sender: 'interno' }, { type: 'available', version: '3.0.2' });
  assert.deepEqual(received, [{ type: 'available', version: '3.0.2' }]);

  unsubscribe();
  assert.equal(ipc.listenerCount('updater:event'), 0);
});
```

- [ ] **Step 2: Run the preload tests and verify exports are missing**

Run: `node --test tests/preload.test.js`

Expected: FAIL because `createCodontoApi` is not exported.

- [ ] **Step 3: Refactor preload construction without changing existing names**

Wrap the existing object in `createCodontoApi(ipcRenderer)` and preserve every current agent/config/log method unchanged. Add these exact members:

```js
obterVersao: () => ipcRenderer.invoke('app:version'),
verificarAtualizacao: () => ipcRenderer.invoke('updater:check'),
baixarAtualizacao: () => ipcRenderer.invoke('updater:download'),
instalarAtualizacao: () => ipcRenderer.invoke('updater:install'),
onAtualizacao: (callback) => {
  const listener = (_, payload) => callback(payload);
  ipcRenderer.on('updater:event', listener);
  return () => ipcRenderer.removeListener('updater:event', listener);
},
```

Only load Electron and expose the bridge in the preload renderer process, while allowing Node tests to import the factory:

```js
if (process.type === 'renderer') {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('codonto', createCodontoApi(ipcRenderer));
}

module.exports = { createCodontoApi };
```

- [ ] **Step 4: Run preload and complete tests**

Run: `node --test tests/preload.test.js`

Expected: both preload tests PASS.

Run: `node --check src/preload/index.js && pnpm test`

Expected: syntax check and all tests PASS.

- [ ] **Step 5: Commit preload API and tests**

```bash
git add src/preload/index.js tests/preload.test.js
git commit -m "feat: expose updater API through preload"
```

---

### Task 5: Versão, botão e aviso na tela inicial

**Files:**
- Create: `src/renderer/updaterUi.js`
- Modify: `src/renderer/index.html:1-413`
- Create: `tests/updaterUi.test.js`

**Interfaces:**
- Consumes: API da Task 4 e eventos do serviço da Task 2.
- Produces: `createUpdaterController({ api, elements, scheduleHide })` retornando `{ init, handleEvent, destroy }`.
- Produces: elementos `app-version`, `btn-update-check`, `update-banner`, `update-message`, `update-progress`, `update-progress-bar`, `btn-update-download`, `btn-update-install`.

- [ ] **Step 1: Write failing controller tests with fake elements**

Build fake buttons that store click listeners and fake elements with `hidden`, `disabled`, `textContent`, `className`, and `style.width`. Cover the exact flow:

```js
test('carrega versão e permite verificar atualização', async () => {
  const harness = createHarness();
  await harness.controller.init();

  assert.equal(harness.elements.version.textContent, 'Versão 3.0.1');
  await harness.elements.checkButton.click();
  assert.equal(harness.calls.check, 1);
});

test('oferece download, mostra progresso e permite reiniciar', async () => {
  const harness = createHarness();
  await harness.controller.init();

  harness.emit({ type: 'available', version: '3.0.2' });
  assert.equal(harness.elements.message.textContent, 'Versão 3.0.2 disponível.');
  assert.equal(harness.elements.downloadButton.hidden, false);
  await harness.elements.downloadButton.click();
  assert.equal(harness.calls.download, 1);

  harness.emit({ type: 'downloading', percent: 47 });
  assert.equal(harness.elements.progress.hidden, false);
  assert.equal(harness.elements.progressBar.style.width, '47%');
  assert.equal(harness.elements.message.textContent, 'Baixando atualização… 47%');

  harness.emit({ type: 'downloaded', version: '3.0.2' });
  assert.equal(harness.elements.installButton.hidden, false);
  await harness.elements.installButton.click();
  assert.equal(harness.calls.install, 1);
});

test('mostra indisponibilidade e erro sem travar o botão', async () => {
  const harness = createHarness();
  await harness.controller.init();
  harness.emit({ type: 'unsupported', message: 'Atualização automática disponível somente no aplicativo Windows instalado.' });
  assert.equal(harness.elements.message.textContent, 'Atualização automática disponível somente no aplicativo Windows instalado.');
  assert.equal(harness.elements.checkButton.disabled, false);

  harness.emit({ type: 'error', message: 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.' });
  assert.equal(harness.elements.message.textContent, 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.');
  assert.equal(harness.elements.checkButton.disabled, false);
});
```

Also assert `checking` disables the check button, `up-to-date` shows a brief confirmation through `scheduleHide`, failed API results are rendered as `error`, and `destroy()` calls the unsubscribe function returned by `onAtualizacao`.

- [ ] **Step 2: Run the controller tests and verify the module is missing**

Run: `node --test tests/updaterUi.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `src/renderer/updaterUi.js`.

- [ ] **Step 3: Implement the renderer controller as a dual browser/CommonJS module**

Use an IIFE that assigns `{ createUpdaterController }` to `window.CodontoUpdaterUi` in the browser and to `module.exports` in Node tests. `init()` must register button listeners, call `api.onAtualizacao(handleEvent)`, load `api.obterVersao()`, and render `Versão ${version}`.

Use one reset helper before every render:

```js
function resetActions(elements) {
  elements.downloadButton.hidden = true;
  elements.installButton.hidden = true;
  elements.progress.hidden = true;
  elements.checkButton.disabled = false;
}
```

Map events exactly:

```js
const eventMessages = {
  checking: 'Verificando atualizações…',
  'up-to-date': 'Você já está usando a versão mais recente.',
};
```

- `available`: `Versão ${event.version} disponível.` and show the download button.
- `downloading`: `Baixando atualização… ${event.percent}%`, show progress, set width.
- `downloaded`: `Versão ${event.version} pronta para instalar.` and show install button.
- `unsupported` and `error`: show `event.message` and leave check enabled.

If any action returns `{ success: false, error }`, pass `{ type: 'error', message: error }` to `handleEvent`. `destroy()` removes all three button listeners and invokes the updater unsubscribe callback once.

- [ ] **Step 4: Add header controls and update banner markup/CSS**

Inside `.header`, add a right-aligned action group:

```html
<div class="header-update">
  <span id="app-version" class="app-version">Versão —</span>
  <button type="button" id="btn-update-check" class="btn-sm">Atualizar versão</button>
</div>
```

Immediately below the header, add:

```html
<div id="update-banner" class="update-banner" hidden>
  <span id="update-message" class="update-message"></span>
  <div id="update-progress" class="update-progress" hidden>
    <div id="update-progress-bar" class="update-progress-bar"></div>
  </div>
  <div class="update-actions">
    <button type="button" id="btn-update-download" class="btn-sm" hidden>Atualizar</button>
    <button type="button" id="btn-update-install" class="btn-sm btn-update-install" hidden>Reiniciar agora</button>
  </div>
</div>
```

Add `margin-left: auto` to `.header-update`, keep the 480 px window readable with wrapped actions, style the banner with the existing slate palette, use green for `.btn-update-install`, and animate only the progress width. Load `<script src="./updaterUi.js"></script>` before the current inline script.

At the end of the inline initialization, create the controller with the exact element mapping and call `await updaterController.init()`:

```js
const updaterController = window.CodontoUpdaterUi.createUpdaterController({
  api: window.codonto,
  elements: {
    version: document.getElementById('app-version'),
    checkButton: document.getElementById('btn-update-check'),
    banner: document.getElementById('update-banner'),
    message: document.getElementById('update-message'),
    progress: document.getElementById('update-progress'),
    progressBar: document.getElementById('update-progress-bar'),
    downloadButton: document.getElementById('btn-update-download'),
    installButton: document.getElementById('btn-update-install'),
  },
});
await updaterController.init();
```

- [ ] **Step 5: Run UI, syntax, and complete tests**

Run: `node --test tests/updaterUi.test.js`

Expected: all controller tests PASS.

Run: `node --check src/renderer/updaterUi.js && pnpm test`

Expected: syntax check and all tests PASS.

Run: `pnpm run dev`

Expected: the Electron window shows `Versão 3.0.1` and **Atualizar versão** in the top-right; clicking it on macOS displays the Windows-only message; agent status, filters, cards, feed, logs button, and tray remain functional. Stop this verification process cleanly after inspection.

- [ ] **Step 6: Commit renderer UI and tests**

```bash
git add src/renderer/updaterUi.js src/renderer/index.html tests/updaterUi.test.js
git commit -m "feat: add version and update controls"
```

---

### Task 6: Workflow de release, documentação e verificação integrada

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `README.md`
- Create: `tests/releaseWorkflow.test.js`

**Interfaces:**
- Consumes: `pnpm-lock.yaml`, `pnpm test`, `release:win` e configuração GitHub da Task 1.
- Produces: GitHub Release com instalador NSIS, `latest.yml` e blockmap em cada tag `v*`.

- [ ] **Step 1: Write the failing workflow contract test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release por tag usa Windows, pnpm, testes e GITHUB_TOKEN', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '../.github/workflows/release.yml'),
    'utf8',
  );

  for (const required of [
    "tags:\n      - 'v*'",
    'contents: write',
    'runs-on: windows-latest',
    'version: 10.19.0',
    'pnpm install --frozen-lockfile',
    'pnpm exec playwright install chromium',
    'pnpm test',
    'GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    'pnpm run release:win',
  ]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
```

- [ ] **Step 2: Run the workflow test and verify the file is absent**

Run: `node --test tests/releaseWorkflow.test.js`

Expected: FAIL with `ENOENT` for `.github/workflows/release.yml`.

- [ ] **Step 3: Create the exact release workflow**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.19.0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright Chromium
        run: pnpm exec playwright install chromium

      - name: Run tests
        run: pnpm test

      - name: Build and publish Windows installer
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm run release:win
```

- [ ] **Step 4: Update README for pnpm and releases**

Replace npm setup/start/build commands with `pnpm install`, `pnpm exec playwright install chromium`, `pnpm run dev`, and `pnpm run build`. Add an **Atualizações** section documenting:

```bash
pnpm version patch
git push origin main
git push origin v3.0.2
```

Explain that the tag must match `package.json`, the workflow publishes the Windows installer automatically, the first updater-capable installer is `3.0.1`, and a later version such as `3.0.2` is required for an end-to-end update test. State that pushing a tag is a separate release action and is not part of ordinary development.

- [ ] **Step 5: Run workflow and complete verification**

Run: `node --test tests/releaseWorkflow.test.js`

Expected: PASS.

Run: `pnpm test`

Expected: all package, updater service, IPC, preload, renderer, workflow, and selector tests PASS.

Run:

```bash
node --check src/main/updater/updaterService.js
node --check src/main/updater/updaterIpc.js
node --check src/main/index.js
node --check src/preload/index.js
node --check src/renderer/updaterUi.js
git diff --check
```

Expected: every command exits with status 0 and no diagnostics.

Run: `pnpm exec electron-builder --win --x64 --dir`

Expected: the unpacked Windows application is generated without publishing a release. If macOS lacks a Windows build prerequisite, record the exact builder error and rely on the configured `windows-latest` workflow for the installer build; do not create a tag as a workaround.

- [ ] **Step 6: Commit workflow and documentation**

```bash
git add .github/workflows/release.yml README.md tests/releaseWorkflow.test.js
git commit -m "ci: publish Windows releases from tags"
```

- [ ] **Step 7: Review final scope and repository state**

Run: `git status --short && git log --oneline -7`

Expected: only the preexisting selector changes remain outside the updater commits; the six updater commits are ordered by package config, service, lifecycle, preload, UI, and release workflow. No tag or GitHub Release exists yet.
