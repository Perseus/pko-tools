import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { useTimeSource } from "../../TimeContext";
import { lerp, randfRange } from "../../helpers";

/**
 * Per-particle mutable state.
 * Fields like size, color, alpha, angle are interpolated outputs from system keyframes —
 * they are written by the lifecycle hook each frame, not set by the system type.
 */
export interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  /** Velocity/direction vector — per-particle, mutable (acceleration modifies it). */
  dir: THREE.Vector3;
  accel: THREE.Vector3;
  /** Interpolated size output from frameSizes keyframes. */
  size: number;
  color: THREE.Color;
  alpha: number;
  /** Interpolated Euler rotation output from frameAngles keyframes. */
  angle: THREE.Vector3;
  /** Particle index within the system (immutable after spawn). */
  index: number;
  curFrame: number;
  /** Time elapsed within current frame segment (0 to frameTime). */
  curTime: number;
  /** Seconds per frame segment = life / frameCount. */
  frameTime: number;
  /** This particle's total lifetime in seconds (randomized at spawn). */
  life: number;
  /** Total time this particle has been alive. Drives nested TimeProvider for sub-effects. */
  elapsed: number;
}

export interface UseParticleLifecycleOptions {
  system: ParSystem;
  loop?: boolean;
  /** Called once per particle at spawn. Set pos/dir/accel here. */
  initParticle: (p: Particle, index: number, system: ParSystem) => void;
  /** Called per-particle per-frame AFTER frame interpolation. Update pos here. */
  moveParticle: (p: Particle, index: number, dt: number, system: ParSystem) => void;
  onComplete?: () => void;
}

function createParticles(
  count: number,
  system: ParSystem,
  initParticle: UseParticleLifecycleOptions["initParticle"],
): Particle[] {
  const particles: Particle[] = [];
  const minLife = system.life / Math.max(system.randomMode, 1);

  for (let i = 0; i < count; i++) {
    const life = randfRange(minLife, system.life);
    const p: Particle = {
      alive: true,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      accel: new THREE.Vector3(),
      size: system.frameSizes[0] ?? 1,
      color: new THREE.Color(1, 1, 1),
      alpha: 1,
      angle: new THREE.Vector3(),
      index: i,
      curFrame: 0,
      curTime: 0,
      frameTime: system.frameCount > 0 ? life / system.frameCount : life,
      life,
      elapsed: 0,
    };
    initParticle(p, i, system);
    particles.push(p);
  }
  return particles;
}

/**
 * Shared particle lifecycle engine.
 *
 * Handles frame advancement, size/color/angle interpolation, death detection,
 * delayTime gating, and loop restart — identical across all 16 PKO particle types.
 * Each system type only provides initParticle (spawn logic) and moveParticle (position update).
 *
 * Matches the C++ GetCurFrame/GetLerpValue/frameSize interpolation pattern from MPParticleSys.cpp.
 *
 * NOTE: The returned ref is mutated imperatively by useFrame without triggering React re-renders.
 * Consumers that render JSX based on particle state (e.g., mapping alive particles to components)
 * will see stale data between re-renders. For fast transient systems like blast this is fine.
 * Continuous emitters (fire, snow) may need a re-render trigger strategy when implemented.
 */
export function useParticleLifecycle({
  system,
  loop,
  initParticle,
  moveParticle,
  onComplete,
}: UseParticleLifecycleOptions): React.MutableRefObject<Particle[]> {
  const timeSource = useTimeSource();

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const particlesRef = useRef<Particle[]>([]);
  const completedRef = useRef(false);

  // System-level delay tracking.
  // Spawn happens inside useFrame (not render phase) to avoid running
  // Math.random() during render and to behave correctly under Strict Mode.
  const systemElapsedRef = useRef(0);
  const spawnedRef = useRef(false);

  useFrame((_, delta) => {
    if (!timeSource.playing) return;
    const dt = Math.min(delta, 0.05);

    // Spawn gate: wait for delayTime (or spawn immediately on first tick if no delay)
    if (!spawnedRef.current) {
      systemElapsedRef.current += dt;
      if (system.delayTime <= 0 || systemElapsedRef.current >= system.delayTime) {
        particlesRef.current = createParticles(system.particleCount, system, initParticle);
        spawnedRef.current = true;
      } else {
        return;
      }
    }

    let deadCount = 0;

    for (const p of particlesRef.current) {
      if (!p.alive) {
        deadCount++;
        continue;
      }

      // Track total time alive (for nested TimeProvider)
      p.elapsed += dt;

      // --- Frame advancement (matches C++ GetCurFrame) ---
      // Sub-frame remainder is intentionally discarded on frame advance (reset to 0),
      // matching the original C++ behavior where GetCurFrame resets m_fCurTime = 0.
      p.curTime += dt;
      if (p.curTime >= p.frameTime) {
        p.curFrame++;
        p.curTime = 0;
        if (p.curFrame >= system.frameCount) {
          p.alive = false;
          deadCount++;
          continue;
        }
      }

      // --- Interpolation (matches C++ _FrameMoveBlast pattern) ---
      const cur = p.curFrame;
      const next = cur >= system.frameCount - 1 ? cur : cur + 1;
      const fLerp = p.frameTime > 0 ? p.curTime / p.frameTime : 0;

      // Size
      if (system.frameSizes.length > cur) {
        const s0 = system.frameSizes[cur];
        const s1 = system.frameSizes[next] ?? s0;
        p.size = lerp(s0, s1, fLerp);
      }

      // Color + alpha
      if (system.frameColors.length > cur) {
        const cc = system.frameColors[cur];
        const nc = system.frameColors[next] ?? cc;
        p.color.setRGB(
          lerp(cc[0], nc[0], fLerp),
          lerp(cc[1], nc[1], fLerp),
          lerp(cc[2], nc[2], fLerp),
        );
        p.alpha = lerp(cc[3], nc[3], fLerp);
      }

      // Angle
      if (system.frameAngles.length > cur) {
        const ca = system.frameAngles[cur];
        const na = system.frameAngles[next] ?? ca;
        p.angle.set(
          lerp(ca[0], na[0], fLerp),
          lerp(ca[1], na[1], fLerp),
          lerp(ca[2], na[2], fLerp),
        );
      }

      // --- Type-specific position update ---
      moveParticle(p, p.index, dt, system);
    }

    // All dead?
    if (deadCount >= particlesRef.current.length && particlesRef.current.length > 0) {
      if (loop) {
        particlesRef.current = createParticles(system.particleCount, system, initParticle);
      } else if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    }
  });

  return particlesRef;
}
