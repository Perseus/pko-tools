import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 7 — Wind-driven particles. */
export function WindSystem({ system: _system, children }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement wind particle simulation
  });

  return <group ref={groupRef}>{children}</group>;
}
