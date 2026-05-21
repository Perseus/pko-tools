import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  EFFECT_TRACE_ARTIFACT_SCHEMA,
  diffEffectTraceArtifactJson,
  diffEffectTraceSessions,
  parseEffectTraceArtifactJson,
  parseEffectTraceSessionJson,
  serializeEffectTraceSession,
  toEffectTraceArtifact,
  sampleEffectTraceFrame,
  sampleEffectTraceSession,
} from "../effectTrace";
import { baseSubEffect, effectFixture } from "./fixtures";

describe("sampleEffectTraceFrame", () => {
  it("captures deterministic sub-effect transform, texture, and render state at a timestamp", () => {
    const effect = {
      ...effectFixture,
      idxTech: 5,
      subEffects: [
        {
          ...baseSubEffect,
          alpha: true,
          srcBlend: 5,
          destBlend: 2,
          frameTimes: [0.5, 0.5],
        },
      ],
    };

    const frame = sampleEffectTraceFrame(effect, 0.25, true);

    expect(frame.time).toBe(0.25);
    expect(frame.idxTech).toBe(5);
    expect(frame.subEffects).toHaveLength(1);
    expect(frame.subEffects[0]).toMatchObject({
      index: 0,
      effectName: "TestEffect",
      modelName: "RectPlane",
      textureName: "spark",
      frameIndex: 0,
      nextFrameIndex: 1,
      position: [1.5, 0, 1],
      scale: [1.5, 1.5, 1.5],
      color: [1, 0.5, 0.5, 0.75],
      localMatrix: [
        [1.5, 0, 0, 0],
        [0, 1.5, 0, 0],
        [0, 0, 1.5, 0],
        [1.5, 0, 1, 1],
      ],
      material: {
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
      },
      renderState: {
        zEnable: false,
        zWriteEnable: false,
        alphaBlendEnable: true,
        srcBlend: 5,
        destBlend: 2,
        cullMode: 3,
      },
    });
  });

  it("reports the C++ runtime texture key for normal sub-effect textures", () => {
    const frame = sampleEffectTraceFrame({
      ...effectFixture,
      subEffects: [{
        ...baseSubEffect,
        effectType: 0,
        texName: "Spark.TGA",
      }],
    }, 0, true);

    expect(frame.subEffects[0].textureName).toBe("spark");
  });

  it("preserves authored spaces in C++ runtime texture keys", () => {
    const frame = sampleEffectTraceFrame({
      ...effectFixture,
      subEffects: [{
        ...baseSubEffect,
        effectType: 0,
        texName: "JJ1 .TGA",
      }],
    }, 0, true);

    expect(frame.subEffects[0].textureName).toBe("jj1 ");
  });

  it("captures effect-level group rotation for rotating .eff files", () => {
    const frame = sampleEffectTraceFrame({
      ...effectFixture,
      rotating: true,
      rotaVec: [0, 0, 1],
      rotaVel: Math.PI,
    }, 0.5, true);

    expect(frame.groupQuaternion[0]).toBeCloseTo(0);
    expect(frame.groupQuaternion[1]).toBeCloseTo(0);
    expect(frame.groupQuaternion[2]).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(frame.groupQuaternion[3]).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it("reports applied C++ runtime angle for billboard sub-effects", () => {
    const frame = sampleEffectTraceFrame({
      ...effectFixture,
      subEffects: [{
        ...baseSubEffect,
        billboard: true,
        effectType: 0,
        frameAngles: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      }],
    }, 0.25, true);

    expect(frame.subEffects[0].angle).toEqual([0, 0, 0]);
  });

  it("reports billboard runtime angle for model effects too", () => {
    const frame = sampleEffectTraceFrame({
      ...effectFixture,
      subEffects: [{
        ...baseSubEffect,
        billboard: true,
        effectType: 4,
        frameAngles: [
          [1, 2, 3],
          [3, 4, 5],
        ],
      }],
    }, 0.25, true);

    expect(frame.subEffects[0].angle).toEqual([0, 0, 0]);
  });

  it("preserves authored angle for rotaBoard billboard sub-effects", () => {
    const frame = sampleEffectTraceFrame({
      ...effectFixture,
      subEffects: [{
        ...baseSubEffect,
        billboard: true,
        rotaBoard: true,
        effectType: 4,
        frameAngles: [
          [1, 2, 3],
          [3, 4, 5],
        ],
      }],
    }, 0.25, true);

    expect(frame.subEffects[0].angle[0]).toBeCloseTo(2.1333333333333333);
    expect(frame.subEffects[0].angle[1]).toBeCloseTo(3.1333333333333333);
    expect(frame.subEffects[0].angle[2]).toBeCloseTo(4.133333333333333);
  });
});

describe("sampleEffectTraceSession", () => {
  it("captures a deterministic sequence of frames at requested timestamps", () => {
    const session = sampleEffectTraceSession(effectFixture, [0, 0.25, 0.5], true);

    expect(session.sampleTimes).toEqual([0, 0.25, 0.5]);
    expect(session.frames.map((frame) => frame.time)).toEqual([0, 0.25, 0.5]);
    expect(session.frames).toHaveLength(3);
  });
});

describe("serializeEffectTraceSession", () => {
  it("produces stable pretty JSON for trace artifact downloads", () => {
    const session = sampleEffectTraceSession(effectFixture, [0], true);

    const json = serializeEffectTraceSession(session);

    expect(json).toBe(JSON.stringify(session, null, 2));
    expect(json).toContain('"sampleTimes"');
    expect(json).toContain('"subEffects"');
  });
});

describe("effect trace golden artifacts", () => {
  it("wraps pko-tools traces in a versioned z-up artifact", () => {
    const session = sampleEffectTraceSession(effectFixture, [0], true);

    const artifact = toEffectTraceArtifact(session, {
      source: "pko-tools",
      effectName: "lighty.eff",
    });

    expect(artifact).toMatchObject({
      schema: EFFECT_TRACE_ARTIFACT_SCHEMA,
      source: "pko-tools",
      effectName: "lighty.eff",
      coordinateSystem: "pko-z-up",
      sampleTimes: [0],
    });
  });

  it("parses original-client golden artifacts and legacy raw sessions", () => {
    const session = sampleEffectTraceSession(effectFixture, [0], true);
    const goldenJson = JSON.stringify({
      schema: EFFECT_TRACE_ARTIFACT_SCHEMA,
      source: "mp-client",
      coordinateSystem: "pko-z-up",
      effectName: "lighty.eff",
      sampleTimes: session.sampleTimes,
      frames: session.frames,
    });

    const artifact = parseEffectTraceArtifactJson(goldenJson);

    expect(artifact.source).toBe("mp-client");
    expect(artifact.effectName).toBe("lighty.eff");
    expect(artifact.frames[0].subEffects[0].renderState.srcBlend).toBe(5);
    expect(parseEffectTraceSessionJson(JSON.stringify(session))).toEqual(session);
  });

  it("rejects golden traces that are not in the pko z-up runtime coordinate system", () => {
    const session = sampleEffectTraceSession(effectFixture, [0], true);
    const goldenJson = JSON.stringify({
      schema: EFFECT_TRACE_ARTIFACT_SCHEMA,
      source: "mp-client",
      coordinateSystem: "three-y-up",
      sampleTimes: session.sampleTimes,
      frames: session.frames,
    });

    expect(() => parseEffectTraceArtifactJson(goldenJson)).toThrow(
      "coordinateSystem",
    );
  });

  it("diffs a golden artifact against an actual pko-tools session", () => {
    const expected = sampleEffectTraceSession(effectFixture, [0], true);
    const actual = structuredClone(expected);
    actual.frames[0].subEffects[0].renderState.srcBlend = 2;
    const golden = toEffectTraceArtifact(expected, { source: "mp-client" });

    const diffs = diffEffectTraceArtifactJson(JSON.stringify(golden), actual);

    expect(diffs).toEqual([
      {
        frameIndex: 0,
        field: "subEffects[0].renderState.srcBlend",
        expected: 5,
        actual: 2,
      },
    ]);
  });
});

describe("diffEffectTraceSessions", () => {
  it("reports no diffs for identical trace sessions", () => {
    const session = sampleEffectTraceSession(effectFixture, [0, 0.25], true);

    expect(diffEffectTraceSessions(session, session)).toEqual([]);
  });

  it("reports field-level diffs with numeric tolerances", () => {
    const expected = sampleEffectTraceSession(effectFixture, [0], true);
    const actual = structuredClone(expected);
    actual.frames[0].subEffects[0].position[0] += 0.25;
    actual.frames[0].subEffects[0].material.depthWrite =
      !actual.frames[0].subEffects[0].material.depthWrite;

    const diffs = diffEffectTraceSessions(expected, actual, { epsilon: 0.01 });

    expect(diffs).toEqual([
      {
        frameIndex: 0,
        field: "subEffects[0].position[0]",
        expected: expected.frames[0].subEffects[0].position[0],
        actual: actual.frames[0].subEffects[0].position[0],
      },
      {
        frameIndex: 0,
        field: "subEffects[0].material.depthWrite",
        expected: expected.frames[0].subEffects[0].material.depthWrite,
        actual: actual.frames[0].subEffects[0].material.depthWrite,
      },
    ]);
  });
});
