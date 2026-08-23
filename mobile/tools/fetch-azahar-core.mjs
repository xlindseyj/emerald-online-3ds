import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "2126.0";
const archiveName = `azahar-libretro-ios-arm64-${version}.zip`;
const url = `https://github.com/azahar-emu/azahar/releases/download/${version}/${archiveName}`;
const expectedArchiveHash =
  "e7b3e888db0441d6e3463bd6f38a48e84dcb0009ef58376f23781420beccf479";
const expectedCoreHash =
  "84fa14f88666961f56bc36675018d35e42499ed7410f32d2bb0395bf31855ce6";
const destination = path.join(
  root,
  "ios",
  "App",
  "App",
  "Frameworks",
  "azahar_libretro.dylib",
);

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
if (fs.existsSync(destination) && sha256(destination) === expectedCoreHash) {
  console.log(`Azahar ${version} core already verified.`);
  process.exit(0);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "emerald-azahar-"));
try {
  const archive = path.join(temp, archiveName);
  execFileSync(
    "curl",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      url,
      "--output",
      archive,
    ],
    { stdio: "inherit" },
  );
  if (sha256(archive) !== expectedArchiveHash)
    throw new Error("Azahar archive checksum mismatch.");
  execFileSync("unzip", ["-q", archive, "-d", temp], { stdio: "inherit" });
  const core = path.join(temp, "azahar_libretro.dylib");
  if (sha256(core) !== expectedCoreHash)
    throw new Error("Azahar core checksum mismatch.");
  fs.copyFileSync(core, destination);
  console.log(
    `Verified Azahar ${version} core staged at ${path.relative(root, destination)}.`,
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
