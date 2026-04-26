import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { useTimeSource } from "../TimeContext";
import { ParFile } from "@/types/effect-v2";
import { loadParFile } from "@/commands/effect";
import { ParticleSystemProps, ParticleType } from "./particles/types";
import { SnowSystem } from "./particles/SnowSystem";
import { FireSystem } from "./particles/FireSystem";
import { BlastSystem } from "./particles/BlastSystem";
import { RippleSystem } from "./particles/RippleSystem";
import { ModelSystem } from "./particles/ModelSystem";
import { StripSystem } from "./particles/StripSystem";
import { WindSystem } from "./particles/WindSystem";
import { ArrowSystem } from "./particles/ArrowSystem";
import { RoundSystem } from "./particles/RoundSystem";
import { Blast2System } from "./particles/Blast2System";
import { Blast3System } from "./particles/Blast3System";
import { ShrinkSystem } from "./particles/ShrinkSystem";
import { ShadeSystem } from "./particles/ShadeSystem";
import { RangeSystem } from "./particles/RangeSystem";
import { Range2System } from "./particles/Range2System";
import { DummySystem } from "./particles/DummySystem";
import { LineSingleSystem } from "./particles/LineSingleSystem";
import { LineRoundSystem } from "./particles/LineRoundSystem";
import { StripRenderer } from "./StripRenderer";

interface ParticleEffectRendererProps {
  /** The .par filename (without extension). */
  particleEffectName: string;
  /** Whether the particle effect should loop. */
  loop?: boolean;
  /** Called once when all particle systems have completed (non-looping only). */
  onComplete?: () => void;
}

/**
 * Loads and renders a .par particle file.
 * Routes each system to the correct particle type renderer.
 */
export function ParticleEffectRenderer({ particleEffectName, loop = false, onComplete }: ParticleEffectRendererProps) {
  const currentProject = useAtomValue(currentProjectAtom);
  const timeSource = useTimeSource();
  const groupRef = useRef<THREE.Group>(null);
  const [parData, setParData] = useState<ParFile | null>(null);

  // Always point to the latest onComplete
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Tracks which system indices have fired onComplete
  const completedRef = useRef(new Set<number>());

  useEffect(() => {
    if (!currentProject || !particleEffectName) {
      setParData(null);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const data = await loadParFile(currentProject!.id, `${particleEffectName}.par`) as ParFile;
        if (!cancelled) {
          setParData(data);
        }
      } catch {
        if (!cancelled) setParData(null);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [particleEffectName, currentProject]);

  // Reset completion tracking when par data changes
  useEffect(() => {
    completedRef.current = new Set();
  }, [parData]);

  // Edge case: loaded but no systems
  useEffect(() => {
    if (parData && parData.systems.length === 0) {
      onCompleteRef.current?.();
    }
  }, [parData]);

  const handleSystemComplete = useCallback((idx: number) => {
    if (!parData) return;
    completedRef.current.add(idx);
    if (completedRef.current.size >= parData.systems.length) {
      onCompleteRef.current?.();
    }
  }, [parData]);

  useFrame(() => {
    if (!groupRef.current || !parData || !timeSource.playing) return;
  });

  if (!parData) return null;

  return (
    <group ref={groupRef}>
      {parData.systems.map((system, i) => {
        const System = getSystemComponent(system.type);
        if (!System) return null;
        return (
          <System key={i} system={system} index={i} loop={loop} onComplete={() => handleSystemComplete(i)} />
        );
      })}
      {parData.strips.map((strip, i) => (
        <StripRenderer key={`strip-${i}`} strip={strip} />
      ))}
    </group>
  );
}

function getSystemComponent(type: number): React.ComponentType<ParticleSystemProps> | null {
  switch (type) {
    case ParticleType.SNOW: return SnowSystem;
    case ParticleType.FIRE: return FireSystem;
    case ParticleType.BLAST: return BlastSystem;
    case ParticleType.RIPPLE: return RippleSystem;
    case ParticleType.MODEL: return ModelSystem;
    case ParticleType.STRIP: return StripSystem;
    case ParticleType.WIND: return WindSystem;
    case ParticleType.ARROW: return ArrowSystem;
    case ParticleType.ROUND: return RoundSystem;
    case ParticleType.BLAST2: return Blast2System;
    case ParticleType.BLAST3: return Blast3System;
    case ParticleType.SHRINK: return ShrinkSystem;
    case ParticleType.SHADE: return ShadeSystem;
    case ParticleType.RANGE: return RangeSystem;
    case ParticleType.RANGE2: return Range2System;
    case ParticleType.DUMMY: return DummySystem;
    case ParticleType.LINE_SINGLE: return LineSingleSystem;
    case ParticleType.LINE_ROUND: return LineRoundSystem;
    default:
      console.warn(`[ParticleEffect] Unknown particle type: ${type}`);
      return null;
  }
}
