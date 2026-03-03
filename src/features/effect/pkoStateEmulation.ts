/**
 * D3D8 render state emulation for PKO effects.
 * Ported from pko-map-lab/src/render/effects/pkoStateEmulation.js.
 * Maps Direct3D 8 render states to Three.js material properties.
 */
import * as THREE from "three";

// D3DBLEND constants
export const D3DBLEND_ZERO = 1;
export const D3DBLEND_ONE = 2;
export const D3DBLEND_SRCCOLOR = 3;
export const D3DBLEND_INVSRCCOLOR = 4;
export const D3DBLEND_SRCALPHA = 5;
export const D3DBLEND_INVSRCALPHA = 6;
export const D3DBLEND_DESTALPHA = 7;
export const D3DBLEND_INVDESTALPHA = 8;
export const D3DBLEND_DESTCOLOR = 9;
export const D3DBLEND_INVDESTCOLOR = 10;
export const D3DBLEND_SRCALPHA_SAT = 11;

// D3DTEXTUREFILTERTYPE constants
export const D3DTEXF_POINT = 1;
export const D3DTEXF_LINEAR = 2;

// D3DTEXTUREADDRESS constants
export const D3DTADDRESS_WRAP = 1;
export const D3DTADDRESS_MIRROR = 2;
export const D3DTADDRESS_CLAMP = 3;

// D3DCULL constants
export const D3DCULL_NONE = 1;
export const D3DCULL_CW = 2;
export const D3DCULL_CCW = 3;

// D3DCMPFUNC constants
export const D3DCMP_GREATER = 5;
export const D3DCMP_NOTEQUAL = 6;

/** PKO technique render state. */
export interface PkoTechniqueState {
  zEnable: boolean;
  zWriteEnable: boolean;
  alphaBlendEnable: boolean;
  alphaTestEnable: boolean;
  alphaRef: number;
  alphaFunc: number;
  cullMode: number;
  minFilter: number;
  magFilter: number;
  addressU: number;
  addressV: number;
  srcBlend?: number;
  destBlend?: number;
}

/** Default PKO effect technique state (technique 0 base). */
export const DEFAULT_PKO_TECHNIQUE: PkoTechniqueState = {
  zEnable: true,
  zWriteEnable: false,
  alphaBlendEnable: true,
  alphaTestEnable: false,
  alphaRef: 0,
  alphaFunc: D3DCMP_GREATER,
  cullMode: D3DCULL_NONE,
  minFilter: D3DTEXF_LINEAR,
  magFilter: D3DTEXF_LINEAR,
  addressU: D3DTADDRESS_CLAMP,
  addressV: D3DTADDRESS_CLAMP,
};

/** Per-technique state overrides (techniques 0-6). */
export const PKO_EFFECT_TECHNIQUE_OVERRIDES: Record<number, Partial<PkoTechniqueState>> = {
  0: {},
  1: {
    zWriteEnable: true,
    alphaBlendEnable: false,
    addressU: D3DTADDRESS_WRAP,
    addressV: D3DTADDRESS_WRAP,
  },
  2: {},
  3: {},
  4: {
    alphaTestEnable: true,
    alphaFunc: D3DCMP_NOTEQUAL,
    alphaRef: 0xff000000,
    addressU: D3DTADDRESS_WRAP,
    addressV: D3DTADDRESS_WRAP,
  },
  5: {
    zEnable: false,
    zWriteEnable: false,
    cullMode: D3DCULL_CCW,
    minFilter: D3DTEXF_POINT,
    magFilter: D3DTEXF_POINT,
    srcBlend: D3DBLEND_SRCALPHA,
    destBlend: D3DBLEND_INVSRCALPHA,
  },
  6: {
    zEnable: false,
    zWriteEnable: false,
    cullMode: D3DCULL_CCW,
    addressU: D3DTADDRESS_WRAP,
    addressV: D3DTADDRESS_WRAP,
    srcBlend: D3DBLEND_SRCALPHA,
    destBlend: D3DBLEND_INVSRCALPHA,
  },
};

/** Map D3DBLEND constant to Three.js blend factor. */
export function mapBlendFactor(value: number): THREE.BlendingDstFactor | null {
  switch (Number(value)) {
    case D3DBLEND_ZERO: return THREE.ZeroFactor;
    case D3DBLEND_ONE: return THREE.OneFactor;
    case D3DBLEND_SRCCOLOR: return THREE.SrcColorFactor;
    case D3DBLEND_INVSRCCOLOR: return THREE.OneMinusSrcColorFactor;
    case D3DBLEND_SRCALPHA: return THREE.SrcAlphaFactor;
    case D3DBLEND_INVSRCALPHA: return THREE.OneMinusSrcAlphaFactor;
    case D3DBLEND_DESTALPHA: return THREE.DstAlphaFactor;
    case D3DBLEND_INVDESTALPHA: return THREE.OneMinusDstAlphaFactor;
    case D3DBLEND_DESTCOLOR: return THREE.DstColorFactor;
    case D3DBLEND_INVDESTCOLOR: return THREE.OneMinusDstColorFactor;
    case D3DBLEND_SRCALPHA_SAT: return THREE.SrcAlphaSaturateFactor;
    default: return null;
  }
}

/** Map D3DTEXTUREFILTERTYPE to Three.js filter constant. */
export function mapTextureFilter(value: number, minFilter = false): THREE.TextureFilter {
  const v = Number(value);
  if (v === D3DTEXF_POINT) {
    return minFilter ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  }
  // D3DTEXF_LINEAR or default
  return minFilter ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
}

/** Map D3DTEXTUREADDRESS to Three.js wrapping constant. */
export function mapTextureAddress(value: number): THREE.Wrapping {
  switch (Number(value)) {
    case D3DTADDRESS_WRAP: return THREE.RepeatWrapping;
    case D3DTADDRESS_MIRROR: return THREE.MirroredRepeatWrapping;
    case D3DTADDRESS_CLAMP:
    default: return THREE.ClampToEdgeWrapping;
  }
}

/** Map D3DCULL mode to Three.js side constant. */
export function mapCullMode(cullMode: number): THREE.Side {
  const mode = Number(cullMode);
  if (mode === D3DCULL_CW) return THREE.FrontSide;
  if (mode === D3DCULL_CCW) return THREE.BackSide;
  return THREE.DoubleSide;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAlphaRef(alphaRef: number): number {
  const raw = Number(alphaRef);
  if (!Number.isFinite(raw)) return 0;
  if (raw > 255) return clamp(((raw >>> 24) & 0xff) / 255, 0, 1);
  if (raw > 1) return clamp(raw / 255, 0, 1);
  return clamp(raw, 0, 1);
}

function mapAlphaTestThreshold(alphaRef: number, alphaFunc: number): number {
  if (Number(alphaFunc) === D3DCMP_NOTEQUAL) return 1 / 255;
  return normalizeAlphaRef(alphaRef);
}

/** Get the merged technique state for a given technique index. */
export function getPkoTechniqueState(techniqueIndex: number): PkoTechniqueState {
  const idx = Number.isFinite(Number(techniqueIndex)) ? Number(techniqueIndex) : 0;
  return {
    ...DEFAULT_PKO_TECHNIQUE,
    ...(PKO_EFFECT_TECHNIQUE_OVERRIDES[idx] || {}),
  };
}

/** Compose technique state with optional per-effect overrides. */
export function composePkoRenderState(
  techniqueIndex: number,
  overrides: Partial<PkoTechniqueState> = {},
): PkoTechniqueState {
  return {
    ...getPkoTechniqueState(techniqueIndex),
    ...overrides,
  };
}

/** Apply texture sampling state to a Three.js texture. */
export function applyTextureSampling(
  texture: THREE.Texture | null,
  options: Partial<PkoTechniqueState> = {},
): void {
  if (!texture) return;
  texture.minFilter = mapTextureFilter(options.minFilter ?? D3DTEXF_LINEAR, true);
  texture.magFilter = mapTextureFilter(options.magFilter ?? D3DTEXF_LINEAR, false);
  texture.wrapS = mapTextureAddress(options.addressU ?? D3DTADDRESS_CLAMP);
  texture.wrapT = mapTextureAddress(options.addressV ?? D3DTADDRESS_CLAMP);
  texture.needsUpdate = true;
}

function applyBlendToMaterial(
  material: THREE.Material,
  srcBlend: number | undefined,
  dstBlend: number | undefined,
): void {
  const src = mapBlendFactor(srcBlend ?? D3DBLEND_SRCALPHA);
  const dst = mapBlendFactor(dstBlend ?? D3DBLEND_INVSRCALPHA);
  if (!src || !dst) {
    material.transparent = true;
    material.blending = THREE.NormalBlending;
    material.depthWrite = false;
    return;
  }
  material.transparent = true;
  material.blending = THREE.CustomBlending;
  material.blendSrc = src;
  material.blendDst = dst;
  material.blendEquation = THREE.AddEquation;
  material.depthWrite = false;
}

/** Apply PKO render state to a Three.js material. */
export function applyPkoRenderState(
  material: THREE.Material,
  options: Partial<PkoTechniqueState> = {},
): void {
  const state = { ...options };
  const alphaBlendEnable = state.alphaBlendEnable !== false;
  const zEnable = state.zEnable !== false;
  const zWriteEnable = state.zWriteEnable != null ? Boolean(state.zWriteEnable) : !alphaBlendEnable;
  const alphaTestEnable = Boolean(state.alphaTestEnable);
  const alphaTest = alphaTestEnable
    ? mapAlphaTestThreshold(state.alphaRef ?? 0, state.alphaFunc ?? D3DCMP_GREATER)
    : 0;

  material.depthTest = zEnable;
  material.depthWrite = zWriteEnable;
  material.side = mapCullMode(state.cullMode ?? D3DCULL_NONE);
  material.fog = false;
  material.toneMapped = false;

  if (alphaBlendEnable) {
    applyBlendToMaterial(material, state.srcBlend, state.destBlend);
  } else {
    material.transparent = alphaTestEnable;
    material.blending = THREE.NoBlending;
    material.depthWrite = zWriteEnable;
  }

  material.alphaTest = alphaTest;
  material.needsUpdate = true;
}

/** Material state snapshot for testing and regression detection. */
export interface MaterialStateSnapshot {
  transparent: boolean;
  depthWrite: boolean;
  depthTest: boolean;
  alphaTest: number;
  blending: number;
  side: number;
}

/** Capture material render state for snapshot comparison. */
export function snapshotMaterialState(material: THREE.Material): MaterialStateSnapshot {
  return {
    transparent: Boolean(material.transparent),
    depthWrite: Boolean(material.depthWrite),
    depthTest: Boolean(material.depthTest),
    alphaTest: Number(material.alphaTest || 0),
    blending: Number(material.blending ?? 0),
    side: Number(material.side ?? THREE.FrontSide),
  };
}
