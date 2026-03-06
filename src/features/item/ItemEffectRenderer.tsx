import { useEffect, useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { invokeTimed as invoke } from "@/commands/invokeTimed";
import { ParticleEffectInfo } from "@/types/item";
import type { EffectFile, SubEffect } from "@/types/effect";
import {
  createEffectTexture,
  createRectGeometry,
  createRectPlaneGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTrianglePlaneGeometry,
  createCylinderGeometry,
} from "@/features/effect/rendering";
import { interpolateFrame } from "@/features/effect/animation";
import { applySubEffectFrame } from "@/features/effect/applySubEffectFrame";
import { buildEffectMaterialProps } from "@/features/effect/buildEffectMaterialProps";

/** Effect animation type enum matching game engine I_Effect.h */
const EFFECT_FRAMETEX = 1;

const TEX_EXTENSIONS = [".tga", ".TGA", ".bmp", ".BMP", ".dds", ".png"];

/** Create geometry matching the game's built-in effect primitives.
 *  Delegates to shared C++-faithful geometry functions from rendering.ts. */
function createGeometry(sub: SubEffect): THREE.BufferGeometry {
  const name = (sub.modelName || "").toLowerCase();

  if (name === "cylinder" || name === "cone")
    return createCylinderGeometry(sub.topRadius || 0.5, sub.botRadius || 0.5, sub.height || 1, sub.segments || 16);
  if (name === "rect" || name === "") return createRectGeometry();
  if (name === "rectplane") return createRectPlaneGeometry();
  if (name === "rectz") return createRectZGeometry();
  if (name === "triangle") return createTriangleGeometry();
  if (name === "triangleplane") return createTrianglePlaneGeometry();
  if (name === "sphere") return new THREE.SphereGeometry(0.7, 24, 24);
  return createRectGeometry(); // default fallback
}

/** Animates group-level rotation from EffFile.rotating/rotaVec/rotaVel.
 *  The game accumulates angle += rotaVel * dt and rotates around rotaVec axis. */
function GroupRotator({
  groupRef,
  rotating,
  rotaVec,
  rotaVel,
}: {
  groupRef: React.RefObject<THREE.Group>;
  rotating: boolean;
  rotaVec: [number, number, number];
  rotaVel: number;
}) {
  const angleRef = useRef(0);
  const axis = useMemo(() => {
    const v = new THREE.Vector3(rotaVec[0], rotaVec[1], rotaVec[2]);
    if (v.lengthSq() < 1e-8) v.set(0, 1, 0);
    return v.normalize();
  }, [rotaVec[0], rotaVec[1], rotaVec[2]]);

  useFrame((_, delta) => {
    if (!groupRef.current || !rotating) return;
    angleRef.current = (angleRef.current + rotaVel * delta) % (Math.PI * 2);
    groupRef.current.setRotationFromAxisAngle(axis, angleRef.current);
  });

  return null;
}

interface SingleEffectProps {
  sub: SubEffect;
  textures: Map<string, THREE.Texture>;
  forgeAlpha: number;
}

function SingleSubEffect({ sub, textures, forgeAlpha }: SingleEffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);
  // Separate timer for EFFECT_FRAMETEX texture switching
  const uvTimeRef = useRef(0);
  const cylinderCacheRef = useRef<Map<string, Float32Array>>(new Map());

  // Resolve main texture from map.
  // For EFFECT_FRAMETEX the initial texture comes from frameTexNames[0], not texName.
  const mainTexture = sub.effectType === EFFECT_FRAMETEX
    ? (textures.get(sub.frameTexNames?.[0]) ?? textures.get(sub.texName) ?? null)
    : (textures.get(sub.texName) ?? null);

  // Don't render until the required texture is loaded
  const needsTexture =
    (sub.texName && sub.texName.length > 0) ||
    (sub.effectType === EFFECT_FRAMETEX && sub.frameTexCount > 0);

  const textureReady = !needsTexture || !!mainTexture;

  const isCylinder = useMemo(() => {
    const name = (sub.modelName || "").toLowerCase();
    return name === "cylinder" || name === "cone";
  }, [sub.modelName]);

  useFrame((state, delta) => {
    if (!meshRef.current || sub.frameCount === 0 || !textureReady) return;

    timeRef.current += delta;
    const frame = interpolateFrame(sub, timeRef.current, true);

    applySubEffectFrame(meshRef.current, state.camera, {
      sub,
      position: frame.position,
      scale: frame.size,
      angle: frame.angle,
      color: frame.color,
      playbackTime: timeRef.current,
      frameIndex: frame.frameIndex,
      nextFrameIndex: frame.nextFrameIndex,
      lerp: frame.lerp,
      forgeAlpha,
      cylinderCache: cylinderCacheRef.current,
      isCylinder,
    });

    // EFFECT_FRAMETEX texture switching (game swaps entire texture each frame)
    if (sub.effectType === EFFECT_FRAMETEX && sub.frameTexCount > 0 && sub.frameTexTime > 0) {
      uvTimeRef.current += delta;
      const totalFTTime = sub.frameTexTime * sub.frameTexCount;
      if (uvTimeRef.current >= totalFTTime) uvTimeRef.current %= totalFTTime;

      const ftIdx = Math.floor(uvTimeRef.current / sub.frameTexTime) % sub.frameTexCount;
      const targetTexName = sub.frameTexNames[ftIdx];
      if (targetTexName) {
        const targetTex = textures.get(targetTexName) ?? null;
        const mat = meshRef.current.material as THREE.MeshBasicMaterial;
        if (targetTex && mat && mat.map !== targetTex) {
          mat.map = targetTex;
          mat.needsUpdate = true;
        }
      }
    }
  });

  const geometry = useMemo(() => createGeometry(sub), [sub]);
  const matProps = useMemo(
    () => buildEffectMaterialProps(sub, mainTexture),
    [sub, mainTexture],
  );

  if (!textureReady) {
    return <mesh ref={meshRef} visible={false} geometry={geometry}>
      <meshBasicMaterial transparent opacity={0} />
    </mesh>;
  }

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial
        {...matProps}
      />
    </mesh>
  );
}

interface EffectGroupProps {
  effectName: string;
  projectId: string;
  projectDir: string;
  dummyMatrix: THREE.Matrix4 | null;
  effectScale: number;
  forgeAlpha: number;
}

function EffectGroup({ effectName, projectId, projectDir, dummyMatrix, effectScale, forgeAlpha }: EffectGroupProps) {
  const [effData, setEffData] = useState<EffectFile | null>(null);
  const [textures, setTextures] = useState<Map<string, THREE.Texture>>(
    new Map()
  );
  const anchorRef = useRef<THREE.Group>(null);
  const rotateRef = useRef<THREE.Group>(null);

  // Load .eff file (uses project UUID — command resolves path internally)
  useEffect(() => {
    if (!effectName || !projectId) return;
    let cancelled = false;

    // Strip .par extension to get .eff name
    const effName = effectName.replace(/\.par$/i, ".eff");

    async function load() {
      try {
        const data = await invoke<EffectFile>("load_effect", {
          projectId,
          effectName: effName,
        });
        if (!cancelled) setEffData(data);
      } catch {
        // No matching .eff file
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [effectName, projectId]);

  // Load textures — texName may be extensionless, try common extensions.
  // Also loads frame textures for EFFECT_FRAMETEX sub-effects.
  useEffect(() => {
    if (!effData?.subEffects || !projectDir) return;
    let cancelled = false;
    const newTextures = new Map<string, THREE.Texture>();

    async function tryDecode(path: string) {
      return invoke<{ width: number; height: number; data: string }>(
        "decode_texture",
        { path }
      );
    }

    async function loadSingleTexture(texName: string) {
      if (!texName || newTextures.has(texName)) return;

      const basePath = `${projectDir}/texture/effect/${texName}`;
      let decoded: { width: number; height: number; data: string } | null =
        null;

      // Try with the name as-is first (might already have extension)
      try {
        decoded = await tryDecode(basePath);
      } catch {
        // Try common extensions
        for (const ext of TEX_EXTENSIONS) {
          if (cancelled) return;
          try {
            decoded = await tryDecode(`${basePath}${ext}`);
            break;
          } catch {
            // Try next extension
          }
        }
      }

      if (cancelled) return;
      if (!decoded) return;

      const binaryStr = atob(decoded.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const tex = createEffectTexture(bytes, decoded.width, decoded.height);
      newTextures.set(texName, tex);
    }

    async function loadTextures() {
      for (const sub of effData!.subEffects) {
        // Load main texture
        await loadSingleTexture(sub.texName);

        // Load frame textures for EFFECT_FRAMETEX sub-effects
        if (sub.effectType === EFFECT_FRAMETEX && sub.frameTexNames) {
          for (const ftName of sub.frameTexNames) {
            if (cancelled) return;
            await loadSingleTexture(ftName);
          }
        }
      }

      if (!cancelled) setTextures(new Map(newTextures));
    }

    loadTextures();
    return () => {
      cancelled = true;
    };
  }, [effData, projectDir]);

  // Apply dummy matrix to the outer anchor group.
  // The dummy matrix includes both position and rotation from the weapon model's
  // dummy point, placing the effect at the correct attachment point on the blade.
  useEffect(() => {
    if (anchorRef.current) {
      anchorRef.current.matrixAutoUpdate = false;
      if (dummyMatrix) {
        anchorRef.current.matrix.copy(dummyMatrix);
      } else {
        anchorRef.current.matrix.identity();
      }
    }
  }, [dummyMatrix]);

  if (!effData?.subEffects?.length) {
    return null;
  }

  const s = effectScale > 0 ? effectScale : 1;

  return (
    <group ref={anchorRef}>
      <group ref={rotateRef} scale={[s, s, s]}>
        <GroupRotator
          groupRef={rotateRef}
          rotating={effData.rotating}
          rotaVec={effData.rotaVec}
          rotaVel={effData.rotaVel}
        />
        {effData.subEffects.map((sub, idx) => {
          if (sub.frameCount === 0) return null;

          return (
            <SingleSubEffect
              key={idx}
              sub={sub}
              textures={textures}
              forgeAlpha={forgeAlpha}
            />
          );
        })}
      </group>
    </group>
  );
}

interface ItemEffectRendererProps {
  particles: ParticleEffectInfo[];
  dummyPoints: { id: number; matrix: THREE.Matrix4; name: string }[];
  projectId: string;
  projectDir: string;
  forgeAlpha: number;
}

export function ItemEffectRenderer({
  particles,
  dummyPoints,
  projectId,
  projectDir,
  forgeAlpha,
}: ItemEffectRendererProps) {
  return (
    <>
      {particles.map((p, idx) => {
        const dummy = dummyPoints.find((d) => d.id === p.dummy_id);
        return (
          <EffectGroup
            key={`eff-${p.par_file}-${p.dummy_id}-${idx}`}
            effectName={p.par_file}
            projectId={projectId}
            projectDir={projectDir}
            dummyMatrix={dummy?.matrix ?? null}
            effectScale={p.scale}
            forgeAlpha={forgeAlpha}
          />
        );
      })}
    </>
  );
}
