import { effectDataAtom, selectedFrameIndexAtom, selectedSubEffectIndexAtom } from "@/store/effect";
import { useAtom } from "jotai";
import { useMemo } from "react";

export default function KeyframeTimeline() {
  const [selectedFrame, setSelectedFrame] = useAtom(selectedFrameIndexAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);
  const [effectData] = useAtom(effectDataAtom);

  const frameCount = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) {
      return 0;
    }
    return effectData.subEffects[selectedSubEffectIndex]?.frameCount ?? 0;
  }, [effectData, selectedSubEffectIndex]);

  const safeFrame = Math.min(Math.max(selectedFrame, 0), Math.max(frameCount - 1, 0));

  return (
    <div className="rounded-xl border border-border bg-background/70 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Timeline</div>
          <div className="text-xs text-muted-foreground">
            {frameCount > 0 ? `${frameCount} frames` : "Select a sub-effect"}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">Frame {frameCount ? safeFrame + 1 : 0}</div>
      </div>
      <div className="mt-3">
        <input
          type="range"
          min={0}
          max={Math.max(frameCount - 1, 0)}
          value={safeFrame}
          onChange={(event) => setSelectedFrame(Number(event.target.value))}
          disabled={frameCount === 0}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        />
      </div>
    </div>
  );
}
