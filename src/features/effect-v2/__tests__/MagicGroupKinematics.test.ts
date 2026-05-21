import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeFanPhaseTarget,
  computeSequenceDelay,
  expandMagicGroupPhases,
} from "../renderers/magicGroupKinematics";
import { MagicGroupEntry, MagicSingleEntry } from "@/types/effect-v2";

function entry(id: number): MagicSingleEntry {
  return {
    id,
    data_name: `entry-${id}`,
    name: `Entry ${id}`,
    models: [],
    velocity: 1,
    particles: [],
    dummies: [-1, -1, -1, -1, -1, -1, -1, -1],
    render_idx: 2,
    lightId: 0,
    result_effect: "0",
  };
}

function group(overrides: Partial<MagicGroupEntry> = {}): MagicGroupEntry {
  return {
    id: 2000,
    data_name: "group",
    name: "Group",
    type_ids: [10, 11, -1, -1, -1, -1, -1, -1],
    counts: [2, 1, 0, 0, 0, 0, 0, 0],
    total_count: 3,
    render_idx: 0,
    ...overrides,
  };
}

describe("expandMagicGroupPhases", () => {
  it("matches C++ group controller expansion order by type id and count", () => {
    const phases = expandMagicGroupPhases(
      group(),
      new Map([[10, entry(10)], [11, entry(11)]]),
    );

    expect(phases.map((phase) => phase.id)).toEqual([10, 10, 11]);
  });
});

describe("computeFanPhaseTarget", () => {
  it("matches C++ Part_fan by flattening vertical Z and rotating in raw PKO XY", () => {
    const origin = new THREE.Vector3(0, 0, 5);
    const target = new THREE.Vector3(0, 8, 9);
    const result = computeFanPhaseTarget(origin, target, 0, 3);

    expect(result.z).toBe(5);
    expect(result.x).toBeCloseTo(8 * Math.sin(0.375));
    expect(result.y).toBeCloseTo(8 * Math.cos(0.375));
  });

  it("leaves a single phase aimed at the flattened target", () => {
    const origin = new THREE.Vector3(1, 2, 3);
    const target = new THREE.Vector3(1, 8, 11);

    expect(computeFanPhaseTarget(origin, target, 0, 1).toArray()).toEqual([1, 8, 3]);
  });
});

describe("computeSequenceDelay", () => {
  it("matches C++ Part_sequence SetDailTime(n * 0.2f)", () => {
    expect([0, 1, 2, 3].map(computeSequenceDelay)).toEqual([0, 0.2, 0.4, 0.6000000000000001]);
  });
});
