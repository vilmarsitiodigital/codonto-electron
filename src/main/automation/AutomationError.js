class AutomationError extends Error {
  constructor(message, { code, etapa } = {}) {
    super(message);
    this.name = 'AutomationError';
    this.code = code || 'AUTOMATION_ERROR';
    this.etapa = etapa || null;
  }
}

const LOGIN_REQUIRED_MESSAGE =
  'Você precisa estar logado no sistema antes de iniciar esta automação.\n\n' +
  'Abra o sistema, faça login normalmente (inclusive 2FA, se necessário) e execute novamente.';

const BROWSER_BUSY_MESSAGE =
  'Não foi possível abrir o navegador do Codonto — o perfil já está em uso.\n\n' +
  'Feche todas as janelas do Codonto Sync (bandeja → Sair), encerre processos chrome.exe do Playwright ' +
  'no Gerenciador de Tarefas e abra o app novamente.\n\n' +
  'Se persistir, apague a pasta browser-profile em %APPDATA%\\codonto-sync\\ e faça login de novo.';

module.exports = { AutomationError, LOGIN_REQUIRED_MESSAGE, BROWSER_BUSY_MESSAGE };
