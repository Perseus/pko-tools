import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";

/** Type 4 — Ripple/wave effect expanding on a plane. */
export function RippleSystem({ system: _system, children }: ParticleSystemProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    // TODO: implement ripple particle simulation
  });

  return <group ref={groupRef}>{children}</group>;
}
