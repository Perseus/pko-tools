import { useRef } from "react";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";

/**
 * Wind system stores spawn positions per particle for spiral rotation reference.
 * This factory returns init/move closures that share a spawn position map.
 */
function createWindCallbacks(spawnPositions: React.MutableRefObject<Map<number, THREE.Vector3>>) {
  /**
   * Per-particle spawn with upward velocity.
   * Matches C++ _CreateWind in MPParticleSys.cpp:
   * - velocity is purely upward (Three.js Y)
   * - spawn position is saved for spiral rotation reference
   */
  function initWindParticle(p: Particle, _i: number, system: ParSystem) {
    p.dir.set(0, system.velocity, 0);
    p.accel.set(system.acceleration[0], system.acceleration[2], system.acceleration[1]);
    // Save spawn position for spiral rotation in moveParticle
    spawnPositions.current.set(p.index, p.pos.clone());
  }

  /**
   * Per-frame spiral tornado motion for wind particles.
   * Matches C++ _FrameMoveWind:
   * - Rotation angle accumulates from velocity * elapsed time
   * - Acceleration offset is rotated around Y axis (Three.js vertical)
   * - XZ position grows quadratically from spawn position
   * - Y position integrates normally (upward velocity)
   */
  function moveWindParticle(p: Particle, _i: number, dt: number, system: ParSystem) {
    const spawn = spawnPositions.current.get(p.index);
    if (!spawn) return;

    const age = p.elapsed;
    const angleZ = system.velocity * age;

    // Rotate acceleration offset around Y axis
    const accelX = system.acceleration[0];
    const accelZ = system.acceleration[1]; // PKO Y → Three.js Z
    const cosA = Math.cos(angleZ);
    const sinA = Math.sin(angleZ);
    const rotX = accelX * cosA - accelZ * sinA;
    const rotZ = accelX * sinA + accelZ * cosA;

    // Quadratic growth for spiral expansion
    const scale = age * age;
    p.pos.x = spawn.x + rotX * scale;
    p.pos.z = spawn.z + rotZ * scale;

    // Y position integrates normally (upward velocity)
    p.pos.y += p.dir.y * dt;
  }

  return { initWindParticle, moveWindParticle };
}

/** Type 7 — Wind-driven spiral tornado particles. */
export function WindSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const spawnPositions = useRef<Map<number, THREE.Vector3>>(new Map());
  const { initWindParticle, moveWindParticle } = createWindCallbacks(spawnPositions);

  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initWindParticle,
    moveParticle: moveWindParticle,
  });

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <group key={p.index} position={p.pos} scale={p.size}>
          <ParticleVisual system={system} particle={p} loop={loop} />
        </group>
      ))}
    </group>
  );
}
