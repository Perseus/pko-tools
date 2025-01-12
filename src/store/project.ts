import { Project } from "@/types/project";
import { atom } from "jotai";

export const projectListAtom = atom<Project[]>([]);
export const currentProjectAtom = atom<Project | null>(null);
