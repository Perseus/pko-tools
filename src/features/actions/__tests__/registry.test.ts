import { describe, expect, it } from "vitest";
import { ActionRegistry } from "@/features/actions/registry";
import type { ActionContext, AppAction } from "@/features/actions/types";

function createContext(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    route: "/effects",
    surface: "effects",
    isTyping: false,
    hasModalOpen: false,
    ...overrides,
  };
}

function createShortcutEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("ActionRegistry", () => {
  it("prefers surface-specific actions over global actions", () => {
    const actions: AppAction[] = [
      {
        id: "global.save",
        title: "Global Save",
        surfaces: ["global"],
        shortcuts: [{ key: "s", mod: true }],
      },
      {
        id: "effect.save",
        title: "Effect Save",
        surfaces: ["effects"],
        shortcuts: [{ key: "s", mod: true }],
      },
    ];

    const registry = new ActionRegistry(actions);
    const matches = registry.resolveShortcut(
      createShortcutEvent({ key: "s", ctrlKey: true }),
      createContext(),
    );

    expect(matches[0]?.id).toBe("effect.save");
  });

  it("does not match non-input-safe actions while typing", () => {
    const actions: AppAction[] = [
      {
        id: "effect.copy",
        title: "Copy Keyframe",
        surfaces: ["effects"],
        shortcuts: [{ key: "c", mod: true }],
      },
      {
        id: "global.copy",
        title: "Copy Allowed",
        surfaces: ["global"],
        shortcuts: [{ key: "c", mod: true }],
        allowInInput: true,
      },
    ];

    const registry = new ActionRegistry(actions);
    const matches = registry.resolveShortcut(
      createShortcutEvent({ key: "c", ctrlKey: true }),
      createContext({ isTyping: true }),
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("global.copy");
  });

  it("filters modal-unsafe actions when a dialog is open", () => {
    const actions: AppAction[] = [
      {
        id: "effect.gizmo.off",
        title: "Gizmo Off",
        surfaces: ["effects"],
        shortcuts: [{ key: "escape" }],
      },
      {
        id: "global.dismiss",
        title: "Dismiss",
        surfaces: ["global"],
        shortcuts: [{ key: "escape" }],
        allowWhenModalOpen: true,
      },
    ];

    const registry = new ActionRegistry(actions);
    const matches = registry.resolveShortcut(
      createShortcutEvent({ key: "Escape" }),
      createContext({ hasModalOpen: true }),
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("global.dismiss");
  });
});
