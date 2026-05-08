import type { Particle } from "./renderers/particles/useParticleLifecycle";

export interface ParticleTraceSample {
  index: number;
  position: [number, number, number];
  direction: [number, number, number];
  acceleration: [number, number, number];
  size: number;
  color: [number, number, number];
  alpha: number;
  angle: [number, number, number];
  curFrame: number;
  curTime: number;
  elapsed: number;
  life: number;
}

export interface ParticleTraceFrame {
  time: number;
  systemIndex: number;
  systemType: number;
  aliveCount: number;
  samples: ParticleTraceSample[];
}

export interface ParticleTraceSession {
  frames: ParticleTraceFrame[];
}

export interface ParticleTraceDiff {
  frameIndex: number;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface ParticleTraceDiffOptions {
  epsilon?: number;
}

export function sampleParticleTraceFrame({
  systemIndex,
  systemType,
  time,
  particles,
  maxSamples = 3,
}: {
  systemIndex: number;
  systemType: number;
  time: number;
  particles: Particle[];
  maxSamples?: number;
}): ParticleTraceFrame {
  const alive = particles.filter((p) => p.alive);

  return {
    time,
    systemIndex,
    systemType,
    aliveCount: alive.length,
    samples: alive.slice(0, maxSamples).map((p) => ({
      index: p.index,
      position: [p.pos.x, p.pos.y, p.pos.z],
      direction: [p.dir.x, p.dir.y, p.dir.z],
      acceleration: [p.accel.x, p.accel.y, p.accel.z],
      size: p.size,
      color: [p.color.r, p.color.g, p.color.b],
      alpha: p.alpha,
      angle: [p.angle.x, p.angle.y, p.angle.z],
      curFrame: p.curFrame,
      curTime: p.curTime,
      elapsed: p.elapsed,
      life: p.life,
    })),
  };
}

export function sampleParticleTraceSession(frames: ParticleTraceFrame[]): ParticleTraceSession {
  return { frames };
}

export function serializeParticleTraceSession(session: ParticleTraceSession): string {
  return JSON.stringify(session, null, 2);
}

export function diffParticleTraceSessions(
  expected: ParticleTraceSession,
  actual: ParticleTraceSession,
  options: ParticleTraceDiffOptions = {},
): ParticleTraceDiff[] {
  const epsilon = options.epsilon ?? 0.001;
  const diffs: ParticleTraceDiff[] = [];
  const frameCount = Math.min(expected.frames.length, actual.frames.length);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    diffValue(expected.frames[frameIndex], actual.frames[frameIndex], "", frameIndex, epsilon, diffs);
  }

  if (expected.frames.length !== actual.frames.length) {
    diffs.push({
      frameIndex: frameCount,
      field: "frames.length",
      expected: expected.frames.length,
      actual: actual.frames.length,
    });
  }

  return diffs;
}

function diffValue(
  expected: unknown,
  actual: unknown,
  path: string,
  frameIndex: number,
  epsilon: number,
  diffs: ParticleTraceDiff[],
): void {
  if (typeof expected === "number" && typeof actual === "number") {
    if (Math.abs(expected - actual) > epsilon) {
      diffs.push({ frameIndex, field: path, expected, actual });
    }
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.min(expected.length, actual.length);
    for (let i = 0; i < length; i++) {
      diffValue(expected[i], actual[i], `${path}[${i}]`, frameIndex, epsilon, diffs);
    }
    if (expected.length !== actual.length) {
      diffs.push({
        frameIndex,
        field: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      });
    }
    return;
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of Object.keys(expected)) {
      const childPath = path ? `${path}.${key}` : key;
      diffValue(expected[key], actual[key], childPath, frameIndex, epsilon, diffs);
    }
    return;
  }

  if (expected !== actual) {
    diffs.push({ frameIndex, field: path, expected, actual });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
