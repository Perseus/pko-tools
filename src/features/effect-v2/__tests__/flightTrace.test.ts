import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";
import { flightTrace } from "../renderers/flight/paths/trace";
import { FlightContext } from "../renderers/flight/FlightPathController";

function createContext(overrides?: Partial<FlightContext>): FlightContext {
  return {
    origin: new THREE.Vector3(0, 0, 0),
    target: new THREE.Vector3(0, 0, 8),
    velocity: 10,
    elapsed: 0,
    delta: 1 / 60,
    state: {},
    done: false,
    ...overrides,
  };
}

function createGroup(): THREE.Group {
  return new THREE.Group();
}

describe("flightTrace", () => {
  let group: THREE.Group;

  beforeEach(() => {
    group = createGroup();
  });

  it("initializes state on first call", () => {
    const ctx = createContext();
    flightTrace(ctx, group);
    expect(ctx.state.initialized).toBe(true);
    expect(ctx.state.oldTarget).toBeDefined();
  });

  it("moves group toward target", () => {
    const ctx = createContext();
    flightTrace(ctx, group);

    // Group should have moved from origin toward target
    const distToTarget = group.position.distanceTo(
      new THREE.Vector3(ctx.target.x, ctx.target.y + 1, ctx.target.z)
    );
    const originalDist = new THREE.Vector3(0, 1, 8).length(); // origin to aimPoint
    expect(distToTarget).toBeLessThan(originalDist);
  });

  it("clamps step distance to 1.5", () => {
    const ctx = createContext({ velocity: 1000, delta: 1 }); // huge step
    flightTrace(ctx, group);

    const moved = group.position.length();
    expect(moved).toBeLessThanOrEqual(1.501); // float tolerance
  });

  it("signals done when close to target", () => {
    const ctx = createContext({
      target: new THREE.Vector3(0, 0, 0.5), // very close
    });
    group.position.set(0, 0.5, 0.5); // near the aim point (target.y + 1 = 1.5, but close enough)

    flightTrace(ctx, group);
    // Should be done since group is within 1.5 of aim point
    expect(ctx.done).toBe(true);
  });

  it("does not signal done when far from target", () => {
    const ctx = createContext();
    flightTrace(ctx, group);
    expect(ctx.done).toBe(false);
  });

  it("snaps to target if origin is very close", () => {
    const target = new THREE.Vector3(0.5, 0, 0);
    const ctx = createContext({ origin: new THREE.Vector3(0, 0, 0), target });
    flightTrace(ctx, group);
    expect(group.position.distanceTo(target)).toBeLessThan(0.01);
  });

  it("applies target-motion compensation", () => {
    const ctx = createContext();

    // First frame: initialize
    flightTrace(ctx, group);
    const posAfterFirst = group.position.clone();

    // Second frame: target moves sideways
    const ctx2 = createContext({
      target: new THREE.Vector3(5, 0, 8), // target moved +5 on X
      state: ctx.state,
      elapsed: 1 / 60,
      delta: 1 / 60,
    });
    flightTrace(ctx2, group);

    // Group should have drifted in +X direction due to compensation
    expect(group.position.x).toBeGreaterThan(posAfterFirst.x);
  });

  it("preserves state across frames", () => {
    const ctx = createContext();
    flightTrace(ctx, group);

    const ctx2 = createContext({
      state: ctx.state,
      elapsed: 1 / 60,
      delta: 1 / 60,
    });
    flightTrace(ctx2, group);

    // Should not re-initialize
    expect(ctx2.state.initialized).toBe(true);
  });

  it("moves consistently over multiple frames", () => {
    const state: Record<string, unknown> = {};
    const target = new THREE.Vector3(0, 0, 20);

    for (let i = 0; i < 60; i++) {
      const ctx = createContext({
        target,
        state,
        elapsed: i / 60,
        delta: 1 / 60,
      });
      flightTrace(ctx, group);
      if (ctx.done) break;
    }

    // After 60 frames at vel=10, should have traveled roughly 10 units
    expect(group.position.length()).toBeGreaterThan(5);
  });
});
