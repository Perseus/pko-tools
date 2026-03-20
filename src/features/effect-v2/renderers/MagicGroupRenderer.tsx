import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { MagicGroupEntry, MagicSingleEntry } from "@/types/effect-v2";
import { magicSingleTableAtom } from "@/store/effect-v2";
import { useTimeSource } from "../TimeContext";
import { TriggeredClock } from "../TimeContext";
import { MagicEffectRenderer } from "./MagicEffectRenderer";
import { useLoadEffect } from "../useLoadEffect";

/**
 * Phase scheduler interface — abstracts the sequencing strategy so it can
 * be swapped later (e.g., overlapping, weighted random) without touching
 * the renderer.
 */
interface PhaseScheduler {
  /** Total number of phases in the sequence. */
  phaseCount: number;
  /** Advance to the next phase. Returns the new phase index, or -1 if complete. */
  advance(currentPhase: number): number;
  /** Get the MagicSingleEntry for a given phase index. */
  getEntry(phaseIndex: number): MagicSingleEntry | null;
}

/**
 * Build a sequential phase scheduler from a MagicGroupEntry.
 * Expands typeIds + counts into a flat sequence:
 *   typeIds=[10,11], counts=[2,1] → phases=[10, 10, 11]
 */
function buildSequentialScheduler(
  group: MagicGroupEntry,
  magicTable: Map<number, MagicSingleEntry>,
): PhaseScheduler {
  const phases: number[] = [];
  for (let i = 0; i < group.typeIds.length; i++) {
    if (group.typeIds[i] < 0) continue;
    for (let j = 0; j < group.counts[i]; j++) {
      phases.push(group.typeIds[i]);
    }
  }

  return {
    phaseCount: phases.length,
    advance(currentPhase: number): number {
      const next = currentPhase + 1;
      return next < phases.length ? next : -1;
    },
    getEntry(phaseIndex: number): MagicSingleEntry | null {
      if (phaseIndex < 0 || phaseIndex >= phases.length) return null;
      return magicTable.get(phases[phaseIndex]) ?? null;
    },
  };
}

interface MagicGroupRendererProps {
  group: MagicGroupEntry;
}

/**
 * Renders a MagicGroup by playing its MagicSingle phases sequentially.
 * Each phase is wrapped in a TriggeredClock so it starts at t=0.
 * Phase transitions happen on MagicEffectRenderer completion.
 */
export function MagicGroupRenderer({ group }: MagicGroupRendererProps) {
  const table = useAtomValue(magicSingleTableAtom);
  const timeSource = useTimeSource();
  const [currentPhase, setCurrentPhase] = useState(0);
  const [phaseKey, setPhaseKey] = useState(0); // force remount on phase change

  // Build lookup map from MagicSingle table
  const magicMap = useMemo(() => {
    const map = new Map<number, MagicSingleEntry>();
    for (const entry of table?.entries ?? []) {
      map.set(entry.id, entry);
    }
    return map;
  }, [table]);

  // Build the scheduler
  const scheduler = useMemo(
    () => buildSequentialScheduler(group, magicMap),
    [group, magicMap],
  );

  // Reset to phase 0 when group changes
  useEffect(() => {
    setCurrentPhase(0);
    setPhaseKey((k) => k + 1);
  }, [group]);

  // Reset when playback time resets to 0
  const prevTime = useRef(timeSource.getTime());
  if (timeSource.getTime() < prevTime.current) {
    // Can't setState during render, schedule it
    queueMicrotask(() => {
      setCurrentPhase(0);
      setPhaseKey((k) => k + 1);
    });
  }
  prevTime.current = timeSource.getTime();

  const handlePhaseComplete = useCallback(() => {
    setCurrentPhase((prev) => {
      const next = scheduler.advance(prev);
      if (next === -1) {
        // All phases complete — loop handled by playback controls
        return prev;
      }
      setPhaseKey((k) => k + 1);
      return next;
    });
  }, [scheduler]);

  const currentEntry = scheduler.getEntry(currentPhase);
  if (!currentEntry || scheduler.phaseCount === 0) return null;

  return (
    <PhaseRenderer
      key={`phase-${phaseKey}`}
      entry={currentEntry}
      onComplete={handlePhaseComplete}
    />
  );
}

/**
 * Renders a single phase: loads .eff files, wraps in TriggeredClock,
 * delegates to MagicEffectRenderer.
 */
function PhaseRenderer({
  entry,
  onComplete,
}: {
  entry: MagicSingleEntry;
  onComplete: () => void;
}) {
  const effFiles = useLoadEffect(entry.models);

  return (
    <TriggeredClock loop={false}>
      <MagicEffectRenderer
        effFiles={effFiles}
        magicEntry={entry}
        onComplete={onComplete}
      />
    </TriggeredClock>
  );
}
