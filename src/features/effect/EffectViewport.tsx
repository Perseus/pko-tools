import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import React, { Suspense, useRef } from "react";
import EffectSubRenderer from "@/features/effect/EffectSubRenderer";
import EffectPlaybackDriver from "@/features/effect/EffectPlaybackDriver";
import EffectSkeletonScene from "@/features/effect/EffectSkeletonScene";
import ParticleSimulator from "@/features/effect/particle/ParticleSimulator";
import CharacterPreview from "@/features/effect/CharacterPreview";
import { Button } from "@/components/ui/button";
import {
  compositePreviewAtom,
  effectDataAtom,
  effectPlaybackAtom,
  effectSoloIndexAtom,
  effectTextureReloadAtom,
  effectTextureStatusAtom,
  effectViewportModeAtom,
  effectViewModeAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { pathPointsAtom } from "@/store/path";
import { gizmoModeAtom, type GizmoMode } from "@/store/gizmo";
import { useAtom, useAtomValue } from "jotai";
import { Layers, Maximize2, MousePointer, Move, RotateCw } from "lucide-react";
import StripEffectRenderer from "@/features/effect/StripEffectRenderer";
import PathVisualizer from "@/features/effect/PathVisualizer";
import { getPathPosition } from "@/features/effect/animation";
import * as THREE from "three";
import { CanvasErrorBoundary } from "@/components/CanvasErrorBoundary";
import { playbackClockStore } from "@/features/effect/playbackClock";
import { actionIds } from "@/features/actions/actionIds";
import { ContextualActionMenu } from "@/features/actions/ContextualActionMenu";
import { PerfFrameProbe, PerfOverlay } from "@/features/perf";

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
      const currentTime = playbackClockStore.get();
      const pos = getPathPosition(
        pathPoints,
        currentTime,
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

const EFFECT_VIEWPORT_CONTEXT_ACTIONS = [
  actionIds.effectSave,
  actionIds.effectUndo,
  actionIds.effectRedo,
  actionIds.effectGizmoTranslate,
  actionIds.effectGizmoRotate,
  actionIds.effectGizmoScale,
  actionIds.effectGizmoOff,
  actionIds.effectToggleCompositePreview,
];

export default function EffectViewport() {
  const effectData = useAtomValue(effectDataAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const textureStatus = useAtomValue(effectTextureStatusAtom);
  const [, setReloadToken] = useAtom(effectTextureReloadAtom);
  const [gizmoMode, setGizmoMode] = useAtom(gizmoModeAtom);
  const [compositePreview, setCompositePreview] = useAtom(compositePreviewAtom);
  const [viewportMode, setViewportMode] = useAtom(effectViewportModeAtom);
  const soloIndex = useAtomValue(effectSoloIndexAtom);
  const viewMode = useAtomValue(effectViewModeAtom);

  return (
    <ContextualActionMenu
      actionIds={EFFECT_VIEWPORT_CONTEXT_ACTIONS}
      requireShiftKey
      className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-muted/40"
    >
      <CanvasErrorBoundary className="absolute inset-0">
        <Canvas
          camera={{ position: [6, 6, 6], fov: 35 }}
          dpr={[1, 1.5]}
          gl={{ preserveDrawingBuffer: false, powerPreference: "high-performance" }}
        >
          <color attach="background" args={["#1e1e2e"]} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[6, 8, 4]} intensity={1.2} />
          {viewportMode === "skeleton" ? (
            <EffectSkeletonScene />
          ) : (
            <>
              {/* During playback or composite preview, render ALL sub-effects simultaneously (PKO behavior).
                  When stopped without composite, render only the selected sub-effect for editing.
                  PathFollower moves the entire effect group along the path during playback. */}
              <PathFollower>
                {effectData && (playback.isPlaying || compositePreview)
                  ? soloIndex !== null
                    ? <EffectSubRenderer key={soloIndex} subEffectIndex={soloIndex} />
                    : effectData.subEffects.map((_, i) => (
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
            </>
          )}
          <EffectPlaybackDriver />
          <gridHelper args={[40, 40, "#2f3239", "#1b1d22"]} />
          <OrbitControls enablePan enableZoom />
          <PerfFrameProbe surface="effects" />
        </Canvas>
      </CanvasErrorBoundary>
      <PerfOverlay surface="effects" className="bottom-8 right-3" />

      {effectData && (
        <div className="absolute left-3 top-3 flex gap-0.5 rounded-lg border border-border bg-background/80 p-0.5">
          {viewMode === "viewer" && (
            <>
              <Button
                size="sm"
                variant={viewportMode === "render" ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                title="Render the actual effect"
                aria-label="viewport-render-mode"
                onClick={() => setViewportMode("render")}
              >
                Render
              </Button>
              <Button
                size="sm"
                variant={viewportMode === "skeleton" ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                title="Inspect the effect hierarchy and local transforms"
                aria-label="viewport-skeleton-mode"
                onClick={() => setViewportMode("skeleton")}
              >
                Skeleton
              </Button>
            </>
          )}

          {viewportMode === "render" && viewMode === "editor" && (
            <>
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
              <div className="mx-0.5 h-5 w-px bg-border" />
              <Button
                size="icon"
                variant={compositePreview ? "secondary" : "ghost"}
                className="h-7 w-7"
                title="Composite preview: show all sub-effects (C)"
                aria-label="composite-preview"
                onClick={() => setCompositePreview(!compositePreview)}
              >
                <Layers className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {viewportMode === "render" && viewMode === "viewer" && (
            <Button
              size="icon"
              variant={compositePreview ? "secondary" : "ghost"}
              className="h-7 w-7"
              title="Composite preview: show all sub-effects (C)"
              aria-label="composite-preview"
              onClick={() => setCompositePreview(!compositePreview)}
            >
              <Layers className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {!effectData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-center">
          <div className="text-sm text-muted-foreground">Load an effect to preview it here.</div>
          <div className="text-xs text-muted-foreground/60">Select an .eff file from the sidebar, then choose a sub-effect.</div>
          <div className="text-[10px] text-muted-foreground/40">Scroll to zoom · Click + drag to rotate · Shift + Right-click for context actions</div>
        </div>
      )}
      {effectData && (
        <div className="absolute bottom-3 left-3 text-[10px] text-muted-foreground/50">
          {viewportMode === "skeleton"
            ? "Click nodes to inspect local transforms · Drag to orbit · Scroll to zoom"
            : "Scroll to zoom · Drag to orbit · Shift + Right-click for context actions"}
        </div>
      )}
      {viewportMode === "render" && textureStatus.status === "error" && textureStatus.textureName && (
        <div className="absolute right-3 top-3 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive">
          Missing texture: {textureStatus.textureName}
        </div>
      )}
      {viewportMode === "render" && textureStatus.status === "loaded" && textureStatus.textureName && (
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
    </ContextualActionMenu>
  );
}
