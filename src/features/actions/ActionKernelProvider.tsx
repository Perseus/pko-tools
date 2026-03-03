import { useSidebar } from "@/components/ui/sidebar";
import { actionIds } from "@/features/actions/actionIds";
import { actionKernelEnabled, cmdkUiEnabled } from "@/features/actions/flags";
import { ActionRegistry, resolveActionEnabled } from "@/features/actions/registry";
import { isTextInputTarget } from "@/features/actions/shortcut";
import type {
  ActionContext,
  ActionRuntimeHandler,
  ActionSource,
  ActionSurface,
  AppAction,
  ResolvedAction,
} from "@/features/actions/types";
import { compositePreviewAtom } from "@/store/effect";
import { gizmoModeAtom } from "@/store/gizmo";
import { useAtom } from "jotai";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";

type ActionKernelApi = {
  context: ActionContext;
  isPaletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  runAction: (actionId: string, source?: ActionSource) => Promise<boolean>;
  registerRuntime: (actionId: string, runtime: ActionRuntimeHandler) => () => void;
  getActionsForCurrentContext: () => ResolvedAction[];
};

const ActionKernelContext = createContext<ActionKernelApi | null>(null);

function hasOpenDialog(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

function resolveSurface(pathname: string): ActionSurface {
  if (pathname.startsWith("/characters")) return "characters";
  if (pathname.startsWith("/effects")) return "effects";
  if (pathname.startsWith("/items")) return "items";
  if (pathname.startsWith("/maps")) return "maps";
  if (pathname.startsWith("/buildings")) return "buildings";
  return "global";
}

function buildCoreActions(params: {
  navigate: ReturnType<typeof useNavigate>;
  toggleSidebar: () => void;
  setGizmoMode: (mode: "translate" | "rotate" | "scale" | "off") => void;
  toggleCompositePreview: () => void;
  openPalette: () => void;
  cmdkEnabled: boolean;
}): AppAction[] {
  const {
    navigate,
    toggleSidebar,
    setGizmoMode,
    toggleCompositePreview,
    openPalette,
    cmdkEnabled,
  } = params;

  return [
    {
      id: actionIds.commandPaletteOpen,
      title: "Open Command Palette",
      group: "Global",
      surfaces: ["global", "characters", "effects", "items", "maps", "buildings"],
      shortcuts: [{ key: "k", mod: true }],
      allowWhenModalOpen: true,
      allowInInput: true,
      run: () => {
        openPalette();
      },
      isEnabled: () => ({
        enabled: cmdkEnabled,
        reason: cmdkEnabled ? undefined : "Cmd+K UI disabled by flag",
      }),
      priority: 100,
    },
    {
      id: actionIds.appSidebarToggle,
      title: "Toggle Sidebar",
      group: "Layout",
      surfaces: ["global", "characters", "effects", "items", "maps", "buildings"],
      shortcuts: [{ key: "b", mod: true }],
      allowWhenModalOpen: true,
      allowInInput: true,
      run: () => {
        toggleSidebar();
      },
      priority: 90,
    },
    {
      id: actionIds.navCharacters,
      title: "Go to Characters",
      group: "Navigation",
      surfaces: ["global", "characters", "effects", "items", "maps", "buildings"],
      run: () => {
        navigate("/characters");
      },
      keywords: ["route", "models", "characters"],
    },
    {
      id: actionIds.navEffects,
      title: "Go to Effects",
      group: "Navigation",
      surfaces: ["global", "characters", "effects", "items", "maps", "buildings"],
      run: () => {
        navigate("/effects");
      },
      keywords: ["route", "effects", "eff"],
    },
    {
      id: actionIds.navItems,
      title: "Go to Items",
      group: "Navigation",
      surfaces: ["global", "characters", "effects", "items", "maps", "buildings"],
      run: () => {
        navigate("/items");
      },
      keywords: ["route", "items"],
    },
    {
      id: actionIds.navMaps,
      title: "Go to Maps",
      group: "Navigation",
      surfaces: ["global", "characters", "effects", "items", "maps", "buildings"],
      run: () => {
        navigate("/maps");
      },
      keywords: ["route", "maps", "terrain"],
    },
    {
      id: actionIds.navBuildings,
      title: "Go to Buildings",
      group: "Navigation",
      surfaces: ["global", "characters", "effects", "items", "maps", "buildings"],
      run: () => {
        navigate("/buildings");
      },
      keywords: ["route", "buildings"],
    },
    {
      id: actionIds.characterExportGltf,
      title: "Export Character to glTF",
      group: "Character",
      surfaces: ["characters"],
      keywords: ["character", "export", "gltf"],
      priority: 60,
    },
    {
      id: actionIds.characterImportGltf,
      title: "Import Character from glTF",
      group: "Character",
      surfaces: ["characters"],
      keywords: ["character", "import", "gltf"],
      priority: 60,
    },
    {
      id: actionIds.itemExportGltf,
      title: "Export Item to glTF",
      group: "Item",
      surfaces: ["items"],
      keywords: ["item", "export", "gltf"],
      priority: 60,
    },
    {
      id: actionIds.itemImportGltf,
      title: "Import Item from glTF",
      group: "Item",
      surfaces: ["items"],
      keywords: ["item", "import", "gltf"],
      priority: 60,
    },
    {
      id: actionIds.itemWorkbenchSave,
      title: "Save Item Workbench",
      group: "Item",
      surfaces: ["items"],
      shortcuts: [{ key: "s", mod: true }],
      keywords: ["item", "workbench", "save"],
      priority: 80,
    },
    {
      id: actionIds.mapExportGltf,
      title: "Export Map to glTF",
      group: "Map",
      surfaces: ["maps"],
      keywords: ["map", "export", "gltf"],
      priority: 60,
    },
    {
      id: actionIds.mapExportUnity,
      title: "Export Map for Unity",
      group: "Map",
      surfaces: ["maps"],
      keywords: ["map", "export", "unity"],
      priority: 60,
    },
    {
      id: actionIds.mapToggleObjectMarkers,
      title: "Toggle Object Markers",
      group: "Map View",
      surfaces: ["maps"],
      shortcuts: [{ key: "o" }],
      keywords: ["map", "objects", "markers"],
      priority: 45,
    },
    {
      id: actionIds.mapToggleWireframe,
      title: "Toggle Wireframe",
      group: "Map View",
      surfaces: ["maps"],
      shortcuts: [{ key: "w" }],
      keywords: ["map", "wireframe"],
      priority: 45,
    },
    {
      id: actionIds.buildingExportGltf,
      title: "Export Building to glTF",
      group: "Building",
      surfaces: ["buildings"],
      keywords: ["building", "export", "gltf"],
      priority: 60,
    },
    {
      id: actionIds.effectSave,
      title: "Save Effect",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "s", mod: true }],
      priority: 80,
    },
    {
      id: actionIds.effectUndo,
      title: "Undo",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "z", mod: true }],
      priority: 80,
    },
    {
      id: actionIds.effectRedo,
      title: "Redo",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "z", mod: true, shift: true }],
      priority: 80,
    },
    {
      id: actionIds.effectGizmoTranslate,
      title: "Gizmo: Translate",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "t" }],
      run: () => {
        setGizmoMode("translate");
      },
      priority: 40,
    },
    {
      id: actionIds.effectGizmoRotate,
      title: "Gizmo: Rotate",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "r" }],
      run: () => {
        setGizmoMode("rotate");
      },
      priority: 40,
    },
    {
      id: actionIds.effectGizmoScale,
      title: "Gizmo: Scale",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "s" }],
      run: () => {
        setGizmoMode("scale");
      },
      priority: 40,
    },
    {
      id: actionIds.effectGizmoOff,
      title: "Gizmo: Off",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "escape" }],
      run: () => {
        setGizmoMode("off");
      },
      allowWhenModalOpen: true,
      priority: 40,
    },
    {
      id: actionIds.effectToggleCompositePreview,
      title: "Toggle Composite Preview",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "c" }],
      run: () => {
        toggleCompositePreview();
      },
      priority: 40,
    },
    {
      id: actionIds.effectKeyframeCopy,
      title: "Copy Keyframe",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "c", mod: true }],
      priority: 70,
    },
    {
      id: actionIds.effectKeyframePaste,
      title: "Paste Keyframe",
      group: "Effect",
      surfaces: ["effects"],
      shortcuts: [{ key: "v", mod: true }],
      priority: 70,
    },
  ];
}

export function ActionKernelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const [, setGizmoMode] = useAtom(gizmoModeAtom);
  const [, setCompositePreview] = useAtom(compositePreviewAtom);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const runtimeHandlersRef = useRef<Map<string, ActionRuntimeHandler>>(new Map());

  const surface = useMemo(() => resolveSurface(location.pathname), [location.pathname]);

  const context = useMemo<ActionContext>(() => {
    return {
      route: location.pathname,
      surface,
      hasModalOpen: hasOpenDialog(),
      isTyping: false,
    };
  }, [location.pathname, surface]);

  const actions = useMemo(
    () =>
      buildCoreActions({
        navigate,
        toggleSidebar,
        setGizmoMode,
        toggleCompositePreview: () => setCompositePreview((prev) => !prev),
        openPalette: () => setPaletteOpen(true),
        cmdkEnabled: cmdkUiEnabled,
      }),
    [navigate, toggleSidebar, setGizmoMode, setCompositePreview],
  );

  const registry = useMemo(() => new ActionRegistry(actions), [actions]);

  const createEventContext = useCallback(
    (target: EventTarget | null): ActionContext => ({
      route: location.pathname,
      surface,
      hasModalOpen: hasOpenDialog(),
      isTyping: isTextInputTarget(target),
    }),
    [location.pathname, surface],
  );

  const canRunAction = useCallback(
    (action: AppAction, actionContext: ActionContext, source: ActionSource): boolean => {
      if (
        !action.surfaces.includes("global") &&
        !action.surfaces.includes(actionContext.surface)
      ) {
        return false;
      }
      const enforceKeyboardGuards = source === "shortcut";
      if (enforceKeyboardGuards && actionContext.isTyping && !action.allowInInput) {
        return false;
      }
      if (enforceKeyboardGuards && actionContext.hasModalOpen && !action.allowWhenModalOpen) {
        return false;
      }
      if (action.when && !action.when(actionContext)) {
        return false;
      }

      const enabled = resolveActionEnabled(action, actionContext);
      if (!enabled.enabled) {
        return false;
      }

      const runtime = runtimeHandlersRef.current.get(action.id);
      if (runtime?.isEnabled && !runtime.isEnabled()) {
        return false;
      }

      return Boolean(runtime?.run || action.run);
    },
    [],
  );

  const runAction = useCallback(
    async (actionId: string, source: ActionSource = "shortcut"): Promise<boolean> => {
      const action = registry.get(actionId);
      if (!action) {
        return false;
      }

      const actionContext = createEventContext(document.activeElement);
      if (!canRunAction(action, actionContext, source)) {
        return false;
      }

      const runtime = runtimeHandlersRef.current.get(actionId);
      if (runtime?.run) {
        await runtime.run();
        return true;
      }

      if (action.run) {
        await action.run({ ...actionContext, source });
        return true;
      }

      return false;
    },
    [canRunAction, createEventContext, registry],
  );

  const registerRuntime = useCallback(
    (actionId: string, runtime: ActionRuntimeHandler): (() => void) => {
      runtimeHandlersRef.current.set(actionId, runtime);
      return () => {
        const current = runtimeHandlersRef.current.get(actionId);
        if (current === runtime) {
          runtimeHandlersRef.current.delete(actionId);
        }
      };
    },
    [],
  );

  const getActionsForCurrentContext = useCallback((): ResolvedAction[] => {
    const actionContext = createEventContext(document.activeElement);

    return registry.resolveVisibleActions(actionContext).map((action) => {
      const descriptorState = resolveActionEnabled(action, actionContext);
      const runtime = runtimeHandlersRef.current.get(action.id);
      const runtimeEnabled = runtime?.isEnabled ? runtime.isEnabled() : true;
      const runtimeReason = runtime?.disabledReason ? runtime.disabledReason() : undefined;

      return {
        ...action,
        enabled: descriptorState.enabled && runtimeEnabled,
        disabledReason: runtimeReason ?? descriptorState.reason,
      };
    });
  }, [createEventContext, registry]);

  useEffect(() => {
    if (!actionKernelEnabled) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const actionContext = createEventContext(event.target);
      const candidates = registry.resolveShortcut(event, actionContext);
      const matched = candidates.find((candidate) =>
        canRunAction(candidate, actionContext, "shortcut")
      );
      if (!matched) {
        return;
      }

      event.preventDefault();
      void runAction(matched.id, "shortcut");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canRunAction, createEventContext, registry, runAction]);

  const value = useMemo<ActionKernelApi>(
    () => ({
      context,
      isPaletteOpen,
      setPaletteOpen,
      runAction,
      registerRuntime,
      getActionsForCurrentContext,
    }),
    [context, getActionsForCurrentContext, isPaletteOpen, registerRuntime, runAction],
  );

  return (
    <ActionKernelContext.Provider value={value}>
      {children}
    </ActionKernelContext.Provider>
  );
}

export function useActionKernel(): ActionKernelApi {
  const context = useOptionalActionKernel();
  if (!context) {
    throw new Error("useActionKernel must be used inside ActionKernelProvider");
  }

  return context;
}

export function useOptionalActionKernel(): ActionKernelApi | null {
  return useContext(ActionKernelContext);
}

export function useRegisterActionRuntime(
  actionId: string,
  runtime: ActionRuntimeHandler,
): void {
  const kernel = useOptionalActionKernel();

  useEffect(() => {
    if (!kernel) {
      return;
    }
    return kernel.registerRuntime(actionId, runtime);
  }, [actionId, kernel, runtime]);
}
