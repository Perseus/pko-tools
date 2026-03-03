export type ActionSurface =
  | "global"
  | "characters"
  | "effects"
  | "items"
  | "maps"
  | "buildings";

export type ActionSource = "shortcut" | "palette" | "toolbar" | "context-menu";

export type ShortcutDefinition = {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type ActionContext = {
  route: string;
  surface: ActionSurface;
  isTyping: boolean;
  hasModalOpen: boolean;
};

export type ActionEnabledState = {
  enabled: boolean;
  reason?: string;
};

export type AppAction = {
  id: string;
  title: string;
  description?: string;
  group?: string;
  keywords?: string[];
  surfaces: ActionSurface[];
  shortcuts?: ShortcutDefinition[];
  allowInInput?: boolean;
  allowWhenModalOpen?: boolean;
  priority?: number;
  when?: (context: ActionContext) => boolean;
  isEnabled?: (context: ActionContext) => ActionEnabledState | boolean;
  run?: (context: ActionContext & { source: ActionSource }) => void | Promise<void>;
};

export type ActionRuntimeHandler = {
  run: () => void | Promise<void>;
  isEnabled?: () => boolean;
  disabledReason?: () => string | undefined;
};

export type ResolvedAction = AppAction & {
  enabled: boolean;
  disabledReason?: string;
};
