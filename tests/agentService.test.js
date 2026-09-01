const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgentService } = require('../src/main/agentService');

function createFixture({ configurado = false, fixoViaEnv = false } = {}) {
  let tokenState = {
    configurado,
    fixoViaEnv,
    disponivelParaSalvar: !fixoViaEnv,
  };
  let rodando = false;
  let aguardandoLogin = false;
  const calls = [];

  const tokenStore = {
    getState: () => ({ ...tokenState }),
    saveToken: (token) => {
      calls.push(['saveToken', token]);
      tokenState = {
        configurado: true,
        fixoViaEnv: false,
        disponivelParaSalvar: true,
      };
      return { ...tokenState };
    },
  };
  const worker = {
    iniciar() {
      calls.push(['iniciar']);
      rodando = true;
    },
    parar() {
      calls.push(['parar']);
      rodando = false;
      aguardandoLogin = false;
    },
    estaRodando: () => rodando,
    estaAguardandoLogin: () => aguardandoLogin,
  };

  return {
    service: createAgentService({ tokenStore, worker }),
    calls,
    setAwaitingLogin(value) {
      aguardandoLogin = value;
    },
  };
}

test('não inicia o worker quando falta o token', () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.service.iniciarSeConfigurado(), {
    rodando: false,
    aguardandoLogin: false,
    configuracaoNecessaria: true,
  });
  assert.deepEqual(fixture.calls, []);
});

test('inicia automaticamente quando o token já está configurado', () => {
  const fixture = createFixture({ configurado: true });

  assert.deepEqual(fixture.service.iniciarSeConfigurado(), {
    rodando: true,
    aguardandoLogin: false,
    configuracaoNecessaria: false,
  });
  assert.deepEqual(fixture.calls, [['iniciar']]);
});

test('salva o token e inicia o worker imediatamente', () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.service.salvarToken('novo-token'), {
    configurado: true,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
    rodando: true,
    aguardandoLogin: false,
    configuracaoNecessaria: false,
  });
  assert.deepEqual(fixture.calls, [['saveToken', 'novo-token'], ['iniciar']]);
});

test('bloqueia também a ação manual de iniciar sem token', () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.service.iniciar(), {
    rodando: false,
    aguardandoLogin: false,
    configuracaoNecessaria: true,
  });
  assert.deepEqual(fixture.calls, []);
});

test('inclui a necessidade de configuração no estado do agente', () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.service.status(), {
    rodando: false,
    aguardandoLogin: false,
    configuracaoNecessaria: true,
  });
  assert.deepEqual(fixture.service.obterEstadoToken(), {
    configurado: false,
    fixoViaEnv: false,
    disponivelParaSalvar: true,
  });
});

test('preserva o estado de login ao parar o agente', () => {
  const fixture = createFixture({ configurado: true });
  fixture.service.iniciar();
  fixture.setAwaitingLogin(true);

  assert.deepEqual(fixture.service.parar(), {
    rodando: false,
    aguardandoLogin: false,
    configuracaoNecessaria: false,
  });
  assert.deepEqual(fixture.calls, [['iniciar'], ['parar']]);
});
