import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
import { ParFile, ParSystem } from "@/types/effect-v2";
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
import { EffectRenderer } from "./EffectRenderer";
import { useLoadEffect } from "../useLoadEffect";

interface ParticleEffectRendererProps {
  /** The .par filename (without extension). */
  particleEffectName: string;

  onComplete: () => void;
}

/**
 * Loads and renders a .par particle file.
 * Routes each system to the correct particle type renderer.
 */
export function ParticleEffectRenderer({ particleEffectName, onComplete }: ParticleEffectRendererProps) {
  const currentProject = useAtomValue(currentProjectAtom);
  const playback = useAtomValue(effectV2PlaybackAtom);
  const groupRef = useRef<THREE.Group>(null);
  const [parData, setParData] = useState<ParFile | null>(null);

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
          console.log(`[ParticleEffect] loaded ${particleEffectName}:`, data);
        }
      } catch {
        if (!cancelled) setParData(null);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [particleEffectName, currentProject]);

  useFrame(() => {
    if (!groupRef.current || !parData || !playback.playing) return;
  });

  if (!parData) return null;

  return (
    <group ref={groupRef}>
      {parData.systems.map((system, i) => {
        const System = getSystemComponent(system.type);
        if (!System) return null;
        return (
          <System key={i} system={system} index={i}>
            <ParticleVisual system={system} />
          </System>
        );
      })}
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

function ParticleVisual({ system }: { system: ParSystem }) {
  const effFiles = useLoadEffect(
    system.modelName.endsWith('.eff') ? [system.modelName] : []
  );

  if (effFiles.length > 0) {
    if (effFiles.length > 1) {
      console.error('has more than one effect, but rendering just one in ParticleEffectRenderer');
    }

    return <EffectRenderer effect={effFiles[0]} />;
  }

  return null;
}
