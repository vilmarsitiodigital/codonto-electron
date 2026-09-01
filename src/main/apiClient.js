require('dotenv').config();
const axios = require('axios');
const logger = require('./logger');
const { getProductionAgentTokenStore } = require('./agentTokenStore');

function createApiClient({ axiosLib, baseURL, getAgentToken, logger: clientLogger }) {
  const api = axiosLib.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  api.interceptors.request.use((config) => {
    const token = getAgentToken();
    if (!token) throw new Error('Token do agente não configurado.');

    if (typeof config.headers?.set === 'function') {
      config.headers.set('Authorization', `Bearer ${token}`);
    } else {
      config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
    }
    return config;
  });

/**
 * Busca tarefas pendentes na API
 * GET /tarefas/pendentes?desde=YYYY-MM-DD
 */
  async function buscarTarefasPendentes(desde) {
    const { data } = await api.get('/tarefas/pendentes', {
      params: desde ? { desde } : {},
    });
    return data.tarefas || [];
  }

/**
 * Baixa a foto de uma tarefa em base64
 * GET /tarefas/:id/foto
 */
  async function baixarFoto(tarefaId) {
    const { data } = await api.get(`/tarefas/${tarefaId}/foto`);
    return data;
  }

/**
 * Verifica se a tarefa é duplicada de uma concluída hoje
 * GET /tarefas/:id/duplicidade
 */
  async function verificarDuplicidade(tarefaId) {
    const { data } = await api.get(`/tarefas/${tarefaId}/duplicidade`);
    return data;
  }

/**
 * Atualiza o status de uma tarefa
 * PATCH /tarefas/:id
 */
  async function atualizarTarefa(tarefaId, status, erroMensagem = null) {
    await api.patch(`/tarefas/${tarefaId}`, {
      status,
      erro_mensagem: erroMensagem,
    });
    clientLogger.info('Tarefa atualizada na API', { tarefaId, status });
  }

/**
 * Busca resumo de status a partir de uma data
 * GET /tarefas/status?desde=YYYY-MM-DD
 */
  async function buscarStatus(desde) {
    const { data } = await api.get('/tarefas/status', {
      params: desde ? { desde } : {},
    });
    return data.resumo || [];
  }

/**
 * Tenta recuperar fotos faltantes na Evolution
 * POST /tarefas/reprocessar-sem-foto?desde=YYYY-MM-DD
 */
  async function reprocessarSemFoto(desde) {
    const { data } = await api.post('/tarefas/reprocessar-sem-foto', {}, {
      params: desde ? { desde } : {},
    });
    return data;
  }

  return {
    buscarTarefasPendentes,
    baixarFoto,
    verificarDuplicidade,
    atualizarTarefa,
    buscarStatus,
    reprocessarSemFoto,
  };
}

const productionClient = createApiClient({
  axiosLib: axios,
  baseURL: process.env.API_URL,
  getAgentToken: () => getProductionAgentTokenStore().getToken(),
  logger,
});

module.exports = {
  ...productionClient,
  createApiClient,
};
