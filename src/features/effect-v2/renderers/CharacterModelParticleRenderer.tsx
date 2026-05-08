import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { getCharacterActions } from "@/commands/character";
import type { CharacterAction } from "@/types/character";
import type { ParChaModel } from "@/types/effect-v2";
import { getThreeJSBlendFromD3D } from "../helpers";
import { useTimeSource } from "../TimeContext";
import {
  applyTextureSampling,
  D3DTEXF_POINT,
} from "@/features/effect/pkoStateEmulation";
import {
  computeCharacterModelClipTime,
  findCharacterModelAction,
  isCharacterModelPlaying,
} from "./characterModelKinematics";
import { GLTF_Y_UP_TO_PKO_Z_UP_ROTATION } from "../zUpScene";

interface CharacterModelParticleRendererProps {
  model: ParChaModel;
  projectId?: string;
  emitterPositionRef?: MutableRefObject<THREE.Vector3 | null>;
  onComplete?: () => void;
}

export function CharacterModelParticleRenderer({
  model,
  projectId,
  emitterPositionRef,
  onComplete,
}: CharacterModelParticleRendererProps) {
  const currentProject = useAtomValue(currentProjectAtom);
  const resolvedProjectId = projectId ?? currentProject?.id;
  const [uri, setUri] = useState<string | null>(null);
  const [actions, setActions] = useState<CharacterAction[]>([]);
  const uriRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resolvedProjectId || model.id <= 0) {
      setUri(null);
      setActions([]);
      return;
    }

    let cancelled = false;
    const loadProjectId = resolvedProjectId;

    async function load() {
      try {
        const [gltfJson, loadedActions] = await Promise.all([
          invoke<string>("load_character", {
            projectId: loadProjectId,
            characterId: model.id,
          }),
          getCharacterActions(loadProjectId, model.id).catch(() => [] as CharacterAction[]),
        ]);
        if (cancelled) return;

        const blob = new Blob([gltfJson], { type: "model/gltf+json" });
        const nextUri = URL.createObjectURL(blob);
        clearCharacterGltf(uriRef.current);
        uriRef.current = nextUri;
        setUri(nextUri);
        setActions(loadedActions);
      } catch {
        if (!cancelled) {
          clearCharacterGltf(uriRef.current);
          uriRef.current = null;
          setUri(null);
          setActions([]);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [resolvedProjectId, model.id]);

  useEffect(() => {
    return () => {
      clearCharacterGltf(uriRef.current);
      uriRef.current = null;
    };
  }, []);

  if (!uri) return null;

  return (
    <Suspense fallback={null}>
      <CharacterModelParticleInstance
        uri={uri}
        model={model}
        actions={actions}
        emitterPositionRef={emitterPositionRef}
        onComplete={onComplete}
      />
    </Suspense>
  );
}

interface CharacterModelParticleInstanceProps {
  uri: string;
  model: ParChaModel;
  actions: CharacterAction[];
  emitterPositionRef?: MutableRefObject<THREE.Vector3 | null>;
  onComplete?: () => void;
}

function CharacterModelParticleInstance({
  uri,
  model,
  actions,
  emitterPositionRef,
  onComplete,
}: CharacterModelParticleInstanceProps) {
  const { scene, animations } = useGLTF(uri);
  const { mixer, actions: animationActions } = useAnimations(animations, scene);
  const timeSource = useTimeSource();
  const groupRef = useRef<THREE.Group>(null);
  const selectedAction = useMemo(
    () => findCharacterModelAction(actions, model),
    [actions, model],
  );
  const completedRef = useRef(false);

  useEffect(() => {
    const firstAction = animationActions
      ? Object.values(animationActions).find(Boolean)
      : null;
    firstAction?.reset().play();
  }, [animationActions]);

  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      const nextMaterials = materials.map((oldMaterial) =>
        buildCharacterModelMaterial(oldMaterial, model)
      );
      obj.material = Array.isArray(obj.material) ? nextMaterials : nextMaterials[0];
    });
  }, [scene, model]);

  useFrame(() => {
    if (!timeSource.playing) return;
    if (emitterPositionRef) {
      const emitter = emitterPositionRef.current;
      if (groupRef.current && emitter) {
        groupRef.current.position.copy(emitter);
      } else if (groupRef.current) {
        groupRef.current.position.set(0, 0, 0);
      } else if (emitter) {
        scene.position.copy(emitter);
      } else {
        scene.position.set(0, 0, 0);
      }
    }
    const elapsed = timeSource.getTime();
    if (!isCharacterModelPlaying(model, selectedAction, elapsed)) {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }
    mixer.setTime(computeCharacterModelClipTime(model, selectedAction, elapsed));
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} rotation={GLTF_Y_UP_TO_PKO_Z_UP_ROTATION} />
    </group>
  );
}

function buildCharacterModelMaterial(
  source: THREE.Material,
  model: ParChaModel,
): THREE.MeshBasicMaterial {
  const old = source as THREE.MeshStandardMaterial;
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(model.color[0], model.color[1], model.color[2]),
    opacity: model.color[3],
    transparent: true,
    depthWrite: true,
    blending: THREE.CustomBlending,
    blendSrc: getThreeJSBlendFromD3D(model.srcBlend),
    blendDst: getThreeJSBlendFromD3D(model.destBlend),
    side: THREE.BackSide,
    fog: false,
    toneMapped: false,
  });
  if (old.map) {
    applyTextureSampling(old.map, {
      minFilter: D3DTEXF_POINT,
      magFilter: D3DTEXF_POINT,
    });
    material.map = old.map;
  }
  return material;
}

function clearCharacterGltf(uri: string | null) {
  if (!uri) return;
  const maybeUseGLTF = useGLTF as typeof useGLTF & { clear?: (url: string) => void };
  maybeUseGLTF.clear?.(uri);
  URL.revokeObjectURL(uri);
}
