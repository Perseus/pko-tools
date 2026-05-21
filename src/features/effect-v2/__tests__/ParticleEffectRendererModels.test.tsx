import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Provider, useSetAtom } from "jotai";
import { currentProjectAtom } from "@/store/project";
import { TimeProvider, TimeSource } from "../TimeContext";
import { ParticleEffectRenderer } from "../renderers/ParticleEffectRenderer";
import type { ParChaModel, ParFile } from "@/types/effect-v2";

const { mockLoadParFile, mockCharacterModelRenderer } = vi.hoisted(() => ({
  mockLoadParFile: vi.fn(),
  mockCharacterModelRenderer: vi.fn(),
}));

vi.mock("@/commands/effect", () => ({
  loadParFile: (projectId: string, fileName: string) => mockLoadParFile(projectId, fileName),
}));

vi.mock("../renderers/CharacterModelParticleRenderer", () => ({
  CharacterModelParticleRenderer: (props: {
    model: ParChaModel;
    projectId?: string;
    onComplete?: () => void;
  }) => {
    mockCharacterModelRenderer(props);
    return (
      <mesh name={`cha-model-${props.model.id}`}>
        <boxGeometry />
        <meshBasicMaterial />
      </mesh>
    );
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

const chaModel: ParChaModel = {
  id: 52,
  velocity: 1,
  playType: 2,
  curPose: 7,
  srcBlend: 5,
  destBlend: 2,
  color: [1, 1, 1, 1],
};

function parFile(overrides: Partial<ParFile> = {}): ParFile {
  return {
    version: 15,
    name: "character-model-par",
    length: 0,
    systems: [],
    strips: [],
    models: [chaModel],
    ...overrides,
  };
}

describe("ParticleEffectRenderer character models", () => {
  beforeEach(() => {
    mockLoadParFile.mockReset();
    mockLoadParFile.mockResolvedValue(parFile());
    mockCharacterModelRenderer.mockClear();
  });

  it("renders version-8+ ParChaModel records through the character model renderer", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <ParticleEffectRenderer particleEffectName="with-model" />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    expect(mockLoadParFile).toHaveBeenCalledWith("project-1", "with-model.par");
    expect(mockCharacterModelRenderer).toHaveBeenCalledWith(expect.objectContaining({
      model: chaModel,
      projectId: undefined,
    }));
    expect(renderer.scene.findByProps({ name: "cha-model-52" })).toBeTruthy();
  });

  it("waits for model-only .par files to finish before firing onComplete", async () => {
    const onComplete = vi.fn();
    await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <ParticleEffectRenderer particleEffectName="with-model" onComplete={onComplete} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(onComplete).not.toHaveBeenCalled();
    mockCharacterModelRenderer.mock.calls[0][0].onComplete?.();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
