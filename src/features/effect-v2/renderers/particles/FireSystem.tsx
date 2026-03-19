import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 2 — Fire particles rising upward. */
export function FireSystem({ system: _system, loop: _loop, onComplete }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => { onComplete?.(); }, []);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement fire particle simulation
  });

  return <group ref={groupRef} />;
}
