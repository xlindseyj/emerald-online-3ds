import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { LauncherConfig } from "./domain";

export interface RuntimeStatus {
  appVersion: string;
  runtimeVersion: string;
  coreVersion: string;
  runtimeReady: boolean;
  coreReady: boolean;
  romPresent: boolean;
  romValid: boolean;
  running: boolean;
  previousUncleanExit: boolean;
  jitAvailable: boolean;
  jitAttached: boolean;
  jitSupported: boolean;
  jitEntitled: boolean;
  stikDebugInstalled: boolean;
  jitStatus: string;
  autoSaveAvailable: boolean;
}

export interface JITState {
  jitAvailable: boolean;
  jitAttached: boolean;
  jitSupported: boolean;
  jitEntitled: boolean;
  stikDebugInstalled: boolean;
  jitStatus: string;
}

export interface RuntimeEvent {
  state: "starting" | "running" | "stopping" | "stopped" | "failed";
  message?: string;
}

export interface PerformanceEvent {
  framesPerSecond: number;
  audioUnderruns: number;
  thermalState: string;
}

export interface EmeraldRuntimePlugin {
  getStatus(): Promise<RuntimeStatus>;
  importRom(): Promise<{
    imported: boolean;
    title?: string;
    gameCode?: string;
  }>;
  enableJit(): Promise<JITState>;
  start(): Promise<{ started: boolean }>;
  stop(): Promise<void>;
  getConfig(): Promise<LauncherConfig>;
  saveConfig(options: { config: LauncherConfig }): Promise<LauncherConfig>;
  createBackup(): Promise<{
    exported: boolean;
    files: number;
    includesIdentity: boolean;
  }>;
  restoreBackup(): Promise<{
    restored: boolean;
    files: number;
    includesIdentity: boolean;
  }>;
  exportDiagnostics(): Promise<{ exported: boolean }>;
  deleteLocalData(): Promise<{ deleted: boolean }>;
  checkForUpdate(): Promise<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
  }>;
  openExternal(options: { url: string }): Promise<void>;
  addListener(
    eventName: "runtimeState",
    listener: (event: RuntimeEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "performance",
    listener: (event: PerformanceEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "jitState",
    listener: (event: JITState) => void,
  ): Promise<PluginListenerHandle>;
}

export const EmeraldRuntime =
  registerPlugin<EmeraldRuntimePlugin>("EmeraldRuntime");
