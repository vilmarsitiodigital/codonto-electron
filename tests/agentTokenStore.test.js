const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgentTokenStore } = require('../src/main/agentTokenStore');

function createFixture({
  envToken,
  encryptionAvailable = true,
  initialConfig = {},
  decryptError = null,
} = {}) {
  let config = { ...initialConfig };
  const savedConfigs = [];

  const safeStorage = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (buffer) => {
      if (decryptError) throw decryptError;
      return buffer.toString('utf8').replace(/^encrypted:/, '');
    },
  };

  return {
    store: createAgentTokenStore({
      env: { AGENT_TOKEN: envToken },
      safeStorage,
      readConfig: () => ({ ...config }),
      saveConfig: (partial) => {
        config = { ...config, ...partial };
        savedConfigs.push({ ...config });
        return { ...config };
      },
    }),
    get config() {
      return config;
    },
    savedConfigs,
  };
}

test('prioriza AGENT_TOKEN do ambiente e bloqueia a substituição pela interface', () => {
  const fixture = createFixture({ envToken: '  token-do-ambiente  ' });

  assert.equal(fixture.store.getToken(), 'token-do-ambiente');
  assert.deepEqual(fixture.store.getState(), {
    configurado: true,
    fixoViaEnv: true,
    disponivelParaSalvar: false,
  });
  assert.throws(
    () => fixture.store.saveToken('outro-token'),
    /AGENT_TOKEN está definido no ambiente/,
  );
  assert.equal(fixture.savedConfigs.length, 0);
});

test('criptografa o token antes de persistir e recupera o valor salvo', () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.store.saveToken('  segredo  '), {
    configurado: true,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
  });

  assert.equal(
    fixture.config.agentTokenEncrypted,
    Buffer.from('encrypted:segredo', 'utf8').toString('base64'),
  );
  assert.equal(JSON.stringify(fixture.config).includes('segredo'), false);
  assert.equal(fixture.store.getToken(), 'segredo');
});

test('informa estado não configurado sem expor qualquer valor', () => {
  const fixture = createFixture();

  assert.equal(fixture.store.getToken(), null);
  assert.deepEqual(fixture.store.getState(), {
    configurado: false,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
  });
});

test('recusa token vazio', () => {
  const fixture = createFixture();

  assert.throws(() => fixture.store.saveToken('   '), /Informe o token do agente/);
  assert.equal(fixture.savedConfigs.length, 0);
});

test('recusa salvar ou ler token sem criptografia segura disponível', () => {
  const fixture = createFixture({
    encryptionAvailable: false,
    initialConfig: {
      agentTokenEncrypted: Buffer.from('encrypted:segredo', 'utf8').toString('base64'),
    },
  });

  assert.throws(() => fixture.store.saveToken('segredo'), /criptografia segura/);
  assert.throws(() => fixture.store.getToken(), /criptografia segura/);
  assert.deepEqual(fixture.store.getState(), {
    configurado: false,
    fixoViaEnv: false,
    disponivelParaSalvar: false,
    mensagem: 'A criptografia segura do sistema não está disponível.',
  });
});

test('permite substituir um token persistido sem devolver o valor no estado', () => {
  const fixture = createFixture();

  fixture.store.saveToken('primeiro');
  const state = fixture.store.saveToken('segundo');

  assert.equal(fixture.store.getToken(), 'segundo');
  assert.equal(Object.hasOwn(state, 'token'), false);
  assert.equal(Object.hasOwn(state, 'agentTokenEncrypted'), false);
});

test('trata token persistido ilegível como não configurado e permite substituição', () => {
  const fixture = createFixture({
    initialConfig: { agentTokenEncrypted: 'conteudo-corrompido' },
    decryptError: new Error('decrypt failed'),
  });

  assert.deepEqual(fixture.store.getState(), {
    configurado: false,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
    mensagem: 'O token salvo não pôde ser lido. Informe-o novamente.',
  });
});
