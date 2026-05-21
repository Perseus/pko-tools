import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Provider, useSetAtom } from "jotai";
import { currentProjectAtom } from "@/store/project";
import { effectV2HiddenParticleSystemsAtom } from "@/store/effect-v2";
import { TimeProvider, TimeSource } from "../TimeContext";
import { ParticleEffectRenderer } from "../renderers/ParticleEffectRenderer";
import type { ParFile, ParSystem } from "@/types/effect-v2";
import type { ParticleSystemProps } from "../renderers/particles/types";

const {
  mockLoadParFile,
  mockSnowSystem,
  mockFireSystem,
} = vi.hoisted(() => ({
  mockLoadParFile: vi.fn(),
  mockSnowSystem: vi.fn(),
  mockFireSystem: vi.fn(),
}));

vi.mock("@/commands/effect", () => ({
  loadParFile: (projectId: string, fileName: string) => mockLoadParFile(projectId, fileName),
}));

vi.mock("../renderers/particles/SnowSystem", () => ({
  SnowSystem: (props: ParticleSystemProps) => {
    mockSnowSystem(props);
    return <group name="snow-system" />;
  },
}));

vi.mock("../renderers/particles/FireSystem", () => ({
  FireSystem: (props: ParticleSystemProps) => {
    mockFireSystem(props);
    return <group name="fire-system" />;
  },
}));

const timeSource: TimeSource = {
  getTime: () => 0,
  playing: true,
  loop: true,
};

function ProjectHydrator({ children }: { children: React.ReactNode }) {
  const setProject = useSetAtom(currentProjectAtom);
  useEffect(() => {
    setProject({ id: "project-1", name: "Test", projectDirectory: "E:/client" });
  }, [setProject]);
  return <>{children}</>;
}

function HiddenHydrator({
  hidden,
  children,
}: {
  hidden: Set<number>;
  children: React.ReactNode;
}) {
  const setHidden = useSetAtom(effectV2HiddenParticleSystemsAtom);
  useEffect(() => {
    setHidden(hidden);
  }, [hidden, setHidden]);
  return <>{children}</>;
}

function system(type: number, name: string): ParSystem {
  return {
    type,
    name,
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
  };
}

function parFile(): ParFile {
  return {
    version: 15,
    name: "visibility.par",
    length: 1,
    systems: [system(1, "snow"), system(2, "fire")],
    strips: [],
    models: [],
  };
}

describe("ParticleEffectRenderer system visibility", () => {
  beforeEach(() => {
    mockLoadParFile.mockReset();
    mockSnowSystem.mockClear();
    mockFireSystem.mockClear();
    mockLoadParFile.mockResolvedValue(parFile());
  });

  it("hides systems without unmounting their lifecycle when toggled off", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <HiddenHydrator hidden={new Set([0])}>
            <TimeProvider value={timeSource}>
              <ParticleEffectRenderer particleEffectName="visibility" />
            </TimeProvider>
          </HiddenHydrator>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();

    const snow = renderer.scene.findByProps({ name: "snow-system" });
    const fire = renderer.scene.findByProps({ name: "fire-system" });

    expect(snow.instance.parent?.visible).toBe(false);
    expect(fire.instance.parent?.visible).toBe(true);
    expect(mockSnowSystem).toHaveBeenCalled();
    expect(mockFireSystem).toHaveBeenCalled();
  });
});
