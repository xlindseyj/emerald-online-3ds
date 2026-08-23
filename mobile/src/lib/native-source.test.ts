// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("native iOS architecture", () => {
  it("registers the single-purpose runtime plugin and all native sources", () => {
    const project = read("ios/App/App.xcodeproj/project.pbxproj");
    for (const source of [
      "EmeraldStorage.swift",
      "EmeraldRuntimePlugin.swift",
      "EmeraldEmulationViewController.swift",
      "EO3DSCoreSession.mm",
    ]) {
      expect(project).toContain(`${source} in Sources`);
    }
    expect(read("ios/App/App/Base.lproj/Main.storyboard")).toContain(
      'customClass="EmeraldBridgeViewController"',
    );
  });

  it("pins the trusted core and disables every JIT route", () => {
    const fetch = read("tools/fetch-azahar-core.mjs");
    const host = read("ios/App/App/Native/EO3DSCoreSession.mm");
    expect(fetch).toMatch(/const version = ["']2126\.0["']/);
    expect(fetch).toContain(
      "e7b3e888db0441d6e3463bd6f38a48e84dcb0009ef58376f23781420beccf479",
    );
    expect(host).toContain('{"citra_use_cpu_jit", "disabled"}');
    expect(host).toContain('{"citra_use_shader_jit", "disabled"}');
    expect(host).toContain("RETRO_ENVIRONMENT_GET_JIT_CAPABLE");
    expect(host).toContain("RETRO_ENVIRONMENT_GET_CURRENT_SOFTWARE_FRAMEBUFFER");
    expect(host).toContain('{"citra_use_libretro_save_path", "LibRetro Default"}');
    expect(host).not.toContain('{"citra_use_libretro_save_path", "disabled"}');
    expect(read("ios/App/App/EmeraldEmulationViewController.swift")).toContain(
      "userRootURL: storage.appRoot",
    );
    expect(read("ios/App/App/EmeraldStorage.swift")).toContain(
      "dynarec=disabled",
    );
  });

  it("supports both orientations and locks importing to the supported ROM", () => {
    const plist = read("ios/App/App/Info.plist");
    expect(plist).toContain("UIInterfaceOrientationPortrait");
    expect(plist).toContain("UIInterfaceOrientationLandscapeLeft");
    const storage = read("ios/App/App/EmeraldStorage.swift");
    expect(storage).toContain(
      "a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af",
    );
    expect(storage).toContain('code == "BPEE"');
    expect(storage).not.toMatch(/(?:192\.168\.|10\.0\.|172\.16\.)/);
  });

  it("keeps ROMs, saves, cores, and staged runtimes out of source control", () => {
    const ignore = read(".gitignore");
    expect(ignore).toContain("ios/App/App/Frameworks/*.dylib");
    expect(ignore).toContain("ios/App/App/Runtime/*.3dsx");
    expect(read("tools/audit-ipa.mjs")).toContain(
      "Private or copyrighted files found",
    );
  });

  it("diagnoses missing and black emulator frames without exporting private runtime data", () => {
    const controller = read("ios/App/App/EmeraldEmulationViewController.swift");
    const storage = read("ios/App/App/EmeraldStorage.swift");
    expect(controller).toContain("emulator-no-video-frames");
    expect(controller).toContain("emulator-black-video");
    expect(storage).toContain("Allowlisted runtime stages:");
    expect(storage).toContain('^[a-z0-9-]{1,64}$');
  });

  it("creates the complete safe runtime layout without fabricating user or credential files", () => {
    const storage = read("ios/App/App/EmeraldStorage.swift");
    for (const entry of [
      'appendingPathComponent("link-backups"',
      'appendingPathComponent("update"',
      'appendingPathComponent("nand"',
      'appendingPathComponent("sysdata"',
      'appendingPathComponent("log"',
      'appendingPathComponent("stats.cfg")',
      'appendingPathComponent("display.cfg")',
      "try writeOnlineConfig(readConfig())",
    ]) {
      expect(storage).toContain(entry);
    }
    expect(storage).not.toContain('writeDefaultFileIfMissing(romURL');
    expect(storage).not.toContain(
      'writeDefaultFileIfMissing(gameRoot.appendingPathComponent("identity.cfg")',
    );
    expect(storage).not.toContain(
      'writeDefaultFileIfMissing(gameRoot.appendingPathComponent("emerald.sav")',
    );
  });
});
