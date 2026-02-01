import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import React, { Suspense, useEffect, useRef } from "react";
import EffectSubRenderer from "@/features/effect/EffectSubRenderer";
import EffectPlaybackDriver from "@/features/effect/EffectPlaybackDriver";
import ParticleSimulator from "@/features/effect/particle/ParticleSimulator";
import CharacterPreview from "@/features/effect/CharacterPreview";
import { Button } from "@/components/ui/button";
import { effectDataAtom, effectPlaybackAtom, effectTextureReloadAtom, effectTextureStatusAtom, selectedSubEffectIndexAtom } from "@/store/effect";
import { pathPointsAtom } from "@/store/path";
import { gizmoModeAtom, type GizmoMode } from "@/store/gizmo";
import { useAtom, useAtomValue } from "jotai";
import { Maximize2, MousePointer, Move, RotateCw } from "lucide-react";
import StripEffectRenderer from "@/features/effect/StripEffectRenderer";
import PathVisualizer from "@/features/effect/PathVisualizer";
import { getPathPosition } from "@/features/effect/animation";
import * as THREE from "three";

/** Default path velocity when no explicit velocity is provided in the .csf file. */
const DEFAULT_PATH_VELOCITY = 2.0;

/**
 * Wraps children in a group that moves along the effect path during playback.
 * PKO CEffPath::FrameMove moves the entire effect at constant velocity along path segments.
 */
function PathFollower({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const effectData = useAtomValue(effectDataAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const pathPoints = useAtomValue(pathPointsAtom);

  useFrame(() => {
    if (!groupRef.current) return;

    if (
      effectData?.usePath &&
      pathPoints &&
      pathPoints.length >= 2 &&
      playback.isPlaying
    ) {
      const pos = getPathPosition(
        pathPoints,
        playback.currentTime,
        DEFAULT_PATH_VELOCITY,
        playback.isLooping,
      );
      groupRef.current.position.set(pos[0], pos[1], pos[2]);
    } else {
      groupRef.current.position.set(0, 0, 0);
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

const GIZMO_BUTTONS: { mode: GizmoMode; icon: React.FC<{ className?: string }>; label: string; key: string }[] = [
  { mode: "translate", icon: Move, label: "Translate (T)", key: "t" },
  { mode: "rotate", icon: RotateCw, label: "Rotate (R)", key: "r" },
  { mode: "scale", icon: Maximize2, label: "Scale (S)", key: "s" },
  { mode: "off", icon: MousePointer, label: "No gizmo (Esc)", key: "escape" },
];

export default function EffectViewport() {
  const effectData = useAtomValue(effectDataAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const textureStatus = useAtomValue(effectTextureStatusAtom);
  const [, setReloadToken] = useAtom(effectTextureReloadAtom);
  const [gizmoMode, setGizmoMode] = useAtom(gizmoModeAtom);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Skip if user is typing in an input
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = event.key.toLowerCase();
      if (key === "t") setGizmoMode("translate");
      else if (key === "r" && !event.metaKey && !event.ctrlKey) setGizmoMode("rotate");
      else if (key === "s" && !event.metaKey && !event.ctrlKey) setGizmoMode("scale");
      else if (key === "escape") setGizmoMode("off");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setGizmoMode]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-muted/40">
      <Canvas camera={{ position: [6, 6, 6], fov: 35 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#1e1e2e"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[6, 8, 4]} intensity={1.2} />
        {/* During playback, render ALL sub-effects simultaneously (PKO behavior).
            When stopped, render only the selected sub-effect for editing.
            PathFollower moves the entire effect group along the path during playback. */}
        <PathFollower>
          {effectData && playback.isPlaying
            ? effectData.subEffects.map((_, i) => (
                <EffectSubRenderer key={i} subEffectIndex={i} />
              ))
            : selectedSubEffectIndex !== null && (
                <EffectSubRenderer key={selectedSubEffectIndex} subEffectIndex={selectedSubEffectIndex} />
              )}
        </PathFollower>
        <ParticleSimulator />
        <StripEffectRenderer />
        <PathVisualizer />
        <Suspense fallback={null}>
          <CharacterPreview />
        </Suspense>
        <EffectPlaybackDriver />
        <gridHelper args={[40, 40, "#2f3239", "#1b1d22"]} />
        <OrbitControls enablePan enableZoom />
      </Canvas>

      {/* Gizmo mode toolbar */}
      {effectData && (
        <div className="absolute left-3 top-3 flex gap-0.5 rounded-lg border border-border bg-background/80 p-0.5">
          {GIZMO_BUTTONS.map(({ mode, icon: Icon, label }) => (
            <Button
              key={mode}
              size="icon"
              variant={gizmoMode === mode ? "secondary" : "ghost"}
              className="h-7 w-7"
              title={label}
              aria-label={`gizmo-${mode}`}
              onClick={() => setGizmoMode(mode)}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      )}

      {!effectData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-center">
          <div className="text-sm text-muted-foreground">Load an effect to preview it here.</div>
          <div className="text-xs text-muted-foreground/60">Select an .eff file from the sidebar, then choose a sub-effect.</div>
          <div className="text-[10px] text-muted-foreground/40">Scroll to zoom · Click + drag to rotate · Right-click to pan</div>
        </div>
      )}
      {effectData && (
        <div className="absolute bottom-3 left-3 text-[10px] text-muted-foreground/50">
          Scroll to zoom · Drag to orbit · Right-click to pan
        </div>
      )}
      {textureStatus.status === "error" && textureStatus.textureName && (
        <div className="absolute right-3 top-3 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive">
          Missing texture: {textureStatus.textureName}
        </div>
      )}
      {textureStatus.status === "loaded" && textureStatus.textureName && (
        <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-xs text-muted-foreground">
          Texture: {textureStatus.textureName}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            Reload
          </Button>
        </div>
      )}
    </div>
  );
}
