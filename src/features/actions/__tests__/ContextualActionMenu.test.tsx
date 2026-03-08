import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ActionKernelProvider,
  useRegisterActionRuntime,
} from "@/features/actions/ActionKernelProvider";
import { ContextualActionMenu } from "@/features/actions/ContextualActionMenu";
import { actionIds } from "@/features/actions/actionIds";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { useMemo } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

function RuntimeRegistration({
  actionId,
  onRun,
  enabled = true,
}: {
  actionId: string;
  onRun: () => void;
  enabled?: boolean;
}) {
  const runtime = useMemo(
    () => ({
      run: () => onRun(),
      isEnabled: () => enabled,
      disabledReason: () => (enabled ? undefined : "Disabled"),
    }),
    [enabled, onRun],
  );

  useRegisterActionRuntime(actionId, runtime);
  return null;
}

function renderHarness(params: {
  actionIds: string[];
  registrations: Array<{ actionId: string; onRun: () => void; enabled?: boolean }>;
}) {
  const { actionIds: ids, registrations } = params;
  return render(
    <MemoryRouter initialEntries={["/effects"]}>
      <SidebarProvider>
        <ActionKernelProvider>
          {registrations.map((registration) => (
            <RuntimeRegistration key={registration.actionId} {...registration} />
          ))}
          <ContextualActionMenu actionIds={ids}>
            <div data-testid="surface" className="h-[200px] w-[300px]" />
          </ContextualActionMenu>
        </ActionKernelProvider>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("ContextualActionMenu", () => {
  it("runs selected context action and closes menu", () => {
    const onRun = vi.fn();
    renderHarness({
      actionIds: [actionIds.effectSave],
      registrations: [{ actionId: actionIds.effectSave, onRun }],
    });

    fireEvent.contextMenu(screen.getByTestId("surface"), { clientX: 16, clientY: 16 });
    fireEvent.click(screen.getByRole("menuitem", { name: /save effect/i }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keyboard execution skips disabled actions", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderHarness({
      actionIds: [actionIds.effectUndo, actionIds.effectRedo],
      registrations: [
        { actionId: actionIds.effectUndo, onRun: onUndo, enabled: false },
        { actionId: actionIds.effectRedo, onRun: onRedo, enabled: true },
      ],
    });

    fireEvent.contextMenu(screen.getByTestId("surface"), { clientX: 20, clientY: 20 });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onUndo).toHaveBeenCalledTimes(0);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
