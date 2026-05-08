import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParStrip } from "@/types/effect-v2";
import { useEffectTexture } from "../useEffectTexture";
import { getThreeJSBlendFromD3D } from "../helpers";
import type { DummyLineSpan } from "./particles/dummyLineKinematics";
import {
  applyTextureSampling,
  composePkoRenderState,
} from "@/features/effect/pkoStateEmulation";
import {
  ageStripTrack,
  appendStripTrackSample,
  buildStripGeometryFromTrack,
  StripTrackVertex,
} from "./stripTrailKinematics";

interface StripRendererProps {
  strip: ParStrip;
  dummyLineSpan?: DummyLineSpan | null;
  loop?: boolean;
  onComplete?: () => void;
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

/**
 * Renders a single ParStrip from runtime dummy endpoints.
 * CMPStrip::Play returns without setting _bPlay when no item/character dummy
 * source is attached, so detached strips do not synthesize preview geometry.
 */
export function StripRenderer({ strip, dummyLineSpan = null, loop = false, onComplete }: StripRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const sourceTrackRef = useRef<StripTrackVertex[]>([]);
  const sampleTimerRef = useRef(0);
  const sourcePlayingRef = useRef(true);
  const completedRef = useRef(false);
  const texture = useEffectTexture(strip.textureName);

  useEffect(() => {
    if (dummyLineSpan || loop || completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  }, [dummyLineSpan, loop, onComplete]);

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
      fog: false,
      toneMapped: false,
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
    applyTextureSampling(texture, composePkoRenderState(0));
    material.uniforms.uTexture.value = texture;
    material.uniforms.uHasTexture.value = texture !== null;
  }, [texture, material]);

  useFrame((_state, delta) => {
    if (!meshRef.current) return;
    if (!dummyLineSpan) return;

    const { positions, uvs, alphas, indices, completed } =
      buildSourceTrackGeometry(strip, dummyLineSpan, delta, loop, sourceTrackRef, sampleTimerRef, sourcePlayingRef);

    if (completed && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }

    if (positions.length === 0) return;

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

function buildSourceTrackGeometry(
  strip: ParStrip,
  dummyLineSpan: DummyLineSpan,
  delta: number,
  loop: boolean,
  trackRef: MutableRefObject<StripTrackVertex[]>,
  sampleTimerRef: MutableRefObject<number>,
  playingRef: MutableRefObject<boolean>,
) {
  trackRef.current = ageStripTrack(trackRef.current, delta);

  if (playingRef.current && trackRef.current.length === 0) {
    const result = appendStripTrackSample(trackRef.current, dummyLineSpan, strip.maxLen);
    trackRef.current = result.vertices;
    playingRef.current = result.playing;
  }

  sampleTimerRef.current += delta;
  if (playingRef.current && sampleTimerRef.current > strip.step) {
    const result = appendStripTrackSample(trackRef.current, dummyLineSpan, strip.maxLen);
    trackRef.current = result.vertices;
    playingRef.current = result.playing;
    sampleTimerRef.current = 0;

    if (!playingRef.current && loop) {
      trackRef.current = [];
      playingRef.current = true;
    }
  }

  if (!playingRef.current && !loop) {
    return {
      positions: new Float32Array(0),
      uvs: new Float32Array(0),
      alphas: new Float32Array(0),
      indices: new Uint16Array(0),
      completed: true,
    };
  }

  return {
    ...buildStripGeometryFromTrack(trackRef.current, strip.life),
    completed: false,
  };
}
