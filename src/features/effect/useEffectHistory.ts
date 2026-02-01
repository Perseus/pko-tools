import { useCallback } from "react";
import { useAtom } from "jotai";
import { effectDataAtom, effectDirtyAtom } from "@/store/effect";
import { effectHistoryAtom } from "@/store/effectHistory";

/**
 * Hook providing undo/redo actions for effect data.
 *
 * Usage:
 *   const { undo, redo, pushSnapshot, canUndo, canRedo } = useEffectHistory();
 *   // Before mutating effect data:
 *   pushSnapshot();
 *   setEffectData(newData);
 */
export function useEffectHistory() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [history, setHistory] = useAtom(effectHistoryAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  /** Save the current effectData as an undo snapshot. Call before mutations. */
  const pushSnapshot = useCallback(() => {
    if (!effectData) return;
    setHistory((prev) => {
      const past = [...prev.past, structuredClone(effectData)];
      if (past.length > 50) past.shift();
      return { past, future: [] };
    });
  }, [effectData, setHistory]);

  /** Undo: restore previous state, push current to future. */
  const undo = useCallback(() => {
    if (history.past.length === 0 || !effectData) return;
    const past = [...history.past];
    const prev = past.pop()!;
    setHistory({
      past,
      future: [...history.future, structuredClone(effectData)],
    });
    setEffectData(prev);
    setDirty(true);
  }, [effectData, history, setEffectData, setHistory, setDirty]);

  /** Redo: restore next state, push current to past. */
  const redo = useCallback(() => {
    if (history.future.length === 0 || !effectData) return;
    const future = [...history.future];
    const next = future.pop()!;
    setHistory({
      past: [...history.past, structuredClone(effectData)],
      future,
    });
    setEffectData(next);
    setDirty(true);
  }, [effectData, history, setEffectData, setHistory, setDirty]);

  /** Reset history (e.g., when loading a new file). */
  const resetHistory = useCallback(() => {
    setHistory({ past: [], future: [] });
  }, [setHistory]);

  return { undo, redo, pushSnapshot, canUndo, canRedo, resetHistory };
}
