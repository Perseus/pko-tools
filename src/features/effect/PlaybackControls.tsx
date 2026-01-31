import { Button } from "@/components/ui/button";
import { effectPlaybackAtom } from "@/store/effect";
import { Pause, Play, Repeat, Square } from "lucide-react";
import { useAtom } from "jotai";
import React from "react";

export default function PlaybackControls() {
  const [playback, setPlayback] = useAtom(effectPlaybackAtom);

  return (
    <div className="rounded-xl border border-border bg-background/70 p-4">
      <div className="text-sm font-semibold">Playback</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={playback.isPlaying ? "secondary" : "default"}
          onClick={() => setPlayback({ ...playback, isPlaying: !playback.isPlaying })}
        >
          {playback.isPlaying ? <Pause /> : <Play />}
          {playback.isPlaying ? "Pause" : "Play"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPlayback({ ...playback, isPlaying: false, currentTime: 0 })}
        >
          <Square />
          Stop
        </Button>
        <Button
          size="sm"
          variant={playback.isLooping ? "secondary" : "outline"}
          onClick={() => setPlayback({ ...playback, isLooping: !playback.isLooping })}
        >
          <Repeat />
          Loop
        </Button>
      </div>
      <div className="mt-4">
        <div className="text-xs text-muted-foreground">Speed</div>
        <input
          type="range"
          min={0.25}
          max={2}
          step={0.05}
          value={playback.speed}
          onChange={(event) =>
            setPlayback({ ...playback, speed: Number(event.target.value) })
          }
          className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
        />
        <div className="mt-1 text-xs text-muted-foreground">
          {playback.speed.toFixed(2)}x
        </div>
      </div>
    </div>
  );
}
