import { Canvas } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo } from "react";
import { selectedMagicEffectAtom, effectV2PlaybackAtom } from "@/store/effect-v2";
import { MagicEffectRenderer } from "./renderers/MagicEffectRenderer";
import { PlaybackClock } from "./PlaybackClock";
import { GlobalTimeProvider } from "./TimeContext";
import { useLoadEffect } from "./useLoadEffect";
import { Button } from "@/components/ui/button";
import { Play, Square, RotateCcw, Repeat } from "lucide-react";

function PlaybackBar() {
  const [playback, setPlayback] = useAtom(effectV2PlaybackAtom);

  const play = () => setPlayback((p) => ({ ...p, playing: true }));
  const stop = () => setPlayback((p) => ({ ...p, playing: false }));
  const reset = () => setPlayback((p) => ({ ...p, time: 0, playing: false }));
  const toggleLoop = () => setPlayback((p) => ({ ...p, loop: !p.loop }));

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        title={playback.playing ? "Stop" : "Play"}
        onClick={playback.playing ? stop : play}
      >
        {playback.playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" title="Reset" onClick={reset}>
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant={playback.loop ? "secondary" : "ghost"}
        className="h-7 w-7"
        title={playback.loop ? "Looping enabled" : "Enable loop"}
        onClick={toggleLoop}
      >
        <Repeat className="h-3.5 w-3.5" />
      </Button>
      <div className="flex items-center gap-0.5 pl-2 border-l border-border" role="group" aria-label="framerate">
        {[0, 15, 30, 60].map((fps) => (
          <Button
            key={fps}
            size="sm"
            variant={playback.fps === fps ? "secondary" : "ghost"}
            className="h-6 px-1.5 text-[10px]"
            title={fps === 0 ? "Uncapped framerate" : `${fps} FPS`}
            onClick={() => setPlayback((p) => ({ ...p, fps }))}
          >
            {fps === 0 ? "∞" : fps}
          </Button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground font-mono pl-2 border-l border-border">
        {playback.time.toFixed(2)}s
      </span>
    </div>
  );
}

function EffectInfoPanel() {
  const selected = useAtomValue(selectedMagicEffectAtom);

  if (!selected) {
    return (
      <div className="text-sm text-muted-foreground">
        Select an effect from the sidebar.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Name</div>
        <div className="font-medium">{selected.name}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-xs text-muted-foreground">ID</div>
          <div>{selected.id}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Velocity</div>
          <div>{selected.velocity}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Render Mode</div>
          <div>{selected.render_idx}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Light ID</div>
          <div>{selected.lightId}</div>
        </div>
      </div>
      {selected.models.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground">Models</div>
          {selected.models.map((m, i) => (
            <div key={i} className="font-mono text-xs bg-muted px-2 py-1 rounded mt-1">{m}</div>
          ))}
        </div>
      )}
      {selected.result_effect && selected.result_effect !== "0" && (
        <div>
          <div className="text-xs text-muted-foreground">Result Effect</div>
          <div className="font-mono text-xs">{selected.result_effect}</div>
        </div>
      )}
    </div>
  );
}

export default function EffectV2Workbench() {
  const selected = useAtomValue(selectedMagicEffectAtom);
  const [, setPlayback] = useAtom(effectV2PlaybackAtom);
  const effectNames = useMemo(() => selected?.models ?? [], [selected]);
  const effFiles = useLoadEffect(effectNames);

  // Reset playback when switching effects
  useEffect(() => {
    setPlayback((p) => ({ ...p, playing: false, time: 0 }));
  }, [selected]);

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      <div>
        <div className="text-lg font-semibold">Effects V2</div>
        <div className="text-sm text-muted-foreground">
          {selected
            ? `${effFiles.length} .eff file(s) loaded`
            : "Select an effect from the sidebar."}
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <div className="flex min-h-[400px] flex-col gap-2">
          <Canvas
            className="flex-1 rounded-lg border border-border"
            camera={{ position: [6, 6, 6], fov: 35 }}
            dpr={[1, 1.5]}
            gl={{ powerPreference: "high-performance" }}
          >
            <color attach="background" args={["#1e1e2e"]} />
            <ambientLight intensity={1} />
            <directionalLight position={[5, 5, 5]} />
            <PlaybackClock />
            <GlobalTimeProvider>
              <MagicEffectRenderer key={selected?.id ?? "none"} effFiles={effFiles} />
            </GlobalTimeProvider>
            <OrbitControls makeDefault />
            <gridHelper args={[40, 40, "#2f3239", "#1b1d22"]} />
            <GizmoHelper alignment="top-right" margin={[80, 80]}>
              <GizmoViewport axisColors={["#f73b3b", "#3bf751", "#3b8ef7"]} labelColor="white" />
            </GizmoHelper>
          </Canvas>
          <PlaybackBar />
        </div>
        <div className="overflow-y-auto">
          <EffectInfoPanel />
        </div>
      </div>
    </div>
  );
}
