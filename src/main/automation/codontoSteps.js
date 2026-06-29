const logger = require('../logger');
const { AutomationError, LOGIN_REQUIRED_MESSAGE } = require('./AutomationError');
const { getLocators, TIPO_FOTO_MAP } = require('./codontoSelectors');

const AUTH_CHECK_TIMEOUT = 30000;
const DEFAULT_TIMEOUT = 15000;
const NAV_TIMEOUT = 8000;
const MODAL_TIMEOUT = 30000;
const UPLOAD_TIMEOUT = 60000;
const RESET_TIMEOUT = 30000;
const SEARCH_FIELD_TIMEOUT = 45000;
const SEARCH_RETRY_INTERVAL_MS = 500;

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

async function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidatosCampoBusca(page) {
  const { loggedIn } = getLocators(page);
  return [
    page.getByRole('textbox', { name: /pesquisar paciente/i }),
    page.getByPlaceholder(/pesquisar paciente/i),
    page.getByLabel(/pesquisar paciente/i),
    page.locator('input[placeholder*="Pesquisar" i], input[placeholder*="paciente" i]'),
    page.locator('.sc-dropdown input[type="text"], .sc-dropdown input:not([type="hidden"])'),
    page.locator('[class*="search"] input[type="text"], [id*="search" i] input'),
    loggedIn.searchPatient,
  ];
}

async function encontrarCampoBuscaPaciente(page) {
  for (const candidato of candidatosCampoBusca(page)) {
    const visivel = await isVisible(candidato);
    const habilitado = visivel && await candidato.isEnabled().catch(() => false);
    if (visivel && habilitado) {
      return candidato;
    }
  }
  return null;
}

async function dismissAnyBlockingSwal(page, onStep) {
  const { modals } = getLocators(page);
  const popup = modals.visiblePopup;

  if (!(await isVisible(popup))) {
    return false;
  }

  const confirm = popup.locator('button.swal2-confirm').first();
  if (await isVisible(confirm)) {
    const texto = await confirm.textContent().catch(() => '');
    const descricao = texto?.trim() ? `Modal: "${texto.trim()}"` : 'Modal do sistema';
    return dismissSwalModal(page, confirm, descricao, onStep);
  }

  const fechar = popup.locator('button.swal2-close').first();
  if (await isVisible(fechar)) {
    logStep('Fechando modal do sistema...', onStep);
    await fechar.click();
    await popup.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    return true;
  }

  return false;
}

/**
 * Aguarda o campo de busca estar visível, sem overlay bloqueando e pronto para digitação.
 * Fecha modais (consentimento, lembretes) durante a espera — comum após reload.
 */
async function aguardarCampoBuscaPaciente(page, onStep, timeout = SEARCH_FIELD_TIMEOUT, url = null) {
  const { login } = getLocators(page);
  const deadline = Date.now() + timeout;
  let recarregou = false;

  while (Date.now() < deadline) {
    await dismissConsentModal(page, onStep);
    await dismissAnyBlockingSwal(page, onStep);

    if (await isVisible(login.username)) {
      throw new AutomationError(LOGIN_REQUIRED_MESSAGE, {
        code: 'LOGIN_REQUIRED',
        etapa: 'autenticação',
      });
    }

    const campo = await encontrarCampoBuscaPaciente(page);
    if (campo) {
      return campo;
    }

    const restante = deadline - Date.now();
    if (!recarregou && url && restante < timeout / 2) {
      recarregou = true;
      logStep('Campo de busca não encontrado — recarregando página...', onStep);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RESET_TIMEOUT }).catch(() => {});
      await page.waitForLoadState('load', { timeout: RESET_TIMEOUT }).catch(() => {});
    }

    await aguardar(SEARCH_RETRY_INTERVAL_MS);
  }

  throw new AutomationError(
    'Não foi possível localizar o campo "Pesquisar Paciente".\n\n' +
      'Verifique se o usuário continua logado e se nenhum modal está bloqueando a tela.',
    { etapa: 'pesquisa de paciente' }
  );
}

async function preencherCampoBusca(page, prontuario, onStep) {
  const valor = String(prontuario);
  const deadline = Date.now() + SEARCH_FIELD_TIMEOUT;
  let ultimoErro;

  while (Date.now() < deadline) {
    await dismissConsentModal(page, onStep);
    await dismissAnyBlockingSwal(page, onStep);

    try {
      const atualizado = await aguardarCampoBuscaPaciente(page, onStep, 8000);
      await atualizado.fill(valor, { timeout: 8000 });
      return;
    } catch (err) {
      ultimoErro = err;
      if (err instanceof AutomationError && err.code === 'LOGIN_REQUIRED') {
        throw err;
      }
      await aguardar(SEARCH_RETRY_INTERVAL_MS);
    }
  }

  throw new AutomationError(
    ultimoErro?.message ||
      'Não foi possível preencher o campo "Pesquisar Paciente".\n\n' +
        'A tela pode estar bloqueada por um modal ou ainda carregando.',
    { etapa: 'pesquisa de paciente' }
  );
}

/**
 * Volta à tela inicial de busca de pacientes, isolando o próximo prontuário.
 * Chamado ao final de cada processamento — sem networkidle (instável em SPAs).
 */
async function reinicializarPagina(page, url, onStep) {
  logStep('Reinicializando página para próximo processamento...', onStep);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RESET_TIMEOUT });
  await page.waitForLoadState('load', { timeout: RESET_TIMEOUT }).catch(() => {});

  await aguardarCampoBuscaPaciente(page, onStep, RESET_TIMEOUT, url);
  logStep('Página pronta para novo processamento.', onStep);
}

async function openSystem(page, url, onStep) {
  await dismissConsentModal(page, onStep);
  await dismissAnyBlockingSwal(page, onStep);

  const campo = await encontrarCampoBuscaPaciente(page);
  if (campo) {
    logStep('Sessão já ativa — tela de busca disponível.', onStep);
    return;
  }

  logStep('Abrindo sistema...', onStep);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: RESET_TIMEOUT }).catch(() => {});
  await aguardarCampoBuscaPaciente(page, onStep, SEARCH_FIELD_TIMEOUT, url);
  logStep('Sistema carregado.', onStep);
}

async function ensureLogged(page, onStep, url = null) {
  logStep('Verificando autenticação...', onStep);
  await aguardarCampoBuscaPaciente(page, onStep, AUTH_CHECK_TIMEOUT, url);
  logStep('Usuário autenticado.', onStep);
}

async function dismissSwalModal(page, confirmButton, descricao, onStep) {
  const visible = await isVisible(confirmButton);
  if (!visible) return false;

  logStep(`${descricao} encontrado.`, onStep);
  await confirmButton.click();
  await confirmButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.locator('.swal2-container.swal2-shown, .swal2-container.swal2-backdrop-show')
    .waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => {});
  logStep('Modal fechado.', onStep);
  return true;
}

async function dismissConsentModal(page, onStep) {
  const { consent, reminders } = getLocators(page);

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const fechouConsent = await dismissSwalModal(
      page,
      consent.confirmButton,
      'Modal de consentimento',
      onStep
    );
    const fechouLembretes = await dismissSwalModal(
      page,
      reminders.confirmButton,
      'Alerta de Lembretes',
      onStep
    );
    const fechouGenerico = await dismissAnyBlockingSwal(page, onStep);

    if (!fechouConsent && !fechouLembretes && !fechouGenerico) break;
  }
}

async function searchPatient(page, prontuario, onStep) {
  const { patient, clinical } = getLocators(page);

  logStep(`Pesquisando paciente ${prontuario}...`, onStep);

  await preencherCampoBusca(page, prontuario, onStep);

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

async function selectRestauracao(page, albumRef, onStep) {
  if (!albumRef) return null;

  const { album } = getLocators(page);
  logStep(`Selecionando álbum ${albumRef.titulo}...`, onStep);

  const li = album.restauracaoLi(albumRef.codigo, { legado: albumRef.legado });
  await waitVisible(li, {
    etapa: 'álbum',
    mensagem: `Não foi possível localizar o álbum "${albumRef.titulo}".`,
  });

  await dismissConsentModal(page, onStep);
  return li;
}

async function clickIncluirFotos(page, li, albumRef, onStep) {
  const { album } = getLocators(page);

  const itemId = await li.getAttribute('data-id', { timeout: 5000 }).catch(() => null);

  await expandAlbumPanel(li, album, itemId);

  const btnIncluir = resolveIncluirButton(page, itemId, li, album);

  try {
    await btnIncluir.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  } catch {
    throw new AutomationError(
      `Não foi possível localizar o botão "Incluir Novas Fotos" no álbum "${albumRef.titulo}".\n\n` +
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

  const albumRef = albumDaTarefa(tarefa);

  if (albumRef) {
    const li = album.restauracaoLi(albumRef.codigo, { legado: albumRef.legado });
    await waitVisible(li, {
      etapa: 'álbum',
      mensagem: `Não foi possível localizar o álbum "${albumRef.titulo}".`,
    });
    await clickIncluirFotos(page, li, albumRef, onStep);
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

function tituloAlbumLegado(restauracao) {
  const texto = String(restauracao).trim();
  if (/^restauração/i.test(texto)) return texto;
  return `Restauração ${texto}`;
}

function albumDaTarefa(tarefa) {
  if (tarefa.titulo_album) {
    const titulo = String(tarefa.titulo_album).trim();
    return { titulo, codigo: titulo, legado: false };
  }
  if (tarefa.restauracao) {
    const codigo = String(tarefa.restauracao).trim();
    return { titulo: tituloAlbumLegado(codigo), codigo, legado: true };
  }
  return null;
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

async function albumJaExiste(album, albumRef) {
  return album.restauracaoLi(albumRef.codigo, { legado: albumRef.legado })
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
}

async function preencherCampoAlbum(locator, valor, { etapa, mensagem, onStep, rotulo }) {
  const texto = String(valor);
  await waitVisible(locator, {
    etapa,
    mensagem: mensagem || `Não foi possível localizar o campo "${rotulo}".`,
  });

  await locator.click();
  await locator.fill('');
  await locator.fill(texto);

  const atual = await locator.inputValue().catch(() => '');
  if (atual !== texto) {
    throw new AutomationError(
      `Não foi possível preencher o campo "${rotulo}".\n\n` +
        `Esperado: "${texto}"\nObtido: "${atual}"`,
      { etapa }
    );
  }

  logStep(`${rotulo} preenchido: ${texto}`, onStep);
}

async function cadastrarNovoAlbum(page, tarefa, onStep) {
  const { album } = getLocators(page);
  const albumRef = albumDaTarefa(tarefa);

  if (!albumRef) return;

  if (await albumJaExiste(album, albumRef)) {
    logStep('Álbum já existe.', onStep);
    return;
  }

  logStep('Álbum não encontrado — cadastrando novo...', onStep);
  await dismissConsentModal(page, onStep);

  const btnNovo = await waitVisible(album.novoAlbum, {
    etapa: 'novo álbum',
    mensagem: 'Não foi possível localizar o botão "Novo Álbum" (#MainAdd).',
  });

  const formWait = album.cadastroAlbumForm.waitFor({ state: 'visible', timeout: MODAL_TIMEOUT });
  await btnNovo.click();
  await formWait;

  const titulo = albumRef.titulo.slice(0, 40);
  const descricao = descricaoAlbum();

  await preencherCampoAlbum(album.cadastroTitulo, titulo, {
    etapa: 'novo álbum',
    rotulo: 'Título',
    onStep,
  });

  logStep(`Preenchendo informações adicionais: ${descricao}`, onStep);
  await album.cadastroDescricao.fill(descricao);

  logStep('Salvando cadastro do álbum...', onStep);
  const btnSalvar = await waitVisible(album.salvarCadastro.first(), {
    etapa: 'novo álbum',
    mensagem: 'Não foi possível localizar o botão "Salvar cadastro".',
  });
  await btnSalvar.click();

  await album.cadastroAlbumForm.waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT }).catch(() => {
    return album.cadastroAlbumModal.waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT });
  });

  await waitVisible(album.restauracaoLi(albumRef.codigo, { legado: albumRef.legado }), {
    etapa: 'cadastro de álbum',
    mensagem: `O álbum "${titulo}" não apareceu na lista após salvar.`,
  });

  logStep('Álbum cadastrado com sucesso.', onStep);
}

async function createAlbum(page, tarefa, fotoPath, onStep) {
  const { album } = getLocators(page);

  logStep('Localizando álbum...', onStep);
  await dismissConsentModal(page, onStep);

  await cadastrarNovoAlbum(page, tarefa, onStep);

  const albumRef = albumDaTarefa(tarefa);
  if (albumRef) {
    await selectRestauracao(page, albumRef, onStep);
  }

  await uploadPhoto(page, tarefa, fotoPath, onStep);
  await saveAlbum(page, onStep);
}

module.exports = {
  openSystem,
  reinicializarPagina,
  ensureLogged,
  dismissConsentModal,
  searchPatient,
  openClinicalData,
  openPhotoAlbum,
  createAlbum,
  logStep,
};
