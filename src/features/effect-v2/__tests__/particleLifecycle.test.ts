import React from "react";
import { describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ParSystem } from "@/types/effect-v2";
import { TimeProvider, type TimeSource } from "../TimeContext";
import {
  advanceSteppedSpawnAccumulator,
  advanceParticleFrame,
  getParticleTimelineAdvanceSteps,
  getParticleFramePair,
  isParticlePlayTimeExpired,
  isParticleRenderVisibleAtTime,
  useParticleLifecycle,
  type FinitePlayTimeStopBehavior,
} from "../renderers/particles/useParticleLifecycle";

function createFrameState(overrides = {}) {
  return {
    alive: true,
    curFrame: 0,
    curTime: 0,
    frameTime: 0.5,
    ...overrides,
  };
}

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 2,
    name: "lifecycle",
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
    life: 0.2,
    velocity: 0,
    direction: [0, 0, 0],
    acceleration: [0, 0, 0],
    step: 0.01,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0.05,
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

function LifecycleProbe({
  system,
  loop,
  stopBehavior,
  restartOnLoop,
  respawnDeadParticles = true,
  onComplete,
  onAliveCount,
}: {
  system: ParSystem;
  loop?: boolean;
  stopBehavior?: FinitePlayTimeStopBehavior;
  restartOnLoop?: boolean;
  respawnDeadParticles?: boolean;
  onComplete: () => void;
  onAliveCount: (count: number) => void;
}) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    respawnDeadParticles,
    finitePlayTimeStopBehavior: stopBehavior,
    restartOnLoop,
    initParticle: () => {},
    moveParticle: () => {},
    onComplete,
  });

  useFrame(() => {
    onAliveCount(particlesRef.current.filter((p) => p.alive).length);
  });

  return null;
}

function createProbeElement({
  system,
  timeSource,
  loop,
  stopBehavior,
  restartOnLoop,
  respawnDeadParticles,
  onComplete,
  onAliveCount,
}: {
  system: ParSystem;
  timeSource: TimeSource;
  loop?: boolean;
  stopBehavior?: FinitePlayTimeStopBehavior;
  restartOnLoop?: boolean;
  respawnDeadParticles?: boolean;
  onComplete: () => void;
  onAliveCount: (count: number) => void;
}) {
  return React.createElement(
    TimeProvider,
    { value: timeSource },
    React.createElement(LifecycleProbe, {
      system,
      loop,
      stopBehavior,
      restartOnLoop,
      respawnDeadParticles,
      onComplete,
      onAliveCount,
    }),
  );
}

describe("advanceParticleFrame", () => {
  it("keeps default particle behavior as death at frameCount", () => {
    const particle = createFrameState({ curFrame: 1, curTime: 0.49 });

    advanceParticleFrame(particle, 0.02, 2, "kill");

    expect(particle.alive).toBe(false);
    expect(particle.curFrame).toBe(2);
    expect(particle.curTime).toBe(0);
  });

  it("matches C++ _FrameMoveRound by resetting frame state instead of dying", () => {
    const particle = createFrameState({ curFrame: 1, curTime: 0.49 });

    advanceParticleFrame(particle, 0.02, 2, "reset");

    expect(particle.alive).toBe(true);
    expect(particle.curFrame).toBe(0);
    expect(particle.curTime).toBe(0);
  });
});

function PathSpawnProbe({
  system,
  onPositions,
}: {
  system: ParSystem;
  onPositions: (positions: number[][]) => void;
}) {
  const emitterPositionRef = React.useRef<THREE.Vector3 | null>(new THREE.Vector3(1, 0, 0));
  const particlesRef = useParticleLifecycle({
    system,
    emitterPositionRef,
    initParticle: (p) => {
      p.pos.set(2, 0, 0);
    },
    moveParticle: () => {},
  });

  useFrame(() => {
    onPositions(particlesRef.current.map((p) => p.pos.toArray()));
  });

  return null;
}

describe("CEffPath lifecycle placement", () => {
  it("matches CMPPartSys::FrameMove by applying path current position before particle creation", async () => {
    let time = 0;
    let positions: number[][] = [];
    const timeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: false,
    };
    const system = createSystem({
      playTime: 0,
      usePath: true,
      path: {
        velocity: 10,
        points: [[0, 0, 0], [100, 0, 0]],
        directions: [[1, 0, 0]],
        distances: [100],
      },
    });

    const renderer = await ReactThreeTestRenderer.create(React.createElement(
      TimeProvider,
      { value: timeSource },
      React.createElement(PathSpawnProbe, {
        system,
        onPositions: (next) => { positions = next; },
      }),
    ));

    time = 0.05;
    await renderer.advanceFrames(1, 1 / 60);

    expect(positions[0][0]).toBeCloseTo(3.5);
    expect(positions[0][1]).toBeCloseTo(0);
    expect(positions[0][2]).toBeCloseTo(0);
  });

  it("only advances CEffPath by the active time after delayTime is crossed", async () => {
    let time = 0;
    let positions: number[][] = [];
    const timeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: false,
    };
    const system = createSystem({
      delayTime: 0.2,
      playTime: 0,
      usePath: true,
      path: {
        velocity: 10,
        points: [[0, 0, 0], [100, 0, 0]],
        directions: [[1, 0, 0]],
        distances: [100],
      },
    });

    const renderer = await ReactThreeTestRenderer.create(React.createElement(
      TimeProvider,
      { value: timeSource },
      React.createElement(PathSpawnProbe, {
        system,
        onPositions: (next) => { positions = next; },
      }),
    ));

    time = 0.21;
    await renderer.advanceFrames(1, 1 / 60);

    expect(positions[0][0]).toBeCloseTo(3.1);
    expect(positions[0][1]).toBeCloseTo(0);
    expect(positions[0][2]).toBeCloseTo(0);
  });
});

describe("getParticleFramePair", () => {
  it("holds the final frame by default", () => {
    expect(getParticleFramePair(1, 2, "hold")).toEqual({ cur: 1, next: 1 });
  });

  it("wraps final-frame interpolation for Round", () => {
    expect(getParticleFramePair(1, 2, "wrap")).toEqual({ cur: 1, next: 0 });
  });
});

describe("advanceSteppedSpawnAccumulator", () => {
  it("matches C++ _Create* step gating by accumulating until _fStep", () => {
    expect(advanceSteppedSpawnAccumulator(0, 0.1, 0.25)).toEqual({
      next: 0.1,
      shouldSpawn: false,
    });
    expect(advanceSteppedSpawnAccumulator(0.2, 0.1, 0.25)).toEqual({
      next: 0,
      shouldSpawn: true,
    });
  });

  it("spawns immediately when the source path primes _fCurTime to _fStep", () => {
    expect(advanceSteppedSpawnAccumulator(0.25, 0.01, 0.25)).toEqual({
      next: 0,
      shouldSpawn: true,
    });
  });
});

describe("getParticleTimelineAdvanceSteps", () => {
  it("turns a paused scrub forward into bounded simulation steps", () => {
    expect(getParticleTimelineAdvanceSteps(0, 0.12)).toEqual({
      reset: false,
      steps: [0.05, 0.05, 0.02],
      nextLastTime: 0.12,
    });
  });

  it("resets and replays from zero when the shared timeline rewinds", () => {
    expect(getParticleTimelineAdvanceSteps(1, 0.12)).toEqual({
      reset: true,
      steps: [0.05, 0.05, 0.02],
      nextLastTime: 0.12,
    });
  });

  it("resets without advancing when scrubbed back to the start", () => {
    expect(getParticleTimelineAdvanceSteps(1, 0)).toEqual({
      reset: true,
      steps: [],
      nextLastTime: 0,
    });
  });
});

describe("isParticlePlayTimeExpired", () => {
  it("matches CMPPartSys::UpdateDelay by treating playTime <= 0 as unlimited", () => {
    expect(isParticlePlayTimeExpired(10, 0, 0, false)).toBe(false);
  });

  it("expires finite non-looping systems after playTime when there is no delay", () => {
    expect(isParticlePlayTimeExpired(0.99, 1, 0, false)).toBe(false);
    expect(isParticlePlayTimeExpired(1, 1, 0, false)).toBe(true);
  });

  it("does not expire before delayTime even when playTime is shorter than delayTime", () => {
    expect(isParticlePlayTimeExpired(0.75, 0.5, 1, false)).toBe(false);
    expect(isParticlePlayTimeExpired(1, 0.5, 1, false)).toBe(true);
  });

  it("matches CMPPartSys::SetLoop(true) by ignoring finite playTime in loop mode", () => {
    expect(isParticlePlayTimeExpired(10, 1, 0, true)).toBe(false);
  });
});

describe("isParticleRenderVisibleAtTime", () => {
  it("matches CMPPartSys::UpdateDelay render gating before delay", () => {
    expect(isParticleRenderVisibleAtTime(0.99, 0, 1, false)).toBe(false);
    expect(isParticleRenderVisibleAtTime(1, 0, 1, false)).toBe(true);
  });

  it("matches CMPPartSys::Stop by hiding finite non-looping systems at playTime", () => {
    expect(isParticleRenderVisibleAtTime(0.99, 1, 0, false)).toBe(true);
    expect(isParticleRenderVisibleAtTime(1, 1, 0, false)).toBe(false);
  });
});

describe("finite play-time stop behavior", () => {
  it("keeps default finite systems as immediate Stop/clear behavior", async () => {
    let time = 0;
    let aliveCount = -1;
    const onComplete = vi.fn();
    const timeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: false,
    };

    const renderer = await ReactThreeTestRenderer.create(createProbeElement({
      system: createSystem(),
      timeSource,
      onComplete,
      onAliveCount: (count) => { aliveCount = count; },
    }));

    await renderer.advanceFrames(1, 1 / 60);
    expect(aliveCount).toBe(1);

    time = 0.05;
    await renderer.advanceFrames(1, 1 / 60);

    expect(aliveCount).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("matches SNOW/FIRE/SHRINK Stop by draining live particles and blocking respawn", async () => {
    let time = 0;
    let aliveCount = -1;
    const onComplete = vi.fn();
    const timeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: false,
    };

    const renderer = await ReactThreeTestRenderer.create(createProbeElement({
      system: createSystem(),
      timeSource,
      stopBehavior: "drain",
      onComplete,
      onAliveCount: (count) => { aliveCount = count; },
    }));

    await renderer.advanceFrames(1, 1 / 60);
    expect(aliveCount).toBe(1);

    time = 0.05;
    await renderer.advanceFrames(1, 1 / 60);
    expect(aliveCount).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();

    time = 0.25;
    await renderer.advanceFrames(1, 1 / 60);
    expect(aliveCount).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);

    time = 0.5;
    await renderer.advanceFrames(1, 1 / 60);
    expect(aliveCount).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("loop restart behavior", () => {
  it("keeps the default C++ _bLoop restart path for looping systems", async () => {
    let time = 0;
    let aliveCount = -1;
    const onComplete = vi.fn();
    const timeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(createProbeElement({
      system: createSystem({ life: 0.05, playTime: 0 }),
      timeSource,
      loop: true,
      respawnDeadParticles: false,
      onComplete,
      onAliveCount: (count) => { aliveCount = count; },
    }));

    await renderer.advanceFrames(1, 1 / 60);
    expect(aliveCount).toBe(1);

    time = 0.06;
    await renderer.advanceFrames(1, 1 / 60);

    expect(aliveCount).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("can match BLAST2/BLAST3 by ignoring _bLoop and completing at end-of-life", async () => {
    let time = 0;
    let aliveCount = -1;
    const onComplete = vi.fn();
    const timeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(createProbeElement({
      system: createSystem({ life: 0.05, playTime: 0 }),
      timeSource,
      loop: true,
      restartOnLoop: false,
      respawnDeadParticles: false,
      onComplete,
      onAliveCount: (count) => { aliveCount = count; },
    }));

    await renderer.advanceFrames(1, 1 / 60);
    expect(aliveCount).toBe(1);

    time = 0.06;
    await renderer.advanceFrames(1, 1 / 60);

    expect(aliveCount).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
