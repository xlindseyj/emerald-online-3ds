import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(mobileRoot, "..");
const version = "2126.0";
const azaharCommit = "fbd3fb02f71e5f9ed5134037fd59bad96c7d2b8a";
const dynarmicCommit = "e77b1ba0b7da7cbe93021b01a663acfe7c4dd516";
const azaharOaknutCommit = "6b1d57ea7ed4882d32a91eeaa6557b0ecb4da152";
const oaknutCommit = "94c726ce0338b054eb8cb5ea91de8fe6c19f4392";
const source = path.join(
  process.env.EMERALD_AZAHAR_CACHE || path.join(os.homedir(), "Library", "Caches"),
  "emerald-azahar-2126",
);
const destination = path.join(
  mobileRoot,
  "ios",
  "App",
  "App",
  "Frameworks",
  "azahar_libretro.dylib",
);
const buildDirectory = path.join(source, "build", "ios-arm64");
const metadataDirectory = path.join(repositoryRoot, "build", "ios");

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function output(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options }).trim();
}

function verifyCommit(directory, expected, label) {
  const actual = output("git", ["rev-parse", "HEAD"], { cwd: directory });
  if (actual !== expected)
    throw new Error(`${label} source pin mismatch: expected ${expected}, got ${actual}.`);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (process.platform !== "darwin") {
  throw new Error("The patched Azahar iOS core must be built on macOS with Xcode.");
}

if (!fs.existsSync(path.join(source, ".git"))) {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  run("git", [
    "clone",
    "--filter=blob:none",
    "--recurse-submodules",
    "https://github.com/azahar-emu/azahar.git",
    source,
  ]);
}

run("git", ["fetch", "--force", "origin", `refs/tags/${version}:refs/tags/${version}`], {
  cwd: source,
});
run("git", ["checkout", "--force", azaharCommit], { cwd: source });
run("git", ["submodule", "sync", "--recursive"], { cwd: source });
run("git", ["submodule", "update", "--init", "--recursive", "--force"], { cwd: source });
verifyCommit(source, azaharCommit, "Azahar");
verifyCommit(path.join(source, "externals", "dynarmic"), dynarmicCommit, "Dynarmic");
verifyCommit(path.join(source, "externals", "oaknut"), azaharOaknutCommit, "Azahar Oaknut");
verifyCommit(
  path.join(source, "externals", "dynarmic", "externals", "oaknut"),
  oaknutCommit,
  "Oaknut",
);

const patches = [
  [source, path.join(mobileRoot, "patches", "azahar-2126-ios26.patch")],
  [path.join(source, "externals", "oaknut"), path.join(mobileRoot, "patches", "oaknut-94c726c-ios26.patch")],
  [
    path.join(source, "externals", "dynarmic"),
    path.join(mobileRoot, "patches", "dynarmic-e77b1ba-ios26.patch"),
  ],
  [
    path.join(source, "externals", "dynarmic", "externals", "oaknut"),
    path.join(mobileRoot, "patches", "oaknut-94c726c-ios26.patch"),
  ],
];
for (const [directory, patchFile] of patches) {
  try {
    run("git", ["apply", "--check", patchFile], { cwd: directory });
    run("git", ["apply", patchFile], { cwd: directory });
  } catch {
    run("git", ["apply", "--check", "--reverse", patchFile], { cwd: directory });
  }
}

run("cmake", [
  "-S", source,
  "-B", buildDirectory,
  "-DENABLE_LIBRETRO=ON",
  "-DENABLE_SDL2=OFF",
  "-DENABLE_QT=OFF",
  "-DENABLE_TESTS=OFF",
  "-DENABLE_ROOM=OFF",
  "-DENABLE_WEB_SERVICE=OFF",
  "-DENABLE_SCRIPTING=OFF",
  "-DENABLE_CUBEB=OFF",
  "-DENABLE_OPENAL=OFF",
  "-DENABLE_LIBUSB=OFF",
  "-DENABLE_OPENGL=OFF",
  "-DENABLE_VULKAN=OFF",
  "-DENABLE_SOFTWARE_RENDERER=ON",
  "-DCITRA_WARNINGS_AS_ERRORS=OFF",
  "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
  "-DCMAKE_C_FLAGS=-DIOS",
  "-DCMAKE_CXX_FLAGS=-DIOS",
  "-DIOS=ON",
  "-DCMAKE_SYSTEM_NAME=iOS",
  "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0",
  "-DCITRA_USE_PRECOMPILED_HEADERS=OFF",
  "-DCMAKE_OSX_ARCHITECTURES=arm64",
  "-DENABLE_OPT=OFF",
]);
run("cmake", [
  "--build", buildDirectory,
  "--target", "azahar_libretro",
  "--config", "Release",
  "--parallel", String(os.cpus().length),
]);

const core = path.join(buildDirectory, "bin", "Release", "azahar_libretro.dylib");
if (!fs.existsSync(core)) throw new Error("Azahar build did not produce the iOS core.");
run("strip", ["-x", core]);
const symbols = output("nm", ["-gU", core]);
for (const symbol of [
  "_azahar_jit26_begin_preparation",
  "_azahar_jit26_protocol_state",
  "_azahar_jit26_finish_preparation",
  "_retro_load_game",
]) {
  if (!symbols.includes(symbol)) throw new Error(`Patched core is missing ${symbol}.`);
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(core, destination);
fs.mkdirSync(metadataDirectory, { recursive: true });
fs.writeFileSync(
  path.join(metadataDirectory, "azahar-core.json"),
  `${JSON.stringify({
    version,
    azaharCommit,
    dynarmicCommit,
    azaharOaknutCommit,
    oaknutCommit,
    sha256: sha256(destination),
    jitProtocol: "stikdebug-universal-f00d-v1",
    shaderJitOnIOS26: false,
  }, null, 2)}\n`,
);
console.log(`Built patched Azahar ${version} core (${sha256(destination)}).`);
