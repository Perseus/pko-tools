/**
 * Pure animation interpolation logic for PKO effects.
 *
 * Implements the frame-advance + linear-interpolation logic from
 * CMPModelEff::FrameMove (MPModelEff.cpp:429-508).
 *
 * Separated from React/Three.js so it can be unit-tested independently.
 */
import type { SubEffect, Vec2, Vec3, Vec4 } from "@/types/effect";

export type InterpolatedFrame = {
  size: Vec3;
  angle: Vec3;
  position: Vec3;
  color: Vec4;
  frameIndex: number;
  nextFrameIndex: number;
  lerp: number;
  /** Index into frameTexNames for EFFECT_FRAMETEX, computed from independent frameTexTime. */
  texFrameIndex: number;
};

const DEFAULT_FRAME_DURATION = 1 / 30;

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function lerpVec4(a: Vec4, b: Vec4, t: number): Vec4 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

export function getFrameDurations(subEffect: SubEffect): number[] {
  if (subEffect.frameTimes.length > 0) {
    return subEffect.frameTimes.map((t) => Math.max(t, DEFAULT_FRAME_DURATION));
  }
  return Array.from({ length: subEffect.frameCount }, () => DEFAULT_FRAME_DURATION);
}

/**
 * Frame index for PKO texture-style timers.
 *
 * C++ CTexList::GetCurTexture and CTexFrame::GetCurTexture advance only when
 * accumulated time is strictly greater than frameTime, so exact boundaries
 * still use the previous frame.
 */
export function getPkoTimedFrameIndex(
  elapsedTime: number,
  frameTime: number,
  frameCount: number,
  loop: boolean,
): number | null {
  if (frameCount <= 0) return null;
  if (frameCount === 1) return 0;
  if (frameTime <= 0) return null;

  const rawTime = Number.isFinite(elapsedTime) ? Math.max(elapsedTime, 0) : 0;
  if (rawTime <= 0) return 0;

  const rawIndex = Math.max(Math.ceil(rawTime / frameTime) - 1, 0);
  if (loop) return rawIndex % frameCount;

  return Math.min(rawIndex, frameCount - 1);
}

/**
 * Compute interpolated frame data for a sub-effect at a given elapsed time.
 *
 * Finds the current keyframe from elapsed time, computes a lerp factor within
 * that frame's duration, then linearly interpolates all properties between the
 * current and next keyframe.
 */
export function interpolateFrame(
  subEffect: SubEffect,
  elapsedTime: number,
  loop: boolean
): InterpolatedFrame {
  const durations = getFrameDurations(subEffect);
  const totalDuration = durations.reduce((s, v) => s + v, 0);
  const frameCount = durations.length;

  if (frameCount === 0 || totalDuration <= 0) {
    return {
      size: [1, 1, 1],
      angle: [0, 0, 0],
      position: [0, 0, 0],
      color: [1, 1, 1, 1],
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
      texFrameIndex: 0,
    };
  }

  // Normalize elapsed time
  let t = elapsedTime;
  if (loop && totalDuration > 0) {
    t = ((t % totalDuration) + totalDuration) % totalDuration;
  } else {
    t = Math.max(0, Math.min(t, totalDuration));
  }

  // Walk through frame durations to find current frame and lerp factor
  let accumulator = 0;
  let frameIndex = frameCount - 1;
  let lerp = 0;

  for (let i = 0; i < frameCount; i++) {
    if (t < accumulator + durations[i]) {
      frameIndex = i;
      lerp = durations[i] > 0 ? (t - accumulator) / durations[i] : 0;
      break;
    }
    accumulator += durations[i];
  }

  // C++ CMPModelEff::FrameMove wraps the interpolation target on the final
  // live frame regardless of the effect loop flag. Non-looping effects stop
  // only after the final frame duration expires.
  const nextFrameIndex = frameIndex >= frameCount - 1 ? 0 : frameIndex + 1;

  // Interpolate all properties between current and next keyframe
  const curSize: Vec3 = subEffect.frameSizes[frameIndex] ?? [1, 1, 1];
  const nxtSize: Vec3 = subEffect.frameSizes[nextFrameIndex] ?? [1, 1, 1];
  const curAngle: Vec3 = subEffect.frameAngles[frameIndex] ?? [0, 0, 0];
  const nxtAngle: Vec3 = subEffect.frameAngles[nextFrameIndex] ?? [0, 0, 0];
  const curPos: Vec3 = subEffect.framePositions[frameIndex] ?? [0, 0, 0];
  const nxtPos: Vec3 = subEffect.framePositions[nextFrameIndex] ?? [0, 0, 0];
  const curColor: Vec4 = subEffect.frameColors[frameIndex] ?? [1, 1, 1, 1];
  const nxtColor: Vec4 = subEffect.frameColors[nextFrameIndex] ?? [1, 1, 1, 1];

  // Compute texture frame index from independent timing (PKO CTexFrame::GetCurTexture)
  // frameTexTime is the per-texture-frame duration; texture frames cycle independently.
  let texFrameIndex = 0;
  const texCount = subEffect.frameTexNames.length;
  const timedTexFrameIndex = getPkoTimedFrameIndex(
    t,
    subEffect.frameTexTime,
    texCount,
    loop,
  );
  if (timedTexFrameIndex !== null) {
    texFrameIndex = timedTexFrameIndex;
  }

  return {
    size: lerpVec3(curSize, nxtSize, lerp),
    angle: lerpVec3(curAngle, nxtAngle, lerp),
    position: lerpVec3(curPos, nxtPos, lerp),
    color: lerpVec4(curColor, nxtColor, lerp),
    frameIndex,
    nextFrameIndex,
    lerp,
    texFrameIndex,
  };
}

/**
 * Interpolate UV coordinates for effectType 2 (EFFECT_MODELUV).
 *
 * PKO CTexCoordList::GetCurCoord: interpolates per-vertex UV coordinates
 * between keyframes stored in coordList on an independent coordFrameTime timer.
 *
 * Returns null if the sub-effect is not type 2 or has no coord data.
 */
export type InterpolatedUVs = {
  uvs: Vec2[];
  uvFrameIndex: number;
  uvLerp: number;
};

export function interpolateUVCoords(
  subEffect: SubEffect,
  elapsedTime: number,
  loop: boolean,
): InterpolatedUVs | null {
  if (subEffect.effectType !== 2) return null;
  if (subEffect.coordList.length === 0) return null;

  const coordCount = subEffect.coordList.length;
  if (coordCount === 1) {
    return {
      uvs: subEffect.coordList[0],
      uvFrameIndex: 0,
      uvLerp: 0,
    };
  }

  if (subEffect.coordFrameTime <= 0) return null;

  const cycleDuration = subEffect.coordFrameTime * coordCount;

  let t = elapsedTime;
  if (loop && cycleDuration > 0) {
    t = ((t % cycleDuration) + cycleDuration) % cycleDuration;
  } else {
    t = Math.max(0, Math.min(t, cycleDuration));
  }

  const rawIndex = t / subEffect.coordFrameTime;
  const uvFrameIndex = Math.min(Math.floor(rawIndex), coordCount - 1);
  const uvLerp = rawIndex - uvFrameIndex;

  // C++ CTexCoordList::GetCurCoord does not lerp the final UV frame back to
  // frame 0. It holds the final frame until the timer advances and wraps.
  const nextIndex =
    uvFrameIndex === coordCount - 1
      ? uvFrameIndex
      : uvFrameIndex + 1;

  const curUVs = subEffect.coordList[uvFrameIndex];
  const nxtUVs = subEffect.coordList[nextIndex];

  if (!curUVs || !nxtUVs) return null;

  const verCount = curUVs.length;
  const uvs: Vec2[] = new Array(verCount);
  for (let v = 0; v < verCount; v++) {
    const cu = curUVs[v] ?? [0, 0];
    const nu = nxtUVs[v] ?? [0, 0];
    uvs[v] = [
      cu[0] + (nu[0] - cu[0]) * uvLerp,
      cu[1] + (nu[1] - cu[1]) * uvLerp,
    ];
  }

  return { uvs, uvFrameIndex, uvLerp };
}

/**
 * Get the texture UV frame index for effectType 3 (EFFECT_MODELTEXTURE).
 *
 * PKO CTexList::GetCurTexture: steps through texList UV sets on texFrameTime timer.
 * No interpolation — snaps to nearest frame (floor division).
 *
 * Returns null if the sub-effect is not type 3 or has no tex data.
 */
export function getTexListFrameIndex(
  subEffect: SubEffect,
  elapsedTime: number,
  loop: boolean,
): number | null {
  if (subEffect.effectType !== 3) return null;
  if (subEffect.texList.length === 0) return null;

  const texCount = subEffect.texList.length;
  return getPkoTimedFrameIndex(
    elapsedTime,
    subEffect.texFrameTime,
    texCount,
    loop,
  );
}

/**
 * Compute the position along a path at a given elapsed time.
 *
 * PKO CEffPath::FrameMove: moves at constant velocity along linear path segments.
 * Loops back to start when all waypoints are traversed.
 */
export function getPathPosition(
  points: Vec3[],
  elapsedTime: number,
  velocity: number,
  loop: boolean,
): Vec3 {
  if (points.length < 2 || velocity <= 0) {
    return points[0] ?? [0, 0, 0];
  }

  // Compute segment lengths and total path length
  const segLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay, az] = points[i];
    const [bx, by, bz] = points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    segLengths.push(len);
    totalLength += len;
  }

  if (totalLength <= 0) {
    return points[0];
  }

  // Distance traveled at constant velocity
  let dist = elapsedTime * velocity;
  if (loop && totalLength > 0) {
    dist = ((dist % totalLength) + totalLength) % totalLength;
  } else {
    dist = Math.max(0, Math.min(dist, totalLength));
  }

  // Walk segments to find position
  let accumulated = 0;
  for (let i = 0; i < segLengths.length; i++) {
    if (dist <= accumulated + segLengths[i]) {
      const segT = segLengths[i] > 0 ? (dist - accumulated) / segLengths[i] : 0;
      const [ax, ay, az] = points[i];
      const [bx, by, bz] = points[i + 1];
      return [
        ax + (bx - ax) * segT,
        ay + (by - ay) * segT,
        az + (bz - az) * segT,
      ];
    }
    accumulated += segLengths[i];
  }

  return points[points.length - 1];
}
