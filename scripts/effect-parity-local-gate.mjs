import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STEP_TIMEOUT_MS = 180_000;

const steps = [
  {
    name: "effect frontend parity tests",
    command: process.execPath,
    args: [
      join(repoRoot, "node_modules/vitest/vitest.mjs"),
      "run",
      "src/features/effect-v2/__tests__",
      "src/features/effect/__tests__/applySubEffectFrameMatrix.test.ts",
      "src/features/effect/__tests__/billboardFrame.test.ts",
      "src/features/effect/__tests__/stateSnapshot.test.ts",
      "src/features/effect/__tests__/effectBlendPixel.test.ts",
    ],
    cwd: repoRoot,
    timeoutMs: Number(process.env.PKO_EFFECT_PARITY_FRONTEND_TIMEOUT_MS) || DEFAULT_STEP_TIMEOUT_MS,
  },
  {
    name: "real browser alpha smoke",
    command: process.execPath,
    args: [join(repoRoot, "scripts/effect-three-alpha-smoke.mjs")],
    cwd: repoRoot,
    timeoutMs: Number(process.env.PKO_EFFECT_PARITY_ALPHA_TIMEOUT_MS) || 60_000,
  },
  {
    name: "Rust effect tests",
    command: "cargo",
    args: ["test", "effect::"],
    cwd: join(repoRoot, "src-tauri"),
    timeoutMs: Number(process.env.PKO_EFFECT_PARITY_RUST_TIMEOUT_MS) || DEFAULT_STEP_TIMEOUT_MS,
  },
  {
    name: "Rust effect v2 loader tests",
    command: "cargo",
    args: ["test", "effect_v2::"],
    cwd: join(repoRoot, "src-tauri"),
    timeoutMs: Number(process.env.PKO_EFFECT_PARITY_RUST_TIMEOUT_MS) || DEFAULT_STEP_TIMEOUT_MS,
  },
];

const corpusEnvReady = Boolean(
  process.env.PKO_EFFECT_TRACE_CORPUS_DIR &&
  process.env.PKO_EFFECT_TRACE_SOURCE_DUMPER &&
  process.env.PKO_EFFECT_TRACE_TOOLS_DUMPER &&
  existsSync(process.env.PKO_EFFECT_TRACE_CORPUS_DIR) &&
  existsSync(process.env.PKO_EFFECT_TRACE_SOURCE_DUMPER) &&
  existsSync(process.env.PKO_EFFECT_TRACE_TOOLS_DUMPER),
);

if (corpusEnvReady) {
  steps.push({
    name: "source-derived full .eff trace corpus",
    command: process.execPath,
    args: [join(repoRoot, "scripts/effect-trace-corpus-gate.mjs")],
    cwd: repoRoot,
    timeoutMs: Number(process.env.PKO_EFFECT_PARITY_TRACE_TIMEOUT_MS) || DEFAULT_STEP_TIMEOUT_MS,
  });
} else {
  console.log(
    "Skipping optional full .eff trace corpus gate; set PKO_EFFECT_TRACE_CORPUS_DIR, " +
    "PKO_EFFECT_TRACE_SOURCE_DUMPER, and PKO_EFFECT_TRACE_TOOLS_DUMPER to enable it.",
  );
}

for (const step of steps) {
  console.log(`\n==> ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env: process.env,
    stdio: "inherit",
    timeout: step.timeoutMs,
    killSignal: "SIGKILL",
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      console.error(`Step "${step.name}" timed out after ${step.timeoutMs}ms.`);
      process.exit(124);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nlocal effect parity gate passed");
