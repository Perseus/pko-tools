import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";
import { flightTrace } from "../renderers/flight/paths/trace";
import {
  FlightContext,
  applyMagicRotatingXZ,
  orientFlightGroupToTarget,
} from "../renderers/flight/FlightPathController";

function createContext(overrides?: Partial<FlightContext>): FlightContext {
  return {
    origin: new THREE.Vector3(0, 0, 0),
    target: new THREE.Vector3(0, 8, 0),
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

  it("starts at the emission origin like CMagicCtrl::_vPos", () => {
    const origin = new THREE.Vector3(10, -4, 2);
    const ctx = createContext({
      origin,
      target: new THREE.Vector3(10, 6, 2),
      velocity: 0,
    });

    flightTrace(ctx, group);

    expect(group.position.toArray()).toEqual(origin.toArray());
  });

  it("moves group toward target", () => {
    const ctx = createContext();
    flightTrace(ctx, group);

    // Group should have moved from origin toward target
    const distToTarget = group.position.distanceTo(
      new THREE.Vector3(ctx.target.x, ctx.target.y, ctx.target.z)
    );
    const originalDist = new THREE.Vector3(0, 8, 0).length(); // origin to emitted target
    expect(distToTarget).toBeLessThan(originalDist);
  });

  it("keeps the initial C++ trace orientation on the emitted target until XY target movement exceeds range", () => {
    const ctx = createContext({ target: new THREE.Vector3(0, 8, 2) });

    flightTrace(ctx, group);

    const orientationTarget = (ctx as FlightContext & { orientationTarget?: THREE.Vector3 }).orientationTarget;
    expect(orientationTarget?.toArray()).toEqual([0, 8, 2]);
  });

  it("matches C++ Part_trace by stepping first toward the emitted target, not target Z plus one", () => {
    const ctx = createContext({ velocity: 10, delta: 0.1 });

    flightTrace(ctx, group);

    expect(group.position.x).toBeCloseTo(0);
    expect(group.position.y).toBeCloseTo(1);
    expect(group.position.z).toBeCloseTo(0);
  });

  it("matches PointInstrPointRange by completing based on XY range and ignoring Z", () => {
    group.position.set(0.2, 7.8, 20);
    const target = new THREE.Vector3(0, 8, 0);
    const ctx = createContext({
      target,
      velocity: 0.1,
      delta: 0.1,
      state: {
        initialized: true,
        oldTarget: target.clone(),
        dir: new THREE.Vector3(0, 1, 0),
        startDist: 8,
        distSq: 64,
      },
    });

    flightTrace(ctx, group);

    expect(ctx.done).toBe(true);
  });

  it("clamps step distance to 1.5", () => {
    const ctx = createContext({
      target: new THREE.Vector3(0, 20, 0),
      velocity: 2,
      delta: 1,
    });
    flightTrace(ctx, group);

    const moved = group.position.length();
    expect(moved).toBeLessThanOrEqual(1.501); // float tolerance
  });

  it("signals done when close to target", () => {
    const ctx = createContext({
      target: new THREE.Vector3(0, 0.5, 0), // very close
    });
    group.position.set(0, 0.5, 0.5); // C++ XY-only range ignores the vertical offset.

    flightTrace(ctx, group);
    // Should be done since group is within the C++ horizontal target range.
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
      target: new THREE.Vector3(5, 8, 0), // target moved +5 on X
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
    const target = new THREE.Vector3(0, 20, 0);

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

describe("orientFlightGroupToTarget", () => {
  it("matches the full source CMagicCtrl::RotatingXZ matrix after row-vector transpose", () => {
    const group = createGroup();

    applyMagicRotatingXZ(group, new THREE.Vector3(3, 8, 5));
    group.updateMatrix();

    const sourceTempRotTransposed = [
      0.936329186, -0.351123422, 0, 0,
      0.30304572, 0.808121979, 0.505076289, 0,
      -0.177344114, -0.472917676, 0.86307466, 0,
      0, 0, 0, 1,
    ];

    group.matrix.elements.forEach((actual, index) => {
      expect(actual).toBeCloseTo(sourceTempRotTransposed[index]);
    });
  });

  it("matches CMagicCtrl::RotatingXZ by pointing the effect local +Y axis toward the target", () => {
    const group = createGroup();
    const target = new THREE.Vector3(3, 8, 5);

    orientFlightGroupToTarget(group, target);

    const localForward = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
    const targetDirection = target.clone().sub(group.position).normalize();
    expect(localForward.x).toBeCloseTo(targetDirection.x);
    expect(localForward.y).toBeCloseTo(targetDirection.y);
    expect(localForward.z).toBeCloseTo(targetDirection.z);
  });

  it("keeps the current orientation when already at the target", () => {
    const group = createGroup();
    group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    const before = group.quaternion.clone();

    orientFlightGroupToTarget(group, group.position.clone());

    expect(group.quaternion.equals(before)).toBe(true);
  });
});
