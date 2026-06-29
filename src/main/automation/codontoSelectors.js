/**
 * Seletores e localizadores do Codonto.
 * Ajuste aqui quando a interface mudar — o fluxo em codontoSteps.js permanece estável.
 */

function escapeRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TIPO_FOTO_MAP = {
  INICIAL: 'inicial',
  FINAL: 'final',
  INTERMEDIARIA: 'intermediaria',
  CONTROLE: 'controle',
};

function cadastroAlbumFormRoot(page) {
  return page.locator('form#FormAlbum');
}

function cadastroAlbumModalRoot(page) {
  return page.locator('div.modal').filter({
    has: page.locator('form#FormAlbum'),
  }).last();
}

function uploadModalRoot(page) {
  return page.locator('div.modal').filter({
    has: page.locator('.modal-bar h3', { hasText: /upload de fotos/i }),
  }).last();
}

function getLocators(page) {
  const uploadModal = uploadModalRoot(page);
  const cadastroAlbumForm = cadastroAlbumFormRoot(page);
  const cadastroAlbumModal = cadastroAlbumModalRoot(page);

  return {
    loggedIn: {
      searchPatient: page.getByRole('textbox', { name: /pesquisar paciente/i })
        .or(page.getByPlaceholder(/pesquisar paciente/i))
        .or(page.locator('input[placeholder*="Pesquisar" i], input[placeholder*="paciente" i]').first()),
      sidebar: page.locator('nav, aside, [class*="sidebar"], [class*="menu-lateral"]').first(),
    },
    login: {
      username: page.getByRole('textbox', { name: /nome de usuário/i }),
      password: page.getByRole('textbox', { name: /senha/i }),
    },
    consent: {
      confirmButton: page.locator('.swal2-confirm.swal-consent-confirm'),
    },
    reminders: {
      popup: page.locator('.swal2-popup.swal2-show').filter({
        has: page.locator('#swal2-title', { hasText: /alerta de lembretes/i }),
      }),
      confirmButton: page.locator('.swal2-popup.swal2-show')
        .filter({ has: page.locator('#swal2-title', { hasText: /alerta de lembretes/i }) })
        .locator('button.swal2-confirm'),
    },
    modals: {
      visiblePopup: page.locator('.swal2-popup.swal2-show'),
      blockingOverlay: page.locator('.swal2-popup.swal2-show'),
      genericConfirm: page.locator('.swal2-popup.swal2-show button.swal2-confirm').first(),
    },
    patient: {
      dropdown: page.locator('.sc-dropdown--open'),
      firstResult: page.locator('.sc-dropdown--open .sc-item').first(),
      byProntuario: (codigo) =>
        page.locator('.sc-dropdown--open .sc-item').filter({
          has: page.locator('.sc-code', { hasText: String(codigo) }),
        }).first(),
    },
    clinical: {
      dadosClinicos: page.getByRole('link', { name: /dados clínicos/i })
        .or(page.getByRole('button', { name: /dados clínicos/i }))
        .or(page.getByText(/dados clínicos/i).first()),
    },
    album: {
      abasAlbum: page.getByRole('link', { name: /álbum|álbuns|fotos/i })
        .or(page.getByRole('button', { name: /álbum|álbuns|fotos/i }))
        .or(page.getByText(/álbuns?/i).first()),
      novoAlbum: page.locator('#MainAdd[title="Cadastrar novo Album"]')
        .or(page.locator('#MainAdd'))
        .or(page.getByRole('link', { name: /novo álbum/i }))
        .or(page.locator('a.button.icon-plus-round[title*="Album"]')),
      cadastroAlbumForm,
      cadastroAlbumModal,
      cadastroTitulo: cadastroAlbumForm.locator('#Titulo'),
      cadastroDescricao: cadastroAlbumForm.locator('#Descricao'),
      salvarCadastro: cadastroAlbumModal
        .locator('button.btn-primary').filter({ hasText: /salvar cadastro/i })
        .or(page.getByRole('button', { name: /salvar cadastro/i })),
      restauracaoAlbum: (codigo) =>
        page.locator('span.album.pointer').filter({
          has: page.locator('.big-text.text-primary', { hasText: String(codigo) }),
        }).first(),
      restauracaoLi: (codigo, opcoes = {}) => {
        const legado = opcoes.legado !== false;
        const texto = escapeRegex(String(codigo).trim()).replace(/\s+/g, '\\s+');
        const pattern = legado
          ? new RegExp(`Restauração\\s+${texto}`, 'i')
          : new RegExp(`^${texto}$`, 'i');
        return page.locator('li[class*="expandable"]').filter({
          has: page.locator('span.big-text.text-primary', { hasText: pattern }),
        }).first();
      },
      incluirFotosByItemId: (itemId) =>
        page.locator(
          `span.button-group[data-itemid="${itemId}"] a.carregar[title="Incluir Novas Fotos"]`
        ).first(),
      incluirFotosIn: (li) =>
        li.locator('.pa-toolbar a.button.carregar[title="Incluir Novas Fotos"]').first(),
      adicionarFoto: page.locator('a.button.carregar[title="Incluir Novas Fotos"]'),
      uploadModal,
      uploadForm: uploadModal.locator('form#FormFoto'),
      uploadTabArquivos: uploadModal.locator('#BtnSourceFile'),
      dropZone: uploadModal.locator('#DropZone'),
      browseFileInput: uploadModal.locator('#BrowseFiles input[type="file"]'),
      inputFile: uploadModal.locator('input[type="file"]'),
      uploadPreviewDone: uploadModal.locator('#PreviewGrid .pa-upload__preview-item.is--done'),
      uploadPreviewArea: uploadModal.locator('#PreviewArea.has--items'),
      selectTipo: page.locator('#select-tipo-foto, select[name*="tipo"]').first(),
      preview: uploadModal.locator('#PreviewGrid .pa-upload__preview-item__thumb img').first(),
      salvarFotos: uploadModal.locator('button.dialog-button-save'),
      fecharUpload: uploadModal.locator('.modal-buttons button.icon-cross'),
      salvar: page.getByRole('button', { name: /^salvar$/i })
        .or(page.locator('[data-action="salvar"]')),
      sucesso: page.locator('.alerta-sucesso, .toast-success, .swal2-success').first(),
    },
  };
}

module.exports = { getLocators, TIPO_FOTO_MAP };
