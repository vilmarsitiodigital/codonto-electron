# Codonto Sync — Agente Windows

Agente local que faz polling da API do backend e executa a automação no Codonto via Playwright.

## Estrutura

```
codonto-electron/
├── src/
│   ├── main/
│   │   ├── index.js            # Processo principal Electron (janela, tray, IPC)
│   │   ├── worker.js           # Loop de polling + orquestração de tarefas
│   │   ├── apiClient.js        # Consome a REST API do backend (VPS)
│   │   ├── codontoAutomation.js # Automação Playwright no Codonto ⚠️
│   │   └── logger.js           # Winston — logs em AppData/logs/
│   ├── preload/
│   │   └── index.js            # Bridge segura main ↔ renderer
│   └── renderer/
│       └── index.html          # Interface visual do agente
├── assets/
│   ├── icon.png                # Ícone do app (256x256 PNG, bandeja e janela)
│   ├── icon.ico                # Build Windows
│   └── icon.icns               # Build macOS
├── .env                        # Configurações locais
└── package.json
```

## Configuração

1. Copie `.env` e preencha:

```env
API_URL=https://webhook.artdental.com.br
AGENT_TOKEN=cole_aqui_o_agent_poll_token
CODONTO_URL=https://app.codonto.com.br
POLL_INTERVAL=15
```

2. Instale as dependências:

```bash
npm install
npx playwright install chromium
```

3. Rode em desenvolvimento:

```bash
npm start
```

---

## ⚠️ Mapeamento dos seletores do Codonto

O arquivo `src/main/codontoAutomation.js` contém os passos da automação,
mas os seletores CSS/XPath precisam ser mapeados na interface real do Codonto.

### Como mapear

Use o Playwright Inspector para gravar os cliques:

```bash
npx playwright codegen https://app.codonto.com.br
```

Isso abre o Codonto no Chrome com gravação automática. Faça o fluxo manualmente:
1. Pesquisar paciente pelo prontuário
2. Clicar no paciente
3. Navegar até restaurações
4. Clicar na restauração
5. Clicar em "adicionar foto"
6. Selecionar tipo de foto
7. Fazer upload
8. Salvar

O Inspector gera o código Playwright automaticamente. Substitua os seletores
marcados com `⚠️` no `codontoAutomation.js` pelos gerados.

---

## Build do instalador Windows

```bash
# No Windows ou via CI
npm run build

# Gera: dist/Codonto Sync Setup 1.0.0.exe
```

O instalador NSIS inclui opção de pasta e configura autostart no Windows.

---

## Logs

Os logs ficam em:
- **Windows:** `%APPDATA%\codonto-sync\logs\`
- **Mac:** `~/Library/Application Support/codonto-sync/logs/`

Ou clique em **"Abrir pasta de logs"** na interface do agente.
