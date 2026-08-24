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
      "EmeraldJITCoordinator.swift",
      "EO3DSCoreSession.mm",
    ]) {
      expect(project).toContain(`${source} in Sources`);
    }
    expect(read("ios/App/App/Base.lproj/Main.storyboard")).toContain(
      'customClass="EmeraldBridgeViewController"',
    );
  });

  it("pins the trusted core and enables Azahar JIT only after native readiness", () => {
    const builder = read("tools/build-azahar-core.mjs");
    const host = read("ios/App/App/Native/EO3DSCoreSession.mm");
    const coordinator = read("ios/App/App/EmeraldJITCoordinator.swift");
    expect(builder).toMatch(/const version = ["']2126\.0["']/);
    expect(builder).toContain("fbd3fb02f71e5f9ed5134037fd59bad96c7d2b8a");
    expect(builder).toContain("e77b1ba0b7da7cbe93021b01a663acfe7c4dd516");
    expect(builder).toContain("94c726ce0338b054eb8cb5ea91de8fe6c19f4392");
    expect(host).toContain('jitEnabled ? "enabled" : "disabled"');
    expect(host).toContain("RETRO_ENVIRONMENT_GET_JIT_CAPABLE");
    expect(host).toContain("session->_JITEnabled");
    expect(host).toContain('dlsym(RTLD_DEFAULT, "csops")');
    expect(host).toContain('CFSTR("get-task-allow")');
    expect(coordinator).toContain('components.scheme = stikDebugScheme');
    expect(coordinator).toContain('components.host = "enable-jit"');
    expect(coordinator).toContain('URLQueryItem(name: "bundle-id"');
    expect(coordinator).toContain('URLQueryItem(name: "pid"');
    expect(coordinator).toContain('URLQueryItem(name: "script-name", value: scriptName)');
    expect(coordinator).toContain('private let scriptName = "universal.js"');
    expect(coordinator).toContain("EO3DSIsJIT26ProtocolReady()");
    expect(coordinator).toContain('reason = "ready-to-prepare"');
    expect(host).toContain("azahar_jit26_begin_preparation");
    expect(host).toContain("azahar_jit26_finish_preparation");
    expect(host).toContain("jitEnabled && !_JIT26Enabled");
    expect(read("patches/azahar-2126-ios26.patch")).toContain("brk #0xf00d");
    expect(read("patches/oaknut-94c726c-ios26.patch")).toContain("vm_remap");
    expect(coordinator).not.toMatch(/pairingFile|mobiledevicepairing|10\.7\.0\.1/);
    expect(host).toContain("RETRO_ENVIRONMENT_GET_CURRENT_SOFTWARE_FRAMEBUFFER");
    expect(host).toContain('{"citra_use_libretro_save_path", "LibRetro Default"}');
    expect(host).not.toContain('{"citra_use_libretro_save_path", "disabled"}');
    expect(read("ios/App/App/EmeraldEmulationViewController.swift")).toContain(
      "userRootURL: storage.appRoot",
    );
    expect(read("ios/App/App/EmeraldStorage.swift")).toContain(
      "dynarec=disabled",
    );
    expect(read("ios/App/App/Info.plist")).toContain("stikdebug");
    expect(read("ios/App/App/SideStore.entitlements")).toContain("get-task-allow");
    const codemagic = read("../codemagic.yaml");
    expect(codemagic).toContain("SideStore.entitlements");
    expect(codemagic).toContain("REQUIRE_JIT_ENTITLEMENT=1");
    expect(codemagic).toContain("Print :get-task-allow");
    for (const stage of codemagic.split("npm run runtime:stage --prefix mobile").slice(1)) {
      expect(stage.indexOf("npx cap copy ios")).toBeGreaterThanOrEqual(0);
      expect(stage.indexOf("npm run core:build --prefix mobile")).toBeGreaterThan(
        stage.indexOf("npx cap copy ios"),
      );
    }
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

  it("keeps rotation stacked and offers equal-width screens through the in-game menu", () => {
    const host = read("ios/App/App/Native/EO3DSCoreSession.mm");
    const controller = read("ios/App/App/EmeraldEmulationViewController.swift");
    expect(host).toContain('_variables["citra_layout_option"] = "default"');
    expect(host).not.toContain('landscape ? "side_by_side" : "default"');
    expect(controller).toContain("class EmeraldScreenView");
    expect(controller).toContain("Make both screens equal width");
    expect(controller).toContain("Restart to Game Title");
    expect(controller).toContain("Exit to Launcher");
  });

  it("uses a compatible audio session and moves presentation work off the emulation queue", () => {
    const controller = read("ios/App/App/EmeraldEmulationViewController.swift");
    const host = read("ios/App/App/Native/EO3DSCoreSession.mm");
    expect(controller).toContain("setCategory(.playback, mode: .default");
    expect(controller).toContain("standardFormatWithSampleRate: 32_768");
    expect(controller).toContain("emulator-no-audio-frames");
    expect(host).toContain("com.emeraldonline3ds.mobile.video");
    expect(host).toContain("QOS_CLASS_USER_INTERACTIVE");
    expect(host).toContain("retro_serialize_size");
    expect(host).toContain("512 * 1024 * 1024");
  });
});
