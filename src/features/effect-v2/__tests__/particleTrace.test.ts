import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  diffParticleTraceSessions,
  sampleParticleTraceFrame,
  sampleParticleTraceSession,
  serializeParticleTraceSession,
} from "../particleTrace";
import type { Particle } from "../renderers/particles/useParticleLifecycle";

function particle(overrides: Partial<Particle> = {}): Particle {
  return {
    alive: true,
    pos: new THREE.Vector3(1, 2, 3),
    dir: new THREE.Vector3(0, 1, 0),
    accel: new THREE.Vector3(0, 0, -1),
    size: 2,
    color: new THREE.Color(0.25, 0.5, 0.75),
    alpha: 0.8,
    angle: new THREE.Vector3(0.1, 0.2, 0.3),
    index: 4,
    curFrame: 1,
    curTime: 0.2,
    frameTime: 0.5,
    life: 1.5,
    elapsed: 0.6,
    ...overrides,
  };
}

describe("sampleParticleTraceFrame", () => {
  it("captures alive count and per-particle render state samples", () => {
    const frame = sampleParticleTraceFrame({
      systemIndex: 2,
      systemType: 3,
      time: 0.25,
      particles: [
        particle(),
        particle({ alive: false, index: 5 }),
      ],
    });

    expect(frame).toEqual({
      time: 0.25,
      systemIndex: 2,
      systemType: 3,
      aliveCount: 1,
      samples: [{
        index: 4,
        position: [1, 2, 3],
        direction: [0, 1, 0],
        acceleration: [0, 0, -1],
        size: 2,
        color: [0.25, 0.5, 0.75],
        alpha: 0.8,
        angle: [0.1, 0.2, 0.3],
        curFrame: 1,
        curTime: 0.2,
        elapsed: 0.6,
        life: 1.5,
      }],
    });
  });

  it("caps sampled particles for stable artifacts", () => {
    const frame = sampleParticleTraceFrame({
      systemIndex: 0,
      systemType: 2,
      time: 0,
      particles: [particle({ index: 0 }), particle({ index: 1 }), particle({ index: 2 })],
      maxSamples: 2,
    });

    expect(frame.aliveCount).toBe(3);
    expect(frame.samples.map((sample) => sample.index)).toEqual([0, 1]);
  });
});

describe("particle trace sessions", () => {
  it("serializes stable JSON", () => {
    const session = sampleParticleTraceSession([
      sampleParticleTraceFrame({ systemIndex: 0, systemType: 2, time: 0, particles: [particle()] }),
    ]);

    expect(serializeParticleTraceSession(session)).toBe(JSON.stringify(session, null, 2));
  });

  it("reports field-level diffs with numeric tolerances", () => {
    const expected = sampleParticleTraceSession([
      sampleParticleTraceFrame({ systemIndex: 0, systemType: 2, time: 0, particles: [particle()] }),
    ]);
    const actual = structuredClone(expected);
    actual.frames[0].samples[0].position[1] += 0.25;

    expect(diffParticleTraceSessions(expected, actual, { epsilon: 0.01 })).toEqual([
      {
        frameIndex: 0,
        field: "samples[0].position[1]",
        expected: 2,
        actual: 2.25,
      },
    ]);
  });
});
