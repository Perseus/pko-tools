import { describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { SubEffectRenderer } from "../renderers/SubEffectRenderer";
import { baseSubEffect, rotatingSubEffect } from "./fixtures";

// Mock the texture hook — no Tauri backend in tests
vi.mock("../useEffectTexture", () => ({
  useEffectTexture: () => null,
}));

// Mock jotai atoms
vi.mock("jotai", async () => {
  const actual = await vi.importActual("jotai");
  return {
    ...actual,
    useAtomValue: () => ({ playing: true, loop: true, time: 0.5, fps: 0 }),
  };
});

describe("SubEffectRenderer", () => {
  it("renders a group with a mesh for RectPlane", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <SubEffectRenderer subEffect={baseSubEffect} />
    );

    const groups = renderer.scene.findAll((node) => node.type === "Group");
    expect(groups.length).toBeGreaterThan(0);

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("returns null for cylinder sub-effects (not yet implemented)", async () => {
    const cylinderSubEffect = { ...baseSubEffect, useParam: 1 };
    const renderer = await ReactThreeTestRenderer.create(
      <SubEffectRenderer subEffect={cylinderSubEffect} />
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(0);
  });

  it("returns null for external .lgo models (not yet implemented)", async () => {
    const lgoSubEffect = { ...baseSubEffect, modelName: "weapon.lgo" };
    const renderer = await ReactThreeTestRenderer.create(
      <SubEffectRenderer subEffect={lgoSubEffect} />
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(0);
  });

  it("renders when sub-effect has texName but no modelName", async () => {
    const texOnlySubEffect = { ...baseSubEffect, modelName: "" };
    const renderer = await ReactThreeTestRenderer.create(
      <SubEffectRenderer subEffect={texOnlySubEffect} />
    );

    const meshes = renderer.scene.findAll((node) => node.type === "Mesh");
    expect(meshes.length).toBe(1);
  });

  it("applies rotation after advancing frames when rotaLoop is true", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <SubEffectRenderer subEffect={rotatingSubEffect} />
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
