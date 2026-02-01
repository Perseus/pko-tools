import { Button } from "@/components/ui/button";
import {
  effectDataAtom,
  effectPlaybackAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { useAtom } from "jotai";
import { Pause, Play, Repeat, Square } from "lucide-react";
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
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title={playback.isPlaying ? "Pause playback" : "Play animation"}
          onClick={() => setPlayback({ ...playback, isPlaying: !playback.isPlaying })}
        >
          {playback.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Stop and reset to frame 0"
          onClick={() => setPlayback({ ...playback, isPlaying: false, currentTime: 0 })}
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant={playback.isLooping ? "secondary" : "ghost"}
          className="h-7 w-7"
          title={playback.isLooping ? "Looping enabled - click to disable" : "Enable loop playback"}
          onClick={() => setPlayback({ ...playback, isLooping: !playback.isLooping })}
        >
          <Repeat className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-0.5 border-l border-border pl-2" role="group" aria-label="playback-speed">
          {[0.25, 0.5, 1, 2].map((speed) => (
            <Button
              key={speed}
              size="sm"
              variant={playback.speed === speed ? "secondary" : "ghost"}
              className="h-6 px-1.5 text-[10px]"
              title={`Set playback speed to ${speed}x`}
              aria-label={`speed-${speed}`}
              onClick={() => setPlayback({ ...playback, speed })}
            >
              {speed}x
            </Button>
          ))}
        </div>
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
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Frame {frameCount ? safeFrame + 1 : 0}/{frameCount}
        </span>
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
