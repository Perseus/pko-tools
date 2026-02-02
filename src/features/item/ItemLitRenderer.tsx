import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ItemLitEntry } from "@/types/item";
import { invoke } from "@tauri-apps/api/core";

/**
 * Refine level to glow alpha mapping (matching game formula).
 * Level 0 = no glow, levels 1-4 = tier 0 (0.31-0.55),
 * levels 5-8 = tier 1 (0.55-0.78), levels 9-12 = tier 2 (0.78-1.0).
 */
function getRefineAlpha(refineLevel: number): number {
  if (refineLevel <= 0) return 0;
  if (refineLevel <= 4) return 0.31 + ((refineLevel - 1) / 3) * 0.24;
  if (refineLevel <= 8) return 0.55 + ((refineLevel - 5) / 3) * 0.23;
  if (refineLevel <= 12) return 0.78 + ((refineLevel - 9) / 3) * 0.22;
  return 1.0;
}

/** Vertex shader for glow overlay - passes through UVs for fragment animation */
const glowVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Fragment shader for glow overlay.
 * Supports 8 animation types via UV transformation:
 * - Type 1: Z-rotation (120 frames)
 * - Type 3: U scrolling (360 frames)
 * - Type 4: V scrolling (360 frames)
 * - Type 5: UV scrolling (360 frames)
 * - Type 6: Position + rotation combined
 * - Type 7: Position + rotation combined (variant)
 * - Type 8: Fast Z-rotation (720 frames)
 */
const glowFragmentShader = `
  uniform sampler2D glowMap;
  uniform float opacity;
  uniform float time;
  uniform int animType;
  varying vec2 vUv;

  vec2 rotateUV(vec2 uv, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    mat2 rot = mat2(c, -s, s, c);
    return rot * (uv - 0.5) + 0.5;
  }

  void main() {
    vec2 animUv = vUv;

    if (animType == 1) {
      // Z-rotation, 120 frame cycle
      float angle = time * 3.14159 * 2.0 / 4.0; // ~1.5s cycle
      animUv = rotateUV(vUv, angle);
    } else if (animType == 3) {
      // U scrolling
      animUv.x = fract(vUv.x + time * 0.5);
    } else if (animType == 4) {
      // V scrolling
      animUv.y = fract(vUv.y + time * 0.5);
    } else if (animType == 5) {
      // UV scrolling (both)
      animUv.x = fract(vUv.x + time * 0.3);
      animUv.y = fract(vUv.y + time * 0.3);
    } else if (animType == 6) {
      // Combined position + rotation
      float angle = time * 3.14159 * 2.0 / 6.0;
      animUv = rotateUV(vUv, angle);
      animUv.y = fract(animUv.y + time * 0.2);
    } else if (animType == 7) {
      // Combined position + rotation (variant)
      float angle = time * 3.14159 * 2.0 / 8.0;
      animUv = rotateUV(vUv, angle);
      animUv.x = fract(animUv.x + time * 0.15);
    } else if (animType == 8) {
      // Fast Z-rotation, 720 frame cycle
      float angle = time * 3.14159 * 2.0 / 2.0; // ~1s cycle
      animUv = rotateUV(vUv, angle);
    }

    vec4 glowColor = texture2D(glowMap, animUv);
    gl_FragColor = vec4(glowColor.rgb, glowColor.a * opacity);
  }
`;

/**
 * Map PKO transp_type values to Three.js blending configurations.
 * From the game engine's D3D render state mappings.
 */
function getBlendingForTranspType(transpType: number): {
  blending: THREE.Blending;
  blendSrc?: THREE.BlendingDstFactor;
  blendDst?: THREE.BlendingDstFactor;
} {
  switch (transpType) {
    case 0:
      return { blending: THREE.NormalBlending };
    case 1:
      // Additive: ONE + ONE
      return { blending: THREE.AdditiveBlending };
    case 2:
      // SrcColor + One (custom additive with src color modulation)
      return {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcColorFactor as unknown as THREE.BlendingDstFactor,
        blendDst: THREE.OneFactor as unknown as THREE.BlendingDstFactor,
      };
    case 3:
      // SrcColor + InvSrcColor (soft blend)
      return {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcColorFactor as unknown as THREE.BlendingDstFactor,
        blendDst: THREE.OneMinusSrcColorFactor as unknown as THREE.BlendingDstFactor,
      };
    case 4:
      // SrcAlpha + DstAlpha
      return {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor as unknown as THREE.BlendingDstFactor,
        blendDst: THREE.DstAlphaFactor as unknown as THREE.BlendingDstFactor,
      };
    case 5:
      return { blending: THREE.SubtractiveBlending };
    default:
      return { blending: THREE.AdditiveBlending };
  }
}

interface ItemLitRendererProps {
  litEntry: ItemLitEntry;
  glowMesh: THREE.Mesh;
  refineLevel: number;
  projectDir: string;
}

export function ItemLitRenderer({
  litEntry,
  glowMesh,
  refineLevel,
  projectDir,
}: ItemLitRendererProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const [glowTexture, setGlowTexture] = useState<THREE.Texture | null>(null);

  // Load glow texture from backend
  // Lit textures are typically in texture/item/ (e.g. red.tga, blue.tga),
  // but may also be in texture/lit/ or texture/. Try multiple directories.
  useEffect(() => {
    // Clear old texture immediately so stale glow doesn't persist
    setGlowTexture(null);

    if (!litEntry?.file || !projectDir) return;

    let cancelled = false;

    async function loadTexture() {
      const searchDirs = ["texture/item", "texture/lit", "texture"];
      let decoded: { width: number; height: number; data: string } | null = null;

      for (const dir of searchDirs) {
        const texPath = `${projectDir}/${dir}/${litEntry.file}`;
        try {
          decoded = await invoke<{
            width: number;
            height: number;
            data: string;
          }>("decode_texture", { path: texPath });
          break;
        } catch {
          // Try next directory
        }
      }

      if (cancelled || !decoded) return;

      // Decode base64 RGBA data into texture
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
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;

      setGlowTexture(tex);
    }

    loadTexture();
    return () => {
      cancelled = true;
    };
  }, [litEntry?.file, projectDir]);

  // Calculate glow opacity from refineLevel directly (no async dependency).
  // This ensures the slider is instantly responsive — no waiting for API.
  const glowOpacity = useMemo(() => {
    const baseOpacity = litEntry?.opacity ?? 0.5;
    return baseOpacity * getRefineAlpha(refineLevel);
  }, [litEntry?.opacity, refineLevel]);

  // Keep all shader uniforms in sync every frame.
  // R3F doesn't deep-update uniform values on re-render, so we must
  // push new values via the ref.
  useFrame((_, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value += delta;
      materialRef.current.uniforms.opacity.value = glowOpacity;
      materialRef.current.uniforms.animType.value = litEntry.anim_type;
      if (glowTexture) {
        materialRef.current.uniforms.glowMap.value = glowTexture;
      }
    }
  });

  if (!glowTexture || !litEntry || !glowMesh.geometry) {
    return null;
  }

  const { blending, blendSrc, blendDst } = getBlendingForTranspType(
    litEntry.transp_type
  );

  return (
    <mesh
      geometry={glowMesh.geometry}
      position={glowMesh.position}
      rotation={glowMesh.rotation}
      scale={glowMesh.scale}
    >
      <shaderMaterial
        key={`${litEntry.transp_type}`}
        ref={materialRef}
        vertexShader={glowVertexShader}
        fragmentShader={glowFragmentShader}
        uniforms={{
          glowMap: { value: glowTexture },
          opacity: { value: glowOpacity },
          time: { value: 0 },
          animType: { value: litEntry.anim_type },
        }}
        transparent
        blending={blending}
        {...(blendSrc !== undefined && { blendSrc })}
        {...(blendDst !== undefined && { blendDst })}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
