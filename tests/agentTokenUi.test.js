const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgentTokenController } = require('../src/renderer/agentTokenUi');

function createButton() {
  const listeners = new Set();
  return {
    disabled: false,
    textContent: '',
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
    value: '',
    disabled: false,
    textContent: '',
    hidden: false,
    placeholder: '',
  };
}

function createHarness({
  initialState = {
    configurado: false,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
  },
  saveResult = {
    configurado: true,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
    rodando: true,
    aguardandoLogin: false,
    configuracaoNecessaria: false,
  },
  saveError = null,
} = {}) {
  const calls = [];
  const agentStates = [];
  const elements = {
    input: createElement(),
    saveButton: createButton(),
    status: createElement(),
    message: createElement(),
  };
  const api = {
    obterEstadoToken: async () => {
      calls.push(['obterEstadoToken']);
      return initialState;
    },
    salvarToken: async (token) => {
      calls.push(['salvarToken', token]);
      if (saveError) throw saveError;
      return saveResult;
    },
  };
  const controller = createAgentTokenController({
    api,
    elements,
    onAgentState: (state) => agentStates.push(state),
  });

  return { controller, elements, calls, agentStates };
}

test('mostra token não configurado e permite informar um valor', async () => {
  const harness = createHarness();

  await harness.controller.init();

  assert.equal(harness.elements.status.textContent, 'Não configurado');
  assert.equal(harness.elements.input.disabled, false);
  assert.equal(harness.elements.saveButton.disabled, false);
  assert.equal(harness.elements.saveButton.textContent, 'Salvar token');
  assert.equal(harness.elements.input.value, '');
});

test('mostra token persistido sem devolver ou preencher o valor', async () => {
  const harness = createHarness({
    initialState: {
      configurado: true,
      fixoViaEnv: false,
      disponivelParaSalvar: true,
    },
  });

  await harness.controller.init();

  assert.equal(harness.elements.status.textContent, 'Configurado');
  assert.equal(harness.elements.input.value, '');
  assert.equal(harness.elements.input.placeholder, 'Digite para substituir o token salvo');
  assert.equal(harness.elements.saveButton.disabled, false);
});

test('bloqueia o formulário quando o token vem do ambiente', async () => {
  const harness = createHarness({
    initialState: {
      configurado: true,
      fixoViaEnv: true,
      disponivelParaSalvar: false,
    },
  });

  await harness.controller.init();

  assert.equal(harness.elements.status.textContent, 'Definido pelo ambiente');
  assert.equal(harness.elements.input.disabled, true);
  assert.equal(harness.elements.saveButton.disabled, true);
  assert.equal(harness.elements.input.placeholder, 'AGENT_TOKEN definido no .env');
});

test('limpa o campo e publica o estado do agente depois de salvar', async () => {
  const harness = createHarness();
  await harness.controller.init();
  harness.elements.input.value = 'novo-token';

  await harness.elements.saveButton.click();

  assert.deepEqual(harness.calls, [
    ['obterEstadoToken'],
    ['salvarToken', 'novo-token'],
  ]);
  assert.equal(harness.elements.input.value, '');
  assert.equal(harness.elements.status.textContent, 'Configurado');
  assert.deepEqual(harness.agentStates, [{
    rodando: true,
    aguardandoLogin: false,
    configuracaoNecessaria: false,
  }]);
});

test('valida campo vazio sem enviar uma operação IPC', async () => {
  const harness = createHarness();
  await harness.controller.init();
  harness.elements.input.value = '   ';

  await harness.elements.saveButton.click();

  assert.deepEqual(harness.calls, [['obterEstadoToken']]);
  assert.equal(harness.elements.message.textContent, 'Informe o token do agente.');
});

test('mostra erro seguro e restaura o formulário depois de falha', async () => {
  const harness = createHarness({ saveError: new Error('Não foi possível proteger o token.') });
  await harness.controller.init();
  harness.elements.input.value = 'segredo';

  await harness.elements.saveButton.click();

  assert.equal(harness.elements.message.textContent, 'Não foi possível proteger o token.');
  assert.equal(harness.elements.input.value, 'segredo');
  assert.equal(harness.elements.saveButton.disabled, false);
});

test('desabilita o formulário quando a criptografia do sistema não está disponível', async () => {
  const harness = createHarness({
    initialState: {
      configurado: false,
      fixoViaEnv: false,
      disponivelParaSalvar: false,
      mensagem: 'A criptografia segura do sistema não está disponível.',
    },
  });

  await harness.controller.init();

  assert.equal(harness.elements.status.textContent, 'Não configurado');
  assert.equal(harness.elements.input.disabled, true);
  assert.equal(harness.elements.saveButton.disabled, true);
  assert.equal(
    harness.elements.message.textContent,
    'A criptografia segura do sistema não está disponível.',
  );
});

test('remove o listener do botão ao destruir', async () => {
  const harness = createHarness();
  await harness.controller.init();

  harness.controller.destroy();
  harness.controller.destroy();

  assert.equal(harness.elements.saveButton.listenerCount, 0);
  assert.equal(harness.elements.saveButton.disabled, true);
});
