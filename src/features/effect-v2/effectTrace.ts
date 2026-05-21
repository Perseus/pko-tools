import * as THREE from "three";
import type { EffectFile, Vec3, Vec4 } from "@/types/effect";
import { getFrameDurations, interpolateFrame } from "@/features/effect/animation";
import { buildEffectMaterialProps } from "@/features/effect/buildEffectMaterialProps";
import {
  composePkoRenderState,
  type PkoTechniqueState,
} from "@/features/effect/pkoStateEmulation";
import { resolveTraceTextureName } from "./frameTexture";
import { computeEffectGroupRotation } from "./renderers/effectGroupKinematics";

export const EFFECT_TRACE_ARTIFACT_SCHEMA = "pko-effect-trace/v1";
export const EFFECT_TRACE_COORDINATE_SYSTEM = "pko-z-up";

export interface EffectTraceMaterialState {
  transparent: boolean;
  opacity: number;
  blending: THREE.Blending;
  blendSrc: THREE.BlendingSrcFactor;
  blendDst: THREE.BlendingDstFactor;
  depthTest: boolean;
  depthWrite: boolean;
  alphaTest: number;
  side: THREE.Side;
}

export interface EffectTraceSubEffect {
  index: number;
  effectName: string;
  modelName: string;
  textureName: string;
  frameIndex: number;
  nextFrameIndex: number;
  lerp: number;
  texFrameIndex: number;
  position: Vec3;
  scale: Vec3;
  angle: Vec3;
  color: Vec4;
  localMatrix: number[][];
  renderState: PkoTechniqueState;
  material: EffectTraceMaterialState;
}

export interface EffectTraceFrame {
  time: number;
  localTime: number;
  idxTech: number;
  groupQuaternion: [number, number, number, number];
  subEffects: EffectTraceSubEffect[];
}

export interface EffectTraceSession {
  sampleTimes: number[];
  frames: EffectTraceFrame[];
}

export interface EffectTraceArtifact extends EffectTraceSession {
  schema: typeof EFFECT_TRACE_ARTIFACT_SCHEMA;
  source: string;
  coordinateSystem: typeof EFFECT_TRACE_COORDINATE_SYSTEM;
  effectName?: string;
  generatedAt?: string;
}

export interface EffectTraceArtifactMetadata {
  source?: string;
  effectName?: string;
  generatedAt?: string;
}

export interface EffectTraceDiff {
  frameIndex: number;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface EffectTraceDiffOptions {
  epsilon?: number;
}

export function sampleEffectTraceFrame(
  effect: EffectFile,
  elapsedTime: number,
  loop: boolean,
): EffectTraceFrame {
  const localTime = getEffectLocalTime(effect, elapsedTime, loop);
  const groupRotation = computeEffectGroupRotation(effect, localTime);

  return {
    time: elapsedTime,
    localTime,
    idxTech: effect.idxTech,
    groupQuaternion: [
      groupRotation.x,
      groupRotation.y,
      groupRotation.z,
      groupRotation.w,
    ],
    subEffects: effect.subEffects.map((subEffect, index) => {
      const frame = interpolateFrame(subEffect, localTime, loop);
      const techniqueState = composePkoRenderState(effect.idxTech, {
        srcBlend: subEffect.srcBlend || undefined,
        destBlend: subEffect.destBlend || undefined,
      });
      const material = buildEffectMaterialProps(subEffect, null, techniqueState);

      const appliedAngle = subEffect.billboard && !subEffect.rotaBoard
        ? [0, 0, 0] as Vec3
        : frame.angle;

      return {
        index,
        effectName: subEffect.effectName,
        modelName: subEffect.modelName,
        textureName: resolveTraceTextureName(subEffect, localTime, loop),
        frameIndex: frame.frameIndex,
        nextFrameIndex: frame.nextFrameIndex,
        lerp: frame.lerp,
        texFrameIndex: frame.texFrameIndex,
        position: frame.position,
        scale: frame.size,
        angle: appliedAngle,
        color: frame.color,
        localMatrix: d3dLocalMatrix(frame.size, appliedAngle, frame.position),
        renderState: { ...techniqueState },
        material: {
          transparent: material.transparent,
          opacity: material.opacity,
          blending: material.blending,
          blendSrc: material.blendSrc,
          blendDst: material.blendDst,
          depthTest: material.depthTest,
          depthWrite: material.depthWrite,
          alphaTest: material.alphaTest,
          side: material.side,
        },
      };
    }),
  };
}

export function sampleEffectTraceSession(
  effect: EffectFile,
  sampleTimes: number[],
  loop: boolean,
): EffectTraceSession {
  return {
    sampleTimes: [...sampleTimes],
    frames: sampleTimes.map((time) => sampleEffectTraceFrame(effect, time, loop)),
  };
}

export function toEffectTraceArtifact(
  session: EffectTraceSession,
  metadata: EffectTraceArtifactMetadata = {},
): EffectTraceArtifact {
  return {
    schema: EFFECT_TRACE_ARTIFACT_SCHEMA,
    source: metadata.source ?? "pko-tools",
    coordinateSystem: EFFECT_TRACE_COORDINATE_SYSTEM,
    ...(metadata.effectName ? { effectName: metadata.effectName } : {}),
    ...(metadata.generatedAt ? { generatedAt: metadata.generatedAt } : {}),
    sampleTimes: [...session.sampleTimes],
    frames: session.frames,
  };
}

export function serializeEffectTraceSession(session: EffectTraceSession): string {
  return JSON.stringify(session, null, 2);
}

export function serializeEffectTraceArtifact(artifact: EffectTraceArtifact): string {
  return JSON.stringify(artifact, null, 2);
}

export function parseEffectTraceSessionJson(json: string): EffectTraceSession {
  return extractTraceSession(parseJsonObject(json, "effect trace JSON"));
}

export function parseEffectTraceArtifactJson(json: string): EffectTraceArtifact {
  const value = parseJsonObject(json, "effect trace artifact JSON");
  const session = extractTraceSession(value);

  if ("schema" in value && value.schema !== EFFECT_TRACE_ARTIFACT_SCHEMA) {
    throw new Error(`Unsupported effect trace schema: ${String(value.schema)}`);
  }

  const coordinateSystem = value.coordinateSystem ?? EFFECT_TRACE_COORDINATE_SYSTEM;
  if (coordinateSystem !== EFFECT_TRACE_COORDINATE_SYSTEM) {
    throw new Error(
      `Unsupported effect trace coordinateSystem: ${String(coordinateSystem)}`,
    );
  }

  return {
    schema: EFFECT_TRACE_ARTIFACT_SCHEMA,
    source: readOptionalString(value.source) ?? "unknown",
    coordinateSystem: EFFECT_TRACE_COORDINATE_SYSTEM,
    ...(readOptionalString(value.effectName)
      ? { effectName: String(value.effectName) }
      : {}),
    ...(readOptionalString(value.generatedAt)
      ? { generatedAt: String(value.generatedAt) }
      : {}),
    sampleTimes: session.sampleTimes,
    frames: session.frames,
  };
}

export function diffEffectTraceArtifactJson(
  expectedGoldenJson: string,
  actual: EffectTraceSession | string,
  options: EffectTraceDiffOptions = {},
): EffectTraceDiff[] {
  const expected = parseEffectTraceArtifactJson(expectedGoldenJson);
  const actualSession =
    typeof actual === "string" ? parseEffectTraceSessionJson(actual) : actual;

  return diffEffectTraceSessions(expected, actualSession, options);
}

export function diffEffectTraceSessions(
  expected: EffectTraceSession,
  actual: EffectTraceSession,
  options: EffectTraceDiffOptions = {},
): EffectTraceDiff[] {
  const epsilon = options.epsilon ?? 0.001;
  const diffs: EffectTraceDiff[] = [];
  const frameCount = Math.min(expected.frames.length, actual.frames.length);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    diffValue(
      expected.frames[frameIndex],
      actual.frames[frameIndex],
      "",
      frameIndex,
      epsilon,
      diffs,
    );
  }

  if (expected.frames.length !== actual.frames.length) {
    diffs.push({
      frameIndex: frameCount,
      field: "frames.length",
      expected: expected.frames.length,
      actual: actual.frames.length,
    });
  }

  return diffs;
}

function parseJsonObject(json: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${(error as Error).message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid ${label}: expected object`);
  }

  return parsed;
}

function extractTraceSession(value: Record<string, unknown>): EffectTraceSession {
  const source = isPlainObject(value.session) ? value.session : value;
  const sampleTimes = source.sampleTimes;
  const frames = source.frames;

  if (!isNumberArray(sampleTimes)) {
    throw new Error("Invalid effect trace session: sampleTimes must be a number array");
  }
  if (!Array.isArray(frames)) {
    throw new Error("Invalid effect trace session: frames must be an array");
  }

  return {
    sampleTimes: [...sampleTimes],
    frames: frames as EffectTraceFrame[],
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

function getEffectLocalTime(effect: EffectFile, elapsedTime: number, loop: boolean): number {
  const totalDuration = effect.subEffects.reduce((maxDuration, subEffect) => {
    const duration = getFrameDurations(subEffect).reduce((total, value) => total + value, 0);
    return Math.max(maxDuration, duration);
  }, 0);

  if (totalDuration <= 0) return elapsedTime;
  if (loop) return ((elapsedTime % totalDuration) + totalDuration) % totalDuration;
  return Math.max(0, Math.min(elapsedTime, totalDuration));
}

function d3dLocalMatrix(scale: Vec3, angle: Vec3, position: Vec3): number[][] {
  const pitch = angle[0];
  const yaw = angle[1];
  const roll = angle[2];
  const rotation = multiplyMatrix4(
    multiplyMatrix4(rotationZ(roll), rotationX(pitch)),
    rotationY(yaw),
  );

  return [
    [
      scale[0] * rotation[0][0],
      scale[0] * rotation[0][1],
      scale[0] * rotation[0][2],
      0,
    ],
    [
      scale[1] * rotation[1][0],
      scale[1] * rotation[1][1],
      scale[1] * rotation[1][2],
      0,
    ],
    [
      scale[2] * rotation[2][0],
      scale[2] * rotation[2][1],
      scale[2] * rotation[2][2],
      0,
    ],
    [position[0], position[1], position[2], 1],
  ];
}

function rotationX(angle: number): number[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [1, 0, 0, 0],
    [0, c, s, 0],
    [0, -s, c, 0],
    [0, 0, 0, 1],
  ];
}

function rotationY(angle: number): number[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [c, 0, -s, 0],
    [0, 1, 0, 0],
    [s, 0, c, 0],
    [0, 0, 0, 1],
  ];
}

function rotationZ(angle: number): number[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [c, s, 0, 0],
    [-s, c, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function multiplyMatrix4(a: number[][], b: number[][]): number[][] {
  return a.map((row) =>
    row.map((_, col) =>
      row[0] * b[0][col] +
      row[1] * b[1][col] +
      row[2] * b[2][col] +
      row[3] * b[3][col]
    )
  );
}

function diffValue(
  expected: unknown,
  actual: unknown,
  path: string,
  frameIndex: number,
  epsilon: number,
  diffs: EffectTraceDiff[],
): void {
  if (typeof expected === "number" && typeof actual === "number") {
    if (Math.abs(expected - actual) > epsilon) {
      diffs.push({ frameIndex, field: path, expected, actual });
    }
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.min(expected.length, actual.length);
    for (let i = 0; i < length; i++) {
      diffValue(expected[i], actual[i], `${path}[${i}]`, frameIndex, epsilon, diffs);
    }
    if (expected.length !== actual.length) {
      diffs.push({
        frameIndex,
        field: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      });
    }
    return;
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of Object.keys(expected)) {
      const childPath = path ? `${path}.${key}` : key;
      diffValue(expected[key], actual[key], childPath, frameIndex, epsilon, diffs);
    }
    return;
  }

  if (expected !== actual) {
    diffs.push({ frameIndex, field: path, expected, actual });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
