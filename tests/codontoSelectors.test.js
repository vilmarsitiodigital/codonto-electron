const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const { getLocators } = require('../src/main/automation/codontoSelectors');

for (const rotulo of ['Salvar', 'Salvar cadastro']) {
  test(`localiza exclusivamente o botão ${rotulo} no modal de cadastro de álbum`, async (t) => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());

    const page = await browser.newPage();
    await page.setContent(`
      <style>
        .icon-cloud-upload::before { content: "☁"; }
      </style>
      <button type="button" class="btn-primary">${rotulo}</button>
      <div class="modal">
        <form id="FormAlbum">
          <input id="Titulo" />
          <textarea id="Descricao"></textarea>
          <button type="button" class="btn-primary">Salvar fotos</button>
          <button type="button" class="btn icon-cloud-upload btn-primary mid-margin-left">
            ${rotulo}
          </button>
        </form>
      </div>
    `);

    const { album } = getLocators(page);

    assert.equal(await album.salvarCadastro.count(), 1);
    assert.equal((await album.salvarCadastro.textContent()).trim(), rotulo);
  });
}
