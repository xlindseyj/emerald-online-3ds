const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const continueBtn = document.getElementById('continue-btn');
const changeRomBtn = document.getElementById('change-rom-btn');
const settingsBtn = document.getElementById('settings-btn');
const controlsBtn = document.getElementById('controls-btn');
const dataBtn = document.getElementById('data-btn');
const updatesBtn = document.getElementById('updates-btn');
const settingsPanel = document.getElementById('settings-panel');
const controlsPanel = document.getElementById('controls-panel');
const dataPanel = document.getElementById('data-panel');
const updatesPanel = document.getElementById('updates-panel');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const closeControlsBtn = document.getElementById('close-controls-btn');
const dataFolderBtn = document.getElementById('data-folder-btn');
const dataFolderPanelBtn = document.getElementById('data-folder-panel-btn');
const backupBtn = document.getElementById('backup-btn');
const restoreBtn = document.getElementById('restore-btn');
const deleteDataBtn = document.getElementById('delete-data-btn');
const diagnosticsBtn = document.getElementById('diagnostics-btn');
const closeDataBtn = document.getElementById('close-data-btn');
const checkUpdateBtn = document.getElementById('check-update-btn');
const downloadUpdateBtn = document.getElementById('download-update-btn');
const closeUpdatesBtn = document.getElementById('close-updates-btn');
const updateStatusEl = document.getElementById('update-status');
const recoveryNotice = document.getElementById('recovery-notice');
const logEl = document.getElementById('log');
const requirementsEl = document.getElementById('requirements');

const nameInput = document.getElementById('name-input');
const serverInput = document.getElementById('server-input');
const portInput = document.getElementById('port-input');
const transportSelect = document.getElementById('transport-select');
const pathInput = document.getElementById('path-input');
const pageSelect = document.getElementById('page-select');
const onlineCheckbox = document.getElementById('online-checkbox');

let config = null;
let romStatus = null;
let launcherStatus = null;

function showLog(message) {
  logEl.textContent = message;
  logEl.classList.add('visible');
  window.clearTimeout(showLog.timer);
  showLog.timer = window.setTimeout(() => logEl.classList.remove('visible'), 6000);
}

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

async function loadConfig() {
  config = await window.api.getConfig();
  versionEl.textContent = `v${await window.api.getVersion()}`;
  nameInput.value = config.name;
  serverInput.value = config.server;
  portInput.value = config.port;
  transportSelect.value = config.transport;
  pathInput.value = config.path;
  pageSelect.value = config.page;
  onlineCheckbox.checked = config.online;
}

async function refreshRomStatus() {
  romStatus = await window.api.getRomStatus();
  changeRomBtn.classList.toggle('hidden', !romStatus.present);

  if (romStatus.present && romStatus.valid) {
    setStatus('ROM ready. Click Play to launch.', 'ready');
    continueBtn.disabled = false;
    continueBtn.textContent = 'Play';
  } else if (romStatus.present) {
    setStatus('The configured ROM is invalid or has changed. Select it again.', 'error');
    continueBtn.disabled = false;
    continueBtn.textContent = 'Select ROM';
  } else {
    setStatus('Select your legally obtained Pokémon Emerald (U) ROM to begin.');
    continueBtn.disabled = false;
    continueBtn.textContent = 'Select ROM';
  }
}

async function refreshLauncherStatus() {
  launcherStatus = await window.api.getLauncherStatus();
  const problems = [];
  if (!launcherStatus.platformSupported) problems.push('This release supports 64-bit Windows 10 or newer.');
  if (!launcherStatus.azaharReady) problems.push('The Azahar 2126.0 emulator is missing from this installation.');
  if (!launcherStatus.runtimeReady) problems.push('The Emerald Online 3DS runtime is missing from this installation.');
  recoveryNotice.classList.toggle('hidden', !launcherStatus.previousUncleanExit);

  requirementsEl.replaceChildren();
  requirementsEl.classList.toggle('hidden', problems.length === 0);
  for (const problem of problems) {
    const item = document.createElement('p');
    item.textContent = problem;
    requirementsEl.append(item);
  }
  return problems.length === 0;
}

async function selectRom() {
  continueBtn.disabled = true;
  changeRomBtn.disabled = true;
  try {
    const result = await window.api.selectRom();
    if (result.canceled) showLog(result.error ? `ROM error: ${result.error}` : 'ROM selection canceled.');
    else showLog('ROM accepted. It stays on this computer and is never uploaded.');
  } catch (error) {
    showLog(`ROM error: ${error.message}`);
  } finally {
    await refreshRomStatus();
    changeRomBtn.disabled = false;
  }
}

async function onContinue() {
  continueBtn.disabled = true;
  if (!launcherStatus?.azaharReady || !launcherStatus?.runtimeReady || !launcherStatus?.platformSupported) {
    setStatus('This installation is incomplete. See the requirement details above.', 'error');
    continueBtn.disabled = false;
    return;
  }
  if (!romStatus?.present || !romStatus?.valid) {
    await selectRom();
    return;
  }

  try {
    const { launched } = await window.api.launchEmulator();
    if (!launched) showLog('Launch failed.');
  } catch (error) {
    showLog(`Launch error: ${error.message}`);
  } finally {
    continueBtn.disabled = false;
  }
}

async function saveSettings() {
  try {
    config = await window.api.setConfig({
      name: nameInput.value,
      server: serverInput.value,
      port: Number(portInput.value),
      transport: transportSelect.value,
      path: pathInput.value,
      page: pageSelect.value,
      online: onlineCheckbox.checked
    });
    showLog('Settings saved. They will apply on the next launch.');
    settingsPanel.classList.add('hidden');
  } catch (error) {
    showLog(`Settings error: ${error.message}`);
  }
}

continueBtn.addEventListener('click', onContinue);
changeRomBtn.addEventListener('click', selectRom);
settingsBtn.addEventListener('click', () => settingsPanel.classList.remove('hidden'));
controlsBtn.addEventListener('click', () => controlsPanel.classList.remove('hidden'));
dataBtn.addEventListener('click', () => dataPanel.classList.remove('hidden'));
updatesBtn.addEventListener('click', () => updatesPanel.classList.remove('hidden'));
saveSettingsBtn.addEventListener('click', saveSettings);
closeSettingsBtn.addEventListener('click', () => settingsPanel.classList.add('hidden'));
closeControlsBtn.addEventListener('click', () => controlsPanel.classList.add('hidden'));
closeDataBtn.addEventListener('click', () => dataPanel.classList.add('hidden'));
closeUpdatesBtn.addEventListener('click', () => updatesPanel.classList.add('hidden'));

async function openDataFolder() {
  try { await window.api.openDataFolder(); }
  catch (error) { showLog(error.message); }
}

dataFolderBtn.addEventListener('click', openDataFolder);
dataFolderPanelBtn.addEventListener('click', openDataFolder);

backupBtn.addEventListener('click', async () => {
  backupBtn.disabled = true;
  try {
    const result = await window.api.backupLocalData();
    if (!result.canceled) showLog(`Private backup created with ${result.files} files. Keep it private${result.includesIdentity ? '; it contains your online identity.' : '.'}`);
  } catch (error) { showLog(`Backup error: ${error.message}`); }
  finally { backupBtn.disabled = false; }
});

restoreBtn.addEventListener('click', async () => {
  restoreBtn.disabled = true;
  try {
    const result = await window.api.restoreLocalData();
    if (!result.canceled) {
      showLog(`Restored ${result.fileCount} verified files. The backup contained no ROM.`);
      await loadConfig();
      await refreshRomStatus();
    }
  } catch (error) { showLog(`Restore error: ${error.message}`); }
  finally { restoreBtn.disabled = false; }
});

diagnosticsBtn.addEventListener('click', async () => {
  diagnosticsBtn.disabled = true;
  try {
    const result = await window.api.exportDiagnostics();
    if (!result.canceled) showLog('Privacy-safe diagnostics exported. ROM, save, identity, settings, and user paths were excluded.');
  } catch (error) { showLog(`Diagnostics error: ${error.message}`); }
  finally { diagnosticsBtn.disabled = false; }
});

deleteDataBtn.addEventListener('click', async () => {
  deleteDataBtn.disabled = true;
  try {
    const result = await window.api.deleteLocalData();
    if (!result.canceled) {
      showLog('Local ROM, save, identity, settings, logs, and downloaded updates were deleted.');
      dataPanel.classList.add('hidden');
      recoveryNotice.classList.add('hidden');
      await loadConfig();
      await refreshRomStatus();
    }
  } catch (error) { showLog(`Delete error: ${error.message}`); }
  finally { deleteDataBtn.disabled = false; }
});

checkUpdateBtn.addEventListener('click', async () => {
  checkUpdateBtn.disabled = true;
  downloadUpdateBtn.classList.add('hidden');
  updateStatusEl.textContent = 'Checking the official release service...';
  try {
    const result = await window.api.checkForUpdate();
    if (result.updateAvailable) {
      updateStatusEl.textContent = `Version ${result.version} is available. Its installer must pass checksum and Windows signature verification.`;
      downloadUpdateBtn.classList.remove('hidden');
    } else {
      updateStatusEl.textContent = `You already have the latest release (${result.version}).`;
    }
  } catch (error) {
    updateStatusEl.textContent = `Update check failed: ${error.message}`;
  } finally { checkUpdateBtn.disabled = false; }
});

downloadUpdateBtn.addEventListener('click', async () => {
  downloadUpdateBtn.disabled = true;
  try {
    const result = await window.api.downloadUpdate();
    if (!result.canceled) updateStatusEl.textContent = result.opened
      ? `Verified ${result.version}; the signed installer was opened.`
      : `Verified ${result.version}; the signed installer is ready for later.`;
  } catch (error) {
    updateStatusEl.textContent = `Update rejected: ${error.message}`;
  } finally { downloadUpdateBtn.disabled = false; }
});

for (const link of document.querySelectorAll('[data-url]')) {
  link.addEventListener('click', async () => {
    try { await window.api.openExternal(link.dataset.url); }
    catch (error) { showLog(error.message); }
  });
}

window.api.onLauncherLog((message) => showLog(message));
window.api.onEmulatorExited((code) => showLog(code === 0
  ? 'Azahar closed normally.'
  : `Azahar exited unexpectedly (${code ?? 'unknown'}). Export diagnostics if retrying does not help.`));
window.api.onEmulatorExited((code) => recoveryNotice.classList.toggle('hidden', code === 0));
window.api.onUpdateProgress(({ received, total }) => {
  const receivedMb = (received / 1024 / 1024).toFixed(1);
  const totalText = total ? ` of ${(total / 1024 / 1024).toFixed(1)} MB` : ' MB';
  updateStatusEl.textContent = `Downloading verified update: ${receivedMb}${totalText}`;
});

const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let particles = [];
let width = 0;
let height = 0;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
}

class Particle {
  constructor() { this.reset(); }

  reset() {
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.radius = Math.random() * 2 + 1;
    this.speedY = Math.random() * -0.8 - 0.2;
    this.speedX = (Math.random() - 0.5) * 0.4;
    this.alpha = Math.random() * 0.5 + 0.1;
    this.pulse = Math.random() * Math.PI * 2;
  }

  update() {
    this.y += this.speedY;
    this.x += this.speedX;
    this.pulse += 0.03;
    if (this.y < -10 || this.x < -10 || this.x > width + 10) this.reset();
  }

  draw() {
    const alpha = this.alpha * (0.6 + 0.4 * Math.sin(this.pulse));
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 168, 107, ${alpha})`;
    ctx.fill();
  }
}

function initParticles() {
  particles = [];
  const count = reducedMotion ? 0 : Math.floor((width * height) / 12000);
  for (let index = 0; index < count; index += 1) particles.push(new Particle());
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#0a1f17');
  gradient.addColorStop(1, '#143828');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (const particle of particles) {
    particle.update();
    particle.draw();
  }
  if (!reducedMotion) window.requestAnimationFrame(drawBackground);
}

window.addEventListener('resize', () => {
  resize();
  initParticles();
  if (reducedMotion) drawBackground();
});

resize();
initParticles();
drawBackground();

(async () => {
  try {
    await loadConfig();
    const installationReady = await refreshLauncherStatus();
    await refreshRomStatus();
    if (!installationReady) continueBtn.disabled = true;
  } catch (error) {
    setStatus(`Launcher initialization failed: ${error.message}`, 'error');
    continueBtn.disabled = true;
  }
})();
