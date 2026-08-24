import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  SUPPORTED_PAGES,
  type LauncherConfig,
} from "../lib/domain";
import { EmeraldRuntime, type RuntimeStatus } from "../lib/emerald-runtime";

type Panel = "settings" | "controls" | "data" | "updates" | null;

const EMPTY_STATUS: RuntimeStatus = {
  appVersion: "0.9.2",
  runtimeVersion: "unknown",
  coreVersion: "2126.0",
  runtimeReady: false,
  coreReady: false,
  romPresent: false,
  romValid: false,
  running: false,
  previousUncleanExit: false,
  jitAvailable: false,
  autoSaveAvailable: false,
};

const pageLabels: Record<string, string> = {
  online: "Online",
  users: "Online Users",
  chat: "Chat",
  party: "Party",
  bag: "Bag",
  map: "Map/Radar",
  stats: "Player Stats",
  quest: "Quests",
  titles: "Titles",
  friends: "Friends",
  guild: "Guild",
  teleport: "Teleport",
  update: "Updates",
};

export function App() {
  const [status, setStatus] = useState<RuntimeStatus>(EMPTY_STATUS);
  const [config, setConfig] = useState<LauncherConfig>(DEFAULT_CONFIG);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Checking installation…");
  const [error, setError] = useState("");
  const [updateText, setUpdateText] = useState(
    "Updates are checked only when you ask. Install a newer IPA through the same sideloading method.",
  );

  const refresh = useCallback(async () => {
    const [nextStatus, nextConfig] = await Promise.all([
      EmeraldRuntime.getStatus(),
      EmeraldRuntime.getConfig(),
    ]);
    setStatus(nextStatus);
    setConfig(nextConfig);
    if (!nextStatus.coreReady || !nextStatus.runtimeReady)
      setMessage(
        "This build is incomplete. The emulator core or runtime is missing.",
      );
    else if (!nextStatus.romPresent)
      setMessage(
        "Select your legally obtained Pokémon Emerald (U) ROM to begin.",
      );
    else if (!nextStatus.romValid)
      setMessage(
        "The configured ROM is invalid or has changed. Select it again.",
      );
    else setMessage("ROM ready. Tap Play to launch.");
  }, []);

  useEffect(() => {
    refresh()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setMessage(
          "Native runtime unavailable. Open this launcher through the installed iOS app.",
        );
      })
      .finally(() => setBusy(false));

    let removeState: (() => Promise<void>) | undefined;
    EmeraldRuntime.addListener("runtimeState", (event) => {
      if (event.message) setMessage(event.message);
      if (event.state === "failed")
        setError(event.message ?? "The emulator stopped unexpectedly.");
      refresh().catch(() => undefined);
    })
      .then((handle) => {
        removeState = () => handle.remove();
      })
      .catch(() => undefined);
    return () => {
      removeState?.();
    };
  }, [refresh]);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(""), 7000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const importRom = () =>
    perform(async () => {
      const result = await EmeraldRuntime.importRom();
      if (result.imported)
        setMessage(
          "ROM accepted. It stays on this phone and is never uploaded.",
        );
    });

  const play = () => {
    if (!status.romPresent || !status.romValid) return importRom();
    return perform(async () => {
      const result = await EmeraldRuntime.start();
      if (!result.started) throw new Error("The emulator did not start.");
    });
  };

  const saveSettings = () =>
    perform(async () => {
      const normalized = normalizeConfig(config);
      setConfig(await EmeraldRuntime.saveConfig({ config: normalized }));
      setPanel(null);
      setMessage("Settings saved. They will apply on the next launch.");
    });

  const open = (url: string) =>
    perform(() => EmeraldRuntime.openExternal({ url }));

  return (
    <main className="title-screen">
      <div className="ambient" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <img className="logo" src="/assets/banner.png" alt="Emerald Online 3DS" />
      <p className="version">
        v{status.appVersion} · Azahar {status.coreVersion} · No-JIT
      </p>

      <div
        className={`status ${error ? "status-error" : status.romValid ? "status-ready" : ""}`}
        role="status"
        aria-live="polite"
      >
        {error || message}
      </div>

      {status.previousUncleanExit && (
        <div className="recovery" role="alert">
          <strong>The previous session ended unexpectedly.</strong>
          <span>
            Your save was not modified by the launcher. Retry Play or export
            safe diagnostics.
          </span>
        </div>
      )}

      <div className="main-actions">
        <button
          className="primary play"
          disabled={busy || !status.coreReady || !status.runtimeReady}
          onClick={play}
        >
          {status.romValid ? "Play" : "Select ROM"}
        </button>
        {status.romPresent && (
          <button className="secondary" disabled={busy} onClick={importRom}>
            Change ROM
          </button>
        )}
      </div>

      <div className="utility-actions">
        <button className="secondary" onClick={() => setPanel("settings")}>
          Settings
        </button>
        <button className="secondary" onClick={() => setPanel("controls")}>
          Controls
        </button>
        <button className="secondary" onClick={() => setPanel("data")}>
          Data &amp; recovery
        </button>
        <button className="secondary" onClick={() => setPanel("updates")}>
          Updates
        </button>
      </div>

      <nav className="footer" aria-label="Project links">
        <button onClick={() => open("https://emeraldonline3ds.com/")}>
          Website
        </button>
        <button onClick={() => open("https://emeraldonline3ds.com/community")}>
          Community
        </button>
        <button onClick={() => open("https://emeraldonline3ds.com/status")}>
          Status
        </button>
      </nav>

      {panel && (
        <div
          className="scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPanel(null);
          }}
        >
          <section
            className="panel"
            role="dialog"
            aria-modal="true"
            aria-label={panel}
          >
            {panel === "settings" && (
              <>
                <h2>Settings</h2>
                <label>
                  Trainer name
                  <input
                    value={config.name}
                    maxLength={12}
                    onChange={(event) =>
                      setConfig({ ...config, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Server host
                  <input
                    value={config.server}
                    onChange={(event) =>
                      setConfig({ ...config, server: event.target.value })
                    }
                  />
                </label>
                <div className="field-row">
                  <label>
                    Port
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={config.port}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          port: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Transport
                    <select
                      value={config.transport}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          transport: event.target.value as "wss" | "tcp",
                        })
                      }
                    >
                      <option>wss</option>
                      <option>tcp</option>
                    </select>
                  </label>
                </div>
                <label>
                  Path
                  <input
                    value={config.path}
                    onChange={(event) =>
                      setConfig({ ...config, path: event.target.value })
                    }
                  />
                </label>
                <label>
                  Starting page
                  <select
                    value={config.page}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        page: event.target.value as LauncherConfig["page"],
                      })
                    }
                  >
                    {SUPPORTED_PAGES.map((page) => (
                      <option key={page} value={page}>
                        {pageLabels[page]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={config.online}
                    onChange={(event) =>
                      setConfig({ ...config, online: event.target.checked })
                    }
                  />{" "}
                  Enable online
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={config.audioEnabled}
                    onChange={(event) =>
                      setConfig({ ...config, audioEnabled: event.target.checked })
                    }
                  />{" "}
                  Enable game audio
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={config.equalWidthScreens}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        equalWidthScreens: event.target.checked,
                      })
                    }
                  />{" "}
                  Make both stacked screens the same width
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={config.autoSaveState}
                    onChange={(event) =>
                      setConfig({ ...config, autoSaveState: event.target.checked })
                    }
                  />{" "}
                  Experimental auto-resume point
                </label>
                <p className="fine-print">
                  Auto-resume saves state when you exit or background the app.
                  Keep using Emerald's normal in-game save; save states are an
                  optional convenience and are not included in backups.
                </p>
                <div className="panel-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={saveSettings}
                  >
                    Save
                  </button>
                  <button className="secondary" onClick={() => setPanel(null)}>
                    Close
                  </button>
                </div>
              </>
            )}

            {panel === "controls" && (
              <>
                <h2>Mobile controls</h2>
                <dl>
                  <dt>D-pad</dt>
                  <dd>Move / Circle Pad</dd>
                  <dt>A / B</dt>
                  <dd>Confirm / Back</dd>
                  <dt>Start / Select</dt>
                  <dd>GBA Start / Select</dd>
                  <dt>X</dt>
                  <dd>Toggle online</dd>
                  <dt>Y</dt>
                  <dd>Cycle dashboard</dd>
                  <dt>L / R</dt>
                  <dd>Shoulder buttons</dd>
                  <dt>Lower screen</dt>
                  <dd>Touch dashboard actions</dd>
                </dl>
                <p>
                  Both orientations keep the screens stacked. Enable equal-width
                  screens in Settings to enlarge the lower screen. Bluetooth
                  controllers are supported.
                </p>
                <p>
                  Use the in-game Menu for Resume, Restart to the game title,
                  Save Resume Point, display/audio toggles, or Exit to Launcher.
                </p>
                <p className="fine-print">
                  This baseline disables CPU and shader JIT. Performance depends
                  on the iPhone model.
                </p>
                <button
                  className="secondary full"
                  onClick={() => setPanel(null)}
                >
                  Close
                </button>
              </>
            )}

            {panel === "data" && (
              <>
                <h2>Data &amp; recovery</h2>
                <p>
                  Backups never include <code>emerald.gba</code>. They can
                  contain your save and private online identity, so never share
                  them.
                </p>
                <div className="stacked">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        const result = await EmeraldRuntime.createBackup();
                        if (result.exported)
                          setMessage(
                            `Private backup exported with ${result.files} files.`,
                          );
                      })
                    }
                  >
                    Export private backup
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        const result = await EmeraldRuntime.restoreBackup();
                        if (result.restored)
                          setMessage(
                            `Restored ${result.files} verified files.`,
                          );
                      })
                    }
                  >
                    Restore backup
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        await EmeraldRuntime.exportDiagnostics();
                        setMessage("Privacy-safe diagnostics exported.");
                      })
                    }
                  >
                    Export safe diagnostics
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete the local ROM, save, identity, settings, and diagnostics from this app?",
                        )
                      )
                        perform(async () => {
                          await EmeraldRuntime.deleteLocalData();
                          setPanel(null);
                          setMessage("All local app data was deleted.");
                        });
                    }}
                  >
                    Delete all local data
                  </button>
                </div>
                <p className="fine-print">
                  Deletion does not remove backups exported to Files and cannot
                  guarantee forensic erasure.
                </p>
                <button
                  className="secondary full"
                  onClick={() => setPanel(null)}
                >
                  Close
                </button>
              </>
            )}

            {panel === "updates" && (
              <>
                <h2>App updates</h2>
                <p>{updateText}</p>
                <button
                  className="primary full"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      const result = await EmeraldRuntime.checkForUpdate();
                      setUpdateText(
                        result.updateAvailable
                          ? `Version ${result.latestVersion} is available from the official release page.`
                          : `You have the latest release (${result.currentVersion}).`,
                      );
                    })
                  }
                >
                  Check official release
                </button>
                <button
                  className="secondary full"
                  onClick={() => setPanel(null)}
                >
                  Close
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
