import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { invokeTimed as invoke } from "@/commands/invokeTimed";
import { getTextureName } from "./helpers";

interface DecodedTexture {
  width: number;
  height: number;
  data: string; // base64-encoded RGBA
}

/**
 * Hook that loads a sub-effect's texture from the project's texture/effect/ directory.
 * Tries <name>.tga first. Returns a THREE.Texture or null.
 */
export function useEffectTexture(texName: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const currentProject = useAtomValue(currentProjectAtom);

  useEffect(() => {
    const name = getTextureName(texName);
    if (!name || !currentProject) {
      setTexture(null);
      return;
    }

    let cancelled = false;
    let tex: THREE.Texture | null = null;

    async function load() {
      const projectDir = currentProject!.projectDirectory;
      const path = `${projectDir}/texture/effect/${name}.tga`;

      try {
        const decoded: DecodedTexture = await invoke("decode_texture", { path });

        if (cancelled) return;

        const bytes = Uint8Array.from(atob(decoded.data), (c) => c.charCodeAt(0));
        const imageData = new ImageData(
          new Uint8ClampedArray(bytes.buffer),
          decoded.width,
          decoded.height,
        );

        const canvas = document.createElement("canvas");
        canvas.width = decoded.width;
        canvas.height = decoded.height;
        const ctx = canvas.getContext("2d")!;
        ctx.putImageData(imageData, 0, 0);

        tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        tex.flipY = true;
        setTexture(tex);
      } catch (err) {
        if (!cancelled) {
          console.warn(`[useEffectTexture] Failed to load ${path}:`, err);
          setTexture(null);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      if (tex) tex.dispose();
    };
  }, [texName, currentProject]);

  return texture;
}
