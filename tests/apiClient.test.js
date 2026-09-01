const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { createApiClient } = require('../src/main/apiClient');

function axiosWithAdapter(onRequest) {
  return {
    create(options) {
      return axios.create({
        ...options,
        adapter: async (config) => {
          onRequest(config);
          return {
            data: { resumo: [] },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
            request: {},
          };
        },
      });
    },
  };
}

test('consulta o token novamente antes de cada requisição', async () => {
  let token = 'primeiro';
  const authorizationHeaders = [];
  const client = createApiClient({
    axiosLib: axiosWithAdapter((config) => {
      authorizationHeaders.push(config.headers.get('Authorization'));
    }),
    baseURL: 'https://api.example.test',
    getAgentToken: () => token,
    logger: { info() {} },
  });

  await client.buscarStatus('2026-08-31');
  token = 'segundo';
  await client.buscarStatus('2026-08-31');

  assert.deepEqual(authorizationHeaders, ['Bearer primeiro', 'Bearer segundo']);
});

test('interrompe a requisição quando não há token configurado', async () => {
  let requestCount = 0;
  const client = createApiClient({
    axiosLib: axiosWithAdapter(() => {
      requestCount += 1;
    }),
    baseURL: 'https://api.example.test',
    getAgentToken: () => null,
    logger: { info() {} },
  });

  await assert.rejects(
    () => client.buscarStatus('2026-08-31'),
    /Token do agente não configurado/,
  );
  assert.equal(requestCount, 0);
});

test('preserva os endpoints e payloads públicos do cliente', async () => {
  const requests = [];
  const client = createApiClient({
    axiosLib: axiosWithAdapter((config) => requests.push({
      method: config.method,
      url: config.url,
      data: config.data ? JSON.parse(config.data) : undefined,
    })),
    baseURL: 'https://api.example.test',
    getAgentToken: () => 'token',
    logger: { info() {} },
  });

  await client.buscarTarefasPendentes('2026-08-31');
  await client.baixarFoto('tarefa-1');
  await client.verificarDuplicidade('tarefa-1');
  await client.atualizarTarefa('tarefa-1', 'erro', 'falhou');
  await client.buscarStatus('2026-08-31');
  await client.reprocessarSemFoto('2026-08-31');

  assert.deepEqual(requests, [
    { method: 'get', url: '/tarefas/pendentes', data: undefined },
    { method: 'get', url: '/tarefas/tarefa-1/foto', data: undefined },
    { method: 'get', url: '/tarefas/tarefa-1/duplicidade', data: undefined },
    {
      method: 'patch',
      url: '/tarefas/tarefa-1',
      data: { status: 'erro', erro_mensagem: 'falhou' },
    },
    { method: 'get', url: '/tarefas/status', data: undefined },
    { method: 'post', url: '/tarefas/reprocessar-sem-foto', data: {} },
  ]);
});
