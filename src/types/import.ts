export type ImportType = "character" | "item";

export type ImportWizardStep =
  | "file-selection"
  | "preview"
  | "configuration"
  | "processing"
  | "result";

export const IMPORT_STEPS: ImportWizardStep[] = [
  "file-selection",
  "preview",
  "configuration",
  "processing",
  "result",
];

export type ImportWizardState = {
  step: ImportWizardStep;
  importType: ImportType;
  filePath: string | null;
  fileName: string | null;
  modelId: string;
  characterName: string;
  scaleFactor: number;
  isProcessing: boolean;
  error: string | null;
  result: ImportResult | null;
  validationReport: ValidationReport | null;
  meshAnalysis: MeshAnalysisReport | null;
};

export type MeshAnalysisReport = {
  vertex_count: number;
  triangle_count: number;
  index_count: number;
  material_count: number;
  subset_count: number;
  bone_count: number;
  has_normals: boolean;
  has_texcoords: boolean;
  has_vertex_colors: boolean;
  has_skinning: boolean;
  bounding_sphere_count: number;
  dummy_count: number;
  warnings: string[];
};

export type ValidationSeverity = "error" | "warning" | "info";

export type ValidationCategory =
  | "mesh"
  | "skeleton"
  | "texture"
  | "material"
  | "animation";

export type ValidationItem = {
  code: string;
  message: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  auto_fixable: boolean;
};

export type ValidationReport = {
  items: ValidationItem[];
  is_valid: boolean;
  error_count: number;
  warning_count: number;
  info_count: number;
};

export type ScaleAnalysis = {
  model_height: number;
  model_width: number;
  model_depth: number;
  suggested_scale: number;
  aabb_min: [number, number, number];
  aabb_max: [number, number, number];
};

export type ImportResult = {
  lgo_file: string;
  texture_files: string[];
  import_dir: string;
  character_id?: number;
};

// Retarget types

export type SkeletonSourceType =
  | "Mixamo"
  | "Unreal"
  | "Biped"
  | "Unity"
  | "Unknown";

export type MappingConfidence =
  | "Exact"
  | "High"
  | "Medium"
  | "Low"
  | "Manual"
  | "Unmapped";

export type BodyRegion =
  | "Root"
  | "Spine"
  | "Head"
  | "LeftArm"
  | "RightArm"
  | "LeftLeg"
  | "RightLeg";

export type ExternalBone = {
  name: string;
  index: number;
  parent_index: number | null;
  children: number[];
  depth: number;
  vertex_count: number;
};

export type AnalyzedSkeleton = {
  bones: ExternalBone[];
  source_type: SkeletonSourceType;
  bone_count: number;
  max_depth: number;
  has_root: boolean;
};

export type BoneMappingEntry = {
  source_name: string;
  source_index: number;
  target_name: string | null;
  target_index: number | null;
  confidence: MappingConfidence;
};

export type BoneMapping = {
  entries: BoneMappingEntry[];
  source_type: SkeletonSourceType;
  mapped_count: number;
  unmapped_count: number;
  missing_target_count: number;
};

export type BoneMergeAction = {
  source_index: number;
  source_name: string;
  target_index: number;
  target_name: string;
  affected_vertices: number;
};

export type BoneReductionPlan = {
  merges: BoneMergeAction[];
  final_bone_count: number;
  original_bone_count: number;
  within_limit: boolean;
};

export type AnalyzedModelReport = {
  skeleton: AnalyzedSkeleton;
  mapping: BoneMapping;
  reduction_plan: BoneReductionPlan;
};

export type MappingValidation = {
  is_valid: boolean;
  has_critical_mappings: boolean;
  mapped_count: number;
  unmapped_count: number;
  missing_target_count: number;
  errors: string[];
  warnings: string[];
};

export type ManualMappingOverride = {
  source_index: number;
  target_name: string | null;
};

export const INITIAL_WIZARD_STATE: ImportWizardState = {
  step: "file-selection",
  importType: "character",
  filePath: null,
  fileName: null,
  modelId: "",
  characterName: "",
  scaleFactor: 1.0,
  isProcessing: false,
  error: null,
  result: null,
  validationReport: null,
  meshAnalysis: null,
};
