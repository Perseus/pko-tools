import { useRef, useEffect, RefObject } from "react";
import { render, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { Vec3 } from "@/types/effect";
import { randf } from "../../helpers"
import { useAtomValue } from "jotai";
import { effectV2PlaybackAtom } from "@/store/effect-v2";

interface ParticleController {
  velocity: THREE.Vector3,
  acceleration: THREE.Vector3,
  groupRef: RefObject<THREE.Group>,
};

/** Type 3 — Blast particles exploding outward. */
export function BlastSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);
  const particleContollers = useRef<Record<number, ParticleController>>({});
  const playback = useAtomValue(effectV2PlaybackAtom);

  for (let i = 0; i < system.particleCount; i++) {
    const velocity = new THREE.Vector3(
      randf(system.velocity),
      randf(system.velocity),
      -randf(system.velocity),
    );

    const dir = new THREE.Vector3(
      randf(2) ? system.direction[0] : -system.direction[0],
      system.direction[2],
      randf(2) ? system.direction[1] : -system.direction[1],
    );

    velocity.multiply(dir);
    const particleController: ParticleController = {
      velocity,
      acceleration: new THREE.Vector3(system.acceleration[0], system.acceleration[2], system.acceleration[1]),
      groupRef: useRef(new THREE.Group()),
    };

    particleContollers.current[i] = particleController;
  }

  // just the velocity magnitude first
  // TODO: use system.range

  const totalAnimationDurationSeconds = system.playTime;

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement blast particle simulation
    //
    let t = playback.time;

    for (let i = 0; i < system.particleCount; i++) {
      const renderGroup = particleContollers.current[i].groupRef;

    }
  });

  const particleGroups = [];
  for (let i = 0; i < system.particleCount; i++) {
    particleGroups.push(
      <group ref={particleContollers.current[i].groupRef}>
        <ParticleVisual system={system} loop={loop} />
      </group>
    )
  }

  return <group ref={groupRef}>
    {particleGroups}
  </group>
}                     
