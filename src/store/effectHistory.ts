import { atom } from "jotai";
import type { EffectFile } from "@/types/effect";

const MAX_HISTORY = 50;

export type EffectHistoryState = {
  /** Past states (most recent at end). */
  past: EffectFile[];
  /** Future states for redo (most recent at end). */
  future: EffectFile[];
};

export const effectHistoryAtom = atom<EffectHistoryState>({
  past: [],
  future: [],
});

/** Push the current state onto the undo stack. Call BEFORE mutating effectDataAtom. */
export const pushHistoryAtom = atom(null, (get, set, snapshot: EffectFile) => {
  const history = get(effectHistoryAtom);
  const past = [...history.past, structuredClone(snapshot)];
  if (past.length > MAX_HISTORY) {
    past.shift();
  }
  set(effectHistoryAtom, { past, future: [] });
});

/** Whether undo is available. */
export const canUndoAtom = atom((get) => get(effectHistoryAtom).past.length > 0);

/** Whether redo is available. */
export const canRedoAtom = atom((get) => get(effectHistoryAtom).future.length > 0);
