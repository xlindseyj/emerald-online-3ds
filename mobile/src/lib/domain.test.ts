import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  encodeOnlineConfig,
  inspectRomHeader,
  normalizeConfig,
  sanitizeTrainerName,
} from "./domain";

describe("launcher configuration", () => {
  it("uses the production WSS route and forces the emulator-safe dynarec setting", () => {
    expect(encodeOnlineConfig(DEFAULT_CONFIG)).toContain(
      "server=live.emeraldonline3ds.com\nport=443\ntransport=wss\npath=/game",
    );
    expect(encodeOnlineConfig(DEFAULT_CONFIG)).toContain("dynarec=disabled");
  });

  it("normalizes safe values and rejects untrusted settings", () => {
    expect(
      normalizeConfig({ name: "  May  ", server: "LIVE.EMERALDONLINE3DS.COM" }),
    ).toMatchObject({ name: "May", server: "live.emeraldonline3ds.com" });
    expect(() => sanitizeTrainerName('bad"name')).toThrow(/without quotes/);
    expect(() => normalizeConfig({ server: "https://evil.example" })).toThrow(
      /without a scheme/,
    );
    expect(() => normalizeConfig({ path: "/game?token=secret" })).toThrow(
      /unsupported/,
    );
    expect(() => normalizeConfig({ port: 70000 })).toThrow(
      /between 1 and 65535/,
    );
  });
});

describe("ROM header inspection", () => {
  it("rejects every non-16 MiB input before reading headers", () => {
    expect(() => inspectRomHeader(new Uint8Array(8))).toThrow(
      "Expected a 16 MiB GBA ROM",
    );
  });

  it("accepts only the expected identity fields and valid Nintendo header checksum", () => {
    const rom = new Uint8Array(16 * 1024 * 1024);
    rom.set(new TextEncoder().encode("POKEMON EMER"), 0xa0);
    rom.set(new TextEncoder().encode("BPEE"), 0xac);
    rom.set(new TextEncoder().encode("01"), 0xb0);
    rom[0xbc] = 0;
    let checksum = 0;
    for (let index = 0xa0; index <= 0xbc; index += 1)
      checksum = (checksum - rom[index]) & 0xff;
    rom[0xbd] = (checksum - 0x19) & 0xff;
    expect(inspectRomHeader(rom)).toMatchObject({
      gameCode: "BPEE",
      makerCode: "01",
      version: 0,
      headerChecksumValid: true,
      identityValid: true,
    });
    rom[0xac] = "X".charCodeAt(0);
    expect(inspectRomHeader(rom).identityValid).toBe(false);
  });
});
