import { atom } from "jotai";
import type { Vec3, Vec4 } from "@/types/effect";

export type KeyframeClipboard = {
  size: Vec3;
  angle: Vec3;
  position: Vec3;
  color: Vec4;
} | null;

export const keyframeClipboardAtom = atom<KeyframeClipboard>(null);
