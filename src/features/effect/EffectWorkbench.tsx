import { effectDataAtom } from "@/store/effect";
import { useAtomValue } from "jotai";
import EffectViewport from "@/features/effect/EffectViewport";
import SubEffectList from "@/features/effect/SubEffectList";
import KeyframeTimeline from "@/features/effect/KeyframeTimeline";
import KeyframeProperties from "@/features/effect/KeyframeProperties";
import PlaybackControls from "@/features/effect/PlaybackControls";

export default function EffectWorkbench() {
  const effectData = useAtomValue(effectDataAtom);

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">Effect Editor</div>
          <div className="text-sm text-muted-foreground">
            {effectData
              ? `${effectData.subEffects.length} sub-effects loaded`
              : "Select an effect file to begin."}
          </div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <SubEffectList />
        <div className="flex min-h-[400px] flex-col gap-4">
          <EffectViewport />
          <KeyframeTimeline />
        </div>
        <div className="flex flex-col gap-4">
          <KeyframeProperties />
          <PlaybackControls />
        </div>
      </div>
    </div>
  );
}
