import { EffectFile, SubEffect } from "@/types/effect";

export type FrameRenderData = {
  subEffect: SubEffect;
  size: [number, number, number];
  angle: [number, number, number];
  position: [number, number, number];
  color: [number, number, number, number];
  frameIndex: number;
};

const DEFAULT_FRAME_DURATION = 1 / 30;

export function resolveFrameData(
  effectData: EffectFile | null,
  selectedSubEffectIndex: number | null,
  selectedFrameIndex: number
): FrameRenderData | null {
  if (!effectData || selectedSubEffectIndex === null) {
    return null;
  }

  const subEffect = effectData.subEffects[selectedSubEffectIndex];
  if (!subEffect) {
    return null;
  }

  const maxFrame = Math.max(subEffect.frameCount - 1, 0);
  const frameIndex = Math.min(Math.max(selectedFrameIndex, 0), maxFrame);

  return {
    subEffect,
    frameIndex,
    size: subEffect.frameSizes[frameIndex] ?? [1, 1, 1],
    angle: subEffect.frameAngles[frameIndex] ?? [0, 0, 0],
    position: subEffect.framePositions[frameIndex] ?? [0, 0, 0],
    color: subEffect.frameColors[frameIndex] ?? [1, 1, 1, 1],
  };
}

export function resolveGeometryType(effectType: number) {
  switch (effectType) {
    case 1:
      return "plane";
    case 2:
      return "ring";
    case 3:
      return "box";
    case 4:
      return "model";
    default:
      return "spark";
  }
}

export function resolveBlendMode(srcBlend: number, destBlend: number) {
  if (srcBlend === 5 && destBlend === 6) {
    return "normal";
  }
  if (srcBlend === 2 || destBlend === 2) {
    return "additive";
  }
  return "normal";
}

export function resolveTextureName(subEffect: SubEffect, selectedFrameIndex: number) {
  if (subEffect.frameTexNames.length > 0) {
    return subEffect.frameTexNames[selectedFrameIndex] ?? subEffect.frameTexNames[0];
  }
  return subEffect.texName;
}

export function resolveTextureCandidates(textureName: string, projectDirectory: string) {
  const sanitized = textureName.trim();
  if (!sanitized) {
    return [];
  }

  const hasExtension = sanitized.includes(".");
  const nameCandidates = hasExtension
    ? [sanitized]
    : [sanitized, `${sanitized}.png`, `${sanitized}.dds`, `${sanitized}.tga`, `${sanitized}.bmp`];
  const directories = ["texture", "texture/effect", "texture/skill", "effect"];

  return directories.flatMap((dir) =>
    nameCandidates.map((name) => `${projectDirectory}/${dir}/${name}`)
  );
}

export function resolveFrameDurations(subEffect: SubEffect) {
  if (subEffect.frameTimes.length > 0) {
    return subEffect.frameTimes.map((time) => Math.max(time, DEFAULT_FRAME_DURATION));
  }
  return Array.from({ length: subEffect.frameCount }, () => DEFAULT_FRAME_DURATION);
}
