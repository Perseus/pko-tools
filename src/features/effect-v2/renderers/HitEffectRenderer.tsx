import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ArrivalInfo } from "./flight/FlightPathController";
import { ParticleEffectRenderer } from "./ParticleEffectRenderer";

interface HitEffectRendererProps {
  /** Name of the result .par file (from MagicSingleinfo.resultEffect). */
  particleEffectName: string;
  /** Position and direction captured at moment of flight arrival. */
  arrival: ArrivalInfo;
  /** Called when the hit effect's animation is complete. */
  onComplete: () => void;
}

/**
 * Renders a one-shot hit/result effect at the arrival position,
 * oriented along the incoming flight direction.
 * Loads its own .eff file, plays once, then signals completion.
 */
export function HitEffectRenderer({ particleEffectName, arrival, onComplete }: HitEffectRendererProps) {
  const groupRef = useRef<THREE.Group>(null);
  // Orient group to face along the incoming direction
  useEffect(() => {
    if (!groupRef.current) return
    const lookTarget = arrival.position.clone().add(arrival.direction);
    groupRef.current.lookAt(lookTarget);
  }, [arrival]);

  // TODO: replace with duration-based completion once hit effect animation is implemented
  useEffect(() => {
  }, []);

  return (
    <group ref={groupRef} position={arrival.position}>
      <ParticleEffectRenderer particleEffectName={particleEffectName} onComplete={onComplete} />
    </group>
  );
}
