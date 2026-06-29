require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const logger = require('./logger');
const { AutomationError, BROWSER_BUSY_MESSAGE } = require('./automation/AutomationError');
const { TIPO_FOTO_MAP, getLocators } = require('./automation/codontoSelectors');
const {
  openSystem,
  reinicializarPagina,
  ensureLogged,
  dismissConsentModal,
  searchPatient,
  openClinicalData,
  openPhotoAlbum,
  createAlbum,
} = require('./automation/codontoSteps');

const CODONTO_URL = process.env.CODONTO_URL || 'https://co.aplicativo.net/';

const PROFILE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'lockfile', 'SingletonSocket'];
const LAUNCH_RETRY_DELAY_MS = 1500;
const LAUNCH_MAX_TENTATIVAS = 2;

let context = null;
let automationPage = null;
let browserLaunchPromise = null;

function getSlowMo() {
  const n = parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10);
  return Number.isNaN(n) ? 0 : n;
}

async function obterPaginaAutomacao(ctx) {
  if (automationPage && !automationPage.isClosed()) {
    return automationPage;
  }

  const aberta = ctx.pages().find((p) => !p.isClosed());
  automationPage = aberta || await ctx.newPage();
  return automationPage;
}

function getBrowserProfileDir() {
  const base = app?.getPath('userData') || os.tmpdir();
  return path.join(base, 'browser-profile');
}

function limparLocksPerfil(profileDir) {
  for (const name of PROFILE_LOCK_FILES) {
    const filePath = path.join(profileDir, name);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info('Lock do perfil do browser removido', { arquivo: name });
      }
    } catch (err) {
      logger.warn('Não foi possível remover lock do perfil', { arquivo: name, error: err.message });
    }
  }
}

function isErroPerfilOcupado(err) {
  const msg = String(err?.message || err).toLowerCase();
  return (
    msg.includes('has been closed') ||
    msg.includes('target page') ||
    msg.includes('browser has been closed') ||
    msg.includes('sessão de navegador') ||
    msg.includes('existing browser session') ||
    msg.includes('user data directory is already in use') ||
    msg.includes('profile appears to be in use')
  );
}

function opcoesLaunch() {
  return {
    headless: false,
    slowMo: getSlowMo(),
    args: [
      '--start-maximized',
      '--disable-features=DestroyProfileOnBrowserClose',
    ],
    viewport: null,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  };
}

async function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchPersistentContextComRetry(profileDir) {
  let ultimoErro;

  for (let tentativa = 1; tentativa <= LAUNCH_MAX_TENTATIVAS; tentativa++) {
    try {
      return await chromium.launchPersistentContext(profileDir, opcoesLaunch());
    } catch (err) {
      ultimoErro = err;
      logger.warn('Falha ao iniciar Chromium', { tentativa, error: err.message });

      if (tentativa < LAUNCH_MAX_TENTATIVAS && isErroPerfilOcupado(err)) {
        limparLocksPerfil(profileDir);
        await aguardar(LAUNCH_RETRY_DELAY_MS);
        continue;
      }
      break;
    }
  }

  throw ultimoErro;
}

/**
 * Inicia o Chromium com perfil persistente — a sessão de login do usuário é preservada.
 * Serializado (mutex) para evitar duplo launch no Windows.
 */
async function iniciarBrowser() {
  if (context?.browser()?.isConnected()) {
    return context;
  }

  if (context) {
    context = null;
    automationPage = null;
  }

  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  browserLaunchPromise = (async () => {
    const profileDir = getBrowserProfileDir();

    try {
      fs.mkdirSync(profileDir, { recursive: true });
      logger.info('Iniciando browser Chromium (perfil persistente)...', { profileDir });

      const ctx = await launchPersistentContextComRetry(profileDir);
      context = ctx;
      logger.info('Browser iniciado');
      return ctx;
    } catch (err) {
      context = null;
      automationPage = null;

      if (isErroPerfilOcupado(err)) {
        throw new AutomationError(BROWSER_BUSY_MESSAGE, {
          code: 'BROWSER_LAUNCH_FAILED',
          etapa: 'browser',
        });
      }

      throw new AutomationError(
        `Não foi possível abrir o navegador do Codonto.\n\n${err.message}`,
        { code: 'BROWSER_LAUNCH_FAILED', etapa: 'browser' }
      );
    } finally {
      browserLaunchPromise = null;
    }
  })();

  return browserLaunchPromise;
}

function prefixoTipoFoto(tipoFoto) {
  if (!tipoFoto) return '';
  const normalizado = String(tipoFoto).toUpperCase();
  const label = TIPO_FOTO_MAP[normalizado] || normalizado.toLowerCase();
  return `${label}_`;
}

function prefixoNomeArquivoFoto(tarefa) {
  if (tarefa.nome_foto) return `${tarefa.nome_foto}_`;
  return prefixoTipoFoto(tarefa.tipo_foto);
}

function salvarFotoTemp(base64, mimeType, tarefa) {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const prefixo = prefixoNomeArquivoFoto(tarefa);
  const tmpPath = path.join(os.tmpdir(), `${prefixo}codonto_foto_${Date.now()}.${ext}`);
  fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
  return tmpPath;
}

function formatarErro(err) {
  if (err instanceof AutomationError) {
    return { sucesso: false, erro: err.message, code: err.code, etapa: err.etapa };
  }
  return { sucesso: false, erro: err.message || 'Erro desconhecido na automação.' };
}

/**
 * Fluxo principal de automação no Codonto.
 * O usuário deve estar logado manualmente — nenhuma credencial é utilizada.
 */
async function processarNoCodonto(tarefa, fotoBase64, mimeType, onStep) {
  let page;
  let fotoPath;
  let processamentoConcluido = false;

  try {
    const ctx = await iniciarBrowser();
    page = await obterPaginaAutomacao(ctx);
    fotoPath = salvarFotoTemp(fotoBase64, mimeType, tarefa);

    logger.info('Iniciando automação no Codonto', {
      prontuario: tarefa.prontuario,
      restauracao: tarefa.restauracao,
      titulo_album: tarefa.titulo_album,
      nome_foto: tarefa.nome_foto,
      tipo_foto: tarefa.tipo_foto,
    });

    await openSystem(page, CODONTO_URL, onStep);
    await dismissConsentModal(page, onStep);
    await ensureLogged(page, onStep, CODONTO_URL);
    await dismissConsentModal(page, onStep);
    await searchPatient(page, tarefa.prontuario, onStep);
    await dismissConsentModal(page, onStep);
    await openClinicalData(page, onStep);
    await dismissConsentModal(page, onStep);
    await openPhotoAlbum(page, onStep);
    await dismissConsentModal(page, onStep);
    await createAlbum(page, tarefa, fotoPath, onStep);

    logger.info('Foto salva com sucesso no Codonto', {
      prontuario: tarefa.prontuario,
      restauracao: tarefa.restauracao,
      titulo_album: tarefa.titulo_album,
      nome_foto: tarefa.nome_foto,
    });

    processamentoConcluido = true;
    return { sucesso: true };
  } catch (err) {
    const resultado = formatarErro(err);

    logger.error('Erro na automação do Codonto', {
      error: resultado.erro,
      code: resultado.code,
      etapa: resultado.etapa,
      prontuario: tarefa.prontuario,
    });

    try {
      const screenshotPath = path.join(
        os.tmpdir(),
        `erro_${tarefa.id}_${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.info('Screenshot do erro salvo', { path: screenshotPath, etapa: resultado.etapa });
    } catch (_) {}

    return resultado;
  } finally {
    if (fotoPath) {
      try {
        fs.unlinkSync(fotoPath);
      } catch (_) {}
    }

    if (page && !page.isClosed()) {
      try {
        await reinicializarPagina(page, CODONTO_URL, onStep);
      } catch (err) {
        logger.warn('Falha ao reinicializar página após processamento', {
          error: err.message,
          prontuario: tarefa.prontuario,
          concluido: processamentoConcluido,
        });
      }
    }
  }
}

async function fecharBrowser() {
  browserLaunchPromise = null;

  if (context) {
    automationPage = null;
    await context.close();
    context = null;
    logger.info('Browser fechado');
  }
}

/** Verifica se o campo "Pesquisar Paciente" está visível (sessão autenticada). */
async function verificarSessaoAtiva() {
  if (!context || !context.browser()?.isConnected()) {
    return false;
  }

  const page = await obterPaginaAutomacao(context).catch(() => null);
  if (!page || page.isClosed()) {
    return false;
  }

  const { loggedIn } = getLocators(page);
  return loggedIn.searchPatient.isVisible().catch(() => false);
}

/** Garante browser aberto na tela de login para o usuário autenticar manualmente. */
async function garantirTelaLogin(onStep) {
  const ctx = await iniciarBrowser();
  const page = await obterPaginaAutomacao(ctx);

  if (await verificarSessaoAtiva()) {
    return true;
  }

  const { loggedIn, login } = getLocators(page);
  const naTelaLogin = await login.username.isVisible().catch(() => false);

  if (!naTelaLogin && !(await loggedIn.searchPatient.isVisible().catch(() => false))) {
    if (onStep) onStep('Abrindo Codonto para login...');
    await page.goto(CODONTO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }

  return verificarSessaoAtiva();
}

module.exports = {
  processarNoCodonto,
  fecharBrowser,
  iniciarBrowser,
  verificarSessaoAtiva,
  garantirTelaLogin,
};
