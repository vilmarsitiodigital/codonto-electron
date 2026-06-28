require('dotenv').config();
const axios = require('axios');
const logger = require('./logger');

const api = axios.create({
  baseURL: process.env.API_URL,
  headers: {
    Authorization: `Bearer ${process.env.AGENT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
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
  return data; // { base64, mimeType }
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
  logger.info('Tarefa atualizada na API', { tarefaId, status });
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

module.exports = {
  buscarTarefasPendentes,
  baixarFoto,
  atualizarTarefa,
  buscarStatus,
  reprocessarSemFoto,
};
