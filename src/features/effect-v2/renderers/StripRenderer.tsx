import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParStrip } from "@/types/effect-v2";
import { useEffectTexture } from "../useEffectTexture";
import { getThreeJSBlendFromD3D } from "../helpers";

interface StripRendererProps {
  strip: ParStrip;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const stripVertexShader = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
varying vec2 vUv;

void main() {
  vAlpha = aAlpha;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const stripFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uTexture;
uniform bool uHasTexture;
varying float vAlpha;
varying vec2 vUv;

void main() {
  float alpha = vAlpha * uOpacity;
  if (uHasTexture) {
    vec4 texColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(uColor * texColor.rgb, alpha * texColor.a);
  } else {
    gl_FragColor = vec4(uColor, alpha);
  }
}
`;

// ---------------------------------------------------------------------------
// View-dependent ribbon builder (ported from V1 StripEffectRenderer)
// ---------------------------------------------------------------------------

function buildViewDependentRibbon(
  segments: THREE.Vector3[],
  halfWidth: number,
  cameraPos: THREE.Vector3,
  life: number,
): {
  positions: Float32Array;
  uvs: Float32Array;
  alphas: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
} {
  const n = segments.length;
  if (n < 2) {
    return {
      positions: new Float32Array(0),
      uvs: new Float32Array(0),
      alphas: new Float32Array(0),
      indices: new Uint16Array(0),
      vertexCount: 0,
    };
  }

  const vertexCount = n * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const alphas = new Float32Array(vertexCount);

  const _tangent = new THREE.Vector3();
  const _toCamera = new THREE.Vector3();
  const _side = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    // Tangent direction
    if (i < n - 1) {
      _tangent.subVectors(segments[i + 1], segments[i]);
    } else {
      _tangent.subVectors(segments[i], segments[i - 1]);
    }
    _tangent.normalize();

    // View direction: camera -> segment
    _toCamera.subVectors(cameraPos, segments[i]).normalize();

    // Side = cross(tangent, toCamera) -- perpendicular to both
    _side.crossVectors(_tangent, _toCamera).normalize();

    // Fallback when tangent is parallel to view direction
    if (_side.lengthSq() < 0.0001) {
      _side.set(1, 0, 0);
    }

    const vi = i * 2;
    // Left vertex
    positions[vi * 3] = segments[i].x - _side.x * halfWidth;
    positions[vi * 3 + 1] = segments[i].y - _side.y * halfWidth;
    positions[vi * 3 + 2] = segments[i].z - _side.z * halfWidth;
    // Right vertex
    positions[(vi + 1) * 3] = segments[i].x + _side.x * halfWidth;
    positions[(vi + 1) * 3 + 1] = segments[i].y + _side.y * halfWidth;
    positions[(vi + 1) * 3 + 2] = segments[i].z + _side.z * halfWidth;

    // UV: U increases along trail, V = 0 (left) or 1 (right)
    const u = i / (n - 1);
    uvs[vi * 2] = u;
    uvs[vi * 2 + 1] = 0;
    uvs[(vi + 1) * 2] = u;
    uvs[(vi + 1) * 2 + 1] = 1;

    // Per-segment alpha fade: older segments (higher index) fade more
    const segAge = i / (n - 1);
    const alpha = life > 0 ? Math.max(1.0 - segAge, 0) : 1.0;
    alphas[vi] = alpha;
    alphas[vi + 1] = alpha;
  }

  // Triangle indices (quad strip)
  const quadCount = n - 1;
  const indices = new Uint16Array(quadCount * 6);
  let idx = 0;
  for (let i = 0; i < quadCount; i++) {
    const base = i * 2;
    indices[idx++] = base;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    indices[idx++] = base + 1;
    indices[idx++] = base + 3;
    indices[idx++] = base + 2;
  }

  return { positions, uvs, alphas, indices, vertexCount };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a single ParStrip as a view-dependent ribbon trail.
 *
 * In the effect viewer we don't have bone positions, so we generate a static
 * trail extending along -Z from the origin. The ribbon geometry is rebuilt
 * every frame so it always faces the camera.
 */
export function StripRenderer({ strip }: StripRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const texture = useEffectTexture(strip.textureName);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: stripVertexShader,
      fragmentShader: stripFragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: getThreeJSBlendFromD3D(strip.srcBlend),
      blendDst: getThreeJSBlendFromD3D(strip.destBlend),
      uniforms: {
        uColor: {
          value: new THREE.Color(strip.color[0], strip.color[1], strip.color[2]),
        },
        uOpacity: { value: strip.color[3] },
        uTexture: { value: null },
        uHasTexture: { value: false },
      },
    });
    return mat;
  }, [strip]);

  // Sync texture uniform when texture loads
  useEffect(() => {
    if (!material) return;
    material.uniforms.uTexture.value = texture;
    material.uniforms.uHasTexture.value = texture !== null;
  }, [texture, material]);

  // Rebuild view-dependent ribbon geometry each frame
  useFrame((state) => {
    if (!meshRef.current) return;

    const halfWidth = 0.5;
    const segmentCount = Math.max(Math.round(strip.maxLen), 2);

    // Static trail segments extending in -Z from origin
    const segments: THREE.Vector3[] = [];
    for (let i = 0; i <= segmentCount; i++) {
      const t = i / segmentCount;
      segments.push(new THREE.Vector3(0, 0, -t * strip.maxLen));
    }

    const { positions, uvs, alphas, indices, vertexCount } =
      buildViewDependentRibbon(
        segments,
        halfWidth,
        state.camera.position,
        strip.life,
      );

    if (vertexCount === 0) return;

    // Reuse or create geometry
    let geo = geometryRef.current;
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geometryRef.current = geo;
      meshRef.current.geometry = geo;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
  });

  return <mesh ref={meshRef} material={material} />;
}
