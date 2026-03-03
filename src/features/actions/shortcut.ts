import type { ShortcutDefinition } from "@/features/actions/types";

function normalizeKey(key: string): string {
  if (key === " ") {
    return "space";
  }
  return key.toLowerCase();
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  return element.getAttribute("role") === "textbox";
}

export function shortcutMatchesEvent(
  event: KeyboardEvent,
  shortcut: ShortcutDefinition,
): boolean {
  if (shortcut.mod) {
    if (!(event.metaKey || event.ctrlKey)) {
      return false;
    }
  } else {
    if (event.metaKey !== Boolean(shortcut.meta)) {
      return false;
    }
    if (event.ctrlKey !== Boolean(shortcut.ctrl)) {
      return false;
    }
  }

  if (event.shiftKey !== Boolean(shortcut.shift)) {
    return false;
  }
  if (event.altKey !== Boolean(shortcut.alt)) {
    return false;
  }

  return normalizeKey(event.key) === normalizeKey(shortcut.key);
}
