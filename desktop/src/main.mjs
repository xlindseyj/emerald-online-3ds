import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createLocalBackup, inspectLocalBackup, restoreLocalBackup, deleteLocalData } from './data-manager.mjs';
import { appendDiagnostic, createDiagnosticReport, markLauncherCleanExit, markLauncherStarted } from './diagnostics.mjs';
import { checkForUpdate, downloadVerifiedUpdate } from './update-manager.mjs';

let fatalCrash = false;
process.on('uncaughtException', (err) => {
  fatalCrash = true;
  console.error('Uncaught exception:', err);
  try { appendDiagnostic('launcher-fatal-error', { message: err.message }); } catch {}
  try {
    dialog.showErrorBox('Emerald Online 3DS', `Unexpected error: ${err.message}`);
  } catch {}
  app.quit();
});
import { readConfig, writeConfig, normalizeConfig } from './config-store.mjs';
import { validateRom } from './rom-validator.mjs';
import {
  writeOnlineConfig,
  setupVirtualSd,
  launchAzahar,
  getVirtualSdPath,
  getRomPath,
  getLauncherStatus
} from './azahar-launcher.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let emulatorProcess = null;
let quitting = false;
let previousUncleanExit = false;
let pendingRelease = null;
const MAX_EMULATOR_OUTPUT_LOG_CHARS = 700;

const allowedExternalUrls = new Set([
  'https://emeraldonline3ds.com/',
  'https://emeraldonline3ds.com/community',
  'https://emeraldonline3ds.com/status'
]);

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    title: 'Emerald Online 3DS',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0a1f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (!app.isPackaged && input.key === 'F12' && input.type === 'keyUp') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

if (primaryInstance) app.whenReady().then(() => {
  process.env.ELECTRON_USER_DATA_PATH = app.getPath('userData');
  const startup = markLauncherStarted(app.getVersion());
  previousUncleanExit = startup.previousUncleanExit;
  appendDiagnostic('launcher-started', { appVersion: app.getVersion(), previousUncleanExit });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error('Failed to start Emerald Online 3DS:', err);
  dialog.showErrorBox('Emerald Online 3DS', `Failed to start: ${err.message}`);
  app.quit();
});

app.on('window-all-closed', async () => {
  quitting = true;
  await terminateEmulator();
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (emulatorProcess && !emulatorProcess.killed) emulatorProcess.kill();
  if (!fatalCrash) {
    try { markLauncherCleanExit(); } catch {}
  }
});

async function terminateEmulator() {
  if (!emulatorProcess || emulatorProcess.killed) return;
  const child = emulatorProcess;
  child.kill();
  await new Promise(resolve => setTimeout(resolve, 500));
  if (child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch {}
  }
  if (emulatorProcess === child) emulatorProcess = null;
}

function sendLog(message) {
  try { appendDiagnostic('launcher-message', { message }); } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher-log', message);
  }
}

function normalizeEmulatorMessage(stream, data) {
  const text = String(data ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ')
    .slice(0, MAX_EMULATOR_OUTPUT_LOG_CHARS);
  return text ? `${stream}: ${text}` : '';
}

function bindEmulatorOutput(child) {
  const removeListeners = [];

  if (child.stdout) {
    const onStdout = (data) => {
      const message = normalizeEmulatorMessage('Azahar stdout', data);
      if (!message) return;
      try { appendDiagnostic('emulator-stdout', { message }); } catch {}
      sendLog(message);
    };
    child.stdout.on('data', onStdout);
    removeListeners.push(() => child.stdout?.off('data', onStdout));
  }

  if (child.stderr) {
    const onStderr = (data) => {
      const message = normalizeEmulatorMessage('Azahar stderr', data);
      if (!message) return;
      try { appendDiagnostic('emulator-stderr', { message }); } catch {}
      sendLog(message);
    };
    child.stderr.on('data', onStderr);
    removeListeners.push(() => child.stderr?.off('data', onStderr));
  }

  child.once('exit', () => {
    for (const removeListener of removeListeners) removeListener();
  });
  child.once('error', () => {
    for (const removeListener of removeListeners) removeListener();
  });

  return removeListeners;
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Rejected an untrusted launcher request.');
    return callback(...args);
  });
}

handle('get-version', () => app.getVersion());

handle('get-config', () => readConfig());

handle('set-config', (incoming) => {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('Invalid settings payload.');
  return writeConfig(normalizeConfig({ ...readConfig(), ...incoming }));
});

handle('select-rom', async () => {
  if (!mainWindow) throw new Error('Window not ready');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your legally obtained Pokémon Emerald ROM',
    filters: [{ name: 'GBA ROM', extensions: ['gba'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const filePath = result.filePaths[0];
  sendLog('Validating the selected ROM locally...');

  let info;
  try {
    info = await validateRom(filePath);
  } catch (err) {
    return { canceled: true, error: err.message };
  }

  if (!info.supported) {
    return {
      canceled: true,
      error: 'This is not the supported unmodified Pokémon Emerald (U) revision. No file was copied.'
    };
  }

  try {
    setupVirtualSd(filePath);
    const config = readConfig();
    writeOnlineConfig(config);
    sendLog('ROM accepted and copied to virtual SD card.');
    return { canceled: false, info: { title: info.title, gameCode: info.gameCode } };
  } catch (err) {
    return { canceled: true, error: err.message };
  }
});

handle('get-rom-status', async () => {
  const rom = getRomPath();
  if (!fs.existsSync(rom)) return { present: false, valid: false };
  try {
    const info = await validateRom(rom);
    return { present: true, valid: info.supported };
  } catch {
    return { present: true, valid: false };
  }
});

handle('get-launcher-status', () => {
  const status = getLauncherStatus();
  return {
    azaharReady: status.azaharReady,
    runtimeReady: status.runtimeReady,
    platformSupported: status.platformSupported,
    previousUncleanExit
  };
});

handle('launch-emulator', async () => {
  if (!fs.existsSync(getRomPath())) {
    throw new Error('No ROM configured. Select a ROM before launching.');
  }
  const romInfo = await validateRom(getRomPath());
  if (!romInfo.supported) throw new Error('The configured ROM is missing, changed, or unsupported. Select it again.');

  await terminateEmulator();

  const config = readConfig();
  writeOnlineConfig(config);
  sendLog('Launching Azahar...');

  try {
    emulatorProcess = launchAzahar();
  } catch (err) {
    throw new Error(`Failed to launch emulator: ${err.message}`);
  }

  const child = emulatorProcess;
  const detachOutputHandlers = bindEmulatorOutput(child);
  appendDiagnostic('emulator-started', { pid: child.pid });
  child.on('exit', (code) => {
    appendDiagnostic(code === 0 ? 'emulator-exited' : 'emulator-crashed', { exitCode: code ?? 'unknown' });
    for (const removeListener of detachOutputHandlers) removeListener();
    sendLog(`Azahar exited with code ${code ?? 'unknown'}.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('emulator-exited', code);
    }
    if (emulatorProcess === child) emulatorProcess = null;
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  child.on('error', (err) => {
    appendDiagnostic('emulator-launch-error', { message: err.message });
    for (const removeListener of detachOutputHandlers) removeListener();
    if (emulatorProcess === child) emulatorProcess = null;
    sendLog(`Azahar error: ${err.message}`);
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  return { launched: true, pid: child.pid };
});

handle('open-data-folder', async () => {
  const dataPath = getVirtualSdPath();
  fs.mkdirSync(dataPath, { recursive: true });
  const error = await shell.openPath(dataPath);
  if (error) throw new Error(`Could not open the local data folder: ${error}`);
  return true;
});

handle('backup-local-data', async () => {
  if (!mainWindow) throw new Error('Window not ready.');
  if (emulatorProcess && !emulatorProcess.killed) throw new Error('Close Azahar before backing up local data.');
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Create a private local backup',
    defaultPath: path.join(app.getPath('documents'), `EmeraldOnline3DS-${date}.eobackup`),
    filters: [{ name: 'Emerald Online 3DS backup', extensions: ['eobackup'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const backup = createLocalBackup(result.filePath);
  appendDiagnostic('local-backup-created', { files: backup.files, bytes: backup.bytes, includesIdentity: backup.includesIdentity });
  return { canceled: false, files: backup.files, bytes: backup.bytes, includesIdentity: backup.includesIdentity };
});

handle('restore-local-data', async () => {
  if (!mainWindow) throw new Error('Window not ready.');
  if (emulatorProcess && !emulatorProcess.killed) throw new Error('Close Azahar before restoring local data.');
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore a private local backup',
    filters: [{ name: 'Emerald Online 3DS backup', extensions: ['eobackup'] }],
    properties: ['openFile']
  });
  if (selection.canceled || selection.filePaths.length === 0) return { canceled: true };
  const sourcePath = selection.filePaths[0];
  const inspected = inspectLocalBackup(sourcePath);
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Restore local data?',
    message: 'Existing save, identity, and settings files may be replaced.',
    detail: `${inspected.summary.fileCount} verified files will be restored. The backup contains no ROM. Back up the current data first if you may need it.`,
    buttons: ['Cancel', 'Restore verified backup'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { canceled: true };
  const restored = restoreLocalBackup(sourcePath);
  appendDiagnostic('local-backup-restored', { files: restored.fileCount, bytes: restored.bytes, includesIdentity: restored.includesIdentity });
  return { canceled: false, ...restored };
});

handle('delete-local-data', async () => {
  if (!mainWindow) throw new Error('Window not ready.');
  if (emulatorProcess && !emulatorProcess.killed) throw new Error('Close Azahar before deleting local data.');
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Delete all local game data?',
    message: 'This removes the ROM, save, online identity, settings, logs, and downloaded updates from this launcher.',
    detail: 'This cannot be undone. Backups saved outside the application-data folder are not deleted. SSD and filesystem behavior means this is deletion, not a guaranteed forensic secure erase.',
    buttons: ['Cancel', 'Delete local data'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { canceled: true };
  appendDiagnostic('local-data-deletion-confirmed');
  const deleted = deleteLocalData();
  previousUncleanExit = false;
  return { canceled: false, ...deleted };
});

handle('export-diagnostics', async () => {
  if (!mainWindow) throw new Error('Window not ready.');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export privacy-safe diagnostics',
    defaultPath: path.join(app.getPath('documents'), `EmeraldOnline3DS-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`),
    filters: [{ name: 'Text report', extensions: ['txt'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const launcher = getLauncherStatus();
  const report = createDiagnosticReport(result.filePath, {
    appVersion: app.getVersion(),
    azaharReady: launcher.azaharReady,
    runtimeReady: launcher.runtimeReady,
    romPresent: fs.existsSync(getRomPath())
  });
  appendDiagnostic('diagnostics-exported', { bytes: report.bytes, eventsIncluded: report.eventsIncluded });
  return { canceled: false, bytes: report.bytes, eventsIncluded: report.eventsIncluded };
});

handle('check-for-update', async () => {
  pendingRelease = await checkForUpdate(app.getVersion());
  appendDiagnostic('update-checked', { currentVersion: app.getVersion(), availableVersion: pendingRelease.version, updateAvailable: pendingRelease.updateAvailable });
  return { version: pendingRelease.version, updateAvailable: pendingRelease.updateAvailable, releaseNotesUrl: pendingRelease.releaseNotesUrl };
});

handle('download-update', async () => {
  if (!mainWindow) throw new Error('Window not ready.');
  if (!pendingRelease?.updateAvailable) throw new Error('Check for updates before downloading.');
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: `Download Emerald Online 3DS ${pendingRelease.version}?`,
    message: 'The installer will be downloaded from emeraldonline3ds.com.',
    detail: 'The launcher will verify its SHA-256 checksum and require a valid Windows Authenticode signature before offering to open it.',
    buttons: ['Cancel', 'Download and verify'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { canceled: true };
  const downloaded = await downloadVerifiedUpdate(pendingRelease, {
    onProgress: progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-progress', progress);
    }
  });
  appendDiagnostic('update-verified', { version: downloaded.version, signer: downloaded.signer, checksum: downloaded.checksum });
  const openConfirmation = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Verified update ready',
    message: `Emerald Online 3DS ${downloaded.version} was downloaded and verified.`,
    detail: `Windows reports a valid signature from ${downloaded.signer}. Open the installer now?`,
    buttons: ['Later', 'Open installer'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (openConfirmation.response === 1) {
    const error = await shell.openPath(downloaded.path);
    if (error) throw new Error(`Could not open the verified installer: ${error}`);
  }
  return { canceled: false, version: downloaded.version, signer: downloaded.signer, opened: openConfirmation.response === 1 };
});

handle('open-external', async (url) => {
  if (!allowedExternalUrls.has(url)) throw new Error('This link is not allowed.');
  await shell.openExternal(url);
  return true;
});
