import { ReactNode, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleEffectInfo } from "@/types/item";
import { ParticleEffectRenderer } from "@/features/effect-v2/renderers/ParticleEffectRenderer";
import { TimeProvider, TimeSource } from "@/features/effect-v2/TimeContext";
import { computeItemDummyLineSpan, ItemDummyPoint } from "./itemParticleDummySpan";

function ItemParticleTimeProvider({ children }: { children: ReactNode }) {
  const elapsedRef = useRef(0);
  const timeSource = useRef<TimeSource>({
    getTime: () => elapsedRef.current,
    playing: true,
    loop: true,
  }).current;

  useFrame((_, delta) => {
    elapsedRef.current += Math.min(delta, 0.05);
  });

  return <TimeProvider value={timeSource}>{children}</TimeProvider>;
}

interface SingleParticleEffectProps {
  parFile: string;
  dummyMatrix: THREE.Matrix4 | null;
  dummyLineSpan: ReturnType<typeof computeItemDummyLineSpan>;
  projectId: string;
  alpha: number;
  scale: number;
}

function SingleParticleEffect({
  parFile,
  dummyMatrix,
  dummyLineSpan,
  projectId,
  alpha,
  scale,
}: SingleParticleEffectProps) {
  return (
    <group matrix={dummyMatrix ?? undefined} matrixAutoUpdate={!dummyMatrix} visible={alpha > 0}>
      <group scale={[scale, scale, scale]}>
        <ParticleEffectRenderer
          particleEffectName={parFile.replace(/\.par$/i, "")}
          projectId={projectId}
          loop
          dummyLineSpan={dummyLineSpan}
          opacityScale={alpha}
          respectHiddenState={false}
        />
      </group>
    </group>
  );
}

interface ItemParticleRendererProps {
  particles: ParticleEffectInfo[];
  dummyPoints: ItemDummyPoint[];
  projectId: string;
  alpha: number;
}

export function ItemParticleRenderer({
  particles,
  dummyPoints,
  projectId,
  alpha,
}: ItemParticleRendererProps) {
  const dummyLineSpan = useMemo(
    () => computeItemDummyLineSpan(dummyPoints),
    [dummyPoints],
  );

  return (
    <ItemParticleTimeProvider>
      {particles.map((p, idx) => {
        const dummy = dummyPoints.find((d) => d.id === p.dummy_id);
        return (
          <SingleParticleEffect
            key={`${p.par_file}-${p.dummy_id}-${idx}`}
            parFile={p.par_file}
            dummyMatrix={dummy?.matrix ?? null}
            dummyLineSpan={dummyLineSpan}
            projectId={projectId}
            alpha={alpha}
            scale={p.scale}
          />
        );
      })}
    </ItemParticleTimeProvider>
  );
}
