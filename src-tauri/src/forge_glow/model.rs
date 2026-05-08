use serde::{Deserialize, Serialize};

use crate::item::commands::ForgeTraceResult;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRecipeInputs {
    pub weapon_item_id: u32,
    pub char_type: u32,
    pub gems: Vec<ForgeRecipeGemInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRecipeGemInput {
    pub item_id: u32,
    pub level: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRecipeParticleRow {
    pub lane_tier: u32,
    pub base_effect_id: i32,
    pub final_effect_id: u32,
    pub dummy_id: i32,
    pub scale: f32,
    pub par_file: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedForgeRecipe {
    pub weapon_item_id: u32,
    pub weapon_name: String,
    #[serde(default)]
    pub weapon_model_id: String,
    pub char_type: u32,
    pub total_level: u32,
    pub effect_level: u32,
    pub alpha: f32,
    pub category: u32,
    pub refine_effect_id: Option<i32>,
    pub light_id: Option<i32>,
    pub particle_rows: Vec<ForgeRecipeParticleRow>,
    pub source_tables: Vec<String>,
    pub warnings: Vec<String>,
}

impl ResolvedForgeRecipe {
    pub fn from_trace(trace: ForgeTraceResult) -> Self {
        let particle_rows = trace
            .particles
            .into_iter()
            .map(|particle| ForgeRecipeParticleRow {
                lane_tier: particle.lane_tier,
                base_effect_id: particle.base_effect_id,
                final_effect_id: particle.final_effect_id,
                dummy_id: particle.dummy_id,
                scale: particle.scale,
                par_file: particle.par_file,
                enabled: true,
            })
            .collect();

        Self {
            weapon_item_id: trace.weapon_item_id,
            weapon_name: trace.weapon_name,
            weapon_model_id: trace.weapon_model_id,
            char_type: trace.char_type,
            total_level: trace.total_level,
            effect_level: trace.effect_level,
            alpha: trace.alpha,
            category: trace.category,
            refine_effect_id: trace.refine_effect_id,
            light_id: trace.light_id,
            particle_rows,
            source_tables: vec![
                "ItemInfo".to_string(),
                "StoneInfo".to_string(),
                "ItemRefineInfo".to_string(),
                "ItemRefineEffectInfo".to_string(),
                "SceneEffectInfo".to_string(),
            ],
            warnings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGlowRecipeOverrides {
    pub alpha: Option<f32>,
    pub light_id: Option<Option<i32>>,
    pub particle_rows: Vec<ForgeGlowParticleOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGlowParticleOverride {
    pub lane_tier: u32,
    pub enabled: Option<bool>,
    pub dummy_id: Option<i32>,
    pub scale: Option<f32>,
    pub par_file: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGlowVariant {
    pub id: String,
    pub name: String,
    pub readonly: bool,
    pub based_on_variant_id: Option<String>,
    pub overrides: ForgeGlowRecipeOverrides,
}

impl ForgeGlowVariant {
    pub fn baseline() -> Self {
        Self {
            id: "baseline".to_string(),
            name: "Baseline".to_string(),
            readonly: true,
            based_on_variant_id: None,
            overrides: ForgeGlowRecipeOverrides::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGlowDraft {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub modified_at: String,
    pub source_recipe: ResolvedForgeRecipe,
    pub baseline_variant: ForgeGlowVariant,
    pub variants: Vec<ForgeGlowVariant>,
    pub active_variant_id: String,
}

impl ForgeGlowDraft {
    pub fn new(
        id: String,
        name: String,
        timestamp: String,
        source_recipe: ResolvedForgeRecipe,
    ) -> Self {
        Self {
            id,
            name,
            created_at: timestamp.clone(),
            modified_at: timestamp,
            source_recipe,
            baseline_variant: ForgeGlowVariant::baseline(),
            variants: Vec::new(),
            active_variant_id: "baseline".to_string(),
        }
    }

    #[cfg(test)]
    pub fn new_for_test(id: &str, name: &str) -> Self {
        Self::new(
            id.to_string(),
            name.to_string(),
            "2026-05-08T00:00:00Z".to_string(),
            ResolvedForgeRecipe {
                weapon_item_id: 5001,
                weapon_name: "Test Sword".to_string(),
                weapon_model_id: "01010001".to_string(),
                char_type: 0,
                total_level: 9,
                effect_level: 2,
                alpha: 0.75,
                category: 1,
                refine_effect_id: Some(100),
                light_id: Some(20),
                particle_rows: vec![ForgeRecipeParticleRow {
                    lane_tier: 0,
                    base_effect_id: 10,
                    final_effect_id: 102,
                    dummy_id: 1,
                    scale: 1.0,
                    par_file: Some("01000002.par".to_string()),
                    enabled: true,
                }],
                source_tables: vec!["ItemRefineInfo".to_string()],
                warnings: Vec::new(),
            },
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGlowDraftSummary {
    pub id: String,
    pub name: String,
    pub weapon_item_id: u32,
    pub weapon_name: String,
    pub variant_count: usize,
    pub modified_at: String,
}

impl From<&ForgeGlowDraft> for ForgeGlowDraftSummary {
    fn from(draft: &ForgeGlowDraft) -> Self {
        Self {
            id: draft.id.clone(),
            name: draft.name.clone(),
            weapon_item_id: draft.source_recipe.weapon_item_id,
            weapon_name: draft.source_recipe.weapon_name.clone(),
            variant_count: draft.variants.len() + 1,
            modified_at: draft.modified_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGlowExportResult {
    pub output_dir: String,
    pub manifest_path: String,
    pub recipe_path: String,
    pub exported_variant_ids: Vec<String>,
    pub warnings: Vec<String>,
}
