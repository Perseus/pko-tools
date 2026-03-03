import { shortcutMatchesEvent } from "@/features/actions/shortcut";
import type {
  ActionContext,
  ActionEnabledState,
  ActionSurface,
  AppAction,
} from "@/features/actions/types";

function actionHasSurface(action: AppAction, surface: ActionSurface): boolean {
  return action.surfaces.includes("global") || action.surfaces.includes(surface);
}

export function resolveActionEnabled(
  action: AppAction,
  context: ActionContext,
): ActionEnabledState {
  if (!action.isEnabled) {
    return { enabled: true };
  }

  const result = action.isEnabled(context);
  if (typeof result === "boolean") {
    return { enabled: result };
  }

  return result;
}

export class ActionRegistry {
  private readonly actions = new Map<string, AppAction>();

  constructor(initialActions: AppAction[]) {
    initialActions.forEach((action) => {
      this.register(action);
    });
  }

  register(action: AppAction): void {
    if (this.actions.has(action.id)) {
      throw new Error(`Duplicate action id: ${action.id}`);
    }
    this.actions.set(action.id, action);
  }

  get(actionId: string): AppAction | undefined {
    return this.actions.get(actionId);
  }

  list(): AppAction[] {
    return Array.from(this.actions.values());
  }

  resolveShortcut(event: KeyboardEvent, context: ActionContext): AppAction[] {
    const candidates = this.list().filter((action) => {
      if (!action.shortcuts || action.shortcuts.length === 0) {
        return false;
      }
      if (!actionHasSurface(action, context.surface)) {
        return false;
      }
      if (!action.shortcuts.some((shortcut) => shortcutMatchesEvent(event, shortcut))) {
        return false;
      }
      if (context.isTyping && !action.allowInInput) {
        return false;
      }
      if (context.hasModalOpen && !action.allowWhenModalOpen) {
        return false;
      }
      if (action.when && !action.when(context)) {
        return false;
      }
      return true;
    });

    return candidates.sort((a, b) => {
      const aSurfaceWeight = a.surfaces.includes(context.surface) ? 1 : 0;
      const bSurfaceWeight = b.surfaces.includes(context.surface) ? 1 : 0;
      if (aSurfaceWeight !== bSurfaceWeight) {
        return bSurfaceWeight - aSurfaceWeight;
      }

      const aPriority = a.priority ?? 0;
      const bPriority = b.priority ?? 0;
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      return a.title.localeCompare(b.title);
    });
  }

  resolveVisibleActions(context: ActionContext): AppAction[] {
    return this.list()
      .filter((action) => actionHasSurface(action, context.surface))
      .filter((action) => (action.when ? action.when(context) : true))
      .sort((a, b) => {
        const aPriority = a.priority ?? 0;
        const bPriority = b.priority ?? 0;
        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        return a.title.localeCompare(b.title);
      });
  }
}
