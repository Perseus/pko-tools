import type { EffectFile, SubEffect } from "@/types/effect";
import * as THREE from "three";

// D3D8-accurate sub-effect shaders — shared between EffectSubRenderer and HitSubEffect.
// ALPHAOP = MODULATE(TEXTURE, DIFFUSE): textureAlpha × vertexAlpha per fragment.

export const subEffectVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const subEffectFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uTexture;
uniform bool uHasTexture;
uniform float uAlphaTest;

varying vec2 vUv;

void main() {
  if (uHasTexture) {
    vec4 texColor = texture2D(uTexture, vUv);
    float finalAlpha = texColor.a * uOpacity;
    if (finalAlpha < uAlphaTest) discard;
    gl_FragColor = vec4(uColor * texColor.rgb, finalAlpha);
  } else {
    if (uOpacity < uAlphaTest) discard;
    gl_FragColor = vec4(uColor, uOpacity);
  }
}
`;

export type FrameRenderData = {
  subEffect: SubEffect;
  size: [number, number, number];
  angle: [number, number, number];
  position: [number, number, number];
  color: [number, number, number, number];
  frameIndex: number;
};

const DEFAULT_FRAME_DURATION = 1 / 30;

export function resolveFrameData(
  effectData: EffectFile | null,
  selectedSubEffectIndex: number | null,
  selectedFrameIndex: number
): FrameRenderData | null {
  if (!effectData || selectedSubEffectIndex === null) {
    return null;
  }

  const subEffect = effectData.subEffects[selectedSubEffectIndex];
  if (!subEffect) {
    return null;
  }

  const maxFrame = Math.max(subEffect.frameCount - 1, 0);
  const frameIndex = Math.min(Math.max(selectedFrameIndex, 0), maxFrame);

  return {
    subEffect,
    frameIndex,
    size: subEffect.frameSizes[frameIndex] ?? [1, 1, 1],
    angle: subEffect.frameAngles[frameIndex] ?? [0, 0, 0],
    position: subEffect.framePositions[frameIndex] ?? [0, 0, 0],
    color: subEffect.frameColors[frameIndex] ?? [1, 1, 1, 1],
  };
}

export type GeometryConfig = {
  type: "plane" | "rect" | "rectPlane" | "rectZ" | "triangle" | "trianglePlane" | "triangleZ" | "cylinder" | "model";
  topRadius?: number;
  botRadius?: number;
  height?: number;
  segments?: number;
  bottomUvV?: number;
  modelName?: string;
};

const BUILTIN_NAMES = new Set([
  "",
  "Cylinder",
  "Cone",
  "Rect",
  "RectZ",
  "RectPlane",
  "Triangle",
  "TrianglePlane",
]);

/**
 * Determine geometry from the sub-effect's modelName field.
 * In PKO, geometry shape is defined by modelName (Cylinder, Cone, Rect, etc.),
 * NOT by effectType (which controls texture/UV animation mode).
 * When useParam > 0, per-frame cylinder params override sub-effect level params.
 */
export function resolveGeometry(subEffect: SubEffect, frameIndex?: number): GeometryConfig {
  const modelName = subEffect.modelName.trim();

  if (modelName === "Cylinder" || modelName === "Cone") {
    const bottomUvV = modelName === "Cone" ? 1.5 : 1;
    const defaultTopRadius = modelName === "Cone" ? 0 : 0.5;
    if (subEffect.useParam > 0 && subEffect.perFrameCylinder.length > 0 && frameIndex !== undefined) {
      const params = subEffect.perFrameCylinder[frameIndex] ?? subEffect.perFrameCylinder[0];
      return {
        type: "cylinder",
        topRadius: params.topRadius ?? defaultTopRadius,
        botRadius: params.botRadius ?? 0.5,
        height: params.height ?? 1.0,
        segments: Math.max(params.segments ?? 16, 3),
        bottomUvV,
      };
    }
    return {
      type: "cylinder",
      topRadius: subEffect.topRadius ?? defaultTopRadius,
      botRadius: subEffect.botRadius ?? 0.5,
      height: subEffect.height ?? 1.0,
      segments: Math.max(subEffect.segments ?? 16, 3),
      bottomUvV,
    };
  }

  // Non-built-in name → external .lgo model file
  if (modelName && !BUILTIN_NAMES.has(modelName)) {
    return { type: "model", modelName };
  }

  // PKO built-in geometry types with specific vertex layouts.
  // C++ I_Effect.cpp: Rect=XZ, RectPlane=XY, RectZ=YZ, Triangle=XZ, TrianglePlane=XY
  if (modelName === "Rect") {
    return { type: "rect" };
  }
  if (modelName === "RectPlane") {
    return { type: "rectPlane" };
  }
  if (modelName === "RectZ") {
    return { type: "rectZ" };
  }
  if (modelName === "Triangle") {
    return { type: "triangle" };
  }
  if (modelName === "TrianglePlane") {
    return { type: "trianglePlane" };
  }

  // Empty modelName → default rect (same as "Rect" in PKO)
  return { type: "rect" };
}

/**
 * Create a BufferGeometry for the PKO "Rect" type — XZ plane, normal +Y.
 * C++ CreateRect(): (-0.5,0,0), (-0.5,0,1), (0.5,0,1), (0.5,0,0)
 * Z range [0,1] (not centered). UVs: (0,1),(0,0),(1,0),(1,1).
 */
export function createRectGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, 0, // v0
    -0.5, 0, 1, // v1
     0.5, 0, 1, // v2
     0.5, 0, 0, // v3
  ]);
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  const uvs = new Float32Array([
    0, 1, // v0
    0, 0, // v1
    1, 0, // v2
    1, 1, // v3
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Create a BufferGeometry for the PKO "RectPlane" type — XY plane, normal +Z.
 * C++ CreatePlaneRect(): (-0.5,-0.5,0), (-0.5,0.5,0), (0.5,0.5,0), (0.5,-0.5,0)
 * Centered on both axes. UVs: (0,1),(0,0),(1,0),(1,1).
 */
export function createRectPlaneGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, -0.5, 0, // v0
    -0.5,  0.5, 0, // v1
     0.5,  0.5, 0, // v2
     0.5,-0.5, 0, // v3
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0, 1, // v0
    0, 0, // v1
    1, 0, // v2
    1, 1, // v3
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Create a BufferGeometry for the PKO "RectZ" type — YZ plane, normal +X.
 * C++ CreateRectZ(): (0,0,0), (0,0,1), (0,1,1), (0,1,0)
 * Y/Z range [0,1]. UVs: (0,1),(0,0),(1,0),(1,1).
 */
export function createRectZGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    0, 0, 0, // v0
    0, 0, 1, // v1
    0, 1, 1, // v2
    0, 1, 0, // v3
  ]);
  const normals = new Float32Array([
    1, 0, 0,
    1, 0, 0,
    1, 0, 0,
    1, 0, 0,
  ]);
  const uvs = new Float32Array([
    0, 1, // v0
    0, 0, // v1
    1, 0, // v2
    1, 1, // v3
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Create a BufferGeometry for the PKO "Triangle" type — XZ plane, normal +Y.
 * C++ CreateTriangle(): (0,0,0.5), (-0.5,0,0), (0.5,0,0)
 * Tip at Z=0.5, base at Z=0. UVs: (0.5,0),(0,1),(1,1).
 */
export function createTriangleGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
     0,    0,  0.5, // tip
    -0.5,  0,  0,   // base-left
     0.5,  0,  0,   // base-right
  ]);
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  const uvs = new Float32Array([
    0.5, 0, // tip
    0,   1, // base-left
    1,   1, // base-right
  ]);
  const indices = new Uint16Array([0, 1, 2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Create a BufferGeometry for the PKO "TrianglePlane" type — XY plane, normal +Z.
 * C++ CreatePlaneTriangle(): (0,0.5,0), (-0.5,-0.5,0), (0.5,-0.5,0)
 * Tip at Y=0.5, base at Y=-0.5. UVs: (0.5,0),(0,1),(1,1).
 */
export function createTrianglePlaneGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
     0,    0.5,  0, // tip
    -0.5, -0.5,  0, // base-left
     0.5, -0.5,  0, // base-right
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0.5, 0, // tip
    0,   1, // base-left
    1,   1, // base-right
  ]);
  const indices = new Uint16Array([0, 1, 2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Create a BufferGeometry for the PKO Cylinder/Cone — Z-axis, base at Z=0.
 * C++ CreateCylinder(): base Z=0, top Z=h, extends along Z-axis.
 * Wraps THREE.CylinderGeometry (Y-axis) + rotateX(-π/2) + translateZ(h/2).
 */
export function createCylinderGeometry(
  topRadius = 0.5,
  botRadius = 0.5,
  height = 1.0,
  segments = 16,
  bottomUvV = 1,
): THREE.BufferGeometry {
  const seg = Math.max(segments, 3);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const normalizeZero = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;

  for (let i = 0; i <= seg; i++) {
    const angle = (2 * Math.PI * i) / seg;
    const sin = normalizeZero(Math.sin(angle));
    const cos = normalizeZero(Math.cos(angle));
    const u = 1 - i / seg;

    positions.push(
      normalizeZero(topRadius * sin),
      normalizeZero(topRadius * cos),
      height,
      normalizeZero(botRadius * sin),
      normalizeZero(botRadius * cos),
      0,
    );
    normals.push(sin, cos, 0, sin, cos, 0);
    uvs.push(u, 0, u, bottomUvV);
  }

  for (let i = 0; i < seg; i++) {
    const top0 = i * 2;
    const bot0 = top0 + 1;
    const top1 = top0 + 2;
    const bot1 = top0 + 3;
    indices.push(top0, bot0, top1, top1, bot0, bot1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Map a D3DBLEND enum value to the corresponding Three.js blend factor constant.
 * See: https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dblend
 */
function d3dBlendToThree(d3dBlend: number): THREE.BlendingSrcFactor {
  switch (d3dBlend) {
    case 1: return THREE.ZeroFactor;
    case 2: return THREE.OneFactor;
    case 3: return THREE.SrcColorFactor;
    case 4: return THREE.OneMinusSrcColorFactor;
    case 5: return THREE.SrcAlphaFactor;
    case 6: return THREE.OneMinusSrcAlphaFactor;
    case 7: return THREE.DstAlphaFactor;
    case 8: return THREE.OneMinusDstAlphaFactor;
    case 9: return THREE.DstColorFactor;
    case 10: return THREE.OneMinusDstColorFactor;
    case 11: return THREE.SrcAlphaSaturateFactor;
    default: return THREE.SrcAlphaFactor; // safe fallback
  }
}

function d3dBlendToThreeForEffectBackbuffer(d3dBlend: number): THREE.BlendingSrcFactor {
  // PKO renders effects into the game backbuffer, not a transparent WebGL canvas.
  // In that target, DESTALPHA behaves as opaque destination alpha for authored
  // effects such as lryf/shadowf02; using WebGL destination alpha exposes black
  // texture rectangles that the D3D client does not show.
  switch (d3dBlend) {
    case 7: return THREE.OneFactor;
    case 8: return THREE.ZeroFactor;
    default: return d3dBlendToThree(d3dBlend);
  }
}

export function resolveBlendFactors(srcBlend: number, destBlend: number): {
  blendSrc: THREE.BlendingSrcFactor;
  blendDst: THREE.BlendingDstFactor;
} {
  return {
    blendSrc: d3dBlendToThreeForEffectBackbuffer(srcBlend),
    blendDst: d3dBlendToThreeForEffectBackbuffer(destBlend) as THREE.BlendingDstFactor,
  };
}

/**
 * Create a DataTexture with correct settings for effect rendering.
 * Both the effect editor and item viewer must use identical texture setup
 * to avoid visual discrepancies (colorSpace, flipY, filtering).
 */
export function createEffectTexture(
  data: Uint8Array,
  width: number,
  height: number,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function resolveTextureName(subEffect: SubEffect, selectedFrameIndex: number) {
  if (subEffect.frameTexNames.length > 0) {
    return subEffect.frameTexNames[selectedFrameIndex] ?? subEffect.frameTexNames[0];
  }
  return subEffect.texName;
}

export function resolveTextureCandidates(textureName: string, projectDirectory: string) {
  const sanitized = textureName.trim();
  if (!sanitized) {
    return [];
  }

  const hasExtension = sanitized.includes(".");
  const nameCandidates = hasExtension
    ? [sanitized]
    : [sanitized, `${sanitized}.png`, `${sanitized}.dds`, `${sanitized}.tga`, `${sanitized}.bmp`];
  const directories = [
    "texture",
    "texture/effect",
    "texture/skill",
    "texture/lit",
    "texture/sceneffect",
  ];

  const roots = [projectDirectory, `${projectDirectory}/Data`];
  const candidates = roots.flatMap((root) =>
    directories.flatMap((dir) =>
      nameCandidates.map((name) => `${root}/${dir}/${name}`)
    )
  );

  return Array.from(new Set(candidates));
}

export function resolveFrameDurations(subEffect: SubEffect) {
  if (subEffect.frameTimes.length > 0) {
    return subEffect.frameTimes.map((time) => Math.max(time, DEFAULT_FRAME_DURATION));
  }
  return Array.from({ length: subEffect.frameCount }, () => DEFAULT_FRAME_DURATION);
}
