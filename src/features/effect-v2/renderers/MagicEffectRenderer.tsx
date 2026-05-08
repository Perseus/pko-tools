import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { EffectFile } from "@/types/effect";
import { MagicSingleEntry } from "@/types/effect-v2";
import { currentProjectAtom } from "@/store/project";
import { getFrameDurations } from "@/features/effect/animation";
import { useEffectModelDummies } from "@/features/effect/useEffectModel";
import { useTimeSource } from "../TimeContext";
import { FlightPathController, ArrivalInfo } from "./flight/FlightPathController";
import { EffectRenderer } from "./EffectRenderer";
import { HitEffectRenderer } from "./HitEffectRenderer";
import { ParticleEffectRenderer } from "./ParticleEffectRenderer";
import {
  computeMagicParticleDummyAnchor,
  getMagicParticleBaseName,
  getMagicParticleDummyModelName,
  getMagicParticleDummySubEffect,
} from "./magicDummyKinematics";
import { GLTF_Y_UP_TO_PKO_Z_UP_ROTATION } from "../zUpScene";

const TARGET_CHARACTER_ID = 52;
const TARGET_OFFSET: THREE.Vector3Tuple = [0, 8, 0];
const TARGET_AIM_HEIGHT = 1;

interface MagicEffectRendererProps {
  effFiles: EffectFile[];
  /** The magic entry to render. Passed as prop so MagicGroupRenderer can supply per-phase entries. */
  magicEntry: MagicSingleEntry | null;
  origin?: THREE.Vector3;
  target?: THREE.Vector3;
  targetVisual?: THREE.Vector3;
  showTarget?: boolean;
  animateTarget?: boolean;
  onComplete?: () => void;
}

/** Renders all .eff files associated with a magic effect entry, with flight path + target character. */
export function MagicEffectRenderer({
  effFiles,
  magicEntry: selected,
  origin: originOverride,
  target: targetOverride,
  targetVisual: targetVisualOverride,
  showTarget = true,
  animateTarget = true,
  onComplete: _onComplete,
}: MagicEffectRendererProps) {
  const currentProject = useAtomValue(currentProjectAtom);
  const [targetGltfUri, setTargetGltfUri] = useState<string | null>(null);
  const prevUri = useRef<string | null>(null);
  const hasHitEffect = useMemo(() => {
    const resultEffect = selected?.result_effect?.trim();
    return Boolean(resultEffect && resultEffect !== "0");
  }, [selected?.result_effect]);
  const flightEffectDuration = useMemo(() => computeMagicEffectDuration(effFiles), [effFiles]);

  // Hit effect state
  const [hitActive, setHitActive] = useState(false);
  const [arrivalInfo, setArrivalInfo] = useState<ArrivalInfo | null>(null);

  // Load target character model
  useEffect(() => {
    if (!currentProject) return;
    let cancelled = false;

    async function loadTarget() {
      try {
        const gltfJson = await invoke<string>("load_character", {
          projectId: currentProject!.id,
          characterId: TARGET_CHARACTER_ID,
        });
        if (cancelled) return;

        const blob = new Blob([gltfJson], { type: "model/gltf+json" });
        const uri = URL.createObjectURL(blob);

        if (prevUri.current) {
          useGLTF.clear(prevUri.current);
          URL.revokeObjectURL(prevUri.current);
        }
        prevUri.current = uri;
        setTargetGltfUri(uri);
      } catch (err) {
        console.warn("[MagicEffect] Failed to load target character:", err);
      }
    }

    loadTarget();
    return () => { cancelled = true; };
  }, [currentProject]);

  useEffect(() => {
    return () => {
      if (prevUri.current) {
        useGLTF.clear(prevUri.current);
        URL.revokeObjectURL(prevUri.current);
      }
    };
  }, []);

  const targetGroupRef = useRef<THREE.Group>(null);
  const origin = useMemo(
    () => originOverride?.clone() ?? new THREE.Vector3(0, 0, 0),
    [originOverride],
  );
  const targetVisual = useMemo(
    () => targetVisualOverride?.clone() ?? targetOverride?.clone() ?? new THREE.Vector3(...TARGET_OFFSET),
    [targetOverride, targetVisualOverride],
  );
  const target = useMemo(() => {
    if (targetOverride) return targetOverride.clone();
    return new THREE.Vector3(TARGET_OFFSET[0], TARGET_OFFSET[1], TARGET_OFFSET[2] + TARGET_AIM_HEIGHT);
  }, [targetOverride]);
  const primaryDummyModelName = useMemo(
    () => getMagicParticleDummyModelName(effFiles),
    [effFiles],
  );
  const primaryDummySubEffect = useMemo(
    () => getMagicParticleDummySubEffect(effFiles),
    [effFiles],
  );
  const primaryDummyPoints = useEffectModelDummies(primaryDummyModelName, currentProject?.id);

  const timeSource = useTimeSource();
  const mainEffectNodes = effFiles.map((eff, i) => (
    <EffectRenderer key={`effect-${i}`} effect={eff} />
  ));
  const trailEffectNodes = effFiles.map((eff, i) => (
    <EffectRenderer key={`trail-effect-${i}`} effect={eff} />
  ));
  const magicParticleNodes = selected?.particles.map((particle, i) => {
    const particleEffectName = getMagicParticleBaseName(particle);
    const dummyId = selected.dummies[i];
    if (!particleEffectName || dummyId === undefined || dummyId < 0) return null;
    return (
      <MagicParticleController
        key={`particle-${i}`}
        particleEffectName={particleEffectName}
        dummyId={dummyId}
        dummySubEffect={primaryDummySubEffect}
        dummyPoints={primaryDummyPoints}
      />
    );
  });
  const worldAlignedParticleNodes = selected?.particles.map((particle, i) => {
    const particleEffectName = getMagicParticleBaseName(particle);
    const dummyId = selected.dummies[i];
    if (!particleEffectName || (dummyId !== undefined && dummyId >= 0)) return null;
    return (
      <MagicParticleController
        key={`particle-${i}`}
        particleEffectName={particleEffectName}
        dummyId={dummyId}
        dummySubEffect={primaryDummySubEffect}
        dummyPoints={primaryDummyPoints}
      />
    );
  });

  useFrame(() => {
    if (!targetGroupRef.current) return;
    if (!timeSource.playing) return;
    if (!animateTarget) return;
    const x = Math.sin(timeSource.getTime() * 1.2) * 8;
    targetGroupRef.current.position.set(x, TARGET_OFFSET[1], TARGET_OFFSET[2]);
    targetVisual.set(x, TARGET_OFFSET[1], TARGET_OFFSET[2]);
    target.set(x, TARGET_OFFSET[1], TARGET_OFFSET[2] + TARGET_AIM_HEIGHT);
  });

  // Hit effect finished playing
  const handleHitComplete = useCallback(() => {
    setHitActive(false);
    setArrivalInfo(null);
  }, []);

  // Flight arrived at target — show hit effect
  const handleArrival = useCallback((info: ArrivalInfo) => {
    setArrivalInfo(info);

    if (hasHitEffect) {
      setHitActive(true);
    } else {
      // No hit effect — signal completion immediately
      handleHitComplete();
    }
  }, [handleHitComplete, hasHitEffect]);

  return (
    <group>
      {/* Target character */}
      {showTarget && targetGltfUri && (
        <Suspense fallback={null}>
          <group ref={targetGroupRef} position={targetVisual}>
            <TargetModel uri={targetGltfUri} />
          </group>
        </Suspense>
      )}

      {/* Hit/result effect uses the same root coordinate space as the flight path. */}
      {hitActive && arrivalInfo && (
        <HitEffectRenderer
          particleEffectName={selected!.result_effect}
          arrival={arrivalInfo}
          loop={false}
          onComplete={handleHitComplete}
        />
      )}

      {/* Effects with flight path control */}
      <FlightPathController
        magicEntry={selected}
        origin={origin}
        target={target}
        onArrival={handleArrival}
        awaitingHitEffect={hitActive}
        hasHitEffect={hasHitEffect}
        effectDuration={flightEffectDuration}
        trailChildren={trailEffectNodes}
        worldAlignedChildren={worldAlignedParticleNodes}
      >
        {mainEffectNodes}
        {magicParticleNodes}
      </FlightPathController>

    </group>
  );
}

function computeMagicEffectDuration(effFiles: EffectFile[]): number {
  return effFiles.reduce((maxDuration, effect) => {
    const effectDuration = effect.subEffects.reduce((subMax, subEffect) => {
      const duration = getFrameDurations(subEffect).reduce(
        (total, frameTime) => total + frameTime,
        0,
      );
      return Math.max(subMax, duration);
    }, 0);
    return Math.max(maxDuration, effectDuration);
  }, 0);
}

/** Simple glTF model renderer for the target character, rotated from glTF Y-up into the z-up effect scene. */
function TargetModel({ uri }: { uri: string }) {
  const { scene } = useGLTF(uri);
  return <group>
    <primitive object={scene} rotation={GLTF_Y_UP_TO_PKO_Z_UP_ROTATION} />
  </group>
}

function MagicParticleController({
  particleEffectName,
  dummyId,
  dummySubEffect,
  dummyPoints,
}: {
  particleEffectName: string;
  dummyId: number | undefined;
  dummySubEffect: EffectFile["subEffects"][number] | null;
  dummyPoints: { id: number; position: THREE.Vector3 }[];
}) {
  const emitterPositionRef = useRef<THREE.Vector3 | null>(null);
  const timeSource = useTimeSource();

  useFrame(() => {
    const anchor = computeMagicParticleDummyAnchor(
      dummySubEffect,
      dummyPoints,
      dummyId,
      timeSource.getTime(),
      timeSource.loop,
    );
    if (anchor) {
      if (!emitterPositionRef.current) {
        emitterPositionRef.current = anchor.clone();
      } else {
        emitterPositionRef.current.copy(anchor);
      }
    } else {
      emitterPositionRef.current = null;
    }
  });

  return (
    <ParticleEffectRenderer
      particleEffectName={particleEffectName}
      loop={false}
      emitterPositionRef={emitterPositionRef}
    />
  );
}

export {
  getMagicParticleBaseName,
  getMagicParticleDummyModelName,
  getMagicParticleDummyPosition,
} from "./magicDummyKinematics";
