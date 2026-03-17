import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 16 — Dummy/placeholder particle system (bound to attachment points). */
export function DummySystem({ system: _system, children }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement dummy particle system
  });

  return <group ref={groupRef}>{children}</group>;
}
