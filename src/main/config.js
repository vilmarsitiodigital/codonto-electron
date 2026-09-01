const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function hojeLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function salvarConfig(partial) {
  const cfg = { ...lerConfig(), ...partial };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  return cfg;
}

function getTarefasDesde() {
  if (process.env.TAREFAS_DESDE) {
    return process.env.TAREFAS_DESDE;
  }
  const cfg = lerConfig();
  return cfg.tarefasDesde || hojeLocal();
}

function setTarefasDesde(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error('Data inválida — use YYYY-MM-DD');
  }
  salvarConfig({ tarefasDesde: data });
}

const POLL_INTERVAL_MIN = 5;
const POLL_INTERVAL_MAX = 300;
const POLL_INTERVAL_DEFAULT = 15;

function getPollInterval() {
  if (process.env.POLL_INTERVAL) {
    return parseInt(process.env.POLL_INTERVAL, 10);
  }
  const cfg = lerConfig();
  return cfg.pollInterval || POLL_INTERVAL_DEFAULT;
}

function setPollInterval(segundos) {
  const n = parseInt(segundos, 10);
  if (Number.isNaN(n) || n < POLL_INTERVAL_MIN || n > POLL_INTERVAL_MAX) {
    throw new Error(`Intervalo inválido — use entre ${POLL_INTERVAL_MIN} e ${POLL_INTERVAL_MAX} segundos`);
  }
  salvarConfig({ pollInterval: n });
}

module.exports = {
  lerConfig,
  salvarConfig,
  getTarefasDesde,
  setTarefasDesde,
  hojeLocal,
  getPollInterval,
  setPollInterval,
  POLL_INTERVAL_MIN,
  POLL_INTERVAL_MAX,
  POLL_INTERVAL_DEFAULT,
};
