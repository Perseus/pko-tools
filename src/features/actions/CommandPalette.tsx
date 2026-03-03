import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useActionKernel } from "@/features/actions";
import type { ResolvedAction, ShortcutDefinition } from "@/features/actions/types";
import { Command } from "cmdk";
import React, { useEffect, useMemo, useState } from "react";

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

  const actions = useMemo(() => getActionsForCurrentContext(), [getActionsForCurrentContext, isPaletteOpen]);
  const filteredActions = useMemo(
    () =>
      actions.filter((action) =>
        query.trim()
          ? actionSearchText(action).includes(query.trim().toLowerCase())
          : true
      ),
    [actions, query],
  );
  const groupedActions = useMemo(() => {
    const groups = new Map<string, ResolvedAction[]>();
    filteredActions.forEach((action) => {
      const key = action.group ?? "General";
      const entries = groups.get(key) ?? [];
      entries.push(action);
      groups.set(key, entries);
    });
    return Array.from(groups.entries());
  }, [filteredActions]);

  useEffect(() => {
    if (!isPaletteOpen) {
      return;
    }

    setQuery("");
  }, [isPaletteOpen]);

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
        <Command
          label="Command Palette"
          className="flex max-h-[460px] flex-col"
        >
          <div className="border-b border-border px-3 py-2">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Type an action or page name..."
              aria-label="command-palette-input"
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            <Command.Empty className="px-2 py-3 text-sm text-muted-foreground">
              No matching actions
            </Command.Empty>
            {groupedActions.map(([group, entries]) => (
              <Command.Group
                key={group}
                heading={group}
                className="mb-2 overflow-hidden text-xs text-muted-foreground"
              >
                {entries.map((action) => {
                  const shortcut = formatShortcut(action.shortcuts?.[0]);

                  return (
                    <Command.Item
                      key={action.id}
                      value={`${action.id} ${action.title}`}
                      keywords={[
                        action.description ?? "",
                        action.group ?? "",
                        ...(action.keywords ?? []),
                      ]}
                      disabled={!action.enabled}
                      onSelect={() => {
                        void executeAction(action);
                      }}
                      aria-label={`action-${action.id}`}
                      className="mt-1 flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-foreground outline-none transition data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
                    >
                      <div>
                        <div className="font-medium">{action.title}</div>
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
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
