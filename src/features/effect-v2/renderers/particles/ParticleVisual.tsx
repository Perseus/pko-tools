import { ParSystem } from "@/types/effect-v2";
import { useLoadEffect } from "../../useLoadEffect";
import { EffectRenderer } from "../EffectRenderer";

interface ParticleVisualProps {
  system: ParSystem;
  loop?: boolean;
}

/**
 * Renders the visual template for a particle system.
 * If the system's modelName references an .eff file, loads and renders it.
 */
export function ParticleVisual({ system, loop: _loop }: ParticleVisualProps) {
  const effFiles = useLoadEffect(
    system.modelName.endsWith('.eff') ? [system.modelName] : []
  );

  if (effFiles.length > 0) {
    if (effFiles.length > 1) {
      console.error('has more than one effect, but rendering just one in ParticleVisual');
    }
    return <EffectRenderer effect={effFiles[0]} />;
  }

  return null;
}
