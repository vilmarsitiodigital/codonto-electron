require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const logger = require('./logger');
const { AutomationError } = require('./automation/AutomationError');
const { TIPO_FOTO_MAP, getLocators } = require('./automation/codontoSelectors');
const {
  openSystem,
  ensureLogged,
  dismissConsentModal,
  searchPatient,
  openClinicalData,
  openPhotoAlbum,
  createAlbum,
} = require('./automation/codontoSteps');

const CODONTO_URL = process.env.CODONTO_URL || 'https://co.aplicativo.net/';

let context = null;
let automationPage = null;

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

/**
 * Inicia o Chromium com perfil persistente — a sessão de login do usuário é preservada.
 */
async function iniciarBrowser() {
  if (context && !context.browser()?.isConnected()) {
    context = null;
  }
  if (context) return context;

  logger.info('Iniciando browser Chromium (perfil persistente)...');

  context = await chromium.launchPersistentContext(getBrowserProfileDir(), {
    headless: false,
    slowMo: getSlowMo(),
    args: ['--start-maximized'],
    viewport: null,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });

  logger.info('Browser iniciado');
  return context;
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
  const ctx = await iniciarBrowser();
  const page = await obterPaginaAutomacao(ctx);
  const fotoPath = salvarFotoTemp(fotoBase64, mimeType, tarefa);

  try {
    logger.info('Iniciando automação no Codonto', {
      prontuario: tarefa.prontuario,
      restauracao: tarefa.restauracao,
      titulo_album: tarefa.titulo_album,
      nome_foto: tarefa.nome_foto,
      tipo_foto: tarefa.tipo_foto,
    });

    await openSystem(page, CODONTO_URL, onStep);
    await dismissConsentModal(page, onStep);
    await ensureLogged(page, onStep);
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
    try {
      fs.unlinkSync(fotoPath);
    } catch (_) {}
  }
}

async function fecharBrowser() {
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
