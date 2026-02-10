export type Item = {
  id: number;
  name: string;
  icon_name: string;
  model_ground: string;
  model_lance: string;
  model_carsise: string;
  model_phyllis: string;
  model_ami: string;
  item_type: number;
  display_effect: string;
  bind_effect: string;
  bind_effect_2: string;
  description: string;
};

export type ItemMetadata = {
  item_id: number;
  item_name: string;
  item_type: number;
  model_id: string;
  vertex_count: number;
  triangle_count: number;
  material_count: number;
  dummy_count: number;
  bounding_spheres: number;
  bounding_boxes: number;
  available_models: string[];
};

export type ItemLitEntry = {
  id: number;
  file: string;
  anim_type: number;
  transp_type: number;
  opacity: number;
};

export type ItemLitInfo = {
  item_id: number;
  descriptor: string;
  file: string;
  lits: ItemLitEntry[];
};

export type RefineEffectEntry = {
  light_id: number;
  effect_ids: number[];
  dummy_ids: number[];
};

export type RefineEffectTable = {
  entries: RefineEffectEntry[];
};

export type ParticleEffectInfo = {
  par_file: string;
  dummy_id: number;
  scale: number;
  effect_id: number;
};

export type ForgeEffectPreview = {
  lit_id: number | null;
  lit_entry: ItemLitEntry | null;
  particles: ParticleEffectInfo[];
  effect_level: number;
  alpha: number;
};

export const ITEM_TYPE_NAMES: Record<number, string> = {
  1: "Sword (1H)",
  2: "Sword (2H)",
  3: "Bow",
  4: "Gun",
  5: "Knife/Dagger",
  6: "Shield",
  7: "Staff",
  8: "Axe",
  14: "Boxing Glove",
  15: "Claw",
  21: "Necklace",
  22: "Ring",
  23: "Armor",
  24: "Boots",
  25: "Gloves",
  26: "Voucher",
  27: "Hat",
  28: "Cape",
  29: "Earring",
  30: "Consumable",
  31: "Container",
  40: "Ship",
  41: "Ship Cannon",
  42: "Ship Engine",
  43: "Ship Flag",
  44: "Ship Sail",
  45: "Ship Figurehead",
  46: "Ship Hull",
};

export type CategorySummary = {
  category: number;
  available: boolean;
  lit_id: number;
  has_particles: boolean;
};

export type ItemCategoryAvailability = {
  item_id: number;
  categories: CategorySummary[];
};

export const LIT_COLOR_NAMES: Record<number, string> = {
  0: "None",
  1: "Red",
  2: "Blue",
  3: "Yellow",
  4: "Green",
};

export const ANIM_TYPE_NAMES: Record<number, string> = {
  0: "Static",
  1: "Z-Rotation",
  3: "U-Scroll",
  4: "V-Scroll",
  5: "UV-Scroll",
  6: "Rotate+V",
  7: "Rotate+U",
  8: "Fast Z-Rotation",
};

export const BLEND_MODE_NAMES: Record<number, string> = {
  0: "Normal",
  1: "Additive",
  2: "Src Color+One",
  3: "Soft Blend",
  4: "Alpha Blend",
  5: "Subtractive",
};

export type ModelVariant = "ground" | "lance" | "carsise" | "phyllis" | "ami";

export type ItemImportResult = {
  lgo_file: string;
  texture_files: string[];
  import_dir: string;
};

export type DecompileResult = {
  records_total: number;
  records_written: number;
  records_skipped: number;
  output_path: string;
};

// ============================================================================
// Workbench Types
// ============================================================================

export type WorkbenchDummy = {
  id: number;
  label: string;
  position: [number, number, number];
};

export type WorkbenchState = {
  modelId: string;
  itemName: string;
  itemType: number;
  itemDescription: string;
  scaleFactor: number;
  sourceFile: string | null;
  lgoPath: string;
  hasGlowOverlay: boolean;
  registeredItemId: number | null;
  createdAt: string;
  modifiedAt: string;
  dummies: WorkbenchDummy[];
};

export type WorkbenchSummary = {
  modelId: string;
  itemName: string;
  itemType: number;
  dummyCount: number;
  hasGlowOverlay: boolean;
};

export type ItemInfoPreview = {
  tsvLine: string;
  assignedId: number;
};

/** Suggested dummy positions per item type */
export const DUMMY_PRESETS: Record<number, { label: string; position: [number, number, number] }[]> = {
  // Sword 1H
  1: [
    { label: "Guard area", position: [0, 0.4, 0] },
    { label: "Mid-blade", position: [0, 1.2, 0] },
    { label: "Blade tip", position: [0, 2.0, 0] },
  ],
  // Sword 2H
  2: [
    { label: "Guard area", position: [0, 0.4, 0] },
    { label: "Mid-blade", position: [0, 1.4, 0] },
    { label: "Blade tip", position: [0, 2.4, 0] },
  ],
  // Bow
  3: [
    { label: "Grip", position: [0, 0.8, 0] },
    { label: "Upper tip", position: [0, 1.6, 0] },
    { label: "Lower tip", position: [0, 0.0, 0] },
  ],
  // Gun
  4: [
    { label: "Grip", position: [0, 0.2, 0] },
    { label: "Barrel mid", position: [0, 0.8, 0] },
    { label: "Muzzle", position: [0, 1.4, 0] },
  ],
  // Knife/Dagger
  5: [
    { label: "Guard", position: [0, 0.3, 0] },
    { label: "Blade center", position: [0, 0.7, 0] },
    { label: "Blade tip", position: [0, 1.1, 0] },
  ],
  // Shield
  6: [
    { label: "Face center", position: [0, 0.6, 0] },
    { label: "Edge", position: [0.4, 0.6, 0] },
  ],
  // Staff
  7: [
    { label: "Base grip", position: [0, 0.2, 0] },
    { label: "Shaft mid", position: [0, 1.2, 0] },
    { label: "Staff head", position: [0, 2.2, 0] },
  ],
  // Axe
  8: [
    { label: "Handle base", position: [0, 0.2, 0] },
    { label: "Axe head center", position: [0, 1.4, 0] },
    { label: "Axe head edge", position: [0.3, 1.6, 0] },
  ],
  // Boxing Glove
  14: [
    { label: "Knuckle center", position: [0, 0.3, 0] },
    { label: "Knuckle top", position: [0, 0.5, 0] },
  ],
  // Claw
  15: [
    { label: "Base", position: [0, 0.2, 0] },
    { label: "Claw tip", position: [0, 0.8, 0] },
  ],
};
