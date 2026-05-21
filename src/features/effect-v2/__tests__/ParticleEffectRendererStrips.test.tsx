import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Provider, useSetAtom } from "jotai";
import { currentProjectAtom } from "@/store/project";
import { TimeProvider, TimeSource } from "../TimeContext";
import { ParticleEffectRenderer } from "../renderers/ParticleEffectRenderer";
import type { ParFile, ParStrip } from "@/types/effect-v2";

const { mockLoadParFile, mockStripRenderer } = vi.hoisted(() => ({
  mockLoadParFile: vi.fn(),
  mockStripRenderer: vi.fn(),
}));

vi.mock("@/commands/effect", () => ({
  loadParFile: (projectId: string, fileName: string) => mockLoadParFile(projectId, fileName),
}));

vi.mock("../renderers/StripRenderer", () => ({
  StripRenderer: (props: {
    strip: ParStrip;
    loop?: boolean;
    onComplete?: () => void;
  }) => {
    mockStripRenderer(props);
    return (
      <mesh name={`strip-${props.strip.textureName}`}>
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

const strip: ParStrip = {
  maxLen: 4,
  dummy: [0, 1],
  color: [1, 1, 1, 1],
  life: 1,
  step: 0.1,
  textureName: "trail",
  srcBlend: 5,
  destBlend: 2,
};

function parFile(overrides: Partial<ParFile> = {}): ParFile {
  return {
    version: 15,
    name: "strip-par",
    length: 0,
    systems: [],
    strips: [strip],
    models: [],
    ...overrides,
  };
}

describe("ParticleEffectRenderer strips", () => {
  beforeEach(() => {
    mockLoadParFile.mockReset();
    mockLoadParFile.mockResolvedValue(parFile());
    mockStripRenderer.mockClear();
  });

  it("waits for strip-only .par files to finish before firing onComplete", async () => {
    const onComplete = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <Provider>
        <ProjectHydrator>
          <TimeProvider value={timeSource}>
            <ParticleEffectRenderer particleEffectName="with-strip" onComplete={onComplete} />
          </TimeProvider>
        </ProjectHydrator>
      </Provider>,
    );

    await Promise.resolve();
    await Promise.resolve();
    await renderer.advanceFrames(1, 1 / 60);

    expect(mockLoadParFile).toHaveBeenCalledWith("project-1", "with-strip.par");
    expect(mockStripRenderer).toHaveBeenCalledWith(expect.objectContaining({
      strip,
      loop: false,
    }));
    expect(onComplete).not.toHaveBeenCalled();

    mockStripRenderer.mock.calls[0][0].onComplete?.();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
