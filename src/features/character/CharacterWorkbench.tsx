import { characterGltfJsonAtom, characterMetadataAtom, dummyEditModeAtom } from "@/store/character";
import { useAtomValue, useSetAtom } from "jotai";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useGLTF, OrbitControls,  CameraControls,  Environment, useAnimations } from '@react-three/drei';
import { Canvas, useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import { useControls, Leva } from 'leva';
import { extractBoundingSpheres, BoundingSphereIndicators } from './BoundingSphereIndicators';
import { SkeletonDebugHelpers } from './SkeletonDebugHelpers';
import { CharacterMetadataPanel } from './CharacterMetadataPanel';
import { extractMeshes, MeshHighlights, getUniqueMeshIndices } from './MeshHighlights';
import { useGltfResource } from "@/hooks/use-gltf-resource";
import { actionIds, ContextualActionMenu } from "@/features/actions";

const CHARACTER_CONTEXT_ACTIONS = [
  actionIds.characterExportGltf,
  actionIds.characterImportGltf,
];

function clearSceneHelpers(scene: THREE.Object3D) {
  scene.traverse((obj: THREE.Object3D) => {
    const helpers = obj.children.filter((c) => c.userData?.isHelper);
    helpers.forEach((h) => obj.remove(h));
  });
}

function toClipTime(frameIndex: number, totalKeyframes: number, duration: number): number {
  const denominator = Math.max(totalKeyframes - 1, 1);
  return (frameIndex / denominator) * duration;
}

function CharacterModel({ gltfDataURI }: { gltfDataURI: string }) {
  const { scene, animations } = useGLTF(gltfDataURI);
  const { mixer } = useAnimations(animations, scene);
  const primaryClip = animations[0] ?? null;
  const setDummyEditMode = useSetAtom(dummyEditModeAtom);
  const animationDuration = animations?.[0]?.duration || 1;
  const fps = 30;
  const totalKeyframes = Math.floor(animationDuration * fps);

  const [playing, setPlaying] = useState(false);
  const [currentKeyframe, setCurrentKeyframe] = useState(0);
  const timeAccumulator = useRef(0);

  // Extract bounding spheres and meshes from the loaded glTF scene
  const boundingSpheres = useMemo(() => extractBoundingSpheres(scene), [scene]);
  const meshes = useMemo(() => extractMeshes(scene), [scene]);
  const meshIndices = useMemo(() => getUniqueMeshIndices(meshes), [meshes]);
  
  // State for visible mesh indices (all visible by default)
  const [visibleMeshIndices, setVisibleMeshIndices] = useState<Set<number>>(() => new Set(meshIndices));
  
  // Update visible indices when meshes change
  useEffect(() => {
    setVisibleMeshIndices(new Set(meshIndices));
  }, [meshIndices]);

  const [, setAnimationControls] = useControls(() => ({
    play: {
      value: playing,
      label: 'Play animation',
      onChange: (v) => setPlaying(v),
    },
    keyframe: {
      value: currentKeyframe,
      min: 0,
      max: totalKeyframes,
      step: 1,
      label: 'Keyframe',
      onChange: v => {
        setCurrentKeyframe(v);
        const newTime = toClipTime(v, totalKeyframes, animationDuration);
        mixer.setTime(newTime);

        timeAccumulator.current = 0;
      }
    }
  }));

  const { showBoundingSpheres, showMeshHighlights, showBones, showDummies, editDummies } = useControls('Debug', {
    showBoundingSpheres: {
      value: false,
      label: 'Show Bounding Spheres',
    },
    showMeshHighlights: {
      value: false,
      label: 'Show Mesh Outlines',
    },
    showBones: {
      value: false,
      label: 'Show Bones',
    },
    showDummies: {
      value: false,
      label: 'Show Dummies',
    },
    editDummies: {
      value: false,
      label: 'Edit Dummies',
    },
  });

  // Sync editDummies leva control with the jotai atom; reset on unmount (model switch)
  useEffect(() => {
    setDummyEditMode((showDummies as boolean) && (editDummies as boolean));
    return () => setDummyEditMode(false);
  }, [showDummies, editDummies, setDummyEditMode]);
  
  // Dynamic mesh visibility controls - create toggle for each mesh
  const meshVisibilityConfig = useMemo(() => {
    if (meshIndices.length <= 1) return {};
    
    const config: Record<string, any> = {};
    meshIndices.forEach((idx) => {
      config[`mesh${idx}`] = {
        value: true,
        label: `Mesh ${idx}`,
        onChange: (visible: boolean) => {
          setVisibleMeshIndices(prev => {
            const next = new Set(prev);
            if (visible) {
              next.add(idx);
            } else {
              next.delete(idx);
            }
            return next;
          });
        }
      };
    });
    return config;
  }, [meshIndices]);
  
  // Only show mesh parts folder if there are multiple meshes
  useControls('Mesh Parts', meshVisibilityConfig, { collapsed: true }, [meshVisibilityConfig]);


  useFrame((_state, delta) => {
    if (playing) {
      timeAccumulator.current += delta;
      const keyframeDuration = 1/fps;

      if (timeAccumulator.current >= keyframeDuration) {
        const framesToAdvance = Math.floor(timeAccumulator.current / keyframeDuration);
        timeAccumulator.current = timeAccumulator.current % keyframeDuration;

        setCurrentKeyframe(prev => {
          let next = prev + framesToAdvance;
          if (next >= totalKeyframes) {
            next = next % totalKeyframes
          }

          setAnimationControls({
            keyframe: next
          });

          const newTime = toClipTime(next, totalKeyframes, animationDuration);
          mixer.setTime(newTime);

          return next;
        })
      }
    } else {
      const newTime = toClipTime(currentKeyframe, totalKeyframes, animationDuration);
      mixer.setTime(newTime);
    }
  });


  useEffect(() => {
    if (!primaryClip) {
      return;
    }
    const action = mixer.clipAction(primaryClip, scene);
    action.reset().play();

    return () => {
      action.stop();
      // Remove debug helper meshes from the scene tree before uncaching.
      clearSceneHelpers(scene);

      try {
        mixer.stopAllAction();
      } catch {
        // ignore teardown race
      }
      try {
        mixer.uncacheClip(primaryClip);
      } catch {
        // ignore teardown race
      }
      try {
        mixer.uncacheRoot(scene);
      } catch {
        // Non-fatal: model switches can race with internal mixer caches
      }
      timeAccumulator.current = 0;
      setPlaying(false);
      setCurrentKeyframe(0);
      setAnimationControls({
        play: false,
        keyframe: 0
      });
    }
  }, [mixer, primaryClip, scene, setAnimationControls]);

  return <>
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={scene} />
      <BoundingSphereIndicators
        spheres={boundingSpheres}
        visible={showBoundingSpheres}
        scene={scene}
        visibleMeshIndices={visibleMeshIndices}
      />
      <MeshHighlights
        scene={scene}
        visible={showMeshHighlights}
        visibleMeshIndices={visibleMeshIndices}
      />
    </group>
    <SkeletonDebugHelpers
      scene={scene}
      showBones={showBones}
      showDummies={showDummies}
    />
  </>;

}

function Character() {
  const characterGltfJson = useAtomValue(characterGltfJsonAtom);
  const gltfDataURI = useGltfResource(characterGltfJson);

  useEffect(() => {
    return () => {
      if (gltfDataURI) {
        useGLTF.clear(gltfDataURI);
      }
    };
  }, [gltfDataURI]);

  if (!gltfDataURI) {
    return null;
  }

  return <>
    <CharacterModel key={gltfDataURI} gltfDataURI={gltfDataURI} />
  </>;
}

export default function CharacterWorkbench() {
  const characterMetadata = useAtomValue(characterMetadataAtom);

  return <div className="h-full w-full relative">
    <Leva collapsed={false} />
    <CharacterMetadataPanel metadata={characterMetadata} />
    <ContextualActionMenu
      actionIds={CHARACTER_CONTEXT_ACTIONS}
      requireShiftKey
      className="h-full w-full"
    >
      <Canvas style={{ height: '100%', width: '100%' }} shadows camera={{ position: [10, 12, 12], fov: 25 }}>
        <ambientLight intensity={1} />
        <directionalLight position={[5, 5, 5]} castShadow />
        <Environment background>
          <mesh scale={100}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#393939" side={THREE.BackSide} />
          </mesh>
        </Environment>
        <Suspense fallback={<>Loading...</>}>
          <Character />
        </Suspense>
        <OrbitControls />
        <gridHelper args={[60, 60, 60]} position-y=".01" />
        <CameraControls />
      </Canvas>
    </ContextualActionMenu>
  </div>;
}
