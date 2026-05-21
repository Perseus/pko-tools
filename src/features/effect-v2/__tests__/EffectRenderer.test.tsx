import { describe, expect, it, vi, beforeEach } from "vitest";
import React, { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { Provider, useSetAtom } from "jotai";
import { EffectRenderer } from "../renderers/EffectRenderer";
import { TimeProvider, TimeSource } from "../TimeContext";
import { currentProjectAtom } from "@/store/project";
import { EffectFile } from "@/types/effect";

const { mockLoadPathFile } = vi.hoisted(() => ({
  mockLoadPathFile: vi.fn(),
}));

vi.mock("@/commands/effect", () => ({
  loadPathFile: (projectId: string, pathName: string) => mockLoadPathFile(projectId, pathName),
}));

vi.mock("../renderers/SubEffectRenderer", () => ({
  SubEffectRenderer: () => (
    <mesh>
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>
  ),
}));

function effect(overrides: Partial<EffectFile> = {}): EffectFile {
  return {
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
    subEffects: [{
      effectName: "test",
      effectType: 0,
      srcBlend: 5,
      destBlend: 2,
      length: 1,
      frameCount: 0,
      frameTimes: [],
      frameSizes: [],
      frameAngles: [],
      framePositions: [],
      frameColors: [],
      verCount: 0,
      coordCount: 0,
      coordFrameTime: 0,
      coordList: [],
      texCount: 0,
      texFrameTime: 0,
      texName: "",
      texList: [],
      modelName: "",
      billboard: false,
      vsIndex: 0,
      segments: 0,
      height: 0,
      topRadius: 0,
      botRadius: 0,
      frameTexCount: 0,
      frameTexTime: 0,
      frameTexNames: [],
      frameTexTime2: 0,
      useParam: 0,
      perFrameCylinder: [],
      rotaLoop: false,
      rotaLoopVec: [0, 0, 0, 0],
      alpha: false,
      rotaBoard: false,
    }],
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

const timeSource: TimeSource = {
  getTime: () => 5,
  playing: true,
  loop: false,
};

describe("EffectRenderer", () => {
  beforeEach(() => {
    mockLoadPathFile.mockReset();
  });

  it("moves the whole effect group along a loaded .csf path using the C++ default velocity", async () => {
    mockLoadPathFile.mockResolvedValue([[0, 0, 0], [10, 0, 0]]);

    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <EffectRenderer effect={effect({ usePath: true, pathName: "line.csf" })} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    const mesh = renderer.scene.findByType("Mesh").instance as THREE.Mesh;
    const effectGroup = mesh.parent as THREE.Group;

    expect(mockLoadPathFile).toHaveBeenCalledWith("project-1", "line.csf");
    expect(effectGroup.position.x).toBeCloseTo(5);
    expect(effectGroup.position.y).toBeCloseTo(0);
    expect(effectGroup.position.z).toBeCloseTo(0);
  });
});
