import { SidebarProvider } from "@/components/ui/sidebar";
import {
  ActionKernelProvider,
  useActionKernel,
  useRegisterActionRuntime,
} from "@/features/actions/ActionKernelProvider";
import { actionIds } from "@/features/actions/actionIds";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { useMemo } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

function ActionRuntimeHarness({
  actionId,
  onRun,
}: {
  actionId: string;
  onRun: () => void;
}) {
  const { runAction } = useActionKernel();

  const runtime = useMemo(
    () => ({
      run: () => onRun(),
      isEnabled: () => true,
    }),
    [onRun],
  );

  useRegisterActionRuntime(actionId, runtime);

  return (
    <div>
      <button
        type="button"
        aria-label="run-palette"
        onClick={() => {
          void runAction(actionId, "palette");
        }}
      />
      <button
        type="button"
        aria-label="run-toolbar"
        onClick={() => {
          void runAction(actionId, "toolbar");
        }}
      />
      <button
        type="button"
        aria-label="run-context-menu"
        onClick={() => {
          void runAction(actionId, "context-menu");
        }}
      />
    </div>
  );
}

function renderHarness(route: string, actionId: string, onRun: () => void) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SidebarProvider>
        <ActionKernelProvider>
          <ActionRuntimeHarness actionId={actionId} onRun={onRun} />
        </ActionKernelProvider>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("action source parity", () => {
  it("runs effect save from palette/toolbar/context-menu/shortcut on effects surface", () => {
    const onRun = vi.fn();
    renderHarness("/effects", actionIds.effectSave, onRun);

    fireEvent.click(screen.getByLabelText("run-palette"));
    fireEvent.click(screen.getByLabelText("run-toolbar"));
    fireEvent.click(screen.getByLabelText("run-context-menu"));
    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });

    expect(onRun).toHaveBeenCalledTimes(4);
  });

  it("runs map marker toggle from every source on maps surface", () => {
    const onRun = vi.fn();
    renderHarness("/maps", actionIds.mapToggleObjectMarkers, onRun);

    fireEvent.click(screen.getByLabelText("run-palette"));
    fireEvent.click(screen.getByLabelText("run-toolbar"));
    fireEvent.click(screen.getByLabelText("run-context-menu"));
    fireEvent.keyDown(document.body, { key: "o" });

    expect(onRun).toHaveBeenCalledTimes(4);
  });

  it("does not run shortcuts for actions outside the current surface", () => {
    const onRun = vi.fn();
    renderHarness("/maps", actionIds.effectSave, onRun);

    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
    expect(onRun).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByLabelText("run-palette"));
    expect(onRun).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["/characters", actionIds.characterImportGltf],
    ["/items", actionIds.itemImportGltf],
    ["/buildings", actionIds.buildingExportGltf],
  ])(
    "runs non-shortcut action %s from palette/toolbar/context-menu",
    (route, actionId) => {
      const onRun = vi.fn();
      renderHarness(route, actionId, onRun);

      fireEvent.click(screen.getByLabelText("run-palette"));
      fireEvent.click(screen.getByLabelText("run-toolbar"));
      fireEvent.click(screen.getByLabelText("run-context-menu"));

      expect(onRun).toHaveBeenCalledTimes(3);
    },
  );
});
