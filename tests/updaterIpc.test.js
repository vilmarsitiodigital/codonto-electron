const test = require('node:test');
const assert = require('node:assert/strict');
const { registerUpdaterIpc } = require('../src/main/updater/updaterIpc');

function createHarness() {
  const handlers = new Map();
  const calls = [];
  const dependencies = {
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    },
    app: {
      getVersion: () => '3.0.1',
    },
    service: {
      check: async () => {
        calls.push('check');
        return { success: true };
      },
      download: async () => {
        calls.push('download');
        return { success: true };
      },
      install: async () => {
        calls.push('install');
        return { success: true };
      },
    },
  };

  return {
    dependencies,
    handlers,
    calls,
    invoke: (channel) => handlers.get(channel)(),
  };
}

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
