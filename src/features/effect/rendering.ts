import { EffectFile, SubEffect } from "@/types/effect";
import * as THREE from "three";

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
  type: "plane" | "rect" | "rectZ" | "triangle" | "triangleZ" | "cylinder" | "sphere" | "model";
  topRadius?: number;
  botRadius?: number;
  height?: number;
  segments?: number;
  modelName?: string;
};

const BUILTIN_NAMES = new Set([
  "",
  "Cylinder",
  "Cone",
  "Sphere",
  "Rect",
  "RectZ",
  "RectPlane",
  "Triangle",
  "TrianglePlane",
]);

/**
 * Determine geometry from the sub-effect's modelName field.
 * In PKO, geometry shape is defined by modelName (Cylinder, Cone, Sphere, Rect, etc.),
 * NOT by effectType (which controls texture/UV animation mode).
 * When useParam > 0, per-frame cylinder params override sub-effect level params.
 */
export function resolveGeometry(subEffect: SubEffect, frameIndex?: number): GeometryConfig {
  const modelName = subEffect.modelName.trim();

  if (modelName === "Cylinder" || modelName === "Cone") {
    if (subEffect.useParam > 0 && subEffect.perFrameCylinder.length > 0 && frameIndex !== undefined) {
      const params = subEffect.perFrameCylinder[frameIndex] ?? subEffect.perFrameCylinder[0];
      return {
        type: "cylinder",
        topRadius: params.topRadius || 0.5,
        botRadius: params.botRadius || 0.5,
        height: params.height || 1.0,
        segments: Math.max(params.segments || 16, 3),
      };
    }
    return {
      type: "cylinder",
      topRadius: subEffect.topRadius || 0.5,
      botRadius: subEffect.botRadius || 0.5,
      height: subEffect.height || 1.0,
      segments: Math.max(subEffect.segments || 16, 3),
    };
  }

  if (modelName === "Sphere") {
    return { type: "sphere" };
  }

  // Non-built-in name → external .lgo model file
  if (modelName && !BUILTIN_NAMES.has(modelName)) {
    return { type: "model", modelName };
  }

  // PKO built-in geometry types with specific vertex layouts
  if (modelName === "Rect") {
    return { type: "rect" };
  }
  if (modelName === "RectZ" || modelName === "RectPlane") {
    return { type: "rectZ" };
  }
  if (modelName === "Triangle") {
    return { type: "triangle" };
  }
  if (modelName === "TrianglePlane") {
    return { type: "triangleZ" };
  }

  // Empty modelName → default XY rect (same as "Rect" in PKO)
  return { type: "rect" };
}

/**
 * Create a BufferGeometry for the PKO "Rect" type — XY plane, normal +Z.
 * 4 vertices: (-0.5,-0.5,0) to (0.5,0.5,0), UVs (0,1)→(1,0).
 */
export function createRectGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, -0.5, 0, // bottom-left
     0.5, -0.5, 0, // bottom-right
     0.5,  0.5, 0, // top-right
    -0.5,  0.5, 0, // top-left
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0, 1, // bottom-left
    1, 1, // bottom-right
    1, 0, // top-right
    0, 0, // top-left
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
 * Create a BufferGeometry for the PKO "RectZ"/"RectPlane" type — XZ plane, normal +Y.
 * 4 vertices: (-0.5,0,-0.5) to (0.5,0,0.5).
 */
export function createRectZGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, -0.5, // back-left
     0.5, 0, -0.5, // back-right
     0.5, 0,  0.5, // front-right
    -0.5, 0,  0.5, // front-left
  ]);
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  const uvs = new Float32Array([
    0, 0, // back-left
    1, 0, // back-right
    1, 1, // front-right
    0, 1, // front-left
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
 * Create a BufferGeometry for the PKO "Triangle" type — XY plane.
 * 3 vertices: (0,0.5,0), (-0.5,-0.5,0), (0.5,-0.5,0).
 */
export function createTriangleGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
     0,    0.5,  0, // top
    -0.5, -0.5,  0, // bottom-left
     0.5, -0.5,  0, // bottom-right
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0.5, 0, // top
    0,   1, // bottom-left
    1,   1, // bottom-right
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
 * Create a BufferGeometry for the PKO "TrianglePlane" type — XZ plane.
 * 3 vertices: (0,0,0.5), (-0.5,0,-0.5), (0.5,0,-0.5).
 */
export function createTriangleZGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
     0,   0,  0.5, // front
    -0.5, 0, -0.5, // back-left
     0.5, 0, -0.5, // back-right
  ]);
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  const uvs = new Float32Array([
    0.5, 0, // front
    0,   1, // back-left
    1,   1, // back-right
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

export function resolveBlendFactors(srcBlend: number, destBlend: number): {
  blendSrc: THREE.BlendingSrcFactor;
  blendDst: THREE.BlendingDstFactor;
} {
  return {
    blendSrc: d3dBlendToThree(srcBlend),
    blendDst: d3dBlendToThree(destBlend) as THREE.BlendingDstFactor,
  };
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

  return directories.flatMap((dir) =>
    nameCandidates.map((name) => `${projectDirectory}/${dir}/${name}`)
  );
}

export function resolveFrameDurations(subEffect: SubEffect) {
  if (subEffect.frameTimes.length > 0) {
    return subEffect.frameTimes.map((time) => Math.max(time, DEFAULT_FRAME_DURATION));
  }
  return Array.from({ length: subEffect.frameCount }, () => DEFAULT_FRAME_DURATION);
}
