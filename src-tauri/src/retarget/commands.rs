use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::mapper::{apply_manual_override, auto_map_bones, BoneMapping};
use super::reducer::{plan_bone_reduction, BoneReductionPlan};
use super::skeleton::{analyze_skeleton, AnalyzedSkeleton};

/// Result of analyzing an external model for retargeting
#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyzedModelReport {
    pub skeleton: AnalyzedSkeleton,
    pub mapping: BoneMapping,
    pub reduction_plan: BoneReductionPlan,
}

/// Analyze an external glTF model and return skeleton analysis + auto mapping + reduction plan
#[tauri::command]
pub fn analyze_external_model(file_path: String) -> Result<AnalyzedModelReport, String> {
    let (doc, _buffers, _images) =
        gltf::import(&file_path).map_err(|e| format!("Failed to load glTF: {}", e))?;

    let skin = doc.skins().next().ok_or_else(|| {
        "No skin found in glTF file. The model must be skinned (have a skeleton).".to_string()
    })?;

    let joints: Vec<_> = skin.joints().collect();

    // Build joint name and parent lists
    let mut joint_names = Vec::with_capacity(joints.len());
    let mut joint_parents: Vec<Option<usize>> = Vec::with_capacity(joints.len());
    let joint_node_indices: Vec<usize> = joints.iter().map(|j| j.index()).collect();

    for joint in &joints {
        joint_names.push(joint.name().unwrap_or("unnamed").to_string());

        // Find parent by checking which other joint has this one as a child
        let parent = joints
            .iter()
            .position(|p| p.children().any(|c| c.index() == joint.index()));
        joint_parents.push(parent);
    }

    let skeleton = analyze_skeleton(&joint_names, &joint_parents);
    let mapping = auto_map_bones(&skeleton);
    let reduction_plan = plan_bone_reduction(&mapping, &joint_parents, None);

    Ok(AnalyzedModelReport {
        skeleton,
        mapping,
        reduction_plan,
    })
}

/// Auto-map bones for an external model
#[tauri::command]
pub fn auto_map_bones_cmd(file_path: String) -> Result<BoneMapping, String> {
    let report = analyze_external_model(file_path)?;
    Ok(report.mapping)
}

/// Input for applying a manual bone mapping override
#[derive(Debug, Deserialize)]
pub struct ManualMappingOverride {
    pub source_index: usize,
    pub target_name: Option<String>,
}

/// Apply manual bone mapping overrides and return updated mapping
#[tauri::command]
pub fn apply_bone_mapping(
    file_path: String,
    overrides: Vec<ManualMappingOverride>,
) -> Result<BoneMapping, String> {
    let mut report = analyze_external_model(file_path)?;

    for ovr in overrides {
        apply_manual_override(&mut report.mapping, ovr.source_index, ovr.target_name);
    }

    Ok(report.mapping)
}

/// Validation result for a bone mapping
#[derive(Debug, Serialize)]
pub struct MappingValidation {
    pub is_valid: bool,
    pub has_critical_mappings: bool,
    pub mapped_count: usize,
    pub unmapped_count: usize,
    pub missing_target_count: usize,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Validate a bone mapping for import readiness
#[tauri::command]
pub fn validate_bone_mapping(
    file_path: String,
    overrides: Vec<ManualMappingOverride>,
) -> Result<MappingValidation, String> {
    let mut report = analyze_external_model(file_path)?;

    for ovr in overrides {
        apply_manual_override(&mut report.mapping, ovr.source_index, ovr.target_name);
    }

    let mapping = &report.mapping;
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if mapping.mapped_count == 0 {
        errors
            .push("No bones are mapped. At least the root and pelvis must be mapped.".to_string());
    }

    if !mapping.has_critical_mappings() {
        warnings
            .push("Some critical bones (Bip01, Pelvis, Spine, Spine1) are not mapped.".to_string());
    }

    if !report.reduction_plan.within_limit {
        errors.push(format!(
            "After reduction, {} bones remain (max {}). More bones need to be merged.",
            report.reduction_plan.final_bone_count,
            super::reducer::PKO_MAX_BONES
        ));
    }

    if mapping.missing_target_count > 10 {
        warnings.push(format!(
            "{} PKO bones have no source mapping. The character may not animate correctly.",
            mapping.missing_target_count
        ));
    }

    let is_valid = errors.is_empty();

    Ok(MappingValidation {
        is_valid,
        has_critical_mappings: mapping.has_critical_mappings(),
        mapped_count: mapping.mapped_count,
        unmapped_count: mapping.unmapped_count,
        missing_target_count: mapping.missing_target_count,
        errors,
        warnings,
    })
}
