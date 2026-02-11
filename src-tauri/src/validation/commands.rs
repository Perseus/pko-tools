use std::path::Path;

use serde::{Deserialize, Serialize};

use super::report::{ValidationReport, ValidationItem, ValidationSeverity, ValidationCategory};
use super::rules;
use crate::mesh_processing::analysis;

/// The type of import being validated.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportType {
    Character,
    Item,
}

/// Validate a model file for import, producing a comprehensive report.
#[tauri::command]
pub async fn validate_model_for_import(
    file_path: String,
    import_type: ImportType,
) -> Result<ValidationReport, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let mesh_report = analysis::analyze_gltf_file(path)
        .map_err(|e| format!("Failed to analyze model: {}", e))?;

    let mut report = ValidationReport::new();

    // Mesh validations
    if let Some(item) = rules::validate_triangle_count(mesh_report.triangle_count) {
        report.add(item);
    }
    if let Some(item) = rules::validate_subset_count(mesh_report.subset_count) {
        report.add(item);
    }
    if let Some(item) = rules::validate_normals(mesh_report.has_normals) {
        report.add(item);
    }
    if let Some(item) = rules::validate_texcoords(mesh_report.has_texcoords) {
        report.add(item);
    }

    // Skeleton validations (only for characters)
    if matches!(import_type, ImportType::Character) {
        if let Some(item) = rules::validate_bone_count(mesh_report.bone_count) {
            report.add(item);
        }

        if !mesh_report.has_skinning {
            report.add(ValidationItem {
                code: "NO_SKINNING".to_string(),
                message: "Character model has no skinning data. A skeleton and bone weights are required.".to_string(),
                severity: ValidationSeverity::Error,
                category: ValidationCategory::Skeleton,
                auto_fixable: false,
            });
        }
    }

    // Texture validations - check each material's texture
    let (doc, _buffers, images) = ::gltf::import(path)
        .map_err(|e| format!("Failed to import glTF for texture validation: {}", e))?;

    for (i, gltf_mat) in doc.materials().enumerate() {
        let pbr = gltf_mat.pbr_metallic_roughness();
        if let Some(tex_info) = pbr.base_color_texture() {
            let img_idx = tex_info.texture().source().index();
            if let Some(img_data) = images.get(img_idx) {
                let items = rules::validate_texture_dimensions(img_data.width, img_data.height);
                for item in items {
                    report.add(item);
                }
            }
        } else {
            if let Some(item) = rules::validate_has_texture(false) {
                report.add(item);
            }
        }
    }

    // If no materials exist at all, warn
    if doc.materials().count() == 0 {
        report.add(ValidationItem {
            code: "NO_MATERIALS".to_string(),
            message: "Model has no materials defined. Default materials will be used.".to_string(),
            severity: ValidationSeverity::Info,
            category: ValidationCategory::Material,
            auto_fixable: false,
        });
    }

    Ok(report)
}
