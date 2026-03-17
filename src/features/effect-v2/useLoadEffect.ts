import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { currentProjectAtom } from "@/store/project";
import { loadEffect } from "@/commands/effect";
import { EffectFile } from "@/types/effect";

/**
 * Hook that loads one or more .eff files by name.
 * Returns the parsed EffectFile array (empty while loading or on error).
 */
export function useLoadEffect(effectNames: string[]): EffectFile[] {
  const currentProject = useAtomValue(currentProjectAtom);
  const [effFiles, setEffFiles] = useState<EffectFile[]>([]);

  useEffect(() => {
    if (!currentProject || effectNames.length === 0) {
      setEffFiles([]);
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      const results: EffectFile[] = [];
      for (const name of effectNames) {
        try {
          const data = await loadEffect(currentProject!.id, name);
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
