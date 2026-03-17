import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { EffectFile } from "@/types/effect";
import { currentProjectAtom } from "@/store/project";
import { effectV2PlaybackAtom, selectedMagicEffectAtom } from "@/store/effect-v2";
import { FlightPathController, ArrivalInfo } from "./flight/FlightPathController";
import { EffectRenderer } from "./EffectRenderer";
import { HitEffectRenderer } from "./HitEffectRenderer";

const TARGET_CHARACTER_ID = 52;
const TARGET_OFFSET: THREE.Vector3Tuple = [0, 0, 8];

interface MagicEffectRendererProps {
  effFiles: EffectFile[];
}

/** Renders all .eff files associated with a magic effect entry, with flight path + target character. */
export function MagicEffectRenderer({ effFiles }: MagicEffectRendererProps) {
  const currentProject = useAtomValue(currentProjectAtom);
  const selected = useAtomValue(selectedMagicEffectAtom);
  const [targetGltfUri, setTargetGltfUri] = useState<string | null>(null);
  const prevUri = useRef<string | null>(null);

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
  const origin = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const target = useMemo(() => new THREE.Vector3(...TARGET_OFFSET), []);

  const playback = useAtomValue(effectV2PlaybackAtom);

  useFrame(() => {
    if (!targetGroupRef.current) return;
    if (!playback.playing) return;
    const x = Math.sin(playback.time * 1.2) * 8;
    targetGroupRef.current.position.set(x, TARGET_OFFSET[1], TARGET_OFFSET[2]);
    target.set(x, TARGET_OFFSET[1], TARGET_OFFSET[2]);
  });

  // Flight arrived at target — show hit effect
  const handleArrival = useCallback((info: ArrivalInfo) => {
    const hasHitEffect = selected?.result_effect &&
      selected.result_effect !== "0" &&
      selected.result_effect.trim() !== "";

    setArrivalInfo(info);

    if (hasHitEffect) {
      setHitActive(true);
    } else {
      // No hit effect — signal completion immediately
      setHitActive(false);
    }
  }, [selected]);

  // Hit effect finished playing
  const handleHitComplete = useCallback(() => {
    setHitActive(false);
    setArrivalInfo(null);
  }, []);

  return (
    <group>
      {/* Target character */}
      {targetGltfUri && (
        <Suspense fallback={null}>
          <group ref={targetGroupRef} position={TARGET_OFFSET}>
            <TargetModel uri={targetGltfUri} />
          </group>
        </Suspense>
      )}

      {/* Effects with flight path control */}
      <FlightPathController
        magicEntry={selected}
        origin={origin}
        target={target}
        onArrival={handleArrival}
        awaitingHitEffect={hitActive}
      >
        {effFiles.map((eff, i) => (
          <EffectRenderer key={i} effect={eff} />
        ))}
      </FlightPathController>

      {/* Hit/result effect — rendered at arrival position when active */}
      {hitActive && arrivalInfo && (
        <HitEffectRenderer
          particleEffectName={selected!.result_effect}
          arrival={arrivalInfo}
          onComplete={handleHitComplete}
        />
      )}
    </group>
  );
}

/** Simple glTF model renderer for the target character, rotated from Z-up to Y-up. */
function TargetModel({ uri }: { uri: string }) {
  const { scene } = useGLTF(uri);
  return <primitive object={scene} rotation={[-Math.PI / 2, 0, 0]} />;
}
