import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadPathFile } from "@/commands/effect";
import {
  effectDataAtom,
  effectDirtyAtom,
} from "@/store/effect";
import { pathPointsAtom } from "@/store/path";
import { currentProjectAtom } from "@/store/project";
import type { EffectPath, Vec3 } from "@/types/effect";
import { useAtom, useAtomValue } from "jotai";
import { Plus, Trash2 } from "lucide-react";
import React from "react";
import { useEffect, useMemo, useState } from "react";
import { FieldLabel, SmallLabel } from "@/features/effect/HelpTip";

/**
 * Editor for effect path data (.csf format).
 * Shown when the effect's usePath flag is enabled.
 * Allows editing path control points (Vec3 list).
 */
export default function PathEditor() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const [, setPathPoints] = useAtom(pathPointsAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [pathData, setPathData] = useState<EffectPath>({
    name: "",
    points: [],
  });

  const visible = useMemo(() => {
    return effectData?.usePath === true;
  }, [effectData]);

  // Load path points from .csf file when path is configured
  useEffect(() => {
    if (!visible || !effectData?.pathName || !currentProject) {
      setPathPoints(null);
      return;
    }

    const pathName = effectData.pathName.trim();
    if (!pathName) {
      setPathPoints(null);
      return;
    }

    let cancelled = false;
    loadPathFile(currentProject.id, pathName)
      .then((points) => {
        if (cancelled) return;
        const vecPoints: Vec3[] = points.map(([x, y, z]) => [x, y, z]);
        setPathData((prev) => ({ ...prev, points: vecPoints }));
        setPathPoints(vecPoints);
      })
      .catch(() => {
        // File might not exist yet
      });

    return () => { cancelled = true; };
  }, [visible, effectData?.pathName, currentProject, setPathPoints]);

  // Sync local path data changes to atom
  useEffect(() => {
    if (visible && pathData.points.length > 0) {
      setPathPoints(pathData.points);
    }
  }, [visible, pathData.points, setPathPoints]);

  if (!visible) return null;

  function updatePoint(index: number, component: 0 | 1 | 2, value: string) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    const next = pathData.points.map((p, i) => {
      if (i !== index) return p;
      const copy: Vec3 = [...p];
      copy[component] = v;
      return copy;
    });
    setPathData({ ...pathData, points: next });
  }

  function addPoint() {
    const last = pathData.points[pathData.points.length - 1];
    const newPoint: Vec3 = last ? [last[0], last[1], last[2] + 1] : [0, 0, 0];
    setPathData({
      ...pathData,
      points: [...pathData.points, newPoint],
    });
  }

  function removePoint(index: number) {
    setPathData({
      ...pathData,
      points: pathData.points.filter((_, i) => i !== index),
    });
  }

  return (
    <div className="space-y-2">
      <FieldLabel help="Curve path (.csf file) that the effect follows during playback. Enable 'Use Path' in Effect Properties first. Add control points to define the curve shape.">
        Path ({pathData.points.length} points)
      </FieldLabel>
      <div className="space-y-1">
        <SmallLabel help="Reference to a .csf curve file in the effect directory.">
          Path Name
        </SmallLabel>
        <Input
          value={effectData?.pathName ?? ""}
          onChange={(e) => {
            if (!effectData) return;
            setEffectData({ ...effectData, pathName: e.target.value });
            setDirty(true);
          }}
          placeholder="path.csf"
          className="h-7 text-xs"
        />
      </div>
      {pathData.points.length > 0 && (
        <>
          <div className="flex gap-1 px-5 text-[9px] text-muted-foreground">
            <span className="flex-1 text-center">X</span>
            <span className="flex-1 text-center">Y</span>
            <span className="flex-1 text-center">Z</span>
            <span className="w-5" />
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {pathData.points.map((pt, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-center text-[9px] text-muted-foreground">
                  {i}
                </span>
                {([0, 1, 2] as const).map((c) => (
                  <Input
                    key={c}
                    type="number"
                    step="0.5"
                    value={pt[c]}
                    onChange={(e) => updatePoint(i, c, e.target.value)}
                    className="h-6 text-[10px]"
                  />
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 shrink-0 p-0"
                  onClick={() => removePoint(i)}
                  title="Remove this control point"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        onClick={addPoint}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add Point
      </Button>
    </div>
  );
}
