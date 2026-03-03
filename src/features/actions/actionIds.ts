export const actionIds = {
  appSidebarToggle: "app.sidebar.toggle",
  navCharacters: "nav.characters",
  navEffects: "nav.effects",
  navItems: "nav.items",
  navMaps: "nav.maps",
  navBuildings: "nav.buildings",
  effectSave: "effect.save",
  effectUndo: "effect.undo",
  effectRedo: "effect.redo",
  effectGizmoTranslate: "effect.gizmo.translate",
  effectGizmoRotate: "effect.gizmo.rotate",
  effectGizmoScale: "effect.gizmo.scale",
  effectGizmoOff: "effect.gizmo.off",
  effectToggleCompositePreview: "effect.preview.toggleComposite",
  effectKeyframeCopy: "effect.keyframe.copy",
  effectKeyframePaste: "effect.keyframe.paste",
  commandPaletteOpen: "app.palette.open",
} as const;

export type ActionId = (typeof actionIds)[keyof typeof actionIds];
