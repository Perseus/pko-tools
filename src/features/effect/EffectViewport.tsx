import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import React from "react";
import EffectMeshRenderer from "@/features/effect/EffectMeshRenderer";
import EffectPlaybackDriver from "@/features/effect/EffectPlaybackDriver";
import { effectDataAtom, effectTextureStatusAtom } from "@/store/effect";
import { useAtomValue } from "jotai";

export default function EffectViewport() {
  const effectData = useAtomValue(effectDataAtom);
  const textureStatus = useAtomValue(effectTextureStatusAtom);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-muted/40">
      <Canvas camera={{ position: [6, 6, 6], fov: 35 }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[6, 8, 4]} intensity={1.2} />
        <EffectMeshRenderer />
        <EffectPlaybackDriver />
        <gridHelper args={[40, 40, "#2f3239", "#1b1d22"]} />
        <OrbitControls enablePan enableZoom />
      </Canvas>
      {!effectData && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
          Load an effect to preview it here.
        </div>
      )}
      {textureStatus.status === "error" && textureStatus.textureName && (
        <div className="absolute right-3 top-3 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive">
          Missing texture: {textureStatus.textureName}
        </div>
      )}
    </div>
  );
}
