import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  sampleMagicFlightTraceSession,
  diffMagicFlightTraceSessions,
} from "../magicFlightTrace";
import { magicEntryFixture } from "./fixtures";

describe("sampleMagicFlightTraceSession", () => {
  it("matches source CMagicCtrl trace-only capture for a non-axis-aligned target", () => {
    const session = sampleMagicFlightTraceSession({
      magicEntry: { ...magicEntryFixture, render_idx: 2, velocity: 10 },
      sampleTimes: [0.099],
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(3, 8, 5),
      fixedStep: 0.033,
    });

    const frame = session.frames[0];
    expect(frame.position[0]).toBeCloseTo(0.300015271);
    expect(frame.position[1]).toBeCloseTo(0.800040841);
    expect(frame.position[2]).toBeCloseTo(0.500025511);

    const q = new THREE.Quaternion(...frame.quaternion);
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const sourceTempRotTransposed = [
      0.936329186, -0.351123422, 0, 0,
      0.30304572, 0.808121979, 0.505076289, 0,
      -0.177344114, -0.472917676, 0.86307466, 0,
      0, 0, 0, 1,
    ];

    matrix.elements.forEach((actual, index) => {
      expect(actual).toBeCloseTo(sourceTempRotTransposed[index]);
    });
  });

  it("captures path position and source-style local +Y target orientation at sample times", () => {
    const session = sampleMagicFlightTraceSession({
      magicEntry: { ...magicEntryFixture, render_idx: 2, velocity: 10 },
      sampleTimes: [0.1, 0.2, 0.3],
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(0, 8, 0),
      fixedStep: 0.1,
    });

    expect(session.frames).toHaveLength(3);
    expect(session.frames[0].position[0]).toBeCloseTo(0);
    expect(session.frames[0].position[1]).toBeCloseTo(1);
    expect(session.frames[0].position[2]).toBeCloseTo(0);
    expect(session.frames[2].position[1]).toBeGreaterThan(session.frames[0].position[1]);

    const last = session.frames[2];
    const q = new THREE.Quaternion(...last.quaternion);
    const localForward = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const targetDir = new THREE.Vector3(0, 8, 0)
      .sub(new THREE.Vector3(...last.position))
      .normalize();
    expect(localForward.dot(targetDir)).toBeGreaterThan(0.999);
  });

  it("uses dirlight's flattened orientation target when sampling trace frames", () => {
    const session = sampleMagicFlightTraceSession({
      magicEntry: { ...magicEntryFixture, render_idx: 5, velocity: 10 },
      sampleTimes: [0.1],
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(0, 8, 4),
      fixedStep: 0.1,
    });

    const frame = session.frames[0];
    const q = new THREE.Quaternion(...frame.quaternion);
    const localForward = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const flattenedTargetDir = new THREE.Vector3(0, 8, 0)
      .sub(new THREE.Vector3(...frame.position))
      .normalize();

    expect(localForward.dot(flattenedTargetDir)).toBeGreaterThan(0.999);
  });

  it("keeps non-trace paths on their source emission orientation instead of re-aiming from curved positions", () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0, 8, 4);
    const session = sampleMagicFlightTraceSession({
      magicEntry: { ...magicEntryFixture, render_idx: 4, velocity: 10 },
      sampleTimes: [0.4],
      origin,
      target,
      fixedStep: 0.1,
    });

    const frame = session.frames[0];
    const q = new THREE.Quaternion(...frame.quaternion);
    const localForward = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const emissionDir = target.clone().sub(origin).normalize();
    const dynamicDir = target.clone().sub(new THREE.Vector3(...frame.position)).normalize();

    expect(localForward.dot(emissionDir)).toBeGreaterThan(0.999);
    expect(localForward.dot(dynamicDir)).toBeLessThan(0.999);
  });
});

describe("diffMagicFlightTraceSessions", () => {
  it("reports field-level flight path differences", () => {
    const expected = sampleMagicFlightTraceSession({
      magicEntry: magicEntryFixture,
      sampleTimes: [0],
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(0, 8, 0),
      fixedStep: 0.1,
    });
    const actual = structuredClone(expected);
    actual.frames[0].position[2] += 0.5;

    expect(diffMagicFlightTraceSessions(expected, actual, { epsilon: 0.01 })).toEqual([
      {
        frameIndex: 0,
        field: "position[2]",
        expected: expected.frames[0].position[2],
        actual: actual.frames[0].position[2],
      },
    ]);
  });
});
