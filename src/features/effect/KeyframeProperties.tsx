import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/features/effect/HelpTip";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { keyframeClipboardAtom } from "@/store/keyframeClipboard";
import { useAtom } from "jotai";
import { Clipboard, ClipboardPaste } from "lucide-react";
import React from "react";
import { useCallback, useEffect, useMemo } from "react";
import { useEffectHistory } from "@/features/effect/useEffectHistory";

function formatVector(values: number[], precision = 2) {
  return values.map((value) => value.toFixed(precision)).join(", ");
}

export default function KeyframeProperties() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);
  const [selectedFrameIndex] = useAtom(selectedFrameIndexAtom);
  const [clipboard, setClipboard] = useAtom(keyframeClipboardAtom);
  const { pushSnapshot } = useEffectHistory();

  const frameData = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) {
      return null;
    }

    const subEffect = effectData.subEffects[selectedSubEffectIndex];
    if (!subEffect) {
      return null;
    }

    const frameIndex = Math.min(
      Math.max(selectedFrameIndex, 0),
      Math.max(subEffect.frameCount - 1, 0)
    );

    return {
      frameIndex,
      subEffect,
      size: subEffect.frameSizes[frameIndex] ?? [1, 1, 1],
      angle: subEffect.frameAngles[frameIndex] ?? [0, 0, 0],
      position: subEffect.framePositions[frameIndex] ?? [0, 0, 0],
      color: subEffect.frameColors[frameIndex] ?? [1, 1, 1, 1],
    };
  }, [effectData, selectedSubEffectIndex, selectedFrameIndex]);

  function updateFrameVector(
    key: "frameSizes" | "frameAngles" | "framePositions" | "frameColors",
    values: number[]
  ) {
    if (!effectData || selectedSubEffectIndex === null || !frameData) {
      return;
    }

    const nextSubEffects = effectData.subEffects.map((subEffect, index) => {
      if (index !== selectedSubEffectIndex) {
        return subEffect;
      }

      const nextFrames = [...subEffect[key]];
      nextFrames[frameData.frameIndex] = values as typeof nextFrames[number];

      return {
        ...subEffect,
        [key]: nextFrames,
      };
    });

    setEffectData({
      ...effectData,
      subEffects: nextSubEffects,
    });
    setDirty(true);
  }

  function handleVectorChange(
    key: "frameSizes" | "frameAngles" | "framePositions" | "frameColors",
    values: number[],
    index: number,
    nextValue: string
  ) {
    const parsed = Number(nextValue);
    if (Number.isNaN(parsed)) {
      return;
    }

    const nextValues = [...values];
    nextValues[index] = key === "frameColors" ? Math.min(Math.max(parsed, 0), 1) : parsed;
    updateFrameVector(key, nextValues);
  }

  const handleCopy = useCallback(() => {
    if (!frameData) return;
    setClipboard({
      size: [...frameData.size] as [number, number, number],
      angle: [...frameData.angle] as [number, number, number],
      position: [...frameData.position] as [number, number, number],
      color: [...frameData.color] as [number, number, number, number],
    });
  }, [frameData, setClipboard]);

  const handlePaste = useCallback(() => {
    if (!clipboard || !frameData) return;
    pushSnapshot();
    updateFrameVector("frameSizes", clipboard.size);
    updateFrameVector("frameAngles", clipboard.angle);
    updateFrameVector("framePositions", clipboard.position);
    updateFrameVector("frameColors", clipboard.color);
  }, [clipboard, frameData, pushSnapshot]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!frameData) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "c" && !event.shiftKey) {
        // Only intercept when not in a text input
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        event.preventDefault();
        handleCopy();
      }
      if (mod && event.key.toLowerCase() === "v" && !event.shiftKey) {
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (!clipboard) return;
        event.preventDefault();
        handlePaste();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frameData, clipboard, handleCopy, handlePaste]);

  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-border bg-background/70 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Keyframe</div>
          <div className="text-xs text-muted-foreground">
            {frameData ? `Frame ${frameData.frameIndex + 1}` : "No keyframe selected"}
          </div>
        </div>
        {frameData && (
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Copy keyframe (Cmd+C)"
              aria-label="copy-keyframe"
              onClick={handleCopy}
            >
              <Clipboard className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Paste keyframe (Cmd+V)"
              aria-label="paste-keyframe"
              disabled={clipboard === null}
              onClick={handlePaste}
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {frameData ? (
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="space-y-2">
            <FieldLabel help="World-space offset from effect origin. Values in game units.">Position (X, Y, Z)</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {frameData.position.map((value, index) => (
                <Input
                  key={`pos-${index}`}
                  type="number"
                  step="0.01"
                  aria-label={`position-${index}`}
                  placeholder={["X", "Y", "Z"][index]}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("framePositions", frameData.position, index, event.target.value)
                  }
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel help="Euler rotation in radians. X=pitch, Y=yaw, Z=roll. Full rotation = 6.28 (~2π).">Rotation (X, Y, Z)</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {frameData.angle.map((value, index) => (
                <Input
                  key={`rot-${index}`}
                  type="number"
                  step="0.01"
                  aria-label={`rotation-${index}`}
                  placeholder={["X", "Y", "Z"][index]}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("frameAngles", frameData.angle, index, event.target.value)
                  }
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel help="Size multiplier per axis. 1.0 = original size. Values below 1 shrink, above 1 enlarge.">Scale (X, Y, Z)</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {frameData.size.map((value, index) => (
                <Input
                  key={`scale-${index}`}
                  type="number"
                  step="0.01"
                  aria-label={`scale-${index}`}
                  placeholder={["X", "Y", "Z"][index]}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("frameSizes", frameData.size, index, event.target.value)
                  }
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel help="Color tint and transparency. Each channel 0.0-1.0. R/G/B control color, A controls opacity (0=invisible, 1=opaque).">Color (R, G, B, A)</FieldLabel>
            <div className="grid grid-cols-4 gap-2">
              {frameData.color.map((value, index) => (
                <Input
                  key={`color-${index}`}
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  aria-label={`color-${index}`}
                  placeholder={["R", "G", "B", "A"][index]}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("frameColors", frameData.color, index, event.target.value)
                  }
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground">
                {formatVector(frameData.color)}
              </div>
              <div
                className="h-3 w-8 rounded border border-border"
                style={{
                  backgroundColor: `rgba(${Math.round(frameData.color[0] * 255)}, ${Math.round(frameData.color[1] * 255)}, ${Math.round(frameData.color[2] * 255)}, ${frameData.color[3]})`,
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Select a sub-effect from the left panel, then use the timeline to pick a frame.
        </div>
      )}
    </div>
  );
}
