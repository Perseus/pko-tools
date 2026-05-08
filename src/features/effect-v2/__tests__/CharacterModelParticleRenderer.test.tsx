import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import type { MutableRefObject } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Provider, useSetAtom } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { TimeProvider, TimeSource } from "../TimeContext";
import { CharacterModelParticleRenderer } from "../renderers/CharacterModelParticleRenderer";
import type { ParChaModel } from "@/types/effect-v2";

const {
  mockInvoke,
  mockGetCharacterActions,
  mockUseGLTF,
  mockUseAnimations,
  mockMixerSetTime,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockGetCharacterActions: vi.fn(),
  mockUseGLTF: vi.fn(),
  mockUseAnimations: vi.fn(),
  mockMixerSetTime: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) => mockInvoke(command, args),
}));

vi.mock("@/commands/character", () => ({
  getCharacterActions: (projectId: string, characterId: number) =>
    mockGetCharacterActions(projectId, characterId),
}));

vi.mock("@react-three/drei", () => ({
  useGLTF: (uri: string) => mockUseGLTF(uri),
  useAnimations: (animations: THREE.AnimationClip[], scene: THREE.Object3D) =>
    mockUseAnimations(animations, scene),
}));

function model(overrides: Partial<ParChaModel> = {}): ParChaModel {
  return {
    id: 52,
    velocity: 1,
    playType: 2,
    curPose: 7,
    srcBlend: 5,
    destBlend: 2,
    color: [0.25, 0.5, 0.75, 0.4],
    ...overrides,
  };
}

function ProjectHydrator({ children }: { children: React.ReactNode }) {
  const setProject = useSetAtom(currentProjectAtom);
  useEffect(() => {
    setProject({ id: "project-1", name: "Test", projectDirectory: "E:/client" });
  }, [setProject]);
  return <>{children}</>;
}

function createScene() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: "white" }),
  ));
  return scene;
}

function createSceneWithAlphaTexture() {
  const scene = new THREE.Group();
  const texture = new THREE.DataTexture(
    new Uint8Array([
      0, 0, 0, 0,
      255, 255, 255, 255,
    ]),
    1,
    2,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: "white", map: texture }),
  ));
  return scene;
}

const timeSource: TimeSource = {
  getTime: () => 2,
  playing: true,
  loop: true,
};

const expiredOnceTimeSource: TimeSource = {
  getTime: () => 1,
  playing: true,
  loop: false,
};

let loadedScene: THREE.Group;

describe("CharacterModelParticleRenderer", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue("{}");
    mockGetCharacterActions.mockReset();
    mockGetCharacterActions.mockResolvedValue([{
      action_id: 7,
      name: "cast",
      start_frame: 30,
      end_frame: 60,
      key_frames: [],
      weapon_mode: null,
    }]);
    mockUseGLTF.mockReset();
    loadedScene = createScene();
    mockUseGLTF.mockReturnValue({
      scene: loadedScene,
      animations: [new THREE.AnimationClip("all", 3, [])],
    });
    mockMixerSetTime.mockReset();
    mockUseAnimations.mockReset();
    mockUseAnimations.mockReturnValue({
      mixer: { setTime: mockMixerSetTime },
    });

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:character"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("loads and renders the character model from the .par model id", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <CharacterModelParticleRenderer model={model()} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    expect(mockInvoke).toHaveBeenCalledWith("load_character", {
      projectId: "project-1",
      characterId: 52,
    });
    expect(mockGetCharacterActions).toHaveBeenCalledWith("project-1", 52);
    expect(mockUseGLTF).toHaveBeenCalledWith("blob:character");
    expect(loadedScene.children.filter((child) => child instanceof THREE.Mesh)).toHaveLength(1);
  });

  it("applies CChaModel color, opacity, and blend factors to loaded meshes", async () => {
    await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <CharacterModelParticleRenderer model={model()} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();

    const mesh = loadedScene.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;

    expect(material.color.r).toBeCloseTo(0.25);
    expect(material.color.g).toBeCloseTo(0.5);
    expect(material.color.b).toBeCloseTo(0.75);
    expect(material.opacity).toBeCloseTo(0.4);
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.depthWrite).toBe(true);
    expect(material.side).toBe(THREE.BackSide);
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
  });

  it("matches CChaModel source texture state for alpha-textured particles", async () => {
    loadedScene = createSceneWithAlphaTexture();
    mockUseGLTF.mockReturnValue({
      scene: loadedScene,
      animations: [new THREE.AnimationClip("all", 3, [])],
    });

    await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <CharacterModelParticleRenderer model={model({ color: [1, 1, 1, 1] })} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();

    const mesh = loadedScene.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;

    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.map?.minFilter).toBe(THREE.NearestMipmapNearestFilter);
    expect(material.map?.magFilter).toBe(THREE.NearestFilter);
  });

  it("seeks the animation mixer to the current pose frame range", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <CharacterModelParticleRenderer model={model()} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    expect(mockMixerSetTime).toHaveBeenCalledWith(59 / 30);
  });

  it("matches CMPPartCtrl::MoveTo by applying runtime emitter position to character model particles", async () => {
    const emitterPositionRef: MutableRefObject<THREE.Vector3 | null> = {
      current: new THREE.Vector3(3, 4, 5),
    };
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <CharacterModelParticleRenderer
              model={model()}
              emitterPositionRef={emitterPositionRef}
            />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    const characterGroup = loadedScene.parent as THREE.Group;
    expect(characterGroup.position.toArray()).toEqual([3, 4, 5]);
    expect(loadedScene.position.toArray()).toEqual([0, 0, 0]);

    emitterPositionRef.current = new THREE.Vector3(7, 8, 9);
    await renderer.advanceFrames(1, 1 / 60);

    expect(characterGroup.position.toArray()).toEqual([7, 8, 9]);
  });

  it("rotates loaded Y-up character models upright into the z-up effect scene", async () => {
    await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <CharacterModelParticleRenderer model={model()} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(loadedScene.rotation.x).toBeCloseTo(Math.PI / 2);
    const up = new THREE.Vector3(0, 1, 0).applyEuler(loadedScene.rotation);
    expect(up.z).toBeCloseTo(1);
  });

  it("stops advancing PLAY_ONCE models after the C++ end keyframe clears playing state", async () => {
    const onComplete = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={expiredOnceTimeSource}>
            <CharacterModelParticleRenderer model={model({ playType: 1 })} onComplete={onComplete} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    mockMixerSetTime.mockClear();
    await renderer.advanceFrames(1, 1 / 60);

    expect(mockMixerSetTime).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);

    await renderer.advanceFrames(1, 1 / 60);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
