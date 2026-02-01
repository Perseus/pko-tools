import { atom } from "jotai";
import type { ParticleController } from "@/types/particle";

/** The loaded particle controller data (null when no file loaded). */
export const particleDataAtom = atom<ParticleController | null>(null);

/** Index of the currently selected particle system within the controller. */
export const selectedParticleSystemIndexAtom = atom<number | null>(null);

/** Whether particle data has unsaved changes. */
export const particleDirtyAtom = atom(false);

/** Original data snapshot for dirty comparison / revert. */
export const particleOriginalAtom = atom<ParticleController | null>(null);
