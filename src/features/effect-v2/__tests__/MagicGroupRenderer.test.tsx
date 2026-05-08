import { describe, expect, it, vi } from "vitest";
import { Provider, createStore } from "jotai";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { magicSingleTableAtom } from "@/store/effect-v2";
import { MagicGroupEntry, MagicSingleEntry } from "@/types/effect-v2";
import { MagicGroupRenderer } from "../renderers/MagicGroupRenderer";
import { TimeProvider, TimeSource } from "../TimeContext";

const { mockMagicEffectRenderer } = vi.hoisted(() => ({
  mockMagicEffectRenderer: vi.fn((props: { target: THREE.Vector3; targetVisual?: THREE.Vector3 }) => (
    <group name={`magic-target-${props.target.x}-${props.target.y}-${props.target.z}`} />
  )),
}));

vi.mock("../useLoadEffect", () => ({
  useLoadEffect: () => [],
}));

vi.mock("../renderers/MagicEffectRenderer", () => ({
  MagicEffectRenderer: mockMagicEffectRenderer,
}));

const testTimeSource: TimeSource = {
  getTime: () => 0,
  playing: true,
  loop: true,
};

function entry(id: number): MagicSingleEntry {
  return {
    id,
    data_name: `entry-${id}`,
    name: `Entry ${id}`,
    models: [],
    velocity: 1,
    particles: [],
    dummies: [-1, -1, -1, -1, -1, -1, -1, -1],
    render_idx: 2,
    lightId: 0,
    result_effect: "0",
  };
}

function group(overrides: Partial<MagicGroupEntry> = {}): MagicGroupEntry {
  return {
    id: 2000,
    data_name: "group",
    name: "Group",
    type_ids: [10, -1, -1, -1, -1, -1, -1, -1],
    counts: [1, 0, 0, 0, 0, 0, 0, 0],
    total_count: 1,
    render_idx: 0,
    ...overrides,
  };
}

describe("MagicGroupRenderer", () => {
  it("aims group magic forward on raw PKO +Y instead of upward on +Z", async () => {
    mockMagicEffectRenderer.mockClear();
    const store = createStore();
    store.set(magicSingleTableAtom, {
      recordSize: 0,
      entries: [entry(10)],
    });

    await ReactThreeTestRenderer.create(
      <Provider store={store}>
        <MagicGroupRenderer group={group()} />
      </Provider>,
    );

    const props = mockMagicEffectRenderer.mock.calls[0][0];
    expect(props.target).toEqual(expect.objectContaining({ x: 0, y: 8, z: 0 }));
  });

  it("aims sequence group magic at target character height while keeping the visual target grounded", async () => {
    mockMagicEffectRenderer.mockClear();
    const store = createStore();
    store.set(magicSingleTableAtom, {
      recordSize: 0,
      entries: [entry(10)],
    });

    await ReactThreeTestRenderer.create(
      <Provider store={store}>
        <TimeProvider value={testTimeSource}>
          <MagicGroupRenderer group={group({ render_idx: 1 })} />
        </TimeProvider>
      </Provider>,
    );

    const props = mockMagicEffectRenderer.mock.calls[0][0];
    expect(props.target).toEqual(expect.objectContaining({ x: 0, y: 8, z: 1 }));
    expect(props.targetVisual).toEqual(expect.objectContaining({ x: 0, y: 8, z: 0 }));
  });

  it("does not route unknown group render indices outside C++ GroupList", async () => {
    mockMagicEffectRenderer.mockClear();
    const store = createStore();
    store.set(magicSingleTableAtom, {
      recordSize: 0,
      entries: [entry(10)],
    });

    await ReactThreeTestRenderer.create(
      <Provider store={store}>
        <TimeProvider value={testTimeSource}>
          <MagicGroupRenderer group={group({ render_idx: 2 })} />
        </TimeProvider>
      </Provider>,
    );

    expect(mockMagicEffectRenderer).not.toHaveBeenCalled();
  });
});
