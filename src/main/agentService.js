function createAgentService({ tokenStore, worker }) {
  function status() {
    const tokenState = tokenStore.getState();
    return {
      rodando: worker.estaRodando(),
      aguardandoLogin: worker.estaAguardandoLogin(),
      configuracaoNecessaria: !tokenState.configurado,
    };
  }

  function obterEstadoToken() {
    return tokenStore.getState();
  }

  function iniciar() {
    if (!tokenStore.getState().configurado) return status();
    worker.iniciar();
    return status();
  }

  function iniciarSeConfigurado() {
    return iniciar();
  }

  function parar() {
    worker.parar();
    return status();
  }

  function salvarToken(token) {
    const tokenState = tokenStore.saveToken(token);
    worker.iniciar();
    return { ...tokenState, ...status() };
  }

  return {
    iniciar,
    iniciarSeConfigurado,
    parar,
    status,
    obterEstadoToken,
    salvarToken,
  };
}

module.exports = { createAgentService };
