const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initUpdaterAfterRendererLoad } = require('../src/main/updater/updaterLifecycle');

test('inicia o updater somente depois que o renderer termina de carregar', () => {
  const webContents = new EventEmitter();
  const calls = [];
  const cleanup = initUpdaterAfterRendererLoad({
    webContents,
    service: { init: () => calls.push('init') },
  });

  assert.deepEqual(calls, []);
  assert.equal(webContents.listenerCount('did-finish-load'), 1);

  webContents.emit('did-finish-load');
  webContents.emit('did-finish-load');

  assert.deepEqual(calls, ['init']);
  assert.equal(webContents.listenerCount('did-finish-load'), 0);
  cleanup();
});

test('cancela a inicialização pendente ao encerrar antes do carregamento', () => {
  const webContents = new EventEmitter();
  const calls = [];
  const cleanup = initUpdaterAfterRendererLoad({
    webContents,
    service: { init: () => calls.push('init') },
  });

  cleanup();
  webContents.emit('did-finish-load');

  assert.deepEqual(calls, []);
  assert.equal(webContents.listenerCount('did-finish-load'), 0);
});
