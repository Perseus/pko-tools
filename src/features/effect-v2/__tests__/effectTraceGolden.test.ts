import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffEffectTraceArtifactJson } from "../effectTrace";

const goldenPath = process.env.PKO_EFFECT_TRACE_GOLDEN;
const actualPath = process.env.PKO_EFFECT_TRACE_ACTUAL;
const goldenDir = process.env.PKO_EFFECT_TRACE_GOLDEN_DIR;
const actualDir = process.env.PKO_EFFECT_TRACE_ACTUAL_DIR;

type GoldenCorpusFailure = {
  file: string;
  field: string;
  expected: unknown;
  actual: unknown;
  frameIndex?: number;
};

describe.skipIf(!goldenPath || !actualPath)("effect trace golden pair parity", () => {
  it("matches an original-client golden trace artifact", () => {
    const goldenJson = readFileSync(goldenPath!, "utf8");
    const actualJson = readFileSync(actualPath!, "utf8");

    expect(diffEffectTraceArtifactJson(goldenJson, actualJson)).toEqual([]);
  });
});

describe.skipIf(!goldenDir || !actualDir)("effect trace golden corpus parity", () => {
  it("matches every original-client golden trace artifact in the corpus directory", () => {
    const goldenFiles = readdirSync(goldenDir!)
      .filter((name) => name.endsWith(".json"))
      .sort();

    expect(goldenFiles.length).toBeGreaterThan(0);

    const failures = goldenFiles.flatMap<GoldenCorpusFailure>((name) => {
      const goldenFile = join(goldenDir!, name);
      const actualFile = join(actualDir!, name);

      if (!existsSync(actualFile)) {
        return [{ file: name, field: "actualFile", expected: "exists", actual: "missing" }];
      }

      const diffs = diffEffectTraceArtifactJson(
        readFileSync(goldenFile, "utf8"),
        readFileSync(actualFile, "utf8"),
      );

      return diffs.map((diff) => ({ file: name, ...diff }));
    });

    expect(failures).toEqual([]);
  });
});
