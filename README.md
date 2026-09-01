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

1. Copie `.env` e preencha as URLs:

```env
API_URL=https://webhook.artdental.com.br
AGENT_TOKEN=cole_aqui_o_agent_poll_token
CODONTO_URL=https://app.codonto.com.br
POLL_INTERVAL=15
```

O `AGENT_TOKEN` também pode ser informado na tela inicial. Nesse caso, o Electron
o criptografa com a proteção do sistema operacional e o persiste no `config.json`
do usuário; o valor não volta a ser exibido pela interface. Sem token, o agente
permanece parado com o estado **Configuração necessária**.

Quando `AGENT_TOKEN` estiver preenchido no `.env`, ele tem prioridade e a edição
pela tela fica bloqueada. Para permitir que o próprio usuário configure o token,
deixe essa variável vazia ou remova-a do `.env`.

2. Instale as dependências:

```bash
pnpm install
pnpm exec playwright install chromium
```

3. Rode em desenvolvimento:

```bash
pnpm run dev
```

---

## ⚠️ Mapeamento dos seletores do Codonto

O arquivo `src/main/codontoAutomation.js` contém os passos da automação,
mas os seletores CSS/XPath precisam ser mapeados na interface real do Codonto.

### Como mapear

Use o Playwright Inspector para gravar os cliques:

```bash
pnpm exec playwright codegen https://app.codonto.com.br
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
pnpm run build

# Gera: dist/Codonto Sync Setup X.Y.Z.exe
```

O instalador NSIS inclui opção de pasta e configura autostart no Windows.

## Atualizações

Para publicar uma atualização, aumente a versão, envie a branch principal e depois
envie a tag correspondente:

```bash
pnpm version patch
git push origin main
git push origin v3.0.2
```

A tag deve corresponder à versão em `package.json`. Ao receber uma tag `v*`, o
workflow publica automaticamente o instalador Windows e seus arquivos de atualização.
O primeiro instalador com suporte ao atualizador é o `3.0.1`; para testar uma atualização
de ponta a ponta, publique uma versão posterior, como `3.0.2`.

Enviar uma tag é uma ação de release separada e não faz parte do desenvolvimento comum.

---

## Logs

Os logs ficam em:
- **Windows:** `%APPDATA%\codonto-sync\logs\`
- **Mac:** `~/Library/Application Support/codonto-sync/logs/`

Ou clique em **"Abrir pasta de logs"** na interface do agente.
