import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { currentProjectAtom } from "@/store/project";
import { loadEffect } from "@/commands/effect";
import { EffectFile } from "@/types/effect";

const effectCache = new Map<string, EffectFile>();
const effectInflight = new Map<string, Promise<EffectFile>>();

function getEffectCacheKey(projectId: string, effectName: string): string {
  return `${projectId}:${effectName.trim().toLowerCase()}`;
}

export function clearEffectLoadCacheForTest(): void {
  effectCache.clear();
  effectInflight.clear();
}

export async function loadCachedEffect(
  projectId: string,
  effectName: string,
): Promise<EffectFile> {
  const key = getEffectCacheKey(projectId, effectName);
  const cached = effectCache.get(key);
  if (cached) return cached;

  const pending = effectInflight.get(key);
  if (pending) return pending;

  const request = loadEffect(projectId, effectName)
    .then((effect) => {
      effectCache.set(key, effect);
      effectInflight.delete(key);
      return effect;
    })
    .catch((err) => {
      effectInflight.delete(key);
      throw err;
    });

  effectInflight.set(key, request);
  return request;
}

/**
 * Hook that loads one or more .eff files by name.
 * Returns the parsed EffectFile array (empty while loading or on error).
 */
export function useLoadEffect(effectNames: string[]): EffectFile[] {
  const currentProject = useAtomValue(currentProjectAtom);
  const [effFiles, setEffFiles] = useState<EffectFile[]>(() =>
    currentProject ? getCachedEffects(currentProject.id, effectNames) : [],
  );

  useEffect(() => {
    if (!currentProject || effectNames.length === 0) {
      setEffFiles([]);
      return;
    }

    const cached = getCachedEffects(currentProject.id, effectNames);
    if (cached.length === effectNames.length) {
      setEffFiles(cached);
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      const results: EffectFile[] = [];
      for (const name of effectNames) {
        try {
          const data = await loadCachedEffect(currentProject!.id, name);
          if (cancelled) return;
          results.push(data);
        } catch (err) {
          console.warn(`[useLoadEffect] Failed to load ${name}:`, err);
        }
      }
      if (!cancelled) setEffFiles(results);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [effectNames.join(","), currentProject]);

  return effFiles;
}

function getCachedEffects(projectId: string, effectNames: string[]): EffectFile[] {
  const results: EffectFile[] = [];
  for (const name of effectNames) {
    const cached = effectCache.get(getEffectCacheKey(projectId, name));
    if (!cached) break;
    results.push(cached);
  }
  return results;
}
