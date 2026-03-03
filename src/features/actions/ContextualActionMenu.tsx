import { useOptionalActionKernel } from "@/features/actions";
import type { ResolvedAction } from "@/features/actions/types";
import { cn } from "@/lib/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";

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
  const menuRef = useRef<HTMLDivElement>(null);

  const actions = useMemo(() => {
    if (!actionKernel) {
      return [];
    }

    const visible = actionKernel.getActionsForCurrentContext();
    const lookup = new Map(visible.map((action) => [action.id, action]));

    return actionIds
      .map((id) => lookup.get(id))
      .filter((action): action is ResolvedAction => Boolean(action));
  }, [actionIds, actionKernel, position]);

  const menuPosition = useMemo(() => {
    if (!position) return null;
    return clampPosition(position, actions.length);
  }, [actions.length, position]);

  useEffect(() => {
    if (!position) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPosition(null);
      }
    };

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setPosition(null);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [position]);

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
        setPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      {menuPosition && actions.length > 0 && (
        <div
          ref={menuRef}
          className="fixed z-[120] w-[280px] rounded-lg border border-border bg-background/95 p-1 shadow-2xl backdrop-blur"
          style={{ left: menuPosition.x, top: menuPosition.y }}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={cn(
                "w-full rounded-md px-2 py-2 text-left text-sm transition",
                action.enabled
                  ? "hover:bg-accent"
                  : "cursor-not-allowed text-muted-foreground/70",
              )}
              onClick={() => {
                if (!action.enabled) {
                  return;
                }
                void actionKernel.runAction(action.id, "context-menu");
                setPosition(null);
              }}
              disabled={!action.enabled}
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
