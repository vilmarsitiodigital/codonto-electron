const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUpdaterService,
  UNSUPPORTED_MESSAGE,
} = require('../src/main/updater/updaterService');

function createHarness({
  isPackaged = true,
  platform = 'win32',
  pendingCheck = false,
  checkError = null,
  downloadError = null,
} = {}) {
  const updater = new EventEmitter();
  const events = [];
  const infoLogs = [];
  const errorLogs = [];
  const timeoutCalls = [];
  const intervalCalls = [];
  const clearedTimeouts = [];
  const clearedIntervals = [];
  let resolveCheck;

  updater.checkForUpdates = () => {
    if (checkError) return Promise.reject(checkError);
    if (pendingCheck) {
      return new Promise((resolve) => {
        resolveCheck = resolve;
      });
    }
    return Promise.resolve();
  };
  updater.downloadUpdate = () => {
    updater.downloadUpdateCalls = (updater.downloadUpdateCalls || 0) + 1;
    return downloadError ? Promise.reject(downloadError) : Promise.resolve();
  };
  updater.quitAndInstall = () => {
    updater.quitAndInstallCalls = (updater.quitAndInstallCalls || 0) + 1;
  };

  const service = createUpdaterService({
    updater,
    logger: {
      info: (...args) => infoLogs.push(args),
      error: (...args) => errorLogs.push(args),
    },
    isPackaged,
    platform,
    sendEvent: (event) => events.push(event),
    setTimeoutFn: (callback, delay) => {
      const id = { type: 'timeout', index: timeoutCalls.length };
      timeoutCalls.push({ id, callback, delay });
      return id;
    },
    clearTimeoutFn: (id) => clearedTimeouts.push(id),
    setIntervalFn: (callback, delay) => {
      const id = { type: 'interval', index: intervalCalls.length };
      intervalCalls.push({ id, callback, delay });
      return id;
    },
    clearIntervalFn: (id) => clearedIntervals.push(id),
  });

  return {
    service,
    updater,
    events,
    infoLogs,
    errorLogs,
    timeoutCalls,
    intervalCalls,
    clearedTimeouts,
    clearedIntervals,
    resolveCheck: () => resolveCheck(),
  };
}

test('desabilita atualização fora do Windows empacotado', async () => {
  const harness = createHarness({ isPackaged: false, platform: 'darwin' });
  harness.service.init();

  assert.equal(harness.service.isSupported(), false);
  assert.deepEqual(harness.events, [{
    type: 'unsupported',
    message: 'Atualização automática disponível somente no aplicativo Windows instalado.',
  }]);
  assert.equal(harness.timeoutCalls.length, 0);
  assert.deepEqual(await harness.service.check(), {
    success: false,
    code: 'unsupported',
    error: UNSUPPORTED_MESSAGE,
  });
});

test('configura updater e agenda verificações sem duplicar init', () => {
  const harness = createHarness();
  harness.service.init();
  harness.service.init();

  assert.equal(harness.updater.autoDownload, false);
  assert.equal(harness.updater.autoInstallOnAppQuit, true);
  assert.equal(harness.timeoutCalls[0].delay, 5000);
  assert.equal(harness.updater.listenerCount('update-available'), 1);
  assert.equal(harness.timeoutCalls.length, 1);
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

test('inicia o download e instala a atualização baixada', async () => {
  const harness = createHarness();
  harness.service.init();

  assert.deepEqual(await harness.service.download(), { success: true });
  assert.equal(harness.updater.downloadUpdateCalls, 1);
  assert.deepEqual(harness.service.install(), { success: true });
  assert.equal(harness.updater.quitAndInstallCalls, 1);
  assert.deepEqual(harness.infoLogs, [['[updater] Reiniciando para instalar atualização']]);
});

test('expõe um erro de conexão seguro', async () => {
  const harness = createHarness({ checkError: new Error('net::ERR_INTERNET_DISCONNECTED') });
  harness.service.init();

  assert.deepEqual(await harness.service.check(), {
    success: false,
    code: 'error',
    error: 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.',
  });
  assert.deepEqual(harness.events.at(-1), {
    type: 'error',
    message: 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.',
  });
  assert.equal(harness.errorLogs.length, 1);
});

test('expõe um erro inesperado seguro', async () => {
  const harness = createHarness({ downloadError: new Error('unexpected updater failure') });
  harness.service.init();

  assert.deepEqual(await harness.service.download(), {
    success: false,
    code: 'error',
    error: 'Não foi possível concluir a atualização. Tente novamente mais tarde.',
  });
  assert.deepEqual(harness.events.at(-1), {
    type: 'error',
    message: 'Não foi possível concluir a atualização. Tente novamente mais tarde.',
  });
});

test('limpa timers e listeners ao descartar o serviço', async () => {
  const harness = createHarness();
  harness.service.init();
  await harness.timeoutCalls[0].callback();
  const eventNames = [
    'checking-for-update',
    'update-not-available',
    'update-available',
    'download-progress',
    'update-downloaded',
    'error',
  ];

  harness.service.dispose();

  assert.deepEqual(harness.clearedTimeouts, [harness.timeoutCalls[0].id]);
  assert.deepEqual(harness.clearedIntervals, [harness.intervalCalls[0].id]);
  for (const eventName of eventNames) {
    assert.equal(harness.updater.listenerCount(eventName), 0);
  }
});

test('não agenda intervalo após descartar durante a verificação inicial', async () => {
  const harness = createHarness({ pendingCheck: true });
  harness.service.init();
  const initialCheck = harness.timeoutCalls[0].callback();

  harness.service.dispose();
  harness.resolveCheck();
  await initialCheck;

  assert.equal(harness.intervalCalls.length, 0);
});
