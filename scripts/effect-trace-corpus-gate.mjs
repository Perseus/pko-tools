import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const effectDir = args.effectDir ?? process.env.PKO_EFFECT_TRACE_CORPUS_DIR;
const sourceDumper = args.sourceDumper ?? process.env.PKO_EFFECT_TRACE_SOURCE_DUMPER;
const toolsDumper = args.toolsDumper ?? process.env.PKO_EFFECT_TRACE_TOOLS_DUMPER;
const keep = Boolean(args.keep);
const times = args.times ?? "0,0.1,0.2,0.5,1.0";

if (!effectDir || !sourceDumper || !toolsDumper) {
  printHelp();
  process.exit(2);
}

for (const [label, path] of [
  ["effect corpus directory", effectDir],
  ["source dumper", sourceDumper],
  ["pko-tools dumper", toolsDumper],
]) {
  if (!existsSync(path)) {
    console.error(`Missing ${label}: ${path}`);
    process.exit(2);
  }
}

const root = args.outDir
  ? resolve(args.outDir)
  : mkdtempSync(join(tmpdir(), "pko-effect-trace-corpus-"));
const sourceOut = join(root, "source");
const toolsOut = join(root, "pko-tools");

mkdirp(sourceOut);
mkdirp(toolsOut);

try {
  const effects = readdirSync(effectDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eff"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (effects.length === 0) {
    console.error(`No .eff files found in ${effectDir}`);
    process.exit(2);
  }

  const sourceFailures = dumpCorpus({
    dumper: sourceDumper,
    effectDir,
    effects,
    outDir: sourceOut,
    times,
    label: "source",
  });
  const toolsFailures = dumpCorpus({
    dumper: toolsDumper,
    effectDir,
    effects,
    outDir: toolsOut,
    times,
    label: "pko-tools",
  });

  console.log(`effects=${effects.length} sourceFailures=${sourceFailures.length} toolsFailures=${toolsFailures.length}`);

  if (sourceFailures.length > 0 || toolsFailures.length > 0) {
    printFailures("source", sourceFailures);
    printFailures("pko-tools", toolsFailures);
    process.exit(1);
  }

  const vitest = spawnSync(
    process.execPath,
    [
      join(repoRoot, "node_modules/vitest/vitest.mjs"),
      "run",
      "src/features/effect-v2/__tests__/effectTraceGolden.test.ts",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PKO_EFFECT_TRACE_GOLDEN_DIR: sourceOut,
        PKO_EFFECT_TRACE_ACTUAL_DIR: toolsOut,
      },
      encoding: "utf8",
      stdio: "inherit",
    },
  );

  if (vitest.error) throw vitest.error;
  if (vitest.status !== 0) process.exit(vitest.status ?? 1);

  console.log(`trace corpus gate passed: ${root}`);
} finally {
  if (!keep && !args.outDir) {
    rmSync(root, { recursive: true, force: true });
  }
}

function dumpCorpus({ dumper, effectDir, effects, outDir, times, label }) {
  const failures = [];
  for (const effect of effects) {
    const input = join(effectDir, effect);
    const output = join(outDir, `${effect.replace(/\.eff$/i, "")}.json`);
    const result = spawnSync(dumper, [input, output, "--loop", "0", "--times", times], {
      encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
      failures.push({
        effect,
        status: result.status,
        error: result.error?.message,
        stderr: result.stderr,
      });
      console.error(`[${label}] failed ${effect}`);
    }
  }
  return failures;
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

function printFailures(label, failures) {
  if (failures.length === 0) return;
  console.error(`${label} failures:`);
  for (const failure of failures.slice(0, 20)) {
    console.error(`- ${failure.effect}: status=${failure.status ?? "error"} ${failure.error ?? ""}`);
    if (failure.stderr) console.error(failure.stderr.trim());
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--keep") parsed.keep = true;
    else if (arg === "--effect-dir") parsed.effectDir = argv[++i];
    else if (arg === "--source-dumper") parsed.sourceDumper = argv[++i];
    else if (arg === "--tools-dumper") parsed.toolsDumper = argv[++i];
    else if (arg === "--times") parsed.times = argv[++i];
    else if (arg === "--out-dir") parsed.outDir = argv[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      parsed.help = true;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/effect-trace-corpus-gate.mjs \\
    --effect-dir E:/gamedev/mp-client-source/Client/client/effect \\
    --source-dumper E:/gamedev/mp-client-source/Client/client/system/pko_ref_dump.exe \\
    --tools-dumper E:/gamedev/pko-tools/src-tauri/target/debug/examples/effect_trace_dump.exe

Options:
  --times 0,0.1,0.2,0.5,1.0  Sample times, default shown.
  --out-dir PATH              Write traces to PATH instead of a temp dir.
  --keep                      Keep generated traces when using a temp dir.

Environment equivalents:
  PKO_EFFECT_TRACE_CORPUS_DIR
  PKO_EFFECT_TRACE_SOURCE_DUMPER
  PKO_EFFECT_TRACE_TOOLS_DUMPER`);
}
