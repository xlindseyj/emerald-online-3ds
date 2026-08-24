import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ipa = process.argv[2];
if (!ipa || !fs.existsSync(ipa))
  throw new Error("Usage: node tools/audit-ipa.mjs <path-to-ipa>");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "emerald-ipa-audit-"));

try {
  execFileSync("unzip", ["-q", ipa, "-d", temp]);
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else files.push(target);
    }
  };
  walk(temp);
  const relative = files.map((file) => path.relative(temp, file));
  const forbidden = relative.filter((name) =>
    /(?:^|\/)(?:[^/]+\.(?:gba|sav)|identity\.cfg|online\.cfg|stats\.cfg|display\.cfg|gpsp-debug\.log)$/i.test(
      name,
    ),
  );
  if (forbidden.length)
    throw new Error(
      `Private or copyrighted files found: ${forbidden.join(", ")}`,
    );
  const runtime = files.find((file) =>
    file.endsWith("/Runtime/emerald-online-3ds.3dsx"),
  );
  const core = files.find((file) =>
    file.endsWith("/Frameworks/azahar_libretro.dylib"),
  );
  const notices = files.find((file) =>
    file.endsWith("/Licenses/THIRD_PARTY_NOTICES.md"),
  );
  if (!runtime || !core || !notices)
    throw new Error(
      "IPA is missing the runtime, Azahar core, or third-party notices.",
    );
  const strings = files
    .filter((file) => fs.statSync(file).size < 2_000_000)
    .map((file) => fs.readFileSync(file))
    .map((buffer) => buffer.toString("utf8"))
    .join("\n");
  if (
    /(?:192\.168\.|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.)/.test(strings)
  )
    throw new Error("IPA contains a private IPv4 address.");
  let jitEntitlement = "not-inspected";
  if (process.platform === "darwin") {
    const executable = files.find((file) => file.endsWith("/Payload/App.app/App"));
    if (!executable) throw new Error("IPA is missing its main executable.");
    const inspection = spawnSync(
      "codesign",
      ["-d", "--entitlements", ":-", executable],
      { encoding: "utf8" },
    );
    const entitlements = `${inspection.stdout ?? ""}\n${inspection.stderr ?? ""}`;
    const enabled = /<key>get-task-allow<\/key>\s*<true\s*\/>/.test(entitlements);
    jitEntitlement = enabled ? "enabled" : "disabled";
    if (process.env.REQUIRE_JIT_ENTITLEMENT === "1" && !enabled)
      throw new Error("SideStore IPA is missing get-task-allow=true.");
  }
  const hash = (file) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  console.log(
    JSON.stringify(
      {
        ipa: path.basename(ipa),
        ipaSha256: hash(ipa),
        runtimeSha256: hash(runtime),
        coreSha256: hash(core),
        files: files.length,
        privacyAudit: "passed",
        jitEntitlement,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
