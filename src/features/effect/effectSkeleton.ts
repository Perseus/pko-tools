import * as THREE from "three";
import { interpolateFrame } from "@/features/effect/animation";
import { resolveGeometry } from "@/features/effect/rendering";
import type { EffectFile, SubEffect, Vec3 } from "@/types/effect";

export type EffectSkeletonNodeKind = "effect" | "subEffect";

type SkeletonNodeBase = {
  id: string;
  label: string;
  kind: EffectSkeletonNodeKind;
  depth: number;
  parentId: string | null;
  childrenIds: string[];
  renderable: boolean;
  parentRenderableId: string | null;
  localPosition: Vec3;
  localRotation: Vec3;
  localScale: Vec3;
  worldPosition: Vec3;
  worldRotation: Vec3;
  worldScale: Vec3;
  localQuaternion: [number, number, number, number];
  worldQuaternion: [number, number, number, number];
};

export type EffectSkeletonEffectNode = SkeletonNodeBase & {
  kind: "effect";
  effectName: string;
  techniqueIndex: number;
  rotating: boolean;
  subEffectCount: number;
};

export type EffectSkeletonSubEffectNode = SkeletonNodeBase & {
  kind: "subEffect";
  effectName: string;
  effectType: number;
  subEffectIndex: number;
  geometryLabel: string;
  textureName: string;
  modelName: string;
  duration: number;
  flags: string[];
};

export type EffectSkeletonNode =
  | EffectSkeletonEffectNode
  | EffectSkeletonSubEffectNode;

export type EffectSkeletonGraph = {
  rootId: string;
  nodes: Record<string, EffectSkeletonNode>;
  renderableNodeIds: string[];
};

export type BuildEffectSkeletonOptions = {
  effectFile: EffectFile;
  effectName: string;
  currentTime: number;
  isLooping: boolean;
};

const _vec = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _matrix = new THREE.Matrix4();
const _subEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _subQuat = new THREE.Quaternion();
const _subLoopQuat = new THREE.Quaternion();
const _subAxis = new THREE.Vector3();
const _effectAxis = new THREE.Vector3();
const IDENTITY_SCALE: Vec3 = [1, 1, 1];
const ZERO_VEC3: Vec3 = [0, 0, 0];

export function normalizeEffectReference(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !trimmed.toLowerCase().endsWith(".eff")) {
    return null;
  }
  return trimmed.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
}

export function buildEffectSkeletonGraph(
  options: BuildEffectSkeletonOptions,
): EffectSkeletonGraph {
  const {
    effectFile,
    effectName,
    currentTime,
    isLooping,
  } = options;

  const nodes: Record<string, EffectSkeletonNode> = {};
  const renderableNodeIds: string[] = [];

  const buildEffectNode = ({
    file,
    name,
    parentId,
    parentWorldMatrix,
    parentRenderableId,
    depth,
    id,
    renderable,
  }: {
    file: EffectFile;
    name: string;
    parentId: string | null;
    parentWorldMatrix: THREE.Matrix4;
    parentRenderableId: string | null;
    depth: number;
    id: string;
    renderable: boolean;
  }) => {
    const effectRotationQuat = computeEffectRotation(file, currentTime);
    const effectWorldMatrix = _matrix.clone().multiplyMatrices(
      parentWorldMatrix,
      composeMatrix(ZERO_VEC3, effectRotationQuat, IDENTITY_SCALE),
    );
    const effectWorldState = decomposeMatrix(effectWorldMatrix);
    const effectLocalEuler = eulerFromQuaternion(effectRotationQuat);

    const effectNode: EffectSkeletonEffectNode = {
      id,
      label: name,
      kind: "effect",
      depth,
      parentId,
      childrenIds: [],
      renderable,
      parentRenderableId,
      localPosition: ZERO_VEC3,
      localRotation: effectLocalEuler,
      localScale: IDENTITY_SCALE,
      worldPosition: effectWorldState.position,
      worldRotation: effectWorldState.rotation,
      worldScale: effectWorldState.scale,
      localQuaternion: quaternionToArray(effectRotationQuat),
      worldQuaternion: effectWorldState.quaternion,
      effectName: name,
      techniqueIndex: file.idxTech,
      rotating: file.rotating,
      subEffectCount: file.subEffects.length,
    };

    nodes[id] = effectNode;
    if (renderable) {
      renderableNodeIds.push(id);
    }

    const nextRenderableParent = renderable ? id : parentRenderableId;

    file.subEffects.forEach((subEffect, index) => {
      const subId = `${id}/sub:${index}`;
      const subState = resolveSubEffectState(subEffect, currentTime, isLooping);
      const geometry = resolveGeometry(subEffect, subState.frameIndex);
      const subWorldMatrix = _matrix.clone().multiplyMatrices(
        effectWorldMatrix,
        composeMatrix(subState.position, subState.quaternion, subState.scale),
      );
      const subWorldState = decomposeMatrix(subWorldMatrix);

      const subNode: EffectSkeletonSubEffectNode = {
        id: subId,
        label: subEffect.effectName || `Sub-effect ${index + 1}`,
        kind: "subEffect",
        depth: depth + 1,
        parentId: id,
        childrenIds: [],
        renderable: true,
        parentRenderableId: nextRenderableParent,
        localPosition: subState.position,
        localRotation: subState.rotation,
        localScale: subState.scale,
        worldPosition: subWorldState.position,
        worldRotation: subWorldState.rotation,
        worldScale: subWorldState.scale,
        localQuaternion: quaternionToArray(subState.quaternion),
        worldQuaternion: subWorldState.quaternion,
        effectName: subEffect.effectName,
        effectType: subEffect.effectType,
        subEffectIndex: index,
        geometryLabel: formatGeometryLabel(geometry, subState.scale),
        textureName: subEffect.texName,
        modelName: subEffect.modelName,
        duration: subEffect.length,
        flags: getSubEffectFlags(subEffect),
      };

      nodes[subId] = subNode;
      nodes[id].childrenIds.push(subId);
      renderableNodeIds.push(subId);
    });
  };

  const rootId = "effect:root";
  buildEffectNode({
    file: effectFile,
    name: effectName,
    parentId: null,
    parentWorldMatrix: new THREE.Matrix4().identity(),
    parentRenderableId: null,
    depth: 0,
    id: rootId,
    renderable: true,
  });

  return { rootId, nodes, renderableNodeIds };
}

function resolveSubEffectState(
  subEffect: SubEffect,
  currentTime: number,
  isLooping: boolean,
): {
  frameIndex: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  quaternion: THREE.Quaternion;
} {
  const interpolated = interpolateFrame(subEffect, currentTime, isLooping);
  const position = interpolated.position;
  const rotation = interpolated.angle;
  const scale = interpolated.size;

  _subEuler.set(rotation[0], rotation[1], rotation[2], "YXZ");
  _subQuat.setFromEuler(_subEuler);

  if (subEffect.rotaLoop) {
    const [ax, ay, az, speed] = subEffect.rotaLoopVec;
    _subAxis.set(ax, ay, az);
    if (_subAxis.lengthSq() > 0.0001) {
      _subAxis.normalize();
      _subLoopQuat.setFromAxisAngle(_subAxis, currentTime * speed);
      _subQuat.premultiply(_subLoopQuat);
    }
  }

  return {
    frameIndex: interpolated.frameIndex,
    position,
    rotation: eulerFromQuaternion(_subQuat),
    scale,
    quaternion: _subQuat.clone(),
  };
}

function computeEffectRotation(
  effectFile: EffectFile,
  currentTime: number,
): THREE.Quaternion {
  const quat = new THREE.Quaternion();
  if (!effectFile.rotating) {
    return quat;
  }

  const [x, y, z] = effectFile.rotaVec;
  _effectAxis.set(x, y, z);
  if (_effectAxis.lengthSq() <= 0.0001) {
    return quat;
  }

  _effectAxis.normalize();
  quat.setFromAxisAngle(_effectAxis, currentTime * effectFile.rotaVel);
  return quat;
}

function composeMatrix(
  position: Vec3,
  quaternion: THREE.Quaternion,
  scale: Vec3,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    quaternion,
    new THREE.Vector3(scale[0], scale[1], scale[2]),
  );
}

function decomposeMatrix(matrix: THREE.Matrix4): {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  quaternion: [number, number, number, number];
} {
  matrix.decompose(_vec, _quat, _scale);
  return {
    position: [_vec.x, _vec.y, _vec.z],
    rotation: eulerFromQuaternion(_quat),
    scale: [_scale.x, _scale.y, _scale.z],
    quaternion: quaternionToArray(_quat),
  };
}

function eulerFromQuaternion(quaternion: THREE.Quaternion): Vec3 {
  _euler.setFromQuaternion(quaternion, "YXZ");
  return [_euler.x, _euler.y, _euler.z];
}

function quaternionToArray(
  quaternion: THREE.Quaternion,
): [number, number, number, number] {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function getSubEffectFlags(subEffect: SubEffect): string[] {
  const flags: string[] = [];
  if (subEffect.billboard) {
    flags.push("billboard");
  }
  if (subEffect.rotaBoard) {
    flags.push("rotaBoard");
  }
  if (subEffect.rotaLoop) {
    flags.push("rotaLoop");
  }
  if (subEffect.alpha) {
    flags.push("alpha");
  }
  return flags;
}

function formatGeometryLabel(
  geometry: ReturnType<typeof resolveGeometry>,
  scale: Vec3,
): string {
  switch (geometry.type) {
    case "rect":
      return `Rect ${fmt(scale[0])} x ${fmt(scale[2])}`;
    case "rectPlane":
      return `RectPlane ${fmt(scale[0])} x ${fmt(scale[1])}`;
    case "rectZ":
      return `RectZ ${fmt(scale[1])} x ${fmt(scale[2])}`;
    case "triangle":
      return `Triangle ${fmt(scale[0])} x ${fmt(scale[2])}`;
    case "trianglePlane":
      return `TrianglePlane ${fmt(scale[0])} x ${fmt(scale[1])}`;
    case "triangleZ":
      return `TriangleZ ${fmt(scale[1])} x ${fmt(scale[2])}`;
    case "plane":
      return `Plane ${fmt(scale[0])} x ${fmt(scale[1])}`;
    case "sphere": {
      const radius = 0.7 * ((Math.abs(scale[0]) + Math.abs(scale[1]) + Math.abs(scale[2])) / 3);
      return `Sphere r=${fmt(radius)}`;
    }
    case "cylinder": {
      const radialScale = (Math.abs(scale[0]) + Math.abs(scale[1])) / 2;
      const topRadius = (geometry.topRadius ?? 0.5) * radialScale;
      const botRadius = (geometry.botRadius ?? 0.5) * radialScale;
      const height = (geometry.height ?? 1) * Math.abs(scale[2]);
      return `Cylinder h=${fmt(height)} r=${fmt(topRadius)}/${fmt(botRadius)}`;
    }
    case "model":
      return `${geometry.modelName} ${fmt(scale[0])},${fmt(scale[1])},${fmt(scale[2])}`;
    default:
      return geometry.type;
  }
}

function fmt(value: number): string {
  return Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
}
