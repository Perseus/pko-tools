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

/** Effect animation type enum matching game engine I_Effect.h */
const EFFECT_FRAMETEX = 1;

/** Assembled keyframe for interpolation */
interface KeyFrame {
  color: [number, number, number, number];
  scale: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
}

const TEX_EXTENSIONS = [".tga", ".TGA", ".bmp", ".BMP", ".dds", ".png"];

/**
 * Map D3DBlend enum values (serialized as u32 from the backend) to Three.js
 * blend factors.  The backend D3DBlend enum matches D3D9 numbering:
 *   Zero=1, One=2, SrcColor=3, InvSrcColor=4, SrcAlpha=5, InvSrcAlpha=6,
 *   DestAlpha=7, InvDestAlpha=8, DestColor=9, InvDestColor=10, SrcAlphaSat=11
 */
function d3dBlendToThree(blend: number): THREE.BlendingDstFactor {
  switch (blend) {
    case 1:  return THREE.ZeroFactor as unknown as THREE.BlendingDstFactor;
    case 2:  return THREE.OneFactor as unknown as THREE.BlendingDstFactor;
    case 3:  return THREE.SrcColorFactor as unknown as THREE.BlendingDstFactor;
    case 4:  return THREE.OneMinusSrcColorFactor as unknown as THREE.BlendingDstFactor;
    case 5:  return THREE.SrcAlphaFactor as unknown as THREE.BlendingDstFactor;
    case 6:  return THREE.OneMinusSrcAlphaFactor as unknown as THREE.BlendingDstFactor;
    case 7:  return THREE.DstAlphaFactor as unknown as THREE.BlendingDstFactor;
    case 8:  return THREE.OneMinusDstAlphaFactor as unknown as THREE.BlendingDstFactor;
    case 9:  return THREE.DstColorFactor as unknown as THREE.BlendingDstFactor;
    case 10: return THREE.OneMinusDstColorFactor as unknown as THREE.BlendingDstFactor;
    default: return THREE.OneFactor as unknown as THREE.BlendingDstFactor;
  }
}

/** Interpolate between two keyframes */
function lerpFrame(a: KeyFrame, b: KeyFrame, t: number): KeyFrame {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    color: [
      lerp(a.color[0], b.color[0]),
      lerp(a.color[1], b.color[1]),
      lerp(a.color[2], b.color[2]),
      lerp(a.color[3], b.color[3]),
    ],
    scale: [
      lerp(a.scale[0], b.scale[0]),
      lerp(a.scale[1], b.scale[1]),
      lerp(a.scale[2], b.scale[2]),
    ],
    position: [
      lerp(a.position[0], b.position[0]),
      lerp(a.position[1], b.position[1]),
      lerp(a.position[2], b.position[2]),
    ],
    rotation: [
      lerp(a.rotation[0], b.rotation[0]),
      lerp(a.rotation[1], b.rotation[1]),
      lerp(a.rotation[2], b.rotation[2]),
    ],
  };
}

/** Assemble keyframes from separate backend arrays.
 *  Note: frameColors are already in 0-1 range from the backend. */
function assembleKeyFrames(sub: SubEffect): KeyFrame[] {
  const count = sub.frameCount;
  if (count === 0) return [];

  const frames: KeyFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({
      color: sub.frameColors?.[i] ?? [1, 1, 1, 1],
      scale: sub.frameSizes?.[i] ?? [1, 1, 1],
      position: sub.framePositions?.[i] ?? [0, 0, 0],
      rotation: sub.frameAngles?.[i] ?? [0, 0, 0],
    });
  }
  return frames;
}

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
  keyFrames: KeyFrame[];
  textures: Map<string, THREE.Texture>;
  forgeAlpha: number;
}

function SingleSubEffect({ sub, keyFrames, textures, forgeAlpha }: SingleEffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Per-frame timing: track current frame index and time within that frame
  // (game's CMPModelEff::FrameMove uses per-frame durations from frameTimes[])
  const frameIdxRef = useRef(0);
  const frameTimeRef = useRef(0);
  const loopAngleRef = useRef(0);
  // Separate timer for UV animation (coordList / texList / frameTex)
  const uvTimeRef = useRef(0);

  const totalFrames = keyFrames.length;

  // Pre-compute rotaLoop axis and velocity
  const rotaLoopAxis = useMemo(() => {
    if (!sub.rotaLoop) return null;
    const v = new THREE.Vector3(
      sub.rotaLoopVec[0], sub.rotaLoopVec[1], sub.rotaLoopVec[2]
    );
    if (v.lengthSq() < 1e-8) return null;
    return v.normalize();
  }, [sub.rotaLoop, sub.rotaLoopVec?.[0], sub.rotaLoopVec?.[1], sub.rotaLoopVec?.[2]]);

  const rotaLoopVel = sub.rotaLoopVec?.[3] ?? 0;

  // Reusable quaternion objects to avoid per-frame allocation
  const _qLoop = useMemo(() => new THREE.Quaternion(), []);
  const _qKeyframe = useMemo(() => new THREE.Quaternion(), []);
  // Game uses D3DXMatrixRotationYawPitchRoll(angleY, angleX, angleZ) which is
  // Rz * Rx * Ry in D3D row-vector convention → Three.js Euler order 'YXZ'
  const _euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);

  // Resolve main texture from map.
  // For EFFECT_FRAMETEX the initial texture comes from frameTexNames[0], not texName.
  const mainTexture = sub.effectType === EFFECT_FRAMETEX
    ? (textures.get(sub.frameTexNames?.[0]) ?? textures.get(sub.texName) ?? null)
    : (textures.get(sub.texName) ?? null);

  // Don't render until the required texture is loaded — the game engine
  // skips drawing effects whose resources haven't been resolved yet.
  // Without a texture, the geometry renders as a solid white/colored shape
  // with whatever blending is set, producing visible artifacts (grid patterns
  // from overlapping planes, solid dark cylinders, etc.).
  const needsTexture =
    (sub.texName && sub.texName.length > 0) ||
    (sub.effectType === EFFECT_FRAMETEX && sub.frameTexCount > 0);

  const textureReady = !needsTexture || !!mainTexture;

  useFrame((state, delta) => {
    if (!meshRef.current || totalFrames === 0 || !textureReady) return;

    // --- Keyframe timing: per-frame durations from frameTimes[] ---
    // Game accumulates time, advances frame when time exceeds current frame's duration.
    frameTimeRef.current += delta;
    let safety = totalFrames + 1;
    while (safety-- > 0) {
      const ft = Math.max(sub.frameTimes[frameIdxRef.current] ?? 0.001, 0.001);
      if (frameTimeRef.current < ft) break;
      frameTimeRef.current -= ft;
      frameIdxRef.current = (frameIdxRef.current + 1) % totalFrames;
    }

    const frameIdx = frameIdxRef.current;
    const frameFrac = Math.min(
      frameTimeRef.current / Math.max(sub.frameTimes[frameIdx] ?? 0.001, 0.001),
      1
    );

    const a = keyFrames[frameIdx];
    const b = keyFrames[(frameIdx + 1) % totalFrames];
    const frame = lerpFrame(a, b, frameFrac);

    // Position & scale
    meshRef.current.position.set(
      frame.position[0],
      frame.position[1],
      frame.position[2]
    );
    meshRef.current.scale.set(
      frame.scale[0],
      frame.scale[1],
      frame.scale[2]
    );

    // Rotation: combine keyframe rotation with per-sub-effect rotaLoop
    if (sub.rotaLoop && rotaLoopAxis) {
      loopAngleRef.current = (loopAngleRef.current + rotaLoopVel * delta) % (Math.PI * 2);
      _qLoop.setFromAxisAngle(rotaLoopAxis, loopAngleRef.current);
      _euler.set(frame.rotation[0], frame.rotation[1], frame.rotation[2]);
      _qKeyframe.setFromEuler(_euler);
      // Game: R_keyframe × R_rotaLoop (D3D row-vector = first R_keyframe, then R_rotaLoop)
      // Three.js: copy(qOuter).multiply(qInner) applies qInner first, qOuter second
      meshRef.current.quaternion.copy(_qLoop).multiply(_qKeyframe);
    } else {
      // Use YXZ Euler order to match D3DXMatrixRotationYawPitchRoll
      _euler.set(frame.rotation[0], frame.rotation[1], frame.rotation[2], "YXZ");
      meshRef.current.quaternion.setFromEuler(_euler);
    }

    // Billboard: rotaBoard only matters when billboard is also true.
    if (sub.billboard) {
      if (sub.rotaBoard) {
        meshRef.current.quaternion.premultiply(state.camera.quaternion);
      } else {
        meshRef.current.quaternion.copy(state.camera.quaternion);
      }
    }

    // Color — values are already 0-1 from the backend.
    // Apply forge-level alpha multiplier (game's SItemForge::GetAlpha)
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    if (mat) {
      mat.color.setRGB(
        frame.color[0],
        frame.color[1],
        frame.color[2]
      );
      mat.opacity = frame.color[3] * forgeAlpha;
    }

    // --- UV animation (separate timing from keyframe animation) ---
    // C++ CMPModelEff::FrameMove skips EFFECT_MODELUV (type 2) and
    // EFFECT_MODELTEXTURE (type 3) when IsItem() == true.
    // Only EFFECT_FRAMETEX (type 1) texture switching runs for items.
    if (sub.effectType === EFFECT_FRAMETEX && sub.frameTexCount > 0 && sub.frameTexTime > 0 && mat) {
      // Texture resource switching (game swaps entire texture each frame)
      uvTimeRef.current += delta;
      const totalFTTime = sub.frameTexTime * sub.frameTexCount;
      if (uvTimeRef.current >= totalFTTime) uvTimeRef.current %= totalFTTime;

      const ftIdx = Math.floor(uvTimeRef.current / sub.frameTexTime) % sub.frameTexCount;
      const targetTexName = sub.frameTexNames[ftIdx];
      if (targetTexName) {
        const targetTex = textures.get(targetTexName) ?? null;
        if (targetTex && mat.map !== targetTex) {
          mat.map = targetTex;
          mat.needsUpdate = true;
        }
      }
    }
  });

  const geometry = useMemo(() => createGeometry(sub), [sub]);

  if (!textureReady) {
    // Keep the mesh in the tree (hooks must stay stable) but invisible
    return <mesh ref={meshRef} visible={false} geometry={geometry}>
      <meshBasicMaterial transparent opacity={0} />
    </mesh>;
  }

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial
        map={mainTexture}
        transparent
        blending={THREE.CustomBlending}
        blendSrc={d3dBlendToThree(sub.srcBlend)}
        blendDst={d3dBlendToThree(sub.destBlend)}
        depthWrite={false}
        side={THREE.DoubleSide}
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
          const keyFrames = assembleKeyFrames(sub);
          if (keyFrames.length === 0) return null;

          return (
            <SingleSubEffect
              key={idx}
              sub={sub}
              keyFrames={keyFrames}
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
