import { atom } from "jotai";
import type { Vec3 } from "@/types/effect";

export const pathPointsAtom = atom<Vec3[] | null>(null);
