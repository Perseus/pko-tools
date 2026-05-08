import { useContext, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { useLoadEffect } from "../../useLoadEffect";
import { useEffectTexture } from "../../useEffectTexture";
import { TimeProvider, TimeSource, useTimeSource } from "../../TimeContext";
import { EffectRenderer } from "../EffectRenderer";
import { Particle } from "./useParticleLifecycle";
import { currentProjectAtom } from "@/store/project";
import { useAtomValue } from "jotai";
import { useEffectModel } from "@/features/effect/useEffectModel";
import {
  createCylinderGeometry,
  createRectGeometry,
  createRectPlaneGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTrianglePlaneGeometry,
  resolveBlendFactors,
} from "@/features/effect/rendering";
import {
  applyTextureSampling,
  composePkoRenderState,
} from "@/features/effect/pkoStateEmulation";
import { createPkoTextureFactorColor, setPkoTextureFactorColor } from "@/features/effect/color";
import { ParticleOpacityContext } from "./particleOpacityContext";
export { ParticleOpacityProvider } from "./particleOpacityContext";

interface ParticleVisualProps {
  system: ParSystem;
  /** When provided, wraps the EffectRenderer in a local TimeProvider
   *  whose getTime() returns the particle's elapsed time. */
  particle?: Particle;
  loop?: boolean;
  /** Runtime CMPPartCtrl::setDir direction for modelDir visuals. */
  sourceDirectionRef?: MutableRefObject<THREE.Vector3 | null>;
  /** C++ _CPPart is shared unless mediaY creates one nested effect per particle. */
  sharedEffectElapsedRef?: MutableRefObject<number>;
  /** C++ MODEL/STRIP stop when nested _CPPart->IsPlay() becomes false. */
  onNestedEffectComplete?: () => void;
}

/**
 * Renders the visual template for a particle system.
 * If the system's modelName references an .eff file, loads and renders it.
 *
 * When a `particle` is provided, wraps the effect in a local TimeProvider so that
 * sub-effects (RectPlane, Cylinder) animate relative to the particle's birth time,
 * not the global clock.
 */
export function ParticleVisual({
  system,
  particle,
  loop = false,
  sourceDirectionRef,
  sharedEffectElapsedRef,
  onNestedEffectComplete,
}: ParticleVisualProps) {
  const opacityScale = useContext(ParticleOpacityContext);
  const directMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const particleRef = useRef(particle);
  const opacityScaleRef = useRef(opacityScale);
  const materialColorRef = useRef(new THREE.Color());
  particleRef.current = particle;
  opacityScaleRef.current = opacityScale;
  const currentProject = useAtomValue(currentProjectAtom);
  const modelName = system.modelName.trim();
  const isNestedEffect = modelName.toLowerCase().endsWith(".eff");
  const builtinGeometry = useMemo(
    () => isNestedEffect ? null : createBuiltinParticleGeometry(modelName),
    [isNestedEffect, modelName],
  );
  const effFiles = useLoadEffect(isNestedEffect ? [modelName] : []);
  const modelGeometry = useEffectModel(
    !isNestedEffect && modelName && !builtinGeometry ? modelName : undefined,
    currentProject?.id,
  );
  const modelTexture = useEffectTexture(system.textureName);
  const waitingForModelTexture = Boolean(
    currentProject && !isNestedEffect && system.textureName.trim() && !modelTexture,
  );
  const blendFactors = useMemo(
    () => resolveBlendFactors(system.srcBlend, system.destBlend),
    [system.srcBlend, system.destBlend],
  );
  const materialColor = particle
    ? createPkoTextureFactorColor(particle.color.r, particle.color.g, particle.color.b)
    : "white";

  useEffect(() => {
    // CMPPartSys defaults to eff.fx technique 3, which clamps U/V in the DX8 shader.
    applyTextureSampling(modelTexture, composePkoRenderState(3, {
      minFilter: system.minFilter,
      magFilter: system.magFilter,
    }));
  }, [modelTexture, system.minFilter, system.magFilter]);

  useFrame(() => {
    const material = directMaterialRef.current;
    const current = particleRef.current;
    if (!material || !current) return;

    setPkoTextureFactorColor(
      materialColorRef.current,
      current.color.r,
      current.color.g,
      current.color.b,
    );
    material.color.copy(materialColorRef.current);
    material.opacity = current.alpha * opacityScaleRef.current;
  });

  if (isNestedEffect && effFiles.length === 0) return null;

  if (effFiles.length > 1) {
    console.error('has more than one effect, but rendering just one in ParticleVisual');
  }

  const renderer = isNestedEffect ? (
    <ParticleOpacityContext.Provider value={(particle?.alpha ?? 1) * opacityScale}>
      <EffectRenderer effect={effFiles[0]} onComplete={onNestedEffectComplete} />
    </ParticleOpacityContext.Provider>
  ) : (builtinGeometry ?? modelGeometry) && !waitingForModelTexture ? (
    <mesh geometry={builtinGeometry ?? modelGeometry!}>
      <meshBasicMaterial
        ref={directMaterialRef}
        color={materialColor}
        opacity={(particle?.alpha ?? 1) * opacityScale}
        map={modelTexture}
        transparent
        blending={THREE.CustomBlending}
        blendSrc={blendFactors.blendSrc}
        blendDst={blendFactors.blendDst}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  ) : null;

  if (!renderer) return null;

  if (particle) {
    return (
      <ParticleTimeScope
        loop={getNestedEffectLoop(system.type, loop, system.playTime)}
        particle={particle}
        sharedEffectElapsedRef={!system.mediaY ? sharedEffectElapsedRef : undefined}
      >
        <ParticleRotationScope
          system={system}
          particle={particle}
          sourceDirectionRef={sourceDirectionRef}
        >
          {renderer}
        </ParticleRotationScope>
      </ParticleTimeScope>
    );
  }

  return renderer;
}

function createBuiltinParticleGeometry(modelName: string): THREE.BufferGeometry | null {
  switch (modelName) {
    case "":
    case "Rect":
      return createRectGeometry();
    case "RectPlane":
      return createRectPlaneGeometry();
    case "RectZ":
      return createRectZGeometry();
    case "Triangle":
      return createTriangleGeometry();
    case "TrianglePlane":
      return createTrianglePlaneGeometry();
    case "Cylinder":
      // CMPResManger::LoadTotalMesh preloads CreateCylinder(8, 3, 1, 3).
      return createCylinderGeometry(1, 3, 3, 8);
    case "Cone":
      // CMPResManger::LoadTotalMesh preloads CreateCone(8, 3, 2).
      return createCylinderGeometry(0, 2, 3, 8, 1.5);
    default:
      return null;
  }
}

function ParticleRotationScope({
  system,
  particle,
  children,
  sourceDirectionRef,
}: {
  system: ParSystem;
  particle: Particle;
  children: React.ReactNode;
  sourceDirectionRef?: MutableRefObject<THREE.Vector3 | null>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const particleRef = useRef(particle);
  particleRef.current = particle;
  const rotationXRef = useRef(new THREE.Matrix4());
  const rotationZRef = useRef(new THREE.Matrix4());
  const frameEulerRef = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const frameMatrixRef = useRef(new THREE.Matrix4());
  const modelDirMatrixRef = useRef(new THREE.Matrix4());
  const directionRef = useRef(new THREE.Vector3());
  const parentWorldQuatRef = useRef(new THREE.Quaternion());
  const parentInverseQuatRef = useRef(new THREE.Quaternion());

  useFrame(({ camera }) => {
    if (!groupRef.current) return;
    if (system.billboard) {
      const parent = groupRef.current.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parent.getWorldQuaternion(parentWorldQuatRef.current);
      } else {
        parentWorldQuatRef.current.identity();
      }
      parentInverseQuatRef.current.copy(parentWorldQuatRef.current).invert();
      groupRef.current.quaternion.copy(parentInverseQuatRef.current).multiply(camera.quaternion);
      return;
    }

    const angle = particleRef.current.angle;
    if (system.type === 8) {
      groupRef.current.rotation.set(0, 0, 0);
      return;
    }
    if (system.type === 12) {
      rotationXRef.current.makeRotationX(angle.x);
      rotationZRef.current.makeRotationZ(angle.y);
      groupRef.current.setRotationFromMatrix(
        rotationZRef.current.multiply(rotationXRef.current),
      );
      return;
    }
    if (
      (system.type === 15 || (system.type === 14 && system.usePath))
      && system.modelName.trim().toLowerCase().endsWith(".eff")
    ) {
      if (makeRotatingXZFromDirection(modelDirMatrixRef.current, particleRef.current.dir)) {
        groupRef.current.setRotationFromMatrix(modelDirMatrixRef.current);
      } else {
        groupRef.current.quaternion.identity();
      }
      return;
    }
    if (system.modelDir) {
      frameEulerRef.current.set(angle.x, angle.y, angle.z, "YXZ");
      frameMatrixRef.current.makeRotationFromEuler(frameEulerRef.current);
      if (sourceDirectionRef?.current && sourceDirectionRef.current.lengthSq() > 0.000001) {
        directionRef.current.copy(sourceDirectionRef.current);
      } else if (system.type === 5 || system.type === 6) {
        // C++ MODEL/STRIP modelDir uses _vTemDir populated only by runtime
        // CMPPartSys::setDir(). Serialized _vDir is not consumed by this path.
        directionRef.current.set(0, 0, 0);
      } else {
        directionRef.current.copy(particleRef.current.dir);
      }
      if (makeRotatingXZFromDirection(modelDirMatrixRef.current, directionRef.current)) {
        frameMatrixRef.current.premultiply(modelDirMatrixRef.current);
      }
      groupRef.current.setRotationFromMatrix(frameMatrixRef.current);
      return;
    }
    groupRef.current.rotation.set(angle.x, angle.y, angle.z, "YXZ");
  });

  return <group ref={groupRef}>{children}</group>;
}

function makeRotatingXZFromDirection(
  target: THREE.Matrix4,
  direction: THREE.Vector3,
): boolean {
  const length = direction.length();
  if (length <= 0.000001) return false;

  const pitch = direction.z === 0 ? 0 : Math.asin(direction.z / length);
  let yaw = 0;
  if (direction.x !== 0 || direction.y !== 0) {
    const horizontal = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    yaw = Math.acos(direction.y / horizontal);
    if (direction.x >= 0) yaw = -yaw;
  }

  target.makeRotationZ(yaw);
  target.multiply(new THREE.Matrix4().makeRotationX(pitch));
  return true;
}

/**
 * Wraps children in a local TimeProvider driven by a particle's elapsed time.
 * Stable object identity — getTime() reads particle.elapsed which is mutated
 * by useParticleLifecycle each frame.
 */
export function getNestedEffectLoop(
  systemType: number,
  parentLoop: boolean,
  systemPlayTime = 0,
): boolean {
  // CMPPartSys::Play calls Play(!_bLoop) only for MODEL, STRIP, and ARRAW.
  // CMPModelEff::Play(0) loops; Play(1) runs once.
  if (systemType === 5 || systemType === 6 || systemType === 8) {
    if (!parentLoop && systemPlayTime <= 0) return true;
    return parentLoop;
  }
  return true;
}

function ParticleTimeScope({
  loop,
  particle,
  sharedEffectElapsedRef,
  children,
}: {
  loop: boolean;
  particle: Particle;
  sharedEffectElapsedRef?: MutableRefObject<number>;
  children: React.ReactNode;
}) {
  const parent = useTimeSource();
  const particleRef = useRef(particle);
  particleRef.current = particle;
  const sharedRef = useRef(sharedEffectElapsedRef);
  sharedRef.current = sharedEffectElapsedRef;

  const localTime = useRef<TimeSource>({
    getTime: () => sharedRef.current?.current ?? particleRef.current.elapsed,
    get playing() { return parent.playing; },
    loop,
  }).current;

  return <TimeProvider value={localTime}>{children}</TimeProvider>;
}
