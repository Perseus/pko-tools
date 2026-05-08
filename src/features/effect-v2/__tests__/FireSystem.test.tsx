import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { FireSystem } from "../renderers/particles/FireSystem";
import { ParSystem } from "@/types/effect-v2";
import { TimeProvider, TimeSource } from "../TimeContext";

vi.mock("../renderers/particles/ParticleVisual", () => ({
  ParticleVisual: ({ particle }: { particle?: { index: number } }) => (
    <mesh name={`fire-particle-${particle?.index ?? -1}`}>
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>
  ),
}));

function createFireSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 2,
    name: "temp2",
    particleCount: 1,
    textureName: "eff0232",
    modelName: "RectPlane",
    range: [0, 0, 0],
    frameCount: 3,
    frameSizes: [0, 0.6, 0],
    frameAngles: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    frameColors: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]],
    billboard: true,
    srcBlend: 5,
    destBlend: 2,
    life: 2,
    velocity: 3,
    direction: [0, -3, 0],
    acceleration: [0, 0, 0],
    step: 0,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0,
    usePath: false,
    path: null,
    shade: false,
    hitEffect: "",
    pointRanges: [],
    randomMode: 1,
    modelDir: false,
    mediaY: false,
    minFilter: 1,
    magFilter: 1,
    ...overrides,
  };
}

describe("FireSystem", () => {
  it("renders moving live particles from mutable lifecycle state", async () => {
    let now = 0;
    const timeSource: TimeSource = {
      getTime: () => now,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={timeSource}>
        <FireSystem
          system={createFireSystem()}
          index={2}
          loop
          emitterPositionRef={{ current: null }}
          sourceDirectionRef={{ current: null }}
        />
      </TimeProvider>,
    );

    await act(async () => {
      now = 0.1;
      await renderer.advanceFrames(2, 1 / 60);
    });
    await Promise.resolve();

    const mesh = renderer.scene.findByProps({ name: "fire-particle-0" });
    const particleGroup = mesh.instance.parent as THREE.Group;

    expect(particleGroup.position.x).toBeCloseTo(0);
    expect(particleGroup.position.y).toBeLessThan(-0.1);
    expect(particleGroup.position.z).toBeCloseTo(0);
    expect(particleGroup.scale.x).toBeGreaterThan(0);

    const yAfterMount = particleGroup.position.y;
    await act(async () => {
      now = 0.2;
      await renderer.advanceFrames(2, 1 / 60);
    });

    expect(particleGroup.position.y).toBeLessThan(yAfterMount - 0.1);
  });
});
