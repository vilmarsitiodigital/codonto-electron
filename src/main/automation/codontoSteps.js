const logger = require('../logger');
const { AutomationError, LOGIN_REQUIRED_MESSAGE } = require('./AutomationError');
const { getLocators, TIPO_FOTO_MAP } = require('./codontoSelectors');

const AUTH_CHECK_TIMEOUT = 20000;
const DEFAULT_TIMEOUT = 15000;
const NAV_TIMEOUT = 8000;
const MODAL_TIMEOUT = 30000;
const UPLOAD_TIMEOUT = 60000;

async function waitAfterNav(page, locator, timeout = NAV_TIMEOUT) {
  if (locator) {
    await locator.waitFor({ state: 'visible', timeout }).catch(() => {});
    return;
  }
  await page.waitForLoadState('load', { timeout }).catch(() => {});
}

function logStep(message, onStep) {
  logger.info(`[Codonto] ${message}`);
  if (onStep) onStep(message);
}

async function waitVisible(locator, { etapa, mensagem, timeout = DEFAULT_TIMEOUT }) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  } catch {
    throw new AutomationError(
      mensagem || `Não foi possível localizar um elemento na etapa "${etapa}".`,
      { etapa }
    );
  }
}

async function isVisible(locator) {
  return locator.isVisible().catch(() => false);
}

async function openSystem(page, url, onStep) {
  const { loggedIn } = getLocators(page);

  if (await isVisible(loggedIn.searchPatient)) {
    logStep('Sessão já ativa — pulando abertura do sistema.', onStep);
    return;
  }

  logStep('Abrindo sistema...', onStep);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitAfterNav(page, loggedIn.searchPatient);
  logStep('Sistema carregado.', onStep);
}

async function ensureLogged(page, onStep) {
  const { loggedIn, login } = getLocators(page);

  logStep('Verificando autenticação...', onStep);

  const deadline = Date.now() + AUTH_CHECK_TIMEOUT;

  while (Date.now() < deadline) {
    if (await isVisible(loggedIn.searchPatient)) {
      logStep('Usuário autenticado.', onStep);
      return;
    }

    if (await isVisible(login.username)) {
      throw new AutomationError(LOGIN_REQUIRED_MESSAGE, {
        code: 'LOGIN_REQUIRED',
        etapa: 'autenticação',
      });
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await loggedIn.searchPatient.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
  }

  if (await isVisible(login.username)) {
    throw new AutomationError(LOGIN_REQUIRED_MESSAGE, {
      code: 'LOGIN_REQUIRED',
      etapa: 'autenticação',
    });
  }

  throw new AutomationError(
    'Não foi possível localizar o campo "Pesquisar Paciente".\n\n' +
      'Verifique se o usuário continua logado no sistema.',
    { etapa: 'autenticação' }
  );
}

async function dismissConsentModal(page, onStep) {
  const { consent } = getLocators(page);
  const visible = await isVisible(consent.confirmButton);

  if (!visible) return;

  logStep('Modal de consentimento encontrado.', onStep);
  await consent.confirmButton.click();
  await consent.confirmButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  logStep('Modal fechado.', onStep);
}

async function searchPatient(page, prontuario, onStep) {
  const { loggedIn, patient, clinical } = getLocators(page);

  logStep(`Pesquisando paciente ${prontuario}...`, onStep);

  const campo = await waitVisible(loggedIn.searchPatient, {
    etapa: 'pesquisa de paciente',
    mensagem:
      'Não foi possível localizar o campo "Pesquisar Paciente".\n\n' +
      'Verifique se o usuário continua logado.',
  });

  await dismissConsentModal(page, onStep);

  await campo.fill(String(prontuario));

  await waitVisible(patient.dropdown, {
    etapa: 'dropdown de busca',
    mensagem:
      `Não foi possível localizar resultados para o prontuário ${prontuario}.\n\n` +
      'Verifique se o número está correto.',
  });

  await dismissConsentModal(page, onStep);

  const itemPorCodigo = patient.byProntuario(prontuario);
  const item = (await isVisible(itemPorCodigo))
    ? itemPorCodigo
    : patient.firstResult;

  await waitVisible(item, {
    etapa: 'resultado da pesquisa',
    mensagem: `Não foi possível localizar o paciente com prontuário ${prontuario}.`,
  });

  await item.click();
  await waitAfterNav(page, clinical.dadosClinicos);

  logStep('Paciente localizado.', onStep);
}

async function openClinicalData(page, onStep) {
  const { clinical, album } = getLocators(page);

  if (await isVisible(album.abasAlbum)) {
    logStep('Dados Clínicos já abertos.', onStep);
    return;
  }

  logStep('Abrindo Dados Clínicos...', onStep);
  await dismissConsentModal(page, onStep);

  const link = await waitVisible(clinical.dadosClinicos, {
    etapa: 'dados clínicos',
    mensagem:
      'Não foi possível localizar a seção "Dados Clínicos".\n\n' +
      'Verifique se o prontuário do paciente foi aberto corretamente.',
  });

  await link.click();
  await waitAfterNav(page, album.abasAlbum);
  await dismissConsentModal(page, onStep);
}

async function openPhotoAlbum(page, onStep) {
  const { album } = getLocators(page);

  const jaNaAba = await album.novoAlbum.isVisible().catch(() => false)
    || await page.locator('li[class*="expandable"]').first().isVisible().catch(() => false);

  if (jaNaAba) {
    logStep('Álbuns já abertos.', onStep);
    return;
  }

  logStep('Abrindo Álbuns...', onStep);
  await dismissConsentModal(page, onStep);

  const aba = await waitVisible(album.abasAlbum, {
    etapa: 'álbuns de fotos',
    mensagem:
      'Não foi possível localizar a seção de Álbuns/Fotos.\n\n' +
      'Verifique se a tela de Dados Clínicos está aberta.',
  });

  await aba.click();
  await Promise.race([
    album.novoAlbum.waitFor({ state: 'visible', timeout: NAV_TIMEOUT }),
    page.locator('li[class*="expandable"]').first().waitFor({ state: 'visible', timeout: NAV_TIMEOUT }),
  ]).catch(() => {});
  await dismissConsentModal(page, onStep);
}

async function isIncluirButtonVisible(li, album, itemId) {
  if (itemId) {
    const byItemId = album.incluirFotosByItemId(itemId);
    if (await byItemId.isVisible().catch(() => false)) return true;
  }
  return album.incluirFotosIn(li).isVisible().catch(() => false);
}

async function expandAlbumPanel(li, album, itemId) {
  await li.scrollIntoViewIfNeeded().catch(() => {});

  if (await isIncluirButtonVisible(li, album, itemId)) {
    return;
  }

  const subUl = li.locator('> ul').first();
  const subUlVisivel = await subUl.isVisible().catch(() => false);

  if (!subUlVisivel) {
    await li.locator('[class*="hitarea"]').first().click({ force: true, timeout: 5000 }).catch(() => {});
    await subUl.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  }

  if (!(await isIncluirButtonVisible(li, album, itemId))) {
    await li.evaluate((el) => {
      const ul = el.querySelector(':scope > ul');
      if (ul) ul.style.display = 'block';
    }).catch(() => {});
  }
}

function resolveIncluirButton(page, itemId, li, album) {
  if (itemId) {
    const byItemId = album.incluirFotosByItemId(itemId);
    return byItemId;
  }

  const byToolbar = album.incluirFotosIn(li);
  return byToolbar.or(page.getByTitle('Incluir Novas Fotos').first());
}

async function selectRestauracao(page, restauracao, onStep) {
  if (!restauracao) return null;

  const { album } = getLocators(page);
  logStep(`Selecionando restauração ${restauracao}...`, onStep);

  const li = album.restauracaoLi(restauracao);
  await waitVisible(li, {
    etapa: 'restauração',
    mensagem: `Não foi possível localizar a restauração "${restauracao}".`,
  });

  await dismissConsentModal(page, onStep);
  return li;
}

async function clickIncluirFotos(page, li, restauracao, onStep) {
  const { album } = getLocators(page);

  const itemId = await li.getAttribute('data-id', { timeout: 5000 }).catch(() => null);

  await expandAlbumPanel(li, album, itemId);

  const btnIncluir = resolveIncluirButton(page, itemId, li, album);

  try {
    await btnIncluir.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  } catch {
    throw new AutomationError(
      `Não foi possível localizar o botão "Incluir Novas Fotos" na restauração "${restauracao}".\n\n` +
        'Verifique se o álbum está expandido.',
      { etapa: 'incluir fotos' }
    );
  }

  logStep('Clicando em Incluir Novas Fotos...', onStep);
  const modalWait = album.uploadModal.waitFor({ state: 'visible', timeout: MODAL_TIMEOUT });
  await btnIncluir.click({ force: true });

  try {
    await modalWait;
  } catch {
    throw new AutomationError(
      'Não foi possível localizar o modal de upload.',
      { etapa: 'upload de foto' }
    );
  }

  logStep('Modal de upload aberto.', onStep);
}

async function waitUploadModal(page, album, onStep) {
  const webcamAtiva = await album.uploadModal.locator('#BtnSourceWebcam.is--active')
    .isVisible()
    .catch(() => false);
  if (webcamAtiva) {
    await album.uploadTabArquivos.click().catch(() => {});
  }

  await album.dropZone.waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => {});
}

async function setPhotoFile(page, album, fotoPath, onStep) {
  const input = album.browseFileInput;
  await input.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT });

  logStep('Enviando arquivo para upload...', onStep);
  await input.setInputFiles(fotoPath);
  await input.dispatchEvent('change').catch(() => {});

  const iniciouUpload = await album.uploadPreviewArea.or(album.uploadPreviewDone)
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (!iniciouUpload) {
    logStep('Acionando seletor de arquivos do Codonto...', onStep);
    const browse = album.uploadModal.locator('#BrowseFiles');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: DEFAULT_TIMEOUT }),
      browse.click({ force: true }),
    ]);
    await fileChooser.setFiles(fotoPath);
  }

  logStep('Aguardando conclusão do upload no servidor...', onStep);
  try {
    await album.uploadPreviewDone.first().waitFor({ state: 'visible', timeout: UPLOAD_TIMEOUT });
  } catch {
    await album.uploadPreviewArea.waitFor({ state: 'visible', timeout: UPLOAD_TIMEOUT }).catch(() => {
      throw new AutomationError(
        'O upload da foto não foi concluído a tempo.\n\nVerifique a conexão e tente novamente.',
        { etapa: 'upload de foto' }
      );
    });
  }
}

async function uploadPhoto(page, tarefa, fotoPath, onStep) {
  const { album } = getLocators(page);

  logStep('Preparando upload da foto...', onStep);
  await dismissConsentModal(page, onStep);

  if (tarefa.restauracao) {
    const li = album.restauracaoLi(tarefa.restauracao);
    await waitVisible(li, {
      etapa: 'restauração',
      mensagem: `Não foi possível localizar a restauração "${tarefa.restauracao}".`,
    });
    await clickIncluirFotos(page, li, tarefa.restauracao, onStep);
  } else {
    const btnIncluir = album.adicionarFoto.first();
    await waitVisible(btnIncluir, {
      etapa: 'incluir fotos',
      mensagem: 'Não foi possível localizar o botão "Incluir Novas Fotos".',
    });
    await btnIncluir.click();
    await getLocators(page).uploadModal.waitFor({ state: 'visible', timeout: MODAL_TIMEOUT });
  }

  await waitUploadModal(page, album, onStep);

  if (tarefa.tipo_foto) {
    const valorTipo = TIPO_FOTO_MAP[tarefa.tipo_foto];
    if (valorTipo && (await isVisible(album.selectTipo))) {
      await album.selectTipo.selectOption(valorTipo).catch(async () => {
        await album.selectTipo.selectOption({ label: tarefa.tipo_foto }).catch(() => {});
      });
      logStep(`Tipo de foto selecionado: ${tarefa.tipo_foto}`, onStep);
    }
  }

  await setPhotoFile(page, album, fotoPath, onStep);
  logStep('Foto enviada com sucesso.', onStep);
  await dismissConsentModal(page, onStep);
}

async function saveAlbum(page, onStep) {
  const { album } = getLocators(page);

  await dismissConsentModal(page, onStep);

  const btnSalvarFotos = album.salvarFotos.first();
  const btnSalvar = album.salvar.first();
  const alvo = (await isVisible(btnSalvarFotos)) ? btnSalvarFotos : btnSalvar;

  if (!(await isVisible(alvo))) {
    logStep('Upload concluído (sem botão Salvar nesta tela).', onStep);
    return;
  }

  logStep('Salvando...', onStep);

  await waitVisible(alvo, {
    etapa: 'salvar',
    mensagem: 'Não foi possível localizar o botão "Salvar Fotos".',
  });

  await alvo.click();
  await album.uploadModal.waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT }).catch(() => {});
  await album.sucesso.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  logStep('Automação concluída.', onStep);
}

function tituloAlbum(restauracao) {
  const texto = String(restauracao).trim();
  if (/^restauração/i.test(texto)) return texto;
  return `Restauração ${texto}`;
}

function descricaoAlbum() {
  const formatado = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

  return formatado.replace(', ', ' ');
}

async function albumJaExiste(album, restauracao) {
  return album.restauracaoLi(restauracao)
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
}

async function cadastrarNovoAlbum(page, tarefa, onStep) {
  const { album } = getLocators(page);

  if (!tarefa.restauracao) return;

  if (await albumJaExiste(album, tarefa.restauracao)) {
    logStep('Álbum da restauração já existe.', onStep);
    return;
  }

  logStep('Álbum não encontrado — cadastrando novo...', onStep);
  await dismissConsentModal(page, onStep);

  const btnNovo = await waitVisible(album.novoAlbum, {
    etapa: 'novo álbum',
    mensagem: 'Não foi possível localizar o botão "Novo Álbum" (#MainAdd).',
  });

  const modalWait = album.cadastroAlbumModal.waitFor({ state: 'visible', timeout: MODAL_TIMEOUT });
  await btnNovo.click();
  await modalWait;

  const titulo = tituloAlbum(tarefa.restauracao);
  const descricao = descricaoAlbum();

  logStep(`Preenchendo título: ${titulo}`, onStep);
  await album.cadastroTitulo.fill(titulo);

  logStep(`Preenchendo informações: ${descricao}`, onStep);
  await album.cadastroDescricao.fill(descricao);

  logStep('Salvando cadastro do álbum...', onStep);
  await album.salvarCadastro.click();
  await album.cadastroAlbumModal.waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT });

  await waitVisible(album.restauracaoLi(tarefa.restauracao), {
    etapa: 'cadastro de álbum',
    mensagem: `O álbum "${titulo}" não apareceu na lista após salvar.`,
  });

  logStep('Álbum cadastrado com sucesso.', onStep);
}

async function createAlbum(page, tarefa, fotoPath, onStep) {
  const { album } = getLocators(page);

  logStep('Localizando álbum da restauração...', onStep);
  await dismissConsentModal(page, onStep);

  await cadastrarNovoAlbum(page, tarefa, onStep);

  if (tarefa.restauracao) {
    await selectRestauracao(page, tarefa.restauracao, onStep);
  }

  await uploadPhoto(page, tarefa, fotoPath, onStep);
  await saveAlbum(page, onStep);
}

module.exports = {
  openSystem,
  ensureLogged,
  dismissConsentModal,
  searchPatient,
  openClinicalData,
  openPhotoAlbum,
  createAlbum,
  logStep,
};
