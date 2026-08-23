import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(root, "..");
const source = path.join(repositoryRoot, "release", "emerald-online-3ds.3dsx");
const destinationDirectory = path.join(root, "ios", "App", "App", "Runtime");
const destination = path.join(destinationDirectory, "emerald-online-3ds.3dsx");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);

if (!fs.existsSync(source))
  throw new Error(
    "Missing release/emerald-online-3ds.3dsx. Build the public runtime first.",
  );
const bytes = fs.readFileSync(source);
if (bytes.length < 100_000)
  throw new Error("Runtime artifact is unexpectedly small.");
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
fs.mkdirSync(destinationDirectory, { recursive: true });
fs.writeFileSync(destination, bytes);
fs.writeFileSync(
  path.join(destinationDirectory, "manifest.json"),
  `${JSON.stringify({ version: packageJson.version, sha256, file: "emerald-online-3ds.3dsx" }, null, 2)}\n`,
);
console.log(`Staged runtime v${packageJson.version} (${sha256}).`);
