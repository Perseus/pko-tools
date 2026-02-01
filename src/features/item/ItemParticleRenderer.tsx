import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { ParticleEffectInfo } from "@/types/item";

const MAX_PARTICLES = 200;

interface ParticlePool {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  lifetimes: Float32Array;
  alive: Uint8Array;
  count: number;
}

interface ParConfig {
  emitRate: number;
  lifetime: [number, number];
  speed: [number, number];
  size: [number, number];
  color: [number, number, number, number];
  gravity: number;
  spread: number;
}

function createPool(): ParticlePool {
  return {
    positions: new Float32Array(MAX_PARTICLES * 3),
    colors: new Float32Array(MAX_PARTICLES * 3),
    sizes: new Float32Array(MAX_PARTICLES),
    alphas: new Float32Array(MAX_PARTICLES),
    velocities: new Float32Array(MAX_PARTICLES * 3),
    ages: new Float32Array(MAX_PARTICLES),
    lifetimes: new Float32Array(MAX_PARTICLES),
    alive: new Uint8Array(MAX_PARTICLES),
    count: MAX_PARTICLES,
  };
}

/** Parse a .par file JSON structure into a simplified ParConfig */
function extractParConfig(parData: any): ParConfig {
  // .par files can be complex; extract key properties
  const sys = parData?.systems?.[0] ?? parData;
  return {
    emitRate: sys?.emit_rate ?? sys?.emitRate ?? 15,
    lifetime: [
      sys?.life_min ?? sys?.lifeMin ?? 0.5,
      sys?.life_max ?? sys?.lifeMax ?? 2.0,
    ],
    speed: [
      sys?.speed_min ?? sys?.speedMin ?? 0.2,
      sys?.speed_max ?? sys?.speedMax ?? 1.0,
    ],
    size: [
      sys?.size_start ?? sys?.sizeStart ?? 0.02,
      sys?.size_end ?? sys?.sizeEnd ?? 0.01,
    ],
    color: [
      (sys?.color_r ?? sys?.colorR ?? 200) / 255,
      (sys?.color_g ?? sys?.colorG ?? 200) / 255,
      (sys?.color_b ?? sys?.colorB ?? 255) / 255,
      (sys?.color_a ?? sys?.colorA ?? 200) / 255,
    ],
    gravity: sys?.gravity ?? 0,
    spread: sys?.spread ?? sys?.emitAngle ?? 1.0,
  };
}

interface SingleParticleEffectProps {
  parFile: string;
  dummyMatrix: THREE.Matrix4 | null;
  projectId: string;
  alpha: number;
  scale: number;
}

function SingleParticleEffect({
  parFile,
  dummyMatrix,
  projectId,
  alpha,
  scale,
}: SingleParticleEffectProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);
  const poolRef = useRef<ParticlePool>(createPool());
  const configRef = useRef<ParConfig | null>(null);
  const emitAccum = useRef(0);

  // Load .par data
  useEffect(() => {
    if (!parFile || !projectId) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await invoke<any>("load_particles", {
          projectId,
          effectName: parFile,
        });
        if (!cancelled && data) {
          configRef.current = extractParConfig(data);
        }
      } catch {
        // .par file not found or can't be loaded — use defaults
        configRef.current = extractParConfig({});
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [parFile, projectId]);

  // Apply dummy matrix
  useEffect(() => {
    if (groupRef.current && dummyMatrix) {
      groupRef.current.matrix.copy(dummyMatrix);
      groupRef.current.matrixAutoUpdate = false;
    }
  }, [dummyMatrix]);

  useFrame((_, delta) => {
    if (!pointsRef.current || !configRef.current) return;
    const dt = Math.min(delta, 0.05);
    const config = configRef.current;
    const pool = poolRef.current;

    // Emit particles
    emitAccum.current += dt * config.emitRate;
    while (emitAccum.current >= 1) {
      emitAccum.current -= 1;
      // Find dead particle
      for (let i = 0; i < pool.count; i++) {
        if (pool.alive[i]) continue;

        pool.alive[i] = 1;
        pool.ages[i] = 0;
        pool.lifetimes[i] =
          config.lifetime[0] +
          Math.random() * (config.lifetime[1] - config.lifetime[0]);

        // Random position near origin
        const spread = config.spread * 0.1 * scale;
        pool.positions[i * 3] = (Math.random() - 0.5) * spread;
        pool.positions[i * 3 + 1] = Math.random() * spread * 0.3;
        pool.positions[i * 3 + 2] = (Math.random() - 0.5) * spread;

        // Random velocity
        const speed =
          config.speed[0] +
          Math.random() * (config.speed[1] - config.speed[0]);
        pool.velocities[i * 3] = (Math.random() - 0.5) * speed * 0.5;
        pool.velocities[i * 3 + 1] = speed;
        pool.velocities[i * 3 + 2] = (Math.random() - 0.5) * speed * 0.5;

        pool.sizes[i] = config.size[0] * scale;
        pool.colors[i * 3] = config.color[0];
        pool.colors[i * 3 + 1] = config.color[1];
        pool.colors[i * 3 + 2] = config.color[2];
        pool.alphas[i] = config.color[3] * alpha;
        break;
      }
    }

    // Update alive particles
    const posAttr = pointsRef.current.geometry.attributes
      .position as THREE.BufferAttribute;
    const colorAttr = pointsRef.current.geometry.attributes
      .color as THREE.BufferAttribute;
    const sizeAttr = pointsRef.current.geometry.attributes
      .aSize as THREE.BufferAttribute;
    const alphaAttr = pointsRef.current.geometry.attributes
      .aAlpha as THREE.BufferAttribute;

    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i]) {
        sizeAttr.array[i] = 0;
        alphaAttr.array[i] = 0;
        continue;
      }

      pool.ages[i] += dt;
      if (pool.ages[i] >= pool.lifetimes[i]) {
        pool.alive[i] = 0;
        sizeAttr.array[i] = 0;
        alphaAttr.array[i] = 0;
        continue;
      }

      const t = pool.ages[i] / pool.lifetimes[i];

      // Physics
      pool.positions[i * 3] += pool.velocities[i * 3] * dt;
      pool.positions[i * 3 + 1] += pool.velocities[i * 3 + 1] * dt;
      pool.positions[i * 3 + 2] += pool.velocities[i * 3 + 2] * dt;
      pool.velocities[i * 3 + 1] += config.gravity * dt;

      posAttr.array[i * 3] = pool.positions[i * 3];
      posAttr.array[i * 3 + 1] = pool.positions[i * 3 + 1];
      posAttr.array[i * 3 + 2] = pool.positions[i * 3 + 2];

      // Size lerp
      const size =
        config.size[0] * scale * (1 - t) + config.size[1] * scale * t;
      sizeAttr.array[i] = size;

      // Color fade out
      const fadeAlpha = (1 - t) * pool.alphas[i];
      colorAttr.array[i * 3] = pool.colors[i * 3] * fadeAlpha;
      colorAttr.array[i * 3 + 1] = pool.colors[i * 3 + 1] * fadeAlpha;
      colorAttr.array[i * 3 + 2] = pool.colors[i * 3 + 2] * fadeAlpha;
      alphaAttr.array[i] = fadeAlpha;
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={MAX_PARTICLES}
            array={new Float32Array(MAX_PARTICLES * 3)}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            count={MAX_PARTICLES}
            array={new Float32Array(MAX_PARTICLES * 3)}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-aSize"
            count={MAX_PARTICLES}
            array={new Float32Array(MAX_PARTICLES)}
            itemSize={1}
          />
          <bufferAttribute
            attach="attributes-aAlpha"
            count={MAX_PARTICLES}
            array={new Float32Array(MAX_PARTICLES)}
            itemSize={1}
          />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
          size={0.1}
        />
      </points>
    </group>
  );
}

interface ItemParticleRendererProps {
  particles: ParticleEffectInfo[];
  dummyPoints: { id: number; matrix: THREE.Matrix4; name: string }[];
  projectId: string;
  alpha: number;
}

export function ItemParticleRenderer({
  particles,
  dummyPoints,
  projectId,
  alpha,
}: ItemParticleRendererProps) {
  return (
    <>
      {particles.map((p, idx) => {
        const dummy = dummyPoints.find((d) => d.id === p.dummy_id);
        return (
          <SingleParticleEffect
            key={`${p.par_file}-${p.dummy_id}-${idx}`}
            parFile={p.par_file}
            dummyMatrix={dummy?.matrix ?? null}
            projectId={projectId}
            alpha={alpha}
            scale={p.scale}
          />
        );
      })}
    </>
  );
}
