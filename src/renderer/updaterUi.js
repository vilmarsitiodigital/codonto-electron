(function exposeUpdaterUi(root) {
  const eventMessages = {
    checking: 'Verificando atualizações…',
    'up-to-date': 'Você já está usando a versão mais recente.',
  };

  function resetActions(elements) {
    elements.downloadButton.hidden = true;
    elements.installButton.hidden = true;
    elements.progress.hidden = true;
    elements.checkButton.disabled = false;
  }

  function createUpdaterController({ api, elements, scheduleHide = (callback) => setTimeout(callback, 3000) }) {
    let unsubscribe;
    let initialized = false;
    let destroyed = false;
    let hideRevision = 0;

    function handleEvent(event) {
      hideRevision += 1;
      resetActions(elements);
      elements.banner.hidden = false;

      if (eventMessages[event.type]) {
        elements.message.textContent = eventMessages[event.type];
        if (event.type === 'checking') elements.checkButton.disabled = true;
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
        elements.progress.hidden = false;
        elements.progressBar.style.width = `${event.percent}%`;
        return;
      }

      if (event.type === 'downloaded') {
        elements.message.textContent = `Versão ${event.version} pronta para instalar.`;
        elements.installButton.hidden = false;
        return;
      }

      if (event.type === 'unsupported' || event.type === 'error') {
        elements.message.textContent = event.message;
      }
    }

    async function runAction(action) {
      const result = await action();
      if (result && result.success === false) {
        handleEvent({ type: 'error', message: result.error });
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
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      initialized = false;
      hideRevision += 1;
      elements.checkButton.removeEventListener('click', onCheck);
      elements.downloadButton.removeEventListener('click', onDownload);
      elements.installButton.removeEventListener('click', onInstall);
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
    }

    return { init, handleEvent, destroy };
  }

  const api = { createUpdaterController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CodontoUpdaterUi = api;
}(typeof window !== 'undefined' ? window : globalThis));
