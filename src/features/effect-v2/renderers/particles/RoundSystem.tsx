import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 9 — Particles emitted in a circular/round pattern. */
export function RoundSystem({ system: _system, loop: _loop, onComplete }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => { onComplete?.(); }, []);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement round particle simulation
  });

  return <group ref={groupRef} />;
}
