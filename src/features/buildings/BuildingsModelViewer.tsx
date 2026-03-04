import { useEffect, useMemo, useRef, useState } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three";
import { useGltfResource } from "@/hooks/use-gltf-resource";
import {
  extractMeshes,
  MeshHighlights,
  getUniqueMeshIndices,
} from "@/features/character/MeshHighlights";

type TexUvAnimEntry = {
  subset: number;
  stage: number;
  frameCount: number;
  matrices: number[][];
};

type TexUvBinding = {
  frameCount: number;
  matrices: number[][];
  texture: THREE.Texture;
  originalMatrix: THREE.Matrix3;
  originalMatrixAutoUpdate: boolean;
};

type TransformAnimData = {
  frameCount: number;
  positions: [number, number, number][];
  rotations: [number, number, number, number][];
};

type TransformAnimBinding = {
  object: THREE.Object3D;
  frameCount: number;
  positions: [number, number, number][];
  rotations: [number, number, number, number][];
  originalPosition: THREE.Vector3;
  originalQuaternion: THREE.Quaternion;
};

type PkoMaterialTag = {
  transpType: number;
  alphaRef: number;
  opacity: number;
};

type MaterialRuntimeState = {
  material: THREE.Material;
  transparent: boolean;
  opacity: number;
  alphaTest: number;
  depthWrite: boolean;
  blending: THREE.Blending;
  blendSrc: THREE.BlendingSrcFactor;
  blendDst: THREE.BlendingDstFactor;
  blendEquation: THREE.BlendingEquation;
};

function parsePkoMaterialTag(name: string | undefined): PkoMaterialTag | null {
  if (!name) return null;
  const match = name.match(/__PKO_T(\d+)_A(\d+)_O(\d+)$/);
  if (!match) return null;

  const transpTypeRaw = Number.parseInt(match[1], 10);
  const alphaRefRaw = Number.parseInt(match[2], 10);
  const opacityRaw = Number.parseInt(match[3], 10);
  if (
    Number.isNaN(transpTypeRaw) ||
    Number.isNaN(alphaRefRaw) ||
    Number.isNaN(opacityRaw)
  ) {
    return null;
  }

  const transpType =
    transpTypeRaw >= 0 && transpTypeRaw <= 5
      ? transpTypeRaw
      : transpTypeRaw >= 6 && transpTypeRaw <= 8
        ? 1
        : 1;

  return {
    transpType,
    alphaRef: Math.max(0, Math.min(alphaRefRaw, 255)),
    opacity: Math.max(0, Math.min(opacityRaw, 255)) / 255,
  };
}

function getBlendingForTranspType(
  transpType: number
): {
  blending: THREE.Blending;
  blendSrc?: THREE.BlendingSrcFactor;
  blendDst?: THREE.BlendingDstFactor;
} {
  switch (transpType) {
    case 0:
      return { blending: THREE.NormalBlending };
    case 1:
      return { blending: THREE.AdditiveBlending };
    case 2:
      return {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcColorFactor,
        blendDst: THREE.OneFactor,
      };
    case 3:
      return {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcColorFactor,
        blendDst: THREE.OneMinusSrcColorFactor,
      };
    case 4:
      return {
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.DstAlphaFactor,
      };
    case 5:
      return { blending: THREE.SubtractiveBlending };
    default:
      return { blending: THREE.AdditiveBlending };
  }
}

function applyPkoMaterialTag(material: THREE.Material, tag: PkoMaterialTag) {
  const nextTransparent = tag.transpType !== 0 || tag.opacity < 0.99 || tag.alphaRef > 0;
  material.transparent = nextTransparent;
  material.opacity = tag.opacity;
  material.alphaTest = tag.alphaRef > 0 ? tag.alphaRef / 255 : 0;

  if (tag.transpType !== 0) {
    const cfg = getBlendingForTranspType(tag.transpType);
    material.blending = cfg.blending;
    if (cfg.blendSrc !== undefined) material.blendSrc = cfg.blendSrc;
    if (cfg.blendDst !== undefined) material.blendDst = cfg.blendDst;
    material.depthWrite = false;
  } else {
    material.blending = THREE.NormalBlending;
    material.blendSrc = THREE.SrcAlphaFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.depthWrite = !(tag.opacity < 0.99);
  }

  material.needsUpdate = true;
}

function collectPkoMaterialBindings(scene: THREE.Group): MaterialRuntimeState[] {
  const bindings: MaterialRuntimeState[] = [];

  scene.traverse((object) => {
    if (!isMeshObject(object)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material) continue;
      const tag = parsePkoMaterialTag(material.name);
      if (!tag) continue;

      bindings.push({
        material,
        transparent: material.transparent,
        opacity: material.opacity,
        alphaTest: material.alphaTest,
        depthWrite: material.depthWrite,
        blending: material.blending,
        blendSrc: material.blendSrc,
        blendDst: material.blendDst,
        blendEquation: material.blendEquation,
      });

      applyPkoMaterialTag(material, tag);
    }
  });

  return bindings;
}

function isMeshObject(object: THREE.Object3D): object is THREE.Mesh | THREE.SkinnedMesh {
  return object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh;
}

function parseTexUvEntries(userData: Record<string, unknown>): TexUvAnimEntry[] {
  const rawEntries = userData.texuv_anims;
  if (!Array.isArray(rawEntries)) return [];

  const entries: TexUvAnimEntry[] = [];
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;

    const subset = typeof rec.subset === "number" ? Math.max(0, Math.floor(rec.subset)) : 0;
    const stage = typeof rec.stage === "number" ? Math.max(0, Math.floor(rec.stage)) : 0;

    if (!Array.isArray(rec.matrices)) continue;
    const matrices: number[][] = [];
    for (const frame of rec.matrices) {
      if (!Array.isArray(frame) || frame.length < 16) continue;
      const flat = frame.slice(0, 16).map((v) => (typeof v === "number" ? v : Number.NaN));
      if (flat.some((v) => !Number.isFinite(v))) continue;
      matrices.push(flat);
    }

    const declaredFrameCount =
      typeof rec.frame_num === "number" ? Math.max(0, Math.floor(rec.frame_num)) : 0;
    const frameCount = Math.min(
      declaredFrameCount > 0 ? declaredFrameCount : matrices.length,
      matrices.length
    );
    if (frameCount <= 0) continue;

    entries.push({
      subset,
      stage,
      frameCount,
      matrices,
    });
  }

  return entries;
}

function getTextureForStage(material: THREE.Material, stage: number): THREE.Texture | null {
  // Current building export path only resolves stage-0 diffuse texture.
  if (stage !== 0) return null;

  if ("map" in material) {
    const texture = (material as THREE.Material & { map?: THREE.Texture | null }).map;
    return texture ?? null;
  }

  return null;
}

function getMaterialForSubset(
  mesh: THREE.Mesh | THREE.SkinnedMesh,
  subset: number
): THREE.Material | null {
  if (Array.isArray(mesh.material)) {
    return mesh.material[subset] ?? mesh.material[0] ?? null;
  }
  return mesh.material ?? null;
}

function applyTexUvMatrix(texture: THREE.Texture, matrix: number[]) {
  // Matrix is exported row-major 4x4 from LMO texuv data.
  // We apply the affine UV portion to Three's 3x3 texture transform matrix:
  // [m00 m01 tx]
  // [m10 m11 ty]
  // [ 0   0  1]
  const m00 = matrix[0] ?? 1;
  const m01 = matrix[1] ?? 0;
  const m10 = matrix[4] ?? 0;
  const m11 = matrix[5] ?? 1;
  // PKO LMO texuv transforms store translation in row 3 (indices 8/9)
  // for the assets we currently export. Keep a fallback to row 4 (12/13)
  // for compatibility with potential variant data.
  const txRaw = matrix[8] ?? 0;
  const tyRaw = matrix[9] ?? 0;
  const txFallback = matrix[12] ?? 0;
  const tyFallback = matrix[13] ?? 0;
  const tx = Math.abs(txRaw) > 1e-6 ? txRaw : txFallback;
  const ty = Math.abs(tyRaw) > 1e-6 ? tyRaw : tyFallback;

  texture.matrixAutoUpdate = false;
  texture.matrix.set(m00, m01, tx, m10, m11, ty, 0, 0, 1);
}

function collectTexUvBindings(scene: THREE.Group): TexUvBinding[] {
  const bindings: TexUvBinding[] = [];

  scene.traverse((object) => {
    const userData = object.userData as Record<string, unknown> | undefined;
    if (!userData) return;

    const entries = parseTexUvEntries(userData);
    if (entries.length === 0) return;

    const targetMeshes: Array<THREE.Mesh | THREE.SkinnedMesh> = isMeshObject(object)
      ? [object]
      : object.children.filter(isMeshObject);
    if (targetMeshes.length === 0) return;

    for (const entry of entries) {
      // Stage > 0 textures are currently not exported in the building glTF path.
      if (entry.stage !== 0) continue;

      const targetMesh = targetMeshes[entry.subset] ?? targetMeshes[0];
      const material = getMaterialForSubset(targetMesh, entry.subset);
      if (!material) continue;

      const texture = getTextureForStage(material, entry.stage);
      if (!texture) continue;

      bindings.push({
        frameCount: entry.frameCount,
        matrices: entry.matrices,
        texture,
        originalMatrix: texture.matrix.clone(),
        originalMatrixAutoUpdate: texture.matrixAutoUpdate,
      });
    }
  });

  return bindings;
}

function applyTexUvFrame(binding: TexUvBinding, frameIndex: number) {
  if (binding.frameCount <= 0 || binding.matrices.length === 0) return;
  const frame = ((frameIndex % binding.frameCount) + binding.frameCount) % binding.frameCount;
  const matrix = binding.matrices[frame];
  if (!matrix || matrix.length < 16) return;
  applyTexUvMatrix(binding.texture, matrix);
}

function parseTransformAnimData(userData: Record<string, unknown>): TransformAnimData | null {
  const rawAnim = userData.transform_anim;
  if (!rawAnim || typeof rawAnim !== "object") return null;

  const rec = rawAnim as Record<string, unknown>;
  const rawFrameCount =
    typeof rec.frame_num === "number" ? Math.max(0, Math.floor(rec.frame_num)) : 0;
  if (rawFrameCount <= 0) return null;

  const rawTranslations = rec.translations;
  const rawRotations = rec.rotations;
  if (!Array.isArray(rawTranslations) || !Array.isArray(rawRotations)) return null;

  const frameCount = Math.min(rawFrameCount, rawTranslations.length, rawRotations.length);
  if (frameCount <= 0) return null;

  const positions: [number, number, number][] = [];
  const rotations: [number, number, number, number][] = [];

  for (let i = 0; i < frameCount; i++) {
    const pos = rawTranslations[i];
    const rot = rawRotations[i];
    if (
      !Array.isArray(pos) ||
      pos.length < 3 ||
      !Array.isArray(rot) ||
      rot.length < 4
    ) {
      return null;
    }

    const px = Number(pos[0]);
    const py = Number(pos[1]);
    const pz = Number(pos[2]);
    const rx = Number(rot[0]);
    const ry = Number(rot[1]);
    const rz = Number(rot[2]);
    const rw = Number(rot[3]);

    if (
      !Number.isFinite(px) ||
      !Number.isFinite(py) ||
      !Number.isFinite(pz) ||
      !Number.isFinite(rx) ||
      !Number.isFinite(ry) ||
      !Number.isFinite(rz) ||
      !Number.isFinite(rw)
    ) {
      return null;
    }

    positions.push([px, py, pz]);
    rotations.push([rx, ry, rz, rw]);
  }

  return {
    frameCount,
    positions,
    rotations,
  };
}

function collectTransformAnimBindings(scene: THREE.Group): TransformAnimBinding[] {
  const bindings: TransformAnimBinding[] = [];

  scene.traverse((object) => {
    const userData = object.userData as Record<string, unknown> | undefined;
    if (!userData) return;

    const anim = parseTransformAnimData(userData);
    if (!anim) return;

    bindings.push({
      object,
      frameCount: anim.frameCount,
      positions: anim.positions,
      rotations: anim.rotations,
      originalPosition: object.position.clone(),
      originalQuaternion: object.quaternion.clone(),
    });
  });

  return bindings;
}

function applyTransformAnimFrame(binding: TransformAnimBinding, frameIndex: number) {
  if (binding.frameCount <= 0) return;
  const frame = ((frameIndex % binding.frameCount) + binding.frameCount) % binding.frameCount;
  const pos = binding.positions[frame];
  const rot = binding.rotations[frame];
  if (!pos || !rot) return;

  binding.object.position.set(pos[0], pos[1], pos[2]);
  binding.object.quaternion.set(rot[0], rot[1], rot[2], rot[3]).normalize();
}

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
  const hasClipAnimation = animations.length > 0;
  const clipDuration = primaryClip?.duration ?? 0;
  const fps = 30;
  const clipKeyframes = hasClipAnimation
    ? Math.max(Math.floor(clipDuration * fps), 1)
    : 0;

  const [playing, setPlaying] = useState(playAnimation);
  const [currentKeyframe, setCurrentKeyframe] = useState(0);
  const [maxTransformFrameCount, setMaxTransformFrameCount] = useState(0);
  const timeAccumulator = useRef(0);
  const uvTimeAccumulator = useRef(0);
  const uvBindingsRef = useRef<TexUvBinding[]>([]);
  const transformBindingsRef = useRef<TransformAnimBinding[]>([]);
  const materialBindingsRef = useRef<MaterialRuntimeState[]>([]);
  const hasPerNodeTransformAnimations = maxTransformFrameCount > 0;
  const hasAnyAnimation = hasClipAnimation || hasPerNodeTransformAnimations;
  const totalKeyframes = Math.max(clipKeyframes, maxTransformFrameCount, 1);

  // Sync playAnimation prop → local playing state.
  // This must remain independent of transform clips because UV-only buildings
  // also need runtime playback.
  useEffect(() => {
    setPlaying(playAnimation);
  }, [playAnimation]);

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
        max: Math.max(totalKeyframes - 1, 0),
        step: 1,
        label: "Keyframe",
        onChange: (v: number) => {
          setCurrentKeyframe(v);
          if (hasClipAnimation && !hasPerNodeTransformAnimations) {
            const newTime = toClipTime(v, Math.max(clipKeyframes, 1), Math.max(clipDuration, 1 / fps));
            mixer.setTime(newTime);
          }

          for (const binding of transformBindingsRef.current) {
            applyTransformAnimFrame(binding, v);
          }

          timeAccumulator.current = 0;
        },
        render: () => hasAnyAnimation,
      },
    }),
    { collapsed: !hasAnyAnimation },
    [
      hasAnyAnimation,
      totalKeyframes,
      hasClipAnimation,
      hasPerNodeTransformAnimations,
      clipKeyframes,
      clipDuration,
      fps,
    ]
  );

  useEffect(() => {
    if (currentKeyframe < totalKeyframes) return;
    setCurrentKeyframe(0);
    setAnimationControls({ keyframe: 0 });
    timeAccumulator.current = 0;
    uvTimeAccumulator.current = 0;
  }, [currentKeyframe, totalKeyframes, setAnimationControls]);

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

  useEffect(() => {
    const bindings = collectTransformAnimBindings(scene);
    transformBindingsRef.current = bindings;
    setMaxTransformFrameCount(
      bindings.reduce((maxFrames, binding) => Math.max(maxFrames, binding.frameCount), 0)
    );

    for (const binding of bindings) {
      applyTransformAnimFrame(binding, 0);
    }

    return () => {
      for (const binding of bindings) {
        binding.object.position.copy(binding.originalPosition);
        binding.object.quaternion.copy(binding.originalQuaternion);
      }
      transformBindingsRef.current = [];
    };
  }, [scene]);

  useEffect(() => {
    const bindings = collectTexUvBindings(scene);
    uvBindingsRef.current = bindings;
    uvTimeAccumulator.current = 0;

    for (const binding of bindings) {
      applyTexUvFrame(binding, 0);
    }

    return () => {
      for (const binding of bindings) {
        binding.texture.matrix.copy(binding.originalMatrix);
        binding.texture.matrixAutoUpdate = binding.originalMatrixAutoUpdate;
      }
      uvBindingsRef.current = [];
      uvTimeAccumulator.current = 0;
    };
  }, [scene]);

  useEffect(() => {
    const bindings = collectPkoMaterialBindings(scene);
    materialBindingsRef.current = bindings;

    return () => {
      for (const binding of bindings) {
        binding.material.transparent = binding.transparent;
        binding.material.opacity = binding.opacity;
        binding.material.alphaTest = binding.alphaTest;
        binding.material.depthWrite = binding.depthWrite;
        binding.material.blending = binding.blending;
        binding.material.blendSrc = binding.blendSrc;
        binding.material.blendDst = binding.blendDst;
        binding.material.blendEquation = binding.blendEquation;
        binding.material.needsUpdate = true;
      }
      materialBindingsRef.current = [];
    };
  }, [scene]);

  // Animation playback frame loop
  useFrame((_state, delta) => {
    let frameForThisTick = currentKeyframe;

    if (hasAnyAnimation && playing) {
      timeAccumulator.current += delta;
      const keyframeDuration = 1 / fps;

      if (timeAccumulator.current >= keyframeDuration) {
        const framesToAdvance = Math.floor(
          timeAccumulator.current / keyframeDuration
        );
        timeAccumulator.current =
          timeAccumulator.current % keyframeDuration;

        if (framesToAdvance > 0) {
          frameForThisTick = (currentKeyframe + framesToAdvance) % totalKeyframes;
          setCurrentKeyframe(frameForThisTick);
          setAnimationControls({ keyframe: frameForThisTick });
        }
      }
    }

    if (hasClipAnimation && !hasPerNodeTransformAnimations) {
      const newTime = toClipTime(
        frameForThisTick,
        Math.max(clipKeyframes, 1),
        Math.max(clipDuration, 1 / fps)
      );
      mixer.setTime(newTime);
    }

    const transformBindings = transformBindingsRef.current;
    if (transformBindings.length > 0) {
      for (const binding of transformBindings) {
        applyTransformAnimFrame(binding, frameForThisTick);
      }
    }

    const uvBindings = uvBindingsRef.current;
    if (uvBindings.length === 0) return;

    if (playing) {
      uvTimeAccumulator.current += delta;
      for (const binding of uvBindings) {
        const duration = binding.frameCount / fps;
        if (duration <= 0) continue;
        const localTime = uvTimeAccumulator.current % duration;
        const frame = Math.floor(localTime * fps) % binding.frameCount;
        applyTexUvFrame(binding, frame);
      }
    } else {
      for (const binding of uvBindings) {
        applyTexUvFrame(binding, currentKeyframe);
      }
    }
  });

  // Start animation clip
  useEffect(() => {
    if (!primaryClip || hasPerNodeTransformAnimations) return;

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
      uvTimeAccumulator.current = 0;
      setCurrentKeyframe(0);
      setAnimationControls({ keyframe: 0 });
    };
  }, [mixer, primaryClip, scene, setAnimationControls, hasPerNodeTransformAnimations]);

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
