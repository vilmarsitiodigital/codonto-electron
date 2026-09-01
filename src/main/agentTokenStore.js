const ENCRYPTION_UNAVAILABLE_MESSAGE = 'A criptografia segura do sistema não está disponível.';

function normalizeToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createAgentTokenStore({ env, safeStorage, readConfig, saveConfig }) {
  function environmentToken() {
    return normalizeToken(env.AGENT_TOKEN);
  }

  function ensureEncryptionAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(ENCRYPTION_UNAVAILABLE_MESSAGE);
    }
  }

  function getToken() {
    const tokenFromEnvironment = environmentToken();
    if (tokenFromEnvironment) return tokenFromEnvironment;

    const encrypted = readConfig().agentTokenEncrypted;
    if (!encrypted) return null;

    ensureEncryptionAvailable();
    return normalizeToken(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) || null;
  }

  function getState() {
    if (environmentToken()) {
      return {
        configurado: true,
        fixoViaEnv: true,
        disponivelParaSalvar: false,
      };
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return {
        configurado: false,
        fixoViaEnv: false,
        disponivelParaSalvar: false,
        mensagem: ENCRYPTION_UNAVAILABLE_MESSAGE,
      };
    }

    try {
      return {
        configurado: Boolean(getToken()),
        fixoViaEnv: false,
        disponivelParaSalvar: true,
      };
    } catch {
      return {
        configurado: false,
        fixoViaEnv: false,
        disponivelParaSalvar: true,
        mensagem: 'O token salvo não pôde ser lido. Informe-o novamente.',
      };
    }
  }

  function saveToken(value) {
    if (environmentToken()) {
      throw new Error('AGENT_TOKEN está definido no ambiente — altere por lá.');
    }

    const token = normalizeToken(value);
    if (!token) throw new Error('Informe o token do agente.');

    ensureEncryptionAvailable();
    const encrypted = safeStorage.encryptString(token).toString('base64');
    saveConfig({ agentTokenEncrypted: encrypted });
    return getState();
  }

  return { getToken, getState, saveToken };
}

let productionStore = null;

function getProductionAgentTokenStore() {
  if (!productionStore) {
    const { safeStorage } = require('electron');
    const { lerConfig, salvarConfig } = require('./config');
    productionStore = createAgentTokenStore({
      env: process.env,
      safeStorage,
      readConfig: lerConfig,
      saveConfig: salvarConfig,
    });
  }
  return productionStore;
}

module.exports = {
  createAgentTokenStore,
  getProductionAgentTokenStore,
  ENCRYPTION_UNAVAILABLE_MESSAGE,
};
