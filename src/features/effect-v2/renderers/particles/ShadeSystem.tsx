import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 13 — Shade/shadow projection particles. */
export function ShadeSystem({ system: _system, children }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement shade particle simulation
  });

  return <group ref={groupRef}>{children}</group>;
}
