import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getThreeJSBlendFromD3D } from "../helpers";
import { useEffectTexture } from "../useEffectTexture";
import {
  applyTextureSampling,
  composePkoRenderState,
} from "@/features/effect/pkoStateEmulation";
import {
  advanceLinkTextureFrame,
  buildLinkBeamGeometry,
  LinkTextureFrameState,
  threeToPko,
} from "./linkBeamKinematics";

interface LinkBeamRendererProps {
  start: THREE.Vector3;
  end: THREE.Vector3;
  textureBaseName: string;
  textureCount?: number;
}

/**
 * Source-derived CMPLink beam renderer.
 *
 * CMPLink is not serialized by CMPPartCtrl .par files in the reference client;
 * this component exists for runtime link beams if a caller/table is found.
 */
export function LinkBeamRenderer({
  start,
  end,
  textureBaseName,
  textureCount = 4,
}: LinkBeamRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const frameStateRef = useRef<LinkTextureFrameState>({ index: 0, time: 0 });
  const [textureFrame, setTextureFrame] = useState(frameStateRef.current.index);
  const texture = useEffectTexture(`${textureBaseName}${textureFrame}`);

  const material = useMemo(() => (
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: getThreeJSBlendFromD3D(5),
      blendDst: getThreeJSBlendFromD3D(2),
      map: null,
      color: new THREE.Color(1, 1, 1),
      fog: false,
      toneMapped: false,
    })
  ), []);

  useEffect(() => {
    applyTextureSampling(texture, composePkoRenderState(0));
    material.map = texture;
    material.needsUpdate = true;
  }, [texture, material]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const nextFrame = advanceLinkTextureFrame(frameStateRef.current, delta, textureCount);
    frameStateRef.current = nextFrame;
    if (nextFrame.index !== textureFrame) {
      setTextureFrame(nextFrame.index);
    }

    const geometry = buildLinkBeamGeometry({
      startPko: threeToPko(start),
      endPko: threeToPko(end),
      eyePko: threeToPko(state.camera.position),
    });
    if (geometry.vertexCount === 0) return;

    let geo = geometryRef.current;
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geometryRef.current = geo;
      meshRef.current.geometry = geo;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(geometry.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
  });

  return <mesh ref={meshRef} material={material} />;
}
