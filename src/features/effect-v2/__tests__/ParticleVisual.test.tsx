import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree } from "@react-three/fiber";
import { Provider, useSetAtom } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { ParticleOpacityProvider, ParticleVisual } from "../renderers/particles/ParticleVisual";
import { RangeSystem } from "../renderers/particles/RangeSystem";
import { Range2System } from "../renderers/particles/Range2System";
import { ShadeSystem } from "../renderers/particles/ShadeSystem";
import { ParSystem } from "@/types/effect-v2";
import { EffectFile } from "@/types/effect";
import { Particle } from "../renderers/particles/useParticleLifecycle";
import { TimeProvider, TimeSource } from "../TimeContext";

const { mockUseLoadEffect } = vi.hoisted(() => ({
  mockUseLoadEffect: vi.fn((_effectNames: string[]): EffectFile[] => []),
}));

const { mockUseEffectModel } = vi.hoisted(() => ({
  mockUseEffectModel: vi.fn(
    (_modelName: string | undefined, _projectId: string | undefined): THREE.BufferGeometry | null => null,
  ),
}));

const { mockUseEffectTexture } = vi.hoisted(() => ({
  mockUseEffectTexture: vi.fn((_texName: string): THREE.Texture | null => null),
}));

const { mockNestedEffectTime, mockNestedEffectPlaying, mockNestedEffectComplete } = vi.hoisted(() => ({
  mockNestedEffectTime: vi.fn(),
  mockNestedEffectPlaying: vi.fn(),
  mockNestedEffectComplete: vi.fn(),
}));

const { mockNestedEffectOpacityScale } = vi.hoisted(() => ({
  mockNestedEffectOpacityScale: vi.fn(),
}));

const { mockNestedEffectLoop } = vi.hoisted(() => ({
  mockNestedEffectLoop: vi.fn(),
}));

vi.mock("../useLoadEffect", () => ({
  useLoadEffect: (effectNames: string[]) => mockUseLoadEffect(effectNames),
}));

vi.mock("@/features/effect/useEffectModel", () => ({
  useEffectModel: (modelName: string | undefined, projectId: string | undefined) =>
    mockUseEffectModel(modelName, projectId),
}));

vi.mock("../useEffectTexture", () => ({
  useEffectTexture: (texName: string) => mockUseEffectTexture(texName),
}));

vi.mock("../renderers/EffectRenderer", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { useTimeSource } = await vi.importActual<typeof import("../TimeContext")>("../TimeContext");
  const { ParticleOpacityContext } =
    await vi.importActual<typeof import("../renderers/particles/particleOpacityContext")>(
      "../renderers/particles/particleOpacityContext",
    );
  return {
    EffectRenderer: ({ onComplete }: { onComplete?: () => void }) => {
      const timeSource = useTimeSource();
      const opacityScale = React.useContext(ParticleOpacityContext);
      mockNestedEffectTime(timeSource.getTime());
      mockNestedEffectPlaying(timeSource.playing);
      mockNestedEffectLoop(timeSource.loop);
      mockNestedEffectOpacityScale(opacityScale);
      mockNestedEffectComplete.mockImplementation(() => onComplete?.());
      return (
        <mesh>
          <boxGeometry />
          <meshBasicMaterial />
        </mesh>
      );
    },
  };
});

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 5,
    name: "model particle",
    particleCount: 1,
    textureName: "spark.tga",
    modelName: "debris.lgo",
    range: [0, 0, 0],
    frameCount: 1,
    frameSizes: [1],
    frameAngles: [[0, 0, 0]],
    frameColors: [[1, 1, 1, 1]],
    billboard: false,
    srcBlend: 5,
    destBlend: 2,
    life: 1,
    velocity: 1,
    direction: [1, 1, 1],
    acceleration: [0, 0, 0],
    step: 0,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 1,
    usePath: false,
    path: null,
    shade: false,
    hitEffect: "",
    pointRanges: [],
    randomMode: 1,
    modelDir: false,
    mediaY: false,
    ...overrides,
  };
}

function createParticle(overrides: Partial<Particle> = {}): Particle {
  return {
    alive: true,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    accel: new THREE.Vector3(),
    size: 1,
    color: new THREE.Color(1, 1, 1),
    alpha: 1,
    angle: new THREE.Vector3(0, 0, 0),
    index: 0,
    curFrame: 0,
    curTime: 0,
    frameTime: 1,
    life: 1,
    elapsed: 0,
    ...overrides,
  };
}

const testTimeSource: TimeSource = {
  getTime: () => 0,
  playing: true,
  loop: true,
};

function ProjectHydrator({ children }: { children: React.ReactNode }) {
  const setProject = useSetAtom(currentProjectAtom);
  React.useEffect(() => {
    setProject({ id: "project-1", name: "Test", projectDirectory: "E:/client" });
  }, [setProject]);
  return <>{children}</>;
}

function CameraPose({
  position,
  target,
}: {
  position: THREE.Vector3;
  target: THREE.Vector3;
}) {
  const { camera } = useThree();
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return null;
}

describe("ParticleVisual", () => {
  beforeEach(() => {
    mockUseLoadEffect.mockClear();
    mockUseLoadEffect.mockReturnValue([]);
    mockUseEffectModel.mockClear();
    mockUseEffectModel.mockReturnValue(null);
    mockUseEffectTexture.mockClear();
    mockUseEffectTexture.mockReturnValue(null);
    mockNestedEffectTime.mockClear();
    mockNestedEffectPlaying.mockClear();
    mockNestedEffectComplete.mockClear();
    mockNestedEffectLoop.mockClear();
    mockNestedEffectOpacityScale.mockClear();
  });

  it("renders nested .eff visuals through EffectRenderer", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual system={createSystem({ modelName: "spark.eff" })} />
      </TimeProvider>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
    expect(mockUseLoadEffect).toHaveBeenCalledWith(["spark.eff"]);
  });

  it("renders effect mesh model geometry for non-.eff modelName values", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);

    const renderer = await ReactThreeTestRenderer.create(
      <ParticleVisual system={createSystem({ modelName: "debris.lgo" })} />
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
    expect((meshes[0].instance as THREE.Mesh).geometry).toBe(modelGeometry);
    expect(mockUseLoadEffect).toHaveBeenCalledWith([]);
    expect(mockUseEffectModel).toHaveBeenCalledWith("debris.lgo", undefined);
    expect(mockUseEffectTexture).toHaveBeenCalledWith("spark.tga");
  });

  it("renders PKO built-in particle model geometry without external model loading", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <ParticleVisual system={createSystem({ modelName: "RectPlane" })} />
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
    const geometry = (meshes[0].instance as THREE.Mesh).geometry;
    expect(geometry.getAttribute("position").count).toBe(4);
    expect(mockUseEffectModel).toHaveBeenCalledWith(undefined, undefined);
    expect(mockUseEffectTexture).toHaveBeenCalledWith("spark.tga");
  });

  it("matches C++ particle rendering by skipping direct textured visuals until texture load completes", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <ParticleVisual system={createSystem({ modelName: "RectPlane", textureName: "eff0232" })} />
        </ProjectHydrator>
      </Provider>
    );

    await Promise.resolve();
    await Promise.resolve();

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(0);
  });

  it("renders direct particle model materials double-sided like CMPPartSys technique 3", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <ParticleVisual system={createSystem({ modelName: "RectPlane" })} />
    );

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial).side).toBe(THREE.DoubleSide);
  });

  it("interprets direct particle frame colors as PKO sRGB texture factors", async () => {
    const particle = createParticle({
      color: new THREE.Color(128 / 255, 1, 128 / 255),
    });
    const expected = new THREE.Color().setRGB(128 / 255, 1, 128 / 255, THREE.SRGBColorSpace);

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual system={createSystem({ modelName: "RectPlane" })} particle={particle} />
      </TimeProvider>
    );

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.color.r).toBeCloseTo(expected.r);
    expect(material.color.g).toBeCloseTo(expected.g);
    expect(material.color.b).toBeCloseTo(expected.b);
  });

  it("billboards PKO built-in particle model geometry in parent-local space", async () => {
    const particle = createParticle({
      angle: new THREE.Vector3(0.4, 0.2, 0.7),
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-4, 5, 8);
    camera.lookAt(new THREE.Vector3(0.5, -1, 0));
    camera.updateMatrixWorld(true);

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <CameraPose position={camera.position.clone()} target={new THREE.Vector3(0.5, -1, 0)} />
        <group rotation={[0.3, -0.4, 0.2]}>
          <ParticleVisual
            system={createSystem({ billboard: true, modelName: "RectPlane" })}
            particle={particle}
          />
        </group>
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    const billboardGroup = mesh.parent as THREE.Group;
    const worldQuaternion = new THREE.Quaternion();
    billboardGroup.getWorldQuaternion(worldQuaternion);
    expect(worldQuaternion.x).toBeCloseTo(camera.quaternion.x);
    expect(worldQuaternion.y).toBeCloseTo(camera.quaternion.y);
    expect(worldQuaternion.z).toBeCloseTo(camera.quaternion.z);
    expect(worldQuaternion.w).toBeCloseTo(camera.quaternion.w);
    expect(mockUseEffectModel).toHaveBeenCalledWith(undefined, undefined);
  });

  it("clamps particle model textures like CMPPartSys technique 3", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    mockUseEffectModel.mockReturnValue(modelGeometry);
    mockUseEffectTexture.mockReturnValue(texture);

    await ReactThreeTestRenderer.create(
      <ParticleVisual system={createSystem({ modelName: "debris.lgo" })} />
    );

    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it("clamps shade textures like CMPPartSys technique 3", async () => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    mockUseEffectTexture.mockReturnValue(texture);

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ShadeSystem
          index={0}
          system={createSystem({ type: 13, modelName: "", textureName: "shade.tga" })}
          loop
        />
      </TimeProvider>
    );

    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it("matches C++ particle frame angle mapping without swapping X and Y", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle({
      angle: new THREE.Vector3(0.25, 0.5, 0.75),
    });

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual system={createSystem({ modelName: "debris.lgo" })} particle={particle} />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    expect(rotationGroup.rotation.x).toBeCloseTo(0.25);
    expect(rotationGroup.rotation.y).toBeCloseTo(0.5);
    expect(rotationGroup.rotation.z).toBeCloseTo(0.75);
    expect(rotationGroup.rotation.order).toBe("YXZ");
  });

  it("applies C++ modelDir RotatingXZ for MODEL particle visuals", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle();
    const sourceDirectionRef = { current: new THREE.Vector3(1, 0, 0) };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({
            type: 5,
            modelDir: true,
            direction: [1, 0, 0],
            modelName: "debris.lgo",
          })}
          particle={particle}
          sourceDirectionRef={sourceDirectionRef}
        />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    const expected = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );

    expect(rotationGroup.quaternion.x).toBeCloseTo(expected.x);
    expect(rotationGroup.quaternion.y).toBeCloseTo(expected.y);
    expect(rotationGroup.quaternion.z).toBeCloseTo(expected.z);
    expect(rotationGroup.quaternion.w).toBeCloseTo(expected.w);
  });

  it("matches the full source CMPPartSys modelDir RotatingXZ matrix for non-axis directions", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle();
    const sourceDirectionRef = { current: new THREE.Vector3(3, 8, 5) };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({
            type: 5,
            modelDir: true,
            direction: [3, 8, 5],
            modelName: "debris.lgo",
          })}
          particle={particle}
          sourceDirectionRef={sourceDirectionRef}
        />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    const actual = new THREE.Matrix4().makeRotationFromQuaternion(rotationGroup.quaternion);

    // Captured from source D3DX row-vector matrix for CMPPartSys::RotatingXZ(3,8,5),
    // transposed into Three's column-vector Matrix4 element order.
    const expectedElements = [
      0.936329186, -0.351123422, 0, 0,
      0.30304572, 0.808121979, 0.505076289, 0,
      -0.177344114, -0.472917676, 0.86307466, 0,
      0, 0, 0, 1,
    ];

    expectedElements.forEach((expected, i) => {
      expect(actual.elements[i]).toBeCloseTo(expected, 6);
    });
  });

  it("applies C++ row-vector order for frame angle followed by modelDir", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle({
      angle: new THREE.Vector3(0.25, 0.5, 0.75),
    });
    const sourceDirectionRef = { current: new THREE.Vector3(1, 0, 0) };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({
            type: 5,
            modelDir: true,
            direction: [1, 0, 0],
            modelName: "debris.lgo",
          })}
          particle={particle}
          sourceDirectionRef={sourceDirectionRef}
        />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    const frame = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(0.25, 0.5, 0.75, "YXZ"),
    );
    const modelDir = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
    const expected = new THREE.Quaternion().setFromRotationMatrix(
      modelDir.multiply(frame),
    );

    expect(rotationGroup.quaternion.x).toBeCloseTo(expected.x);
    expect(rotationGroup.quaternion.y).toBeCloseTo(expected.y);
    expect(rotationGroup.quaternion.z).toBeCloseTo(expected.z);
    expect(rotationGroup.quaternion.w).toBeCloseTo(expected.w);
  });

  it("does not use serialized .par direction for MODEL modelDir without runtime setDir", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle();

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({
            type: 5,
            modelDir: true,
            direction: [3, 8, 5],
            modelName: "debris.lgo",
          })}
          particle={particle}
        />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    const expected = new THREE.Quaternion();
    expect(rotationGroup.quaternion.x).toBeCloseTo(expected.x);
    expect(rotationGroup.quaternion.y).toBeCloseTo(expected.y);
    expect(rotationGroup.quaternion.z).toBeCloseTo(expected.z);
    expect(rotationGroup.quaternion.w).toBeCloseTo(expected.w);
  });

  it("applies C++ modelDir RotatingXZ for FIRE particle visuals from particle direction", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle({
      dir: new THREE.Vector3(0, 0, 1),
    });

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({
            type: 2,
            modelDir: true,
            modelName: "debris.lgo",
          })}
          particle={particle}
        />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    const expected = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeRotationX(Math.PI / 2),
    );

    expect(rotationGroup.quaternion.x).toBeCloseTo(expected.x);
    expect(rotationGroup.quaternion.y).toBeCloseTo(expected.y);
    expect(rotationGroup.quaternion.z).toBeCloseTo(expected.z);
    expect(rotationGroup.quaternion.w).toBeCloseTo(expected.w);
  });

  it("matches C++ ARRAW by not applying particle frame angle to nested/model visuals", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle({
      angle: new THREE.Vector3(0.25, 0.5, 0.75),
    });

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual system={createSystem({ type: 8, modelName: "debris.lgo" })} particle={particle} />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    expect(rotationGroup.rotation.x).toBeCloseTo(0);
    expect(rotationGroup.rotation.y).toBeCloseTo(0);
    expect(rotationGroup.rotation.z).toBeCloseTo(0);
  });

  it("matches C++ SHRINK RotatingXZ instead of generic yaw/pitch/roll", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle({
      angle: new THREE.Vector3(0.25, 0.5, 0.75),
    });

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual system={createSystem({ type: 12, modelName: "debris.lgo" })} particle={particle} />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const rotationGroup = meshes[0].instance.parent as THREE.Group;
    const expected = new THREE.Matrix4()
      .makeRotationZ(0.5)
      .multiply(new THREE.Matrix4().makeRotationX(0.25));
    const expectedQuaternion = new THREE.Quaternion().setFromRotationMatrix(expected);

    expect(rotationGroup.quaternion.x).toBeCloseTo(expectedQuaternion.x);
    expect(rotationGroup.quaternion.y).toBeCloseTo(expectedQuaternion.y);
    expect(rotationGroup.quaternion.z).toBeCloseTo(expectedQuaternion.z);
    expect(rotationGroup.quaternion.w).toBeCloseTo(expectedQuaternion.w);
  });

  it("multiplies particle alpha by the renderer opacity scale", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    mockUseEffectModel.mockReturnValue(modelGeometry);
    const particle = createParticle({ alpha: 0.5 });

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleOpacityProvider value={0.25}>
          <ParticleVisual system={createSystem({ modelName: "debris.lgo" })} particle={particle} />
        </ParticleOpacityProvider>
      </TimeProvider>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(0.125);
  });

  it("keeps direct particle material color and alpha in sync with mutable lifecycle state", async () => {
    const particle = createParticle({ alpha: 1, color: new THREE.Color(1, 1, 1) });

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual system={createSystem({ modelName: "RectPlane" })} particle={particle} />
      </TimeProvider>
    );

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;

    particle.alpha = 0.25;
    particle.color.setRGB(0.5, 1, 0.5);

    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });

    const expected = new THREE.Color().setRGB(0.5, 1, 0.5, THREE.SRGBColorSpace);
    expect(material.opacity).toBeCloseTo(0.25);
    expect(material.color.r).toBeCloseTo(expected.r);
    expect(material.color.g).toBeCloseTo(expected.g);
    expect(material.color.b).toBeCloseTo(expected.b);
  });

  it("multiplies nested .eff opacity by parent particle alpha like CMPModelEff SetAlpha", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 1,
      subEffects: [],
    }]);
    const particle = createParticle({ alpha: 0.4 });

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleOpacityProvider value={0.5}>
          <ParticleVisual system={createSystem({ modelName: "hl_greenfy6.eff" })} particle={particle} />
        </ParticleOpacityProvider>
      </TimeProvider>
    );

    expect(mockNestedEffectOpacityScale).toHaveBeenLastCalledWith(0.2);
  });

  it("applies .par min/mag texture filters to direct particle model textures", async () => {
    const modelGeometry = new THREE.BufferGeometry();
    modelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const texture = new THREE.Texture();
    mockUseEffectModel.mockReturnValue(modelGeometry);
    mockUseEffectTexture.mockReturnValue(texture);

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({
            modelName: "debris.lgo",
            minFilter: 1,
            magFilter: 1,
          })}
          particle={createParticle()}
        />
      </TimeProvider>
    );

    expect(texture.minFilter).toBe(THREE.NearestMipmapNearestFilter);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
  });

  it("applies .par min/mag texture filters to shade particle textures", async () => {
    const texture = new THREE.Texture();
    mockUseEffectTexture.mockReturnValue(texture);

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ShadeSystem
          index={0}
          system={createSystem({
            type: 13,
            minFilter: 1,
            magFilter: 1,
          })}
        />
      </TimeProvider>
    );

    expect(texture.minFilter).toBe(THREE.NearestMipmapNearestFilter);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
  });

  it("renders Range particles through ParticleVisual so bound particle resources and materials are honored", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <RangeSystem
          index={0}
          system={createSystem({ type: 14, particleCount: 1, modelName: "" })}
        />
      </TimeProvider>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
  });

  it("matches CMPPartSys::UpdateDelay by hiding Range before delay and after finite playTime", async () => {
    let time = 0;
    const delayedTimeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: false,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={delayedTimeSource}>
        <RangeSystem
          index={0}
          system={createSystem({ type: 14, particleCount: 1, delayTime: 1, playTime: 2, modelName: "" })}
        />
      </TimeProvider>
    );

    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });
    expect(renderer.scene.findAll((node) => node.type === "Mesh")).toHaveLength(0);

    time = 1;
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });
    expect(renderer.scene.findAll((node) => node.type === "Mesh")).toHaveLength(1);

    time = 2;
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });
    expect(renderer.scene.findAll((node) => node.type === "Mesh")).toHaveLength(0);
  });

  it("renders Range2 particles through ParticleVisual so bound particle resources and materials are honored", async () => {
    let time = 0;
    const range2TimeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={range2TimeSource}>
        <Range2System
          index={0}
          system={createSystem({ type: 15, particleCount: 1, step: 0.01, modelName: "" })}
        />
      </TimeProvider>
    );

    time = 0.02;
    await act(async () => {
      await renderer.advanceFrames(5, 1 / 60);
    });

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBeGreaterThan(0);
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
  });

  it("advances Range nested .eff animation with the shared _CPPart frame clock", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    let time = 0;
    const rangeTimeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={rangeTimeSource}>
        <RangeSystem
          index={0}
          system={createSystem({ type: 14, particleCount: 1, modelName: "spark.eff" })}
          loop
        />
      </TimeProvider>
    );

    time = 0.5;
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });

    expect(mockNestedEffectTime).toHaveBeenLastCalledWith(0.5);
  });

  it("advances Range2 nested .eff animation with the shared _CPPart frame clock", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    let time = 0;
    const range2TimeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={range2TimeSource}>
        <Range2System
          index={0}
          system={createSystem({ type: 15, particleCount: 1, step: 0, modelName: "spark.eff" })}
          loop
        />
      </TimeProvider>
    );

    time = 0.5;
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });

    const lastCall = mockNestedEffectTime.mock.calls.at(-1);
    expect(lastCall?.[0]).toBeCloseTo(0.5);
  });

  it("orients Range2 nested .eff visuals with source RotatingXZ even when modelDir is false", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    let time = 0;
    const range2TimeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={range2TimeSource}>
        <Range2System
          index={0}
          system={createSystem({
            type: 15,
            particleCount: 1,
            step: 0,
            direction: [1, 0, 0],
            modelDir: false,
            modelName: "spark.eff",
          })}
          loop
        />
      </TimeProvider>
    );

    time = 0.1;
    await act(async () => {
      await renderer.advanceFrames(2, 1 / 60);
    });
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    const rotationGroup = mesh.parent as THREE.Group;
    const expected = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );
    expect(rotationGroup.quaternion.x).toBeCloseTo(expected.x);
    expect(rotationGroup.quaternion.y).toBeCloseTo(expected.y);
    expect(rotationGroup.quaternion.z).toBeCloseTo(expected.z);
    expect(rotationGroup.quaternion.w).toBeCloseTo(expected.w);
  });

  it("orients Range nested .eff visuals from the CEffPath direction when usePath is enabled", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    let time = 0;
    const rangeTimeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={rangeTimeSource}>
        <RangeSystem
          index={0}
          system={createSystem({
            type: 14,
            particleCount: 1,
            modelDir: false,
            modelName: "path-range.eff",
            usePath: true,
            path: {
              velocity: 10,
              points: [[0, 0, 0], [10, 0, 0], [10, 20, 0]],
              directions: [[1, 0, 0], [0, 1, 0]],
              distances: [10, 20],
            },
          })}
          loop
        />
      </TimeProvider>
    );

    time = 1.25;
    await act(async () => {
      await renderer.advanceFrames(2, 1 / 60);
    });
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    const rotationGroup = mesh.parent as THREE.Group;
    const expected = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeRotationZ(-Math.atan2(10, 2.5)),
    );
    expect(rotationGroup.quaternion.x).toBeCloseTo(expected.x);
    expect(rotationGroup.quaternion.y).toBeCloseTo(expected.y);
    expect(rotationGroup.quaternion.z).toBeCloseTo(expected.z);
    expect(rotationGroup.quaternion.w).toBeCloseTo(expected.w);
  });

  it("matches _FrameMoveRange path-end stop after _wDeath reaches life for nested .eff", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const onComplete = vi.fn();
    let time = 0;
    const rangeTimeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={rangeTimeSource}>
        <RangeSystem
          index={0}
          system={createSystem({
            type: 14,
            particleCount: 1,
            life: 2,
            modelName: "path-range.eff",
            usePath: true,
            path: {
              velocity: 10,
              points: [[0, 0, 0], [1, 0, 0]],
              directions: [[1, 0, 0]],
              distances: [1],
            },
          })}
          loop
          onComplete={onComplete}
        />
      </TimeProvider>
    );

    time = 0.2;
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(renderer.scene.findAll((node) => node.type === "Mesh")).toHaveLength(1);

    time = 0.4;
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(renderer.scene.findAll((node) => node.type === "Mesh")).toHaveLength(0);
  });

  it("renders Shade particles as unlit effect materials without fog or tone mapping", async () => {
    const element = (
      <TimeProvider value={testTimeSource}>
        <ShadeSystem
          index={0}
          system={createSystem({ type: 13, modelName: "", textureName: "shade.tga" })}
          loop
        />
      </TimeProvider>
    );
    const renderer = await ReactThreeTestRenderer.create(element);

    await act(async () => {
      await renderer.advanceFrames(2, 1 / 60);
    });

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBeGreaterThan(0);
    const material = (meshes[0].instance as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
  });

  it("drives nested .eff animation from particle-local elapsed time", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const particle = createParticle({ elapsed: 0.42 });
    const parentTimeSource: TimeSource = {
      getTime: () => 99,
      playing: true,
      loop: true,
    };

    await ReactThreeTestRenderer.create(
      <TimeProvider value={parentTimeSource}>
        <ParticleVisual system={createSystem({ modelName: "spark.eff" })} particle={particle} />
      </TimeProvider>
    );

    expect(mockNestedEffectTime).toHaveBeenCalledWith(0.42);
    expect(mockNestedEffectPlaying).toHaveBeenCalledWith(true);
  });

  it("uses .par billboard to face nested .eff visuals toward a non-identity camera", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const particle = createParticle({
      angle: new THREE.Vector3(0.4, 0.2, 0.7),
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, 4, 9);
    camera.lookAt(new THREE.Vector3(0, 1, 0));
    camera.updateMatrixWorld(true);

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <CameraPose position={camera.position.clone()} target={new THREE.Vector3(0, 1, 0)} />
        <ParticleVisual
          system={createSystem({ billboard: true, modelName: "spark.eff" })}
          particle={particle}
        />
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    const billboardGroup = mesh.parent as THREE.Group;
    expect(billboardGroup.quaternion.x).toBeCloseTo(camera.quaternion.x);
    expect(billboardGroup.quaternion.y).toBeCloseTo(camera.quaternion.y);
    expect(billboardGroup.quaternion.z).toBeCloseTo(camera.quaternion.z);
    expect(billboardGroup.quaternion.w).toBeCloseTo(camera.quaternion.w);
  });

  it("converts .par billboard orientation into parent-local space", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const particle = createParticle({
      angle: new THREE.Vector3(0.4, 0.2, 0.7),
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-3, 6, 11);
    camera.lookAt(new THREE.Vector3(1, -2, 0));
    camera.updateMatrixWorld(true);

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <CameraPose position={camera.position.clone()} target={new THREE.Vector3(1, -2, 0)} />
        <group rotation={[0.2, 0.5, -0.25]}>
          <ParticleVisual
            system={createSystem({ billboard: true, modelName: "spark.eff" })}
            particle={particle}
          />
        </group>
      </TimeProvider>
    );

    await renderer.advanceFrames(1, 1 / 60);

    const mesh = renderer.scene.findAll((node) => node.type === "Mesh")[0].instance as THREE.Mesh;
    const billboardGroup = mesh.parent as THREE.Group;
    const worldQuaternion = new THREE.Quaternion();
    billboardGroup.getWorldQuaternion(worldQuaternion);
    expect(worldQuaternion.x).toBeCloseTo(camera.quaternion.x);
    expect(worldQuaternion.y).toBeCloseTo(camera.quaternion.y);
    expect(worldQuaternion.z).toBeCloseTo(camera.quaternion.z);
    expect(worldQuaternion.w).toBeCloseTo(camera.quaternion.w);
  });

  it("matches C++ Play(!_bLoop) for model/strip/arrow nested effects", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const particle = createParticle({ elapsed: 0.25 });

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({ type: 5, modelName: "spark.eff" })}
          particle={particle}
          loop={false}
        />
      </TimeProvider>
    );

    expect(mockNestedEffectLoop).toHaveBeenCalledWith(false);
  });

  it("loops MODEL nested effects with zero playTime like CMPPartCtrl::Play(0)/SetPlayType(0)", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const particle = createParticle({ elapsed: 0.25 });

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({ type: 5, modelName: "hl_greenfy3.eff", playTime: 0 })}
          particle={particle}
          loop={false}
        />
      </TimeProvider>
    );

    expect(mockNestedEffectLoop).toHaveBeenCalledWith(true);
  });

  it("matches C++ Play(0) for blast-style nested effects", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const particle = createParticle({ elapsed: 0.25 });

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({ type: 3, modelName: "spark.eff" })}
          particle={particle}
          loop={false}
        />
      </TimeProvider>
    );

    expect(mockNestedEffectLoop).toHaveBeenCalledWith(true);
  });

  it("notifies MODEL/STRIP systems when nested .eff playback finishes like _CPPart->IsPlay()", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const onNestedEffectComplete = vi.fn();

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({ type: 5, modelName: "spark.eff" })}
          particle={createParticle()}
          loop={false}
          onNestedEffectComplete={onNestedEffectComplete}
        />
      </TimeProvider>
    );

    mockNestedEffectComplete();

    expect(onNestedEffectComplete).toHaveBeenCalledTimes(1);
  });

  it("uses the shared _CPPart clock unless mediaY creates per-particle nested effects", async () => {
    mockUseLoadEffect.mockReturnValue([{
      version: 7,
      idxTech: 0,
      usePath: false,
      pathName: "",
      useSound: false,
      soundName: "",
      rotating: false,
      rotaVec: [0, 0, 0],
      rotaVel: 0,
      effNum: 0,
      subEffects: [],
    }]);
    const particle = createParticle({ elapsed: 0.42 });
    const sharedEffectElapsedRef = { current: 1.5 };

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({ type: 2, modelName: "spark.eff", mediaY: false })}
          particle={particle}
          loop={false}
          sharedEffectElapsedRef={sharedEffectElapsedRef}
        />
      </TimeProvider>
    );

    expect(mockNestedEffectTime).toHaveBeenCalledWith(1.5);
    mockNestedEffectTime.mockClear();

    await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <ParticleVisual
          system={createSystem({ type: 2, modelName: "spark.eff", mediaY: true })}
          particle={particle}
          loop={false}
          sharedEffectElapsedRef={sharedEffectElapsedRef}
        />
      </TimeProvider>
    );

    expect(mockNestedEffectTime).toHaveBeenCalledWith(0.42);
  });
});
