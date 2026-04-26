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
 *
 * Uses DataTexture with flipY=false and SRGBColorSpace to match V1's
 * createEffectTexture() — the decoded RGBA is already in OpenGL row order
 * (bottom-to-top), so no flip is needed.
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

        // Use DataTexture with V1's exact settings — decoded RGBA is already
        // in OpenGL row order, so flipY=false is correct.
        tex = new THREE.DataTexture(
          new Uint8Array(bytes.buffer),
          decoded.width,
          decoded.height,
          THREE.RGBAFormat,
        );
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.needsUpdate = true;
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
