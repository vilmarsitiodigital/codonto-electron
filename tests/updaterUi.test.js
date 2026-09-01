const test = require('node:test');
const assert = require('node:assert/strict');

const { createUpdaterController } = require('../src/renderer/updaterUi.js');

function createButton() {
  const listeners = new Set();
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    className: '',
    style: { width: '' },
    addEventListener(type, listener) {
      if (type === 'click') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'click') listeners.delete(listener);
    },
    async click() {
      for (const listener of listeners) await listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function createElement() {
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    className: '',
    style: { width: '' },
  };
}

function createHarness({
  checkResult = { success: true },
  downloadResult = { success: true },
  installResult = { success: true },
} = {}) {
  const calls = { check: 0, download: 0, install: 0, unsubscribe: 0 };
  const scheduleHideCalls = [];
  let eventListener;
  const elements = {
    version: createElement(),
    checkButton: createButton(),
    banner: createElement(),
    message: createElement(),
    progress: createElement(),
    progressBar: createElement(),
    downloadButton: createButton(),
    installButton: createButton(),
  };
  const api = {
    obterVersao: async () => '3.0.1',
    verificarAtualizacao: async () => {
      calls.check += 1;
      return checkResult;
    },
    baixarAtualizacao: async () => {
      calls.download += 1;
      return downloadResult;
    },
    instalarAtualizacao: async () => {
      calls.install += 1;
      return installResult;
    },
    onAtualizacao: (listener) => {
      eventListener = listener;
      return () => { calls.unsubscribe += 1; };
    },
  };
  const controller = createUpdaterController({
    api,
    elements,
    scheduleHide: (callback, delay) => scheduleHideCalls.push({ callback, delay }),
  });

  return {
    controller,
    elements,
    calls,
    scheduleHideCalls,
    emit: (event) => eventListener(event),
  };
}

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

test('desabilita a verificação e oculta confirmação de versão atualizada', async () => {
  const harness = createHarness();
  await harness.controller.init();

  harness.emit({ type: 'checking' });
  assert.equal(harness.elements.checkButton.disabled, true);

  harness.emit({ type: 'up-to-date' });
  assert.equal(harness.elements.message.textContent, 'Você já está usando a versão mais recente.');
  assert.equal(harness.scheduleHideCalls.length, 1);
  assert.equal(harness.elements.banner.hidden, false);
  harness.scheduleHideCalls[0].callback();
  assert.equal(harness.elements.banner.hidden, true);
});

test('renderiza a falha retornada por uma ação', async () => {
  const harness = createHarness({
    checkResult: { success: false, error: 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.' },
  });
  await harness.controller.init();

  await harness.elements.checkButton.click();
  assert.equal(harness.elements.message.textContent, 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.');
  assert.equal(harness.elements.checkButton.disabled, false);
});

test('remove listeners e cancela a inscrição uma vez ao destruir', async () => {
  const harness = createHarness();
  await harness.controller.init();

  harness.controller.destroy();
  harness.controller.destroy();

  assert.equal(harness.elements.checkButton.listenerCount, 0);
  assert.equal(harness.elements.downloadButton.listenerCount, 0);
  assert.equal(harness.elements.installButton.listenerCount, 0);
  assert.equal(harness.calls.unsubscribe, 1);
});
