const AGENT_CHANNELS = Object.freeze({
  start: 'agente:iniciar',
  stop: 'agente:parar',
  status: 'agente:status',
  tokenState: 'config:obterAgentToken',
  tokenSave: 'config:salvarAgentToken',
});

const registeredIpcMains = new WeakSet();

function registerAgentIpc({ ipcMain, service, onStateChanged = () => {} }) {
  if (registeredIpcMains.has(ipcMain)) throw new Error('IPC do agente já registrado');
  registeredIpcMains.add(ipcMain);

  function action(method, ...args) {
    const state = service[method](...args);
    onStateChanged(state);
    return state;
  }

  ipcMain.handle(AGENT_CHANNELS.start, () => action('iniciar'));
  ipcMain.handle(AGENT_CHANNELS.stop, () => action('parar'));
  ipcMain.handle(AGENT_CHANNELS.status, () => service.status());
  ipcMain.handle(AGENT_CHANNELS.tokenState, () => service.obterEstadoToken());
  ipcMain.handle(AGENT_CHANNELS.tokenSave, (_, token) => action('salvarToken', token));

  return () => {
    for (const channel of Object.values(AGENT_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
    registeredIpcMains.delete(ipcMain);
  };
}

module.exports = { AGENT_CHANNELS, registerAgentIpc };
