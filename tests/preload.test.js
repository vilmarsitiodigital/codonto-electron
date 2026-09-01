const test = require('node:test');
const assert = require('node:assert/strict');

const { createCodontoApi } = require('../src/preload/index.js');

function createFakeIpcRenderer() {
  const listeners = new Map();
  const ipc = {
    invocations: [],
    invoke(channel, ...args) {
      ipc.invocations.push([channel, ...args]);
      return Promise.resolve();
    },
    on(channel, listener) {
      const channelListeners = listeners.get(channel) || [];
      channelListeners.push(listener);
      listeners.set(channel, channelListeners);
      return ipc;
    },
    removeListener(channel, listener) {
      const channelListeners = listeners.get(channel) || [];
      listeners.set(channel, channelListeners.filter((candidate) => candidate !== listener));
      return ipc;
    },
    emit(channel, ...args) {
      for (const listener of listeners.get(channel) || []) listener(...args);
    },
    listenerCount(channel) {
      return (listeners.get(channel) || []).length;
    },
  };
  return ipc;
}

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

test('expõe somente estado e salvamento do token pelos canais seguros', async () => {
  const ipc = createFakeIpcRenderer();
  const api = createCodontoApi(ipc);

  await api.obterEstadoToken();
  await api.salvarToken('segredo');

  assert.deepEqual(ipc.invocations, [
    ['config:obterAgentToken'],
    ['config:salvarAgentToken', 'segredo'],
  ]);
  assert.equal(Object.hasOwn(api, 'obterToken'), false);
});
