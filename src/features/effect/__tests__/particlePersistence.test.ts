import { describe, expect, it, vi, beforeEach } from "vitest";
import { createStore } from "jotai";
import { particleDataAtom, particleOriginalAtom } from "@/store/particle";
import { createParticleFixture } from "./fixtures";

// Mock tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Import after mock setup
const { saveParticles, loadParticles } = await import("@/commands/effect");

describe("particle persistence", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("saveParticles invokes the correct command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const particles = createParticleFixture();
    await saveParticles("project-1", "fire.eff", particles);
    expect(mockInvoke).toHaveBeenCalledWith("save_particles", {
      projectId: "project-1",
      effectName: "fire.eff",
      particles,
    });
  });

  it("loadParticles returns data when file exists", async () => {
    const particles = createParticleFixture();
    mockInvoke.mockResolvedValue(particles);
    const result = await loadParticles("project-1", "fire.eff");
    expect(result).toEqual(particles);
  });

  it("loadParticles returns null when no file exists", async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await loadParticles("project-1", "fire.eff");
    expect(result).toBeNull();
  });

  it("particleDataAtom can be set and read", () => {
    const store = createStore();
    const particles = createParticleFixture();
    expect(store.get(particleDataAtom)).toBeNull();

    store.set(particleDataAtom, particles);
    expect(store.get(particleDataAtom)).toEqual(particles);
  });

  it("particleOriginalAtom stores snapshot for discard", () => {
    const store = createStore();
    const original = createParticleFixture();
    store.set(particleOriginalAtom, original);

    // Modify the working copy
    const modified = createParticleFixture({ name: "modified" });
    store.set(particleDataAtom, modified);

    // Original should be unchanged
    expect(store.get(particleOriginalAtom)!.name).toBe("test-particles");
    expect(store.get(particleDataAtom)!.name).toBe("modified");
  });
});
