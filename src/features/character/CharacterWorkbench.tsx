import { characterGltfJsonAtom, characterMetadataAtom, dummyEditModeAtom } from "@/store/character";
import { useAtomValue, useSetAtom } from "jotai";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGLTF, OrbitControls,  CameraControls,  Environment, useAnimations } from '@react-three/drei';
import { Canvas, useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import { useControls, Leva } from 'leva';
import { extractBoundingSpheres, BoundingSphereIndicators } from './BoundingSphereIndicators';
import { SkeletonDebugHelpers } from './SkeletonDebugHelpers';
import { CharacterMetadataPanel } from './CharacterMetadataPanel';
import { extractMeshes, MeshHighlights, getUniqueMeshIndices } from './MeshHighlights';
import { useGltfResource } from "@/hooks/use-gltf-resource";
import { actionIds } from "@/features/actions/actionIds";
import { ContextualActionMenu } from "@/features/actions/ContextualActionMenu";
import { PerfFrameProbe, PerfOverlay } from "@/features/perf";
import { CanvasErrorBoundary } from "@/components/CanvasErrorBoundary";

const CHARACTER_CONTEXT_ACTIONS = [
  actionIds.characterExportGltf,
  actionIds.characterImportGltf,
];

function clearSceneHelpers(scene: THREE.Object3D) {
  scene.traverse((obj: THREE.Object3D) => {
    const helpers = obj.children.filter((c) => c.userData?.isHelper);
    helpers.forEach((h) => obj.remove(h));
  });
}

function toClipTime(frameIndex: number, totalKeyframes: number, duration: number): number {
  const denominator = Math.max(totalKeyframes - 1, 1);
  return (frameIndex / denominator) * duration;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;

function CharacterModel({ gltfDataURI }: { gltfDataURI: string }) {
  const { scene, animations } = useGLTF(gltfDataURI);
  const { mixer } = useAnimations(animations, scene);
  const setDummyEditMode = useSetAtom(dummyEditModeAtom);

  const hasSplitAnimations = animations.length > 1;

  // --- Split animation state ---
  const [selectedClipIndex, setSelectedClipIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentKeyframe, setCurrentKeyframe] = useState(0);
  const timeAccumulator = useRef(0);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);

  const selectedClip = animations[selectedClipIndex] ?? animations[0] ?? null;
  const fps = 30;
  const animationDuration = selectedClip?.duration || 1;
  const totalKeyframes = Math.max(Math.floor(animationDuration * fps), 1);

  // Extract bounding spheres and meshes from the loaded glTF scene
  const boundingSpheres = useMemo(() => extractBoundingSpheres(scene), [scene]);
  const meshes = useMemo(() => extractMeshes(scene), [scene]);
  const meshIndices = useMemo(() => getUniqueMeshIndices(meshes), [meshes]);

  // State for visible mesh indices (all visible by default)
  const [visibleMeshIndices, setVisibleMeshIndices] = useState<Set<number>>(() => new Set(meshIndices));

  // Update visible indices when meshes change
  useEffect(() => {
    setVisibleMeshIndices(new Set(meshIndices));
  }, [meshIndices]);

  // --- Legacy single-animation controls (when only 1 animation) ---
  const [, setAnimationControls] = useControls(() => ({
    ...(hasSplitAnimations ? {} : {
      play: {
        value: playing,
        label: 'Play animation',
        onChange: (v: boolean) => setPlaying(v),
      },
      keyframe: {
        value: currentKeyframe,
        min: 0,
        max: totalKeyframes,
        step: 1,
        label: 'Keyframe',
        onChange: (v: number) => {
          setCurrentKeyframe(v);
          const newTime = toClipTime(v, totalKeyframes, animationDuration);
          mixer.setTime(newTime);
          timeAccumulator.current = 0;
        }
      }
    })
  }));

  const { showBoundingSpheres, showMeshHighlights, showBones, showDummies, editDummies } = useControls('Debug', {
    showBoundingSpheres: {
      value: false,
      label: 'Show Bounding Spheres',
    },
    showMeshHighlights: {
      value: false,
      label: 'Show Mesh Outlines',
    },
    showBones: {
      value: false,
      label: 'Show Bones',
    },
    showDummies: {
      value: false,
      label: 'Show Dummies',
    },
    editDummies: {
      value: false,
      label: 'Edit Dummies',
    },
  });

  // Sync editDummies leva control with the jotai atom; reset on unmount (model switch)
  useEffect(() => {
    setDummyEditMode((showDummies as boolean) && (editDummies as boolean));
    return () => setDummyEditMode(false);
  }, [showDummies, editDummies, setDummyEditMode]);

  // Dynamic mesh visibility controls - create toggle for each mesh
  const meshVisibilityConfig = useMemo(() => {
    if (meshIndices.length <= 1) return {};

    const config: Record<string, any> = {};
    meshIndices.forEach((idx) => {
      config[`mesh${idx}`] = {
        value: true,
        label: `Mesh ${idx}`,
        onChange: (visible: boolean) => {
          setVisibleMeshIndices(prev => {
            const next = new Set(prev);
            if (visible) {
              next.add(idx);
            } else {
              next.delete(idx);
            }
            return next;
          });
        }
      };
    });
    return config;
  }, [meshIndices]);

  // Only show mesh parts folder if there are multiple meshes
  useControls('Mesh Parts', meshVisibilityConfig, { collapsed: true }, [meshVisibilityConfig]);

  // --- Play selected clip ---
  const playClip = useCallback((clip: THREE.AnimationClip | null) => {
    if (currentActionRef.current) {
      currentActionRef.current.stop();
    }
    if (!clip) return;

    const action = mixer.clipAction(clip, scene);
    action.reset();
    action.setEffectiveTimeScale(speed);
    action.play();
    currentActionRef.current = action;
  }, [mixer, scene, speed]);

  // Update speed on current action
  useEffect(() => {
    if (currentActionRef.current) {
      currentActionRef.current.setEffectiveTimeScale(playing ? speed : 0);
    }
  }, [speed, playing]);

  // --- Split animation: switch clips ---
  useEffect(() => {
    if (!hasSplitAnimations || !selectedClip) return;

    // Reset frame tracking
    setCurrentKeyframe(0);
    timeAccumulator.current = 0;

    if (playing) {
      playClip(selectedClip);
    } else {
      // Show first frame
      const action = mixer.clipAction(selectedClip, scene);
      action.reset().play();
      action.paused = true;
      action.time = 0;
      currentActionRef.current = action;
    }

    return () => {
      if (currentActionRef.current) {
        currentActionRef.current.stop();
        currentActionRef.current = null;
      }
    };
  }, [selectedClip, hasSplitAnimations]);

  // --- Split animation: toggle play/pause ---
  useEffect(() => {
    if (!hasSplitAnimations || !currentActionRef.current) return;

    if (playing) {
      currentActionRef.current.paused = false;
      currentActionRef.current.setEffectiveTimeScale(speed);
    } else {
      currentActionRef.current.paused = true;
    }
  }, [playing, hasSplitAnimations, speed]);

  // --- Legacy single animation effect ---
  useEffect(() => {
    if (hasSplitAnimations) return;

    const primaryClip = animations[0] ?? null;
    if (!primaryClip) return;

    const action = mixer.clipAction(primaryClip, scene);
    action.reset().play();

    return () => {
      action.stop();
      clearSceneHelpers(scene);
      try { mixer.stopAllAction(); } catch { /* ignore */ }
      try { mixer.uncacheClip(primaryClip); } catch { /* ignore */ }
      try { mixer.uncacheRoot(scene); } catch { /* ignore */ }
      timeAccumulator.current = 0;
      setPlaying(false);
      setCurrentKeyframe(0);
      setAnimationControls({ play: false, keyframe: 0 });
    }
  }, [mixer, animations, scene, setAnimationControls, hasSplitAnimations]);

  // --- Frame stepping (legacy single animation) ---
  useFrame((_state, delta) => {
    if (hasSplitAnimations) return; // split animations use mixer's own clock

    if (playing) {
      timeAccumulator.current += delta;
      const keyframeDuration = 1/fps;

      if (timeAccumulator.current >= keyframeDuration) {
        const framesToAdvance = Math.floor(timeAccumulator.current / keyframeDuration);
        timeAccumulator.current = timeAccumulator.current % keyframeDuration;

        setCurrentKeyframe(prev => {
          let next = prev + framesToAdvance;
          if (next >= totalKeyframes) {
            next = next % totalKeyframes;
          }
          setAnimationControls({ keyframe: next });
          const newTime = toClipTime(next, totalKeyframes, animationDuration);
          mixer.setTime(newTime);
          return next;
        })
      }
    } else {
      const newTime = toClipTime(currentKeyframe, totalKeyframes, animationDuration);
      mixer.setTime(newTime);
    }
  });

  return <>
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={scene} />
      <BoundingSphereIndicators
        spheres={boundingSpheres}
        visible={showBoundingSpheres}
        scene={scene}
        visibleMeshIndices={visibleMeshIndices}
      />
      <MeshHighlights
        scene={scene}
        visible={showMeshHighlights}
        visibleMeshIndices={visibleMeshIndices}
      />
    </group>
    <SkeletonDebugHelpers
      scene={scene}
      showBones={showBones}
      showDummies={showDummies}
    />

    {/* Split animation action picker overlay */}
    {hasSplitAnimations && (
      <ActionPickerHtml
        animations={animations}
        selectedIndex={selectedClipIndex}
        onSelect={setSelectedClipIndex}
        playing={playing}
        onTogglePlay={() => setPlaying(p => !p)}
        speed={speed}
        onSpeedChange={setSpeed}
      />
    )}
  </>;
}

/** Action picker panel rendered as an HTML overlay inside the Canvas */
function ActionPickerHtml({
  animations,
  selectedIndex,
  onSelect,
  playing,
  onTogglePlay,
  speed,
  onSpeedChange,
}: {
  animations: THREE.AnimationClip[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeedChange: (s: number) => void;
}) {


  // Group animations by weapon mode (suffix after last underscore for known weapon modes)
  const weaponModes = useMemo(() => {
    const modes = new Set<string>();
    const KNOWN_MODES = ['unarmed', 'sword', '2h', 'dual', 'gun', 'bow', 'dagger'];
    for (const anim of animations) {
      const parts = anim.name.split('_');
      const last = parts[parts.length - 1];
      if (KNOWN_MODES.includes(last)) {
        modes.add(last);
      }
    }
    return Array.from(modes).sort();
  }, [animations]);

  const [weaponFilter, setWeaponFilter] = useState<string | null>(null);

  const filteredAnimations = useMemo(() => {
    if (!weaponFilter) return animations.map((a, i) => ({ anim: a, origIndex: i }));
    return animations
      .map((a, i) => ({ anim: a, origIndex: i }))
      .filter(({ anim }) => anim.name.endsWith(`_${weaponFilter}`));
  }, [animations, weaponFilter]);

  return createPortal(
      <div
        style={{
          position: 'fixed',
          top: 8,
          left: 8,
          width: 260,
          background: '#1a1a2e',
          borderRadius: 8,
          padding: 8,
          color: '#e0e0e0',
          fontSize: 12,
          fontFamily: 'monospace',
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          zIndex: 1000,
          pointerEvents: 'auto',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>
          Actions ({animations.length})
        </div>

        {/* Weapon filter */}
        {weaponModes.length > 1 && (
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 4 }}>
            <button
              onClick={() => setWeaponFilter(null)}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                fontSize: 10,
                background: weaponFilter === null ? '#4a90d9' : '#333',
                color: '#fff',
              }}
            >
              All
            </button>
            {weaponModes.map(m => (
              <button
                key={m}
                onClick={() => setWeaponFilter(m)}
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 10,
                  background: weaponFilter === m ? '#4a90d9' : '#333',
                  color: '#fff',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Play controls */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
          <button
            onClick={onTogglePlay}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: playing ? '#d94a4a' : '#4ad97a',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 11,
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                fontSize: 10,
                background: speed === s ? '#4a90d9' : '#333',
                color: '#fff',
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Action list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filteredAnimations.map(({ anim, origIndex }) => (
            <div
              key={origIndex}
              onClick={() => onSelect(origIndex)}
              style={{
                padding: '4px 6px',
                borderRadius: 4,
                cursor: 'pointer',
                background: origIndex === selectedIndex ? '#2a4a6e' : 'transparent',
                marginBottom: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={`${anim.name} (${(anim.duration * 30).toFixed(0)} frames)`}
            >
              {anim.name}
            </div>
          ))}
        </div>
      </div>,
    document.body
  );
}

function Character() {
  const characterGltfJson = useAtomValue(characterGltfJsonAtom);
  const gltfDataURI = useGltfResource(characterGltfJson);

  useEffect(() => {
    return () => {
      if (gltfDataURI) {
        useGLTF.clear(gltfDataURI);
      }
    };
  }, [gltfDataURI]);

  if (!gltfDataURI) {
    return null;
  }

  return <>
    <CharacterModel key={gltfDataURI} gltfDataURI={gltfDataURI} />
  </>;
}

export default function CharacterWorkbench() {
  const characterMetadata = useAtomValue(characterMetadataAtom);

  return <div className="h-full w-full relative">
    <Leva collapsed={false} />
    <CharacterMetadataPanel metadata={characterMetadata} />
    <ContextualActionMenu
      actionIds={CHARACTER_CONTEXT_ACTIONS}
      requireShiftKey
      className="h-full w-full"
    >
      <CanvasErrorBoundary className="absolute inset-0 flex items-center justify-center">
        <Canvas
          style={{ height: '100%', width: '100%' }}
          shadows
          camera={{ position: [10, 12, 12], fov: 25 }}
          dpr={[1, 1.5]}
          gl={{ powerPreference: "high-performance" }}
        >
          <ambientLight intensity={1} />
          <directionalLight position={[5, 5, 5]} castShadow />
          <Environment background>
            <mesh scale={100}>
              <sphereGeometry args={[1, 16, 16]} />
              <meshBasicMaterial color="#393939" side={THREE.BackSide} />
            </mesh>
          </Environment>
          <Suspense fallback={<>Loading...</>}>
            <Character />
          </Suspense>
          <OrbitControls />
          <gridHelper args={[60, 60, 60]} position-y=".01" />
          <PerfFrameProbe surface="characters" />
          <CameraControls />
        </Canvas>
      </CanvasErrorBoundary>
      <PerfOverlay surface="characters" className="bottom-8 right-3" />
    </ContextualActionMenu>
  </div>;
}
