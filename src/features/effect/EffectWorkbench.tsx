import { effectDataAtom } from "@/store/effect";
import { useAtomValue } from "jotai";

export default function EffectWorkbench() {
  const effectData = useAtomValue(effectDataAtom);

  return (
    <div className="flex h-full w-full items-center justify-center">
      {effectData ? (
        <div className="text-center">
          <div className="text-lg font-semibold">Effect Loaded</div>
          <div className="text-sm text-muted-foreground">
            {effectData.subEffects.length} sub-effects
          </div>
        </div>
      ) : (
        <div className="text-center text-sm text-muted-foreground">
          Select an effect file to begin editing.
        </div>
      )}
    </div>
  );
}
