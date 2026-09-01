const INITIAL_CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
const UNSUPPORTED_MESSAGE = 'Atualização automática disponível somente no aplicativo Windows instalado.';
const BUSY_MESSAGE = 'Já existe uma operação de atualização em andamento.';

function formatUpdaterError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return 'Sem conexão com o servidor de atualizações. Tente novamente mais tarde.';
  }
  return 'Não foi possível concluir a atualização. Tente novamente mais tarde.';
}

function createUpdaterService({
  updater,
  logger,
  isPackaged,
  platform,
  sendEvent,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let initialized = false;
  let lifecycleGeneration = 0;
  let operation = null;
  let inFlightOperationCount = 0;
  let initialTimer = null;
  let checkInterval = null;
  const listeners = [];
  const supported = isPackaged === true && platform === 'win32';

  function emit(payload) {
    sendEvent(payload);
  }

  function addListener(eventName, handler) {
    updater.on(eventName, handler);
    listeners.push([eventName, handler]);
  }

  async function runOperation(name, action) {
    if (!supported) return { success: false, code: 'unsupported', error: UNSUPPORTED_MESSAGE };
    if (operation || inFlightOperationCount > 0) return { success: false, code: 'busy', error: BUSY_MESSAGE };
    operation = name;
    inFlightOperationCount += 1;
    try {
      await action();
      return { success: true };
    } catch (error) {
      logger.error(`[updater] Falha em ${name}`, { error });
      const safeMessage = formatUpdaterError(error);
      emit({ type: 'error', message: safeMessage });
      return { success: false, code: 'error', error: safeMessage };
    } finally {
      operation = null;
      inFlightOperationCount -= 1;
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const generation = ++lifecycleGeneration;

    if (!supported) {
      emit({ type: 'unsupported', message: UNSUPPORTED_MESSAGE });
      return;
    }

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;

    addListener('checking-for-update', () => emit({ type: 'checking' }));
    addListener('update-not-available', () => emit({ type: 'up-to-date' }));
    addListener('update-available', (update) => emit({ type: 'available', version: update.version }));
    addListener('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
      emit({ type: 'downloading', percent });
    });
    addListener('update-downloaded', (update) => emit({ type: 'downloaded', version: update.version }));
    addListener('error', (error) => {
      logger.error('[updater] Falha no atualizador', { error });
      emit({ type: 'error', message: formatUpdaterError(error) });
    });

    initialTimer = setTimeoutFn(async () => {
      await runOperation('verificação', () => updater.checkForUpdates());
      if (!initialized || generation !== lifecycleGeneration) return;
      checkInterval = setIntervalFn(() => {
        runOperation('verificação', () => updater.checkForUpdates());
      }, CHECK_INTERVAL_MS);
    }, INITIAL_CHECK_DELAY_MS);
  }

  function dispose() {
    lifecycleGeneration += 1;
    if (initialTimer) clearTimeoutFn(initialTimer);
    if (checkInterval) clearIntervalFn(checkInterval);
    initialTimer = null;
    checkInterval = null;
    for (const [eventName, handler] of listeners) {
      updater.removeListener(eventName, handler);
    }
    listeners.length = 0;
    initialized = false;
    operation = null;
  }

  return {
    init,
    check: () => runOperation('verificação', () => updater.checkForUpdates()),
    download: () => runOperation('download', () => updater.downloadUpdate()),
    install() {
      if (!supported) return { success: false, code: 'unsupported', error: UNSUPPORTED_MESSAGE };
      if (operation || inFlightOperationCount > 0) return { success: false, code: 'busy', error: BUSY_MESSAGE };
      logger.info('[updater] Reiniciando para instalar atualização');
      updater.quitAndInstall();
      return { success: true };
    },
    dispose,
    isSupported: () => supported,
  };
}

function createProductionUpdater({ logger, isPackaged, platform, sendEvent }) {
  const { autoUpdater } = require('electron-updater');
  return createUpdaterService({
    updater: autoUpdater,
    logger,
    isPackaged,
    platform,
    sendEvent,
  });
}

module.exports = {
  createUpdaterService,
  createProductionUpdater,
  formatUpdaterError,
  INITIAL_CHECK_DELAY_MS,
  CHECK_INTERVAL_MS,
  UNSUPPORTED_MESSAGE,
  BUSY_MESSAGE,
};
