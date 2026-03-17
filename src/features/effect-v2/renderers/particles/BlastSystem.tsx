import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 3 — Blast particles exploding outward. */
export function BlastSystem({ system: _system, children }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement blast particle simulation
  });

  return <group ref={groupRef}>{children}</group>;
}
