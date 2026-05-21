import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const localGateScript = join(repoRoot, "scripts/effect-parity-local-gate.mjs");
const alphaSmokeScript = join(repoRoot, "scripts/effect-three-alpha-smoke.mjs");

describe("effect parity local gate", () => {
  it("runs the v2 Rust loader tests that feed the effect renderer", () => {
    const source = readFileSync(localGateScript, "utf8");

    expect(source).toContain('"Rust effect v2 loader tests"');
    expect(source).toContain('"effect_v2::"');
  });

  it("bounds spawned gate steps so timeouts do not leave noisy child processes running", () => {
    const source = readFileSync(localGateScript, "utf8");

    expect(source).toContain("timeout:");
    expect(source).toContain('killSignal: "SIGKILL"');
    expect(source).toContain("timed out");
  });

  it("uses the bounded isolated render launch as the alpha smoke browser verification", () => {
    const source = readFileSync(alphaSmokeScript, "utf8");

    expect(source).toContain("BROWSER_RENDER_TIMEOUT_MS");
    expect(source).toContain("--user-data-dir=");
    expect(source).toContain('killSignal: "SIGKILL"');
    expect(source).not.toContain('"--version"');
  });
});
