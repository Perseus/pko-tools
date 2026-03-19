import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ArrivalInfo } from "./flight/FlightPathController";
import { ParticleEffectRenderer } from "./ParticleEffectRenderer";

interface HitEffectRendererProps {
  /** Name of the result .par file (from MagicSingleinfo.resultEffect). */
  particleEffectName: string;
  /** Position and direction captured at moment of flight arrival. */
  arrival: ArrivalInfo;
  /** Whether the particle effect should loop. */
  loop?: boolean;
  /** Called when the hit effect's animation is complete. */
  onComplete: () => void;
}

/**
 * Renders a one-shot hit/result effect at the arrival position,
 * oriented along the incoming flight direction.
 * Delegates completion tracking to ParticleEffectRenderer.
 */
export function HitEffectRenderer({ particleEffectName, arrival, loop, onComplete }: HitEffectRendererProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Orient group to face along the incoming direction
  /*useEffect(() => {
    if (!groupRef.current) return;
    const lookTarget = arrival.position.clone().add(arrival.direction);
    groupRef.current.lookAt(lookTarget);
  }, [arrival]);*/

  return (
    <group ref={groupRef}>
      <ParticleEffectRenderer particleEffectName={particleEffectName} loop={loop} onComplete={onComplete} />
    </group>
  );
}
