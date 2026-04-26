import { useRef } from "react";
import { ParSystem } from "@/types/effect-v2";
import { useLoadEffect } from "../../useLoadEffect";
import { TimeProvider, TimeSource, useTimeSource } from "../../TimeContext";
import { EffectRenderer } from "../EffectRenderer";
import { Particle } from "./useParticleLifecycle";

interface ParticleVisualProps {
  system: ParSystem;
  /** When provided, wraps the EffectRenderer in a local TimeProvider
   *  whose getTime() returns the particle's elapsed time. */
  particle?: Particle;
  loop?: boolean;
}

/**
 * Renders the visual template for a particle system.
 * If the system's modelName references an .eff file, loads and renders it.
 *
 * When a `particle` is provided, wraps the effect in a local TimeProvider so that
 * sub-effects (RectPlane, Cylinder) animate relative to the particle's birth time,
 * not the global clock.
 */
export function ParticleVisual({ system, particle, loop: _loop }: ParticleVisualProps) {
  const effFiles = useLoadEffect(
    system.modelName.endsWith('.eff') ? [system.modelName] : []
  );

  if (effFiles.length === 0) return null;

  if (effFiles.length > 1) {
    console.error('has more than one effect, but rendering just one in ParticleVisual');
  }

  const renderer = <EffectRenderer effect={effFiles[0]} />;

  if (particle) {
    return (
      <ParticleTimeScope particle={particle}>
        {renderer}
      </ParticleTimeScope>
    );
  }

  return renderer;
}

/**
 * Wraps children in a local TimeProvider driven by a particle's elapsed time.
 * Stable object identity — getTime() reads particle.elapsed which is mutated
 * by useParticleLifecycle each frame.
 */
function ParticleTimeScope({ particle, children }: { particle: Particle; children: React.ReactNode }) {
  const parent = useTimeSource();

  const localTime = useRef<TimeSource>({
    getTime: () => particle.elapsed,
    get playing() { return parent.playing; },
    loop: true, // sub-effects loop within particle life
  }).current;

  return <TimeProvider value={localTime}>{children}</TimeProvider>;
}
