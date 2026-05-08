import { describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { TimeProvider, TimeSource } from "../TimeContext";
import {
  MagicEffectRenderer,
  getMagicParticleBaseName,
  getMagicParticleDummyModelName,
  getMagicParticleDummyPosition,
} from "../renderers/MagicEffectRenderer";
import { computeMagicParticleDummyAnchor } from "../renderers/magicDummyKinematics";
import { baseSubEffect, effectFixture, magicEntryFixture } from "./fixtures";

const { mockParticleEffectRenderer } = vi.hoisted(() => ({
  mockParticleEffectRenderer: vi.fn((props: { particleEffectName: string }) => (
    <mesh name={`particle-${props.particleEffectName}`}>
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

describe("getMagicParticleBaseName", () => {
  it("matches C++ MagicSingle strPart + .par lookup by passing base names to ParticleEffectRenderer", () => {
    expect(getMagicParticleBaseName("spark")).toBe("spark");
    expect(getMagicParticleBaseName("spark.par")).toBe("spark");
    expect(getMagicParticleBaseName("")).toBe("");
  });
});

describe("MagicSingle dummy helpers", () => {
  it("uses the first CMPModelEff sub-effect model as the dummy helper source", () => {
    expect(getMagicParticleDummyModelName([
      {
        ...effectFixture,
        subEffects: [{ ...baseSubEffect, modelName: "blade01" }],
      },
    ])).toBe("blade01");
    expect(getMagicParticleDummyModelName([
      {
        ...effectFixture,
        subEffects: [{ ...baseSubEffect, modelName: "RectPlane" }],
      },
    ])).toBeUndefined();
  });

  it("matches CMagicCtrl dummy-index fallback semantics", () => {
    const dummies = [{ id: 2, position: new THREE.Vector3(1, 2, 3) }];

    expect(getMagicParticleDummyPosition(dummies, -1)).toBeNull();
    expect(getMagicParticleDummyPosition(dummies, 8)).toBeNull();
    expect(getMagicParticleDummyPosition(dummies, 2)?.toArray()).toEqual([1, 2, 3]);
  });

  it("composes the first model sub-effect transform with the dummy helper position", () => {
    const subEffect = {
      ...baseSubEffect,
      frameCount: 1,
      frameTimes: [1],
      frameSizes: [[2, 1, 1] as [number, number, number]],
      frameAngles: [[0, 0, 0] as [number, number, number]],
      framePositions: [[2, 0, 3] as [number, number, number]],
      frameColors: [[1, 1, 1, 1] as [number, number, number, number]],
    };
    const anchor = computeMagicParticleDummyAnchor(
      subEffect,
      [{ id: 2, position: new THREE.Vector3(1, 0, 0) }],
      2,
      0,
      false,
    );

    expect(anchor?.toArray()).toEqual([4, 0, 3]);
  });
});

describe("MagicEffectRenderer", () => {
  it("uses PKO z-up defaults while rendering the current source magic position before path advance", async () => {
    const entry = {
      ...magicEntryFixture,
      models: [],
      particles: [],
      result_effect: "0",
      render_idx: 1,
      velocity: 1,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <MagicEffectRenderer
          effFiles={[]}
          magicEntry={entry}
          showTarget={false}
          animateTarget={false}
        />
      </TimeProvider>,
    );

    const flightGroup = renderer.scene.children[0].instance.children[0] as THREE.Group;

    await renderer.advanceFrames(1, 1 / 60);

    expect(flightGroup.position.toArray()).toEqual([0, 0, 0]);

    await renderer.advanceFrames(1, 1 / 60);

    expect(flightGroup.position.y).toBeGreaterThan(0);
    expect(flightGroup.position.z).toBeGreaterThan(0);
    expect(flightGroup.position.z).toBeLessThan(flightGroup.position.y);
  });

  it("renders MagicSingleinfo particle controllers at the moved world position without inheriting flight rotation", async () => {
    mockParticleEffectRenderer.mockClear();

    const entry = {
      ...magicEntryFixture,
      models: [],
      particles: ["trail", "burst.par"],
      result_effect: "0",
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <MagicEffectRenderer
          effFiles={[]}
          magicEntry={entry}
          showTarget={false}
          animateTarget={false}
        />
      </TimeProvider>,
    );

    await renderer.advanceFrames(1, 1 / 60);

    expect(mockParticleEffectRenderer.mock.calls.map(([props]) => props)).toEqual([
      expect.objectContaining({ particleEffectName: "trail", loop: false }),
      expect.objectContaining({ particleEffectName: "burst", loop: false }),
    ]);
    expect(renderer.scene.findByProps({ name: "particle-trail" })).toBeTruthy();
    expect(renderer.scene.findByProps({ name: "particle-burst" })).toBeTruthy();

    const trailMesh = renderer.scene.findByProps({ name: "particle-trail" }).instance as THREE.Mesh;
    const worldQuaternion = new THREE.Quaternion();
    trailMesh.updateWorldMatrix(true, true);
    trailMesh.getWorldQuaternion(worldQuaternion);

    expect(worldQuaternion.x).toBeCloseTo(0);
    expect(worldQuaternion.y).toBeCloseTo(0);
    expect(worldQuaternion.z).toBeCloseTo(0);
    expect(worldQuaternion.w).toBeCloseTo(1);
  });
});
