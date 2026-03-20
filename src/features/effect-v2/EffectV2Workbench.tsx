import { Canvas } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { effectV2SelectionAtom, effectV2PlaybackAtom, magicSingleTableAtom } from "@/store/effect-v2";
import { MagicEffectRenderer } from "./renderers/MagicEffectRenderer";
import { MagicGroupRenderer } from "./renderers/MagicGroupRenderer";
import { EffectRenderer } from "./renderers/EffectRenderer";
import { ParticleEffectRenderer } from "./renderers/ParticleEffectRenderer";
import { PlaybackClock } from "./PlaybackClock";
import { GlobalTimeProvider } from "./TimeContext";
import { useLoadEffect } from "./useLoadEffect";
import { Button } from "@/components/ui/button";
import { Play, Square, RotateCcw, Repeat } from "lucide-react";
import { EffectV2Selection, MagicSingleEntry, MagicGroupEntry, ParFile } from "@/types/effect-v2";
import { loadParFile } from "@/commands/effect";
import { currentProjectAtom } from "@/store/project";

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
  const selection = useAtomValue(effectV2SelectionAtom);

  if (!selection) {
    return (
      <div className="text-sm text-muted-foreground">
        Select an effect from the sidebar.
      </div>
    );
  }

  switch (selection.type) {
    case "magic_one":
      return <MagicOneInfoPanel entry={selection.entry} />;
    case "magic_group":
      return <MagicGroupInfoPanel entry={selection.entry} />;
    case "effect":
      return <EffectFileInfoPanel fileName={selection.fileName} />;
    case "particle":
      return <ParticleFileInfoPanel fileName={selection.fileName} />;
  }
}

function MagicOneInfoPanel({ entry }: { entry: MagicSingleEntry }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Name</div>
        <div className="font-medium">{entry.name}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-xs text-muted-foreground">ID</div>
          <div>{entry.id}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Velocity</div>
          <div>{entry.velocity}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Render Mode</div>
          <div>{entry.render_idx}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Light ID</div>
          <div>{entry.lightId}</div>
        </div>
      </div>
      {entry.models.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground">Models</div>
          {entry.models.map((m, i) => (
            <div key={i} className="font-mono text-xs bg-muted px-2 py-1 rounded mt-1">{m}</div>
          ))}
        </div>
      )}
      {entry.result_effect && entry.result_effect !== "0" && (
        <div>
          <div className="text-xs text-muted-foreground">Result Effect</div>
          <div className="font-mono text-xs">{entry.result_effect}</div>
        </div>
      )}
    </div>
  );
}

function MagicGroupInfoPanel({ entry }: { entry: MagicGroupEntry }) {
  const table = useAtomValue(magicSingleTableAtom);
  const setSelection = useSetAtom(effectV2SelectionAtom);

  const handlePhaseClick = (typeId: number) => {
    const magicEntry = table?.entries.find((e) => e.id === typeId);
    if (magicEntry) {
      setSelection({ type: "magic_one", entry: magicEntry });
      // Update navigator dropdown to match
      (window as any).__effectV2SetViewMode?.("magic_one");
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Group Name</div>
        <div className="font-medium">{entry.name}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-xs text-muted-foreground">ID</div>
          <div>{entry.id}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Render Idx</div>
          <div>{entry.renderIdx}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total Count</div>
          <div>{entry.totalCount}</div>
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Phases (click to view)</div>
        {entry.typeIds.map((typeId, i) => {
          if (typeId < 0) return null;
          const magicEntry = table?.entries.find((e) => e.id === typeId);
          const name = magicEntry?.name ?? `#${typeId}`;
          return (
            <button
              key={i}
              className="w-full text-left font-mono text-xs bg-muted hover:bg-accent px-2 py-1 rounded mt-1 cursor-pointer transition-colors"
              onClick={() => handlePhaseClick(typeId)}
            >
              {name} x{entry.counts[i]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EffectFileInfoPanel({ fileName }: { fileName: string }) {
  const effFiles = useLoadEffect([fileName]);
  const eff = effFiles[0] ?? null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Effect File</div>
        <div className="font-mono text-xs">{fileName}</div>
      </div>
      {eff && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-muted-foreground">Sub-effects</div>
              <div>{eff.subEffects.length}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Version</div>
              <div>{eff.version}</div>
            </div>
          </div>
          {eff.usePath && (
            <div>
              <div className="text-xs text-muted-foreground">Path File</div>
              <div className="font-mono text-xs">{eff.pathName}</div>
            </div>
          )}
          {eff.useSound && (
            <div>
              <div className="text-xs text-muted-foreground">Sound</div>
              <div className="font-mono text-xs">{eff.soundName}</div>
            </div>
          )}
          {eff.subEffects.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground">Models</div>
              {eff.subEffects.map((sub, i) => (
                <div key={i} className="font-mono text-xs bg-muted px-2 py-1 rounded mt-1">
                  {sub.modelName || "(texture-only)"}{sub.texName ? ` [${sub.texName}]` : ""}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ParticleFileInfoPanel({ fileName }: { fileName: string }) {
  const [parData, setParData] = useState<ParFile | null>(null);
  const currentProject = useAtomValue(currentProjectAtom);

  useEffect(() => {
    if (!currentProject) return;
    const baseName = fileName.replace(/\.par$/i, "");
    loadParFile(currentProject.id, `${baseName}.par`)
      .then((data) => setParData(data as ParFile))
      .catch(() => setParData(null));
  }, [fileName, currentProject]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Particle File</div>
        <div className="font-mono text-xs">{fileName}</div>
      </div>
      {parData && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-muted-foreground">Systems</div>
              <div>{parData.systems.length}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Duration</div>
              <div>{parData.length.toFixed(2)}s</div>
            </div>
            {parData.strips.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">Strips</div>
                <div>{parData.strips.length}</div>
              </div>
            )}
            {parData.models.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">Models</div>
                <div>{parData.models.length}</div>
              </div>
            )}
          </div>
          {parData.systems.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground">Particle Types</div>
              {parData.systems.map((sys, i) => (
                <div key={i} className="font-mono text-xs bg-muted px-2 py-1 rounded mt-1">
                  {sys.name || `Type ${sys.type}`} ({sys.particleCount} particles)
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Standalone .eff viewer — renders effect at origin with no flight path or target. */
function StandaloneEffectView({ fileName }: { fileName: string }) {
  const effFiles = useLoadEffect([fileName]);
  if (effFiles.length === 0) return null;
  return <EffectRenderer effect={effFiles[0]} />;
}

/** Standalone .par viewer — renders particle system at origin, looping. */
function StandaloneParticleView({ fileName }: { fileName: string }) {
  const baseName = fileName.replace(/\.par$/i, "");
  return <ParticleEffectRenderer particleEffectName={baseName} loop />;
}

/** Renders the appropriate 3D content based on the current selection. */
function SceneContent({ selection }: { selection: EffectV2Selection | null }) {
  // For magic_one, load the .eff files
  const effectNames = useMemo(() => {
    if (selection?.type === "magic_one") return selection.entry.models;
    return [];
  }, [selection]);
  const effFiles = useLoadEffect(effectNames);

  if (!selection) return null;

  switch (selection.type) {
    case "magic_one":
      return <MagicEffectRenderer key={selection.entry.id} effFiles={effFiles} magicEntry={selection.entry} />;
    case "magic_group":
      return <MagicGroupRenderer key={selection.entry.id} group={selection.entry} />;
    case "effect":
      return <StandaloneEffectView key={selection.fileName} fileName={selection.fileName} />;
    case "particle":
      return <StandaloneParticleView key={selection.fileName} fileName={selection.fileName} />;
  }
}

function statusText(selection: EffectV2Selection | null): string {
  if (!selection) return "Select an effect from the sidebar.";
  switch (selection.type) {
    case "magic_one": return `MagicOne #${selection.entry.id}: ${selection.entry.name}`;
    case "magic_group": return `MagicGroup #${selection.entry.id}: ${selection.entry.name}`;
    case "effect": return `Effect: ${selection.fileName}`;
    case "particle": return `Particle: ${selection.fileName}`;
  }
}

export default function EffectV2Workbench() {
  const selection = useAtomValue(effectV2SelectionAtom);
  const [, setPlayback] = useAtom(effectV2PlaybackAtom);

  // Reset playback when switching selection
  useEffect(() => {
    setPlayback((p) => ({ ...p, playing: false, time: 0 }));
  }, [selection]);

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      <div>
        <div className="text-lg font-semibold">Effects V2</div>
        <div className="text-sm text-muted-foreground">
          {statusText(selection)}
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
              <SceneContent selection={selection} />
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
