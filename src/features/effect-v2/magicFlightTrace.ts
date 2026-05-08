import * as THREE from "three";
import type { MagicSingleEntry } from "@/types/effect-v2";
import {
  applySourceStyleMagicOrientation,
  FlightContext,
  getMagicFlightPathForTest,
} from "./renderers/flight/FlightPathController";

export interface MagicFlightTraceInput {
  magicEntry: MagicSingleEntry;
  sampleTimes: number[];
  origin: THREE.Vector3;
  target: THREE.Vector3;
  fixedStep: number;
}

export interface MagicFlightTraceFrame {
  time: number;
  renderIdx: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  done: boolean;
}

export interface MagicFlightTraceSession {
  sampleTimes: number[];
  frames: MagicFlightTraceFrame[];
}

export interface MagicFlightTraceDiff {
  frameIndex: number;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface MagicFlightTraceDiffOptions {
  epsilon?: number;
}

export function sampleMagicFlightTraceSession({
  magicEntry,
  sampleTimes,
  origin,
  target,
  fixedStep,
}: MagicFlightTraceInput): MagicFlightTraceSession {
  const group = new THREE.Group();
  group.position.copy(origin);
  const state: Record<string, unknown> = {};
  const flightPath = getMagicFlightPathForTest(magicEntry.render_idx);
  const frames: MagicFlightTraceFrame[] = [];
  let elapsed = 0;
  let done = false;

  for (const sampleTime of sampleTimes) {
    while (!done && flightPath && elapsed < sampleTime) {
      const delta = Math.min(fixedStep, sampleTime - elapsed);
      const wasInitialized = Boolean(state.initialized);
      const ctx: FlightContext = {
        origin,
        target,
        velocity: magicEntry.velocity,
        elapsed: elapsed + delta,
        delta,
        state,
        done: false,
      };
      flightPath(ctx, group);
      applySourceStyleMagicOrientation(group, ctx, magicEntry.render_idx, wasInitialized);
      done = ctx.done;
      elapsed += delta;
    }

    frames.push({
      time: sampleTime,
      renderIdx: magicEntry.render_idx,
      position: [group.position.x, group.position.y, group.position.z],
      quaternion: [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w],
      done,
    });
  }

  return { sampleTimes: [...sampleTimes], frames };
}

export function diffMagicFlightTraceSessions(
  expected: MagicFlightTraceSession,
  actual: MagicFlightTraceSession,
  options: MagicFlightTraceDiffOptions = {},
): MagicFlightTraceDiff[] {
  const epsilon = options.epsilon ?? 0.001;
  const diffs: MagicFlightTraceDiff[] = [];
  const frameCount = Math.min(expected.frames.length, actual.frames.length);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    diffValue(expected.frames[frameIndex], actual.frames[frameIndex], "", frameIndex, epsilon, diffs);
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

function diffValue(
  expected: unknown,
  actual: unknown,
  path: string,
  frameIndex: number,
  epsilon: number,
  diffs: MagicFlightTraceDiff[],
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
