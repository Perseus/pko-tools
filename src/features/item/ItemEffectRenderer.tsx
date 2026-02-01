import { useEffect, useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { ParticleEffectInfo } from "@/types/item";

interface EffKeyFrame {
  color: [number, number, number, number];
  scale: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
}

interface EffSubEffect {
  tex_file: string;
  key_frames: EffKeyFrame[];
  geom_type: number;
  blend_src: number;
  blend_dst: number;
  billboard: boolean;
  frame_rate: number;
  loop_mode: number;
}

interface EffFileData {
  sub_effects: EffSubEffect[];
}

function d3dBlendToThree(blend: number): THREE.BlendingDstFactor {
  switch (blend) {
    case 2: return THREE.OneFactor as unknown as THREE.BlendingDstFactor;
    case 3: return THREE.ZeroFactor as unknown as THREE.BlendingDstFactor;
    case 5: return THREE.SrcAlphaFactor as unknown as THREE.BlendingDstFactor;
    case 6: return THREE.OneMinusSrcAlphaFactor as unknown as THREE.BlendingDstFactor;
    case 7: return THREE.DstAlphaFactor as unknown as THREE.BlendingDstFactor;
    case 9: return THREE.SrcColorFactor as unknown as THREE.BlendingDstFactor;
    default: return THREE.OneFactor as unknown as THREE.BlendingDstFactor;
  }
}

/** Interpolate between two keyframes */
function lerpFrame(a: EffKeyFrame, b: EffKeyFrame, t: number): EffKeyFrame {
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

interface SingleEffectProps {
  sub: EffSubEffect;
  texture: THREE.Texture | null;
}

function SingleSubEffect({ sub, texture }: SingleEffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  const frameRate = sub.frame_rate || 30;
  const totalFrames = sub.key_frames.length;
  const duration = totalFrames > 0 ? totalFrames / frameRate : 1;

  useFrame((state, delta) => {
    if (!meshRef.current || totalFrames === 0) return;

    timeRef.current += delta;

    // Loop
    const loopTime = timeRef.current % duration;
    const frameFloat = (loopTime / duration) * totalFrames;
    const frameIdx = Math.floor(frameFloat);
    const frameFrac = frameFloat - frameIdx;

    const a = sub.key_frames[frameIdx % totalFrames];
    const b = sub.key_frames[(frameIdx + 1) % totalFrames];
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

    // Rotation (XYZ Euler)
    meshRef.current.rotation.set(
      frame.rotation[0],
      frame.rotation[1],
      frame.rotation[2]
    );

    // Billboard
    if (sub.billboard) {
      meshRef.current.quaternion.copy(state.camera.quaternion);
    }

    // Color
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    if (mat) {
      mat.color.setRGB(
        frame.color[0] / 255,
        frame.color[1] / 255,
        frame.color[2] / 255
      );
      mat.opacity = frame.color[3] / 255;
    }
  });

  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(1, 1);
  }, []);

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial
        map={texture}
        transparent
        blending={THREE.CustomBlending}
        blendSrc={d3dBlendToThree(sub.blend_src)}
        blendDst={d3dBlendToThree(sub.blend_dst)}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

interface EffectGroupProps {
  effectName: string;
  projectId: string;
  dummyMatrix: THREE.Matrix4 | null;
}

function EffectGroup({ effectName, projectId, dummyMatrix }: EffectGroupProps) {
  const [effData, setEffData] = useState<EffFileData | null>(null);
  const [textures, setTextures] = useState<Map<string, THREE.Texture>>(
    new Map()
  );
  const groupRef = useRef<THREE.Group>(null);

  // Load .eff file
  useEffect(() => {
    if (!effectName || !projectId) return;
    let cancelled = false;

    // Strip .par extension to get .eff name
    const effName = effectName.replace(/\.par$/i, ".eff");

    async function load() {
      try {
        const data = await invoke<EffFileData>("load_effect", {
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

  // Load textures
  useEffect(() => {
    if (!effData || !projectId) return;
    let cancelled = false;
    const newTextures = new Map<string, THREE.Texture>();

    async function loadTextures() {
      for (const sub of effData!.sub_effects) {
        if (!sub.tex_file || newTextures.has(sub.tex_file)) continue;

        try {
          const decoded = await invoke<{
            width: number;
            height: number;
            data: string;
          }>("decode_texture", {
            path: `${projectId}/texture/effect/${sub.tex_file}`,
          });

          if (cancelled) return;

          const binaryStr = atob(decoded.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }

          const tex = new THREE.DataTexture(
            bytes,
            decoded.width,
            decoded.height,
            THREE.RGBAFormat
          );
          tex.needsUpdate = true;
          newTextures.set(sub.tex_file, tex);
        } catch {
          // Texture not found
        }
      }

      if (!cancelled) setTextures(new Map(newTextures));
    }

    loadTextures();
    return () => {
      cancelled = true;
    };
  }, [effData, projectId]);

  // Apply dummy matrix
  useEffect(() => {
    if (groupRef.current && dummyMatrix) {
      groupRef.current.matrix.copy(dummyMatrix);
      groupRef.current.matrixAutoUpdate = false;
    }
  }, [dummyMatrix]);

  if (!effData || effData.sub_effects.length === 0) {
    return null;
  }

  return (
    <group ref={groupRef}>
      {effData.sub_effects.map((sub, idx) => {
        const tex = textures.get(sub.tex_file) ?? null;
        if (!sub.key_frames || sub.key_frames.length === 0) return null;

        return (
          <SingleSubEffect key={idx} sub={sub} texture={tex} />
        );
      })}
    </group>
  );
}

interface ItemEffectRendererProps {
  particles: ParticleEffectInfo[];
  dummyPoints: { id: number; matrix: THREE.Matrix4; name: string }[];
  projectId: string;
}

export function ItemEffectRenderer({
  particles,
  dummyPoints,
  projectId,
}: ItemEffectRendererProps) {
  // For each particle effect that has a matching .eff file, render it
  return (
    <>
      {particles.map((p, idx) => {
        const dummy = dummyPoints.find((d) => d.id === p.dummy_id);
        return (
          <EffectGroup
            key={`eff-${p.par_file}-${p.dummy_id}-${idx}`}
            effectName={p.par_file}
            projectId={projectId}
            dummyMatrix={dummy?.matrix ?? null}
          />
        );
      })}
    </>
  );
}
