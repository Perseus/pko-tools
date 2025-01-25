import { characterGltfJsonAtom } from "@/store/character";
import { useAtom, useAtomValue } from "jotai";
import { Suspense, useEffect, useRef, useState } from "react";
import { useGLTF, OrbitControls, Grid, CameraControls, KeyboardControls, Environment, useAnimations} from '@react-three/drei';
import { Canvas, ObjectMap, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
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

function CharacterModel({gltfDataURI}: {gltfDataURI: string}) {
  const { scene, animations } = useGLTF(gltfDataURI);
  const anim= useAnimations(animations, scene);

  useEffect(() => {
    anim.mixer.clipAction(animations[0]).play();

    return () => {
      anim.mixer.stopAllAction();
      anim.mixer.uncacheRoot(scene);
    }
  }, [animations, scene, anim]);

  return <group rotation={[-Math.PI / 2, 0, 0]}>
    <primitive object={scene}/>
  </group>;

}

function Character() {
  const characterGltfJson = useAtomValue(characterGltfJsonAtom);
  const [gltfDataURI, setGltfDataURI] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const gltfDataURI = await jsonToDataURI(characterGltfJson || '');
      setGltfDataURI(gltfDataURI);
    })();
  }, [characterGltfJson]);

  if (!gltfDataURI) {
    return null;
  }

  return <> 
  <CharacterModel gltfDataURI={gltfDataURI}/>
  </>;
}

export default function CharacterWorkbench() {
   return <Canvas  style={{height: '100%', width: '100%'}} shadows camera={{position: [10, 12, 12], fov: 25 }}>
    <ambientLight intensity={1}/>
    <directionalLight position={[5,5,5]} castShadow/>
    <Environment background>
      <mesh scale={100}>
        <sphereGeometry args={[1, 16, 16]}/>
        <meshBasicMaterial color="#393939" side={THREE.BackSide}/>
      </mesh>
    </Environment>
    <Suspense fallback={<>Loading...</>}>
      <Character />
    </Suspense>
    <OrbitControls/>
    <gridHelper args={[60, 60, 60]} position-y=".01"/>
    <CameraControls />
  </Canvas>
}
