function initUpdaterAfterRendererLoad({ webContents, service }) {
  let pending = true;

  function initUpdater() {
    if (!pending) return;
    pending = false;
    service.init();
  }

  webContents.once('did-finish-load', initUpdater);

  return () => {
    if (!pending) return;
    pending = false;
    webContents.removeListener('did-finish-load', initUpdater);
  };
}

module.exports = { initUpdaterAfterRendererLoad };
