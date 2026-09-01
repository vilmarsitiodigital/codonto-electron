(function exposeAgentTokenUi(root) {
  function createAgentTokenController({ api, elements, onAgentState = () => {} }) {
    let initialized = false;
    let destroyed = false;
    let saving = false;
    let currentState = null;

    function render(state, message = state.mensagem || '') {
      currentState = state;
      const editable = state.disponivelParaSalvar && !state.fixoViaEnv;

      elements.status.textContent = state.fixoViaEnv
        ? 'Definido pelo ambiente'
        : state.configurado
          ? 'Configurado'
          : 'Não configurado';
      elements.input.disabled = !editable || saving;
      elements.saveButton.disabled = !editable || saving;
      elements.saveButton.textContent = saving ? 'Salvando…' : 'Salvar token';
      elements.input.placeholder = state.fixoViaEnv
        ? 'AGENT_TOKEN definido no .env'
        : state.configurado
          ? 'Digite para substituir o token salvo'
          : 'Informe o token fornecido pelo administrador';
      elements.message.textContent = message;
      elements.message.hidden = !message;
    }

    async function save() {
      if (!currentState || saving || currentState.fixoViaEnv || !currentState.disponivelParaSalvar) {
        return;
      }

      const token = elements.input.value.trim();
      if (!token) {
        render(currentState, 'Informe o token do agente.');
        return;
      }

      saving = true;
      render(currentState, '');
      try {
        const result = await api.salvarToken(token);
        elements.input.value = '';
        render(result, 'Token salvo com segurança.');
        onAgentState({
          rodando: result.rodando,
          aguardandoLogin: result.aguardandoLogin,
          configuracaoNecessaria: result.configuracaoNecessaria,
        });
      } catch (error) {
        render(currentState, error.message || 'Não foi possível salvar o token.');
      } finally {
        saving = false;
        if (!destroyed) render(currentState, elements.message.textContent);
      }
    }

    async function init() {
      if (initialized) return;
      initialized = true;
      destroyed = false;
      elements.saveButton.addEventListener('click', save);
      const state = await api.obterEstadoToken();
      render(state);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      initialized = false;
      elements.saveButton.removeEventListener('click', save);
      elements.input.disabled = true;
      elements.saveButton.disabled = true;
    }

    elements.input.disabled = true;
    elements.saveButton.disabled = true;

    return { init, save, destroy };
  }

  const api = { createAgentTokenController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CodontoAgentTokenUi = api;
}(typeof window !== 'undefined' ? window : globalThis));
