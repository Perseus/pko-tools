import { beforeEach, describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { StripRenderer } from "../renderers/StripRenderer";
import type { ParStrip } from "@/types/effect-v2";

const { mockUseEffectTexture } = vi.hoisted(() => ({
  mockUseEffectTexture: vi.fn((): THREE.Texture | null => null),
}));

vi.mock("../useEffectTexture", () => ({
  useEffectTexture: () => mockUseEffectTexture(),
}));

function strip(overrides: Partial<ParStrip> = {}): ParStrip {
  return {
    maxLen: 2,
    dummy: [0, 1],
    color: [1, 1, 1, 1],
    life: 1,
    step: 0.02,
    textureName: "trail",
    srcBlend: 5,
    destBlend: 2,
    ...overrides,
  };
}

const dummyLineSpan = {
  start: new THREE.Vector3(0, 0, 0),
  direction: new THREE.Vector3(1, 0, 0),
  distance: 1,
};

describe("StripRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseEffectTexture.mockReturnValue(null);
  });

  it("fires onComplete once when a non-looping source-style strip reaches maxLen", async () => {
    const onComplete = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <StripRenderer
        strip={strip()}
        dummyLineSpan={dummyLineSpan}
        loop={false}
        onComplete={onComplete}
      />,
    );

    await renderer.advanceFrames(1, 1 / 60);
    expect(onComplete).not.toHaveBeenCalled();

    await renderer.advanceFrames(1, 1 / 60);
    expect(onComplete).toHaveBeenCalledTimes(1);

    await renderer.advanceFrames(1, 1 / 60);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("matches CMPStrip::Play by not rendering detached strips without dummy endpoints", async () => {
    const onComplete = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <StripRenderer
        strip={strip()}
        dummyLineSpan={null}
        loop={false}
        onComplete={onComplete}
      />,
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const geometry = (meshes[0].instance as THREE.Mesh).geometry as THREE.BufferGeometry;
    expect(geometry.getAttribute("position")).toBeUndefined();
    expect(onComplete).toHaveBeenCalledTimes(1);

    await renderer.advanceFrames(1, 1 / 60);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("clamps strip textures like CMPStrip technique 0", async () => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    mockUseEffectTexture.mockReturnValue(texture);

    await ReactThreeTestRenderer.create(
      <StripRenderer
        strip={strip()}
        dummyLineSpan={dummyLineSpan}
        loop={false}
      />,
    );

    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it("renders strips as unlit effect materials without fog or tone mapping", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <StripRenderer
        strip={strip()}
        dummyLineSpan={dummyLineSpan}
        loop={false}
      />,
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.ShaderMaterial;

    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
  });
});
