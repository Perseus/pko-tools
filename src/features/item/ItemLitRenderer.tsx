import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ItemLitEntry } from "@/types/item";
import { invoke } from "@tauri-apps/api/core";

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
 *
 * The game renders the glow as subset 1 (a separate mesh) with its own
 * blend mode and opacity.  We replicate this: the shader outputs
 * vec4(lit.rgb, lit.a * opacity) and the material's blending (set per
 * transp_type) controls how it composites with the framebuffer.
 *
 * Animation types match the game's ANIM_CTRL_TYPE_TEXCOORD keyframe
 * system (ItemLitAnim.cpp).  The game runs at 30 fps; durations below
 * are derived from frame counts: 120f = 4s, 360f = 12s, 720f = 24s.
 *
 * UV rotation uses the D3D9 texture-coordinate transform convention:
 * rotation around the UV origin (0,0) with RepeatWrapping handling
 * any coordinates outside [0,1].
 *
 * Types (from __lit_proc array):
 *   1 — 120f Z-rotation (0 → 2π)
 *   2 — 120f position scroll (0,0) → (1,1)
 *   3 — 360f V scroll  (position.y 0 → 1)
 *   4 — 360f U scroll  (position.x 0 → 1)
 *   5 — 360f UV scroll (0,0) → (1,1)
 *   6 — 360f UV scroll + Z-rotation (forward)
 *   7 — 360f UV scroll + Z-rotation (reverse)
 *   8 — 720f Z-rotation (0 → 2π, half speed of type 1)
 */
const glowFragmentShader = `
  uniform sampler2D glowMap;
  uniform float opacity;
  uniform float time;
  uniform int animType;
  varying vec2 vUv;

  // Durations in seconds (frame count / 30 fps)
  #define DUR_120 4.0
  #define DUR_360 12.0
  #define DUR_720 24.0
  #define TWO_PI 6.28318530718

  // Rotate UV around origin (0,0) matching D3D9 row-vector convention.
  // RepeatWrapping on the texture handles coordinates outside [0,1].
  vec2 rotateUV(vec2 uv, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  }

  void main() {
    vec2 animUv = vUv;

    if (animType == 1) {
      // 120f rotation: full rotation over 4 seconds
      float angle = time * TWO_PI / DUR_120;
      animUv = rotateUV(vUv, angle);
    } else if (animType == 2) {
      // 120f position: scroll UV (0,0)→(1,1) over 4 seconds
      float rate = 1.0 / DUR_120;
      animUv = vUv + vec2(rate * time, rate * time);
    } else if (animType == 3) {
      // 360f V scroll: position.y 0→1 over 12 seconds
      animUv.y = vUv.y + time / DUR_360;
    } else if (animType == 4) {
      // 360f U scroll: position.x 0→1 over 12 seconds
      animUv.x = vUv.x + time / DUR_360;
    } else if (animType == 5) {
      // 360f UV scroll: (0,0)→(1,1) over 12 seconds
      float rate = 1.0 / DUR_360;
      animUv = vUv + vec2(rate * time, rate * time);
    } else if (animType == 6) {
      // 360f position + rotation (forward): both over 12 seconds
      float angle = time * TWO_PI / DUR_360;
      animUv = rotateUV(vUv, angle);
      float rate = 1.0 / DUR_360;
      animUv += vec2(rate * time, rate * time);
    } else if (animType == 7) {
      // 360f position + rotation (reverse): rotation goes 2π→0
      float angle = -time * TWO_PI / DUR_360;
      animUv = rotateUV(vUv, angle);
      float rate = 1.0 / DUR_360;
      animUv += vec2(rate * time, rate * time);
    } else if (animType == 8) {
      // 720f rotation: full rotation over 24 seconds (half speed of type 1)
      float angle = time * TWO_PI / DUR_720;
      animUv = rotateUV(vUv, angle);
    }

    vec4 glowColor = texture2D(glowMap, animUv);
    gl_FragColor = vec4(glowColor.rgb, glowColor.a * opacity);
  }
`;

/**
 * Map PKO transp_type values to Three.js blending configurations.
 *
 * From the game engine's lwResourceMgr.cpp SetTranspTypeBlendMode:
 *   0 = MTLTEX_TRANSP_FILTER      → SrcAlpha + InvSrcAlpha (standard alpha)
 *   1 = MTLTEX_TRANSP_ADDITIVE    → One + One  (with opacity: SrcAlpha + One)
 *   2 = MTLTEX_TRANSP_ADDITIVE1   → SrcColor + One
 *   3 = MTLTEX_TRANSP_ADDITIVE2   → SrcColor + InvSrcColor
 *   4 = MTLTEX_TRANSP_ADDITIVE3   → SrcAlpha + DstAlpha
 *   5 = MTLTEX_TRANSP_SUBTRACTIVE → Zero + InvSrcColor
 *
 * The game renders the glow overlay as a separate subset with its own blend
 * mode.  When opacity < 1.0 the ADDITIVE type switches from ONE+ONE to
 * SRCALPHA+ONE.  Since our shader always outputs alpha = litAlpha * opacity,
 * Three.js AdditiveBlending (SrcAlpha + One) handles both cases correctly.
 */
function getBlendingForTranspType(transpType: number): {
  blending: THREE.Blending;
  blendSrc?: THREE.BlendingDstFactor;
  blendDst?: THREE.BlendingDstFactor;
} {
  switch (transpType) {
    case 0:
      // FILTER: standard alpha blending (SrcAlpha + InvSrcAlpha)
      return { blending: THREE.NormalBlending };
    case 1:
      // Additive: SrcAlpha + One (Three.js AdditiveBlending)
      return { blending: THREE.AdditiveBlending };
    case 2:
      // SrcColor + One
      return {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcColorFactor as unknown as THREE.BlendingDstFactor,
        blendDst: THREE.OneFactor as unknown as THREE.BlendingDstFactor,
      };
    case 3:
      // SrcColor + InvSrcColor
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
      // Subtractive: Zero + InvSrcColor
      return { blending: THREE.SubtractiveBlending };
    default:
      return { blending: THREE.AdditiveBlending };
  }
}

interface ItemLitRendererProps {
  litEntry: ItemLitEntry;
  glowMesh: THREE.Mesh;
  projectDir: string;
}

export function ItemLitRenderer({
  litEntry,
  glowMesh,
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

  // Use the lit entry's opacity directly.  In the game, each lit tier has its
  // own opacity value in the lit data (set via LitResetTexture → SetOpacity).
  // The refine level selects which lit entry to use; we don't multiply by an
  // additional refine alpha — that factor only applies to .eff/.par effects.
  const glowOpacity = litEntry?.opacity ?? 0.5;

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
