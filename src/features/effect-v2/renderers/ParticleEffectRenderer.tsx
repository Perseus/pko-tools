import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { effectV2HiddenParticleSystemsAtom, effectV2HiddenParticleSubEffectsAtom } from "@/store/effect-v2";
import { useTimeSource } from "../TimeContext";
import { TriggeredClock } from "../TimeContext";
import { ParFile } from "@/types/effect-v2";
import { loadParFile } from "@/commands/effect";
import { EffectSubEffectVisibilityContext } from "./EffectRenderer";
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
import type { DummyLineSpan } from "./particles/dummyLineKinematics";
import { ParticleOpacityProvider } from "./particles/ParticleVisual";
import { CharacterModelParticleRenderer } from "./CharacterModelParticleRenderer";

interface ParticleEffectRendererProps {
  /** The .par filename (without extension). */
  particleEffectName: string;
  /** Optional project override for renderers embedded outside the effect-v2 workbench. */
  projectId?: string;
  /** Whether the particle effect should loop. */
  loop?: boolean;
  /** Optional runtime dummy1/dummy2 span for dummy-line particle systems. */
  dummyLineSpan?: DummyLineSpan | null;
  /** Optional runtime CMPPartCtrl::MoveTo emitter position. */
  emitterPositionRef?: MutableRefObject<THREE.Vector3 | null>;
  /** Optional runtime CMPPartCtrl::setDir direction for source modelDir systems. */
  sourceDirection?: THREE.Vector3;
  /** Multiplies per-particle alpha for embedded previews such as forge glow items. */
  opacityScale?: number;
  /** Whether effect-v2 workbench visibility atoms should affect this renderer. */
  respectHiddenState?: boolean;
  /** Called once when all particle systems have completed (non-looping only). */
  onComplete?: () => void;
}

interface TriggeredParticleHitEffect {
  id: number;
  particleEffectName: string;
  position: THREE.Vector3;
  sourceDirection?: THREE.Vector3;
}

/**
 * Loads and renders a .par particle file.
 * Routes each system to the correct particle type renderer.
 */
const EMPTY_SET = new Set<number>();

export function ParticleEffectRenderer({
  particleEffectName,
  projectId,
  loop = false,
  dummyLineSpan = null,
  emitterPositionRef,
  sourceDirection,
  opacityScale = 1,
  respectHiddenState = true,
  onComplete,
}: ParticleEffectRendererProps) {
  const currentProject = useAtomValue(currentProjectAtom);
  const hiddenSystemsState = useAtomValue(effectV2HiddenParticleSystemsAtom);
  const hiddenSubEffectsMapState = useAtomValue(effectV2HiddenParticleSubEffectsAtom);
  const hiddenSystems = respectHiddenState ? hiddenSystemsState : EMPTY_SET;
  const hiddenSubEffectsMap = respectHiddenState ? hiddenSubEffectsMapState : new Map<number, Set<number>>();
  const timeSource = useTimeSource();
  const groupRef = useRef<THREE.Group>(null);
  const sourceDirectionRef = useRef<THREE.Vector3 | null>(null);
  const [parData, setParData] = useState<ParFile | null>(null);
  const [triggeredHitEffects, setTriggeredHitEffects] = useState<TriggeredParticleHitEffect[]>([]);
  const nextHitEffectIdRef = useRef(0);
  sourceDirectionRef.current = sourceDirection ?? null;

  // Always point to the latest onComplete
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Tracks which system indices have fired onComplete
  const completedRef = useRef(new Set<string>());

  useEffect(() => {
    const resolvedProjectId = projectId ?? currentProject?.id;
    const particleEffectBaseName = getParticleEffectBaseName(particleEffectName);
    if (!resolvedProjectId || !particleEffectBaseName) {
      setParData(null);
      return;
    }

    let cancelled = false;

    async function load(loadProjectId: string) {
      try {
        const data = await loadParFile(loadProjectId, `${particleEffectBaseName}.par`) as ParFile;
        if (!cancelled) {
          setParData(data);
        }
      } catch {
        if (!cancelled) setParData(null);
      }
    }

    load(resolvedProjectId);
    return () => { cancelled = true; };
  }, [particleEffectName, projectId, currentProject]);

  // Reset completion tracking when par data changes
  useEffect(() => {
    completedRef.current = new Set();
    setTriggeredHitEffects([]);
  }, [parData]);

  // Match CMPPartCtrl::IsPlaying priority: systems first, strips second, models last.
  useEffect(() => {
    if (parData && getTrackedRenderableCount(parData) === 0) {
      onCompleteRef.current?.();
    }
  }, [parData]);

  const handleRenderableComplete = useCallback((key: string) => {
    if (!parData) return;
    completedRef.current.add(key);
    const trackedCount = getTrackedRenderableCount(parData);
    if (trackedCount > 0 && completedRef.current.size >= trackedCount) {
      onCompleteRef.current?.();
    }
  }, [parData]);

  const handleHitEffect = useCallback((
    particleEffectName: string,
    position: THREE.Vector3,
    hitSourceDirection?: THREE.Vector3,
  ) => {
    const baseName = getParticleEffectBaseName(particleEffectName);
    if (!baseName) return;
    setTriggeredHitEffects((current) => [
      ...current,
      {
        id: nextHitEffectIdRef.current++,
        particleEffectName: baseName,
        position: position.clone(),
        sourceDirection: hitSourceDirection?.clone(),
      },
    ]);
  }, []);

  useFrame(() => {
    if (!groupRef.current || !parData || !timeSource.playing) return;
  });

  if (!parData) return null;

  return (
    <ParticleOpacityProvider value={opacityScale}>
      <group ref={groupRef}>
        {parData.systems.map((system, i) => {
          if (hiddenSystems.has(i)) return null;
          const System = getSystemComponent(system.type);
          if (!System) return null;
          const subEffectHidden = hiddenSubEffectsMap.get(i) ?? EMPTY_SET;
          return (
            <EffectSubEffectVisibilityContext.Provider key={i} value={subEffectHidden}>
              <System
                system={system}
                index={i}
                loop={loop}
                dummyLineSpan={getSystemDummyLineSpan(system.type, dummyLineSpan)}
                emitterPositionRef={emitterPositionRef}
                sourceDirectionRef={sourceDirectionRef}
                onHitEffect={handleHitEffect}
                onComplete={() => handleRenderableComplete(`system:${i}`)}
              />
            </EffectSubEffectVisibilityContext.Provider>
          );
        })}
        {parData.strips.map((strip, i) => (
          <StripRenderer
            key={`strip-${i}`}
            strip={strip}
            dummyLineSpan={dummyLineSpan}
            loop={loop}
            onComplete={() => handleRenderableComplete(`strip:${i}`)}
          />
        ))}
        {parData.models.map((model, i) => (
          <CharacterModelParticleRenderer
            key={`character-model-${i}`}
            model={model}
            projectId={projectId}
            emitterPositionRef={emitterPositionRef}
            onComplete={() => handleRenderableComplete(`model:${i}`)}
          />
        ))}
        {triggeredHitEffects.map((hit) => (
          <group key={`hit-effect-${hit.id}`} position={hit.position}>
            <TriggeredClock>
              <ParticleEffectRenderer
                particleEffectName={hit.particleEffectName}
                projectId={projectId}
                loop={false}
                sourceDirection={hit.sourceDirection}
                respectHiddenState={false}
                onComplete={() => {
                  setTriggeredHitEffects((current) => current.filter((entry) => entry.id !== hit.id));
                }}
              />
            </TriggeredClock>
          </group>
        ))}
      </group>
    </ParticleOpacityProvider>
  );
}

export function getParticleEffectBaseName(particleEffectName: string): string {
  return particleEffectName.trim().replace(/\.par$/i, "");
}

function getTrackedRenderableCount(parData: ParFile): number {
  if (parData.systems.length > 0) return parData.systems.length;
  if (parData.strips.length > 0) return parData.strips.length;
  return parData.models.length;
}

function getSystemDummyLineSpan(type: number, span: DummyLineSpan | null): DummyLineSpan | null {
  if (type === ParticleType.DUMMY || type === ParticleType.LINE_SINGLE) {
    return span;
  }
  return null;
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

export const getParticleSystemComponentForTest = getSystemComponent;
