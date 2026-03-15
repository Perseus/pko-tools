import { BlendingDstFactor, DstAlphaFactor, DstColorFactor, OneFactor, OneMinusDstAlphaFactor, OneMinusDstColorFactor, OneMinusSrcAlphaFactor, OneMinusSrcColorFactor, SrcAlphaFactor, SrcColorFactor, ZeroFactor } from "three";

/*
  **
 * Extract the texture base name from a sub - effect's texName.
  * Strips.dds /.tga extensions if present.Returns null if empty.
 */
export function getTextureName(texName: string): string | null {
  const trimmed = texName.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.endsWith(".dds") || lower.endsWith(".tga")) {
    return trimmed.slice(0, -4);
  }

  return trimmed;
}

export function getThreeJSBlendFromD3D(d3dBlend: number): BlendingDstFactor {
  switch (d3dBlend) {
    case 1:
      return ZeroFactor;
    case 2:
      return OneFactor;
    case 3:
      return SrcColorFactor;
    case 4:
      return OneMinusSrcColorFactor;
    case 5:
      return SrcAlphaFactor;
    case 6:
      return OneMinusSrcAlphaFactor;
    case 7:
      return DstAlphaFactor;
    case 8:
      return OneMinusDstAlphaFactor;
    case 9:
      return DstColorFactor;
    case 10:
      return OneMinusDstColorFactor;
    default:
      console.error('Unhandled D3DBlend number', d3dBlend);
      return ZeroFactor;
  }
}

/**
 * 
 * Raw texture data in PKO seems to require 1-u, 1-v to get accurate rendering in Three.JS.
 * Three's CanvasTexture already does flipY, so 1-v is taken care of
 * We do 1-u here to completely fix the orientation
 **/
export function getMappedUVs(uvs: [number, number][]): [number, number][] {
  const mappedUVs = uvs.map(([u, v]) => {
    return [1 - u, v] as [number, number];
  });

  return mappedUVs;
}
