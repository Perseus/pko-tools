import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
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
  mockDummySystem,
  mockLineSingleSystem,
  mockLineRoundSystem,
} = vi.hoisted(() => ({
  mockLoadParFile: vi.fn(),
  mockDummySystem: vi.fn(),
  mockLineSingleSystem: vi.fn(),
  mockLineRoundSystem: vi.fn(),
}));

vi.mock("@/commands/effect", () => ({
  loadParFile: (projectId: string, fileName: string) => mockLoadParFile(projectId, fileName),
}));

vi.mock("../renderers/particles/DummySystem", () => ({
  DummySystem: (props: ParticleSystemProps) => {
    mockDummySystem(props);
    return <group name="dummy-system" />;
  },
}));

vi.mock("../renderers/particles/LineSingleSystem", () => ({
  LineSingleSystem: (props: ParticleSystemProps) => {
    mockLineSingleSystem(props);
    return <group name="line-single-system" />;
  },
}));

vi.mock("../renderers/particles/LineRoundSystem", () => ({
  LineRoundSystem: (props: ParticleSystemProps) => {
    mockLineRoundSystem(props);
    return <group name="line-round-system" />;
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

function system(type: number): ParSystem {
  return {
    type,
    name: `type-${type}`,
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
    direction: [0, 0, 0],
    acceleration: [0, 0, 0],
    step: 0.1,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0,
    usePath: false,
    path: null,
    shade: false,
    hitEffect: "",
    pointRanges: [],
    randomMode: 0,
    modelDir: false,
    mediaY: false,
  };
}

function parFile(): ParFile {
  return {
    version: 15,
    name: "dummy-span-par",
    length: 0,
    systems: [system(16), system(17), system(18)],
    strips: [],
    models: [],
  };
}

describe("ParticleEffectRenderer dummy-line span routing", () => {
  beforeEach(() => {
    mockLoadParFile.mockReset();
    mockLoadParFile.mockResolvedValue(parFile());
    mockDummySystem.mockClear();
    mockLineSingleSystem.mockClear();
    mockLineRoundSystem.mockClear();
  });

  it("matches CMPPartSys::SetItemDummy by binding runtime dummy spans only to Dummy and LineSingle systems", async () => {
    const dummyLineSpan = {
      start: new THREE.Vector3(1, 2, 3),
      direction: new THREE.Vector3(1, 0, 0),
      distance: 4,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <ParticleEffectRenderer particleEffectName="with-dummy-span" dummyLineSpan={dummyLineSpan} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    expect(mockDummySystem.mock.calls[0][0].dummyLineSpan).toBe(dummyLineSpan);
    expect(mockLineSingleSystem.mock.calls[0][0].dummyLineSpan).toBe(dummyLineSpan);
    expect(mockLineRoundSystem.mock.calls[0][0].dummyLineSpan).toBeNull();
  });
});
