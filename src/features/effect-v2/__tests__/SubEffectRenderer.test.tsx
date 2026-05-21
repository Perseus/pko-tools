import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Provider, useSetAtom } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import type { SubEffect } from "@/types/effect";
import type { EffectModelResource } from "@/features/effect/useEffectModel";
import { SubEffectRenderer } from "../renderers/SubEffectRenderer";
import { TimeProvider, TimeSource } from "../TimeContext";
import { baseSubEffect, rotatingSubEffect } from "./fixtures";
import { ParticleOpacityProvider } from "../renderers/particles/particleOpacityContext";

const { mockUseEffectTexture } = vi.hoisted(() => ({
  mockUseEffectTexture: vi.fn((_texName: string) => null),
}));

const { mockUseEffectModelResource } = vi.hoisted(() => ({
  mockUseEffectModelResource: vi.fn<
    (_modelName: string | undefined, _projectId: string | undefined) => EffectModelResource | null
  >(() => null),
}));

// Mock the texture hook — no Tauri backend in tests
vi.mock("../useEffectTexture", () => ({
  useEffectTexture: (texName: string) => mockUseEffectTexture(texName),
}));

vi.mock("@/features/effect/useEffectModel", () => ({
  useEffectModelResource: (modelName: string | undefined, projectId: string | undefined) =>
    mockUseEffectModelResource(modelName, projectId),
  useEffectModel: (modelName: string | undefined, projectId: string | undefined) =>
    mockUseEffectModelResource(modelName, projectId)?.geometry ?? null,
}));

function makeModelResource(
  geometry: THREE.BufferGeometry | null,
  animations: THREE.AnimationClip[] = [],
): EffectModelResource {
  const scene = new THREE.Group();
  if (geometry) {
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  }
  return {
    geometry,
    dummies: [],
    scene,
    animations,
  };
}

/** A static TimeSource for tests. */
const testTimeSource: TimeSource = {
  getTime: () => 0.5,
  playing: true,
  loop: true,
};

/** Wraps children in a TimeProvider for test rendering. */
function TestTimeWrapper({
  children,
  timeSource = testTimeSource,
}: {
  children: React.ReactNode;
  timeSource?: TimeSource;
}) {
  return <TimeProvider value={timeSource}>{children}</TimeProvider>;
}

function ProjectHydrator({ children }: { children: React.ReactNode }) {
  const setProject = useSetAtom(currentProjectAtom);
  React.useEffect(() => {
    setProject({ id: "project-1", name: "Test", projectDirectory: "E:/client" });
  }, [setProject]);
  return <>{children}</>;
}

describe("SubEffectRenderer", () => {
  beforeEach(() => {
    mockUseEffectTexture.mockClear();
    mockUseEffectTexture.mockReturnValue(null);
    mockUseEffectModelResource.mockClear();
    mockUseEffectModelResource.mockReturnValue(null);
  });

  it("renders a mesh for RectPlane", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={baseSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("renders a mesh for cylinder sub-effects (useParam=1)", async () => {
    const cylinderSubEffect = {
      ...baseSubEffect,
      modelName: "Cylinder",
      useParam: 1,
      perFrameCylinder: [
        { segments: 8, height: 2, topRadius: 0.5, botRadius: 1 },
        { segments: 8, height: 2, topRadius: 0.5, botRadius: 1 },
      ],
    };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={cylinderSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("does not render external .lgo models while geometry is loading", async () => {
    const lgoSubEffect = { ...baseSubEffect, modelName: "weapon.lgo" };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={lgoSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(0);
  });

  it("renders external .lgo model geometry when loaded", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModelResource.mockReturnValue(makeModelResource(modelGeometry));

    const lgoSubEffect = { ...baseSubEffect, modelName: "weapon.lgo" };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={lgoSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
    expect((meshes[0].instance as THREE.Mesh).geometry).toBe(modelGeometry);
    expect(mockUseEffectModelResource).toHaveBeenCalledWith("weapon.lgo", undefined);
  });

  it("renders animated external .lgo model scenes instead of dropping animation resources", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const clip = new THREE.AnimationClip("bone_anim", 1, []);
    mockUseEffectModelResource.mockReturnValue(makeModelResource(modelGeometry, [clip]));

    const lgoSubEffect = { ...baseSubEffect, modelName: "gunwing.lgo" };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={lgoSubEffect} />
      </TestTimeWrapper>
    );

    const root = renderer.scene.instance.children[0] as THREE.Group;
    let renderedMesh: THREE.Mesh | null = null;
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) renderedMesh = mesh;
    });

    expect(renderedMesh).not.toBeNull();
    expect(renderedMesh!.geometry).toBe(modelGeometry);
  });

  it("renders when sub-effect has texName but no modelName", async () => {
    const texOnlySubEffect = { ...baseSubEffect, modelName: "" };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={texOnlySubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("matches C++ RenderVS by skipping textured sub-effects until the texture is loaded", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TestTimeWrapper>
            <SubEffectRenderer subEffect={{ ...baseSubEffect, texName: "eff0233" }} />
          </TestTimeWrapper>
        </ProjectHydrator>
      </Provider>
    );

    await Promise.resolve();
    await Promise.resolve();

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(0);
  });

  it("uses shared alpha=false material behavior", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={{ ...baseSubEffect, alpha: false }} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(false);
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.depthWrite).toBe(true);
  });

  it("matches CMPModelEff::SetAlpha by multiplying nested particle opacity into sub-effects", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <ParticleOpacityProvider value={0.25}>
          <SubEffectRenderer subEffect={{
            ...baseSubEffect,
            frameColors: baseSubEffect.frameColors.map(() => [1, 1, 1, 0.5]),
          }} />
        </ParticleOpacityProvider>
      </TestTimeWrapper>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(0.125);
  });

  it("does not floor particle-driven nested opacity like the editor preview path", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <ParticleOpacityProvider value={0.1}>
          <SubEffectRenderer subEffect={{
            ...baseSubEffect,
            frameColors: baseSubEffect.frameColors.map(() => [1, 1, 1, 0.2]),
          }} />
        </ParticleOpacityProvider>
      </TestTimeWrapper>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(0.02);
  });

  it("applies PKO technique cull state from the parent effect", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        {React.createElement(SubEffectRenderer as React.ComponentType<any>, {
          subEffect: { ...baseSubEffect, alpha: true },
          idxTech: 5,
        })}
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.side).toBe(THREE.BackSide);
    expect(material.depthTest).toBe(false);
  });

  it("loads the active frame texture for EFFECT_FRAMETEX sub-effects", async () => {
    const frameTexSubEffect = {
      ...baseSubEffect,
      effectType: 1,
      texName: "fallback.tga",
      frameTexCount: 3,
      frameTexTime: 0.25,
      frameTexNames: ["frame_00.tga", "frame_01.tga", "frame_02.tga"],
    };

    await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={frameTexSubEffect} />
      </TestTimeWrapper>
    );

    expect(mockUseEffectTexture).toHaveBeenCalledWith("frame_01.tga");
    expect(mockUseEffectTexture).not.toHaveBeenCalledWith("fallback.tga");
  });

  it("resets frame texture timing with the effect loop duration", async () => {
    const frameTexSubEffect: SubEffect = {
      ...baseSubEffect,
      effectType: 1,
      frameCount: 1,
      frameTimes: [1],
      frameSizes: [[1, 1, 1]],
      frameAngles: [[0, 0, 0]],
      framePositions: [[0, 0, 0]],
      frameColors: [[1, 1, 1, 1]],
      texName: "fallback.tga",
      frameTexCount: 2,
      frameTexTime: 0.75,
      frameTexNames: ["loop_a.tga", "loop_b.tga"],
    };
    const loopedTimeSource: TimeSource = {
      getTime: () => 1.2,
      playing: true,
      loop: true,
    };

    await ReactThreeTestRenderer.create(
      <TestTimeWrapper timeSource={loopedTimeSource}>
        <SubEffectRenderer subEffect={frameTexSubEffect} />
      </TestTimeWrapper>
    );

    expect(mockUseEffectTexture).toHaveBeenCalledWith("loop_a.tga");
    expect(mockUseEffectTexture).not.toHaveBeenCalledWith("loop_b.tga");
  });

  it("applies MODELUV animation without blending the final UV frame back to frame 0", async () => {
    const uvSubEffect: SubEffect = {
      ...baseSubEffect,
      effectType: 2,
      frameCount: 1,
      frameTimes: [2.5],
      frameSizes: [[1, 1, 1]],
      frameAngles: [[0, 0, 0]],
      framePositions: [[0, 0, 0]],
      frameColors: [[1, 1, 1, 1]],
      coordFrameTime: 1,
      coordList: [
        [[0, 0], [1, 0], [1, 1], [0, 1]],
        [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]],
      ],
    };
    const uvTimeSource: TimeSource = {
      getTime: () => 1.5,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper timeSource={uvTimeSource}>
        <SubEffectRenderer subEffect={uvSubEffect} />
      </TestTimeWrapper>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const uvAttr = (meshes[0].instance as THREE.Mesh).geometry.getAttribute("uv") as THREE.BufferAttribute;
    expect(uvAttr.getX(0)).toBeCloseTo(0.5);
    expect(uvAttr.getY(0)).toBeCloseTo(0.5);
  });

  it("applies transform after advancing frames when rotaLoop is true", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={rotatingSubEffect} />
      </TestTimeWrapper>
    );

    // SubEffectRenderer renders a <mesh> directly — find it
    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
    const mesh = meshes[0];

    // Capture position before advancing
    const posBefore = mesh.instance.position.clone();

    // Advance 30 frames at 60fps
    await renderer.advanceFrames(30, 1 / 60);

    // After advancing, the mesh should have been transformed by applySubEffectFrame
    // (position, rotation, or scale should differ from initial state)
    const posAfter = mesh.instance.position.clone();
    const scaleAfter = mesh.instance.scale.clone();

    // At least one transform property should have changed
    const posChanged = !posBefore.equals(posAfter);
    const scaleChanged = scaleAfter.x !== 1 || scaleAfter.y !== 1 || scaleAfter.z !== 1;
    expect(posChanged || scaleChanged).toBe(true);
  });
});
