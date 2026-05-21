import { describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { LinkBeamRenderer } from "../renderers/LinkBeamRenderer";

const { mockUseEffectTexture } = vi.hoisted(() => ({
  mockUseEffectTexture: vi.fn((): THREE.Texture | null => null),
}));

vi.mock("../useEffectTexture", () => ({
  useEffectTexture: () => mockUseEffectTexture(),
}));

describe("LinkBeamRenderer", () => {
  it("clamps link beam textures like CMPLink technique 0", async () => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    mockUseEffectTexture.mockReturnValue(texture);

    await ReactThreeTestRenderer.create(
      <LinkBeamRenderer
        start={new THREE.Vector3(0, 0, 0)}
        end={new THREE.Vector3(0, 4, 0)}
        textureBaseName="link"
      />,
    );

    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it("renders link beams as unlit effect materials without fog or tone mapping", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <LinkBeamRenderer
        start={new THREE.Vector3(0, 0, 0)}
        end={new THREE.Vector3(0, 4, 0)}
        textureBaseName="link"
      />,
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;

    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
  });
});
