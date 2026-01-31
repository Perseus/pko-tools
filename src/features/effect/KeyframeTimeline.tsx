import {
  effectDataAtom,
  effectPlaybackAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { useAtom } from "jotai";
import React from "react";
import { useMemo } from "react";

export default function KeyframeTimeline() {
  const [selectedFrame, setSelectedFrame] = useAtom(selectedFrameIndexAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);
  const [effectData] = useAtom(effectDataAtom);
  const [playback, setPlayback] = useAtom(effectPlaybackAtom);

  const { frameCount, frameDurations, frameTextures } = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) {
      return { frameCount: 0, frameDurations: [] as number[], frameTextures: [] as string[] };
    }

    const subEffect = effectData.subEffects[selectedSubEffectIndex];
    if (!subEffect) {
      return { frameCount: 0, frameDurations: [] as number[], frameTextures: [] as string[] };
    }

    const durations = subEffect.frameTimes.length
      ? subEffect.frameTimes.map((time) => Math.max(time, 1 / 30))
      : Array.from({ length: subEffect.frameCount }, () => 1 / 30);

    return {
      frameCount: subEffect.frameCount,
      frameDurations: durations,
      frameTextures: subEffect.frameTexNames,
    };
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
          aria-label="timeline-scrubber"
          onChange={(event) => {
            const nextFrame = Number(event.target.value);
            setSelectedFrame(nextFrame);
            const time = frameDurations.slice(0, nextFrame).reduce((sum, value) => sum + value, 0);
            setPlayback({
              ...playback,
              currentTime: time,
              isPlaying: false,
            });
          }}
          disabled={frameCount === 0}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        />
      </div>
      {frameCount > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {Array.from({ length: frameCount }).map((_, index) => {
            const label = frameTextures[index] || "--";
            const isActive = index === safeFrame;
            return (
              <button
                key={`frame-${index}`}
                type="button"
                onClick={() => {
                  setSelectedFrame(index);
                  const time = frameDurations
                    .slice(0, index)
                    .reduce((sum, value) => sum + value, 0);
                  setPlayback({
                    ...playback,
                    currentTime: time,
                    isPlaying: false,
                  });
                }}
                className={
                  isActive
                    ? "rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-primary"
                    : "rounded-full border border-border bg-muted/40 px-2 py-1"
                }
              >
                {index + 1}: {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
