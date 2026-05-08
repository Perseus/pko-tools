import type { SubEffect } from "@/types/effect";
import { getPkoTimedFrameIndex } from "@/features/effect/animation";

export const EFFECT_FRAMETEX = 1;

export function normalizePkoMainTextureName(texName: string): string {
  const normalized = texName.toLowerCase();
  return normalized.replace(/\.(dds|tga)$/i, "");
}

export function resolveFrameTextureName(
  subEffect: SubEffect,
  playbackTime: number,
  loop: boolean,
): string {
  if (subEffect.effectType !== EFFECT_FRAMETEX) return subEffect.texName;

  const frameTexCount = Math.min(
    Math.max(Math.floor(subEffect.frameTexCount || 0), 0),
    subEffect.frameTexNames.length,
  );
  const frameTexTime = subEffect.frameTexTime || 0;

  if (frameTexCount === 0) return subEffect.texName;
  if (frameTexCount === 1) return subEffect.frameTexNames[0] || subEffect.texName;
  if (frameTexTime <= 0) return subEffect.texName;

  const frameIndex = getPkoTimedFrameIndex(
    playbackTime,
    frameTexTime,
    frameTexCount,
    loop,
  );

  return frameIndex === null
    ? subEffect.texName
    : subEffect.frameTexNames[frameIndex] || subEffect.texName;
}

export function resolveTraceTextureName(
  subEffect: SubEffect,
  playbackTime: number,
  loop: boolean,
): string {
  if (subEffect.effectType !== EFFECT_FRAMETEX) {
    return normalizePkoMainTextureName(subEffect.texName);
  }

  const frameTexCount = Math.min(
    Math.max(Math.floor(subEffect.frameTexCount || 0), 0),
    subEffect.frameTexNames.length,
  );
  const frameTexTime = subEffect.frameTexTime || 0;

  if (frameTexCount === 0) return normalizePkoMainTextureName(subEffect.texName);
  if (frameTexCount === 1) {
    return subEffect.frameTexNames[0] || normalizePkoMainTextureName(subEffect.texName);
  }
  if (frameTexTime <= 0) return normalizePkoMainTextureName(subEffect.texName);

  const frameIndex = getPkoTimedFrameIndex(
    playbackTime,
    frameTexTime,
    frameTexCount,
    loop,
  );

  return frameIndex === null
    ? normalizePkoMainTextureName(subEffect.texName)
    : subEffect.frameTexNames[frameIndex] || normalizePkoMainTextureName(subEffect.texName);
}
