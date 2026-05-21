import { useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MagicGroupEntry, MagicSingleEntry } from "@/types/effect-v2";
import { magicSingleTableAtom } from "@/store/effect-v2";
import { useTimeSource } from "../TimeContext";
import { MagicEffectRenderer } from "./MagicEffectRenderer";
import { useLoadEffect } from "../useLoadEffect";
import {
  computeFanPhaseTarget,
  computeSequenceDelay,
  expandMagicGroupPhases,
} from "./magicGroupKinematics";

/** Group render modes matching C++ GroupList[] indices. */
const GROUP_MODE_FAN = 0;
const GROUP_MODE_SEQUENCE = 1;

interface MagicGroupRendererProps {
  group: MagicGroupEntry;
}

/**
 * Renders a MagicGroup by dispatching on renderIdx:
 *   0 = Fan mode:  all effects fired simultaneously, rotated in a horizontal fan
 *   1 = Sequence:  all effects fired simultaneously, staggered by 0.2s each
 *
 * Matches C++ GroupList[] = { Part_fan, Part_sequence } in EffectObj.cpp.
 */
export function MagicGroupRenderer({ group }: MagicGroupRendererProps) {
  const table = useAtomValue(magicSingleTableAtom);

  const magicMap = useMemo(() => {
    const map = new Map<number, MagicSingleEntry>();
    for (const entry of table?.entries ?? []) {
      map.set(entry.id, entry);
    }
    return map;
  }, [table]);

  const phases = useMemo(
    () => expandMagicGroupPhases(group, magicMap),
    [group, magicMap],
  );

  const renderMode = group.render_idx;

  if (phases.length === 0) return null;

  switch (renderMode) {
    case GROUP_MODE_FAN:
      return <FanGroupRenderer phases={phases} />;
    case GROUP_MODE_SEQUENCE:
      return <SequenceGroupRenderer phases={phases} />;
    default:
      return null;
  }
}

// ── Fan Mode ────────────────────────────────────────────────────────────────

interface FanGroupRendererProps {
  phases: MagicSingleEntry[];
}

/**
 * Fan mode: fires all effects simultaneously, each rotated by an angular
 * offset around PKO vertical Z. Matches C++ Part_fan() which flattens target
 * Z to the origin height and uses D3DXMatrixRotationZ.
 */
function FanGroupRenderer({ phases }: FanGroupRendererProps) {
  const count = phases.length;
  const origin = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const target = useMemo(() => new THREE.Vector3(0, 8, 0), []);

  return (
    <group>
      {phases.map((entry, i) => {
        const phaseTarget = computeFanPhaseTarget(origin, target, i, count);
        return (
          <FanPhase key={i} entry={entry} origin={origin} target={phaseTarget} />
        );
      })}
    </group>
  );
}

function FanPhase({
  entry,
  origin,
  target,
}: {
  entry: MagicSingleEntry;
  origin: THREE.Vector3;
  target: THREE.Vector3;
}) {
  const effFiles = useLoadEffect(entry.models);
  return (
    <MagicEffectRenderer
      effFiles={effFiles}
      magicEntry={entry}
      origin={origin}
      target={target}
      showTarget={false}
      animateTarget={false}
    />
  );
}

// ── Sequence Mode ───────────────────────────────────────────────────────────

interface SequenceGroupRendererProps {
  phases: MagicSingleEntry[];
}

/**
 * Sequence mode: fires all effects from the same position, each delayed by
 * index * 0.2s. Matches C++ Part_sequence() which calls
 * SetDailTime((float)n * 0.2f) on each effect.
 */
function SequenceGroupRenderer({ phases }: SequenceGroupRendererProps) {
  const origin = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const target = useMemo(() => new THREE.Vector3(0, 8, 1), []);
  const targetVisual = useMemo(() => new THREE.Vector3(0, 8, 0), []);

  return (
    <group>
      {phases.map((entry, i) => (
        <DelayedEffect key={i} delay={computeSequenceDelay(i)}>
          <SequencePhase
            entry={entry}
            origin={origin}
            target={target}
            targetVisual={targetVisual}
            showTarget={i === 0}
          />
        </DelayedEffect>
      ))}
    </group>
  );
}

function SequencePhase({
  entry,
  origin,
  target,
  targetVisual,
  showTarget,
}: {
  entry: MagicSingleEntry;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  targetVisual: THREE.Vector3;
  showTarget: boolean;
}) {
  const effFiles = useLoadEffect(entry.models);
  return (
    <MagicEffectRenderer
      effFiles={effFiles}
      magicEntry={entry}
      origin={origin}
      target={target}
      targetVisual={targetVisual}
      showTarget={showTarget}
      animateTarget={false}
    />
  );
}

// ── Delay wrapper ───────────────────────────────────────────────────────────

interface DelayedEffectProps {
  delay: number;
  children: React.ReactNode;
}

/**
 * Renders children only after `delay` seconds have elapsed on the time source.
 * Uses visibility toggle so the Three.js scene graph stays stable (no mount churn).
 */
function DelayedEffect({ delay, children }: DelayedEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const timeSource = useTimeSource();
  const [visible, setVisible] = useState(delay <= 0);

  useFrame(() => {
    const t = timeSource.getTime();
    const shouldBeVisible = t >= delay;
    if (shouldBeVisible !== visible) {
      setVisible(shouldBeVisible);
    }
    if (groupRef.current) {
      groupRef.current.visible = shouldBeVisible;
    }
  });

  // Reset visibility when time resets
  const prevTime = useRef(timeSource.getTime());
  if (timeSource.getTime() < prevTime.current) {
    if (delay > 0) {
      queueMicrotask(() => setVisible(false));
    }
  }
  prevTime.current = timeSource.getTime();

  return (
    <group ref={groupRef} visible={visible}>
      {children}
    </group>
  );
}
