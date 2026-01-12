import { characterGltfJsonAtom, characterMetadataAtom } from "@/store/character";
import {  useAtomValue } from "jotai";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useGLTF, OrbitControls,  CameraControls,  Environment, useAnimations } from '@react-three/drei';
import { Canvas, useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import { useControls, Leva } from 'leva';
import { extractBoundingSpheres, BoundingSphereIndicators } from './BoundingSphereIndicators';
import { SkeletonDebugHelpers } from './SkeletonDebugHelpers';
import { CharacterMetadataPanel } from './CharacterMetadataPanel';

function jsonToDataURI(json: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {

      if (!json) {
        reject(new Error('No JSON provided'));
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = (error) => {
        reject(error);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('error from jsonToDataURI', error);
      reject(error);
    }
  });
}

function CharacterModel({ gltfDataURI }: { gltfDataURI: string }) {
  const { scene, animations } = useGLTF(gltfDataURI);
  const { actions, mixer } = useAnimations(animations, scene);
  const animationDuration = animations?.[0]?.duration || 1;
  const fps = 30;
  const totalKeyframes = Math.floor(animationDuration * fps);

  const [playing, setPlaying] = useState(false);
  const [currentKeyframe, setCurrentKeyframe] = useState(0);
  const timeAccumulator = useRef(0);

  // Extract bounding spheres from the loaded glTF scene
  const boundingSpheres = useMemo(() => extractBoundingSpheres(scene), [scene]);

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
        const newTime = (v / (totalKeyframes - 1)) * animationDuration;
        mixer.setTime(newTime);

        timeAccumulator.current = 0;
      }
    }
  }));

  const { showBoundingSpheres, showBones, showDummies, ghostMeshOpacity } = useControls('Debug', {
    showBoundingSpheres: {
      value: false,
      label: 'Show Bounding Spheres',
    },
    showBones: {
      value: false,
      label: 'Show Bones',
    },
    showDummies: {
      value: false,
      label: 'Show Dummies',
    },
    ghostMeshOpacity: {
      value: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'Ghost Mesh Opacity',
    },
  });


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

          const newTime = (next / (totalKeyframes - 1)) * animationDuration;
          mixer.setTime(newTime);

          return next;
        })
      }
    } else {
      const newTime = (currentKeyframe / (totalKeyframes - 1)) * animationDuration;
      mixer.setTime(newTime);
    }
  });


  useEffect(() => {
    if (animations.length > 0) {
      const action = actions[animations[0].name];
      if (action) {
        action.reset().play();
      }
    }

    return () => {
      mixer.stopAllAction();
      animations.forEach(clip => mixer.uncacheClip(clip));
      mixer.uncacheRoot(scene);
      setAnimationControls({
        play: false,
        keyframe: 0
      });
    }
  }, [animations, actions, scene, mixer]);

  // Apply ghost mode to mesh materials when showing bones/dummies
  useEffect(() => {
    const originalOpacities = new Map<THREE.Material, { opacity: number; transparent: boolean }>();
    const shouldGhost = showBones || showDummies;

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];

        materials.forEach((material) => {
          if (!originalOpacities.has(material)) {
            originalOpacities.set(material, {
              opacity: material.opacity,
              transparent: material.transparent
            });
          }

          if (shouldGhost) {
            material.transparent = true;
            material.opacity = ghostMeshOpacity;
          } else {
            const original = originalOpacities.get(material);
            if (original) {
              material.opacity = original.opacity;
              material.transparent = original.transparent;
            }
          }
          material.needsUpdate = true;
        });
      }
    });
  }, [scene, showBones, showDummies, ghostMeshOpacity]);


  return <>
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={scene} />
      <BoundingSphereIndicators
        spheres={boundingSpheres}
        visible={showBoundingSpheres}
        scene={scene}
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
  const [gltfDataURI, setGltfDataURI] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!characterGltfJson) {
        return;
      }

      setGltfDataURI(null);
      const gltfDataURI = await jsonToDataURI(characterGltfJson || '');
      setGltfDataURI(gltfDataURI);
    })();
  }, [characterGltfJson]);

  if (!gltfDataURI) {
    return null;
  }

  return <>
    <CharacterModel gltfDataURI={gltfDataURI} />
  </>;
}

export default function CharacterWorkbench() {
  const characterMetadata = useAtomValue(characterMetadataAtom);

  return <div className="h-full w-full relative">
    <Leva collapsed={false} />
    <CharacterMetadataPanel metadata={characterMetadata} />
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
  </div>;
}
