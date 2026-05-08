import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { currentProjectAtom } from "@/store/project";
import { invokeTimed as invoke } from "@/commands/invokeTimed";

interface DecodedTexture {
  width: number;
  height: number;
  data: string; // base64-encoded RGBA
}

const EFFECT_TEXTURE_DIRS = [
  "texture/effect",
  "texture",
  "texture/skill",
  "texture/sceneffect",
  "texture/lit",
];

const EFFECT_TEXTURE_EXTENSIONS = ["tga", "dds", "png", "bmp"];

export function resolveEffectTextureCandidates(
  texName: string,
  projectDirectory: string,
): string[] {
  const trimmed = texName.trim();
  if (!trimmed) return [];

  const hasExtension = /\.[^./\\]+$/.test(trimmed);
  const names = hasExtension
    ? [trimmed]
    : EFFECT_TEXTURE_EXTENSIONS.map((ext) => `${trimmed}.${ext}`);

  return EFFECT_TEXTURE_DIRS.flatMap((dir) =>
    names.map((name) => `${projectDirectory}/${dir}/${name}`)
  );
}

export function emulateD3dA8R8G8B8(rgba: Uint8Array): Uint8Array {
  return new Uint8Array(rgba);
}

/**
 * Hook that loads a sub-effect's texture from the project's texture/effect/ directory.
 * Tries <name>.tga first. Returns a THREE.Texture or null.
 *
 * Uses DataTexture with flipY=false and SRGBColorSpace to match V1's
 * createEffectTexture() — the decoded RGBA is already in OpenGL row order
 * (bottom-to-top), so no flip is needed. The reference client asks effect
 * resources for A4R4G4B4 in CMPResManger, but lwTex::LoadVideoMemory overrides
 * the upload format to D3DFMT_A8R8G8B8, so preserve decoded 8-bit alpha.
 */
export function useEffectTexture(texName: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const currentProject = useAtomValue(currentProjectAtom);

  useEffect(() => {
    if (!texName.trim() || !currentProject) {
      setTexture(null);
      return;
    }

    let cancelled = false;
    let tex: THREE.Texture | null = null;

    async function load() {
      const projectDir = currentProject!.projectDirectory;
      const candidates = resolveEffectTextureCandidates(texName, projectDir);

      for (const path of candidates) {
        try {
          const decoded: DecodedTexture = await invoke("decode_texture", { path });

          if (cancelled) return;

          const bytes = Uint8Array.from(atob(decoded.data), (c) => c.charCodeAt(0));
          const effectBytes = emulateD3dA8R8G8B8(bytes);

          // Use DataTexture with V1's exact settings — decoded RGBA is already
          // in OpenGL row order, so flipY=false is correct.
          tex = new THREE.DataTexture(
            effectBytes,
            decoded.width,
            decoded.height,
            THREE.RGBAFormat,
          );
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearFilter;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
          setTexture(tex);
          return;
        } catch {
          // Try the next candidate path.
        }
      }

      if (!cancelled) setTexture(null);
    }

    load();

    return () => {
      cancelled = true;
      if (tex) tex.dispose();
    };
  }, [texName, currentProject]);

  return texture;
}
