import * as THREE from "three";
import type { DummyLineSpan } from "./particles/dummyLineKinematics";

export interface StripTrackVertex {
  position: THREE.Vector3;
  uv: THREE.Vector2;
  age: number;
}

export interface StripTrackAppendResult {
  vertices: StripTrackVertex[];
  playing: boolean;
}

export interface StripGeometryData {
  positions: Float32Array;
  uvs: Float32Array;
  alphas: Float32Array;
  indices: Uint16Array;
}

export function computeStripPairAlpha(age: number, life: number): number {
  if (life <= 0) return 0;
  if (age >= life) return 0;
  return Math.max(1 - age / life, 0);
}

export function appendStripTrackSample(
  vertices: StripTrackVertex[],
  span: DummyLineSpan,
  maxLen: number,
): StripTrackAppendResult {
  if (vertices.length >= maxLen) {
    return {
      vertices,
      playing: false,
    };
  }

  const dummy2 = span.start.clone();
  const dummy1 = span.start.clone().addScaledVector(span.direction, span.distance);
  const nextU = vertices.length > 0 ? vertices[vertices.length - 2].uv.x + 1 : 0;

  return {
    vertices: [
      ...vertices,
      {
        position: dummy1,
        uv: new THREE.Vector2(nextU, 1),
        age: 0,
      },
      {
        position: dummy2,
        uv: new THREE.Vector2(nextU, 0),
        age: 0,
      },
    ],
    playing: true,
  };
}

export function ageStripTrack(vertices: StripTrackVertex[], dt: number): StripTrackVertex[] {
  if (dt <= 0) return vertices;
  return vertices.map((vertex) => ({
    ...vertex,
    age: vertex.age + dt,
  }));
}

export function buildStripGeometryFromTrack(
  vertices: StripTrackVertex[],
  life = Number.POSITIVE_INFINITY,
): StripGeometryData {
  const vertexCount = vertices.length;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const alphas = new Float32Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const vertex = vertices[i];
    positions[i * 3] = vertex.position.x;
    positions[i * 3 + 1] = vertex.position.y;
    positions[i * 3 + 2] = vertex.position.z;
    uvs[i * 2] = vertex.uv.x;
    uvs[i * 2 + 1] = vertex.uv.y;
    alphas[i] = computeStripPairAlpha(vertex.age, life);
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
    alphas,
    indices,
  };
}
