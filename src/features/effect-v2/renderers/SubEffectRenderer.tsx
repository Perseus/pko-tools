import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SubEffect } from "@/types/effect";
import { RectPlane } from "./models/RectPlane";
import { Cylinder } from "./models/Cylinder";
import { useFrame } from "@react-three/fiber";

interface SubEffectRendererProps {
  subEffect: SubEffect;
  onComplete?: () => void;
}

function isExternalModel(modelName: string): boolean {
  return modelName.includes('.lgo');
}

/**
 * Routes a sub-effect to the correct model renderer based on its data.
 * Wraps everything in a group ref for per-sub-effect transforms (rotation, etc.)
 */
export function SubEffectRenderer({ subEffect, onComplete }: SubEffectRendererProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Always point to the latest onComplete without re-subscribing useFrame
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const content = resolveModel(subEffect, onComplete);

  // Reset rotation when sub-effect changes
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.quaternion.identity();
    }
  }, [subEffect]);

  // No renderable content — sub-effect is a no-op, signal completion immediately
  useEffect(() => {
    if (!content) {
      onCompleteRef.current?.();
    }
  // content identity changes every render (JSX), so check once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_ctx, delta) => {
    if (!groupRef.current) return;
    if (subEffect.rotaLoop) {
      const rotationAxis = new THREE.Vector3(
        subEffect.rotaLoopVec[0],
        subEffect.rotaLoopVec[2],
        subEffect.rotaLoopVec[1],
      ).normalize();
      let rotation = subEffect.rotaLoopVec[3] * delta;
      if (rotation >= Math.PI * 2) {
        rotation -= Math.PI * 2;
      }
      groupRef.current.rotateOnAxis(rotationAxis, rotation);
    }
  });

  if (!content) return null;

  return (
    <group ref={groupRef}>
      {content}
    </group>
  );
}

function resolveModel(subEffect: SubEffect, onComplete?: () => void) {
  const hasModel = subEffect.modelName.trim().length > 0;
  const hasCylinder = subEffect.useParam > 0;

  if (hasCylinder) {
    return null;
  }

  if (hasModel) {
    if (isExternalModel(subEffect.modelName)) {
      console.log('external model found, not rendering yet - ', subEffect.modelName);
      return null;
    }

    switch (subEffect.modelName) {
      case 'RectPlane':
        return <RectPlane subEffect={subEffect} onComplete={onComplete} />;
      case 'Cylinder':
        return <Cylinder subEffect={subEffect} onComplete={onComplete} />;
      default:
        console.log('Got unhandled subEffect with modelName - ', subEffect.modelName);
        return null;
    }
  }

  if (subEffect.texName) {
    return <RectPlane subEffect={subEffect} onComplete={onComplete} />;
  }

  return null;
}
