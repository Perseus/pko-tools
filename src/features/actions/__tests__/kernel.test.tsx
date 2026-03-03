import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ActionKernelProvider,
  CommandPalette,
  actionIds,
  useActionKernel,
  useRegisterActionRuntime,
} from "@/features/actions";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useMemo } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

function ensureMatchMedia() {
  if (typeof window.matchMedia === "function") {
    return;
  }

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function RuntimeHarness({
  onEffectSave,
  onGizmoTranslate,
}: {
  onEffectSave: () => void;
  onGizmoTranslate: () => void;
}) {
  const saveRuntime = useMemo(
    () => ({
      run: () => onEffectSave(),
      isEnabled: () => true,
    }),
    [onEffectSave],
  );
  const gizmoRuntime = useMemo(
    () => ({
      run: () => onGizmoTranslate(),
      isEnabled: () => true,
    }),
    [onGizmoTranslate],
  );

  useRegisterActionRuntime(actionIds.effectSave, saveRuntime);
  useRegisterActionRuntime(actionIds.effectGizmoTranslate, gizmoRuntime);

  return <input aria-label="typing-input" />;
}

function RecencyProbe() {
  const { getActionsForCurrentContext, runAction } = useActionKernel();
  const filtered = getActionsForCurrentContext()
    .filter((action) =>
      action.id === actionIds.effectSave ||
      action.id === actionIds.effectGizmoTranslate
    )
    .map((action) => action.id)
    .join(",");

  return (
    <div>
      <div aria-label="recency-order">{filtered}</div>
      <button
        type="button"
        aria-label="run-translate-action"
        onClick={() => {
          void runAction(actionIds.effectGizmoTranslate, "palette");
        }}
      />
    </div>
  );
}

function renderKernel(onEffectSave: () => void, onGizmoTranslate: () => void) {
  return render(
    <MemoryRouter initialEntries={["/effects"]}>
      <SidebarProvider>
        <ActionKernelProvider>
          <RuntimeHarness
            onEffectSave={onEffectSave}
            onGizmoTranslate={onGizmoTranslate}
          />
          <CommandPalette />
        </ActionKernelProvider>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("ActionKernelProvider keyboard behavior", () => {
  beforeEach(() => {
    ensureMatchMedia();
    if (typeof window.localStorage?.setItem === "function") {
      window.localStorage.setItem("pko-tools/recent-actions/v1", "[]");
    }
  });

  it("does not run non-input-safe shortcuts while typing", () => {
    const onEffectSave = vi.fn();
    const onGizmoTranslate = vi.fn();
    renderKernel(onEffectSave, onGizmoTranslate);

    const input = screen.getByLabelText("typing-input");
    input.focus();
    fireEvent.keyDown(input, { key: "s", ctrlKey: true });
    expect(onEffectSave).not.toHaveBeenCalled();

    input.blur();
    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
    expect(onEffectSave).toHaveBeenCalledTimes(1);
  });

  it("opens cmdk palette even when focus is in an input", async () => {
    const onEffectSave = vi.fn();
    const onGizmoTranslate = vi.fn();
    renderKernel(onEffectSave, onGizmoTranslate);

    const input = screen.getByLabelText("typing-input");
    input.focus();
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });

    expect(await screen.findByLabelText("command-palette-input")).toBeInTheDocument();
  });

  it("blocks modal-unsafe shortcuts while a dialog is open", async () => {
    const onEffectSave = vi.fn();
    const onGizmoTranslate = vi.fn();
    renderKernel(onEffectSave, onGizmoTranslate);

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(await screen.findByLabelText("command-palette-input")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "t" });
    expect(onGizmoTranslate).not.toHaveBeenCalled();
  });

  it("prioritizes recently executed actions in visible ordering", async () => {
    const onEffectSave = vi.fn();
    const onGizmoTranslate = vi.fn();

    render(
      <MemoryRouter initialEntries={["/effects"]}>
        <SidebarProvider>
          <ActionKernelProvider>
            <RuntimeHarness
              onEffectSave={onEffectSave}
              onGizmoTranslate={onGizmoTranslate}
            />
            <RecencyProbe />
          </ActionKernelProvider>
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("recency-order").textContent).toBe(
      `${actionIds.effectSave},${actionIds.effectGizmoTranslate}`,
    );

    fireEvent.click(screen.getByLabelText("run-translate-action"));

    await waitFor(() => {
      expect(screen.getByLabelText("recency-order").textContent).toBe(
        `${actionIds.effectGizmoTranslate},${actionIds.effectSave}`,
      );
    });
    expect(onGizmoTranslate).toHaveBeenCalledTimes(1);
  });
});
