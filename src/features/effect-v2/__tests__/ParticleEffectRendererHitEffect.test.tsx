import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Provider, useSetAtom } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { TimeProvider, TimeSource } from "../TimeContext";
import { ParticleEffectRenderer } from "../renderers/ParticleEffectRenderer";
import type { ParFile, ParSystem } from "@/types/effect-v2";
import type { ParticleSystemProps } from "../renderers/particles/types";

const {
  mockLoadParFile,
  mockRange2System,
} = vi.hoisted(() => ({
  mockLoadParFile: vi.fn(),
  mockRange2System: vi.fn(),
}));

vi.mock("@/commands/effect", () => ({
  loadParFile: (projectId: string, fileName: string) => mockLoadParFile(projectId, fileName),
}));

vi.mock("../renderers/particles/Range2System", () => ({
  Range2System: (props: ParticleSystemProps) => {
    mockRange2System(props);
    return <group name="range2-system" />;
  },
}));

function ProjectHydrator({ children }: { children: React.ReactNode }) {
  const setProject = useSetAtom(currentProjectAtom);
  useEffect(() => {
    setProject({ id: "project-1", name: "Test", projectDirectory: "E:/client" });
  }, [setProject]);
  return <>{children}</>;
}

const timeSource: TimeSource = {
  getTime: () => 0,
  playing: true,
  loop: true,
};

function system(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 15,
    name: "range2-hit",
    particleCount: 1,
    textureName: "",
    modelName: "",
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
    direction: [0, 0, 1],
    acceleration: [0, 0, 0],
    step: 0.1,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0,
    usePath: false,
    path: null,
    shade: false,
    hitEffect: "hit.par",
    pointRanges: [],
    randomMode: 0,
    modelDir: false,
    mediaY: false,
    ...overrides,
  };
}

function parFile(systems: ParSystem[]): ParFile {
  return {
    version: 15,
    name: "par",
    length: 0,
    systems,
    strips: [],
    models: [],
  };
}

describe("ParticleEffectRenderer hitEffect routing", () => {
  beforeEach(() => {
    mockLoadParFile.mockReset();
    mockRange2System.mockClear();
    mockLoadParFile.mockImplementation((_projectId: string, fileName: string) => {
      if (fileName === "root.par") return Promise.resolve(parFile([system()]));
      if (fileName === "hit.par") return Promise.resolve(parFile([]));
      return Promise.reject(new Error(`unexpected par load: ${fileName}`));
    });
  });

  it("renders SendResMessage-style particle hit effects and normalizes .par names", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <ParticleEffectRenderer particleEffectName="root" />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    const props = mockRange2System.mock.calls[0][0] as ParticleSystemProps;
    await act(async () => {
      props.onHitEffect?.(
        "hit.par",
        new THREE.Vector3(4, 5, 6),
        new THREE.Vector3(0, 0, 1),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLoadParFile).toHaveBeenCalledWith("project-1", "root.par");
    expect(mockLoadParFile).toHaveBeenCalledWith("project-1", "hit.par");
    expect(mockLoadParFile).not.toHaveBeenCalledWith("project-1", "hit.par.par");
  });
});
