const test = require('node:test');
const assert = require('node:assert/strict');

const { AGENT_CHANNELS, registerAgentIpc } = require('../src/main/agentIpc');

function createHarness() {
  const handlers = new Map();
  const calls = [];
  const stateChanges = [];
  const agentState = {
    rodando: false,
    aguardandoLogin: false,
    configuracaoNecessaria: true,
  };
  const tokenState = {
    configurado: false,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
  };
  const dependencies = {
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
    },
    service: {
      iniciar: () => {
        calls.push(['iniciar']);
        return { ...agentState };
      },
      parar: () => {
        calls.push(['parar']);
        return { ...agentState };
      },
      status: () => ({ ...agentState }),
      obterEstadoToken: () => ({ ...tokenState }),
      salvarToken: (token) => {
        calls.push(['salvarToken', token]);
        return {
          configurado: true,
          fixoViaEnv: false,
          disponivelParaSalvar: true,
          rodando: true,
          aguardandoLogin: false,
          configuracaoNecessaria: false,
        };
      },
    },
    onStateChanged: (state) => stateChanges.push(state),
  };

  return {
    dependencies,
    handlers,
    calls,
    stateChanges,
    invoke: (channel, ...args) => handlers.get(channel)({}, ...args),
  };
}

test('registra controle do agente e configuração segura do token', async () => {
  const harness = createHarness();
  const cleanup = registerAgentIpc(harness.dependencies);

  assert.deepEqual(await harness.invoke(AGENT_CHANNELS.status), {
    rodando: false,
    aguardandoLogin: false,
    configuracaoNecessaria: true,
  });
  assert.deepEqual(await harness.invoke(AGENT_CHANNELS.tokenState), {
    configurado: false,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
  });
  assert.deepEqual(await harness.invoke(AGENT_CHANNELS.tokenSave, 'segredo'), {
    configurado: true,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
    rodando: true,
    aguardandoLogin: false,
    configuracaoNecessaria: false,
  });
  await harness.invoke(AGENT_CHANNELS.start);
  await harness.invoke(AGENT_CHANNELS.stop);

  assert.deepEqual(harness.calls, [
    ['salvarToken', 'segredo'],
    ['iniciar'],
    ['parar'],
  ]);
  assert.equal(JSON.stringify(harness.stateChanges).includes('segredo'), false);

  cleanup();
  assert.deepEqual([...harness.handlers.keys()], []);
});

test('publica mudanças depois de salvar, iniciar e parar', async () => {
  const harness = createHarness();
  registerAgentIpc(harness.dependencies);

  await harness.invoke(AGENT_CHANNELS.tokenSave, 'segredo');
  await harness.invoke(AGENT_CHANNELS.start);
  await harness.invoke(AGENT_CHANNELS.stop);

  assert.equal(harness.stateChanges.length, 3);
  assert.equal(harness.stateChanges[0].configurado, true);
  assert.equal(Object.hasOwn(harness.stateChanges[0], 'token'), false);
});

test('impede registro duplicado no mesmo ipcMain', () => {
  const harness = createHarness();
  registerAgentIpc(harness.dependencies);

  assert.throws(
    () => registerAgentIpc(harness.dependencies),
    /IPC do agente já registrado/,
  );
});
