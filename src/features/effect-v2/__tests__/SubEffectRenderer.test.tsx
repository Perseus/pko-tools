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
  it("renders a mesh for RectPlane", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={baseSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("renders a mesh for cylinder sub-effects (useParam=1)", async () => {
    const cylinderSubEffect = {
      ...baseSubEffect,
      modelName: "Cylinder",
      useParam: 1,
      perFrameCylinder: [
        { segments: 8, height: 2, topRadius: 0.5, botRadius: 1 },
        { segments: 8, height: 2, topRadius: 0.5, botRadius: 1 },
      ],
    };
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={cylinderSubEffect} />
      </TestTimeWrapper>
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
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

  it("applies transform after advancing frames when rotaLoop is true", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TestTimeWrapper>
        <SubEffectRenderer subEffect={rotatingSubEffect} />
      </TestTimeWrapper>
    );

    // SubEffectRenderer renders a <mesh> directly — find it
    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
    const mesh = meshes[0];

    // Capture position before advancing
    const posBefore = mesh.instance.position.clone();

    // Advance 30 frames at 60fps
    await renderer.advanceFrames(30, 1 / 60);

    // After advancing, the mesh should have been transformed by applySubEffectFrame
    // (position, rotation, or scale should differ from initial state)
    const posAfter = mesh.instance.position.clone();
    const scaleAfter = mesh.instance.scale.clone();

    // At least one transform property should have changed
    const posChanged = !posBefore.equals(posAfter);
    const scaleChanged = scaleAfter.x !== 1 || scaleAfter.y !== 1 || scaleAfter.z !== 1;
    expect(posChanged || scaleChanged).toBe(true);
  });
});
