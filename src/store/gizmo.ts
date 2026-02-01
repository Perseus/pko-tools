import { atom } from "jotai";

export type GizmoMode = "translate" | "rotate" | "scale" | "off";
export const gizmoModeAtom = atom<GizmoMode>("translate");
