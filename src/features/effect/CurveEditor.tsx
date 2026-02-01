import {
  effectDataAtom,
  effectDirtyAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import type { SubEffect, Vec3, Vec4 } from "@/types/effect";
import { useAtom } from "jotai";
import React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useEffectHistory } from "@/features/effect/useEffectHistory";

// --- Coordinate mapping helpers (exported for testing) ---

export function timeToX(
  time: number,
  viewStart: number,
  viewEnd: number,
  svgWidth: number,
): number {
  const range = viewEnd - viewStart;
  if (range <= 0) return 0;
  return ((time - viewStart) / range) * svgWidth;
}

export function valueToY(
  value: number,
  minValue: number,
  maxValue: number,
  svgHeight: number,
): number {
  const range = maxValue - minValue;
  if (range <= 0) return svgHeight / 2;
  // Invert Y so higher values are at the top
  return svgHeight - ((value - minValue) / range) * svgHeight;
}

export function xToTime(
  x: number,
  viewStart: number,
  viewEnd: number,
  svgWidth: number,
): number {
  const range = viewEnd - viewStart;
  if (svgWidth <= 0) return viewStart;
  return viewStart + (x / svgWidth) * range;
}

export function yToValue(
  y: number,
  minValue: number,
  maxValue: number,
  svgHeight: number,
): number {
  const range = maxValue - minValue;
  if (svgHeight <= 0) return minValue;
  return minValue + ((svgHeight - y) / svgHeight) * range;
}

// --- Channel definitions ---

export type CurveChannel = {
  id: string;
  label: string;
  color: string;
  getValue: (subEffect: SubEffect, frameIndex: number) => number;
  setValue: (subEffect: SubEffect, frameIndex: number, value: number) => SubEffect;
};

function vec3Setter(
  key: "frameSizes" | "frameAngles" | "framePositions",
  component: 0 | 1 | 2,
) {
  return (subEffect: SubEffect, frameIndex: number, value: number): SubEffect => {
    const frames = [...subEffect[key]] as Vec3[];
    const frame: Vec3 = [...(frames[frameIndex] ?? [0, 0, 0])];
    frame[component] = value;
    frames[frameIndex] = frame;
    return { ...subEffect, [key]: frames };
  };
}

function colorSetter(component: 0 | 1 | 2 | 3) {
  return (subEffect: SubEffect, frameIndex: number, value: number): SubEffect => {
    const frames = [...subEffect.frameColors] as Vec4[];
    const frame: Vec4 = [...(frames[frameIndex] ?? [1, 1, 1, 1])];
    frame[component] = Math.min(Math.max(value, 0), 1);
    frames[frameIndex] = frame;
    return { ...subEffect, frameColors: frames };
  };
}

export const CHANNELS: CurveChannel[] = [
  { id: "position.x", label: "Pos X", color: "#ef4444",
    getValue: (s, i) => (s.framePositions[i] ?? [0,0,0])[0],
    setValue: vec3Setter("framePositions", 0) },
  { id: "position.y", label: "Pos Y", color: "#22c55e",
    getValue: (s, i) => (s.framePositions[i] ?? [0,0,0])[1],
    setValue: vec3Setter("framePositions", 1) },
  { id: "position.z", label: "Pos Z", color: "#3b82f6",
    getValue: (s, i) => (s.framePositions[i] ?? [0,0,0])[2],
    setValue: vec3Setter("framePositions", 2) },
  { id: "angle.x", label: "Rot X", color: "#f97316",
    getValue: (s, i) => (s.frameAngles[i] ?? [0,0,0])[0],
    setValue: vec3Setter("frameAngles", 0) },
  { id: "angle.y", label: "Rot Y", color: "#a855f7",
    getValue: (s, i) => (s.frameAngles[i] ?? [0,0,0])[1],
    setValue: vec3Setter("frameAngles", 1) },
  { id: "angle.z", label: "Rot Z", color: "#ec4899",
    getValue: (s, i) => (s.frameAngles[i] ?? [0,0,0])[2],
    setValue: vec3Setter("frameAngles", 2) },
  { id: "size.x", label: "Size X", color: "#f59e0b",
    getValue: (s, i) => (s.frameSizes[i] ?? [1,1,1])[0],
    setValue: vec3Setter("frameSizes", 0) },
  { id: "size.y", label: "Size Y", color: "#14b8a6",
    getValue: (s, i) => (s.frameSizes[i] ?? [1,1,1])[1],
    setValue: vec3Setter("frameSizes", 1) },
  { id: "size.z", label: "Size Z", color: "#6366f1",
    getValue: (s, i) => (s.frameSizes[i] ?? [1,1,1])[2],
    setValue: vec3Setter("frameSizes", 2) },
  { id: "color.r", label: "Red", color: "#dc2626",
    getValue: (s, i) => (s.frameColors[i] ?? [1,1,1,1])[0],
    setValue: colorSetter(0) },
  { id: "color.g", label: "Green", color: "#16a34a",
    getValue: (s, i) => (s.frameColors[i] ?? [1,1,1,1])[1],
    setValue: colorSetter(1) },
  { id: "color.b", label: "Blue", color: "#2563eb",
    getValue: (s, i) => (s.frameColors[i] ?? [1,1,1,1])[2],
    setValue: colorSetter(2) },
  { id: "color.a", label: "Alpha", color: "#737373",
    getValue: (s, i) => (s.frameColors[i] ?? [1,1,1,1])[3],
    setValue: colorSetter(3) },
];

// --- Auto-range helper ---

export function computeValueRange(
  subEffect: SubEffect,
  channels: CurveChannel[],
): [number, number] {
  let min = Infinity;
  let max = -Infinity;

  for (const ch of channels) {
    for (let i = 0; i < subEffect.frameCount; i++) {
      const v = ch.getValue(subEffect, i);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  if (!isFinite(min) || !isFinite(max)) {
    return [-1, 1];
  }
  if (min === max) {
    return [min - 1, max + 1];
  }
  const padding = (max - min) * 0.1;
  return [min - padding, max + padding];
}

// --- Component ---

const SVG_HEIGHT = 160;
const SVG_PADDING = { top: 8, bottom: 20, left: 40, right: 8 };

export default function CurveEditor() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);
  const [selectedFrameIndex, setSelectedFrameIndex] = useAtom(selectedFrameIndexAtom);
  const { pushSnapshot } = useEffectHistory();
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
    () => new Set(["position.x", "position.y", "position.z"]),
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const dragChannel = useRef<CurveChannel | null>(null);
  const dragFrameIndex = useRef<number>(0);

  const subEffect = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) return null;
    return effectData.subEffects[selectedSubEffectIndex] ?? null;
  }, [effectData, selectedSubEffectIndex]);

  const activeChannels = useMemo(
    () => CHANNELS.filter((ch) => selectedChannels.has(ch.id)),
    [selectedChannels],
  );

  const frameTimes = useMemo(() => {
    if (!subEffect) return [];
    const durations = subEffect.frameTimes.length
      ? subEffect.frameTimes
      : Array.from({ length: subEffect.frameCount }, () => 1 / 30);
    const times: number[] = [0];
    for (let i = 0; i < durations.length; i++) {
      times.push(times[i] + Math.max(durations[i], 1 / 30));
    }
    return times;
  }, [subEffect]);

  const viewRange = useMemo(() => {
    if (frameTimes.length < 2) return { start: 0, end: 1 };
    return { start: 0, end: frameTimes[frameTimes.length - 1] };
  }, [frameTimes]);

  const [minVal, maxVal] = useMemo(() => {
    if (!subEffect || activeChannels.length === 0) return [-1, 1];
    return computeValueRange(subEffect, activeChannels);
  }, [subEffect, activeChannels]);

  const svgWidth = 600; // Will scale via viewBox
  const plotW = svgWidth - SVG_PADDING.left - SVG_PADDING.right;
  const plotH = SVG_HEIGHT - SVG_PADDING.top - SVG_PADDING.bottom;

  const toggleChannel = useCallback((id: string) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDragStart = useCallback(
    (channel: CurveChannel, frameIndex: number) => {
      isDragging.current = true;
      dragChannel.current = channel;
      dragFrameIndex.current = frameIndex;
      pushSnapshot();
    },
    [pushSnapshot],
  );

  const handleDragMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!isDragging.current || !dragChannel.current || !subEffect || !effectData || selectedSubEffectIndex === null) return;

      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const scaleY = SVG_HEIGHT / rect.height;
      const localY = (event.clientY - rect.top) * scaleY;
      const plotY = localY - SVG_PADDING.top;
      const newValue = yToValue(plotY, minVal, maxVal, plotH);

      const updated = dragChannel.current.setValue(
        subEffect,
        dragFrameIndex.current,
        newValue,
      );

      const nextSubEffects = effectData.subEffects.map((se, i) =>
        i === selectedSubEffectIndex ? updated : se,
      );

      setEffectData({ ...effectData, subEffects: nextSubEffects });
      setDirty(true);
    },
    [subEffect, effectData, selectedSubEffectIndex, minVal, maxVal, plotH, setEffectData, setDirty],
  );

  const handleDragEnd = useCallback(() => {
    isDragging.current = false;
    dragChannel.current = null;
  }, []);

  if (!subEffect || subEffect.frameCount === 0) {
    return null;
  }

  // Grid lines
  const gridLines: React.ReactNode[] = [];
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const y = SVG_PADDING.top + (plotH / ySteps) * i;
    const val = maxVal - ((maxVal - minVal) / ySteps) * i;
    gridLines.push(
      <g key={`grid-y-${i}`}>
        <line
          x1={SVG_PADDING.left}
          y1={y}
          x2={SVG_PADDING.left + plotW}
          y2={y}
          stroke="#2f3239"
          strokeWidth={0.5}
        />
        <text x={SVG_PADDING.left - 4} y={y + 3} textAnchor="end" fill="#6b7280" fontSize={8}>
          {val.toFixed(1)}
        </text>
      </g>,
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background/70 p-3">
      <div className="mb-2 flex flex-wrap gap-1">
        {CHANNELS.map((ch) => (
          <button
            key={ch.id}
            type="button"
            onClick={() => toggleChannel(ch.id)}
            className={`rounded px-1.5 py-0.5 text-[9px] transition-colors ${
              selectedChannels.has(ch.id)
                ? "text-white"
                : "bg-muted/30 text-muted-foreground/50"
            }`}
            style={selectedChannels.has(ch.id) ? { backgroundColor: ch.color } : undefined}
            aria-label={`toggle-${ch.id}`}
          >
            {ch.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
        className="w-full"
        style={{ height: SVG_HEIGHT }}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
      >
        {/* Background */}
        <rect x={SVG_PADDING.left} y={SVG_PADDING.top} width={plotW} height={plotH} fill="#1a1a2e" rx={4} />
        {gridLines}

        {/* Polylines and keyframe dots per channel */}
        {activeChannels.map((ch) => {
          const points: string[] = [];
          const circles: React.ReactNode[] = [];

          for (let i = 0; i < subEffect.frameCount; i++) {
            const time = frameTimes[i] ?? 0;
            const value = ch.getValue(subEffect, i);
            const x = SVG_PADDING.left + timeToX(time, viewRange.start, viewRange.end, plotW);
            const y = SVG_PADDING.top + valueToY(value, minVal, maxVal, plotH);
            points.push(`${x},${y}`);

            circles.push(
              <circle
                key={`${ch.id}-${i}`}
                cx={x}
                cy={y}
                r={selectedFrameIndex === i ? 5 : 3.5}
                fill={ch.color}
                stroke={selectedFrameIndex === i ? "#fff" : "none"}
                strokeWidth={1.5}
                className="cursor-grab"
                data-testid={`dot-${ch.id}-${i}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSelectedFrameIndex(i);
                  handleDragStart(ch, i);
                }}
                onClick={() => setSelectedFrameIndex(i)}
              />,
            );
          }

          return (
            <g key={ch.id}>
              <polyline
                points={points.join(" ")}
                fill="none"
                stroke={ch.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                data-testid={`line-${ch.id}`}
              />
              {circles}
            </g>
          );
        })}

        {/* Playhead */}
        {selectedFrameIndex < frameTimes.length && (
          <line
            x1={SVG_PADDING.left + timeToX(frameTimes[selectedFrameIndex] ?? 0, viewRange.start, viewRange.end, plotW)}
            y1={SVG_PADDING.top}
            x2={SVG_PADDING.left + timeToX(frameTimes[selectedFrameIndex] ?? 0, viewRange.start, viewRange.end, plotW)}
            y2={SVG_PADDING.top + plotH}
            stroke="#f59e0b"
            strokeWidth={1}
            strokeDasharray="3,2"
          />
        )}
      </svg>
    </div>
  );
}
