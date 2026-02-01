/// <reference types="@react-three/fiber" />
import { selectedSubEffectIndexAtom } from "@/store/effect";
import { useAtomValue } from "jotai";
import React from "react";
import EffectSubRenderer from "@/features/effect/EffectSubRenderer";

/**
 * Backward-compatible wrapper that renders the currently selected sub-effect.
 * New code should use EffectSubRenderer directly with a subEffectIndex prop.
 * @deprecated Use EffectSubRenderer instead.
 */
export default function EffectMeshRenderer() {
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);

  if (selectedSubEffectIndex === null) {
    return null;
  }

  return <EffectSubRenderer subEffectIndex={selectedSubEffectIndex} />;
}
