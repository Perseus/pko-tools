import { useOptionalActionKernel } from "@/features/actions";
import type { ResolvedAction } from "@/features/actions/types";
import { cn } from "@/lib/utils";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MenuPosition = { x: number; y: number };

function clampPosition(position: MenuPosition, itemCount: number): MenuPosition {
  const width = 280;
  const height = Math.min(itemCount * 44 + 12, 360);
  const maxX = Math.max(window.innerWidth - width - 8, 8);
  const maxY = Math.max(window.innerHeight - height - 8, 8);

  return {
    x: Math.min(Math.max(position.x, 8), maxX),
    y: Math.min(Math.max(position.y, 8), maxY),
  };
}

function getFirstEnabledIndex(actions: ResolvedAction[]): number {
  const firstEnabled = actions.findIndex((action) => action.enabled);
  return firstEnabled >= 0 ? firstEnabled : 0;
}

function getNextEnabledIndex(
  actions: ResolvedAction[],
  current: number,
  direction: 1 | -1,
): number {
  if (actions.length === 0) {
    return -1;
  }

  let next = current;
  for (let step = 0; step < actions.length; step++) {
    next = (next + direction + actions.length) % actions.length;
    if (actions[next]?.enabled) {
      return next;
    }
  }

  return current;
}

export function ContextualActionMenu({
  actionIds,
  children,
  className,
  requireShiftKey = false,
}: {
  actionIds: string[];
  children: React.ReactNode;
  className?: string;
  requireShiftKey?: boolean;
}) {
  const actionKernel = useOptionalActionKernel();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isOpen = position !== null;

  const closeMenu = useCallback(() => {
    setPosition(null);
    setHighlightedIndex(0);
  }, []);

  const openMenu = useCallback((nextPosition: MenuPosition) => {
    setPosition(nextPosition);
  }, []);

  const actions = useMemo(() => {
    if (!actionKernel) {
      return [];
    }

    const visible = actionKernel.getActionsForCurrentContext();
    const lookup = new Map(visible.map((action) => [action.id, action]));

    const resolved = actionIds
      .map((id) => lookup.get(id))
      .filter((action): action is ResolvedAction => Boolean(action));

    itemRefs.current = itemRefs.current.slice(0, resolved.length);
    return resolved;
  }, [actionIds, actionKernel, position]);

  const menuPosition = useMemo(() => {
    if (!position) return null;
    return clampPosition(position, actions.length);
  }, [actions.length, position]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setHighlightedIndex(getFirstEnabledIndex(actions));
  }, [actions, isOpen]);

  useEffect(() => {
    if (!isOpen || actions.length === 0) {
      return;
    }

    const next = itemRefs.current[highlightedIndex];
    if (!next || !actions[highlightedIndex]?.enabled) {
      return;
    }

    next.focus();
  }, [actions, highlightedIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const runHighlightedAction = () => {
      const action = actions[highlightedIndex];
      if (!action || !action.enabled) {
        return;
      }
      void actionKernel?.runAction(action.id, "context-menu");
      closeMenu();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) => getNextEnabledIndex(actions, prev, 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => getNextEnabledIndex(actions, prev, -1));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setHighlightedIndex(getFirstEnabledIndex(actions));
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        const lastEnabled = [...actions].reverse().findIndex((action) => action.enabled);
        if (lastEnabled === -1) {
          return;
        }
        setHighlightedIndex(actions.length - 1 - lastEnabled);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        runHighlightedAction();
      }
    };

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      closeMenu();
    };

    const onResize = () => {
      setPosition((prev) => {
        if (!prev) {
          return prev;
        }
        return clampPosition(prev, actions.length);
      });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", onResize);
    };
  }, [actionKernel, actions, closeMenu, highlightedIndex, isOpen]);

  if (!actionKernel) {
    return <div className={cn("h-full w-full", className)}>{children}</div>;
  }

  return (
    <div
      className={cn("h-full w-full", className)}
      onContextMenu={(event) => {
        if (requireShiftKey && !event.shiftKey) {
          return;
        }

        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
          openMenu({
            x: bounds.left + Math.min(bounds.width * 0.5, 320),
            y: bounds.top + Math.min(bounds.height * 0.5, 240),
          });
        }
      }}
      tabIndex={0}
    >
      {children}
      {menuPosition && actions.length > 0 && (
        <div
          ref={menuRef}
          className="fixed z-[120] w-[280px] rounded-lg border border-border bg-background/95 p-1 shadow-2xl backdrop-blur"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          role="menu"
          aria-label="Context actions"
        >
          {actions.map((action, index) => (
            <button
              key={action.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              className={cn(
                "w-full rounded-md px-2 py-2 text-left text-sm transition focus-visible:outline-none",
                action.enabled
                  ? "hover:bg-accent"
                  : "cursor-not-allowed text-muted-foreground/70",
                highlightedIndex === index && action.enabled
                  ? "bg-accent"
                  : undefined,
              )}
              onClick={() => {
                if (!action.enabled) {
                  return;
                }
                void actionKernel.runAction(action.id, "context-menu");
                closeMenu();
              }}
              onMouseEnter={() => {
                setHighlightedIndex(index);
              }}
              disabled={!action.enabled}
              role="menuitem"
              aria-disabled={!action.enabled}
            >
              <div className="font-medium">{action.title}</div>
              {(action.group || action.disabledReason) && (
                <div className="text-xs text-muted-foreground">
                  {action.group}
                  {action.disabledReason ? ` - ${action.disabledReason}` : ""}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
