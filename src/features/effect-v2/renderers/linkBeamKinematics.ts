import * as THREE from "three";

export interface LinkTextureFrameState {
  index: number;
  time: number;
}

export interface LinkBeamGeometryInput {
  startPko: THREE.Vector3;
  endPko: THREE.Vector3;
  eyePko: THREE.Vector3;
  baseRadius?: number;
}

export interface LinkBeamGeometryData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
}

const LINK_ARC_SEGMENTS = 10;
const LINK_HALF_WIDTH = 1;
const LINK_TEXTURE_STEP_SECONDS = 0.15;

export function threeToPko(v: THREE.Vector3): THREE.Vector3 {
  return v.clone();
}

export function computeLinkArcRadius(distance: number, baseRadius = 3): number {
  if (distance > baseRadius * 2) {
    return baseRadius - baseRadius * ((distance / baseRadius - 1) / 10);
  }

  return baseRadius + (baseRadius - distance) / 10;
}

export function advanceLinkTextureFrame(
  state: LinkTextureFrameState,
  deltaSeconds: number,
  textureCount = 4,
): LinkTextureFrameState {
  if (textureCount <= 0) return { index: 0, time: 0 };

  const nextTime = state.time + deltaSeconds;
  if (nextTime > LINK_TEXTURE_STEP_SECONDS) {
    return {
      index: (state.index + 1) % textureCount,
      time: 0,
    };
  }

  return {
    index: state.index,
    time: nextTime,
  };
}

export function buildLinkBeamGeometry({
  startPko,
  endPko,
  eyePko,
  baseRadius = 3,
}: LinkBeamGeometryInput): LinkBeamGeometryData {
  const direction = endPko.clone().sub(startPko);
  const distance = direction.length();
  if (distance <= 0) {
    return emptyLinkGeometry();
  }
  direction.normalize();

  const eyeDirection = eyePko.clone().sub(startPko);
  if (eyeDirection.lengthSq() <= 0) {
    return emptyLinkGeometry();
  }
  eyeDirection.normalize();

  const cross = new THREE.Vector3().crossVectors(direction, eyeDirection);
  if (cross.lengthSq() <= 0) {
    return emptyLinkGeometry();
  }
  cross.normalize();

  const radius = computeLinkArcRadius(distance, baseRadius);
  const pairs: Array<{ position: THREE.Vector3; u: number }> = [];

  const step = (Math.PI / 2) / LINK_ARC_SEGMENTS;
  for (let n = 0; n < LINK_ARC_SEGMENTS; n++) {
    const theta = n * step;
    const rotatedX = -radius * Math.cos(theta);
    const arcHeight = radius * Math.sin(theta);
    let distAlongBeam = radius + rotatedX;
    if (distAlongBeam < 0.00001) {
      distAlongBeam = 0;
    }

    const point = startPko.clone().addScaledVector(direction, distAlongBeam);
    point.z = arcHeight;

    pairs.push({
      position: point,
      u: n === 0 ? 0 : distAlongBeam / distance,
    });
  }

  pairs.push({
    position: endPko.clone(),
    u: 1,
  });

  return buildGeometryFromPairs(pairs, cross);
}

function buildGeometryFromPairs(
  pairs: Array<{ position: THREE.Vector3; u: number }>,
  cross: THREE.Vector3,
): LinkBeamGeometryData {
  const vertexCount = pairs.length * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < pairs.length; i++) {
    const { position, u } = pairs[i];
    const left = position.clone().addScaledVector(cross, -LINK_HALF_WIDTH);
    const right = position.clone().addScaledVector(cross, LINK_HALF_WIDTH);
    const base = i * 2;

    positions[base * 3] = left.x;
    positions[base * 3 + 1] = left.y;
    positions[base * 3 + 2] = left.z;
    positions[(base + 1) * 3] = right.x;
    positions[(base + 1) * 3 + 1] = right.y;
    positions[(base + 1) * 3 + 2] = right.z;

    uvs[base * 2] = u;
    uvs[base * 2 + 1] = 1;
    uvs[(base + 1) * 2] = u;
    uvs[(base + 1) * 2 + 1] = 0;
  }

  const triangleCount = Math.max(vertexCount - 2, 0);
  const indices = new Uint16Array(triangleCount * 3);
  let idx = 0;
  for (let i = 0; i < triangleCount; i++) {
    if (i % 2 === 0) {
      indices[idx++] = i;
      indices[idx++] = i + 1;
      indices[idx++] = i + 2;
    } else {
      indices[idx++] = i;
      indices[idx++] = i + 2;
      indices[idx++] = i + 1;
    }
  }

  return {
    positions,
    uvs,
    indices,
    vertexCount,
  };
}

function emptyLinkGeometry(): LinkBeamGeometryData {
  return {
    positions: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint16Array(0),
    vertexCount: 0,
  };
}
