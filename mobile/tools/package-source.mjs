import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(mobileRoot, "..");
const packageInfo = JSON.parse(
  fs.readFileSync(path.join(mobileRoot, "package.json"), "utf8"),
);
const output = path.join(repositoryRoot, "build", "ios", "source");
fs.mkdirSync(output, { recursive: true });
const archive = path.join(
  output,
  `emerald-online-3ds-mobile-source-${packageInfo.version}.tar.gz`,
);

const tracked = execFileSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "LICENSE.md",
    "mobile",
    "gpsp-runtime/Makefile",
    "gpsp-runtime/source",
    "third_party/gpsp",
  ],
  { cwd: repositoryRoot, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((name) => !name.startsWith("third_party/gpsp/tools/"))
  .filter((name) => !/\.(?:a|bin|d|o)$/i.test(name));
if (!tracked.length)
  throw new Error("No tracked mobile source files are available.");
if (
  tracked.some((name) =>
    /\.(?:gba|sav|ipa|dylib)$|(?:identity|online|stats|display)\.cfg$/i.test(
      name,
    ),
  )
) {
  throw new Error(
    "Refusing to package private, copyrighted, or binary runtime data.",
  );
}
for (const required of [
  "gpsp-runtime/Makefile",
  "gpsp-runtime/source/main.cpp",
  "third_party/gpsp/COPYING",
]) {
  if (!tracked.includes(required))
    throw new Error(`Corresponding source is incomplete: missing ${required}.`);
}
execFileSync("tar", ["-czf", archive, ...tracked], {
  cwd: repositoryRoot,
  stdio: "inherit",
});
console.log(`Created ${path.relative(repositoryRoot, archive)}.`);
