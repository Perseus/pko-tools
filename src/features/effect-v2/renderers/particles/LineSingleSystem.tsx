import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 17 — Single line particle emission. */
export function LineSingleSystem({ system: _system, loop: _loop, onComplete }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => { onComplete?.(); }, []);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement line single particle simulation
  });

  return <group ref={groupRef} />;
}
