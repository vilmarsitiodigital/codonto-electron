require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const logger = require('./logger');
const { AutomationError } = require('./automation/AutomationError');
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
    slowMo: 200,
    args: ['--start-maximized'],
    viewport: null,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });

  logger.info('Browser iniciado');
  return context;
}

function salvarFotoTemp(base64, mimeType) {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const tmpPath = path.join(os.tmpdir(), `codonto_foto_${Date.now()}.${ext}`);
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
  const page = await ctx.newPage();
  const fotoPath = salvarFotoTemp(fotoBase64, mimeType);

  try {
    logger.info('Iniciando automação no Codonto', {
      prontuario: tarefa.prontuario,
      restauracao: tarefa.restauracao,
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
    await page.close();
    try {
      fs.unlinkSync(fotoPath);
    } catch (_) {}
  }
}

async function fecharBrowser() {
  if (context) {
    await context.close();
    context = null;
    logger.info('Browser fechado');
  }
}

module.exports = { processarNoCodonto, fecharBrowser, iniciarBrowser };
