import { EffectFile } from "@/types/effect";
import { SubEffectRenderer } from "./SubEffectRenderer";

interface EffectRendererProps {
  effect: EffectFile;
}

/** Renders all sub-effects within a single .eff file. */
export function EffectRenderer({ effect }: EffectRendererProps) {
  return (
    <group>
      {effect.subEffects.map((sub, i) => (
        <SubEffectRenderer key={i} subEffect={sub} />
      ))}
    </group>
  );
}
