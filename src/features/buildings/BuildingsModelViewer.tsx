import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useGltfResource } from "@/hooks/use-gltf-resource";
import {
  extractMeshes,
  MeshHighlights,
  getUniqueMeshIndices,
} from "@/features/character/MeshHighlights";

function toClipTime(
  frameIndex: number,
  totalKeyframes: number,
  duration: number
): number {
  const denominator = Math.max(totalKeyframes - 1, 1);
  return (frameIndex / denominator) * duration;
}

interface BuildingModelProps {
  gltfDataURI: string;
  showMeshOutlines: boolean;
  playAnimation: boolean;
}

function BuildingModel({
  gltfDataURI,
  showMeshOutlines,
  playAnimation,
}: BuildingModelProps) {
  const { scene, animations } = useGLTF(gltfDataURI);
  const { mixer } = useAnimations(animations, scene);
  const primaryClip = animations[0] ?? null;
  const hasAnimation = animations.length > 0;
  const animationDuration = primaryClip?.duration || 1;
  const fps = 30;
  const totalKeyframes = Math.max(Math.floor(animationDuration * fps), 1);

  const [playing, setPlaying] = useState(hasAnimation);
  const [currentKeyframe, setCurrentKeyframe] = useState(0);
  const timeAccumulator = useRef(0);

  // Sync playAnimation prop → local playing state
  useEffect(() => {
    if (hasAnimation) {
      setPlaying(playAnimation);
    }
  }, [playAnimation, hasAnimation]);

  // Extract meshes for highlights and visibility toggles
  const meshes = useMemo(() => extractMeshes(scene), [scene]);
  const meshIndices = useMemo(() => getUniqueMeshIndices(meshes), [meshes]);
  const [visibleMeshIndices, setVisibleMeshIndices] = useState<Set<number>>(
    () => new Set(meshIndices)
  );

  useEffect(() => {
    setVisibleMeshIndices(new Set(meshIndices));
  }, [meshIndices]);

  // Animation controls (keyframe scrubber only — play/pause driven by prop)
  const [, setAnimationControls] = useControls(
    "Animation",
    () => ({
      keyframe: {
        value: currentKeyframe,
        min: 0,
        max: totalKeyframes,
        step: 1,
        label: "Keyframe",
        onChange: (v: number) => {
          setCurrentKeyframe(v);
          const newTime = toClipTime(v, totalKeyframes, animationDuration);
          mixer.setTime(newTime);
          timeAccumulator.current = 0;
        },
        render: () => hasAnimation,
      },
    }),
    { collapsed: !hasAnimation },
    [hasAnimation, totalKeyframes]
  );

  // Dynamic geom node visibility toggles
  const meshVisibilityConfig = useMemo(() => {
    if (meshIndices.length <= 1) return {};
    const config: Record<string, unknown> = {};
    meshIndices.forEach((idx) => {
      config[`node${idx}`] = {
        value: true,
        label: `Node ${idx}`,
        onChange: (visible: boolean) => {
          setVisibleMeshIndices((prev) => {
            const next = new Set(prev);
            if (visible) {
              next.add(idx);
            } else {
              next.delete(idx);
            }
            return next;
          });
        },
      };
    });
    return config;
  }, [meshIndices]);

  useControls("Geom Nodes", meshVisibilityConfig, { collapsed: true }, [
    meshVisibilityConfig,
  ]);

  // Animation playback frame loop
  useFrame((_state, delta) => {
    if (!hasAnimation) return;

    if (playing) {
      timeAccumulator.current += delta;
      const keyframeDuration = 1 / fps;

      if (timeAccumulator.current >= keyframeDuration) {
        const framesToAdvance = Math.floor(
          timeAccumulator.current / keyframeDuration
        );
        timeAccumulator.current =
          timeAccumulator.current % keyframeDuration;

        setCurrentKeyframe((prev) => {
          let next = prev + framesToAdvance;
          if (next >= totalKeyframes) {
            next = next % totalKeyframes;
          }
          setAnimationControls({ keyframe: next });
          const newTime = toClipTime(next, totalKeyframes, animationDuration);
          mixer.setTime(newTime);
          return next;
        });
      }
    } else {
      const newTime = toClipTime(
        currentKeyframe,
        totalKeyframes,
        animationDuration
      );
      mixer.setTime(newTime);
    }
  });

  // Start animation clip
  useEffect(() => {
    if (!primaryClip) return;

    const action = mixer.clipAction(primaryClip, scene);
    action.reset().play();

    return () => {
      action.stop();
      try {
        mixer.stopAllAction();
      } catch {
        // ignore teardown race
      }
      try {
        mixer.uncacheClip(primaryClip);
      } catch {
        // ignore teardown race
      }
      try {
        mixer.uncacheRoot(scene);
      } catch {
        // ignore teardown race
      }
      timeAccumulator.current = 0;
      setPlaying(false);
      setCurrentKeyframe(0);
      setAnimationControls({ keyframe: 0 });
    };
  }, [mixer, primaryClip, scene, setAnimationControls]);

  // Toggle mesh visibility in the scene
  useEffect(() => {
    meshes.forEach(({ mesh, index }) => {
      mesh.visible = visibleMeshIndices.has(index);
    });
  }, [meshes, visibleMeshIndices]);

  return (
    <>
      <primitive object={scene} />
      <MeshHighlights
        scene={scene}
        visible={showMeshOutlines}
        visibleMeshIndices={visibleMeshIndices}
      />
    </>
  );
}

interface BuildingsModelViewerProps {
  gltfJson: string;
  showMeshOutlines: boolean;
  playAnimation: boolean;
}

export default function BuildingsModelViewer({
  gltfJson,
  showMeshOutlines,
  playAnimation,
}: BuildingsModelViewerProps) {
  const dataURI = useGltfResource(gltfJson);

  useEffect(() => {
    return () => {
      if (dataURI) {
        useGLTF.clear(dataURI);
      }
    };
  }, [dataURI]);

  if (!dataURI) return null;

  return (
    <BuildingModel
      key={dataURI}
      gltfDataURI={dataURI}
      showMeshOutlines={showMeshOutlines}
      playAnimation={playAnimation}
    />
  );
}
