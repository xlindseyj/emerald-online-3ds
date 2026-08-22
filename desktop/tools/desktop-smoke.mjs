import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaults = {
  durationMs: 10000,
  warmupMs: 2000
};

function parseArgs(argv) {
  const options = {
    platform: process.platform,
    build: false,
    xvfb: true,
    durationMs: defaults.durationMs
  };

  for (const arg of argv) {
    if (arg === '--build') options.build = true;
    if (arg === '--no-build') options.build = false;
    if (arg === '--no-xvfb') options.xvfb = false;
    if (arg.startsWith('--platform=')) options.platform = arg.split('=', 2)[1];
    if (arg.startsWith('--duration=')) options.durationMs = Number.parseInt(arg.split('=', 2)[1], 10);
  }

  if (!Number.isFinite(options.durationMs) || options.durationMs < 1000) {
    throw new Error('Invalid --duration value. Use a positive integer in milliseconds.');
  }
  return options;
}

function toPlatformLabel(platform) {
  if (platform === 'windows') return 'win32';
  if (platform === 'linux') return 'linux';
  return platform;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findExecutableInPath(binary) {
  if (path.isAbsolute(binary) && fs.existsSync(binary)) return binary;
  const directories = (process.env.PATH || '').split(path.delimiter);
  for (const dir of directories) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function findLocalFallbackXvfb() {
  const candidates = [
    path.join(projectRoot, '.tools', 'xvfb', 'root', 'usr', 'bin', 'xvfb-run'),
    path.join(projectRoot, '..', '.tools', 'xvfb', 'root', 'usr', 'bin', 'xvfb-run')
  ];
  for (const fallback of candidates) {
    if (fs.existsSync(fallback)) return fallback;
  }
  return null;
}

function isExecutable(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') return Boolean(stat.mode & 0o111);
    return true;
  } catch {
    return false;
  }
}

function findExecutableForPlatform(platform) {
  const distDir = path.join(projectRoot, 'dist');
  if (platform === 'linux') {
    const linuxDir = path.join(distDir, 'linux-unpacked');
    const preferred = path.join(linuxDir, 'emerald-online-3ds-desktop');
    if (isExecutable(preferred)) return preferred;
    return null;
  }

  if (platform === 'win32') {
    const winDir = path.join(distDir, 'win-unpacked');
    if (!fs.existsSync(winDir)) return null;
    const preferred = [
      'Emerald Online 3DS.exe',
      'emerald-online-3ds-desktop.exe',
      'emerauld-online-3ds-desktop.exe'
    ];
    for (const file of preferred) {
      const candidate = path.join(winDir, file);
      if (fs.existsSync(candidate)) return candidate;
    }

    for (const file of fs.readdirSync(winDir)) {
      if (file.toLowerCase().endsWith('.exe')) return path.join(winDir, file);
    }
  }

  return null;
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: options.stdio || 'inherit',
      env: process.env
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) return resolve({ code, signal });
      reject(new Error(`${cmd} exited with code ${code} (signal ${String(signal)})`));
    });
  });
}

function startSmokeProcess(executablePath, platform, durationMs) {
  const args = ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'];

  if (platform === 'linux') {
    let xvfb = findExecutableInPath('xvfb-run');
    if (!xvfb) xvfb = findLocalFallbackXvfb();
    if (!xvfb && !process.env.DISPLAY) {
      throw new Error('Cannot run Linux smoke test without a display. Install xvfb-run or run with --no-xvfb on a machine with DISPLAY set.');
    }
    if (xvfb) {
      return spawn(xvfb, ['-a', executablePath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    }
  }

  return spawn(executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function spawnBuilder(target) {
  const args = [target, '--dir', '--x64'];
  return runCommand('npx', ['electron-builder', ...args]);
}

async function runSmoke(platform, durationMs, xvfbEnabled) {
  const targetPlatform = toPlatformLabel(platform);
  if (targetPlatform !== 'linux' && targetPlatform !== 'win32') {
    throw new Error(`Unsupported smoke platform: ${platform}. Use linux or windows.`);
  }
  if (platform === 'windows' && process.platform !== 'win32') {
    throw new Error('Windows smoke test must be executed on Windows (or a Windows runner).');
  }

  const executable = findExecutableForPlatform(targetPlatform);
  if (!executable) {
    throw new Error(`Missing ${platform} launcher artifact. Run a matching build first (dist/${targetPlatform === 'linux' ? 'linux-unpacked' : 'win-unpacked'}).`);
  }

  if (!xvfbEnabled && targetPlatform === 'linux' && !process.env.DISPLAY) {
    throw new Error('You disabled xvfb with --no-xvfb, but no DISPLAY is set. Re-enable xvfb or run with a local display.');
  }

  if (!xvfbEnabled && targetPlatform === 'linux') {
    console.log('Running Linux smoke test without xvfb. This requires a real X11/Wayland display.');
  }

  const runArgs = ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'];
  const launcherArgs = targetPlatform === 'linux'
    ? ['-a', executable, ...runArgs]
    : runArgs;
  const command = targetPlatform === 'linux'
    ? (findExecutableInPath('xvfb-run') ?? findLocalFallbackXvfb())
    : executable;

  if (targetPlatform === 'linux' && !command) {
    throw new Error('Cannot find xvfb-run in PATH; set up xvfb or run this test with a working DISPLAY.');
  }

  console.log(`Running ${platform} smoke test using ${targetPlatform} artifact: ${executable}`);

  const runEnv = { ...process.env };
  if (command && command.includes('.tools/xvfb/')) {
    const xvfbDir = path.dirname(command);
    const hasPath = typeof runEnv.PATH === 'string'
      ? runEnv.PATH.split(path.delimiter).includes(xvfbDir)
      : false;
    if (!hasPath) {
      runEnv.PATH = `${xvfbDir}${path.delimiter}${runEnv.PATH || ''}`.replace(/^:+/, '');
    }
  }

  const child = spawn(
    command,
    targetPlatform === 'linux' ? launcherArgs : runArgs,
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
      detached: targetPlatform === 'linux',
      env: runEnv
    }
  );

  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.log(text.split('\n')[0]);
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(text.split('\n')[0]);
    });
  }

  await wait(defaults.warmupMs);
  if (exited) {
    throw new Error(`Launcher exited too early during warmup (code=${exitCode ?? 'n/a'}, signal=${exitSignal ?? 'n/a'}).`);
  }

  await wait(Math.max(0, durationMs - defaults.warmupMs));
  if (!child.killed && !exited) {
    const safeKill = (signal) => {
      if (process.platform === 'linux' && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fallback to direct child kill for compatibility.
        }
      }
      try {
        child.kill(signal);
      } catch {
        // Best effort.
      }
    };
    safeKill('SIGTERM');
    await wait(500);
  }

  if (!exited) {
    const safeKill = (signal) => {
      if (process.platform === 'linux' && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fallback to direct child kill for compatibility.
        }
      }
      try {
        child.kill(signal);
      } catch {
        // Best effort.
      }
    };
    safeKill('SIGKILL');
    await new Promise((resolve) => {
      child.once('close', () => resolve());
      setTimeout(() => resolve(), 3000);
    });
  }

  if (exitCode !== null && exitCode !== 0 && exitCode !== 143) {
    throw new Error(`Smoke test failed after launch; app exited with code ${exitCode}, signal ${exitSignal}.`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetPlatform = options.platform;
  if (options.platform === 'windows') {
    if (process.platform !== 'win32') {
      throw new Error('Windows smoke test must be executed on Windows. You can run `npm run smoke:linux` here.');
    }
  }

  const targetBinary = findExecutableForPlatform(toPlatformLabel(targetPlatform));
  const needsBuild = options.build || !targetBinary;
  if (needsBuild) {
    const builderTarget = targetPlatform === 'windows' ? '--win' : `--${targetPlatform}`;
    console.log(`Building desktop launcher for ${targetPlatform}...`);
    await runCommand('npx', ['electron-builder', builderTarget, '--dir', '--x64'], { stdio: 'inherit' });
  }

  await runSmoke(options.platform === 'windows' ? 'windows' : options.platform, options.durationMs, options.xvfb);
  console.log(`Smoke test passed for ${options.platform} (${options.durationMs}ms).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
