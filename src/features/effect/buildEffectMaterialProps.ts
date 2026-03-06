/**
 * Shared material property builder for PKO sub-effects.
 *
 * Produces MeshBasicMaterial parameters from sub-effect blend settings
 * and optional PKO technique state. Used by both the standalone effect
 * viewer and the item effect viewer.
 */
import * as THREE from "three";
import type { SubEffect } from "@/types/effect";
import { resolveBlendFactors } from "@/features/effect/rendering";
import type { PkoTechniqueState } from "@/features/effect/pkoStateEmulation";

export interface EffectMaterialProps {
  toneMapped: boolean;
  fog: boolean;
  transparent: boolean;
  opacity: number;
  blending: THREE.Blending;
  blendSrc: THREE.BlendingSrcFactor;
  blendDst: THREE.BlendingDstFactor;
  depthTest: boolean;
  depthWrite: boolean;
  alphaTest: number;
  side: THREE.Side;
  map: THREE.Texture | null;
}

/**
 * Build material properties for a sub-effect.
 *
 * When techniqueState is provided (standalone viewer), it drives depth/alpha/cull.
 * When absent (item viewer without technique wiring), sensible defaults are used
 * that match technique 0 behavior.
 */
export function buildEffectMaterialProps(
  sub: SubEffect,
  texture: THREE.Texture | null,
  techniqueState?: PkoTechniqueState | null,
): EffectMaterialProps {
  const useAlpha = sub.alpha !== false;
  const blendFactors = resolveBlendFactors(sub.srcBlend, sub.destBlend);

  // Technique-driven properties (fall back to technique 0 defaults)
  const techDepthTest = techniqueState ? techniqueState.zEnable : true;
  const techDepthWrite = techniqueState
    ? (techniqueState.zWriteEnable || !useAlpha)
    : !useAlpha;
  const techAlphaTest = techniqueState?.alphaTestEnable
    ? (techniqueState.alphaFunc === 6 /* D3DCMP_NOTEQUAL */ ? 1 / 255 : 0)
    : 0;
  const techSide = techniqueState
    ? (techniqueState.cullMode === 3 /* D3DCULL_CCW */ ? THREE.BackSide
       : techniqueState.cullMode === 2 /* D3DCULL_CW */ ? THREE.FrontSide
       : THREE.DoubleSide)
    : THREE.DoubleSide;

  return {
    toneMapped: false,
    fog: false,
    transparent: useAlpha || techAlphaTest > 0,
    opacity: useAlpha ? 1 : 1,
    blending: useAlpha ? THREE.CustomBlending : THREE.NormalBlending,
    blendSrc: blendFactors.blendSrc,
    blendDst: blendFactors.blendDst,
    depthTest: techDepthTest,
    depthWrite: techDepthWrite,
    alphaTest: techAlphaTest,
    side: techSide,
    map: texture,
  };
}
