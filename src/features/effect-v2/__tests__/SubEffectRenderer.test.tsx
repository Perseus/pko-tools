import { describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { SubEffectRenderer } from "../renderers/SubEffectRenderer";
import { TimeProvider, TimeSource } from "../TimeContext";
import { baseSubEffect, rotatingSubEffect } from "./fixtures";

// Mock the texture hook — no Tauri backend in tests
vi.mock("../useEffectTexture", () => ({
  useEffectTexture: () => null,
}));

/** A static TimeSource for tests. */
const testTimeSource: TimeSource = {
  getTime: () => 0.5,
  playing: true,
  loop: true,
};

/** Wraps children in a TimeProvider for test rendering. */
function TestTimeWrapper({ children }: { children: React.ReactNode }) {
  return <TimeProvider value={testTimeSource}>{children}</TimeProvider>;
}

describe("SubEffectRenderer", () => {
  it("renders a group with a mesh for RectPlane", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={baseSubEffect} />
      </TestTimeWrapper>
    );

    const groups = renderer.scene.findAll((node) => node.type === "Group");
    expect(groups.length).toBeGreaterThan(0);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("returns null for cylinder sub-effects (not yet implemented)", async () => {
    const cylinderSubEffect = { ...baseSubEffect, useParam: 1 };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={cylinderSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(0);
  });

  it("returns null for external .lgo models (not yet implemented)", async () => {
    const lgoSubEffect = { ...baseSubEffect, modelName: "weapon.lgo" };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={lgoSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(0);
  });

  it("renders when sub-effect has texName but no modelName", async () => {
    const texOnlySubEffect = { ...baseSubEffect, modelName: "" };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={texOnlySubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("applies rotation after advancing frames when rotaLoop is true", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={rotatingSubEffect} />
      </TestTimeWrapper>
    );

    // Get the outer group (first group is the SubEffectRenderer group)
    const groups = renderer.scene.findAll((node) => node.type === "Group");
    const outerGroup = groups[0];

    // Identity quaternion before advancing
    const qBefore = outerGroup.instance.quaternion.clone();

    // Advance 30 frames at 60fps
    await renderer.advanceFrames(30, 1 / 60);

    const qAfter = outerGroup.instance.quaternion.clone();

    // Quaternion should have changed due to rotation
    expect(qBefore.equals(qAfter)).toBe(false);
  });
});
