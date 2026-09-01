const CHANNELS = Object.freeze({
  version: 'app:version',
  check: 'updater:check',
  download: 'updater:download',
  install: 'updater:install',
  event: 'updater:event',
});

const registeredIpcMains = new WeakSet();

function registerUpdaterIpc({ ipcMain, app, service }) {
  if (registeredIpcMains.has(ipcMain)) throw new Error('IPC do updater já registrado');
  registeredIpcMains.add(ipcMain);

  ipcMain.handle(CHANNELS.version, () => app.getVersion());
  ipcMain.handle(CHANNELS.check, () => service.check());
  ipcMain.handle(CHANNELS.download, () => service.download());
  ipcMain.handle(CHANNELS.install, () => service.install());

  return () => {
    for (const channel of [CHANNELS.version, CHANNELS.check, CHANNELS.download, CHANNELS.install]) {
      ipcMain.removeHandler(channel);
    }
    registeredIpcMains.delete(ipcMain);
  };
}

module.exports = { CHANNELS, registerUpdaterIpc };
