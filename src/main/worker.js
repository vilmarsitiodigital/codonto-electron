require('dotenv').config();
const { buscarTarefasPendentes, baixarFoto, atualizarTarefa, reprocessarSemFoto } = require('./apiClient');
const {
  processarNoCodonto,
  verificarSessaoAtiva,
  garantirTelaLogin,
} = require('./codontoAutomation');
const { getTarefasDesde, getPollInterval } = require('./config');
const logger = require('./logger');

const LOGIN_WATCH_MS = 2000;

let rodando = false;
let timeoutId = null;
let loginWatchId = null;
let emProcessamento = false;
let aguardandoLogin = false;

// Callback para enviar eventos para a janela Electron (UI)
let onEventoCallback = null;

function onEvento(cb) {
  onEventoCallback = cb;
}

function emitir(tipo, dados = {}) {
  logger.info(`[evento] ${tipo}`, dados);
  if (onEventoCallback) onEventoCallback(tipo, dados);
}

function intervaloMs() {
  return getPollInterval() * 1000;
}

function cancelarAgendamento() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function pararVigiaLogin() {
  if (loginWatchId) {
    clearInterval(loginWatchId);
    loginWatchId = null;
  }
}

function agendarProximoTick() {
  cancelarAgendamento();
  if (!rodando || aguardandoLogin) return;
  timeoutId = setTimeout(() => void executarTick(), intervaloMs());
}

async function executarTick() {
  if (!rodando || aguardandoLogin) return;
  try {
    await tick();
  } finally {
    agendarProximoTick();
  }
}

function iniciarVigiaLogin() {
  if (loginWatchId || !rodando) return;

  aguardandoLogin = true;
  cancelarAgendamento();
  emitir('agente:aguardando_login');

  void garantirTelaLogin((passo) => emitir('tarefa:passo', { passo }));

  loginWatchId = setInterval(async () => {
    if (!rodando) {
      pararVigiaLogin();
      aguardandoLogin = false;
      return;
    }

    try {
      const logado = await verificarSessaoAtiva();
      if (!logado) return;

      logger.info('Login detectado — retomando polling');
      pararVigiaLogin();
      aguardandoLogin = false;
      emitir('agente:login_ok');
      void executarTick();
    } catch (err) {
      logger.warn('Erro ao verificar sessão do Codonto', { error: err.message });
    }
  }, LOGIN_WATCH_MS);
}

function atualizarIntervalo() {
  const segundos = getPollInterval();
  logger.info(`Intervalo de polling atualizado — ${segundos}s`);
  if (rodando && !emProcessamento && !aguardandoLogin) {
    agendarProximoTick();
  }
  return { segundos };
}

/**
 * Processa uma única tarefa do início ao fim.
 * @returns {'ok'|'login_required'|'erro'}
 */
async function processarTarefa(tarefa) {
  emitir('tarefa:iniciando', {
    id: tarefa.id,
    prontuario: tarefa.prontuario,
    restauracao: tarefa.restauracao,
    titulo_album: tarefa.titulo_album,
    nome_foto: tarefa.nome_foto,
    tipo_foto: tarefa.tipo_foto,
  });

  // Marca como "processando" para não ser pega por outro agente
  try {
    await atualizarTarefa(tarefa.id, 'processando');
  } catch (err) {
    logger.error('Falha ao marcar tarefa como processando', { id: tarefa.id, error: err.message });
    emitir('tarefa:erro', { id: tarefa.id, erro: err.message });
    return 'erro';
  }

  try {
    // Baixa a foto do backend
    emitir('tarefa:baixando_foto', { id: tarefa.id });
    const { base64, mimeType } = await baixarFoto(tarefa.id);

    // Executa a automação no Codonto
    emitir('tarefa:abrindo_codonto', { id: tarefa.id });
    const onPasso = (passo) => emitir('tarefa:passo', { id: tarefa.id, passo });
    const resultado = await processarNoCodonto(tarefa, base64, mimeType, onPasso);

    if (resultado.sucesso) {
      await atualizarTarefa(tarefa.id, 'concluida');
      emitir('tarefa:concluida', { id: tarefa.id, prontuario: tarefa.prontuario });
      return 'ok';
    }

    if (resultado.code === 'LOGIN_REQUIRED') {
      await atualizarTarefa(tarefa.id, 'pendente');
      emitir('tarefa:login_necessario', { id: tarefa.id, erro: resultado.erro });
      return 'login_required';
    }

    await atualizarTarefa(tarefa.id, 'erro', resultado.erro);
    emitir('tarefa:erro', {
      id: tarefa.id,
      erro: resultado.erro,
      etapa: resultado.etapa,
    });
    return 'erro';
  } catch (err) {
    logger.error('Erro inesperado ao processar tarefa', { id: tarefa.id, error: err.message });
    await atualizarTarefa(tarefa.id, 'erro', err.message).catch(() => {});
    emitir('tarefa:erro', { id: tarefa.id, erro: err.message });
    return 'erro';
  }
}

/**
 * Loop de polling — intervalo configurável via UI ou .env
 */
async function tick() {
  emProcessamento = true;
  try {
    const desde = getTarefasDesde();

    const reprocesso = await reprocessarSemFoto(desde);
    if (reprocesso.recuperadas > 0) {
      emitir('fotos:recuperadas', reprocesso);
    }

    const tarefas = await buscarTarefasPendentes(desde);

    if (tarefas.length === 0) {
      emitir('polling:vazio', { desde });
      return;
    }

    emitir('polling:encontradas', { quantidade: tarefas.length, desde });

    // Processa uma por vez (sequencial, mais seguro)
    for (const tarefa of tarefas) {
      if (!rodando) break;
      const status = await processarTarefa(tarefa);
      if (status === 'login_required') {
        iniciarVigiaLogin();
        break;
      }
    }
  } catch (err) {
    logger.error('Erro no polling', { error: err.message });
    emitir('polling:erro', { erro: err.message });
  } finally {
    emProcessamento = false;
  }
}

/**
 * Inicia o agente
 */
function iniciar() {
  if (rodando) return;
  rodando = true;
  logger.info(
    `Agente iniciado — próximo polling em até ${getPollInterval()}s após cada ciclo`
  );
  emitir('agente:iniciado');

  if (aguardandoLogin) {
    iniciarVigiaLogin();
  } else {
    void executarTick();
  }
}

/**
 * Para o agente
 */
function parar() {
  if (!rodando) return;
  rodando = false;
  aguardandoLogin = false;
  cancelarAgendamento();
  pararVigiaLogin();
  logger.info('Agente parado');
  emitir('agente:parado');
}

function estaRodando() {
  return rodando;
}

function estaProcessando() {
  return emProcessamento;
}

function estaAguardandoLogin() {
  return aguardandoLogin;
}

module.exports = {
  iniciar,
  parar,
  estaRodando,
  estaProcessando,
  estaAguardandoLogin,
  onEvento,
  atualizarIntervalo,
};
