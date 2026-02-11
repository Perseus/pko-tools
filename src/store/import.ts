import { atom } from "jotai";
import {
  INITIAL_WIZARD_STATE,
  type ImportWizardState,
  type ImportWizardStep,
  type ImportType,
  IMPORT_STEPS,
} from "@/types/import";

export const importWizardOpenAtom = atom(false);

export const importWizardStateAtom = atom<ImportWizardState>({
  ...INITIAL_WIZARD_STATE,
});

// Derived write-only atoms for specific state updates (stable setter identity)
export const setImportStepAtom = atom(null, (_get, set, step: ImportWizardStep) => {
  set(importWizardStateAtom, (prev) => ({ ...prev, step }));
});

export const setImportTypeAtom = atom(null, (_get, set, importType: ImportType) => {
  set(importWizardStateAtom, (prev) => ({ ...prev, importType }));
});

export const setImportFileAtom = atom(
  null,
  (_get, set, filePath: string | null, fileName: string | null) => {
    set(importWizardStateAtom, (prev) => ({ ...prev, filePath, fileName }));
  }
);

export const setImportModelIdAtom = atom(null, (_get, set, modelId: string) => {
  set(importWizardStateAtom, (prev) => ({ ...prev, modelId }));
});

export const setImportCharacterNameAtom = atom(
  null,
  (_get, set, characterName: string) => {
    set(importWizardStateAtom, (prev) => ({ ...prev, characterName }));
  }
);

export const setImportScaleAtom = atom(null, (_get, set, scaleFactor: number) => {
  set(importWizardStateAtom, (prev) => ({ ...prev, scaleFactor }));
});

export const resetImportWizardAtom = atom(null, (_get, set) => {
  set(importWizardStateAtom, { ...INITIAL_WIZARD_STATE });
  set(importWizardOpenAtom, false);
});

export const openImportWizardAtom = atom(null, (_get, set, importType: ImportType) => {
  set(importWizardStateAtom, { ...INITIAL_WIZARD_STATE, importType });
  set(importWizardOpenAtom, true);
});

// Navigation helpers
export const canGoNextAtom = atom((get) => {
  const state = get(importWizardStateAtom);
  const currentIdx = IMPORT_STEPS.indexOf(state.step);
  if (currentIdx >= IMPORT_STEPS.length - 1) return false;

  switch (state.step) {
    case "file-selection":
      return state.filePath !== null;
    case "preview":
      return state.validationReport !== null;
    case "configuration":
      return state.modelId.length > 0;
    case "processing":
      return !state.isProcessing;
    case "result":
      return false;
    default:
      return false;
  }
});

export const canGoPrevAtom = atom((get) => {
  const state = get(importWizardStateAtom);
  const currentIdx = IMPORT_STEPS.indexOf(state.step);
  return currentIdx > 0 && state.step !== "processing";
});
