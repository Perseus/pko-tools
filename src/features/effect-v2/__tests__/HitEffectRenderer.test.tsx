import { describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { TimeProvider, TimeSource } from "../TimeContext";
import {
  applyHitEffectArrivalTransform,
  HitEffectRenderer,
} from "../renderers/HitEffectRenderer";
import { ArrivalInfo } from "../renderers/flight/FlightPathController";

const { mockParticleEffectRenderer } = vi.hoisted(() => ({
  mockParticleEffectRenderer: vi.fn((_props: { particleEffectName: string; sourceDirection?: THREE.Vector3 }) => (
    <mesh>
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>
  )),
}));

vi.mock("../renderers/ParticleEffectRenderer", () => ({
  ParticleEffectRenderer: mockParticleEffectRenderer,
}));

const testTimeSource: TimeSource = {
  getTime: () => 0,
  playing: true,
  loop: true,
};

function createArrival(overrides: Partial<ArrivalInfo> = {}): ArrivalInfo {
  return {
    position: new THREE.Vector3(2, 3, 4),
    direction: new THREE.Vector3(1, 0, 0),
    ...overrides,
  };
}

describe("applyHitEffectArrivalTransform", () => {
  it("positions the hit effect at the flight arrival point", () => {
    const group = new THREE.Group();
    const arrival = createArrival();

    applyHitEffectArrivalTransform(group, arrival);

    expect(group.position.equals(arrival.position)).toBe(true);
  });

  it("matches CMagicCtrl::Stop by keeping the result particle root unrotated", () => {
    const group = new THREE.Group();
    const arrival = createArrival({
      direction: new THREE.Vector3(-2, 5, 3).normalize(),
    });

    applyHitEffectArrivalTransform(group, arrival);

    expect(group.quaternion.x).toBeCloseTo(0);
    expect(group.quaternion.y).toBeCloseTo(0);
    expect(group.quaternion.z).toBeCloseTo(0);
    expect(group.quaternion.w).toBeCloseTo(1);
  });

  it("keeps the current orientation when arrival direction is empty", () => {
    const group = new THREE.Group();
    group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    const before = group.quaternion.clone();

    applyHitEffectArrivalTransform(group, createArrival({ direction: new THREE.Vector3() }));

    expect(group.quaternion.equals(before)).toBe(true);
  });
});

describe("HitEffectRenderer", () => {
  it("renders the particle effect at the arrival transform and passes setDir direction", async () => {
    mockParticleEffectRenderer.mockClear();
    const arrival = createArrival({
      position: new THREE.Vector3(5, 6, 7),
      direction: new THREE.Vector3(1, 2, 3).normalize(),
    });

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <HitEffectRenderer particleEffectName="fire_hit" arrival={arrival} onComplete={() => {}} />
      </TimeProvider>,
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const hitGroup = meshes[0].instance.parent as THREE.Group;
    expect(hitGroup.position.equals(arrival.position)).toBe(true);

    expect(hitGroup.quaternion.x).toBeCloseTo(0);
    expect(hitGroup.quaternion.y).toBeCloseTo(0);
    expect(hitGroup.quaternion.z).toBeCloseTo(0);
    expect(hitGroup.quaternion.w).toBeCloseTo(1);
    expect(mockParticleEffectRenderer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        particleEffectName: "fire_hit",
        sourceDirection: arrival.direction,
      }),
    );
  });
});
