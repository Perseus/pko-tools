import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 5 — 3D model used as particle (e.g., debris chunks). */
export function ModelSystem({ system: _system, children }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement model particle simulation
  });

  return <group ref={groupRef}>{children}</group>;
}
