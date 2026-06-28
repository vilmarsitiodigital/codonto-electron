require('dotenv').config();
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const worker = require('./worker');
const { fecharBrowser } = require('./codontoAutomation');
const { buscarStatus } = require('./apiClient');
const { getTarefasDesde, setTarefasDesde, hojeLocal, getPollInterval, setPollInterval } = require('./config');
const logger = require('./logger');

let mainWindow = null;
let tray = null;

// ─── Janela principal ─────────────────────────────────────────
function criarJanela() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 420,
    minHeight: 500,
    resizable: true,
    title: 'Codonto Sync',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimiza para bandeja em vez de fechar
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

// ─── Ícone na bandeja do sistema ──────────────────────────────
function criarTray() {
  // Usa ícone padrão do Electron se não houver assets
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath).isEmpty()
    ? nativeImage.createEmpty()
    : nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('Codonto Sync — Agente WhatsApp');

  atualizarMenuTray();

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

function atualizarMenuTray() {
  const rodando = worker.estaRodando();
  const menu = Menu.buildFromTemplate([
    { label: 'Codonto Sync', enabled: false },
    { type: 'separator' },
    {
      label: rodando ? '🟢 Agente ativo' : '🔴 Agente parado',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: rodando ? 'Pausar agente' : 'Iniciar agente',
      click: () => {
        if (rodando) worker.parar();
        else worker.iniciar();
        atualizarMenuTray();
        mainWindow?.webContents.send('agente:status', { rodando: worker.estaRodando() });
      },
    },
    { label: 'Abrir painel', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: 'Sair',
      click: async () => {
        worker.parar();
        await fecharBrowser();
        tray?.destroy();
        app.exit(0);
      },
    },
  ]);
  tray?.setContextMenu(menu);
}

// ─── IPC — comunicação main ↔ renderer ───────────────────────
ipcMain.handle('agente:iniciar', () => {
  worker.iniciar();
  atualizarMenuTray();
  return { rodando: true };
});

ipcMain.handle('agente:parar', () => {
  worker.parar();
  atualizarMenuTray();
  return { rodando: false };
});

ipcMain.handle('agente:status', () => ({
  rodando: worker.estaRodando(),
}));

ipcMain.handle('status:buscar', async () => {
  try {
    return await buscarStatus(getTarefasDesde());
  } catch {
    return [];
  }
});

ipcMain.handle('logs:abrir', () => {
  const { app: electronApp } = require('electron');
  shell.openPath(path.join(electronApp.getPath('userData'), 'logs'));
});

ipcMain.handle('config:obterDesde', () => ({
  desde: getTarefasDesde(),
  hoje: hojeLocal(),
  fixoViaEnv: Boolean(process.env.TAREFAS_DESDE),
}));

ipcMain.handle('config:definirDesde', (_, data) => {
  if (process.env.TAREFAS_DESDE) {
    throw new Error('TAREFAS_DESDE definido no .env — altere por lá');
  }
  setTarefasDesde(data);
  return { desde: getTarefasDesde() };
});

ipcMain.handle('config:obterPollInterval', () => ({
  segundos: getPollInterval(),
  fixoViaEnv: Boolean(process.env.POLL_INTERVAL),
}));

ipcMain.handle('config:definirPollInterval', (_, segundos) => {
  if (process.env.POLL_INTERVAL) {
    throw new Error('POLL_INTERVAL definido no .env — altere por lá');
  }
  setPollInterval(segundos);
  worker.atualizarIntervalo();
  return { segundos: getPollInterval() };
});

// ─── Eventos do worker → renderer ────────────────────────────
worker.onEvento((tipo, dados) => {
  mainWindow?.webContents.send('worker:evento', { tipo, dados });
  // Atualiza tooltip da bandeja com última ação
  if (tipo === 'tarefa:concluida') {
    tray?.setToolTip(`✅ Prontuário ${dados.prontuario} concluído`);
  } else if (tipo === 'tarefa:login_necessario') {
    tray?.setToolTip('🔐 Faça login no Codonto e tente novamente');
  } else if (tipo === 'tarefa:erro') {
    tray?.setToolTip(`❌ Erro na última tarefa`);
  }
  atualizarMenuTray();
});

// ─── App lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  criarJanela();
  criarTray();

  // Inicia o agente automaticamente
  worker.iniciar();

  logger.info('Codonto Sync iniciado', {
    versao: app.getVersion(),
    plataforma: process.platform,
  });
});

app.on('window-all-closed', (e) => {
  // Não encerra o app ao fechar a janela — fica na bandeja
});

app.on('before-quit', async () => {
  worker.parar();
  await fecharBrowser();
});
