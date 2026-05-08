import { EffectFile } from "@/types/effect";
import { ParFile, ParSystem } from "@/types/effect-v2";

const MODEL_PARTICLE_TYPES = new Set([5, 6, 8]);

export function getNestedParticleEffectNames(par: ParFile | null): string[] {
  if (!par) return [];
  const names = new Set<string>();
  for (const system of par.systems) {
    const modelName = system.modelName.trim();
    if (modelName.toLowerCase().endsWith(".eff")) {
      names.add(modelName);
    }
  }
  return [...names];
}

export function estimateEffectDuration(effect: EffectFile): number {
  return Math.max(0, ...effect.subEffects.map((subEffect) => {
    const keyedDuration = subEffect.frameTimes.reduce((total, time) => total + Math.max(0, time), 0);
    return Math.max(0, subEffect.length, keyedDuration);
  }));
}

export function estimateStandaloneParticlePreviewDuration(
  par: ParFile | null,
  nestedEffects: EffectFile[] = [],
): number {
  if (!par) return 0;

  const durations = [
    Math.max(0, par.length),
    ...par.systems.map(estimateSystemPreviewDuration),
    ...par.strips.map((strip) => Math.max(0, strip.life + Math.max(0, strip.maxLen - 1) * strip.step)),
    ...nestedEffects.map(estimateEffectDuration),
  ];

  return Math.max(0, ...durations);
}

function estimateSystemPreviewDuration(system: ParSystem): number {
  const delay = Math.max(0, system.delayTime);
  const playTime = Math.max(0, system.playTime);
  const life = Math.max(0, system.life);

  if (playTime > 0) return delay + playTime;

  // Source MODEL/STRIP/ARRAW systems do not serialize a finite loop flag. Their authored
  // life is still the best standalone preview extent when no call-site play time exists.
  if (MODEL_PARTICLE_TYPES.has(system.type)) return delay + life;

  return delay + life;
}
