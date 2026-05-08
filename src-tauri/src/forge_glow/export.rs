use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde_json::{json, Value};

use super::model::{ForgeGlowDraft, ForgeGlowExportResult, ForgeGlowVariant};
use super::storage::sanitize_slug;

fn now_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    secs.to_string()
}

pub fn export_dir_for(project_dir: &Path, draft: &ForgeGlowDraft) -> PathBuf {
    project_dir
        .join("pko-tools")
        .join("exports")
        .join("forge-glows")
        .join(format!("{}-{}", sanitize_slug(&draft.name), now_stamp()))
}

pub fn selected_variants<'a>(
    draft: &'a ForgeGlowDraft,
    variant_ids: &[String],
) -> Vec<&'a ForgeGlowVariant> {
    let selected: BTreeSet<&str> = variant_ids.iter().map(String::as_str).collect();
    let mut variants = vec![&draft.baseline_variant];

    variants.extend(draft.variants.iter().filter(|variant| {
        selected.is_empty()
            || selected.contains(variant.id.as_str())
            || variant.id == draft.active_variant_id
    }));

    variants
}

pub fn build_table_patch_intent(draft: &ForgeGlowDraft, variant_ids: &[String]) -> Value {
    let variants = selected_variants(draft, variant_ids)
        .into_iter()
        .map(|variant| {
            json!({
                "variantId": variant.id,
                "variantName": variant.name,
                "readonly": variant.readonly,
                "inputs": {
                    "weaponItemId": draft.source_recipe.weapon_item_id,
                    "charType": draft.source_recipe.char_type,
                    "category": draft.source_recipe.category,
                    "effectLevel": draft.source_recipe.effect_level,
                    "totalLevel": draft.source_recipe.total_level
                },
                "itemRefineInfo": {
                    "weaponItemId": draft.source_recipe.weapon_item_id,
                    "refineEffectId": draft.source_recipe.refine_effect_id
                },
                "itemRefineEffectInfo": {
                    "lightId": variant
                        .overrides
                        .light_id
                        .unwrap_or(draft.source_recipe.light_id),
                    "alpha": variant
                        .overrides
                        .alpha
                        .unwrap_or(draft.source_recipe.alpha),
                    "particleRows": draft
                        .source_recipe
                        .particle_rows
                        .iter()
                        .map(|row| {
                            let override_row = variant
                                .overrides
                                .particle_rows
                                .iter()
                                .find(|candidate| candidate.lane_tier == row.lane_tier);

                            json!({
                                "laneTier": row.lane_tier,
                                "enabled": override_row
                                    .and_then(|value| value.enabled)
                                    .unwrap_or(row.enabled),
                                "baseEffectId": row.base_effect_id,
                                "finalEffectId": row.final_effect_id,
                                "dummyId": override_row
                                    .and_then(|value| value.dummy_id)
                                    .unwrap_or(row.dummy_id),
                                "scale": override_row
                                    .and_then(|value| value.scale)
                                    .unwrap_or(row.scale),
                                "parFile": override_row
                                    .and_then(|value| value.par_file.clone())
                                    .unwrap_or_else(|| row.par_file.clone())
                            })
                        })
                        .collect::<Vec<_>>()
                }
            })
        })
        .collect::<Vec<_>>();

    json!({
        "format": "pko-tools.forge-glow.table-patch-intent.v0",
        "draftId": draft.id,
        "draftName": draft.name,
        "sourceTables": draft.source_recipe.source_tables,
        "variants": variants
    })
}

fn resolve_effect_file(project_dir: &Path, par_file: &str) -> PathBuf {
    project_dir.join("effect").join(par_file)
}

pub fn export_package(
    project_dir: &Path,
    draft: &ForgeGlowDraft,
    variant_ids: &[String],
) -> Result<ForgeGlowExportResult> {
    let output_dir = export_dir_for(project_dir, draft);
    let assets_dir = output_dir.join("assets").join("effect");
    let patches_dir = output_dir.join("table-patches");
    fs::create_dir_all(&assets_dir).with_context(|| format!("create {}", assets_dir.display()))?;
    fs::create_dir_all(&patches_dir)
        .with_context(|| format!("create {}", patches_dir.display()))?;

    let recipe_path = output_dir.join("recipe.json");
    let manifest_path = output_dir.join("manifest.json");
    let patch_path = patches_dir.join("table-patch-intent.json");

    let pretty_recipe = serde_json::to_string_pretty(draft)?;
    fs::write(&recipe_path, pretty_recipe)
        .with_context(|| format!("write {}", recipe_path.display()))?;

    let patch_intent = build_table_patch_intent(draft, variant_ids);
    fs::write(&patch_path, serde_json::to_string_pretty(&patch_intent)?)
        .with_context(|| format!("write {}", patch_path.display()))?;

    let mut warnings = Vec::new();
    let mut copied = BTreeSet::new();
    for row in &draft.source_recipe.particle_rows {
        let Some(par_file) = &row.par_file else {
            continue;
        };
        if !copied.insert(par_file.clone()) {
            continue;
        }

        let source = resolve_effect_file(project_dir, par_file);
        let target = assets_dir.join(par_file);
        if source.exists() {
            fs::copy(&source, &target)
                .with_context(|| format!("copy {} to {}", source.display(), target.display()))?;
        } else {
            warnings.push(format!("Effect asset not found: {}", source.display()));
        }
    }

    let exported_variant_ids = selected_variants(draft, variant_ids)
        .into_iter()
        .map(|variant| variant.id.clone())
        .collect::<Vec<_>>();
    let manifest = json!({
        "format": "pko-tools.forge-glow.export.v0",
        "draftId": draft.id,
        "draftName": draft.name,
        "recipe": "recipe.json",
        "tablePatchIntent": "table-patches/table-patch-intent.json",
        "assets": {
            "effect": copied.into_iter().collect::<Vec<_>>()
        },
        "variants": exported_variant_ids,
        "warnings": warnings
    });
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
        .with_context(|| format!("write {}", manifest_path.display()))?;

    Ok(ForgeGlowExportResult {
        output_dir: output_dir.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        recipe_path: recipe_path.to_string_lossy().to_string(),
        exported_variant_ids,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forge_glow::model::{
        ForgeGlowParticleOverride, ForgeGlowRecipeOverrides, ForgeGlowVariant,
    };

    #[test]
    fn table_patch_intent_always_includes_baseline() {
        let mut draft = ForgeGlowDraft::new_for_test("draft-one", "Draft One");
        draft.variants.push(ForgeGlowVariant {
            id: "variant-a".to_string(),
            name: "Variant A".to_string(),
            readonly: false,
            based_on_variant_id: Some("baseline".to_string()),
            overrides: ForgeGlowRecipeOverrides {
                alpha: Some(0.5),
                light_id: None,
                particle_rows: vec![ForgeGlowParticleOverride {
                    lane_tier: 0,
                    enabled: Some(false),
                    dummy_id: Some(7),
                    scale: Some(1.25),
                    par_file: None,
                }],
            },
        });

        let intent = build_table_patch_intent(&draft, &["variant-a".to_string()]);
        let variants = intent["variants"].as_array().unwrap();

        assert_eq!(variants.len(), 2);
        assert_eq!(variants[0]["variantId"], "baseline");
        assert_eq!(variants[1]["variantId"], "variant-a");
        assert_eq!(
            variants[1]["itemRefineEffectInfo"]["particleRows"][0]["enabled"],
            false
        );
        assert_eq!(
            variants[1]["itemRefineEffectInfo"]["particleRows"][0]["dummyId"],
            7
        );
    }
}
