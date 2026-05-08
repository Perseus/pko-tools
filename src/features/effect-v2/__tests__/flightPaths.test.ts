import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FlightContext } from "../renderers/flight/FlightPathController";
import { flightArc } from "../renderers/flight/paths/arc";
import { flightDirlight } from "../renderers/flight/paths/dirlight";
import { flightTrace } from "../renderers/flight/paths/trace";
import {
  computeFshadeTrailSamples,
  flightFshade,
  getFshadeTrailCount,
} from "../renderers/flight/paths/fshade";

function createContext(overrides?: Partial<FlightContext>): FlightContext {
  return {
    origin: new THREE.Vector3(0, 0, 0),
    target: new THREE.Vector3(0, 8, 0),
    velocity: 1,
    elapsed: 0,
    delta: 1,
    state: {},
    done: false,
    ...overrides,
  };
}

describe("flightArc", () => {
  it("matches C++ Part_arc by dropping the arc center on PKO vertical Z", () => {
    const ctx = createContext();
    const group = new THREE.Group();

    flightArc(ctx, group);

    expect(group.position.x).toBeCloseTo(0);
    expect(group.position.y).toBeCloseTo(0.6058874503);
    expect(group.position.z).toBeCloseTo(0.5254833996);
  });
});

describe("flightFshade", () => {
  it("matches C++ _iCurSNum timing by increasing trail count after 0.6 seconds", () => {
    expect(getFshadeTrailCount(0)).toBe(1);
    expect(getFshadeTrailCount(0.6)).toBe(1);
    expect(getFshadeTrailCount(0.6001)).toBe(2);
    expect(getFshadeTrailCount(1.2001)).toBe(3);
  });

  it("matches C++ Part_fshade trail positions and alpha falloff behind the projectile", () => {
    const samples = computeFshadeTrailSamples({
      position: new THREE.Vector3(0, 5, 0),
      direction: new THREE.Vector3(0, 1, 0),
      count: 3,
    });

    expect(samples.map((sample) => sample.position.toArray())).toEqual([
      [0, 4.5, 0],
      [0, 4, 0],
      [0, 3.5, 0],
    ]);
    expect(samples[0].opacity).toBeCloseTo(2 / 3);
    expect(samples[1].opacity).toBeCloseTo(1 / 3);
    expect(samples[2].opacity).toBeCloseTo(0);
  });

  it("matches C++ PointInstrPointRange completion by ignoring vertical Z distance", () => {
    const ctx = createContext({
      velocity: 1,
      delta: 1,
      state: {
        initialized: true,
        dir: new THREE.Vector3(0, 1, 0),
      },
    });
    const group = new THREE.Group();
    group.position.set(0.25, 7.75, 50);

    flightFshade(ctx, group);

    expect(ctx.done).toBe(true);
  });
});

describe("flightDirlight", () => {
  it("matches CMagicCtrl::Emission renderIdx 5 by flattening orientation target Z to origin height", () => {
    const ctx = createContext({
      target: new THREE.Vector3(3, 8, 5),
    });
    const group = new THREE.Group();

    flightDirlight(ctx, group);

    expect(ctx.orientationTarget?.toArray()).toEqual([3, 8, 0]);
    expect(group.position.toArray()).toEqual([0, 0, 0]);
  });

  it("matches Part_dirlight by completing once its one-shot effect animation duration is over", () => {
    const ctx = createContext({
      elapsed: 1.25,
      effectDuration: 1.0,
    });
    const group = new THREE.Group();

    flightDirlight(ctx, group);

    expect(ctx.done).toBe(true);
  });
});

describe("flightTrace", () => {
  it("re-aims moving targets at the provided aim point without adding another height offset", () => {
    const ctx = createContext({
      target: new THREE.Vector3(2, 8, 1),
      velocity: 1,
      delta: 1,
      state: {
        initialized: true,
        oldTarget: new THREE.Vector3(0, 8, 1),
        dir: new THREE.Vector3(0, 1, 0),
        startDist: 8,
        distSq: 64,
      },
    });
    const group = new THREE.Group();
    group.position.set(0, 1, 0);

    flightTrace(ctx, group);

    const expected = new THREE.Vector3(2, 6, 1).normalize();
    expect(ctx.orientationDirection?.x).toBeCloseTo(expected.x);
    expect(ctx.orientationDirection?.y).toBeCloseTo(expected.y);
    expect(ctx.orientationDirection?.z).toBeCloseTo(expected.z);
  });
});
