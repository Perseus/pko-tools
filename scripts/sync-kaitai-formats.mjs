import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

const sourceDir = process.env.PKO_KSY_SOURCE
  ? resolve(root, process.env.PKO_KSY_SOURCE)
  : resolve(root, "..", "pko-map-lab", "formats");
const targetDir = resolve(root, "formats");

if (!existsSync(sourceDir)) {
  console.error(`[kaitai] Source formats directory not found: ${sourceDir}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

const sourceFiles = readdirSync(sourceDir)
  .filter((name) => extname(name) === ".ksy")
  .sort();

if (sourceFiles.length === 0) {
  console.error(`[kaitai] No .ksy files found in source: ${sourceDir}`);
  process.exit(1);
}

for (const name of sourceFiles) {
  cpSync(join(sourceDir, name), join(targetDir, name));
  console.log(`[kaitai] synced ${name}`);
}

const sourceSet = new Set(sourceFiles);
for (const name of readdirSync(targetDir)) {
  if (extname(name) !== ".ksy") {
    continue;
  }
  if (!sourceSet.has(name)) {
    rmSync(join(targetDir, name));
    console.log(`[kaitai] removed stale ${name}`);
  }
}

console.log(`[kaitai] sync complete from ${sourceDir} -> ${targetDir}`);
