import { WorkbenchState, WorkbenchSummary } from "@/types/item";
import { atom } from "jotai";

/** The currently active workbench being edited */
export const activeWorkbenchAtom = atom<WorkbenchState | null>(null);

/** List of all workbenches for the navigator */
export const workbenchListAtom = atom<WorkbenchSummary[]>([]);

/** Whether we're in workbench mode (editing an imported item) */
export const isWorkbenchModeAtom = atom<boolean>(false);

/** Currently selected dummy for editing */
export const editingDummyAtom = atom<number | null>(null);

/** Whether click-to-place mode is active */
export const dummyPlacementModeAtom = atom<boolean>(false);
