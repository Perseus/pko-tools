import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActionKernel } from "@/features/actions";
import type { ResolvedAction, ShortcutDefinition } from "@/features/actions/types";
import { cn } from "@/lib/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";

const MAX_RESULTS = 40;

function formatShortcut(shortcut?: ShortcutDefinition): string {
  if (!shortcut) {
    return "";
  }

  const parts: string[] = [];
  if (shortcut.mod) parts.push("Cmd/Ctrl");
  else {
    if (shortcut.meta) parts.push("Cmd");
    if (shortcut.ctrl) parts.push("Ctrl");
  }
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.alt) parts.push("Alt");

  const key = shortcut.key === " " ? "Space" : shortcut.key.length === 1
    ? shortcut.key.toUpperCase()
    : shortcut.key[0].toUpperCase() + shortcut.key.slice(1);
  parts.push(key);

  return parts.join("+");
}

function actionSearchText(action: ResolvedAction): string {
  return [
    action.title,
    action.description,
    action.group,
    ...(action.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function CommandPalette() {
  const { isPaletteOpen, setPaletteOpen, getActionsForCurrentContext, runAction } = useActionKernel();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo(() => getActionsForCurrentContext(), [getActionsForCurrentContext, isPaletteOpen]);
  const filteredActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const base = normalized
      ? actions.filter((action) => actionSearchText(action).includes(normalized))
      : actions;
    return base.slice(0, MAX_RESULTS);
  }, [actions, query]);

  useEffect(() => {
    if (!isPaletteOpen) {
      return;
    }

    setQuery("");
    setSelectedIndex(0);
    const handle = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(handle);
    };
  }, [isPaletteOpen]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(filteredActions.length - 1, 0)));
  }, [filteredActions.length]);

  const executeAction = async (action: ResolvedAction) => {
    if (!action.enabled) {
      return;
    }

    const ran = await runAction(action.id, "palette");
    if (ran) {
      setPaletteOpen(false);
    }
  };

  return (
    <Dialog open={isPaletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <div className="border-b border-border p-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((idx) => Math.min(idx + 1, Math.max(filteredActions.length - 1, 0)));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((idx) => Math.max(idx - 1, 0));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const selected = filteredActions[selectedIndex];
                if (selected) {
                  void executeAction(selected);
                }
              }
            }}
            placeholder="Type an action or page name..."
            aria-label="command-palette-input"
          />
        </div>
        <ScrollArea className="max-h-[420px]">
          <div className="p-2">
            {filteredActions.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">No matching actions</div>
            ) : (
              filteredActions.map((action, index) => {
                const shortcut = formatShortcut(action.shortcuts?.[0]);
                const selected = index === selectedIndex;

                return (
                  <button
                    type="button"
                    key={action.id}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-2 text-left transition",
                      selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                      !action.enabled && "opacity-60",
                    )}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => {
                      void executeAction(action);
                    }}
                    disabled={!action.enabled}
                    aria-label={`action-${action.id}`}
                  >
                    <div>
                      <div className="text-sm font-medium">{action.title}</div>
                      {(action.group || action.disabledReason) && (
                        <div className="text-xs text-muted-foreground">
                          {action.group}
                          {action.disabledReason ? ` - ${action.disabledReason}` : ""}
                        </div>
                      )}
                    </div>
                    {shortcut && (
                      <div className="text-[10px] text-muted-foreground">{shortcut}</div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
