function createCodontoApi(ipcRenderer) {
  return {
    // Controle do agente
    iniciarAgente: () => ipcRenderer.invoke('agente:iniciar'),
    pararAgente:   () => ipcRenderer.invoke('agente:parar'),
    statusAgente:  () => ipcRenderer.invoke('agente:status'),

    // Dados
    buscarStatus: () => ipcRenderer.invoke('status:buscar'),
    abrirLogs:    () => ipcRenderer.invoke('logs:abrir'),
    obterDesde:   () => ipcRenderer.invoke('config:obterDesde'),
    definirDesde: (data) => ipcRenderer.invoke('config:definirDesde', data),
    obterPollInterval: () => ipcRenderer.invoke('config:obterPollInterval'),
    definirPollInterval: (segundos) => ipcRenderer.invoke('config:definirPollInterval', segundos),

    // Eventos vindos do main process
    onEvento: (cb) => ipcRenderer.on('worker:evento', (_, payload) => cb(payload)),
    onStatusAgente: (cb) => ipcRenderer.on('agente:status', (_, payload) => cb(payload)),

    // Atualizações da aplicação
    obterVersao: () => ipcRenderer.invoke('app:version'),
    verificarAtualizacao: () => ipcRenderer.invoke('updater:check'),
    baixarAtualizacao: () => ipcRenderer.invoke('updater:download'),
    instalarAtualizacao: () => ipcRenderer.invoke('updater:install'),
    onAtualizacao: (callback) => {
      const listener = (_, payload) => callback(payload);
      ipcRenderer.on('updater:event', listener);
      return () => ipcRenderer.removeListener('updater:event', listener);
    },
  };
}

if (process.type === 'renderer') {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('codonto', createCodontoApi(ipcRenderer));
}

module.exports = { createCodontoApi };
