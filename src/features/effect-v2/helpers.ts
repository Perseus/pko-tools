import { BlendingDstFactor, DstAlphaFactor, DstColorFactor, OneFactor, OneMinusDstAlphaFactor, OneMinusDstColorFactor, OneMinusSrcAlphaFactor, OneMinusSrcColorFactor, SrcAlphaFactor, SrcColorFactor, ZeroFactor } from "three";
import type { Vec3 } from "@/types/effect";

/*
  **
 * Extract the texture base name from a sub - effect's texName.
  * Strips.dds /.tga extensions if present.Returns null if empty.
 */
export function getTextureName(texName: string): string | null {
  const trimmed = texName.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.endsWith(".dds") || lower.endsWith(".tga")) {
    return trimmed.slice(0, -4);
  }

  return trimmed;
}

export function getThreeJSBlendFromD3D(d3dBlend: number): BlendingDstFactor {
  switch (d3dBlend) {
    case 1:
      return ZeroFactor;
    case 2:
      return OneFactor;
    case 3:
      return SrcColorFactor;
    case 4:
      return OneMinusSrcColorFactor;
    case 5:
      return SrcAlphaFactor;
    case 6:
      return OneMinusSrcAlphaFactor;
    case 7:
      return DstAlphaFactor;
    case 8:
      return OneMinusDstAlphaFactor;
    case 9:
      return DstColorFactor;
    case 10:
      return OneMinusDstColorFactor;
    default:
      console.error('Unhandled D3DBlend number', d3dBlend);
      return ZeroFactor;
  }
}

/**
 * 
 * Raw texture data in PKO seems to require 1-u, 1-v to get accurate rendering in Three.JS.
 * Three's CanvasTexture already does flipY, so 1-v is taken care of
 * We do 1-u here to completely fix the orientation
 **/
export function getMappedUVs(uvs: [number, number][]): [number, number][] {
  const mappedUVs = uvs.map(([u, v]) => {
    return [1 - u, v] as [number, number];
  });

  return mappedUVs;
}

/**
 * Derive the .par filename from an .eff filename.
 * e.g. "runningattack.eff" → "runningattack.par"
 */
export function deriveParName(effName: string): string {
  return effName.replace(/\.eff$/i, ".par");
}


/**
 * Find the current keyframe for global playback time t.
 * frameTimes contains individual frame durations (not cumulative timestamps).
 * Returns the frame index and localT (time elapsed within that frame, 0..duration).
 * Clamps to the last frame when t exceeds total animation length.
 */
export function findFrame(frameTimes: number[], t: number): { frameIdx: number; localT: number } {
  let accumulated = 0;
  for (let i = 0; i < frameTimes.length - 1; i++) {
    const dur = frameTimes[i];
    if (t < accumulated + dur) {
      return { frameIdx: i, localT: t - accumulated };
    }
    accumulated += dur;
  }
  // Clamp to last frame, fully complete
  const lastIdx = Math.max(frameTimes.length - 1, 0);
  return { frameIdx: lastIdx, localT: frameTimes[lastIdx] ?? 0 };
}

/** Linear interpolation between a and b by factor t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Random float in [0, max). Equivalent to PKO's Randf(float max). */
export function randf(max: number): number {
  return Math.random() * max;
}

/** Random float in [min, max). Equivalent to PKO's Randf(float min, float max). */
export function randfRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
