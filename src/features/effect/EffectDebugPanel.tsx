import {
  effectDataAtom,
  effectSoloIndexAtom,
  effectTextureStatusAtom,
} from "@/store/effect";
import { useAtom, useAtomValue } from "jotai";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import React, { useState } from "react";
import { usePlaybackClock } from "@/features/effect/playbackClock";
import {
  resolveFrameData,
  resolveGeometry,
  resolveFrameDurations,
  resolveTextureName,
  type GeometryConfig,
} from "@/features/effect/rendering";
import {
  composePkoRenderState,
  type PkoTechniqueState,
} from "@/features/effect/pkoStateEmulation";
import type { SubEffect } from "@/types/effect";

const EFFECT_TYPE_LABELS: Record<number, string> = {
  0: "None",
  1: "FrameTex",
  2: "ModelUV",
  3: "ModelTex",
  4: "Model",
};

const BLEND_PRESETS = [
  { name: "Normal", src: 5, dest: 6 },
  { name: "Additive", src: 5, dest: 2 },
  { name: "Strong", src: 2, dest: 2 },
  { name: "Color", src: 1, dest: 3 },
  { name: "Dark", src: 1, dest: 4 },
  { name: "Subtractive", src: 1, dest: 6 },
] as const;

const D3DBLEND_NAMES: Record<number, string> = {
  1: "ZERO",
  2: "ONE",
  3: "SRCCOLOR",
  4: "INVSRCCOLOR",
  5: "SRCALPHA",
  6: "INVSRCALPHA",
  7: "DESTALPHA",
  8: "INVDESTALPHA",
  9: "DESTCOLOR",
  10: "INVDESTCOLOR",
  11: "SRCALPHASAT",
};

const CULL_NAMES: Record<number, string> = {
  1: "NONE",
  2: "CW",
  3: "CCW",
};

function formatBlend(src: number, dest: number): string {
  const preset = BLEND_PRESETS.find((p) => p.src === src && p.dest === dest);
  if (preset) return preset.name;
  return `${D3DBLEND_NAMES[src] ?? src} + ${D3DBLEND_NAMES[dest] ?? dest}`;
}

function formatGeometry(geo: GeometryConfig): string {
  switch (geo.type) {
    case "cylinder":
      return `Cylinder: r=${geo.topRadius}/${geo.botRadius}, h=${geo.height}, ${geo.segments} seg`;
    case "sphere":
      return "Sphere";
    case "model":
      return `Model: ${geo.modelName}`;
    case "rect":
      return "Rect (XZ)";
    case "rectPlane":
      return "RectPlane (XY)";
    case "rectZ":
      return "RectZ (YZ)";
    case "triangle":
      return "Triangle (XZ)";
    case "trianglePlane":
      return "TrianglePlane (XY)";
    case "triangleZ":
      return "TriangleZ";
    default:
      return `Plane (${geo.type})`;
  }
}

function formatTechniqueState(state: PkoTechniqueState): string[] {
  const lines: string[] = [];
  lines.push(`zEnable=${state.zEnable ? "on" : "off"} zWrite=${state.zWriteEnable ? "on" : "off"}`);
  lines.push(`cull=${CULL_NAMES[state.cullMode] ?? state.cullMode}`);
  if (state.alphaTestEnable) {
    lines.push(`alphaTest ref=${state.alphaRef} func=${state.alphaFunc}`);
  }
  return lines;
}

function formatVec3(v: [number, number, number]): string {
  return `(${v.map((n) => n.toFixed(2)).join(", ")})`;
}

function formatColor(c: [number, number, number, number]): string {
  const [r, g, b, a] = c;
  return `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0}, ${a.toFixed(2)})`;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-[10px]">
      <span className="shrink-0 text-muted-foreground/70">{label}:</span>
      <span className="text-foreground/80 break-all">{value}</span>
    </div>
  );
}

/** Expanded card body — only mounted when open, so usePlaybackClock doesn't tick for collapsed cards. */
function SubEffectDetails({
  subEffect,
  techniqueIndex,
}: {
  subEffect: SubEffect;
  techniqueIndex: number;
}) {
  const currentTime = usePlaybackClock();
  const geo = resolveGeometry(subEffect, 0);
  const techState = composePkoRenderState(techniqueIndex);
  const techLines = formatTechniqueState(techState);
  const durations = resolveFrameDurations(subEffect);
  const totalDuration = durations.reduce((sum, d) => sum + d, 0);
  const textureName = resolveTextureName(subEffect, 0);

  let currentFrame = 0;
  let elapsed = currentTime % totalDuration;
  for (let i = 0; i < durations.length; i++) {
    if (elapsed < durations[i]) {
      currentFrame = i;
      break;
    }
    elapsed -= durations[i];
    if (i === durations.length - 1) currentFrame = i;
  }

  const frameData = resolveFrameData(
    { version: 0, idxTech: techniqueIndex, usePath: false, pathName: "", useSound: false, soundName: "", rotating: false, rotaVec: [0, 0, 0], rotaVel: 0, effNum: 1, subEffects: [subEffect] },
    0,
    currentFrame,
  );

  return (
    <div className="space-y-0.5 pt-1">
      <Row label="Geo" value={formatGeometry(geo)} />
      <Row label="Blend" value={formatBlend(subEffect.srcBlend, subEffect.destBlend)} />
      <Row label="Tech" value={techLines.join(" | ")} />

      {frameData && (
        <>
          <Row label="Pos" value={formatVec3(frameData.position)} />
          <Row label="Rot" value={formatVec3(frameData.angle)} />
          <Row label="Scale" value={formatVec3(frameData.size)} />
          <Row
            label="Color"
            value={
              <span className="flex items-center gap-1">
                {formatColor(frameData.color)}
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm border border-border/50"
                  style={{
                    backgroundColor: `rgba(${(frameData.color[0] * 255) | 0},${(frameData.color[1] * 255) | 0},${(frameData.color[2] * 255) | 0},${frameData.color[3]})`,
                  }}
                />
              </span>
            }
          />
        </>
      )}

      <Row label="Texture" value={textureName || "(none)"} />

      <div className="flex flex-wrap gap-1 pt-0.5">
        {subEffect.billboard && <Badge>billboard</Badge>}
        {subEffect.alpha && <Badge>alpha</Badge>}
        {subEffect.rotaBoard && <Badge>rotaBoard</Badge>}
        {subEffect.rotaLoop && <Badge>rotaLoop</Badge>}
      </div>

      <Row
        label="Duration"
        value={`${totalDuration.toFixed(2)}s, ${subEffect.frameCount} frames (f${currentFrame})`}
      />
    </div>
  );
}

function SubEffectCard({
  subEffect,
  index,
  techniqueIndex,
  soloIndex,
  onToggleSolo,
}: {
  subEffect: SubEffect;
  index: number;
  techniqueIndex: number;
  soloIndex: number | null;
  onToggleSolo: (index: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const typeLabel = EFFECT_TYPE_LABELS[subEffect.effectType] ?? "Unknown";
  const isSoloed = soloIndex === index;
  const isMuted = soloIndex !== null && soloIndex !== index;

  return (
    <div className={`rounded-lg border px-2 py-1.5 ${isMuted ? "border-border/40 opacity-40" : "border-border"}`}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-1 items-center gap-1 text-left"
        >
          <ChevronRight className={`h-2.5 w-2.5 shrink-0 text-muted-foreground/50 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          <span className="text-[10px] font-bold text-muted-foreground/50">#{index}</span>
          <span className="text-[10px] font-medium truncate">
            {subEffect.effectName || `Effect ${index + 1}`}
          </span>
          <Badge>{typeLabel}</Badge>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSolo(index); }}
          className={`shrink-0 rounded p-0.5 transition-colors ${isSoloed ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
          title={isSoloed ? "Unsolo" : "Solo this layer"}
        >
          {isSoloed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
      </div>
      {isOpen && (
        <SubEffectDetails subEffect={subEffect} techniqueIndex={techniqueIndex} />
      )}
    </div>
  );
}

export default function EffectDebugPanel() {
  const effectData = useAtomValue(effectDataAtom);
  const textureStatus = useAtomValue(effectTextureStatusAtom);
  const [soloIndex, setSoloIndex] = useAtom(effectSoloIndexAtom);

  if (!effectData) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No effect loaded.
      </div>
    );
  }

  const handleToggleSolo = (index: number) => {
    setSoloIndex((prev) => (prev === index ? null : index));
  };

  return (
    <div className="space-y-3">
      {/* Effect-level summary */}
      <div className="space-y-0.5 rounded-lg border border-border px-3 py-2">
        <div className="text-[11px] font-semibold">Effect Summary</div>
        <Row label="Version" value={effectData.version} />
        <Row label="Technique" value={effectData.idxTech} />
        <Row label="Sub-effects" value={effectData.subEffects.length} />
        {effectData.usePath && <Row label="Path" value={effectData.pathName} />}
        {effectData.useSound && <Row label="Sound" value={effectData.soundName} />}
        {effectData.rotating && (
          <Row
            label="Rotation"
            value={`vel=${effectData.rotaVel.toFixed(2)} vec=${formatVec3(effectData.rotaVec)}`}
          />
        )}
        <Row
          label="Texture"
          value={
            <span className={textureStatus.status === "error" ? "text-destructive" : ""}>
              {textureStatus.textureName ?? "(none)"} [{textureStatus.status}]
            </span>
          }
        />
      </div>

      {/* Solo status */}
      {soloIndex !== null && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-center">
          <span className="text-[10px] text-amber-400">
            Solo: #{soloIndex} {effectData.subEffects[soloIndex]?.effectName || `Effect ${soloIndex + 1}`}
          </span>
        </div>
      )}

      {/* Sub-effect cards */}
      <div className="space-y-1.5">
        {effectData.subEffects.map((subEffect, i) => (
          <SubEffectCard
            key={i}
            subEffect={subEffect}
            index={i}
            techniqueIndex={effectData.idxTech}
            soloIndex={soloIndex}
            onToggleSolo={handleToggleSolo}
          />
        ))}
      </div>
    </div>
  );
}
