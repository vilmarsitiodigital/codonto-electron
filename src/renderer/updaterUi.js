(function exposeUpdaterUi(root) {
  const eventMessages = {
    checking: 'Verificando atualizações…',
    'up-to-date': 'Você já está usando a versão mais recente.',
  };

  function resetActions(elements) {
    elements.downloadButton.hidden = true;
    elements.installButton.hidden = true;
    elements.progress.hidden = true;
  }

  function createUpdaterController({ api, elements, scheduleHide = (callback) => setTimeout(callback, 3000) }) {
    let unsubscribe;
    let initialized = false;
    let destroyed = false;
    let hideRevision = 0;
    let ready = false;
    let pendingAction = false;
    let currentEvent = { type: 'idle' };
    let downloadedEvent = null;

    function disableControls(disabled) {
      elements.checkButton.disabled = disabled;
      elements.downloadButton.disabled = disabled;
      elements.installButton.disabled = disabled;
    }

    function render(event) {
      resetActions(elements);
      disableControls(!ready || pendingAction);

      if (event.type === 'idle') return;

      elements.banner.hidden = false;

      if (eventMessages[event.type]) {
        elements.message.textContent = eventMessages[event.type];
        if (event.type === 'checking') disableControls(true);
        if (event.type === 'up-to-date') {
          const scheduledRevision = hideRevision;
          scheduleHide(() => {
            if (scheduledRevision === hideRevision) elements.banner.hidden = true;
          });
        }
        return;
      }

      if (event.type === 'available') {
        elements.message.textContent = `Versão ${event.version} disponível.`;
        elements.downloadButton.hidden = false;
        return;
      }

      if (event.type === 'downloading') {
        elements.message.textContent = `Baixando atualização… ${event.percent}%`;
        disableControls(true);
        elements.progress.hidden = false;
        elements.progressBar.style.width = `${event.percent}%`;
        return;
      }

      if (event.type === 'downloaded') {
        elements.message.textContent = `Versão ${event.version} pronta para instalar.`;
        elements.installButton.hidden = false;
        elements.checkButton.disabled = true;
        return;
      }

      if (event.type === 'unsupported' || event.type === 'error') {
        elements.message.textContent = event.message;
        if (downloadedEvent) {
          elements.installButton.hidden = false;
          elements.checkButton.disabled = true;
        }
      }
    }

    function handleEvent(event) {
      hideRevision += 1;
      if (downloadedEvent && event.type !== 'downloaded' && event.type !== 'error') {
        currentEvent = downloadedEvent;
        render(currentEvent);
        return;
      }
      if (event.type === 'downloaded') downloadedEvent = event;
      currentEvent = event;
      render(currentEvent);
    }

    async function runAction(action) {
      if (pendingAction) return;
      pendingAction = true;
      render(currentEvent);
      try {
        const result = await action();
        if (result && result.success === false && result.code !== 'busy') {
          handleEvent({ type: 'error', message: result.error });
        }
      } finally {
        pendingAction = false;
        if (!destroyed) render(currentEvent);
      }
    }

    const onCheck = () => runAction(api.verificarAtualizacao);
    const onDownload = () => runAction(api.baixarAtualizacao);
    const onInstall = () => runAction(api.instalarAtualizacao);

    async function init() {
      if (initialized) return;
      initialized = true;
      destroyed = false;
      elements.checkButton.addEventListener('click', onCheck);
      elements.downloadButton.addEventListener('click', onDownload);
      elements.installButton.addEventListener('click', onInstall);
      unsubscribe = api.onAtualizacao(handleEvent);
      elements.version.textContent = `Versão ${await api.obterVersao()}`;
      ready = true;
      render(currentEvent);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      initialized = false;
      ready = false;
      disableControls(true);
      hideRevision += 1;
      elements.checkButton.removeEventListener('click', onCheck);
      elements.downloadButton.removeEventListener('click', onDownload);
      elements.installButton.removeEventListener('click', onInstall);
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
    }

    disableControls(true);

    return { init, handleEvent, destroy };
  }

  const api = { createUpdaterController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CodontoUpdaterUi = api;
}(typeof window !== 'undefined' ? window : globalThis));
