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

module.exports = { AutomationError, LOGIN_REQUIRED_MESSAGE };
