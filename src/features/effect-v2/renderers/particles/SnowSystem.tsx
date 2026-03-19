import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 1 — Snow particles falling downward. */
export function SnowSystem({ system: _system, loop: _loop, onComplete }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => { onComplete?.(); }, []);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement snow particle simulation
  });

  return <group ref={groupRef} />;
}
