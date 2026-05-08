import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("EffectV2Workbench standalone particle playback", () => {
  it("uses preview loop to replay standalone .par without changing particle runtime loop", () => {
    const source = readFileSync(join(process.cwd(), "src/features/effect-v2/EffectV2Workbench.tsx"), "utf8");

    expect(source).toContain("const playback = useAtomValue(effectV2PlaybackAtom);");
    expect(source).toContain("const [previewReplayKey, setPreviewReplayKey] = useState(0);");
    expect(source).toContain("if (!playback.loop || !playback.playing || playback.time <= 0) return;");
    expect(source).toContain("estimateStandaloneParticlePreviewDuration(previewPar, nestedEffects)");
    expect(source).toContain("if (previewDuration > 0 && playback.time >= previewDuration)");
    expect(source).toContain("key={`${baseName}:${previewReplayKey}`}");
    expect(source).toContain("onComplete={handlePreviewComplete}");
    expect(source).not.toContain("loop={playback.loop}");
    expect(source).not.toContain("<ParticleEffectRenderer particleEffectName={baseName} loop />");
  });
});
