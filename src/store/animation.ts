import { atom } from "jotai";

export const selectedAnimationAtom = atom<string | null>(null);
export const currentAnimationActionAtom = atom<
  "load-animation" | "convert-animation" | ""
>("");
export const currentActionStatusAtom = atom<string>("");
export const currentActionProgressAtom = atom<number>(0);
