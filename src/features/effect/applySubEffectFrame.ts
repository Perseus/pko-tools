/**
 * Shared per-frame rendering logic for PKO sub-effects.
 *
 * Extracted from EffectSubRenderer.tsx — applies position, scale, rotation,
 * billboard, color/opacity, UV animation, and deformable mesh interpolation
 * to a Three.js mesh each frame.
 *
 * Operates in LOCAL space only — has no knowledge of dummy matrices,
 * coordinate transforms, editor gizmos, or bone bindings. The caller
 * wraps the mesh in whatever anchor groups they need.
 */
import * as THREE from "three";
import type { SubEffect, Vec3, Vec4 } from "@/types/effect";
import { interpolateUVCoords, getTexListFrameIndex } from "@/features/effect/animation";
import { createCylinderGeometry } from "@/features/effect/rendering";
import { setPkoTextureFactorColor } from "@/features/effect/color";

// Reusable scratch objects — module-level to avoid per-frame GC
const _rotaAxis = new THREE.Vector3();
const _rotaQuat = new THREE.Quaternion();
const _baseEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _parentWorldQuat = new THREE.Quaternion();
const _parentInverseQuat = new THREE.Quaternion();
const _desiredWorldQuat = new THREE.Quaternion();

export interface SubEffectFrameOptions {
  sub: SubEffect;
  /** Current interpolated frame values */
  position: Vec3;
  scale: Vec3;
  angle: Vec3;
  color: Vec4;
  /** Elapsed playback time in seconds */
  playbackTime: number;
  /** Current keyframe index */
  frameIndex: number;
  /** Next keyframe index (for deformable mesh lerp) */
  nextFrameIndex: number;
  /** Interpolation factor between frameIndex and nextFrameIndex */
  lerp: number;
  /** Item viewer: multiply opacity by forge level alpha (0-1) */
  forgeAlpha?: number;
  /** Standalone viewer: floor opacity so transparent frames stay visible */
  editorMinOpacity?: number;
  /** Cache for deformable cylinder vertex positions */
  cylinderCache?: Map<string, Float32Array>;
  /** Whether the geometry is a cylinder (needed for deformable mesh check) */
  isCylinder?: boolean;
}

/**
 * Apply all per-frame rendering state to a mesh.
 * Called from within useFrame by both the standalone effect viewer and
 * the item effect viewer.
 */
export function applySubEffectFrame(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  opts: SubEffectFrameOptions,
): void {
  const { sub, position, scale, angle, color, playbackTime } = opts;

  // 1. Position
  mesh.position.set(position[0], position[1], position[2]);

  // 2. Scale
  mesh.scale.set(scale[0], scale[1], scale[2]);

  // 3. Rotation + RotaLoop
  // PKO billboard logic: billboard flag controls facing camera. effectType
  // controls texture/UV animation, not whether billboard is honored.
  const isBillboard = sub.billboard;
  const isRotaBoard = sub.rotaBoard;
  const rotationAngle: Vec3 = isBillboard && !isRotaBoard ? [0, 0, 0] : angle;

  if (!isBillboard || isRotaBoard) {
    // C++ always builds a fresh transform matrix from current state. Even a
    // zero-axis rotaLoop must not leave the previous Three quaternion behind.
    _baseEuler.set(rotationAngle[0], rotationAngle[1], rotationAngle[2], "YXZ");
    mesh.quaternion.setFromEuler(_baseEuler);
  }

  if (sub.rotaLoop && !(isBillboard && !isRotaBoard)) {
    // Apply rotaLoop unless billboard+!rotaBoard (PKO discards everything)
    const [ax, ay, az, speed] = sub.rotaLoopVec;
    _rotaAxis.set(ax, ay, az);
    if (_rotaAxis.lengthSq() > 0.0001) {
      _rotaAxis.normalize();
      const rotaAngle = playbackTime * speed;
      _rotaQuat.setFromAxisAngle(_rotaAxis, rotaAngle);
      mesh.quaternion.premultiply(_rotaQuat);
    }
  }

  // 4. Billboard
  if (isBillboard) {
    // C++ billboard matrix is inverse view with translation cleared. In Three,
    // write the local quaternion that yields the desired world orientation under
    // any parent particle/effect transform.
    const parent = mesh.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(_parentWorldQuat);
    } else {
      _parentWorldQuat.identity();
    }

    // CMPModelEff keeps the current sub-effect rotation only when rotaBoard is
    // set, then applies the inverse-view billboard matrix. A parent particle
    // billboard bind supplies position for billboard sub-effects, not another
    // camera-facing rotation, so compose the desired world orientation from the
    // camera basis plus this sub-effect's own local rotation only.
    _desiredWorldQuat.copy(camera.quaternion);
    if (isRotaBoard) {
      _desiredWorldQuat.multiply(mesh.quaternion);
    }

    _parentInverseQuat.copy(_parentWorldQuat).invert();
    mesh.quaternion.copy(_parentInverseQuat).multiply(_desiredWorldQuat);
  }

  // 5. Color / opacity
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (mat) {
    setPkoTextureFactorColor(mat.color, color[0], color[1], color[2]);
    let opacity = Math.min(Math.max(color[3], 0), 1);
    if (opts.forgeAlpha !== undefined) {
      opacity *= opts.forgeAlpha;
    }
    if (opts.editorMinOpacity !== undefined) {
      opacity = Math.max(opacity, opts.editorMinOpacity);
    }
    mat.opacity = opacity;
  }

  // 6. UV animation type 2 (EFFECT_MODELUV) — interpolated UV coords
  if (sub.effectType === 2 && sub.coordList.length > 0) {
    const uvResult = interpolateUVCoords(sub, playbackTime, true);
    if (uvResult && mesh.geometry) {
      const uvAttr = mesh.geometry.getAttribute("uv");
      if (uvAttr && uvAttr.count === uvResult.uvs.length) {
        for (let v = 0; v < uvResult.uvs.length; v++) {
          uvAttr.setXY(v, uvResult.uvs[v][0], uvResult.uvs[v][1]);
        }
        (uvAttr as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }

  // 7. UV animation type 3 (EFFECT_MODELTEXTURE) — snapped UV sets
  if (sub.effectType === 3 && sub.texList.length > 0) {
    const texIdx = getTexListFrameIndex(sub, playbackTime, true);
    if (texIdx !== null && sub.texList[texIdx] && mesh.geometry) {
      const uvAttr = mesh.geometry.getAttribute("uv");
      const texUVs = sub.texList[texIdx];
      if (uvAttr && uvAttr.count === texUVs.length) {
        for (let v = 0; v < texUVs.length; v++) {
          uvAttr.setXY(v, texUVs[v][0], texUVs[v][1]);
        }
        (uvAttr as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }

  // 8. Deformable cylinder — vertex position interpolation when useParam > 0
  if (
    sub.useParam > 0 &&
    sub.perFrameCylinder.length > 0 &&
    opts.isCylinder &&
    opts.cylinderCache &&
    mesh.geometry
  ) {
    const curParams = sub.perFrameCylinder[opts.frameIndex];
    const nxtParams = sub.perFrameCylinder[opts.nextFrameIndex] ?? curParams;
    if (curParams && nxtParams) {
      const curPos = getCachedCylinderPositions(opts.cylinderCache, curParams);
      const nxtPos = getCachedCylinderPositions(opts.cylinderCache, nxtParams);
      const targetPos = mesh.geometry.getAttribute("position");

      if (
        targetPos &&
        curPos.length === nxtPos.length &&
        targetPos.count * 3 === curPos.length
      ) {
        const t = opts.lerp;
        for (let v = 0; v < targetPos.count; v++) {
          const offset = v * 3;
          targetPos.setXYZ(
            v,
            curPos[offset] + (nxtPos[offset] - curPos[offset]) * t,
            curPos[offset + 1] + (nxtPos[offset + 1] - curPos[offset + 1]) * t,
            curPos[offset + 2] + (nxtPos[offset + 2] - curPos[offset + 2]) * t,
          );
        }
        (targetPos as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }
}

/** Get or create cached cylinder vertex positions for deformable mesh interpolation. */
function getCachedCylinderPositions(
  cache: Map<string, Float32Array>,
  params: { topRadius?: number; botRadius?: number; height?: number; segments?: number },
): Float32Array {
  const topRadius = params.topRadius ?? 0.5;
  const botRadius = params.botRadius ?? 0.5;
  const height = params.height ?? 1.0;
  const segments = Math.max(params.segments ?? 16, 3);
  const key = `${topRadius}:${botRadius}:${height}:${segments}`;

  const existing = cache.get(key);
  if (existing) return existing;

  const geometry = createCylinderGeometry(topRadius, botRadius, height, segments);
  const positions = new Float32Array(
    (geometry.getAttribute("position").array as Float32Array).slice(),
  );
  geometry.dispose();
  cache.set(key, positions);
  return positions;
}
