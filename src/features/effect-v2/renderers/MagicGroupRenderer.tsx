import { useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MagicGroupEntry, MagicSingleEntry } from "@/types/effect-v2";
import { magicSingleTableAtom } from "@/store/effect-v2";
import { useTimeSource } from "../TimeContext";
import { MagicEffectRenderer } from "./MagicEffectRenderer";
import { useLoadEffect } from "../useLoadEffect";

/**
 * Default fan angle in radians (~43 degrees).
 * Matches C++ _fFanAngle = 0.75f in EffectObj.cpp.
 */
const DEFAULT_FAN_ANGLE = 0.75;

/**
 * Delay between sequential effects in seconds.
 * Matches C++ Part_sequence: SetDailTime((float)n * 0.2f).
 */
const SEQUENCE_DELAY = 0.2;

/** Group render modes matching C++ GroupList[] indices. */
const GROUP_MODE_FAN = 0;
// const GROUP_MODE_SEQUENCE = 1;

/**
 * Expand a MagicGroupEntry into a flat list of MagicSingleEntry references.
 * typeIds=[10,11], counts=[2,1] -> [entry10, entry10, entry11]
 */
function expandGroupPhases(
  group: MagicGroupEntry,
  magicMap: Map<number, MagicSingleEntry>,
): MagicSingleEntry[] {
  const entries: MagicSingleEntry[] = [];
  for (let i = 0; i < group.type_ids.length; i++) {
    if (group.type_ids[i] < 0) continue;
    const entry = magicMap.get(group.type_ids[i]);
    if (!entry) continue;
    for (let j = 0; j < group.counts[i]; j++) {
      entries.push(entry);
    }
  }
  return entries;
}

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
    () => expandGroupPhases(group, magicMap),
    [group, magicMap],
  );

  const renderMode = group.render_idx;

  if (phases.length === 0) return null;

  if (renderMode === GROUP_MODE_FAN) {
    return <FanGroupRenderer phases={phases} />;
  }

  // Default to sequence for renderIdx=1 or any unknown value
  return <SequenceGroupRenderer phases={phases} />;
}

// ── Fan Mode ────────────────────────────────────────────────────────────────

interface FanGroupRendererProps {
  phases: MagicSingleEntry[];
}

/**
 * Fan mode: fires all effects simultaneously, each rotated by an angular
 * offset around the Y axis. Matches C++ Part_fan() which uses
 * D3DXMatrixRotationZ to spread effects in a cone (Z in D3D = Y in Three.js).
 */
function FanGroupRenderer({ phases }: FanGroupRendererProps) {
  const count = phases.length;
  const angleStep = count > 1 ? DEFAULT_FAN_ANGLE / (count - 1) : 0;
  const startAngle = count > 1 ? -DEFAULT_FAN_ANGLE / 2 : 0;

  return (
    <group>
      {phases.map((entry, i) => {
        const angle = startAngle + i * angleStep;
        return (
          <group key={i} rotation={[0, angle, 0]}>
            <FanPhase entry={entry} />
          </group>
        );
      })}
    </group>
  );
}

function FanPhase({ entry }: { entry: MagicSingleEntry }) {
  const effFiles = useLoadEffect(entry.models);
  return <MagicEffectRenderer effFiles={effFiles} magicEntry={entry} />;
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
  return (
    <group>
      {phases.map((entry, i) => (
        <DelayedEffect key={i} delay={i * SEQUENCE_DELAY}>
          <SequencePhase entry={entry} />
        </DelayedEffect>
      ))}
    </group>
  );
}

function SequencePhase({ entry }: { entry: MagicSingleEntry }) {
  const effFiles = useLoadEffect(entry.models);
  return <MagicEffectRenderer effFiles={effFiles} magicEntry={entry} />;
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
